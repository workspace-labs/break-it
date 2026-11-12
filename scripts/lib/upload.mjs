import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { openMadeFile } from './files.mjs';
import { validId } from './runs.mjs';
import { sendFileRequest, validateRequest } from './send.mjs';

function sentName(preset, name, id) {
  if (preset === undefined) return name;
  const names = { traversal: `../break-it-escape-${id}.txt`, 'null-byte': 'photo.png\u0000.html',
    long: 'a'.repeat(300) + '.png', arabic: 'صورة.png', emoji: '📷.png', reserved: 'CON.png' };
  if (!Object.hasOwn(names, preset)) {
    throw new Error('Refused: --name must be traversal, null-byte, long, arabic, emoji or reserved.');
  }
  return names[preset];
}

export function uploadOptions(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const key = typeof flag === 'string' && flag.startsWith('--') ? flag.slice(2) : '';
    if (!['file', 'field', 'type', 'name', 'token'].includes(key) || i + 1 >= args.length ||
        Object.hasOwn(options, key)) {
      throw new Error('Refused: upload accepts one each of --file, --field, --type, --name and --token.');
    }
    options[key] = args[i + 1];
  }
  if (!options.file) throw new Error('Refused: upload requires --file <made-file>.');
  return options;
}

export async function uploadRequest(id, method, input, options = {}) {
  validId(id);
  validateRequest(method, input, { token: options.token });
  if (!/^(POST|PUT)$/.test(method)) throw new Error('Refused: upload method must be POST or PUT.');
  const field = options.field ?? 'file';
  // Multipart header values cannot introduce another header or part. The fixed
  // filename presets alone may contain unusual bytes, all inside the part body.
  if (typeof field !== 'string' || !field || Buffer.byteLength(field) > 100 || /[\x00-\x1f\x7f"\\]/u.test(field)) {
    throw new Error('Refused: --field must be 1–100 bytes without quotes, backslashes or control characters.');
  }
  const name = sentName(options.name, options.file, id);
  const made = await openMadeFile(id, options.file);
  let fileStream, source;
  try {
    const type = options.type ?? made.type;
    if (typeof type !== 'string' || type.length > 200 ||
        !/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:;[\x20-\x7e]*)?$/.test(type)) {
      throw new Error('Refused: --type must be one content-type without header control characters.');
    }
    const boundary = 'break-it-' + randomBytes(18).toString('hex');
    const prefix = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`);
    const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
    const length = prefix.length + made.bytes + suffix.length;
    if (length > 51 * 1024 * 1024) throw new Error('Refused: upload body exceeds 51 MiB.');
    // An explicit end bounds reads even if another process grows the file.
    if (made.bytes) fileStream = made.handle.createReadStream({ start: 0, end: made.bytes - 1, autoClose: false });
    source = Readable.from((async function* () {
      yield prefix;
      let bytes = 0;
      if (fileStream) for await (const chunk of fileStream) {
        bytes += chunk.length;
        if (bytes > made.bytes) throw new Error('Refused: generated file changed during upload.');
        yield chunk;
      }
      if (bytes !== made.bytes) throw new Error('Refused: generated file changed during upload.');
      yield suffix;
    })());
    const { sentBytes, ...response } = await sendFileRequest(method, input, { source, length, boundary,
      token: options.token, big: made.kind === 'big' });
    const fileBytesSent = Math.min(made.bytes, Math.max(0, sentBytes - prefix.length));
    return { ...response, uploaded: { bytes: made.bytes, sentBytes: fileBytesSent, name, type,
      deadline: made.kind === 'big' ? 30000 : 5000 } };
  } finally {
    source?.destroy();
    fileStream?.destroy();
    await made.handle.close();
  }
}
