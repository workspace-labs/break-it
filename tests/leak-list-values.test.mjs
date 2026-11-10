import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { findSecrets, findNestedReview, redactSecrets, maskValue } from '../scripts/lib/leaks.mjs';
import { cli, project, newRun } from './helpers.mjs';

const first = 'aB3dE5fG7hJ9kL';
const second = 'Qw8Er7Ty6Ui5';
const password = 'Hunter2Hunter2';
const apiKey = 'Zq9mK2pL7xWqRt';
const dbPassword = 'S3cretPassw0rd99';

function exactHits(text, expected) {
  const hits = findSecrets(text);
  assert.deepEqual(hits.map(({ pattern, value }) => [pattern, value]), expected);
  for (const hit of hits) {
    assert.equal(text.slice(hit.index, hit.index + hit.value.length), hit.value, 'span covers only its element');
    assert.equal(hit.line, text.slice(0, hit.index).split('\n').length, 'source line is exact');
  }
  return hits;
}

for (const [description, text, expected] of [
  ['empty list', '{"secrets":[],"name":"shop-app"}', []],
  ['short words', '{"tokens":["the","cat"]}', []],
  ['short elements followed by name', '{"tokens":["a","b"],"name":"shop"}', []],
  ['short elements followed by apiKey', `{"tokens":["a","b"],"apiKey":"${apiKey}"}`, [['generic apikey', apiKey]]],
  ['two elements followed by db.password', `{"secrets":["${first}","${second}"],"db":{"password":"${dbPassword}"}}`,
    [['generic nested secrets', first], ['generic nested secrets', second], ['generic password', dbPassword]]],
  ['password element followed by label', `{"password":["${password}"],"label":"x"}`, [['generic nested password', password]]],
  ['spaced flow list', `password: ["${password}", "other"]`, [['generic nested password', password]]]
]) {
  test(`list values: ${description} has exact element-sized findings`, () => {
    exactHits(text, expected);
    assert.deepEqual(findNestedReview(text), []);
  });
}

test('list values: a multiline password list reports the element on its own line', () => {
  const text = `password:\n  [\n    "tiny",\n    "${password}"\n  ]\nlabel: ordinary`;
  const [hit] = exactHits(text, [['generic nested password', password]]);
  assert.equal(hit.line, 4);
});

test('list values: an unquoted flow element is found without its brackets', () => {
  exactHits(`password: [${password}]`, [['generic nested password', password]]);
});

test('list values: an assignment inside an unquoted element cannot swallow the following field', () => {
  const element = `password=${password}`;
  const text = `{"secrets":[${element}],"apiKey":"${apiKey}"}`;
  exactHits(text, [['generic nested secrets', element], ['generic apikey', apiKey]]);
  assert.equal(redactSecrets(text),
    `{"secrets":[${maskValue(element)}],"apiKey":"${maskValue(apiKey)}"}`);
});

test('list values: unquoted punctuation and inherited keys keep element classification', () => {
  const element = 'A1b2+/C3d4=';
  exactHits(`password=[${element}]`, [['generic nested password', element]]);
  const text = `auth={region:[${element}],current:[${password}]}`;
  exactHits(text, [['generic nested auth', password]]);
  const [review] = findNestedReview(text);
  assert.equal(findNestedReview(text).length, 1);
  assert.equal(review.key, 'region');
  assert.equal(review.value, element);
});

for (const value of ['process.env.A', 'null', 'true', '12']) {
  test(`list values: unquoted ${value} stays quiet`, () => {
    assert.deepEqual(findSecrets(`password: [${value}]`), []);
    assert.deepEqual(findNestedReview(`password: [${value}]`), []);
  });
}

test('list values: nested lists retain keyless-element confirmation and matching closes', () => {
  exactHits(`{"password":[["${first}"],["${second}"]],"apiKey":"${apiKey}"}`,
    [['generic nested password', first], ['generic nested password', second], ['generic apikey', apiKey]]);
});

test('list values: arrays of objects retain confirm versus by-eye classification', () => {
  const text = `{"secrets":[{"value":"${first}","label":"${second}"},{"password":"${password}"}],"apiKey":"${apiKey}"}`;
  exactHits(text, [['generic nested secrets', first], ['generic nested secrets', password], ['generic apikey', apiKey]]);
  const [review] = findNestedReview(text);
  assert.equal(findNestedReview(text).length, 1);
  assert.equal(review.key, 'label');
  assert.equal(review.parent, 'secrets');
  assert.equal(review.value, second);
});

test('list values: an unclosed list at end of text retains each complete element once', () => {
  exactHits(`password=["${first}", ["${second}"`, [['generic nested password', first], ['generic nested password', second]]);
});

test('list values: closing brackets and commas inside strings do not end the list', () => {
  const value = 'Hunter]2,Hunter2';
  exactHits(`{"password":["${value}","tiny"],"apiKey":"${apiKey}"}`,
    [['generic nested password', value], ['generic apikey', apiKey]]);
});

test('list values: escaped quotes preserve string bounds before a closing bracket', () => {
  const value = 'Hunter\\"2]Hunter2';
  exactHits(`{"password":["${value}"],"apiKey":"${apiKey}"}`,
    [['generic nested password', value], ['generic apikey', apiKey]]);
});

test('list values: every element keeps the existing filters and minimum-length option', () => {
  const text = 'password=["tiny","two words here","changeme","your-secret-here","${DB_PASSWORD}","123456789"]';
  exactHits(text, [['generic nested password', '123456789']]);
  assert.deepEqual(findSecrets(text, { minimumLength: 10 }), []);
  assert.deepEqual(findNestedReview(text), []);
});

test('list values: redactSecrets masks each element while preserving following fields exactly', () => {
  const text = `{"secrets":["${first}","${second}"],"label":"ordinary-label","apiKey":"${apiKey}"}`;
  assert.equal(redactSecrets(text),
    `{"secrets":["${maskValue(first)}","${maskValue(second)}"],"label":"ordinary-label","apiKey":"${maskValue(apiKey)}"}`);
});

test('list values: scan names and masks each element and the following apiKey separately', async t => {
  const source = await project(t);
  const text = `{"secrets":["${first}","${second}"],"label":"ordinary-label","apiKey":"${apiKey}"}`;
  await writeFile(path.join(source, 'lists.json'), text);
  const run = newRun(t, source);
  const result = cli('scan', run.id);
  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.trim().split('\n');
  assert.equal(lines.length, 3, 'scanner emits one line per element and following secret');
  for (const value of [first, second, apiKey]) {
    assert.ok(!result.stdout.includes(value));
    assert.equal(lines.filter(line => line.includes(maskValue(value))).length, 1);
  }
  assert.equal(lines.filter(line => line.startsWith('lists.json:1  generic nested secrets  ')).length, 2);
  assert.equal(lines.filter(line => line.startsWith('lists.json:1  generic apikey  ')).length, 1);
  assert.ok(!result.stdout.includes('ordinary-label'), 'ordinary label is not a credential finding');
  assert.equal(redactSecrets(text).includes('"label":"ordinary-label"'), true, 'source evidence preserves ordinary text');
});

test('list values: scan preserves whole element masks and following fields across a one MiB window', async t => {
  const source = await project(t);
  const prefix = '\n\n' + ' '.repeat(1024 * 1024 - 27);
  await writeFile(path.join(source, 'boundary.json'), prefix +
    `{"secrets":["${first}","${second}"],"apiKey":"${apiKey}"}`);
  const run = newRun(t, source);
  const result = cli('scan', run.id);
  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.trim().split('\n');
  assert.equal(lines.length, 3, 'crossing list and following field are not duplicated or swallowed');
  assert.ok(lines.every(line => line.startsWith('boundary.json:3  ')));
  for (const value of [first, second, apiKey]) {
    assert.ok(!result.stdout.includes(value));
    assert.equal(lines.filter(line => line.includes(maskValue(value))).length, 1);
  }
});
