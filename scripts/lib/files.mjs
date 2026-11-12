import { mkdir, lstat, realpath, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { createDeflateRaw, deflateSync } from 'node:zlib';
import { Readable } from 'node:stream';
import path from 'node:path';
import { readSeal } from './runs.mjs';

const MiB = 1024 * 1024;
const chunkSize = 64 * 1024;
const zeroChunk = Buffer.alloc(chunkSize);
const definitions = {
  'normal-png': ['normal.png', 'image/png', 'tiny valid PNG control'],
  big: ['big.bin', 'application/octet-stream', 'bounded file of zeros'],
  'fake-image': ['photo.jpg', 'image/jpeg', 'HTML text named as a JPEG'],
  'html-script': ['marker.html', 'text/html', 'HTML with a harmless title marker'],
  'svg-script': ['marker.svg', 'image/svg+xml', 'SVG with a harmless title marker'],
  'zip-bomb': ['zeros.zip', 'application/zip', 'one 100 MiB zero entry, no nested archive'],
  empty: ['empty.png', 'image/png', 'empty PNG file'],
  'truncated-png': ['truncated.png', 'image/png', 'valid control PNG cut in half'],
};

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});
function crcUpdate(crc, bytes) {
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return crc >>> 0;
}
function pngChunk(type, data) {
  const name = Buffer.from(type);
  const bytes = Buffer.alloc(12 + data.length);
  bytes.writeUInt32BE(data.length);
  name.copy(bytes, 4);
  data.copy(bytes, 8);
  bytes.writeUInt32BE((crcUpdate(0xffffffff, Buffer.concat([name, data])) ^ 0xffffffff) >>> 0, 8 + data.length);
  return bytes;
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(1, 0);
ihdr.writeUInt32BE(1, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const normalPng = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), pngChunk('IHDR', ihdr),
  pngChunk('IDAT', deflateSync(Buffer.from([0, 40, 110, 180, 255]))), pngChunk('IEND', Buffer.alloc(0))]);
const fixedBytes = {
  'normal-png': normalPng,
  'fake-image': Buffer.from('<!doctype html><html><title>break-it marker</title><body>Harmless file-type control.</body></html>\n'),
  'html-script': Buffer.from('<!doctype html><html><body><script>document.title = "break-it";</script></body></html>\n'),
  'svg-script': Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><script>document.title = "break-it";</script><rect width="1" height="1"/></svg>\n'),
  empty: Buffer.alloc(0),
  'truncated-png': normalPng.subarray(0, Math.floor(normalPng.length / 2)),
};

let zipBytes;
async function makeZip() {
  const size = 100 * MiB;
  let crc = 0xffffffff;
  async function* zeros() {
    for (let position = 0; position < size; position += chunkSize) {
      crc = crcUpdate(crc, zeroChunk);
      yield zeroChunk;
    }
  }
  const chunks = [];
  let compressedSize = 0;
  for await (const chunk of Readable.from(zeros()).pipe(createDeflateRaw({ level: 9 }))) {
    compressedSize += chunk.length;
    if (compressedSize > MiB - 1024) throw new Error('Refused: generated archive exceeded its compressed cap.');
    chunks.push(chunk);
  }
  const compressed = Buffer.concat(chunks);
  const checksum = (crc ^ 0xffffffff) >>> 0;
  const name = Buffer.from('zeros.bin');
  const local = Buffer.alloc(30 + name.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(0x21, 12);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(size, 22);
  local.writeUInt16LE(name.length, 26);
  name.copy(local, 30);
  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(0x21, 14);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(size, 24);
  central.writeUInt16LE(name.length, 28);
  name.copy(central, 46);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length + compressed.length, 16);
  return Buffer.concat([local, compressed, central, end]);
}
async function payload(kind) {
  if (kind === 'zip-bomb') return zipBytes ??= await makeZip();
  return fixedBytes[kind];
}

function bigSize(mb = 20) {
  if (!Number.isInteger(mb) || mb < 1 || mb > 50) throw new Error('Refused: --mb must be a whole integer from 1 to 50.');
  return mb * MiB;
}
export function makeOptions(args) {
  if (!args.length) return {};
  if (args.length !== 2 || args[0] !== '--mb' || !/^\d+$/.test(args[1])) {
    throw new Error('Refused: make accepts only --mb with a whole integer from 1 to 50.');
  }
  const mb = Number(args[1]);
  bigSize(mb);
  return { mb };
}
async function filesFolder(id, create = false) {
  const { dir } = await readSeal(id);
  const folder = path.join(dir, 'files');
  if (create) await mkdir(folder, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const info = await lstat(folder);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(folder) !== folder) {
    throw new Error('Refused: generated-files folder is not a regular local folder or is a symbolic link.');
  }
  return folder;
}
async function writeAll(handle, buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await handle.write(buffer, offset, buffer.length - offset);
    if (!bytesWritten) throw new Error('Refused: generated file write made no progress.');
    offset += bytesWritten;
  }
}
export async function makeFile(id, kind, { mb } = {}) {
  if (!Object.hasOwn(definitions, kind)) throw new Error(`Refused: unknown file kind. Valid kinds: ${Object.keys(definitions).join(', ')}.`);
  if (kind !== 'big' && mb !== undefined) throw new Error('Refused: --mb applies only to big.');
  const bytes = kind === 'big' ? bigSize(mb) : (await payload(kind)).length;
  const [name, type, description] = definitions[kind];
  const folder = await filesFolder(id, true);
  const handle = await open(path.join(folder, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
  try {
    if (kind === 'big') {
      for (let written = 0; written < bytes; written += chunkSize) await writeAll(handle, zeroChunk.subarray(0, Math.min(chunkSize, bytes - written)));
    } else await writeAll(handle, await payload(kind));
  } finally { await handle.close(); }
  return { name, bytes, description, type, kind };
}

export async function openMadeFile(id, name) {
  if (typeof name !== 'string' || !name || /[\\/\0]/.test(name) || name.includes('..')) {
    throw new Error('Refused: --file must be one bare generated file name, without paths or ..');
  }
  const folder = await filesFolder(id);
  const kind = Object.keys(definitions).find(key => definitions[key][0] === name);
  if (!kind) throw new Error('Refused: --file must name a built-in file made by make.');
  const file = path.join(folder, name);
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || await realpath(file) !== file) {
    throw new Error('Refused: generated file must be a regular file with no symbolic or hard links.');
  }
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const actual = await handle.stat();
    if (!actual.isFile() || actual.nlink !== 1 || actual.dev !== info.dev || actual.ino !== info.ino || actual.size !== info.size) {
      throw new Error('Refused: generated file changed while opening.');
    }
    if (kind === 'big') bigSize(actual.size / MiB);
    else if (actual.size !== (await payload(kind)).length) throw new Error('Refused: generated file size was modified.');
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(chunkSize);
    for (let position = 0; position < actual.size;) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, actual.size - position), position);
      if (!bytesRead) throw new Error('Refused: generated file ended unexpectedly.');
      const bytes = buffer.subarray(0, bytesRead);
      if (kind === 'big' && bytes.some(byte => byte !== 0)) throw new Error('Refused: generated big file must contain only built-in zeros.');
      hash.update(bytes);
      position += bytesRead;
    }
    if (kind !== 'big' && hash.digest('hex') !== createHash('sha256').update(await payload(kind)).digest('hex')) {
      throw new Error('Refused: generated file bytes were modified; use a built-in file made by make.');
    }
    return { handle, bytes: actual.size, type: definitions[kind][1], kind, name };
  } catch (error) { await handle.close(); throw error; }
}
