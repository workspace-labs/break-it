import test from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { writeFile, readFile, unlink, mkdir, symlink, lstat } from 'node:fs/promises';
import path from 'node:path';
import { cli, project, newRun } from './helpers.mjs';

for (const url of ['https://example.com', 'http://192.168.1.5', 'http://localhost.example.com',
  'http://127.1', 'http://2130706433', 'file:///etc/passwd', 'http://user@localhost:4000']) {
  test(`W1 refuses ${url}`, async t => {
    const p = await project(t);
    const result = cli('check', p, '--url', url);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Refused: break-it only attacks a local copy, never a live site\./);
  });
}
for (const p of [homedir(), '/', 'C:\\', '\\\\server\\share']) {
  test(`W1 refuses dangerous path ${p}`, () => assert.notEqual(cli('check', p).status, 0));
}
for (const host of ['localhost', '127.0.0.1', '[::1]']) {
  test(`W1 accepts local project and ${host}`, async t => {
    assert.equal(cli('check', await project(t), '--url', `http://${host}:4000`).status, 0);
  });
}
test('copy defaults to all files, optional skip never weakens real seal', async t => {
  const p = await project(t);
  await mkdir(path.join(p, 'node_modules'));
  await writeFile(path.join(p, 'node_modules', 'file'), 'dependency');
  const all = newRun(t, p);
  assert.equal(await readFile(path.join(all.copy, 'node_modules', 'file'), 'utf8'), 'dependency');
  const skipped = newRun(t, p, '--skip');
  await assert.rejects(lstat(path.join(skipped.copy, 'node_modules')), { code: 'ENOENT' });
  assert.equal(cli('seal', all.id).status, 0);
  await writeFile(path.join(p, 'node_modules', 'file'), 'changed');
  assert.equal(cli('seal', skipped.id).status, 3);
});
for (const kind of ['edit', 'add', 'delete']) {
  test(`W3 seal catches real file ${kind}`, async t => {
    const p = await project(t);
    const run = newRun(t, p);
    assert.match(cli('seal', run.id).stdout, /Seal: real project unchanged/);
    if (kind === 'delete') await unlink(path.join(p, 'hello.txt'));
    else await writeFile(path.join(p, kind === 'add' ? 'added.txt' : 'hello.txt'), 'changed');
    const result = cli('seal', run.id);
    assert.equal(result.status, 3);
    assert.match(result.stderr, /REAL PROJECT CHANGED/);
    assert.match(result.stderr, kind === 'add' ? /added.txt/ : /hello.txt/);
  });
}
test('W2 refuses links instead of giving the copy access to the real project', async t => {
  const p = await project(t);
  await symlink(path.join(p, 'hello.txt'), path.join(p, 'alias'), 'file');
  const result = cli('copy', p);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /symbolic link/i);
});
test('W5 cleanup removes one run and leaves its sibling and real data alone', async t => {
  const p = await project(t);
  const a = newRun(t, p);
  const b = newRun(t, p);
  const result = cli('cleanup', a.id);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Copy deleted\. Nothing left behind\./);
  await assert.rejects(lstat(a.dir), { code: 'ENOENT' });
  assert.ok((await lstat(b.copy)).isDirectory());
  assert.equal(await readFile(path.join(p, 'hello.txt'), 'utf8'), 'original');
  assert.notEqual(cli('cleanup', p).status, 0);
  assert.notEqual(cli('cleanup', '../escape').status, 0);
});
test('W5 cleanup refuses a run redirected outside the base through a symlink', async t => {
  const { randomUUID } = await import('node:crypto');
  const { tmpdir } = await import('node:os');
  const p = await project(t);
  const id = randomUUID();
  const link = path.join(tmpdir(), 'break-it', id);
  await mkdir(path.dirname(link), { recursive: true });
  await symlink(p, link, 'junction');
  t.after(() => unlink(link));
  assert.notEqual(cli('cleanup', id).status, 0);
  assert.equal(await readFile(path.join(p, 'hello.txt'), 'utf8'), 'original');
});
