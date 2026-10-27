import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, mkdir, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { parseOptions, main } from '../src/cli.js';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('CLI rejects unsafe protocols, invalid numeric options and unknown profiles before opening a browser', () => {
  for (const args of [
    ['file:///etc/passwd'], ['javascript:alert(1)'], ['http://username:password@localhost/'],
    ['http://localhost', '--width', 'NaN'], ['http://localhost', '--width', '0'],
    ['http://localhost', '--wait', '-1'], ['http://localhost', '--profiles', ''],
    ['http://localhost', '--profiles', 'does-not-exist'], ['http://localhost', '--fail-on', 'whatever'],
    ['http://localhost', '--fixed'], ['http://localhost', 'http://example.com'], ['scan']
  ]) assert.throws(() => parseOptions(args), undefined, args.join(' '));
});

test('CLI preserves quoted CSS selectors, explicit zero wait, auth paths and profile ordering', () => {
  const options = parseOptions(['http://localhost:3000/path?token=private', '--ignore', '.carousel > div',
    '--ignore', '[aria-hidden="true"]', '--wait', '0', '--scope', '#app', '--storage-state', './session.json',
    '--profiles', 'text-zoom,narrow,text-zoom', '--fail-on', 'new']);
  assert.equal(options.url, 'http://localhost:3000/path?token=private');
  assert.deepEqual(options.ignore, ['.carousel > div', '[aria-hidden="true"]']);
  assert.deepEqual(options.profiles, ['text-zoom', 'narrow']);
  assert.equal(options.wait, 0);
  assert.equal(options.scope, '#app');
  assert.equal(options.failOn, 'new');
  assert.ok(options.storageState.endsWith('session.json'));
});

test('help and version work without launching a browser', async () => {
  const output = [];
  const io = { out: value => output.push(value), error: value => assert.fail(value) };
  assert.equal(await main(['--help'], io), 0);
  assert.equal(await main(['--version'], io), 0);
  assert.match(output[0], /install-browser/);
  assert.match(output[0], /--setup/);
  assert.equal(output[1], pkg.version);
});

test('existing output is preserved unless explicitly replaced', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pagebend-cli-'));
  try {
    await writeFile(join(dir, 'report.html'), 'previous report');
    const errors = [];
    const code = await main(['http://127.0.0.1:1', '--out', dir], { out() {}, error: value => errors.push(value) });
    assert.equal(code, 2);
    assert.match(errors.join('\n'), /not empty/);
    assert.equal(await readFile(join(dir, 'report.html'), 'utf8'), 'previous report');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('setup is explicit and cannot be mixed with a different browser selection', () => {
  assert.equal(parseOptions(['demo']).setup, false);
  assert.equal(parseOptions(['demo', '--setup']).setup, true);
  assert.equal(parseOptions(['scan', 'http://localhost:3000', '--setup']).setup, true);
  assert.equal(parseOptions(['http://localhost:3000', '--setup']).setup, true);
  for (const args of [
    ['demo', '--setup', '--channel', 'chrome'],
    ['http://localhost:3000', '--setup', '--browser-path', './chrome'],
    ['demo', '--setup', '--channel', ''],
    ['install-browser', '--setup']
  ]) assert.throws(() => parseOptions(args), /--setup/, args.join(' '));
});

test('setup validates arguments and output before invoking the browser installer', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pagebend-setup-preflight-'));
  let installs = 0;
  const installer = async () => { installs++; return 0; };
  try {
    const previous = join(dir, 'report.html');
    await writeFile(previous, 'keep this report');
    for (const args of [
      ['demo', '--setup', '--out', dir],
      ['demo', '--setup', '--out', previous],
      ['demo', '--setup', '--profiles', 'unknown', '--out', join(dir, 'new')],
      ['file:///not-a-page', '--setup', '--out', join(dir, 'new')],
      ['demo', '--setup', '--channel', 'chrome', '--out', join(dir, 'new')]
    ]) {
      const errors = [];
      assert.equal(await main(args, { out() {}, error: message => errors.push(message) }, installer), 2);
      assert.ok(errors.length, 'preflight must explain why it refused the command');
    }
    assert.equal(installs, 0, 'no download should happen for an invalid command or output');
    assert.equal(await readFile(previous, 'utf8'), 'keep this report');
    assert.deepEqual(await readdir(dir), ['report.html']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a failed setup returns 2 without creating or replacing report files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pagebend-setup-failure-'));
  try {
    const existing = join(dir, 'existing');
    await mkdir(existing);
    await writeFile(join(existing, 'report.html'), 'previous HTML');
    await writeFile(join(existing, 'report.json'), 'previous JSON');
    const cases = [
      { output: join(dir, 'new-report'), installer: async () => 2 },
      { output: existing, installer: async () => { throw new Error('spawn denied'); } }
    ];
    for (const { output, installer } of cases) {
      const messages = [];
      const errors = [];
      const code = await main(['demo', '--setup', '--force', '--out', output], {
        out: message => messages.push(message), error: message => errors.push(message)
      }, installer);
      assert.equal(code, 2);
      assert.match(messages.join('\n'), /Setting up.*Chromium/);
      assert.match(errors.join('\n'), /Chromium setup failed/);
      assert.match(errors.join('\n'), /No report was written/);
      assert.ok(!messages.some(message => message.includes('Starting the scan')));
    }
    await assert.rejects(access(join(dir, 'new-report')), { code: 'ENOENT' });
    assert.equal(await readFile(join(existing, 'report.html'), 'utf8'), 'previous HTML');
    assert.equal(await readFile(join(existing, 'report.json'), 'utf8'), 'previous JSON');
    assert.deepEqual((await readdir(existing)).sort(), ['report.html', 'report.json']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('missing Chromium never downloads by default and gives npx-compatible setup advice', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pagebend-no-browser-'));
  const cache = join(dir, 'empty-cache');
  const output = join(dir, 'report');
  try {
    await mkdir(cache);
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../bin/pagebend.js', import.meta.url)),
      'demo', '--profiles', 'narrow', '--quiet', '--out', output], {
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: cache }, encoding: 'utf8', timeout: 15000
    });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Chromium is not installed/);
    assert.match(result.stderr, /same command with --setup/);
    assert.match(result.stderr, /--channel chrome/);
    assert.doesNotMatch(result.stderr, /npx playwright install|browserType\.launch|╔|pagebend install-browser/);
    assert.deepEqual(await readdir(cache), [], 'default invocation must not populate a browser cache');
    await assert.rejects(access(output), { code: 'ENOENT' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('explicit setup reuses cached Chromium and completes a real demo scan', async (t) => {
  try { await access(chromium.executablePath()); }
  catch { t.skip('Matching Chromium is not cached. CI installs it before running browser tests.'); return; }
  const dir = await mkdtemp(join(tmpdir(), 'pagebend-setup-demo-'));
  const messages = [];
  const errors = [];
  try {
    const code = await main(['demo', '--fixed', '--setup', '--profiles', 'narrow', '--wait', '0', '--out', dir], {
      out: message => messages.push(message), error: message => errors.push(message)
    });
    assert.equal(code, 0, errors.join('\n'));
    assert.deepEqual(errors, []);
    const ready = messages.findIndex(message => message.includes('Chromium is ready'));
    const scanned = messages.findIndex(message => message.includes('narrow') && message.includes('candidates'));
    assert.ok(ready >= 0 && scanned > ready, 'the scan must run after successful setup');
    const report = JSON.parse(await readFile(join(dir, 'report.json'), 'utf8'));
    assert.equal(report.cases.length, 1);
    assert.equal(report.cases[0].id, 'narrow');
    assert.equal(report.cases[0].error, undefined);
    assert.match(report.cases[0].after.image, /^data:image\/png;base64,/);
    assert.equal(report.summary.newFindings, 0);
    assert.match(await readFile(join(dir, 'report.html'), 'utf8'), /<!doctype html>/i);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
