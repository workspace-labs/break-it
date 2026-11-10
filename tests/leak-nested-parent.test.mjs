import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import * as leaks from '../scripts/lib/leaks.mjs';
import { validateFindings } from '../scripts/lib/report.mjs';
import { cli, project, newRun, root } from './helpers.mjs';

const value = 'Tr0ub4dor-9912-xyz';
const reviewValue = 'S3cr3tValue-abcd-efgh';
const metadata = ['type', 'algorithm', 'provider', 'source', 'strategy', 'endpoint', 'label',
  'description', 'policy', 'scheme', 'format', 'kind', 'mode', 'url', 'uri', 'env'];
const shapes = [
  `password={value:"${value}"}`, `apiKey={k:"${value}"}`, `secret={data:"${value}"}`,
  `token={raw:"${value}"}`, `{"password":{"current":"${value}"}}`,
  `db={password:"${value}"}`, `{"auth":{"password":"${value}"}}`
];
function review(text, options) {
  assert.equal(typeof leaks.findNestedReview, 'function', 'by-eye export exists');
  return leaks.findNestedReview(text, options);
}
async function scan(t, files) {
  const source = await project(t);
  for (const [file, text] of Object.entries(files)) await writeFile(path.join(source, file), text);
  const run = newRun(t, source);
  const result = cli('scan', run.id);
  assert.equal(result.status, 0, 'scan exit code remains successful');
  return result.stdout + result.stderr;
}
function findings(Saw) {
  return { project: 'nested-parent', round: 1,
    attacks: { tried: 1, blocked: 0, gotThrough: 1 },
    findings: [{ id: 'C01', severity: 'CRITICAL', title: 'Nested synthetic value',
      Tried: 'Read synthetic fixture', Saw, Where: 'config.json:1', Advice: 'Remove stored credentials' }] };
}

for (const [index, source] of shapes.entries()) {
  test(`nested parent shape ${index + 1} finds one whole value and masks it`, () => {
    const hits = leaks.findSecrets(source);
    assert.equal(hits.length, 1, 'one secret is reported exactly once');
    assert.equal(hits[0].value, value);
    assert.equal(hits[0].index, source.indexOf(value));
    assert.equal(hits[0].line, 1);
    if (index < 5) assert.match(hits[0].pattern, /^generic nested (password|apikey|secret|token)$/);
    const output = leaks.redactSecrets(source);
    assert.ok(!output.includes(value), 'whole value is absent');
    assert.ok(output.includes(leaks.maskValue(value)), 'exact mask is present');
  });
}

test('13 innocent nested config values produce zero confirmed hits', () => {
  const fields = { label: 'Enter your password', provider: 'aws-secrets-manager',
    endpoint: 'https://vault.example.com/v1', algorithm: 'bcrypt', type: 'oauth2',
    placeholder: '${DB_PASSWORD}', env: 'PROD_DB_PASSWORD', strategy: 'rotation-monthly',
    description: 'Credential settings only', policy: 'rotate-every-90-days', scheme: 'bearer-oauth2',
    format: 'opaque-string', kind: 'service-account' };
  const text = JSON.stringify({ password: fields });
  assert.equal(Object.keys(fields).length, 13);
  assert.deepEqual(leaks.findSecrets(text), []);
  assert.ok(review(text).every(item => metadata.includes(item.key)), 'only metadata needs by-eye review');
});

test('matching close bounds inheritance before unrelated cache and build values', () => {
  const text = `{"password":{"value":"${value}"},"cacheKeys":{"bucket":"customer-uploads-eu-west-1"},"build":{"commit":"9f3c2e1a7b"}}`;
  assert.equal(leaks.findSecrets(text).length, 1);
  assert.equal(leaks.findSecrets(text)[0].value, value);
  assert.deepEqual(review(text), []);
});

test('every metadata key yields by-eye evidence, never a confirmed generic nested hit', () => {
  for (const key of metadata) {
    const text = `secret={${key}:"${reviewValue}"}`;
    assert.deepEqual(leaks.findSecrets(text), [], key);
    const items = review(text);
    assert.equal(items.length, 1, key);
    assert.equal(items[0].parent, 'secret');
    assert.equal(items[0].key, key);
    assert.equal(items[0].value, reviewValue);
    assert.equal(items[0].index, text.indexOf(reviewValue));
    assert.equal(items[0].line, 1);
    assert.ok(!leaks.redactSecrets(text).includes(reviewValue), 'redact masks by-eye values');
    assert.ok(leaks.redactSecrets(text).includes(leaks.maskValue(reviewValue)));
  }
});

test('nested values failing length, whitespace or placeholder rules are silently dropped', () => {
  for (const candidate of ['tiny', 'two words here', '${DB_PASSWORD}', 'changeme', 'your-secret-here']) {
    const text = JSON.stringify({ secret: { value: candidate, source: candidate } });
    assert.deepEqual(leaks.findSecrets(text), []);
    assert.deepEqual(review(text), []);
  }
  const text = 'password={value:"123456789"}';
  assert.equal(leaks.findSecrets(text).length, 1);
  assert.equal(leaks.findSecrets(text, { minimumLength: 10 }).length, 0);
  assert.equal(review('secret={source:"123456789"}', { minimumLength: 10 }).length, 0);
});

test('nested strings at any supported depth and array-of-objects values are found once', () => {
  for (const text of [
    `password=[{value:"${value}"}]`, `password=[{safe:0},{child:{raw:"${value}"}}]`,
    `password=[{}, {value:"${value}"}]`, `password=[ {value:"${value}"}]`,
    `password={child:[{raw:"${value}"}]}`, `password={items:["${value}"]}`,
    'password={' + 'child:{'.repeat(63) + `value:"${value}"` + '}'.repeat(64)
  ]) {
    const hits = leaks.findSecrets(text);
    assert.equal(hits.length, 1, 'one inherited literal, no repeated nested walk');
    assert.equal(hits[0].value, value);
  }
});

test('nested provider match merges with inherited hit into exactly one full value', () => {
  const provider = `ghp_${'K'.repeat(36)}`;
  const text = `password={value:"prefix-${provider}-suffix"}`;
  const hits = leaks.findSecrets(text);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].value, `prefix-${provider}-suffix`);
  assert.ok(!leaks.redactSecrets(text).includes(provider));
});

test('quoted field-like text inside a parent cannot rescan across its matching close', () => {
  for (const text of [
    ...['password={', 'password=['].map(prefix =>
      `password={note:"${prefix}",value:"${value}"};cache={bucket:"customer-uploads-eu-west-1"}`),
    `password={"note:password={":"inert-value-123",value:"${value}"};cache={bucket:"customer-uploads-eu-west-1"}`
  ]) {
    const hits = leaks.findSecrets(text);
    assert.equal(hits.length, 2);
    assert.ok(hits.some(hit => hit.value === value));
    assert.ok(hits.every(hit => !hit.value.includes('customer-uploads')));
    assert.ok(leaks.redactSecrets(text).endsWith(';cache={bucket:"customer-uploads-eu-west-1"}'));
  }
});

test('bounded quote inspection preserves scalar credentials in prose and after malformed line breaks', () => {
  for (const text of [
    `auth={note:"some prose token=${value} more words"}`,
    `auth={note:"some prose token='${value}' more words"}`,
    `auth={note:"unterminated\npassword="${value}"`
  ]) {
    assert.ok(leaks.findSecrets(text).some(hit => hit.value === value));
    assert.ok(!leaks.redactSecrets(text).includes(value));
  }
});

test('a provider token inside a metadata value stays confirmed and merged in scan and mask', async t => {
  const provider = `ghp_${'K'.repeat(36)}`;
  const whole = `prefix-${provider}-suffix`;
  const text = `secret={source:"${whole}"}`;
  const output = await scan(t, { 'provider.js': text });
  assert.ok(output.includes('provider.js:1  GitHub ghp'));
  assert.ok(!output.includes('No confirmed secrets'));
  assert.ok(!output.includes(whole) && !output.includes(provider));
  assert.equal(output.split(leaks.maskValue(whole)).length - 1, 1);
  const masked = spawnSync(process.execPath, [path.join(root, 'scripts/break-it.mjs'), 'mask'], {
    input: text, encoding: 'utf8', timeout: 5000
  });
  assert.equal(masked.status, 0);
  assert.equal(masked.stdout.trim(), `GitHub ghp  ${leaks.maskValue(whole)}`);
});

test('content beyond inherited depth 64 retains existing sensitive scalar detection', () => {
  for (const key of ['secret', '"secret"']) {
    const text = 'password={' + 'child:{'.repeat(70) + `${key}:"${value}"` + '}'.repeat(71);
    const hits = leaks.findSecrets(text);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].value, value);
    assert.ok(!leaks.redactSecrets(text).includes(value));
  }
});

test('unclosed parents and braces or escaped quotes inside strings do not truncate traversal', () => {
  for (const text of [
    `password={value:"${value}"`, `password={note:"a } b",value:"${value}"}`,
    `password={note:"a \\" } b",value:"${value}"}`,
    `password=[{note:'[ } ]',value:'${value}'}]`
  ]) {
    assert.ok(leaks.findSecrets(text).some(hit => hit.value === value));
    assert.ok(!leaks.redactSecrets(text).includes(value));
  }
});

test('a credential parent written inside a quoted literal does not inherit into later fields', () => {
  const text = `const note="password={"; const other={value:"customer-uploads-eu-west-1"};`;
  assert.deepEqual(leaks.findSecrets(text), []);
  assert.deepEqual(review(text), []);
});

test('scan shows one by-eye heading per file after confirmed hits, masks values and keeps line numbers', async t => {
  const output = await scan(t, { 'nested.json': `password={value:"${value}"}\r\nsecret={source:"${reviewValue}",provider:"aws-secrets-manager"}` });
  assert.ok(!output.includes(value) && !output.includes(reviewValue));
  assert.equal(output.split('Check by eye — values under credential names (inner key looks like settings): nested.json').length - 1, 1);
  assert.ok(output.indexOf('nested.json:1') < output.indexOf('Check by eye'));
  assert.ok(output.includes(`  line 2  secret.source = ${leaks.maskValue(reviewValue)}`));
  assert.ok(!output.includes('No secrets found'));
});

test('by-eye-only scan uses the qualified ending; a truly clean folder keeps the all-clear', async t => {
  const output = await scan(t, { 'settings.js': `secret={source:"${reviewValue}"}` });
  assert.ok(!output.includes(reviewValue));
  assert.ok(output.includes(leaks.maskValue(reviewValue)));
  assert.ok(output.trim().endsWith('No confirmed secrets — check the values above by eye'));
  assert.ok(!output.includes('No secrets found'));
  assert.equal((await scan(t, { 'clean.txt': 'ordinary config, no stored credential' })).trim(), 'No secrets found');
});

test('scan escapes control characters in nested by-eye keys instead of forging lines', async t => {
  const output = await scan(t, { 'controls.json': '{"secret":{"source":"' + reviewValue + '","label\\n\\u001b[31m":"' + value + '"}}' });
  assert.ok(!output.includes(reviewValue) && !output.includes(value));
  assert.ok(!output.includes('\x1b'));
  assert.ok(output.includes(leaks.maskValue(reviewValue)));
});

test('mask CLI and report guard protect confirmed and by-eye nested evidence', () => {
  for (const text of [`password={value:"${value}"}`, `secret={source:"${reviewValue}"}`]) {
    const masked = spawnSync(process.execPath, [path.join(root, 'scripts/break-it.mjs'), 'mask'], {
      input: text, encoding: 'utf8', timeout: 5000
    });
    assert.equal(masked.status, 0);
    assert.ok(!masked.stdout.includes(value) && !masked.stdout.includes(reviewValue));
    assert.throws(() => validateFindings(findings(text)), /contains an unmasked secret/);
    assert.doesNotThrow(() => validateFindings(findings(masked.stdout.trim())));
  }
});

test('scan handles crossing parent and value at a one MiB boundary without partial masks', async t => {
  const MiB = 1024 * 1024;
  const prefix = ' '.repeat(MiB - 24);
  const crossing = `password={value:"${value}",source:"${reviewValue}"}`;
  const output = await scan(t, { 'boundary.js': prefix + crossing });
  assert.ok(!output.includes(value) && !output.includes(reviewValue));
  assert.equal(output.split(leaks.maskValue(value)).length - 1, 1);
  assert.equal(output.split(leaks.maskValue(reviewValue)).length - 1, 1);
  assert.ok(!output.includes('No secrets found'));
});
