import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, symlink, rename } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { cli, project, newRun, root } from './helpers.mjs';

const cliPath = path.join(root, 'scripts/break-it.mjs');
const secret = suffix => `local-test-${suffix}-0123456789`;
function mask(input, options = {}) {
  return spawnSync(process.execPath, [cliPath, 'mask'], {
    input, encoding: 'utf8', timeout: 15000, maxBuffer: 25 * 1024 * 1024, ...options
  });
}
function absent(output, values) {
  for (const value of values) assert.ok(!output.includes(value), 'whole synthetic value absent');
}

test('C01 scan refuses paths and malformed run ids', () => {
  for (const id of ['../outside', '/tmp/anything', 'not-a-run']) {
    const result = cli('scan', id);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /run id/i);
  }
});

test('C01 scan finds provider, private-key, JWT and generic assignment shapes without displaying values', async t => {
  const p = await project(t);
  const values = [
    '-----BEGIN PRIVATE KEY-----',
    `ghp_${'Q'.repeat(36)}`,
    `github_pat_${'R'.repeat(30)}`,
    `xoxb-${'1234567890'}-${'S'.repeat(24)}`,
    `AKIA${'T'.repeat(16)}`,
    `sk-${'U'.repeat(40)}`,
    `sk_live_${'V'.repeat(24)}`,
    `eyJ${'W'.repeat(12)}.eyJ${'X'.repeat(12)}.${'Y'.repeat(24)}`,
    secret('password'), secret('secret'), secret('token'), secret('api')
  ];
  const text = values.slice(1, 8).join('\n') + '\n' +
    ['password', 'secret', 'token', 'api_key'].map((key, i) => `${key} = "${values[i + 8]}"`).join('\n') +
    `\n${values[0]}`;
  await writeFile(path.join(p, 'config.txt'), text);
  const run = newRun(t, p);
  const result = cli('scan', run.id);
  assert.equal(result.status, 0, 'scan succeeds');
  absent(result.stdout + result.stderr, values);
  for (let line = 1; line <= 12; line++) {
    assert.ok(result.stdout.includes(`config.txt:${line}  `), `hit identifies line ${line}`);
  }
  assert.match(result.stdout, /…/);
  assert.match(result.stdout, /\(\d+ chars\)/);
});

test('C01 scan finds assignments in JSON, comments, minified assets and across whitespace', async t => {
  const p = await project(t);
  const values = ['json', 'comment', 'minified', 'multiline'].map(secret);
  await writeFile(path.join(p, 'config.json'), JSON.stringify({ api_key: values[0] }));
  await writeFile(path.join(p, 'notes.txt'), `// token = "${values[1]}"`);
  await writeFile(path.join(p, 'bundle.js'), `(()=>{const password="${values[2]}";return 1})()`);
  await writeFile(path.join(p, 'split.mjs'), `const secret =\n  "${values[3]}";`);
  const run = newRun(t, p);
  const result = cli('scan', run.id);
  assert.equal(result.status, 0, 'scan succeeds');
  absent(result.stdout + result.stderr, values);
  for (const file of ['config.json', 'notes.txt', 'bundle.js', 'split.mjs']) {
    assert.ok(result.stdout.includes(`${file}:`), `${file} detected`);
  }
});

test('C01 scan ignores documented placeholder values and the env-example safe control', async t => {
  const p = await project(t);
  const placeholders = ['', 'your-api-key-here', 'example', 'changeme', 'xxxxxxxxxxxxxxxx'];
  await writeFile(path.join(p, '.env.example'), placeholders.map(value => `API_KEY = "${value}"`).join('\n'));
  await writeFile(path.join(p, 'config.json'), JSON.stringify({ token: 'your-token-here' }));
  const run = newRun(t, p);
  const result = cli('scan', run.id);
  assert.equal(result.status, 0, 'scan succeeds');
  assert.match(result.stdout, /No secrets found/);
  assert.ok(!result.stdout.includes('.env.example:'), 'control is not flagged');
});

test('C01 scan skips git internals, binary files and oversized files, naming the size skip', async t => {
  const p = await project(t);
  const values = ['history', 'binary', 'oversize'].map(secret);
  await mkdir(path.join(p, '.git'));
  await writeFile(path.join(p, '.git', 'old.txt'), `token = "${values[0]}"`);
  await writeFile(path.join(p, 'image.bin'), Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(`secret = "${values[1]}"`)]));
  await writeFile(path.join(p, 'large.log'), `password = "${values[2]}"\n` + 'a'.repeat(25 * 1024 * 1024));
  const run = newRun(t, p);
  const result = cli('scan', run.id);
  assert.equal(result.status, 0, 'scan succeeds');
  absent(result.stdout + result.stderr, values);
  assert.ok(!result.stdout.includes('.git/old.txt:'), 'git files are not scanned');
  assert.ok(!result.stdout.includes('image.bin:'), 'binary file is not scanned');
  assert.match(result.stdout + result.stderr, /large\.log/);
  assert.match(result.stdout + result.stderr, /skip[^\n]*(?:size|MiB|large)|(?:size|MiB|large)[^\n]*skip/i);
});

test('C01 scan accepts a file exactly one MiB and does not scan original-source changes', async t => {
  const p = await project(t);
  const value = secret('at-cap');
  const head = `api_key = "${value}"\n`;
  await writeFile(path.join(p, 'exact.txt'), head + ' '.repeat(1024 * 1024 - Buffer.byteLength(head)));
  const run = newRun(t, p);
  const originalOnly = secret('source-only');
  await writeFile(path.join(p, 'source-only.txt'), `token = "${originalOnly}"`);
  const result = cli('scan', run.id);
  assert.equal(result.status, 0, 'scan succeeds');
  assert.ok(result.stdout.includes('exact.txt:1  '), 'exact-cap file is scanned');
  assert.ok(!result.stdout.includes('source-only.txt'), 'source tree is not scanned');
  absent(result.stdout + result.stderr, [value, originalOnly]);
});

test('C01 scan never follows a copy symlink to an outside file', async t => {
  const p = await project(t);
  const outside = await project(t);
  const value = secret('outside-link');
  await writeFile(path.join(outside, 'private.txt'), `token = "${value}"`);
  const run = newRun(t, p);
  await symlink(path.join(outside, 'private.txt'), path.join(run.copy, 'external.txt'));
  const result = cli('scan', run.id);
  absent(result.stdout + result.stderr, [value]);
  assert.ok(!/external\.txt:\d+  /.test(result.stdout), 'outside symlink is not scanned');
});

test('C01 scan refuses a redirected copy root', async t => {
  const p = await project(t);
  const outside = await project(t);
  const value = secret('outside-root');
  await writeFile(path.join(outside, 'private.txt'), `token = "${value}"`);
  const run = newRun(t, p);
  await rename(run.copy, path.join(run.dir, 'original-copy'));
  await symlink(outside, run.copy);
  const result = cli('scan', run.id);
  assert.notEqual(result.status, 0);
  absent(result.stdout + result.stderr, [value]);
});

test('C05 a second scan finds a synthetic credential written to a log after the tries', async t => {
  const p = await project(t);
  const run = newRun(t, p);
  assert.match(cli('scan', run.id).stdout, /No secrets found/);
  const value = secret('sent-password');
  await mkdir(path.join(run.copy, 'logs'));
  await writeFile(path.join(run.copy, 'logs', 'requests.log'), `password = "${value}"\n`);
  const result = cli('scan', run.id);
  assert.equal(result.status, 0, 'scan succeeds');
  assert.ok(result.stdout.includes('logs/requests.log:1  '), 'post-try log is inspected');
  absent(result.stdout + result.stderr, [value]);
});

test('mask only prints masked hits and nearest git commit/file metadata', () => {
  const values = [secret('history-one'), secret('history-two')];
  const input = `commit 1234567890abcdef\nAuthor: never-print-this-author\n\n` +
    `    never-print-this-message\ndiff --git a/config.mjs b/config.mjs\n+++ b/config.mjs\n` +
    `@@ -1 +1 @@\n+const API_KEY = "${values[0]}"; // never-print-this-comment\n` +
    `commit abcdef0123456789\n+++ b/logs.txt\n+token = "${values[1]}"\n`;
  const result = mask(input);
  assert.equal(result.status, 0, 'mask succeeds');
  absent(result.stdout + result.stderr, [...values, 'never-print-this-author', 'never-print-this-message', 'never-print-this-comment', '@@ -1 +1 @@']);
  const lines = result.stdout.trim().split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^commit 1234567  config\.mjs:1  .+  .+ \(\d+ chars\)$/);
  assert.match(lines[1], /^commit abcdef0  logs\.txt  .+  .+ \(\d+ chars\)$/);
});

test('mask prints nothing for text without hits', () => {
  const result = mask('Arbitrary context that must never be printed\n');
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
});

test('mask tracks added, removed and unchanged source lines through git hunks', () => {
  const values = ['removed-line', 'added-line', 'context-line', 'next-hunk'].map(secret);
  const input = `commit 1234567890abcdef\ndiff --git a/config.mjs b/config.mjs\n` +
    `--- a/config.mjs\n+++ b/config.mjs\n@@ -5,3 +8,3 @@\n unchanged\n` +
    `-token = "${values[0]}"\n+token = "${values[1]}"\n secret = "${values[2]}"\n` +
    `@@ -40 +50 @@\n+api_key = "${values[3]}"\n`;
  const result = mask(input);
  assert.equal(result.status, 0, 'mask succeeds');
  absent(result.stdout + result.stderr, values);
  const lines = result.stdout.trim().split('\n');
  assert.equal(lines.length, 4);
  for (const [index, line] of [6, 9, 10, 50].entries()) {
    assert.ok(lines[index].startsWith(`commit 1234567  config.mjs:${line}  `), `historical line ${line}`);
  }
});

test('mask keeps a multiline private-key block and surrounding input hidden', () => {
  const body = 'SYNTHETIC-PRIVATE-KEY-BODY-NEVER-DISPLAY';
  const block = `-----BEGIN RSA PRIVATE KEY-----\n${body}\n-----END RSA PRIVATE KEY-----`;
  const result = mask(`private surrounding text\n${block}\nprivate following text\n`);
  assert.equal(result.status, 0, 'mask succeeds');
  absent(result.stdout + result.stderr, [block, body, 'private surrounding text', 'private following text']);
  assert.equal(result.stdout.trim().split('\n').length, 1);
  assert.match(result.stdout, /private key/i);
  assert.match(result.stdout, /\(\d+ chars\)/);
});

test('mask stops at twenty MiB and does not print later input or context', () => {
  const lateValue = secret('beyond-limit');
  const result = mask(' '.repeat(20 * 1024 * 1024) + `\ntoken = "${lateValue}"\nprivate trailing context`);
  assert.equal(result.status, 0, 'bounded masking succeeds with a plain cap note');
  absent(result.stdout + result.stderr, [lateValue, 'private trailing context']);
  assert.match(result.stdout + result.stderr, /20\s*MiB|20971520|20 MiB/i);
});

test('mask stops at the exact cap even when stdin remains open', async t => {
  const child = spawn(process.execPath, [cliPath, 'mask'], { stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let output = '';
  let errors = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { errors += chunk; });
  child.stdin.on('error', () => {});
  const exited = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('mask waited for EOF after reaching the stdin cap')); }, 5000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); resolve(code); });
  });
  child.stdin.write(Buffer.alloc(20 * 1024 * 1024, ' '));
  // Deliberately leave stdin open; the bounded consumer must stop by itself.
  assert.equal(await exited, 0, 'mask exits at the cap');
  assert.match(output + errors, /20 MiB/);
  assert.ok((output + errors).length < 200, 'only a short cap note is displayed');
});

test('maskValue hides all values of eight characters or fewer', async () => {
  const { maskValue } = await import('../scripts/lib/leaks.mjs');
  for (const value of ['', 'abc', '12345678']) {
    assert.equal(maskValue(value), `•••• (${value.length} chars)`);
  }
  assert.equal(maskValue('123456789'), '123…6789 (9 chars)');
});

const gitAvailable = spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;
test('C02 git history reaches mask after the secret was removed from current files', { skip: !gitAvailable && 'git is not on PATH; history end-to-end test skipped' }, async t => {
  const p = await project(t);
  function git(...args) {
    const result = spawnSync('git', ['-C', p, ...args], { encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0, 'throwaway git command succeeds');
    return result.stdout;
  }
  git('init', '--quiet');
  const value = secret('removed-commit');
  await writeFile(path.join(p, 'config.mjs'), `const API_KEY = "${value}";\n`);
  git('add', 'config.mjs');
  git('-c', 'user.name=Local Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'Synthetic configuration');
  const first = git('rev-parse', 'HEAD').trim().slice(0, 7);
  await writeFile(path.join(p, 'config.mjs'), 'const API_KEY = "";\n');
  git('add', 'config.mjs');
  git('-c', 'user.name=Local Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'Remove synthetic configuration');
  const run = newRun(t, p);
  assert.match(cli('scan', run.id).stdout, /No secrets found/);
  const history = spawnSync('git', ['-C', run.copy, 'log', '-p', '--all', '--no-color'], { encoding: 'utf8' });
  assert.equal(history.status, 0, 'copy history can be read');
  const result = mask(history.stdout);
  assert.equal(result.status, 0, 'history masking succeeds');
  assert.ok(result.stdout.includes(`commit ${first}  config.mjs:1  `), 'original commit/file/line are identified');
  absent(result.stdout + result.stderr, [value, 'Author:', 'Synthetic configuration', 'Remove synthetic configuration']);
});
