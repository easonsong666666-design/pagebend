// Reproduce one bounded stress experiment on an upstream template.
// No changes are made to Bootstrap, the target website, or PageBend's detector.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
import { scan, renderReport } from '../src/index.js';
import { applyProfile } from '../src/profiles.js';

const commit = '25aa8cc0b32f0d1a54be575347e6d84b70b1acd7';
const scope = 'header > div:first-child > a > span';
const out = resolve(process.argv[2] ?? 'output/bootstrap-pricing-case');
if (process.argv.length > 3) throw new Error('Usage: node scripts/case-bootstrap-pricing.mjs [new-output-directory]');
await mkdir(resolve(out, '..'), { recursive: true });
await mkdir(out); // Refuse to replace any earlier experiment.
const files = [
  ['index.astro', 'site/src/assets/examples/pricing/index.astro', '2ce4c05c85ca9da28d49ea20b0b44b2d85f4444dfb20b79f26cc69863bb89c7d'],
  ['pricing.css', 'site/src/assets/examples/pricing/pricing.css', 'b4058af51de9c99bbf987c6f1614cf22f6b10d4d773cd4320886ab23ad2505db'],
  ['bootstrap.min.css', 'dist/css/bootstrap.min.css', 'd85327d99c7a3ee1f9b5d0500d1370acea3ad2db39c163c2f51f232baedbdede'],
  ['bootstrap-logo.svg', 'site/static/docs/[version]/assets/brand/bootstrap-logo.svg', 'df11d37a123e36a768f2a6064973c4c6ab17d1e3c6501c8bf434ca5c0134c9a2'],
  ['LICENSE', 'LICENSE', '4620c84ad5ce8602ff65640ed6b7c8b78ebb9e036584f0ebc1ccc88206a4bb51'],
];
const sources = [];
for (const [file, source, expected] of files) {
  const url = `https://raw.githubusercontent.com/twbs/bootstrap/${commit}/${source}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Source download failed: HTTP ${response.status} for ${file}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== expected) throw new Error(`Source hash mismatch for ${file}`);
  await writeFile(join(out, file), bytes);
  sources.push({ file, url, sha256 });
}

const source = await readFile(join(out, 'index.astro'), 'utf8');
const body = source.replace(/^---[\s\S]*?---\s*/, '')
  .replace("src={getVersionedDocsPath('/assets/brand/bootstrap-logo.svg')}", 'src="bootstrap-logo.svg"')
  .replace('{new Date().getFullYear()}', '2025');
if (body.includes('getVersionedDocsPath') || body.includes('new Date()')) throw new Error('Unexpected template syntax');
const fix = `header > div:first-child > a { min-width: 0; }
header > div:first-child > a > span { min-width: 0; overflow-wrap: anywhere; }
header > div:first-child > a > svg { flex-shrink: 0; }`;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bootstrap 5.3.8 pricing example</title><link rel="stylesheet" href="bootstrap.min.css"><link rel="stylesheet" href="pricing.css"></head><body>${body}</body></html>`;
await writeFile(join(out, 'original.html'), html);
await writeFile(join(out, 'fixed.html'), html.replace('</head>', '<link rel="stylesheet" href="fix.css"></head>'));
await writeFile(join(out, 'fix.css'), fix + '\n');

const allowed = new Set(['original.html', 'fixed.html', 'bootstrap.min.css', 'pricing.css', 'bootstrap-logo.svg', 'fix.css']);
const server = createServer(async (req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1);
  if (!allowed.has(name)) { res.writeHead(404).end(); return; }
  try {
    const bytes = await readFile(join(out, name));
    res.setHeader('Content-Type', name.endsWith('.css') ? 'text/css' : name.endsWith('.svg') ? 'image/svg+xml' : 'text/html');
    res.end(bytes);
  } catch { res.writeHead(500).end(); }
});
await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
const origin = `http://127.0.0.1:${server.address().port}`;
const evidence = { upstreamCommit: commit, scope, profile: 'unbroken', viewport: { width: 1280, height: 900 }, sources, results: [] };
let browser;
try {
  browser = await chromium.launch({ channel: 'chromium', headless: true });
  for (const variant of ['original', 'fixed']) {
    const url = `${origin}/${variant}.html`;
    const report = await scan({ url, profiles: ['unbroken'], scope });
    const item = report.cases[0];
    if (item.error) throw new Error(`${variant}: ${item.error}`);
    await writeFile(join(out, `${variant}-report.html`), renderReport(report));
    await writeFile(join(out, `${variant}-report.json`), JSON.stringify(report, null, 2));

    // Independently inspect the neighboring links, which are outside scan scope.
    const context = await browser.newContext({ viewport: evidence.viewport, deviceScaleFactor: 1 });
    const visual = {};
    try {
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      for (const phase of ['baseline', 'stressed']) {
        if (phase === 'stressed') await applyProfile(page, 'unbroken', { scope });
        await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
        visual[phase] = await page.evaluate(() => {
          const header = document.querySelector('header > div:first-child');
          const links = [...header.querySelectorAll('nav a')].map(link => {
            const r = link.getBoundingClientRect();
            return { text: link.textContent, left: r.left, right: r.right, insideViewport: r.left >= 0 && r.right <= innerWidth };
          });
          return { headerHeight: header.getBoundingClientRect().height, links };
        });
        await page.screenshot({ path: join(out, `${variant}-${phase}-header.png`), clip: { x: 0, y: 0, width: 1280, height: 210 } });
      }
    } finally { await context.close(); }
    evidence.results.push({ variant, pagebendVersion: report.version, summary: report.summary, mutation: item.mutation, findings: item.findings, visual });
    console.log(`${variant}: ${report.summary.newFindings} scoped candidates; ${visual.stressed.links.filter(link => link.insideViewport).length}/4 navigation links inside viewport`);
  }
  evidence.createdAt = new Date().toISOString();
  await writeFile(join(out, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(`Reports, source license, screenshots and evidence: ${out}`);
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
