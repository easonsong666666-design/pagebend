import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { scan } from '../src/browser.js';

const fixtureDirectory = fileURLToPath(new URL('./fixtures/', import.meta.url));
const browserOptions = { channel: process.env.PAGEBEND_TEST_CHANNEL || 'chromium' };
let server;
let baseUrl;
let temporary;
let fragileReport;

before(async () => {
  const pages = new Map(await Promise.all(['fragile', 'fixed', 'intentional'].map(async name => [
    `/${name}`, await readFile(join(fixtureDirectory, `${name}.html`), 'utf8')
  ])));
  server = createServer((request, response) => {
    const path = new URL(request.url, 'http://fixture.local').pathname;
    if (path === '/redirect') { response.writeHead(302, { Location: '/fragile?token=PRIVATE_REDIRECT_TOKEN' }); response.end(); return; }
    if (path === '/authenticated') {
      const authorized = request.headers.cookie?.includes('fixture_session=SYNTHETIC_COOKIE_6241');
      response.writeHead(authorized ? 200 : 401, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(authorized ? pages.get('/fragile') : 'Unauthorized');
      return;
    }
    const html = pages.get(path);
    response.writeHead(html ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(html || 'Not found');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  temporary = await mkdtemp(join(tmpdir(), 'pagebend-acceptance-'));
});

after(async () => {
  if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  if (temporary) await rm(temporary, { recursive: true, force: true });
});

const inspect = (path, options = {}) => scan({
  url: `${baseUrl}/${path}`, width: 800, height: 600, wait: 0, timeout: 5000,
  profiles: ['long-text'], ...browserOptions, ...options
});

test('redirects are visible so a login page cannot silently stand in for the target', async () => {
  const report = await inspect('redirect');
  succeeded(report);
  assert.equal(report.cases[0].resolvedUrl, `${baseUrl}/fragile`);
  assert.ok(report.warnings.some(warning => warning.includes('redirected') && warning.includes('/fragile')));
  assert.ok(!JSON.stringify(report).includes('PRIVATE_REDIRECT_TOKEN'));
});

function succeeded(report) {
  assert.equal(report.schemaVersion, 1);
  for (const scenario of report.cases) {
    assert.equal(scenario.error, undefined, scenario.error);
    assert.match(scenario.before.image, /^data:image\/png;base64,/);
    assert.match(scenario.after.image, /^data:image\/png;base64,/);
  }
}

test('a clean page breaks under long text; a CSS repair removes the same candidate', async () => {
  fragileReport = await inspect('fragile', { ignore: ['[data-pagebend-ignore]'] });
  succeeded(fragileReport);
  const scenario = fragileReport.cases[0];
  assert.equal(scenario.before.findings.length, 0, 'ordinary content must fit before stress');
  const issue = scenario.findings.find(item => item.selector === '#target' && item.kind === 'text-clipping');
  assert.ok(issue, 'long text should expose the fixed-size approval label');
  assert.ok(scenario.findings.some(item => item.selector === '#nested-target' && item.kind === 'text-clipping'), 'wrapping a text node in an inline span must not hide a real clipping candidate');
  assert.equal(issue.status, 'new');
  assert.ok(issue.excessPx > 2);
  assert.ok(scenario.mutation.changed > 0);
  assert.notEqual(scenario.before.image, scenario.after.image);
  assert.ok(!scenario.findings.some(item => item.selector === '#ignored'));

  const repaired = await inspect('fixed', { profiles: ['long-text', 'unbroken', 'text-zoom'], ignore: ['[data-pagebend-ignore]'] });
  succeeded(repaired);
  assert.equal(repaired.summary.newFindings, 0, 'wrapping and intrinsic height should handle these three stresses');
  assert.equal(repaired.summary.existingFindings, 0);
});

test('each profile gets an untouched baseline, and repeated input produces the same finding identities', async () => {
  const report = await inspect('fragile', { profiles: ['long-text', 'text-zoom', 'rtl'] });
  succeeded(report);
  assert.equal(new Set(report.cases.map(item => item.before.image)).size, 1, 'a prior profile must not contaminate the next baseline');
  const repeated = await inspect('fragile');
  succeeded(repeated);
  assert.deepEqual(
    report.cases[0].findings.map(({ id, excessPx, status }) => ({ id, excessPx, status })),
    repeated.cases[0].findings.map(({ id, excessPx, status }) => ({ id, excessPx, status }))
  );
});

test('intentional scroll, ellipsis and line clamp are not presented as clipping defects', async () => {
  const report = await inspect('intentional', { profiles: ['long-text', 'unbroken'] });
  succeeded(report);
  assert.equal(report.summary.newFindings, 0);
  assert.equal(report.summary.existingFindings, 0);
});

test('scoping tests the selected component and leaves other fragile components out', async () => {
  const report = await inspect('fragile', { scope: '#scope' });
  succeeded(report);
  assert.ok(report.cases[0].findings.some(item => item.selector === '#target'));
  assert.ok(report.cases[0].findings.every(item => item.selector !== '#ignored'));
});

test('unsupported URLs and profiles fail instead of returning a misleading clean report', async () => {
  await assert.rejects(scan({ url: 'file:///tmp/example.html' }), /https?/i);
  await assert.rejects(inspect('fragile', { profiles: ['imaginary-profile'] }), /profile/i);
});

test('a missing target, missing scope or readiness selector is an explicit failed scenario', async () => {
  for (const options of [
    { url: `${baseUrl}/not-found` },
    { scope: '#does-not-exist' },
    { waitFor: '#does-not-exist', timeout: 150 }
  ]) {
    const report = await inspect('fragile', options);
    assert.equal(report.cases.length, 1);
    assert.ok(report.cases[0].error, 'failure must not appear as a successful scan with zero candidates');
    assert.equal(report.summary.reviewCases, 1);
  }
});

test('reports omit target query strings and fragments, including error messages', async () => {
  const marker = 'PRIVATE_QUERY_MARKER_5196';
  const report = await inspect(`fragile?access_token=${marker}#${marker}`);
  succeeded(report);
  assert.equal(report.url, `${baseUrl}/fragile`);
  assert.ok(!JSON.stringify(report).includes(marker));
  const failed = await inspect(`not-found?access_token=${marker}#${marker}`);
  assert.ok(failed.cases[0].error);
  assert.ok(!JSON.stringify(failed).includes(marker));
});

test('explicit authentication state opens an authenticated page without embedding the state in the report', async () => {
  const unauthorized = await inspect('authenticated');
  assert.match(unauthorized.cases[0].error, /401/);
  const statePath = join(temporary, 'PRIVATE_AUTH_STATE_PATH_6241.json');
  await writeFile(statePath, JSON.stringify({ cookies: [{
    name: 'fixture_session', value: 'SYNTHETIC_COOKIE_6241', domain: '127.0.0.1', path: '/',
    expires: -1, httpOnly: true, secure: false, sameSite: 'Lax'
  }], origins: [] }));
  const authorized = await inspect('authenticated', { storageState: statePath });
  succeeded(authorized);
  const serialized = JSON.stringify(authorized);
  assert.ok(!serialized.includes('SYNTHETIC_COOKIE_6241'));
  assert.ok(!serialized.includes('PRIVATE_AUTH_STATE_PATH_6241'));
  const broken = await inspect('authenticated', { storageState: `${statePath}.missing` });
  assert.ok(broken.cases[0].error);
  assert.ok(!JSON.stringify(broken).includes('PRIVATE_AUTH_STATE_PATH_6241'));
});

test('an exported HTML report works from file:// without outbound requests or HTML injection', async () => {
  const { renderReport } = await import('../src/report.js');
  if (!fragileReport) fragileReport = await inspect('fragile');
  const report = structuredClone(fragileReport);
  const attack = '</script><script>window.__pagebendInjected = true</script><img src="https://invalid.example/steal" onerror="window.__pagebendInjected = true">';
  report.title = attack;
  report.url = attack;
  report.cases[0].findings[0].message = attack;
  report.cases[0].findings[0].selector = attack;
  const file = join(temporary, 'offline-report.html');
  await writeFile(file, renderReport(report));
  const browser = await chromium.launch({ headless: true, ...browserOptions });
  const requests = [];
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(file).href);
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.__pagebendInjected), undefined);
    assert.deepEqual(requests, [], 'the portable report must not request fonts, scripts, images or telemetry from the network');
    assert.deepEqual(errors, [], 'the report should execute without browser errors');
    assert.ok(await page.locator('img').count() >= 2, 'before and after screenshots must be visible');
    const imagesLoaded = await page.locator('img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0));
    assert.equal(imagesLoaded, true);
  } finally { await browser.close(); }
});

test('portable report controls switch profiles, locate candidates, export data and fit a phone viewport', async () => {
  const { renderReport } = await import('../src/report.js');
  const report = await inspect('fragile', { profiles: ['long-text', 'narrow'], ignore: ['[data-pagebend-ignore]'] });
  succeeded(report);
  const file = join(temporary, 'interactive-report.html');
  await writeFile(file, renderReport(report));
  const browser = await chromium.launch({ headless: true, ...browserOptions });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(pathToFileURL(file).href);
    await page.getByRole('button', { name: 'Overlay', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Overlay', exact: true }).getAttribute('aria-pressed'), 'true');
    const slider = page.getByRole('slider', { name: 'Reveal stressed screenshot' });
    await slider.fill('74');
    assert.equal(await slider.getAttribute('aria-valuetext'), '74 percent stressed screenshot');
    await page.getByRole('button', { name: /^Locate candidate 1:/ }).click();
    assert.equal(await slider.inputValue(), '100', 'locating a candidate should reveal the whole stressed overlay');
    assert.ok(await page.locator('.finding-mark.selected').count() > 0);
    await page.getByLabel('Highlight candidates', { exact: true }).uncheck();
    assert.ok(await page.locator('#compare-root').evaluate(element => element.classList.contains('hide-highlights')));

    await page.getByRole('button', { name: /^Narrow screen,/ }).click();
    assert.equal(await page.getByRole('heading', { level: 2 }).textContent(), 'Narrow screen');
    assert.equal(await page.getByRole('button', { name: 'Overlay', exact: true }).isDisabled(), true, 'different image widths must not be visually overlaid at a false scale');
    const activeProfile = page.getByRole('button', { name: /^Narrow screen,/ });
    await activeProfile.focus();
    await page.keyboard.press('Home');
    assert.equal(await page.getByRole('heading', { level: 2 }).textContent(), 'Long text');

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export JSON' }).click();
    const download = await downloadPromise;
    const downloaded = JSON.parse(await readFile(await download.path(), 'utf8'));
    assert.equal(downloaded.schemaVersion, 1);
    assert.deepEqual(downloaded.summary, report.summary);
    assert.equal(downloaded.cases.length, 2);

    await page.setViewportSize({ width: 375, height: 812 });
    const dimensions = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth }));
    assert.ok(dimensions.document <= dimensions.width + 1, `report itself should reflow: ${JSON.stringify(dimensions)}`);
  } finally { await browser.close(); }
});

test('failed captures remain visible and do not crash the exported report', async () => {
  const { renderReport } = await import('../src/report.js');
  const report = await inspect('not-found');
  assert.ok(report.cases[0].error);
  const file = join(temporary, 'failed-report.html');
  await writeFile(file, renderReport(report));
  const browser = await chromium.launch({ headless: true, ...browserOptions });
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(file).href);
    assert.equal(await page.getByText('Capture incomplete', { exact: true }).isVisible(), true);
    assert.equal(await page.getByText('Target returned HTTP 404.', { exact: true }).isVisible(), true);
    assert.equal(await page.getByRole('button', { name: 'Overlay', exact: true }).isDisabled(), true);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
