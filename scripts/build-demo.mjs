// Regenerate the public example with the same scanner shipped in the package.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { scan } from '../src/browser.js';
import { renderReport } from '../src/report.js';
import { startDemo } from '../src/cli.js';

const output = fileURLToPath(new URL('../docs/', import.meta.url));
await mkdir(output, { recursive: true });
for (const fixed of [false, true]) {
  const server = await startDemo(fixed);
  try {
    const report = await scan({ url: server.url });
    if (report.cases.some(item => item.error)) throw new Error('Demo scan failed; refusing to publish an incomplete report.');
    report.title = `PageBend · ${fixed ? 'Fixed' : 'Fragile'} demo`;
    report.demo = { synthetic: true, fixed };
    report.url = `Included ${fixed ? 'fixed' : 'fragile'} demo (synthetic content)`;
    report.cases.forEach(item => { item.resolvedUrl = report.url; });
    let html = renderReport(report);
    const links = `<nav aria-label="Public demo links" class="public-demo-links"><a href="${fixed ? './' : './fixed.html'}">${fixed ? '← Fragile page' : 'See the repaired page →'}</a><a href="https://github.com/easonsong666666-design/pagebend#try-it" target="_blank" rel="noopener noreferrer">Get PageBend ↗</a></nav>`;
    html = html.replace('</header>', `${links}</header>`).replace('</style>', '.public-demo-links{display:flex;gap:14px;align-items:center;flex-wrap:wrap;font-size:12px;font-weight:600}.public-demo-links a{color:inherit;text-underline-offset:4px}.report-topbar{flex-wrap:wrap;gap:16px}</style>');
    await writeFile(join(output, fixed ? 'fixed.html' : 'index.html'), html);
    const evidence = { version: report.version, generatedAt: report.createdAt, browser: 'Playwright Chromium',
      demo: report.demo, summary: report.summary, durationMs: report.durationMs,
      scenarios: report.cases.map(item => ({ id: item.id, baselineCandidates: item.before.findings.length, candidates: item.findings.length, error: item.error || null })) };
    await writeFile(join(output, fixed ? 'fixed-evidence.json' : 'fragile-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
    console.log(`${fixed ? 'fixed' : 'fragile'}: ${report.summary.newFindings} new candidates, ${Math.round(report.durationMs / 1000)}s`);
  } finally { await server.close(); }
}
await writeFile(join(output, '.nojekyll'), '');
