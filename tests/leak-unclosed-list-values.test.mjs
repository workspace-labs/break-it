import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { findSecrets, findNestedReview } from '../scripts/lib/leaks.mjs';
import { cli, project, newRun } from './helpers.mjs';

const value = 'Zq9mK2pL7xWqRt';
const innerValue = 'N7estedSynthet1c';
const quotedValue = 'Tr0ub4dor-9912';
const setup = '# Setup notes\n\nTo log in, set password=[ then press enter.\n\n' +
  'region_name: eu_central_1\nbucket_name: customer_uploads_eu\nbuild_cache: node_modules_cache_v2\n';

function values(text) {
  return findSecrets(text).map(hit => hit.value);
}
function quiet(text) {
  assert.deepEqual(findSecrets(text), [], 'no confirmed generic candidate');
  assert.deepEqual(findNestedReview(text), [], 'no unclosed by-eye candidate');
}
async function scan(t, name, text) {
  const source = await project(t);
  await writeFile(path.join(source, name), text);
  const run = newRun(t, source);
  const result = cli('scan', run.id);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test('unclosed lists: setup prose has no confirmed or by-eye findings', () => quiet(setup));

test('unclosed lists: real scan of SETUP.md reports no secrets', async t => {
  assert.equal(await scan(t, 'SETUP.md', setup), 'No secrets found');
});

test('unclosed lists: a closed unquoted API_KEYS list keeps its credential and ignores the read', () => {
  const text = `API_KEYS=[${value},process.env.BACKUP_KEY]`;
  assert.deepEqual(values(text), [value]);
  assert.equal(findSecrets(text)[0].pattern, 'generic nested api_keys');
  assert.deepEqual(findNestedReview(text), []);
});

test('unclosed lists: a closed inner list counts even while its parent stays open', () => {
  assert.deepEqual(values(`secrets: [[${value}]`), [value]);
});

test('unclosed lists: a quoted value in an unclosed object keeps the older behavior', () => {
  assert.deepEqual(values(`{"password":{"value":"${quotedValue}"`), [quotedValue]);
});

for (const [description, suffix] of [['text end', ''], ['mismatched close', '}']]) {
  test(`unclosed lists: an unquoted candidate is dropped at ${description}`, () => {
    quiet(`tokens: [${value}${suffix}`);
  });
  test(`unclosed lists: an inherited by-eye candidate is dropped at ${description}`, () => {
    quiet(`auth={region:[${value}${suffix}`);
  });
}

test('unclosed lists: closed inherited candidates retain by-eye classification', () => {
  const text = `auth={region:[${value}]}`;
  assert.deepEqual(values(text), []);
  const review = findNestedReview(text);
  assert.equal(review.length, 1);
  assert.equal(review[0].key, 'region');
  assert.equal(review[0].value, value);
});

test('unclosed lists: inner closed by-eye list survives its open outer list', () => {
  const text = `auth={region:[[${value}]`;
  assert.deepEqual(values(text), []);
  const review = findNestedReview(text);
  assert.equal(review.length, 1);
  assert.equal(review[0].key, 'region');
  assert.equal(review[0].value, value);
});

for (const [description, suffix] of [['open parent', ''], ['mismatched parent', '}']]) {
  test(`unclosed lists: ${description} drops only its own candidate after an inner list closes`, () => {
    assert.deepEqual(values(`secrets: [${value},[${innerValue}]${suffix}`), [innerValue]);
  });
}

test('unclosed lists: quoted elements still count without committing nearby unquoted text', () => {
  assert.deepEqual(values(`tokens: [${value},"${quotedValue}"`), [quotedValue]);
});

test('unclosed lists: a bracket inside a quoted element cannot close the unquoted candidate frame', () => {
  const quoted = 'quoted]Synthetic1';
  assert.deepEqual(values(`tokens: [${value},"${quoted}"`), [quoted]);
});

test('unclosed lists: an open frame beyond the cap does not commit a held candidate', () => {
  quiet('secrets: ' + '['.repeat(64) + value + ',[');
});

test('unclosed lists: a matching inner close at frame 64 commits only that frame', () => {
  assert.deepEqual(values('secrets: ' + '['.repeat(63) + value + ',[' + innerValue + ']'), [innerValue]);
});

test('unclosed lists: real scan drops an unclosed unquoted list across the one MiB window', async t => {
  const text = '\n' + ' '.repeat(1024 * 1024 - 13) + 'password=[\n' +
    'item_name: ordinary_long_value\n'.repeat(40);
  assert.equal(await scan(t, 'notes.md', text), 'No secrets found');
});


for (const [description, suffix] of [['text end', ''], ['mismatched close', '}']]) {
  test(`unclosed lists: scalar fallback cannot revive an assignment-like element at ${description}`, () => {
    quiet(`secrets: [password=Hunter2Hunter2${suffix}`);
    quiet(`auth={region:[password=Hunter2Hunter2${suffix}`);
  });
}

test('unclosed lists: crossing the frame cap invalidates pending candidates even before later closes', () => {
  quiet(`secrets: [${value},` + '['.repeat(64) + ']'.repeat(65));
});
