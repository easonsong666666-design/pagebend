import { parseArgs } from 'node:util';
import { readFile, mkdir, readdir, writeFile, rename, rm } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const profileIds = ['long-text', 'unbroken', 'text-zoom', 'rtl', 'missing-images', 'narrow'];
const help = `
  PageBend ${pkg.version} — beautiful with demo data. What about real life?

  pagebend <url> [options]      Stress-test one real page
  pagebend demo [--fixed]      Try the included page through the same engine
  pagebend install-browser    Install the matching Chromium browser (once)

  --out <directory>           Output folder (default: pagebend-report)
  --profiles <list>           Comma-separated: ${profileIds.join(', ')}
  --width <px>                Starting viewport width (default: 1280)
  --height <px>               Viewport height (default: 900)
  --wait <ms>                 Settle time after load/mutation (default: 300)
  --wait-for <selector>       Wait for a visible element before testing
  --timeout <ms>              Navigation/selector timeout (default: 30000)
  --scope <selector>          Only mutate and inspect this part of the page
  --ignore <selector>         Ignore matching subtrees (repeatable)
  --storage-state <file>      Playwright auth state, read locally only
  --channel <name>            Use an installed browser, e.g. chrome or msedge
  --browser-path <file>       Explicit Chromium executable path
  --fail-on <new|any|none>     CI exit 1 for candidates (default: none)
  --force                    Replace report.html/report.json in output folder
  --open                     Open the finished report in your browser
  --quiet                    Only print errors
  --help, -h                 Show this help
  --version, -v              Show version

  Examples:
    pagebend demo --open
    pagebend http://localhost:3000 --profiles long-text,text-zoom,narrow
    pagebend http://localhost:3000 --ignore '[data-pagebend-ignore]' --fail-on new

  Reports include page screenshots and visible text. Review before sharing.
  Geometry findings are review candidates, not a quality or accessibility score.
`;

function numberOption(value, fallback, name, min, max) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`--${name} must be an integer between ${min} and ${max}.`);
  const n = Number(value);
  if (n < min || n > max) throw new Error(`--${name} must be between ${min} and ${max}.`);
  return n;
}

export function parseOptions(args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: {
    help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
    out: { type: 'string' }, profiles: { type: 'string' }, width: { type: 'string' }, height: { type: 'string' },
    wait: { type: 'string' }, timeout: { type: 'string' }, 'wait-for': { type: 'string' }, scope: { type: 'string' },
    ignore: { type: 'string', multiple: true }, 'storage-state': { type: 'string' }, channel: { type: 'string' },
    'browser-path': { type: 'string' }, 'fail-on': { type: 'string' }, force: { type: 'boolean' },
    open: { type: 'boolean' }, quiet: { type: 'boolean' }, fixed: { type: 'boolean' }
  }});
  if (values.help || args.length === 0) return { command: 'help' };
  if (values.version) return { command: 'version' };
  let command = positionals[0];
  let url;
  if (command === 'scan') {
    url = positionals[1];
    if (positionals.length > 2) throw new Error('Only one URL can be scanned at a time.');
  } else if (command !== 'demo' && command !== 'install-browser') {
    url = command;
    command = 'scan';
    if (positionals.length > 1) throw new Error('Only one URL can be scanned at a time.');
  } else if (positionals.length > 1) throw new Error(`Unexpected argument: ${positionals[1]}`);
  if (command === 'install-browser') return { command };
  if (command === 'scan') {
    let parsed;
    try { parsed = new URL(url); } catch { throw new Error('Provide an http:// or https:// URL, or use "pagebend demo".'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only http:// and https:// pages are supported.');
    if (parsed.username || parsed.password) throw new Error('URL credentials are not supported. Use --storage-state for authenticated pages.');
    url = parsed.href;
  }
  if (values.fixed && command !== 'demo') throw new Error('--fixed is only available with "pagebend demo".');
  const profiles = values.profiles === undefined ? profileIds : [...new Set(values.profiles.split(',').map(x => x.trim()))];
  if (!profiles.length || profiles.some(x => !profileIds.includes(x))) throw new Error(`Unknown profile. Choose from: ${profileIds.join(', ')}`);
  const failOn = values['fail-on'] || 'none';
  if (!['new', 'any', 'none'].includes(failOn)) throw new Error('--fail-on must be new, any, or none.');
  return { command, url, fixed: !!values.fixed, output: resolve(values.out || 'pagebend-report'), force: !!values.force,
    open: !!values.open, quiet: !!values.quiet, failOn, profiles,
    width: numberOption(values.width, 1280, 'width', 240, 3840),
    height: numberOption(values.height, 900, 'height', 240, 2160),
    wait: numberOption(values.wait, 300, 'wait', 0, 30000),
    timeout: numberOption(values.timeout, 30000, 'timeout', 100, 120000),
    waitFor: values['wait-for'], scope: values.scope, ignore: values.ignore || [],
    storageState: values['storage-state'] ? resolve(values['storage-state']) : undefined,
    channel: values.channel, executablePath: values['browser-path'] ? resolve(values['browser-path']) : undefined
  };
}

export async function startDemo(fixed = false) {
  const html = await readFile(join(root, 'demo', fixed ? 'fixed.html' : 'index.html'));
  const server = createServer((request, response) => {
    if (request.url !== '/' && request.url !== '/index.html') {
      response.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(html);
  });
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise((res, rej) => {
    server.close(error => error ? rej(error) : res()); server.closeAllConnections();
  }) };
}

async function checkOutput(directory, force) {
  try {
    const files = await readdir(directory);
    if (files.length && !force) throw new Error(`Output directory is not empty: ${directory}\nChoose a new --out folder or use --force to replace its report files.`);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

async function atomicWrite(path, content) {
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  try { await writeFile(temp, content, { mode: 0o600, flag: 'wx' }); await rename(temp, path); }
  finally { await rm(temp, { force: true }); }
}

function openFile(file) {
  const [command, args] = process.platform === 'darwin' ? ['open', [file]]
    : process.platform === 'win32' ? ['rundll32.exe', ['url.dll,FileProtocolHandler', file]] : ['xdg-open', [file]];
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolvePromise() : reject(new Error(`Browser opener exited with ${code}`)));
  });
}

async function installBrowser() {
  const require = createRequire(import.meta.url);
  const cli = join(dirname(require.resolve('playwright/package.json')), 'cli.js');
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [cli, 'install', 'chromium', '--no-shell'], { stdio: 'inherit' });
    child.once('error', reject); child.once('exit', code => resolvePromise(code === 0 ? 0 : 2));
  });
}

export async function main(args, io = { out: console.log, error: console.error }) {
  let demo;
  try {
    const options = parseOptions(args);
    if (options.command === 'help') { io.out(help); return 0; }
    if (options.command === 'version') { io.out(pkg.version); return 0; }
    if (options.command === 'install-browser') return await installBrowser();
    await checkOutput(options.output, options.force);
    if (options.command === 'demo') {
      demo = await startDemo(options.fixed);
      options.url = demo.url;
    }
    const [{ scan }, { renderReport }] = await Promise.all([import('./browser.js'), import('./report.js')]);
    if (!options.quiet) io.out(`\n  PageBend · ${options.command === 'demo' ? `included ${options.fixed ? 'fixed' : 'fragile'} demo` : new URL(options.url).origin}\n  ${options.profiles.length} scenarios · real browser · local report\n`);
    const report = await scan({ ...options, onProgress: event => {
      if (options.quiet) return;
      if (typeof event === 'string') io.out(`  ${event}`);
      else if (event?.message) io.out(`  ${event.message}`);
      else if (event?.phase === 'complete') io.out(`  ${event.error ? '!' : '✓'} ${event.profile}${event.error ? ' · failed (see report)' : ` · ${event.findings} candidates`}`);
    }});
    if (options.command === 'demo') {
      report.title = `PageBend · ${options.fixed ? 'Fixed' : 'Fragile'} demo`;
      report.demo = { synthetic: true, fixed: options.fixed };
      report.url = `Included ${options.fixed ? 'fixed' : 'fragile'} demo (synthetic content)`;
    }
    await mkdir(options.output, { recursive: true });
    await atomicWrite(join(options.output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    await atomicWrite(join(options.output, 'report.html'), renderReport(report));
    const errors = report.cases.filter(item => item.error).length;
    if (!options.quiet) io.out(`\n  ${report.summary.newFindings} new candidates · ${report.summary.existingFindings} existing · ${errors} failed scenarios\n  Report: ${join(options.output, 'report.html')}\n  JSON:   ${join(options.output, 'report.json')}\n`);
    if (options.open) {
      try { await openFile(join(options.output, 'report.html')); }
      catch { io.error('The report was saved, but the browser could not be opened. Open report.html manually.'); }
    }
    if (errors) return 2;
    const count = report.summary.newFindings + (options.failOn === 'any' ? report.summary.existingFindings : 0);
    return options.failOn !== 'none' && count > 0 ? 1 : 0;
  } catch (error) {
    let message = error?.message || String(error);
    // Do not echo authenticated URL queries in navigation error output.
    message = message.replace(/https?:\/\/[^\s"'<>]+/g, value => {
      try { const url = new URL(value); url.username = ''; url.password = ''; url.search = ''; url.hash = ''; return url.href; } catch { return '[URL]'; }
    });
    io.error(`PageBend: ${message}`);
    if (/Executable doesn't exist|browserType\.launch|browser.*not found/i.test(message)) io.error('Run "pagebend install-browser" once, or use "--channel chrome" for an installed Chrome.');
    return 2;
  } finally { if (demo) await demo.close(); }
}
