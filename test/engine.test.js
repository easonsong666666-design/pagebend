import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { scan, redactUrl } from '../src/browser.js';
import { applyProfile, DEFAULT_PROFILES } from '../src/profiles.js';
import { detect, compareFindings } from '../src/detect.js';

const channel = process.env.PAGEBEND_TEST_CHANNEL || 'chromium';
let browser;
let server;
let origin;
const document = (body) => `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:16px;font-family:Arial;font-size:16px}*{box-sizing:border-box}</style></head><body>${body}</body></html>`;

before(async () => {
  browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
  server = createServer((req, res) => {
    if (req.url.startsWith('/missing')) { res.writeHead(404); res.end('not found'); return; }
    res.setHeader('content-type', 'text/html');
    if (req.url.startsWith('/csp')) res.setHeader('content-security-policy', "default-src 'none'; style-src 'none'");
    if (req.url.startsWith('/tall')) { res.end(document('<main style="min-height:13000px"><h1>A tall page</h1></main>')); return; }
    res.end(document('<main><h1>PageBend fixture</h1><p id="label">Readable text</p></main>'));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
});

async function withPage(html, run) {
  const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
  try {
    const page = await context.newPage();
    await page.setContent(document(html));
    return await run(page);
  } finally { await context.close(); }
}

test('text mutation preserves child markup, listeners, input values and excluded subtrees', async () => {
  await withPage('<section id="scope"><button id="button">Open <strong>account</strong></button><input value="keep"><pre>keep code</pre><div contenteditable>keep editable</div><div hidden>keep hidden</div><p id="ignore">keep ignored</p></section><p id="outside">keep outside</p>', async (page) => {
    await page.evaluate(() => document.querySelector('#button').addEventListener('click', () => { window.clicked = true; }));
    const result = await applyProfile(page, 'long-text', { scope: '#scope', ignore: ['#ignore'] });
    assert.equal(result.changed, 2);
    assert.equal(await page.locator('#button strong').textContent(), 'account account');
    assert.equal(await page.locator('input').inputValue(), 'keep');
    for (const [selector, value] of [['pre', 'keep code'], ['[contenteditable]', 'keep editable'], ['[hidden]', 'keep hidden'], ['#ignore', 'keep ignored'], ['#outside', 'keep outside']]) {
      assert.equal(await page.locator(selector).textContent(), value);
    }
    await page.locator('#button').click();
    assert.equal(await page.evaluate(() => window.clicked), true);
  });
});

test('font zoom doubles precomputed sizes once and preserves ignored and code descendants', async () => {
  await withPage('<div id="parent" style="font-size:10px"><span id="child">Nested <em id="grandchild">text</em></span><code id="code">sample</code><span id="ignore">ignored</span></div>', async (page) => {
    await applyProfile(page, 'text-zoom', { scope: '#parent', ignore: ['#ignore'] });
    const sizes = await page.evaluate(() => Object.fromEntries(['parent', 'child', 'grandchild', 'code', 'ignore'].map((id) => [id, parseFloat(getComputedStyle(document.getElementById(id)).fontSize)])));
    assert.deepEqual(sizes, { parent: 20, child: 20, grandchild: 20, code: 10, ignore: 10 });
  });
});

test('missing images uses an invalid data URI and clears responsive sources without network requests', async () => {
  await withPage('<picture><source srcset="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E"><img id="image" width="30" height="30" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E"></picture>', async (page) => {
    const requests = [];
    page.on('request', (request) => requests.push(request.url()));
    const result = await applyProfile(page, 'missing-images');
    assert.equal(result.changed, 1);
    assert.equal(await page.locator('#image').getAttribute('src'), 'data:image/png;base64,AA==');
    assert.equal(await page.locator('source').getAttribute('srcset'), null);
    assert.deepEqual(requests, []);
  });
});

test('text clipping distinguishes hidden overflow from intentional ellipsis and scrolling', async () => {
  await withPage('<style>.sample{width:60px;white-space:nowrap;overflow:hidden}.scroll{overflow:auto}.ellipsis{text-overflow:ellipsis}</style><p id="clipped" class="sample">A long descriptive label</p><p id="scroll" class="sample scroll">A long descriptive label</p><p id="ellipsis" class="sample ellipsis">A long descriptive label</p>', async (page) => {
    const result = await detect(page);
    assert.deepEqual(result.findings.filter((finding) => finding.kind === 'text-clipping').map((finding) => finding.selector), ['#clipped']);
  });
});

test('DOM and finding limits are visible in warnings', async () => {
  const rows = Array.from({ length: 30 }, (_, i) => `<p id="row${i}" style="width:10px;overflow:hidden;white-space:nowrap">Long content</p>`).join('');
  await withPage(rows, async (page) => {
    const result = await detect(page, { maxElements: 10, maxFindings: 2 });
    assert.equal(result.inspectedElements, 10);
    assert.equal(result.findings.length, 2);
    assert.ok(result.warnings.some((warning) => warning.includes('first 10 DOM elements')));
    assert.ok(result.warnings.some((warning) => warning.includes('capped at 2')));
  });
});

test('offscreen transformed decoration does not create a page-level false positive', async () => {
  await withPage('<div style="position:absolute;left:0;top:0;width:1000px;height:20px;transform:translateX(800px)"></div><p>Normal page content</p>', async (page) => {
    const result = await detect(page);
    assert.ok(result.pageWidth > result.viewportWidth);
    assert.deepEqual(result.findings, []);
  });
});

test('finding status keeps original evidence and flags new selectors', () => {
  const old = { id: 'text-clipping:#label', excessPx: 5 };
  const current = { id: 'text-clipping:#label', excessPx: 100 };
  const changed = compareFindings([old], [current, { id: 'text-clipping:#button', excessPx: 10 }]);
  assert.equal(changed[0].status, 'existing');
  assert.equal(changed[0].excessPx, 100);
  assert.equal(changed[1].status, 'new');
  assert.equal(old.excessPx, 5);
});

test('scan produces PNG snapshots and correct narrow viewport with URL redaction', async () => {
  const report = await scan({ url: `${origin}/?secret=do-not-export#private`, profiles: ['narrow'], width: 800, height: 600, wait: 0, channel });
  assert.equal(report.url, `${origin}/`);
  assert.equal(report.cases[0].error, undefined);
  assert.equal(report.cases[0].before.width, 800);
  assert.equal(report.cases[0].after.width, 375);
  assert.equal(report.cases[0].viewport.width, 375);
  assert.match(report.cases[0].after.image, /^data:image\/png;base64,iVBOR/);
  assert.equal(JSON.stringify(report).includes('do-not-export'), false);
});

test('HTTP failures and unmatched scopes are explicit case errors', async () => {
  const http = await scan({ url: `${origin}/missing?secret=private`, profiles: ['long-text'], wait: 0, channel });
  assert.match(http.cases[0].error, /HTTP 404/);
  assert.equal(http.summary.reviewCases, 1);
  const scope = await scan({ url: origin, profiles: ['long-text'], scope: '#absent', wait: 0, channel });
  assert.match(scope.cases[0].error, /Scope selector matched no elements/);
  assert.equal(scope.summary.reviewCases, 1);
});

test('tall pages produce bounded screenshots and an explicit truncation warning', async () => {
  const report = await scan({ url: `${origin}/tall`, profiles: ['narrow'], width: 800, height: 600, wait: 0, channel });
  assert.equal(report.cases[0].error, undefined);
  assert.equal(report.cases[0].before.height, 12000);
  assert.equal(report.cases[0].after.height, 12000);
  assert.ok(report.warnings.some((warning) => warning.includes('Screenshot clipped to the first 12000px')));
});

test('strict CSP keeps its baseline policy and uses a documented animation fallback', async () => {
  const report = await scan({ url: `${origin}/csp`, profiles: ['long-text'], wait: 0, channel });
  assert.equal(report.cases[0].error, undefined);
  assert.ok(report.cases[0].mutation.changed > 0);
  assert.ok(report.warnings.some((warning) => warning.includes('Page policy blocked the animation stylesheet')));
});

test('invalid profiles, dimensions and protocols fail before browser launch', async () => {
  for (const options of [{ profiles: ['made-up'] }, { profiles: ['long-text', 'long-text'] }, { width: 1 }, { profiles: [] }, { url: 'file:///etc/passwd' }]) {
    await assert.rejects(scan({ url: origin, ...options }));
  }
  assert.equal(DEFAULT_PROFILES.length, 6);
  assert.equal(redactUrl('https://user:password@example.com/path?token=secret#hash'), 'https://example.com/path');
});
