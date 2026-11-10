import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { findSecrets, findNestedReview, findLeakEvidence, redactSecrets, maskValue } from '../scripts/lib/leaks.mjs';
import { cli, project, newRun } from './helpers.mjs';

// All credentials in this file are synthetic regression data.
const value = 'aB3dE5fG7hJ9kL';
const authConfig = {
  auth: {
    session: { strategy: 'jwt', maxAge: 2592000 },
    pages: { signIn: '/auth/signin', error: '/auth/error-page' },
    callbackUrl: 'https://shop.example.com/api/auth/callback'
  },
  token: { issuer: 'shop.example.com', audience: 'shop-api-clients', expiresIn: '15minutes' },
  credentials: { username: 'service-account', region: 'eu-west-1' }
};
const authValues = ['/auth/signin', '/auth/error-page', 'https://shop.example.com/api/auth/callback',
  'shop.example.com', 'shop-api-clients', '15minutes', 'service-account', 'eu-west-1'];

function byEyeOnly(text, values) {
  assert.deepEqual(findSecrets(text), [], 'no confirmed generic hit');
  const review = findNestedReview(text);
  assert.deepEqual(review.map(item => item.value), values, 'every eligible value survives by eye');
  const evidence = findLeakEvidence(text);
  assert.equal(evidence.length, values.length);
  assert.ok(evidence.every(item => item.byEye));
  const redacted = redactSecrets(text);
  for (const candidate of values) {
    assert.ok(!redacted.includes(candidate), 'whole value is absent');
    assert.ok(redacted.includes(maskValue(candidate)), 'exact mask is present');
  }
}

test('ordinary auth settings have zero confirmed and all eight eligible values by eye', () => {
  byEyeOnly(JSON.stringify(authConfig), authValues);
  // Ninth string "jwt" is shorter than the unchanged nine-character minimum.
  assert.equal(findNestedReview(JSON.stringify(authConfig)).length, 8);
});

test('ordinary auth config scan masks every eligible value and uses the qualified ending', async t => {
  const source = await project(t);
  await writeFile(path.join(source, 'auth.config.json'), JSON.stringify(authConfig, null, 2));
  const run = newRun(t, source);
  const result = cli('scan', run.id);
  assert.equal(result.status, 0, result.stderr);
  const output = result.stdout + result.stderr;
  assert.ok(!output.includes('generic nested'));
  assert.equal(output.split('Check by eye —').length - 1, 1);
  for (const candidate of authValues) {
    assert.ok(!output.includes(candidate));
    assert.equal(output.split(maskValue(candidate)).length - 1, 1);
  }
  assert.ok(output.trim().endsWith('No confirmed secrets — check the values above by eye'));
  assert.ok(!output.includes('No secrets found'));
});

for (const [parent, key, candidate] of [
  ['token', 'header', 'Authorization'], ['secret', 'name', 'prod/db/password'],
  ['secret', 'version', 'AWSCURRENT'], ['password', 'hashAlgorithm', 'argon2id-v19']
]) {
  test(`ordinary ${parent}.${key} setting is masked by eye only`, () => {
    byEyeOnly(JSON.stringify({ [parent]: { [key]: candidate } }), [candidate]);
  });
}

for (const key of ['value', 'current', 'previous', 'data', 'raw', 'plain', 'key', 'k', 'v',
  'primary', 'secondary', 'default']) {
  test(`value-like key ${key} confirms exact case-insensitive matches only`, () => {
    for (const spelling of [key, key.toUpperCase()]) {
      const text = JSON.stringify({ credentials: { [spelling]: value } });
      assert.equal(findSecrets(text).length, 1);
      assert.equal(findSecrets(text)[0].value, value);
      assert.deepEqual(findNestedReview(text), []);
      assert.ok(!redactSecrets(text).includes(value));
      assert.ok(redactSecrets(text).includes(maskValue(value)));
    }
    byEyeOnly(JSON.stringify({ credentials: { [`${key}Setting`]: value } }), [value]);
  });
}

test('all seven requested confirmed shapes stay confirmed and masked', () => {
  for (const text of [
    `password={value:"${value}"}`, `apiKey={k:"${value}"}`, `token={raw:"${value}"}`,
    `auth={bearer:{current:"${value}"}}`, `credentials={primary:\`${value}\`}`,
    `secret:["${value}"]`, '{"db":{"credentials":{"password":"S3cretPassw0rd99"}}}'
  ]) {
    const hits = findSecrets(text);
    assert.equal(hits.length, 1);
    assert.deepEqual(findNestedReview(text), []);
    assert.ok(!redactSecrets(text).includes(hits[0].value));
    assert.ok(redactSecrets(text).includes(maskValue(hits[0].value)));
  }
});

test('pass and argon keys retain possible secrets as masked by-eye evidence', () => {
  for (const [parent, key, candidate] of [
    ['credentials', 'pass', 'S3cretPassw0rd99'],
    ['passwordHash', 'argon', '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$RdescudvJCsgt3ub']
  ]) byEyeOnly(JSON.stringify({ [parent]: { [key]: candidate } }), [candidate]);
});

test('array object fields keep their own key rule while bare siblings stay confirmed', () => {
  const text = JSON.stringify({ credentials: [
    { region: [value], source: [[value]], current: [value], child: { password: value } }, value
  ] });
  assert.equal(findSecrets(text).length, 3, 'current, sensitive password and bare sibling');
  const review = findNestedReview(text);
  assert.deepEqual(review.map(item => item.key), ['region', 'source']);
  assert.ok(review.every(item => item.value === value));
  assert.equal(findLeakEvidence(text).length, 5);
  assert.ok(!redactSecrets(text).includes(value));
});

test('non-value-like keys at nested object and array depths never disappear', () => {
  byEyeOnly(`password={items:["${value}"]}`, [value]);
  byEyeOnly(JSON.stringify({ auth: { nested: [{ issuer: value }, { child: { audience: value } }] } }),
    [value, value]);
});

for (const [name, provider] of [
  ['GitHub', `ghp_${'K'.repeat(36)}`], ['OpenAI', `sk-${'A'.repeat(24)}`],
  ['AWS', `AKIA${'A'.repeat(16)}`], ['JWT', 'eyJhbGciOiJIUzI1NiJ9.abcdefgh1234.ijklmnop5678'],
  ['private key', '-----BEGIN PRIVATE KEY-----synthetic-body-----END PRIVATE KEY-----']
]) {
  test(`${name} inside a by-eye setting remains confirmed and fully masked`, () => {
    const whole = `prefix-${provider}-suffix`;
    const text = JSON.stringify({ secret: { customSetting: whole } });
    assert.equal(findSecrets(text).length, 1, 'independent provider rule');
    const evidence = findLeakEvidence(text);
    assert.equal(evidence.length, 1);
    assert.ok(!evidence[0].byEye, 'merged evidence remains confirmed');
    assert.ok(!redactSecrets(text).includes(provider));
    assert.ok(!redactSecrets(text).includes(whole));
  });
}

test('empty object keys retain by-eye classification when holding arrays', () => {
  for (const text of [JSON.stringify({ credentials: { '': [value] } }),
    JSON.stringify({ credentials: [{ '': [[value]] }] })]) byEyeOnly(text, [value]);
});
