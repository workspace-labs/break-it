import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { findSecrets, findNestedReview, redactSecrets, maskValue } from '../scripts/lib/leaks.mjs';
import { validateFindings } from '../scripts/lib/report.mjs';
import { cli, project, newRun, root } from './helpers.mjs';

const value = 'aB3dE5fG7hJ9kLmN'; // Synthetic fixture, never a real credential.
const missedNames = ['secrets', 'passwords', 'tokens', 'apiKeys', 'api_keys', 'API_KEYS',
  'privateKeys', 'private_keys', 'pwds', 'passwds', 'accessTokens', 'refresh_tokens',
  'clientSecrets', 'dbPasswords', 'SECRETS'];
const forms = {
  json: name => JSON.stringify({ [name]: value }),
  env: name => `${name}=${value}`,
  yaml: name => `${name}: "${value}"`,
  js: name => `const ${name} = "${value}";`
};

function confirmed(source, expected = value) {
  const hits = findSecrets(source);
  assert.equal(hits.length, 1, 'one confirmed candidate, without duplicates');
  assert.equal(hits[0].value, expected, 'the full candidate is found');
  assert.equal(hits[0].index, source.indexOf(expected), 'evidence points at the value');
  assert.deepEqual(findNestedReview(source), [], 'confirmed evidence is not also by-eye');
  const masked = redactSecrets(source);
  assert.ok(!masked.includes(expected), 'the whole candidate is absent from output');
  assert.ok(masked.includes(maskValue(expected)), 'the exact candidate mask is present');
}

function findings(Saw) {
  return { project: 'plural-credentials', round: 1,
    attacks: { tried: 1, blocked: 0, gotThrough: 1 },
    findings: [{ id: 'C03', severity: 'CRITICAL', title: 'Credential leak',
      Tried: 'Read synthetic fixture', Saw, Where: 'config.json:1',
      Advice: 'Remove credentials from replies' }] };
}

for (const name of missedNames) {
  for (const [format, render] of Object.entries(forms)) {
    test(`plural ${name} is found once and masked in ${format}`, () => confirmed(render(name)));
  }
}

for (const name of ['apikeys', 'privatekeys', 'passwordhashes', 'api-keys', 'api.keys',
  'private-keys', 'private.keys', 'password_hashes', 'password-hashes', 'password.hashes']) {
  test(`explicit plural compound ${name} is found and masked`, () => {
    confirmed(JSON.stringify({ [name]: value }));
    confirmed(`${name}: "${value}"`);
  });
}

for (const name of ['passwordHashes', 'credentials', 'authTokens']) {
  test(`already-caught ${name} stays caught exactly once in every scalar format`, () => {
    for (const render of Object.values(forms)) confirmed(render(name));
  });
}

for (const name of ['status', 'keys', 'monkeys', 'turkeys', 'hotkeys', 'tokenizer',
  'tokenized', 'secretary', 'secretariat', 'authors', 'authority', 'passwordless',
  'keyboard', 'auths', 'tokenss', 'secretss']) {
  test(`look-alike ${name} stays outside the explicit sensitive-name rule`, () => {
    for (const render of Object.values(forms)) {
      const source = render(name);
      assert.deepEqual(findSecrets(source), []);
      assert.deepEqual(findNestedReview(source), []);
      assert.equal(redactSecrets(source), source);
    }
  });
}

test('plural secrets array is confirmed with the preserved scalar-array mask', () => {
  const source = '{"secrets":["aB3dE5fG7hJ9kL"]}';
  // Compact unquoted scalar arrays retain punctuation through the next whitespace.
  confirmed(source, '["aB3dE5fG7hJ9kL"]}');
});

test('plural apiKeys starts the nested walk and confirms stripe.value', () => {
  confirmed('{"apiKeys":{"stripe":{"value":"Zq9mK2pL7xWq"}}}', 'Zq9mK2pL7xWq');
});

test('plural dbPasswords starts the nested walk but region remains by-eye only', () => {
  const source = '{"dbPasswords":{"region":"eu-west-1"}}';
  assert.deepEqual(findSecrets(source), []);
  const review = findNestedReview(source);
  assert.equal(review.length, 1);
  assert.equal(review[0].parent, 'dbpasswords');
  assert.equal(review[0].key, 'region');
  assert.equal(review[0].value, 'eu-west-1');
  assert.ok(!redactSecrets(source).includes('eu-west-1'));
  assert.ok(redactSecrets(source).includes(maskValue('eu-west-1')));
});

test('plural inner keys use the shared name rule to confirm beneath singular parents', () => {
  for (const name of missedNames) confirmed(JSON.stringify({ auth: { [name]: value } }));
});

test('documented tokenizer limit: bare tokens array reports ordinary long words as a scalar candidate', () => {
  const source = '{"tokens":["understanding","the","world"]}';
  // This is a known false positive, including existing compact scalar punctuation.
  confirmed(source, '["understanding","the","world"]}');
  assert.equal(findSecrets(source)[0].pattern, 'generic tokens');
  assert.equal(findSecrets(source)[0].value.length, 32);
});

test('plural evidence is refused unmasked and accepted masked by the existing report guard', () => {
  const sources = missedNames.flatMap(name => Object.values(forms).map(render => render(name)));
  sources.push('{"secrets":["aB3dE5fG7hJ9kL"]}',
    '{"apiKeys":{"stripe":{"value":"Zq9mK2pL7xWq"}}}',
    '{"dbPasswords":{"region":"eu-west-1"}}');
  for (const source of sources) {
    assert.throws(() => validateFindings(findings(source)), /contains an unmasked secret/);
    assert.doesNotThrow(() => validateFindings(findings(redactSecrets(source))));
  }
});

test('scan and mask expose only masked evidence for all 15 plural names in four formats', async t => {
  const dir = await project(t);
  const fixtures = Object.entries(forms).map(([format, render]) => ({
    file: `plural.${format}`, text: missedNames.map(render).join('\n')
  }));
  for (const fixture of fixtures) await writeFile(path.join(dir, fixture.file), fixture.text);
  const run = newRun(t, dir);
  const scanned = cli('scan', run.id);
  const masked = spawnSync(process.execPath, [path.join(root, 'scripts/break-it.mjs'), 'mask'], {
    input: fixtures.map(fixture => fixture.text).join('\n'), encoding: 'utf8', timeout: 5000
  });
  for (const result of [scanned, masked]) {
    assert.equal(result.status, 0);
    assert.ok(!(result.stdout + result.stderr).includes(value));
    assert.equal(result.stdout.split(maskValue(value)).length - 1, 60);
  }
  for (const fixture of fixtures) assert.ok(scanned.stdout.includes(`${fixture.file}:`));
});

test('scan with only plural-parent by-eye evidence cannot claim no secrets found', async t => {
  const dir = await project(t);
  await writeFile(path.join(dir, 'settings.json'), '{"dbPasswords":{"region":"eu-west-1"}}');
  const run = newRun(t, dir);
  const scanned = cli('scan', run.id);
  assert.equal(scanned.status, 0);
  assert.match(scanned.stdout, /Check by eye/);
  assert.match(scanned.stdout, /No confirmed secrets — check the values above by eye/);
  assert.ok(!scanned.stdout.includes('No secrets found'));
  assert.ok(!scanned.stdout.includes('eu-west-1'));
  assert.ok(scanned.stdout.includes(maskValue('eu-west-1')));
});
