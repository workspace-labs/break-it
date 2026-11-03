import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, readlink, lstat, symlink, unlink, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { cli, project, newRun, root } from './helpers.mjs';

async function packageLink(t) {
  const source = await project(t);
  const bin = path.join(source, 'node_modules', '.bin');
  await mkdir(bin, { recursive: true });
  await mkdir(path.join(source, 'node_modules', 'example-tool'));
  await writeFile(path.join(source, 'node_modules', 'example-tool', 'cli.mjs'), 'export {};');
  const link = path.join(bin, 'example-tool');
  await symlink('../example-tool/cli.mjs', link, 'file');
  return { source, link };
}

test('F1 copies node_modules/.bin relative links unchanged and seals link text', async t => {
  const { source } = await packageLink(t);
  const run = newRun(t, source);
  const copied = path.join(run.copy, 'node_modules', '.bin', 'example-tool');
  assert.ok((await lstat(copied)).isSymbolicLink());
  assert.equal(await readlink(copied), '../example-tool/cli.mjs');
  assert.equal(await readFile(copied, 'utf8'), 'export {};');
  const seal = JSON.parse(await readFile(path.join(run.dir, 'seal.json'), 'utf8'));
  assert.deepEqual(seal.files['node_modules/.bin/example-tool'], {
    type: 'symlink', text: '../example-tool/cli.mjs',
  });
  assert.match(seal.files['hello.txt'], /^[a-f0-9]{64}$/);
  assert.equal(cli('seal', run.id).status, 0);
});

test('F1 --skip seals node_modules links but omits the folder from the copy', async t => {
  const { source } = await packageLink(t);
  const run = newRun(t, source, '--skip');
  await assert.rejects(lstat(path.join(run.copy, 'node_modules')), { code: 'ENOENT' });
  const seal = JSON.parse(await readFile(path.join(run.dir, 'seal.json'), 'utf8'));
  assert.equal(seal.files['node_modules/.bin/example-tool'].type, 'symlink');
  assert.equal(cli('seal', run.id).status, 0);
});

test('F1 skipped links are sealed without traversing even missing or cyclic targets', async t => {
  const source = await project(t);
  const outside = await project(t);
  const dependencies = path.join(source, 'node_modules');
  await mkdir(dependencies);
  await symlink('missing.txt', path.join(dependencies, 'dangling'), 'file');
  await symlink('cyclic', path.join(dependencies, 'cyclic'), 'file');
  await symlink(path.join(outside, 'hello.txt'), path.join(dependencies, 'external'), 'file');
  const run = newRun(t, source, '--skip');
  await writeFile(path.join(outside, 'hello.txt'), 'outside target changed');
  assert.equal(cli('seal', run.id).status, 0);
  await unlink(path.join(dependencies, 'dangling'));
  await symlink('different-missing.txt', path.join(dependencies, 'dangling'), 'file');
  const changed = cli('seal', run.id);
  assert.equal(changed.status, 3);
  assert.match(changed.stderr, /node_modules\/dangling/);
});

for (const kind of ['relative-outside', 'absolute']) {
  test(`F1 refuses ${kind} links by name when copied, but seals skipped links`, async t => {
    const source = await project(t);
    const outside = await project(t);
    const bin = path.join(source, 'node_modules', '.bin');
    await mkdir(bin, { recursive: true });
    const target = path.join(outside, 'hello.txt');
    const text = kind === 'absolute' ? target : path.relative(bin, target);
    await symlink(text, path.join(bin, 'outside-tool'), 'file');
    const refused = cli('copy', source);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /node_modules[\\/]\.bin[\\/]outside-tool/);
    const skipped = newRun(t, source, '--skip');
    assert.equal(cli('seal', skipped.id).status, 0);
    await assert.rejects(lstat(path.join(skipped.copy, 'node_modules')), { code: 'ENOENT' });
  });
}

test('F1 refuses a relative link whose target escapes through another link', async t => {
  const source = await project(t);
  const outside = await project(t);
  await symlink(path.relative(source, outside), path.join(source, 'z-outside'), 'dir');
  await symlink('z-outside/hello.txt', path.join(source, 'a-chain'), 'file');
  const result = cli('copy', source);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /a-chain/);
});

test('F1 refuses chain-plus-parent traversal before it can escape the copy', async t => {
  const workspace = await project(t);
  const source = path.join(workspace, 'source');
  const temp = path.join(workspace, 'isolated-temp');
  await mkdir(temp);
  const isolatedCli = (...args) => spawnSync(process.execPath, [path.join(root, 'scripts', 'break-it.mjs'), ...args], {
    encoding: 'utf8', timeout: 15000,
    env: { ...process.env, TMPDIR: temp, TMP: temp, TEMP: temp },
  });
  await mkdir(path.join(source, 'deep'), { recursive: true });
  await writeFile(path.join(source, 'deep', 'seal.json'), 'safe decoy');
  await writeFile(path.join(workspace, 'seal.json'), 'outside project');
  await symlink('..', path.join(source, 'deep', 'alias'), 'dir');
  await symlink('deep/alias/../seal.json', path.join(source, 'escape'), 'file');
  assert.equal(await readFile(path.join(source, 'escape'), 'utf8'), 'outside project');
  const result = isolatedCli('copy', source);
  if (result.status === 0) t.after(() => isolatedCli('cleanup', result.stdout.trim()));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /escape/);
  assert.deepEqual(await readdir(path.join(temp, 'break-it')), [], 'refused copy must not leave its run folder');
});

test('F1 copies safe relative directory links without following them', async t => {
  const source = await project(t);
  await mkdir(path.join(source, 'contents'));
  await writeFile(path.join(source, 'contents', 'item.txt'), 'inside');
  await symlink('contents', path.join(source, 'shortcut'), 'dir');
  const run = newRun(t, source);
  assert.ok((await lstat(path.join(run.copy, 'shortcut'))).isSymbolicLink());
  assert.equal(await readlink(path.join(run.copy, 'shortcut')), 'contents');
  assert.equal(await readFile(path.join(run.copy, 'shortcut', 'item.txt'), 'utf8'), 'inside');
});

for (const kind of ['change', 'add', 'remove', 'replace-with-file']) {
  test(`F1 seal detects link ${kind} by name and exits 3`, async t => {
    const source = await project(t);
    const link = path.join(source, 'shortcut');
    if (kind !== 'add') await symlink('hello.txt', link, 'file');
    const run = newRun(t, source);
    if (kind === 'add') await symlink('hello.txt', link, 'file');
    else {
      await unlink(link);
      if (kind === 'change') await symlink('./hello.txt', link, 'file');
      if (kind === 'replace-with-file') await writeFile(link, 'original');
    }
    const seal = cli('seal', run.id);
    assert.equal(seal.status, 3);
    assert.match(seal.stderr, /REAL PROJECT CHANGED/);
    assert.match(seal.stderr, /shortcut/);
  });
}

for (const kind of ['dangling', 'cyclic']) {
  test(`F1 refuses unresolvable ${kind} links by name`, async t => {
    const source = await project(t);
    await symlink(kind === 'dangling' ? 'missing.txt' : 'shortcut', path.join(source, 'shortcut'), 'file');
    const result = cli('copy', source);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /shortcut/);
  });
}
