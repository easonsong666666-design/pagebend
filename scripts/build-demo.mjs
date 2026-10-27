// Regenerate the public example with the same scanner shipped in the package.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { scan } from '../src/browser.js';
import { renderReport } from '../src/report.js';
import { startDemo } from '../src/cli.js';

const output = fileURLToPath(new URL('../docs/', import.meta.url));
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) throw new Error('A valid release version is required for the public demo install command.');
const releaseUrl = `https://github.com/easonsong666666-design/pagebend/releases/download/v${version}/pagebend-${version}.tgz`;
const quickstart = `npx --yes ${releaseUrl} demo --setup --open`;
const publicStyles = `
.public-demo-context{margin:22px 0 0;padding:18px 20px;border:1px solid #d8ddd0;border-left:3px solid var(--orange);border-radius:8px;background:#fffef8}
.public-demo-kicker{margin:0 0 8px;font-size:9px;font-weight:650;letter-spacing:1.5px;color:var(--orange)}
.public-demo-context h2{font-size:16px;letter-spacing:-.3px;margin:0 0 7px}
.public-demo-copy{margin:0;max-width:780px;font-size:11px;line-height:1.7;color:#68705e}
.public-demo-links{display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-top:12px;font-size:11px;font-weight:600}
.public-demo-links a{color:inherit;text-underline-offset:4px}
.public-demo-install{margin-top:14px;padding-top:12px;border-top:1px solid var(--line)}
.public-demo-install summary{cursor:pointer;font-size:11px;font-weight:600;line-height:1.6}
.public-demo-install pre{margin:12px 0 8px;padding:13px 14px;border:1px solid #dde1d4;border-radius:5px;background:#eef1e7;white-space:pre-wrap;overflow-wrap:anywhere;user-select:all;font:11px/1.65 ui-monospace,SFMono-Regular,Consolas,monospace;color:#303c27}
.public-demo-install p{font-size:10px;color:#737c66;line-height:1.6;margin:0}
.public-demo-install summary:focus-visible,.public-demo-install pre:focus-visible{outline:3px solid #f59c6c;outline-offset:4px}
@media(max-width:480px){.public-demo-context{padding:16px 14px}.public-demo-context h2{font-size:15px}.public-demo-copy{font-size:10px}.public-demo-install pre{font-size:10px}}
`;
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
    const context = `<section class="public-demo-context" aria-labelledby="public-demo-title">
      <p class="public-demo-kicker">RECORDED EXAMPLE · ${fixed ? 'REPAIRED' : 'FRAGILE'} PAGE</p>
      <h2 id="public-demo-title">Explore a real PageBend report.</h2>
      <p class="public-demo-copy">This is a saved scan of our sample page, not an online scanner. Switch profiles and inspect the before-and-after screenshots below.</p>
      <nav aria-label="Public demo links" class="public-demo-links"><a href="${fixed ? './' : './fixed.html'}">${fixed ? '← Compare the fragile page' : 'Compare the repaired page →'}</a><a href="https://github.com/easonsong666666-design/pagebend" target="_blank" rel="noopener noreferrer">GitHub source ↗</a></nav>
      <details class="public-demo-install"><summary>Run it on your machine · Node.js 20+</summary>
        <pre tabindex="0" aria-label="PageBend quickstart command"><code>${quickstart}</code></pre>
        <p>No account or global install. Downloads the matching Chromium browser if needed, then opens your local report.</p>
      </details>
    </section>`;
    html = html.replace('</header>', `</header>${context}`).replace('</style>', `${publicStyles}</style>`);
    await writeFile(join(output, fixed ? 'fixed.html' : 'index.html'), html);
    const evidence = { version: report.version, generatedAt: report.createdAt, browser: 'Playwright Chromium',
      demo: report.demo, summary: report.summary, durationMs: report.durationMs,
      scenarios: report.cases.map(item => ({ id: item.id, baselineCandidates: item.before.findings.length, candidates: item.findings.length, error: item.error || null })) };
    await writeFile(join(output, fixed ? 'fixed-evidence.json' : 'fragile-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
    console.log(`${fixed ? 'fixed' : 'fragile'}: ${report.summary.newFindings} new candidates, ${Math.round(report.durationMs / 1000)}s`);
  } finally { await server.close(); }
}
await writeFile(join(output, '.nojekyll'), '');
