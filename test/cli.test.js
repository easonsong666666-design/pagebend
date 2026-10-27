import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseOptions, main } from '../src/cli.js';

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
  assert.equal(output[1], '0.1.0');
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
