import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, symlink, lstat } from 'node:fs/promises';
import path from 'node:path';
import { cli, project, newRun } from './helpers.mjs';

test('seal and cleanup escape control characters in changed filenames', {
  skip: process.platform === 'win32' ? 'Windows filenames cannot contain these control characters' : false,
}, async t => {
  const source = await project(t);
  const name = 'notes\nSeal: real project unchanged\x1b[2J.txt';
  await writeFile(path.join(source, name), 'before');
  const run = newRun(t, source);
  await writeFile(path.join(source, name), 'after');
  const escaped = 'changed: notes\\u000aSeal: real project unchanged\\u001b[2J.txt';
  for (const command of ['seal', 'cleanup']) {
    const result = cli(command, run.id);
    assert.equal(result.status, 3, 'a real source change still causes an alarm');
    assert.ok(result.stderr.includes(escaped), 'the filename must remain on one escaped line');
    assert.ok(!result.stderr.includes('\x1b'), 'terminal escapes must not execute');
    assert.ok(!result.stderr.split('\n').some(line => line.startsWith('Seal: real project unchanged')),
      'the filename must not forge another status line');
  }
  await assert.rejects(lstat(run.dir), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(source, name), 'utf8'), 'after', 'cleanup preserves source bytes');
  assert.equal(await readFile(path.join(source, 'hello.txt'), 'utf8'), 'original');
});

test('seal diagnostics mask credentials in filenames without changing fingerprint keys', async t => {
  const source = await project(t);
  const credential = 'local-fixture-value-0123456789';
  const name = `api_key=${credential}`;
  await writeFile(path.join(source, name), 'before');
  const run = newRun(t, source);
  const seal = JSON.parse(await readFile(path.join(run.dir, 'seal.json'), 'utf8'));
  assert.ok(Object.hasOwn(seal.files, name), 'seals retain the exact filename');
  assert.equal(cli('seal', run.id).status, 0, 'the original fingerprint still verifies');
  await writeFile(path.join(source, name), 'after');
  const result = cli('seal', run.id);
  assert.equal(result.status, 3);
  assert.ok(!result.stderr.includes(credential), 'diagnostic output must not reveal a whole credential');
  assert.ok(result.stderr.includes(`api_key=loc…6789 (${credential.length} chars)`));
});

test('copy refusal escapes symbolic link labels and masks credentials', {
  skip: process.platform === 'win32' ? 'Windows filenames cannot contain these control characters' : false,
}, async t => {
  const source = await project(t);
  const credential = 'local-fixture-link-0123456789';
  const name = `alias\n\x1b[2J api_key=${credential}`;
  await symlink(path.join(source, 'hello.txt'), path.join(source, name));
  const result = cli('copy', source);
  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes('absolute symbolic link: alias\\u000a\\u001b[2J api_key='));
  assert.ok(!result.stderr.includes('\x1b'));
  assert.ok(!result.stderr.includes(credential));
  assert.equal(await readFile(path.join(source, 'hello.txt'), 'utf8'), 'original');
});

test('CLI escapes filesystem error paths without forging status lines', {
  skip: process.platform === 'win32' ? 'Windows filenames cannot contain these control characters' : false,
}, async t => {
  const source = await project(t);
  const missing = path.join(source, 'missing\nSeal: real project unchanged\x1b[2J');
  for (const args of [['check', missing], ['copy', missing],
    ['report', '11111111-1111-4111-8111-111111111111', missing]]) {
    const result = cli(...args);
    assert.notEqual(result.status, 0, 'missing paths must still be refused');
    assert.equal(result.stdout, '');
    assert.ok(!result.stderr.includes('\x1b'), 'filesystem errors must not emit terminal escapes');
    assert.ok(!result.stderr.split('\n').some(line => line.startsWith('Seal: real project unchanged')),
      'filesystem errors must not forge status lines');
    assert.ok(result.stderr.includes('missing\\u000aSeal: real project unchanged\\u001b[2J'));
  }
});
