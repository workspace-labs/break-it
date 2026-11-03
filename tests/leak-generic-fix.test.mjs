import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { cli, project, newRun, root } from './helpers.mjs';
import { validateFindings } from '../scripts/lib/report.mjs';

const cliPath = path.join(root, 'scripts/break-it.mjs');
const shapes = [
  ['unquoted env', 'DB_PASSWORD=supersecret-VALUE-123456', 'supersecret-VALUE-123456'],
  ['middle keyword', 'STRIPE_SECRET_KEY=plainvalue-ABCDEFGH-987', 'plainvalue-ABCDEFGH-987'],
  ['camelCase', 'const apiKey = "camelcase-SECRET-7777777";', 'camelcase-SECRET-7777777'],
  ['underscore prefix', 'const client_secret = "underscore-SECRET-888888";', 'underscore-SECRET-888888'],
  ['token prefix', 'const access_token = "prefixed-TOKEN-99999999";', 'prefixed-TOKEN-99999999'],
  ['export env', 'export AUTH_TOKEN=exported-VALUE-1234567', 'exported-VALUE-1234567'],
  ['header separator', 'x-api-key: header-VALUE-12345678', 'header-VALUE-12345678']
];
const masked = value => `${value.slice(0, 3)}…${value.slice(-4)} (${value.length} chars)`;
function noWholeValues(output, values) {
  for (const value of values) assert.ok(!output.includes(value), 'whole synthetic value stays hidden');
}
function mask(input) {
  return spawnSync(process.execPath, [cliPath, 'mask'], {
    input, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024
  });
}
function findingData() {
  return { project: 'generic-fixture', round: 1,
    attacks: { tried: 1, blocked: 0, gotThrough: 1 },
    findings: [{ id: 'C01', severity: 'CRITICAL', title: 'Credential in configuration',
      Tried: 'Scanned the copy', Saw: 'A credential was found', Where: 'config.env:1',
      Advice: 'Remove the credential and rotate it separately' }] };
}

test('F1 scan finds all seven reviewed assignment shapes with exact masking and source lines', async t => {
  const p = await project(t);
  await writeFile(path.join(p, 'config.env'), shapes.map(([, source]) => source).join('\n'));
  const run = newRun(t, p);
  const result = cli('scan', run.id);
  assert.equal(result.status, 0, 'scan succeeds');
  noWholeValues(result.stdout + result.stderr, shapes.map(([, , value]) => value));
  const lines = result.stdout.trim().split('\n');
  assert.equal(lines.length, shapes.length, 'every reviewed shape is found once');
  for (const [index, [label, , value]] of shapes.entries()) {
    assert.ok(lines.some(line => line.startsWith(`config.env:${index + 1}  `) && line.endsWith(masked(value))), label);
  }
});

test('F1 mask recognizes all seven reviewed shapes without returning any input context', () => {
  const result = mask(shapes.map(([, source]) => source).join('\n'));
  assert.equal(result.status, 0, 'mask succeeds');
  noWholeValues(result.stdout + result.stderr, shapes.map(([, , value]) => value));
  const lines = result.stdout.trim().split('\n');
  assert.equal(lines.length, shapes.length, 'every reviewed shape is masked once');
  for (const [label, , value] of shapes) {
    assert.ok(lines.some(line => line.endsWith(masked(value))), label);
  }
  assert.ok(!result.stdout.includes('const '), 'source context is never emitted');
  assert.ok(!result.stdout.includes('export '), 'export context is never emitted');
});

for (const [label, source, value] of shapes) {
  for (const field of ['Saw', 'Tried', 'Advice']) {
    test(`F1 report refuses the reviewed ${label} assignment in ${field}`, () => {
      const data = findingData();
      data.findings[0][field] = source;
      let message = '';
      try { validateFindings(data); } catch (error) { message = error.message; }
      assert.equal(message, 'Refused: finding C01 contains an unmasked secret; use the masked form.');
      noWholeValues(message, [value]);
    });
  }
}

test('F1 additional keyword forms and separators work for quoted and unquoted assignments', async t => {
  const p = await project(t);
  const names = ['passwd', 'pwd', 'auth', 'credential', 'credentials', 'private_key', 'password_hash',
    'db.password', 'db/password', 'db-password', 'accessToken', 'clientSecret', 'DbPassword',
    'privateKey', 'PasswordHash', 'APIKEY', 'db_auth_setting', 'service.credentials.value'];
  const values = names.map((_, index) => `additional-VALUE-${String(index).padStart(4, '0')}`);
  const input = names.map((name, index) => `${name}${index % 2 ? ': ' : '='}${index % 3 ? values[index] : `"${values[index]}"`}`).join('\n');
  await writeFile(path.join(p, 'names.txt'), input);
  const run = newRun(t, p);
  const result = cli('scan', run.id);
  assert.equal(result.status, 0, 'scan succeeds');
  noWholeValues(result.stdout + result.stderr, values);
  const lines = result.stdout.trim().split('\n');
  assert.equal(lines.length, names.length, 'all keyword and separator forms are found');
  for (const [index, value] of values.entries()) {
    assert.ok(lines.some(line => line.startsWith(`names.txt:${index + 1}  `) && line.endsWith(masked(value))), `name form ${index + 1}`);
  }
});

test('F1 unquoted values stop before whitespace or hash comments and keep the nine-character minimum', async t => {
  const p = await project(t);
  const values = ['hash-comment-VALUE-001', 'space-comment-VALUE-002', 'abc-12345'];
  await writeFile(path.join(p, 'terminators.env'), [
    `DB_PASSWORD=${values[0]}#comment-must-not-be-part-of-value`,
    `secret: ${values[1]} trailing words stay out`,
    `token=${values[2]}`,
    'token=abc-1234'
  ].join('\n'));
  const run = newRun(t, p);
  const result = cli('scan', run.id);
  assert.equal(result.status, 0, 'scan succeeds');
  noWholeValues(result.stdout + result.stderr, values);
  const lines = result.stdout.trim().split('\n');
  assert.equal(lines.length, 3);
  for (const value of values) assert.ok(lines.some(line => line.endsWith(masked(value))), 'exact value is masked');
});

test('F1 reads, placeholders, function calls, identifiers and prose are never reported as held secrets', async t => {
  const p = await project(t);
  const expressions = [
    'process.env.TOKEN', 'os.environ["TOKEN"]', 'os.environ.get("TOKEN")',
    '${SECRET}', '{{SECRET}}', '<SECRET_PLACEHOLDER>', 'null', 'undefined', 'true', 'false',
    'your-key-here', 'example', 'changeme', 'xxxxxxxxxxxx'
  ];
  const source = expressions.flatMap(value => [
    `TOKEN=${value}`, `password = '${value}'`, `token = \`${value}\``,
    `client_secret = '${value}'`, `DbPassword = \`${value}\``
  ]).concat(['getPassword', 'loadCredentials()', 'foo(argument)', 'foo("argument")']
    .map(value => `token = ${value}`))
    .concat(['the token expired today', 'an authentication warning is prose']).join('\n');
  await writeFile(path.join(p, 'references.txt'), source);
  await writeFile(path.join(p, '.env.example'), 'API_KEY=your-key-here\nDB_PASSWORD="changeme"\n');
  const run = newRun(t, p);
  const result = cli('scan', run.id);
  assert.equal(result.status, 0, 'scan succeeds');
  assert.equal(result.stdout.trim(), 'No secrets found');
  assert.equal(mask(source).stdout, '', 'mask does not mistake references for stored values');
  const data = findingData();
  for (const line of source.split('\n')) {
    data.findings[0].Saw = line;
    assert.doesNotThrow(() => validateFindings(data), 'reference/prose evidence remains acceptable');
  }
});

test('F1 quoted alphabetic and call-looking literals keep their original credential behavior', async t => {
  const p = await project(t);
  const values = ['longalphabeticpassword', 'loadCredentials()'];
  await writeFile(path.join(p, 'literal.env'), values.map(value => `password = "${value}"`).join('\n'));
  const run = newRun(t, p);
  const result = cli('scan', run.id);
  assert.equal(result.status, 0, 'scan succeeds');
  noWholeValues(result.stdout + result.stderr, values);
  assert.equal(result.stdout.trim().split('\n').length, 2);
  for (const value of values) assert.ok(result.stdout.includes(masked(value)), 'quoted held literal is masked');
});

test('F1 report permits the exact masked form in an unquoted assignment', () => {
  const data = findingData();
  data.findings[0].Saw = `DB_PASSWORD=${masked(shapes[0][2])}`;
  assert.doesNotThrow(() => validateFindings(data));
});

test('F1 report CLI blocks an unquoted credential before printing or consuming its receipt', async t => {
  const p = await project(t);
  const run = newRun(t, p);
  assert.equal(cli('cleanup', run.id).status, 0);
  const file = path.join(p, '..', `generic-fix-${run.id}.json`);
  t.after(() => unlink(file).catch(() => {}));
  const data = findingData();
  data.findings[0].Saw = shapes[0][1];
  await writeFile(file, JSON.stringify(data));
  const refused = cli('report', run.id, file);
  assert.notEqual(refused.status, 0, 'unquoted credential is refused');
  assert.equal(refused.stdout, '');
  noWholeValues(refused.stderr, [shapes[0][2]]);
  data.findings[0].Saw = `DB_PASSWORD=${masked(shapes[0][2])}`;
  await writeFile(file, JSON.stringify(data));
  const corrected = cli('report', run.id, file);
  assert.equal(corrected.status, 0, 'corrected evidence can still consume the intact receipt');
  assert.ok(corrected.stdout.includes(data.findings[0].Saw), 'masked unquoted evidence reaches the report');
});

const gitAvailable = spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;
test('F1 removed unquoted env password is found in copy git history with commit, file and line',
  { skip: !gitAvailable && 'git is not on PATH; unquoted history end-to-end test skipped' }, async t => {
    const p = await project(t);
    function git(folder, ...args) {
      const result = spawnSync('git', ['-C', folder, ...args], { encoding: 'utf8', timeout: 15000 });
      assert.equal(result.status, 0, 'throwaway git command succeeds');
      return result.stdout;
    }
    git(p, 'init', '--quiet');
    await writeFile(path.join(p, '.env'), `# local synthetic configuration\n${shapes[0][1]}\n`);
    git(p, 'add', '.env');
    git(p, '-c', 'user.name=Local Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'Synthetic configuration');
    const first = git(p, 'rev-parse', 'HEAD').trim().slice(0, 7);
    await writeFile(path.join(p, '.env'), '# credential removed\n');
    git(p, 'add', '.env');
    git(p, '-c', 'user.name=Local Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'Remove synthetic credential');
    const run = newRun(t, p);
    assert.equal(cli('scan', run.id).stdout.trim(), 'No secrets found');
    const result = mask(git(run.copy, 'log', '-p', '--all', '--no-color'));
    assert.equal(result.status, 0, 'history masking succeeds');
    noWholeValues(result.stdout + result.stderr, [shapes[0][2]]);
    assert.ok(result.stdout.includes(`commit ${first}  .env:2  `), 'original commit, path and source line identified');
    assert.ok(result.stdout.includes(masked(shapes[0][2])), 'unquoted credential has exact masking');
    assert.ok(!result.stdout.includes('Author:'), 'history context is not emitted');
  });
