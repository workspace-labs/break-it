import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { findSecrets } from '../scripts/lib/leaks.mjs';
import { validateFindings } from '../scripts/lib/report.mjs';
import { cli, project, newRun, root } from './helpers.mjs';

const safeReferences = [
  'const cfg = { secret: config.secret }',
  'password = settings.db.password',
  'token: this.token',
  'auth = env.API_KEY',
  'secret = $settings._database.$password',
  'const cfg={secret:config.secret}'
];
const earlierSafe = [
  'TOKEN=process.env.TOKEN',
  'password = getPassword()',
  'secret: ${SECRET}',
  'API_KEY=your-key-here',
  'token = null',
  'the token expired today'
];
function findingData(Saw) {
  return { project: 'dotted-references', round: 1,
    attacks: { tried: 1, blocked: 0, gotThrough: 1 },
    findings: [{ id: 'C01', severity: 'CRITICAL', title: 'Configuration check',
      Tried: 'Inspected the copy', Saw, Where: 'config.mjs:1', Advice: 'Keep credential values outside source' }] };
}

test('N2 unquoted dotted references stay clean in recognition, mask, scan and report guard', async t => {
  for (const input of safeReferences) {
    assert.equal(findSecrets(input).length, 0, 'plain dotted reference is not a held credential');
    assert.doesNotThrow(() => validateFindings(findingData(input)), 'report accepts dotted-reference evidence');
  }
  const source = [...safeReferences, ...earlierSafe].join('\n');
  const masked = spawnSync(process.execPath, [path.join(root, 'scripts/break-it.mjs'), 'mask'], {
    input: source, encoding: 'utf8', timeout: 3000
  });
  assert.equal(masked.status, 0, 'mask succeeds');
  assert.equal(masked.stdout, '', 'safe references emit no hits');
  const p = await project(t);
  await writeFile(path.join(p, 'references.txt'), source);
  const run = newRun(t, p);
  const result = cli('scan', run.id);
  assert.equal(result.status, 0, 'scan succeeds');
  assert.equal(result.stdout.trim(), 'No secrets found');
});

test('N2 digit-bearing unquoted values and quoted dotted literals remain credential candidates', async t => {
  const p = await project(t);
  const cases = [
    ['token=abc123def456ghi', 'abc123def456ghi'],
    ['token=config.part123value', 'config.part123value'],
    ['secret="config.secret.value"', 'config.secret.value']
  ];
  await writeFile(path.join(p, 'literal.env'), cases.map(([source]) => source).join('\n'));
  const run = newRun(t, p);
  const result = cli('scan', run.id);
  assert.equal(result.status, 0, 'scan succeeds');
  const lines = result.stdout.trim().split('\n');
  assert.equal(lines.length, cases.length, 'all held candidates are still found');
  for (const [index, [source, value]] of cases.entries()) {
    assert.ok(!(result.stdout + result.stderr).includes(value), 'whole synthetic value stays hidden');
    assert.ok(lines.some(line => line.startsWith(`literal.env:${index + 1}  `) &&
      line.endsWith(`${value.slice(0, 3)}…${value.slice(-4)} (${value.length} chars)`)), 'exact masking is preserved');
    assert.throws(() => validateFindings(findingData(source)), /contains an unmasked secret/, 'held literal is still refused in a report');
  }
});

test('N2 JSON, YAML and Python credential assignments remain found while earlier safe lines remain clean', async t => {
  const p = await project(t);
  const cases = [
    ['config.json', '{"client_secret":"json-VALUE-123456789"}', 'json-VALUE-123456789'],
    ['config.yaml', 'access_token: yaml-VALUE-123456789', 'yaml-VALUE-123456789'],
    ['config.py', 'apiKey = "python-VALUE-123456789"', 'python-VALUE-123456789']
  ];
  for (const [file, source] of cases) await writeFile(path.join(p, file), source);
  await writeFile(path.join(p, 'safe.env'), earlierSafe.join('\n'));
  const run = newRun(t, p);
  const result = cli('scan', run.id);
  assert.equal(result.status, 0, 'scan succeeds');
  const lines = result.stdout.trim().split('\n');
  assert.equal(lines.length, cases.length);
  for (const [file, , value] of cases) {
    assert.ok(!(result.stdout + result.stderr).includes(value), 'whole synthetic value stays hidden');
    assert.ok(lines.some(line => line.startsWith(`${file}:1  `) &&
      line.endsWith(`${value.slice(0, 3)}…${value.slice(-4)} (${value.length} chars)`)), 'language shape is detected and masked');
  }
  assert.ok(!result.stdout.includes('safe.env:'), 'earlier safe lines are not flagged');
});

test('N1 a minified ignored reference cannot hide a later held assignment on the same line', async t => {
  const p = await project(t);
  const value = 'synthetic-VALUE-1357902468';
  const source = `token=process.env.TOKEN;DB_PASSWORD="${value}"`;
  await writeFile(path.join(p, 'minified.js'), source);
  const run = newRun(t, p);
  const result = cli('scan', run.id);
  assert.equal(result.status, 0, 'scan succeeds');
  assert.ok(!(result.stdout + result.stderr).includes(value), 'whole synthetic value stays hidden');
  assert.equal(result.stdout.trim().split('\n').length, 1);
  assert.ok(result.stdout.startsWith('minified.js:1  '), 'later held assignment is detected');
  assert.ok(result.stdout.trim().endsWith(`syn…2468 (${value.length} chars)`), 'exact masking is preserved');
  assert.throws(() => validateFindings(findingData(source)), /contains an unmasked secret/,
    'a report cannot hide the later held assignment behind the ignored reference');
});
