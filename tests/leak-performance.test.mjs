import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { cli, project, newRun, root } from './helpers.mjs';

const moduleUrl = new URL('../scripts/lib/leaks.mjs', import.meta.url).href;
const cliPath = path.join(root, 'scripts/break-it.mjs');
const value = 'local-performance-VALUE-123456';

function timedFind(mode, timeout = 3500) {
  const program = `
    import { performance } from 'node:perf_hooks';
    import { findSecrets, maskValue } from ${JSON.stringify(moduleUrl)};
    const mode = process.argv[1];
    const size = 1024 * 1024;
    const seed = Buffer.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789').toString('base64');
    const nestedQuoted = '+token=\\\\"';
    const listRecord = '{"password":["a","b"],"label":"ordinary-setting"},';
    const listPrefix = '"password":['.repeat(64);
    const deepRecord = '"password":[null],';
    const input = mode === 'base64' ? seed.repeat(Math.ceil(size / seed.length)).slice(0, size)
      : mode === 'minified-lists' ? listRecord.repeat(Math.floor(size / listRecord.length)).padEnd(size, ' ')
      : mode === 'unclosed-lists' ? (listPrefix + deepRecord.repeat(Math.floor((size - listPrefix.length) / deepRecord.length))).padEnd(size, ' ')
      : mode === 'sibling-parents' ? Array.from({ length: 2000 }, (_, i) => 'password={child:{value:"sibling-SYNTHETIC-' + i.toString().padStart(4, '0') + '-0123456789",note:"' + 'ordinary words '.repeat(29) + '"}}').join('\\n').padEnd(size, ' ').slice(0, size)
      : mode === 'deep-parent' ? 'password={' + 'child:{'.repeat(63) + 'value:"${value}",note:"' + ' '.repeat(size - ('password={' + 'child:{'.repeat(63) + 'value:"${value}",note:"' + '"' + '}'.repeat(64)).length) + '"' + '}'.repeat(64)
      : mode === 'dotted' ? 'a.b.c.d.'.repeat(Math.ceil(size / 8)).slice(0, size)
      : mode === 'after' ? 'a'.repeat(500000) + ' token="${value}"'
      : mode === 'nested' ? 'token=+'.repeat(Math.ceil(size / 7))
      : mode === 'whitespace' ? 'token' + ' '.repeat(size) + '=plain-VALUE-1234567'
      : mode === 'punctuation' ? 'token="' + ','.repeat(size) + 'Q"'
      : mode === 'jwt-no-dots' ? 'eyJABCDE-'.repeat(Math.ceil(size / 9))
      : mode === 'jwt-one-dot' ? 'eyJABCDE-'.repeat(Math.ceil(size / 9)) + '.ABCDEFGH'
      : mode === 'escaped-nested' ? 'token="' + nestedQuoted.repeat(Math.ceil(size / nestedQuoted.length)) + '\\n'
      : mode === 'env-reads' ? 'token=process.env.TOKEN;'.repeat(Math.ceil(size / 24))
      : mode === 'env-reads-comma-tail' ? 'token=process.env.TOKEN;'.repeat(Math.ceil(size / 48)) + ','.repeat(size / 2)
      : mode === 'function-reads' ? 'token=getToken();'.repeat(Math.ceil(size / 17))
      : mode === 'jwt-prefix-hyphen' ? 'outside-eyJABCDE-AB.ABCDEFGH.ABCDEFGH'
      : 'a'.repeat(size);
    const start = performance.now();
    const hits = findSecrets(input);
    const elapsed = performance.now() - start;
    console.log(JSON.stringify({ elapsed, hits: hits.map(hit => ({
      line: hit.line, index: hit.index, masked: maskValue(hit.value)
    })) }));
  `;
  return spawnSync(process.execPath, ['--input-type=module', '-e', program, mode], {
    encoding: 'utf8', timeout, maxBuffer: 1024 * 1024
  });
}

for (const mode of ['letters', 'base64', 'dotted']) {
  test(`N1 one MiB of ${mode} passes through findSecrets in under two seconds`, t => {
    const result = timedFind(mode);
    assert.ok(!result.error, 'bounded child finishes instead of hanging');
    assert.equal(result.status, 0, 'timing child exits successfully');
    const observed = JSON.parse(result.stdout);
    t.diagnostic(`${mode}: ${observed.elapsed.toFixed(2)} ms for one MiB`);
    assert.ok(observed.elapsed < 2000, 'one MiB matching stays below two seconds');
    assert.equal(observed.hits.length, 0, 'long run contains no credential assignment');
  });
}

for (const mode of ['nested', 'whitespace', 'punctuation', 'jwt-no-dots', 'jwt-one-dot', 'escaped-nested',
  'env-reads', 'env-reads-comma-tail', 'function-reads']) {
  test(`N1 one MiB ${mode} regex stress stays below two seconds`, t => {
    const result = timedFind(mode, 2500);
    assert.ok(!result.error, 'bounded stress child finishes instead of hanging');
    assert.equal(result.status, 0, 'stress child exits successfully');
    const observed = JSON.parse(result.stdout);
    t.diagnostic(`${mode}: ${observed.elapsed.toFixed(2)} ms for one MiB`);
    assert.ok(observed.elapsed < 2000, 'all matching stages stay within the time budget');
    if (mode === 'nested' || mode === 'whitespace' || mode === 'punctuation') {
      assert.equal(observed.hits.length, 1, 'one held value is processed once');
    } else if (mode.startsWith('jwt-') || mode.includes('reads')) {
      assert.equal(observed.hits.length, 0, 'malformed values and ignored reads have no held credential');
    }
  });
}

for (const [mode, count] of [['sibling-parents', 2000], ['deep-parent', 1]]) {
  test(`nested parents one MiB ${mode} stays below two seconds`, t => {
    const result = timedFind(mode, 3500);
    assert.ok(!result.error, 'bounded child finishes without hanging');
    assert.equal(result.status, 0, 'nested matching child exits successfully');
    const observed = JSON.parse(result.stdout);
    t.diagnostic(`${mode}: ${observed.elapsed.toFixed(2)} ms for one MiB`);
    assert.ok(observed.elapsed < 2000, 'each character is examined a bounded number of times');
    assert.equal(observed.hits.length, count, 'every inherited value is found once');
  });
}

for (const mode of ['minified-lists', 'unclosed-lists']) {
  test(`list values one MiB ${mode} stays below two seconds without rescanning`, t => {
    const result = timedFind(mode, 3500);
    assert.ok(!result.error, 'bounded list child finishes without hanging');
    assert.equal(result.status, 0, 'list matching child exits successfully');
    const observed = JSON.parse(result.stdout);
    t.diagnostic(`${mode}: ${observed.elapsed.toFixed(2)} ms for one MiB`);
    assert.ok(observed.elapsed < 2000, 'list containers are each walked at most once');
    assert.equal(observed.hits.length, 0, 'short elements and null do not become credential findings');
  });
}

test('N1 valid JWT prefixes following hyphens retain their previous recognition', () => {
  const result = timedFind('jwt-prefix-hyphen');
  assert.ok(!result.error, 'bounded JWT child finishes');
  assert.equal(result.status, 0, 'JWT child succeeds');
  const observed = JSON.parse(result.stdout);
  assert.equal(observed.hits.length, 1, 'hyphen-adjacent JWT prefix remains recognized');
  assert.equal(observed.hits[0].masked, 'eyJ…EFGH (29 chars)');
});

test('N1 a credential after a 500000-character run is found and masked on the same line', t => {
  const result = timedFind('after');
  assert.ok(!result.error, 'bounded child finishes instead of hanging');
  assert.equal(result.status, 0, 'matching child exits successfully');
  assert.ok(!(result.stdout + result.stderr).includes(value), 'whole synthetic credential is absent');
  const observed = JSON.parse(result.stdout);
  t.diagnostic(`credential after long run: ${observed.elapsed.toFixed(2)} ms`);
  assert.ok(observed.elapsed < 2000, 'long prefix is scanned within the matching budget');
  assert.equal(observed.hits.length, 1);
  assert.equal(observed.hits[0].line, 1);
  assert.equal(observed.hits[0].masked, `loc…3456 (${value.length} chars)`);
});

test('N1 scan completes a two MiB one-line text file in under ten seconds', async t => {
  const p = await project(t);
  await writeFile(path.join(p, 'one-line.txt'), 'a'.repeat(2 * 1024 * 1024));
  const run = newRun(t, p);
  const start = performance.now();
  const result = spawnSync(process.execPath, [cliPath, 'scan', run.id], {
    encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024
  });
  const elapsed = performance.now() - start;
  t.diagnostic(`two MiB scan: ${elapsed.toFixed(2)} ms`);
  assert.ok(!result.error, 'bounded scan finishes instead of hanging');
  assert.equal(result.status, 0, 'scan succeeds');
  assert.ok(elapsed < 10000, 'two MiB scan stays below ten seconds');
  assert.equal(result.stdout.trim(), 'No secrets found');
});

test('N1 a field name is capped at 128 characters and cannot restart inside a long name run', async t => {
  const p = await project(t);
  const accepted = 'a'.repeat(119) + '_PASSWORD';
  const rejected = [
    'a'.repeat(120) + '_PASSWORD',
    '_'.repeat(129) + 'password',
    'a'.repeat(200) + '.password',
    'a'.repeat(200) + '-password',
    'a'.repeat(200) + '$password'
  ];
  await writeFile(path.join(p, 'field-names.env'), [accepted, ...rejected].map(name => `${name}="${value}"`).join('\n'));
  const run = newRun(t, p);
  const result = cli('scan', run.id);
  assert.equal(result.status, 0, 'scan succeeds');
  assert.ok(!(result.stdout + result.stderr).includes(value), 'whole synthetic credential is absent');
  const lines = result.stdout.trim().split('\n');
  assert.equal(lines.length, 1, 'only the field exactly at the cap is found');
  assert.ok(lines[0].startsWith('field-names.env:1  '), 'matching never restarts at a keyword suffix');
  assert.ok(lines[0].endsWith(`loc…3456 (${value.length} chars)`), 'accepted boundary field keeps exact masking');
});
