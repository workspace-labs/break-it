import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, symlink, lstat } from 'node:fs/promises';
import path from 'node:path';
import { cli, project, newRun } from './helpers.mjs';

for (const folder of ['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next']) {
  test(`N1 absolute link inside ${folder} keeps its refusal and adds the skip hint`, async t => {
    const source = await project(t);
    await mkdir(path.join(source, folder));
    const relative = path.join(folder, 'absolute-link');
    await symlink(path.join(source, 'hello.txt'), path.join(source, relative), 'file');
    const result = cli('copy', source);
    assert.notEqual(result.status, 0);
    assert.equal(result.stderr.trim(), `Refused: absolute symbolic link: ${relative} It is inside ${folder}/; run copy again with --skip to leave that folder out.`);
    const run = newRun(t, source, '--skip');
    await assert.rejects(lstat(path.join(run.copy, folder)), { code: 'ENOENT' });
  });
}

test('N1 absolute link outside a skippable folder has the exact old refusal', async t => {
  const source = await project(t);
  await symlink(path.join(source, 'hello.txt'), path.join(source, 'absolute-link'), 'file');
  const result = cli('copy', source);
  assert.notEqual(result.status, 0);
  assert.equal(result.stderr.trim(), 'Refused: absolute symbolic link: absolute-link');
  assert.doesNotMatch(result.stderr, /--skip/);
});

test('N1 a root link merely named node_modules has no inside-folder hint', async t => {
  const source = await project(t);
  await symlink(path.join(source, 'hello.txt'), path.join(source, 'node_modules'), 'file');
  const result = cli('copy', source);
  assert.notEqual(result.status, 0);
  assert.equal(result.stderr.trim(), 'Refused: absolute symbolic link: node_modules');
});

test('N1 relative link with a lexical escape inside node_modules gets the same hint', async t => {
  const source = await project(t);
  const outside = await project(t);
  const folder = path.join(source, 'node_modules');
  await mkdir(folder);
  await symlink(path.relative(folder, path.join(outside, 'hello.txt')), path.join(folder, 'escape'), 'file');
  const result = cli('copy', source);
  assert.notEqual(result.status, 0);
  assert.equal(result.stderr.trim(), `Refused: symbolic link leads outside the project: ${path.join('node_modules', 'escape')} It is inside node_modules/; run copy again with --skip to leave that folder out.`);
});

test('N1 a physically escaping link inside node_modules gets the hint', async t => {
  const source = await project(t);
  const outside = await project(t);
  await mkdir(path.join(source, 'node_modules'));
  await symlink(path.relative(source, outside), path.join(source, 'z-outside'), 'dir');
  await symlink('../z-outside/hello.txt', path.join(source, 'node_modules', 'escape'), 'file');
  const result = cli('copy', source);
  assert.notEqual(result.status, 0);
  assert.equal(result.stderr.trim(), `Refused: symbolic link leads outside the project: ${path.join('node_modules', 'escape')} It is inside node_modules/; run copy again with --skip to leave that folder out.`);
});

test('N1 a nested skippable folder is recognized by its ancestor segment', async t => {
  const source = await project(t);
  const folder = path.join(source, 'packages', 'app', 'build');
  await mkdir(folder, { recursive: true });
  await symlink(path.join(source, 'hello.txt'), path.join(folder, 'absolute-link'), 'file');
  const result = cli('copy', source);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /It is inside build\/; run copy again with --skip to leave that folder out\./);
});
