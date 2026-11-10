import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { findSecrets, findNestedReview, redactSecrets, maskValue } from '../scripts/lib/leaks.mjs';
import { cli, project, newRun } from './helpers.mjs';

const password = 'Tr0ub4dor-9912';
const token = 'Zq9mK2pL7xWqRt';
const cases = [
  { name: 'Y1', text: `password:\n  value: ${password}`, hits: [[password, 2]], review: [] },
  { name: 'Y2', text: 'database:\n  credentials:\n    user: admin\n    pass: S3cretPassw0rd99\n  host: db.internal',
    hits: [], review: [['S3cretPassw0rd99', 4, 'pass']] },
  { name: 'Y3', text: 'secrets:\n  - aB3dE5fG7hJ9kL\n  - Qw8Er7Ty6Ui5',
    hits: [['aB3dE5fG7hJ9kL', 2], ['Qw8Er7Ty6Ui5', 3]], review: [] },
  { name: 'Y4', text: `services:\n  api:\n    environment:\n      API_TOKENS:\n        primary: "${token}"`,
    hits: [[token, 5]], review: [] },
  { name: 'Y5', text: 'auth:\n  issuer: shop.example.com\n  callbackUrl: https://shop.example.com/cb',
    hits: [], review: [['https://shop.example.com/cb', 3, 'callbackUrl']] },
  { name: 'Y6', text: `token:\n  current: ${token}\nnext_section:\n  bucket: customer-uploads-eu`,
    hits: [[token, 2]], review: [] }
];

async function scan(t, files) {
  const source = await project(t);
  for (const [name, text] of Object.entries(files)) await writeFile(path.join(source, name), text);
  const run = newRun(t, source);
  const result = cli('scan', run.id);
  assert.equal(result.status, 0, 'scan succeeds');
  return result.stdout + result.stderr;
}
function quiet(text) {
  assert.deepEqual(findSecrets(text), [], 'zero confirmed hits');
  assert.deepEqual(findNestedReview(text), [], 'zero by-eye hits');
}
function exact(text, expected, review = []) {
  const hits = findSecrets(text);
  const byEye = findNestedReview(text);
  assert.deepEqual(hits.map(hit => [hit.value, hit.line]), expected);
  assert.deepEqual(byEye.map(hit => [hit.value, hit.line, hit.key]), review);
  for (const hit of [...hits, ...byEye]) {
    assert.equal(hit.index, text.indexOf(hit.value), 'index points at the complete value');
    const masked = redactSecrets(text);
    assert.ok(!masked.includes(hit.value), 'redaction hides the whole value');
    assert.ok(masked.includes(maskValue(hit.value)), 'redaction uses the complete value length');
  }
}

for (const fixture of cases) {
  test(`${fixture.name} indented YAML preserves confirmed and by-eye classification`, () => {
    exact(fixture.text, fixture.hits, fixture.review);
  });
}

test('Y1–Y6 real scan masks values, retains their own lines and leaves outside siblings untouched', async t => {
  const output = await scan(t, Object.fromEntries(cases.map(item => [`${item.name}.yaml`, item.text])));
  for (const fixture of cases) {
    const lines = output.split('\n').filter(line => line.startsWith(`${fixture.name}.yaml:`));
    assert.equal(lines.length, fixture.hits.length, `${fixture.name} confirmed hit count`);
    for (const [value, line] of fixture.hits) {
      assert.ok(output.includes(`${fixture.name}.yaml:${line}  `), 'confirmed line points at the value');
      assert.ok(output.includes(maskValue(value)), 'confirmed value is completely masked');
      assert.ok(!output.includes(value), 'whole confirmed value is hidden');
    }
    for (const [value, line, key] of fixture.review) {
      assert.ok(output.includes(`  line ${line}  ${fixture.name === 'Y2' ? 'credentials' : 'auth'}.${key} = ${maskValue(value)}`),
        'by-eye key and value line are retained');
      assert.ok(!output.includes(value), 'whole by-eye value is hidden');
    }
  }
  assert.ok(!output.includes('host') && !output.includes('db.internal'), 'host after credentials remains untouched');
  assert.ok(!output.includes('bucket') && !output.includes('customer-uploads-eu'), 'bucket after token remains untouched');
});

test('Docker Compose, Kubernetes and Rails YAML retain exactly their intended values', () => {
  exact(`services:\n  shop:\n    environment:\n      DB_PASSWORDS:\n        primary: '${password}'\n        previous: "${token}"`,
    [[password, 5], [token, 6]]);
  exact(`apiVersion: v1\nspec:\n  template:\n    credentials:\n      database:\n        pass: ${password}\n      token:\n        current: ${token}\n    host: cluster.internal`,
    [[token, 8]], [[password, 6, 'pass']]);
  exact(`production:\n  secret_key_base: ${password}`, [[password, 2]]);
});

test('comments, blank lines and trailing comments preserve the block and exclude comment text', () => {
  const text = `password: # synthetic values\n# column-zero comment\n\n  # indented comment\n  value: ${password} # plain comment\n\n  previous: '${token}' # quoted comment\nnext_section:\n  bucket: customer-uploads-eu`;
  exact(text, [[password, 5], [token, 7]]);
});

test('nested YAML keys decide the value classification at their own frame', () => {
  const text = `credentials:\n  value:\n    source: ${password}\n  metadata:\n    current: ${token}\n  source:\n    - aB3dE5fG7hJ9kL`;
  exact(text, [[token, 5], ['aB3dE5fG7hJ9kL', 7]], [[password, 3, 'source']]);
});

test('all existing nested filters apply to quoted and plain YAML values', () => {
  for (const candidate of ['tiny', 'two words here', '${DB_PASS}', '<your-password>', 'changeme',
    'your-password-here', 'process.env.DB_PASS', 'os.environ["DB_PASS"]']) {
    for (const value of [candidate, `"${candidate.replaceAll('"', '\\"')}"`, `'${candidate}'`]) {
      quiet(`password:\n  value: ${value}\n  source: ${value}\n  - ${value}`);
    }
  }
  quiet('password:\n  value: config.secret\n  env: process.env.DB_PASS\n  previous: os.environ["DB_PASS"]');
  exact('password:\n  value: 123456789', [['123456789', 2]]);
  assert.deepEqual(findSecrets('password:\n  value: 123456789', { minimumLength: 10 }), []);
  assert.deepEqual(findNestedReview('password:\n  source: 123456789', { minimumLength: 10 }), []);
});

test('Python and other code cannot open or continue YAML inheritance', () => {
  for (const text of [
    'if password:\n    validated_user = check(password)',
    'def check(token):\n    validated_user = check(token)',
    `const auth:\n    source: ${password}`,
    `password:\n  validated_user = check(password)\n  value: ${token}`,
    `password:\n  call(source: ${password})\n  current: ${token}`,
    `password:\n  safe; source: ${password}\n  current: ${token}`,
    `password:\n  - source = ${password}\n  current: ${token}`,
    `password:\n  thing { source: ${password}\n  current: ${token}`
  ]) quiet(text);
});

test('inline flow values in a YAML block use the established object/list walk', () => {
  exact(`credentials:\n  settings: {value: "${password}"}\n  token: ["${token}"]\nnext:\n  bucket: customer-uploads-eu`,
    [[password, 2], [token, 3]]);
  quiet(`credentials:\n  token: [${token}`);
});

test('block scalars remain an honest limit while PEM provider detection still works', () => {
  for (const indicator of ['|', '>']) {
    quiet(`password: ${indicator}\n  ${password}\n  value: ${token}`);
    quiet(`credentials:\n  source: ${indicator}\n    value: ${token}\n  label: short`);
  }
  const block = '-----BEGIN PRIVATE KEY-----\n  SYNTHETIC-PEM-BODY\n  -----END PRIVATE KEY-----';
  const text = `password: |\n  ${block}\n`;
  const hits = findSecrets(text);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].pattern, 'private key');
  assert.equal(hits[0].value, block);
  assert.equal(hits[0].line, 2);
  assert.deepEqual(findNestedReview(text), []);
});

test('CRLF and tab indentation preserve the value line and stop at a sibling', () => {
  exact(`token:\r\n\tcurrent: '${token}'\r\nnext:\r\n\tbucket: customer-uploads-eu`, [[token, 2]]);
  exact(`credentials:\n\tvalue:\n\t\tcurrent: ${password}\n\tsource: ${token}\nnext:\n\tbucket: customer-uploads-eu`,
    [[password, 3]], [[token, 4, 'source']]);
});

test('supported depth 64 stays bounded and inherits each value once', () => {
  const text = 'password:\n' + Array.from({ length: 63 }, (_, index) => `${' '.repeat(index + 1)}child:\n`).join('') +
    `${' '.repeat(64)}value: ${password}`;
  exact(text, [[password, 65]]);
});

test('YAML blocks crossing a one MiB scan window produce complete masked values once', async t => {
  const MiB = 1024 * 1024;
  const body = `password:\n  value: ${password}\n  source: ${token}\nnext:\n  bucket: customer-uploads-eu`;
  const prefix = '#'.repeat(MiB - 25) + '\n';
  const text = prefix + body;
  const output = await scan(t, { 'crossing.yaml': text });
  assert.equal(output.split(`crossing.yaml:3  `).length - 1, 1, 'one confirmed value on its complete line');
  assert.ok(output.includes(`  line 4  password.source = ${maskValue(token)}`), 'crossing by-eye value keeps its line');
  assert.equal(output.split(maskValue(password)).length - 1, 1, 'confirmed crossing value appears once');
  assert.equal(output.split(maskValue(token)).length - 1, 1, 'by-eye crossing value appears once');
  assert.ok(!output.includes(password) && !output.includes(token), 'no complete synthetic value is displayed');
  assert.ok(!output.includes('customer-uploads-eu'), 'outside sibling is untouched');
});

test('YAML probe preserves quoted scalar fallback when no YAML child was consumed', () => {
  exact(`password:\n    "${password}"`, [[password, 2]]);
  exact(`password:\n\n    "${password}"`, [[password, 3]]);
});

test('flow arrays keep the YAML field key while object leaves use their own keys', () => {
  exact(`credentials:\n  region: ["eu-west-1", {current: "${token}"}]`,
    [[token, 2]], [['eu-west-1', 2, 'region']]);
});

test('unclosed inline flows cannot inherit into YAML siblings', () => {
  quiet('password:\n  value: ["tiny"\nnext_section:\n  bucket: "customer-uploads-eu"');
  exact('password:\n  value: [tiny\n  label: "customer-uploads-eu"', [], [['customer-uploads-eu', 3, 'label']]);
});

test('content beyond the YAML depth cap retains independent scalar detection', () => {
  const text = 'password:\n' + Array.from({ length: 64 }, (_, index) => `${' '.repeat(index + 1)}child:\n`).join('') +
    `${' '.repeat(65)}password: ${password}`;
  exact(text, [[password, 66]]);
});

test('flow comments stay quiet and following list-map entries keep their own key', () => {
  quiet(`credentials:\n  region: [] # current: "${token}"`);
  quiet(`credentials:\n  region: {label: "short"} # "${token}"`);
  exact(`credentials:\n  - value: [${password}]\n    source: ordinary-label-1234`,
    [[password, 2]], [['ordinary-label-1234', 3, 'source']]);
});

test('YAML doubled single quotes retain the complete value when masking', () => {
  exact("credentials:\n  value: 'firstpart99''secondpart99'", [["firstpart99''secondpart99", 2]]);
});
