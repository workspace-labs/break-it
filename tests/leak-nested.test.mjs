import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { findSecrets, redactSecrets, maskValue } from '../scripts/lib/leaks.mjs';
import { validateFindings } from '../scripts/lib/report.mjs';
import { root, cli, project, newRun } from './helpers.mjs';

const value = 'nested-SYNTHETIC-1357902468';
const examples = [
  `{"auth":{"password": "${value}"}}`,
  `{"token":{"pwd": "${value}"}}`,
  `const credentials = {password: "${value}"};`,
  `credentials=[{pwd: "${value}"}]`,
  `credentials=["safe",{password: "${value}"}]`,
  `auth={settings:{password: "${value}"}}`
];

function findings(Saw) {
  return { project: 'nested-credentials', round: 1,
    attacks: { tried: 1, blocked: 0, gotThrough: 1 },
    findings: [{ id: 'C03', severity: 'CRITICAL', title: 'Nested credential leak',
      Tried: 'Read the synthetic response', Saw, Where: 'server.mjs:1',
      Advice: 'Remove private credential fields from replies' }] };
}

test('nested sensitive containers cannot consume the names of inner credential fields', () => {
  for (const source of examples) {
    const hits = findSecrets(source);
    assert.ok(hits.some(hit => hit.value === value), 'inner credential is recognized in full');
    const output = redactSecrets(source, { minimumLength: 1 });
    assert.ok(!output.includes(value), 'whole synthetic credential remains hidden');
    assert.ok(output.includes(maskValue(value)), 'inner credential has its own exact mask');
  }
});

test('JSON object container detection accepts arbitrary quoted keys before a credential field', () => {
  for (const key of ['a?', 'ü', 'k'.repeat(129), 'quoted"key', 'back\\slash', '💡']) {
    const source = JSON.stringify({ auth: { [key]: 0, password: value } })
      .replace(`:"${value}"`, `: "${value}"`);
    const output = redactSecrets(source, { minimumLength: 1 });
    assert.ok(!output.includes(value), 'a preceding quoted key cannot hide an inner credential');
    assert.ok(output.includes(maskValue(value)), 'inner credential retains its complete mask');
  }
});

test('nested container config reads and placeholders stay clean while scalar forms remain masked', () => {
  for (const source of [
    'auth={password: config.secret}',
    'credentials=[{password: process.env.PASSWORD}]',
    'token={pwd: "changeme"}',
    'auth={secret:"your-secret-here"}'
  ]) assert.equal(findSecrets(source).length, 0, 'nested references do not become stored credentials');
  for (const source of [
    `token="${value}"`, `credentials=["${value}"]`,
    `auth={password:"${value}"}`, `password={${value}}`
  ]) assert.ok(!redactSecrets(source).includes(value), 'previous scalar and compact forms remain masked');
});

test('scan and mask find inner credential values inside named containers', async t => {
  const source = await project(t);
  await writeFile(path.join(source, 'nested.json'), examples.join('\n'));
  const run = newRun(t, source);
  const scanned = cli('scan', run.id);
  assert.equal(scanned.status, 0, 'scan succeeds');
  assert.ok(!scanned.stdout.includes(value), 'scan does not display whole credentials');
  assert.equal(scanned.stdout.split(maskValue(value)).length - 1, examples.length,
    'each nested credential is reported in full');
  const masked = spawnSync(process.execPath, [path.join(root, 'scripts/break-it.mjs'), 'mask'], {
    input: examples.join('\n'), encoding: 'utf8', timeout: 5000
  });
  assert.equal(masked.status, 0, 'mask succeeds');
  assert.ok(!masked.stdout.includes(value), 'mask does not display whole credentials');
  assert.equal(masked.stdout.split(maskValue(value)).length - 1, examples.length,
    'history/text masking retains each inner value');
});

test('report guard refuses a nested credential hidden behind a short container prefix', () => {
  assert.throws(() => validateFindings(findings(examples[1])), /contains an unmasked secret/,
    'complete inner credentials cannot enter a report');
  assert.doesNotThrow(() => validateFindings(findings(redactSecrets(examples[1]))),
    'the corrected masked evidence remains reportable');
});

test('deep named object and array prefixes do not repeatedly rescan the same long suffix', () => {
  for (const text of ['auth={'.repeat(150000) + 'pwd=config.secret',
    'token=['.repeat(150000) + `password="${value}"`]) {
    const start = performance.now();
    const output = redactSecrets(text);
    assert.ok(performance.now() - start < 2000, 'one MiB nested prefix remains bounded');
    assert.ok(!output.includes(value), 'any held credential stays masked');
  }
});

test('malformed escaped quoted-key prefixes finish in a bounded child process', () => {
  const program = `import {readFileSync} from 'node:fs';
    import {redactSecrets} from ${JSON.stringify(new URL('../scripts/lib/leaks.mjs', import.meta.url).href)};
    redactSecrets(readFileSync(0, 'utf8'));`;
  for (const prefix of ['auth={"', 'credentials=["safe",{auth={"']) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', program], {
      input: prefix + 'auth={\\" '.repeat(150000) + '\n',
      encoding: 'utf8', timeout: 3000
    });
    assert.ok(!result.error, 'malformed quoted-key matching finishes within three seconds');
    assert.equal(result.status, 0, 'malformed input does not crash matching');
  }
});

test('send CLI masks a complete nested JSON credential before displaying its response', async t => {
  const app = http.createServer((req, res) => res.end(examples[0]));
  await new Promise((resolve, reject) => {
    app.once('error', reject);
    app.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => app.close(resolve)));
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'scripts/break-it.mjs'), 'send', 'GET',
      `http://127.0.0.1:${app.address().port}`]);
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.once('error', reject);
    child.once('close', status => resolve({ output, status }));
  });
  assert.equal(result.status, 0, 'send succeeds');
  assert.ok(!result.output.includes(value), 'whole nested credential is absent from CLI output');
  assert.ok(result.output.includes(maskValue(value)), 'CLI displays the inner credential mask');
});
