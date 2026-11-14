import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { makeFile, openMadeFile } from '../scripts/lib/files.mjs';
import { project, newRun, cli } from './helpers.mjs';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

test('medium-png is exactly 100 KiB, valid and harmless, only inside the guarded run files folder', async t => {
  const source = await project(t);
  const run = newRun(t, source);
  t.after(() => cli('cleanup', run.id));
  const before = (await readdir(run.dir)).sort();
  const made = await makeFile(run.id, 'medium-png');
  assert.equal(made.name, 'medium.png');
  assert.equal(made.type, 'image/png');
  assert.equal(made.bytes, 102400);
  const png = await readFile(path.join(run.dir, 'files', made.name));
  assert.equal(png.length, 102400);
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const chunks = [];
  let offset = 8;
  while (offset < png.length) {
    assert.ok(offset + 12 <= png.length, 'complete chunk framing');
    const length = png.readUInt32BE(offset);
    assert.ok(offset + length + 12 <= png.length, 'complete bounded chunk');
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + length + 8);
    assert.equal(png.readUInt32BE(offset + length + 8), crc32(png.subarray(offset + 4, offset + length + 8)));
    chunks.push({ type, data });
    offset += length + 12;
  }
  assert.equal(offset, png.length);
  assert.equal(chunks[0].type, 'IHDR');
  assert.equal(chunks.at(-1).type, 'IEND');
  const ihdr = chunks[0].data;
  assert.equal(ihdr.readUInt32BE(0), 1);
  assert.equal(ihdr.readUInt32BE(4), 1);
  assert.equal(ihdr[8], 8);
  assert.equal(ihdr[9], 6);
  const image = inflateSync(Buffer.concat(chunks.filter(c => c.type === 'IDAT').map(c => c.data)), { maxOutputLength: 10 });
  assert.deepEqual(image, Buffer.from([0, 40, 110, 180, 255]));
  assert.ok(chunks.every(c => ['IHDR', 'IDAT', 'tEXt', 'IEND'].includes(c.type)), 'no executable or unknown chunk type');
  const text = chunks.filter(c => c.type === 'tEXt').map(c => c.data.toString('latin1')).join('');
  assert.match(text, /^Padding\0a+$/);
  assert.doesNotMatch(text, /script|https?:|fetch|import|XMLHttpRequest/i);
  const opened = await openMadeFile(run.id, made.name);
  assert.equal(opened.bytes, 102400);
  assert.equal(opened.kind, 'medium-png');
  await opened.handle.close();
  assert.deepEqual((await readdir(run.dir)).sort(), [...before, 'files'].sort());
  assert.deepEqual(await readdir(path.join(run.dir, 'files')), ['medium.png']);
  assert.deepEqual(await readdir(source), ['hello.txt']);
});

test('make CLI advertises medium-png in its fixed refusal list and makes it without size customization', async t => {
  const run = newRun(t, await project(t));
  t.after(() => cli('cleanup', run.id));
  const refused = cli('make', run.id, 'own-file');
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /Valid kinds:.*medium-png/);
  const sized = cli('make', run.id, 'medium-png', '--mb', '1');
  assert.equal(sized.status, 1);
  assert.match(sized.stderr, /--mb applies only to big/);
  const made = cli('make', run.id, 'medium-png');
  assert.equal(made.status, 0, made.stderr);
  assert.match(made.stdout, /^medium\.png  102400  /);
});
