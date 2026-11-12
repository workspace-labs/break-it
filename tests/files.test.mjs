import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, lstat, writeFile, symlink, link, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { makeFile, makeOptions, openMadeFile } from '../scripts/lib/files.mjs';
import { cleanupRun } from '../scripts/lib/cleanup.mjs';
import { project, newRun } from './helpers.mjs';

const MiB = 1024 * 1024;
const kinds = ['normal-png', 'big', 'fake-image', 'html-script', 'svg-script', 'zip-bomb', 'empty', 'truncated-png'];

test('make writes each fixed kind only inside the run files folder', async t => {
  const source = await project(t);
  const run = newRun(t, source);
  const before = await readdir(run.dir);
  const made = [];
  for (const kind of kinds) {
    const result = await makeFile(run.id, kind);
    assert.equal(result.kind, kind);
    assert.ok(!/[\\/]/.test(result.name));
    assert.equal((await lstat(path.join(run.dir, 'files', result.name))).size, result.bytes);
    assert.ok(result.type && result.description);
    made.push(result.name);
  }
  assert.deepEqual((await readdir(run.dir)).sort(), [...before, 'files'].sort());
  assert.deepEqual((await readdir(path.join(run.dir, 'files'))).sort(), made.sort());
  assert.deepEqual(await readdir(source), ['hello.txt']);
  assert.equal((await readFile(path.join(run.dir, 'files', 'normal.png'))).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal((await lstat(path.join(run.dir, 'files', 'big.bin'))).size, 20 * MiB);
  assert.equal((await lstat(path.join(run.dir, 'files', 'empty.png'))).size, 0);
  const normal = await readFile(path.join(run.dir, 'files', 'normal.png'));
  assert.deepEqual(await readFile(path.join(run.dir, 'files', 'truncated.png')), normal.subarray(0, Math.floor(normal.length / 2)));
});

test('make PNG control has valid chunk CRCs and one decodable pixel', async t => {
  const run = newRun(t, await project(t));
  const made = await makeFile(run.id, 'normal-png');
  const png = await readFile(path.join(run.dir, 'files', made.name));
  let offset = 8;
  const types = [];
  const chunks = [];
  const crc32 = bytes => {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  while (offset < png.length) {
    const size = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + size);
    assert.equal(png.readUInt32BE(offset + 8 + size), crc32(png.subarray(offset + 4, offset + 8 + size)));
    if (type === 'IHDR') { assert.equal(data.readUInt32BE(0), 1); assert.equal(data.readUInt32BE(4), 1); }
    if (type === 'IDAT') chunks.push(data);
    types.push(type);
    offset += 12 + size;
  }
  assert.deepEqual(types, ['IHDR', 'IDAT', 'IEND']);
  const { inflateSync } = await import('node:zlib');
  assert.equal(inflateSync(Buffer.concat(chunks), { maxOutputLength: 10 }).length, 5);
});

test('make big streams exact whole MiB up to 50 and refuses outside bounds', async t => {
  for (const mb of [1, 50]) {
    const run = newRun(t, await project(t));
    const made = await makeFile(run.id, 'big', { mb });
    assert.equal(made.bytes, mb * MiB);
    const opened = await openMadeFile(run.id, made.name);
    assert.equal(opened.kind, 'big');
    await opened.handle.close();
  }
  const run = newRun(t, await project(t));
  for (const mb of [51, -1, 0, 1.5, Infinity, NaN, 'x']) {
    await assert.rejects(makeFile(run.id, 'big', { mb }), /1.*50|whole|integer/i);
  }
  await assert.rejects(access(path.join(run.dir, 'files')));
  assert.deepEqual(makeOptions(['--mb', '50']), { mb: 50 });
  for (const args of [['--mb'], ['--mb', '1', '--mb', '2'], ['--wrong', '2'], ['--mb', '-1'], ['--mb', '51'], ['--mb', '1.5']]) {
    assert.throws(() => makeOptions(args));
  }
  await assert.rejects(makeFile(run.id, 'empty', { mb: 1 }), /only.*big/i);
});

test('make zip is one valid deflated zero entry of exactly 100 MiB below 1 MiB compressed', async t => {
  const run = newRun(t, await project(t));
  const made = await makeFile(run.id, 'zip-bomb');
  const zip = await readFile(path.join(run.dir, 'files', made.name));
  assert.ok(zip.length < MiB);
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.equal(zip.readUInt16LE(8), 8);
  assert.equal(zip.readUInt32LE(22), 100 * MiB);
  const compressedSize = zip.readUInt32LE(18);
  const nameSize = zip.readUInt16LE(26);
  const extraSize = zip.readUInt16LE(28);
  const name = zip.toString('utf8', 30, 30 + nameSize);
  assert.equal(name, 'zeros.bin');
  const start = 30 + nameSize + extraSize;
  const unpacked = inflateRawSync(zip.subarray(start, start + compressedSize), { maxOutputLength: 100 * MiB });
  assert.equal(unpacked.length, 100 * MiB);
  assert.equal(unpacked.some(byte => byte !== 0), false);
  const central = start + compressedSize;
  assert.equal(zip.readUInt32LE(central), 0x02014b50);
  assert.equal(zip.readUInt32LE(central + 16), zip.readUInt32LE(14));
  assert.equal(zip.readUInt32LE(central + 20), compressedSize);
  assert.equal(zip.readUInt32LE(central + 24), 100 * MiB);
  const end = zip.length - 22;
  assert.equal(zip.readUInt32LE(end), 0x06054b50);
  assert.equal(zip.readUInt16LE(end + 8), 1);
  assert.equal(zip.readUInt16LE(end + 10), 1);
  assert.equal(zip.readUInt32LE(end + 16), central);
  assert.equal(zip.readUInt32LE(end + 12), end - central);
});

test('make marker payloads have only a harmless title change and no external references', async t => {
  const run = newRun(t, await project(t));
  for (const kind of ['fake-image', 'html-script', 'svg-script']) {
    const made = await makeFile(run.id, kind);
    const text = await readFile(path.join(run.dir, 'files', made.name), 'utf8');
    // The standard SVG namespace is an identifier, not an outbound request.
    const executable = text.replace('xmlns="http://www.w3.org/2000/svg"', '');
    assert.doesNotMatch(executable, /<script\s+src\s*=|\bfetch\s*\(|XMLHttpRequest|https?:\/\/|\bimport\s*\(/i);
    if (kind === 'fake-image') assert.match(text, /<html|<!doctype html/i);
    else {
      const scripts = [...text.matchAll(/<script>([\s\S]*?)<\/script>/g)];
      assert.equal(scripts.length, 1);
      assert.equal(scripts[0][1].trim(), 'document.title = "break-it";');
    }
  }
});

test('make refuses unknown kind and unsafe run ids before creating files', async t => {
  const run = newRun(t, await project(t));
  await assert.rejects(makeFile(run.id, 'own-file'), error => kinds.every(kind => error.message.includes(kind)));
  for (const id of ['../outside', '/tmp/x', 'ABC', '']) await assert.rejects(makeFile(id, 'empty'), /run id/);
  await assert.rejects(access(path.join(run.dir, 'files')));
});

test('generated-file access refuses traversal, missing and manually replaced content', async t => {
  const run = newRun(t, await project(t));
  const made = await makeFile(run.id, 'normal-png');
  for (const name of ['../normal.png', '/normal.png', 'x/normal.png', 'x\\normal.png', '..', 'normal..png', 'absent.png']) {
    await assert.rejects(openMadeFile(run.id, name));
  }
  await writeFile(path.join(run.dir, 'files', made.name), 'not a made PNG');
  await assert.rejects(openMadeFile(run.id, made.name), /generated|made|modified|built-in/i);
  await writeFile(path.join(run.dir, 'files', 'own.png'), 'personal bytes');
  await assert.rejects(openMadeFile(run.id, 'own.png'));
});

test('make and generated-file access refuse symbolic and hard links without touching targets', async t => {
  const source = await project(t);
  const run = newRun(t, source);
  const files = path.join(run.dir, 'files');
  await mkdir(files);
  const target = path.join(source, 'hello.txt');
  await symlink(target, path.join(files, 'normal.png'));
  await assert.rejects(makeFile(run.id, 'normal-png'));
  await assert.rejects(openMadeFile(run.id, 'normal.png'), /link|regular/i);
  await link(target, path.join(files, 'empty.png'));
  await assert.rejects(makeFile(run.id, 'empty'));
  await assert.rejects(openMadeFile(run.id, 'empty.png'), /link|regular/i);
  assert.equal(await readFile(target, 'utf8'), 'original');
  const run2 = newRun(t, source);
  await symlink(source, path.join(run2.dir, 'files'), 'dir');
  await assert.rejects(makeFile(run2.id, 'empty'), /link|folder/i);
  await assert.rejects(openMadeFile(run2.id, 'hello.txt'), /link|folder/i);
  assert.deepEqual(await readdir(source), ['hello.txt']);
});

test('make never overwrites an existing file; cleanup removes generated files with the run', async t => {
  const run = newRun(t, await project(t));
  const made = await makeFile(run.id, 'empty');
  await assert.rejects(makeFile(run.id, 'empty'), /exist|already/i);
  const opened = await openMadeFile(run.id, made.name);
  assert.equal(opened.bytes, 0);
  await opened.handle.close();
  await cleanupRun(run.id);
  await assert.rejects(access(run.dir));
});
