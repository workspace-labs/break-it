import { createHash, randomBytes } from 'node:crypto';
import { lstat, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { readSeal } from './runs.mjs';

// Raw values exist only in this process (or the explicitly requested cookie jar).
const known = new Set();
export function rememberLoginValue(value) {
  if (typeof value === 'string' && value.length) known.add(value);
}
export function maskLoginValues(text, { cut = false } = {}) {
  text = String(text);
  let complete = false;
  const loginKey = /^(?:token|access[_-]?token|refresh[_-]?token|id[_-]?token|session(?:[_-]?(?:id|key|token))?|(?:login|auth)[_-]?(?:key|token)|jwt|bearer)$/i;
  // Decode complete JSON before checking keys, including escaped key spellings
  // and numeric session identifiers. Preserve byte-for-byte ordinary replies.
  try {
    const parsed = JSON.parse(text);
    complete = true;
    let changed = false;
    function discover(value) {
      if (!value || typeof value !== 'object') return;
      for (const [key, item] of Object.entries(value)) {
        if (loginKey.test(key) && ['string', 'number'].includes(typeof item)) rememberLoginValue(String(item));
        else discover(item);
      }
    }
    discover(parsed);
    function mask(value) {
      if (!value || typeof value !== 'object') return;
      for (const key of Object.keys(value)) {
        if (loginKey.test(key) && ['string', 'number'].includes(typeof value[key])) {
          const raw = String(value[key]);
          rememberLoginValue(raw);
          value[key] = `•••• (${raw.length} chars)`;
          changed = true;
        } else if (typeof value[key] === 'string') {
          const raw = value[key];
          for (const secret of [...known].sort((a, b) => b.length - a.length)) {
            value[key] = value[key].split(secret).join(`•••• (${secret.length} chars)`);
          }
          changed ||= value[key] !== raw;
        } else mask(value[key]);
      }
    }
    mask(parsed);
    if (changed) text = JSON.stringify(parsed);
  } catch { /* A cut or non-JSON body still uses the bounded textual fallback. */ }
  // Handle a cut JSON string too: incomplete evidence must not expose its prefix.
  let output = complete ? text : text.replace(/("(?:[^"\\]|\\.)*"\s*:\s*)(?:"((?:[^"\\]|\\.)*)("|$)|(-?\d[\d.eE+-]*))/g,
    (whole, prefix, value, end, number) => {
      let key;
      try { key = JSON.parse(prefix.slice(0, prefix.lastIndexOf(':')).trim()); } catch { return whole; }
      if (!loginKey.test(key)) return whole;
      if (number !== undefined) rememberLoginValue(number);
      else if (end) { try { rememberLoginValue(JSON.parse(`"${value}"`)); } catch { /* Invalid JSON stays hidden. */ } }
      return `${prefix}"•••• (${(value ?? number).length} chars)${end || '"'}`;
    });
  for (const value of [...known].sort((a, b) => b.length - a.length)) {
    for (const spelling of new Set([value, JSON.stringify(value).slice(1, -1)])) {
      output = output.split(spelling).join(`•••• (${value.length} chars)`);
      if (cut) {
        for (let n = Math.min(output.length, spelling.length - 1); n > 0; n--) {
          if (output.endsWith(spelling.slice(0, n))) {
            output = output.slice(0, -n) + '•••• (cut login value)';
            break;
          }
        }
      }
    }
  }
  return output;
}

const digest = (salt, value) => createHash('sha256').update(salt).update('\0').update(value).digest('hex');
function checkedShapes(data) {
  if (!data || !/^[a-f0-9]{32}$/.test(data.salt) || !Array.isArray(data.values) || data.values.length > 256 ||
      !data.values.every(v => Number.isSafeInteger(v.length) && v.length > 0 && v.length <= 4096 &&
        /^[a-f0-9]{64}$/.test(v.digest))) throw new Error('Refused: invalid login fingerprint metadata.');
  return data;
}
async function shapeFile(id, write = false) {
  const { dir } = await readSeal(id);
  const file = path.join(dir, 'login-shapes.json');
  let stat;
  try { stat = await lstat(file); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (!stat) {
    if (!write) return {};
    const handle = await open(file, 'wx', 0o600);
    return { handle, data: { salt: randomBytes(16).toString('hex'), values: [] } };
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 65536) {
    throw new Error('Refused: login fingerprint file must be a bounded plain file.');
  }
  const handle = await open(file, (write ? constants.O_RDWR : constants.O_RDONLY) | (constants.O_NOFOLLOW || 0));
  try {
    const opened = await handle.stat();
    if (opened.ino !== stat.ino || opened.dev !== stat.dev || opened.nlink !== 1) {
      throw new Error('Refused: login fingerprint file changed while opening.');
    }
    const data = checkedShapes(JSON.parse(await handle.readFile('utf8')));
    return { handle, data };
  } catch {
    await handle.close();
    throw new Error('Refused: invalid login fingerprint metadata.');
  }
}
export async function readLoginShapes(id) {
  const { handle, data } = await shapeFile(id);
  await handle?.close();
  return data;
}
export async function rememberRunLoginValue(id, value) {
  if (typeof value !== 'string' || !value.length || value.length > 4096) {
    throw new Error('Refused: login value must have 1–4096 characters.');
  }
  const { handle, data } = await shapeFile(id, true);
  try {
    const hash = digest(data.salt, value);
    if (!data.values.some(v => v.digest === hash)) {
      if (data.values.length >= 256) throw new Error('Refused: run reached the login fingerprint cap.');
      data.values.push({ length: value.length, digest: hash });
      const bytes = Buffer.from(JSON.stringify(data));
      await handle.write(bytes, 0, bytes.length, 0);
      await handle.truncate(bytes.length);
    }
  } finally { await handle.close(); }
}
export function guardLoginValues(data, shapes) {
  const strings = [];
  function visit(value) {
    if (typeof value === 'string') strings.push(value);
    else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) { strings.push(key); visit(item); }
  }
  visit(data);
  const refuse = () => { throw new Error('Refused: findings contain a login value; describe only its shape.'); };
  for (const text of strings) for (const value of known) if (text.includes(value)) refuse();
  if (!shapes) return;
  checkedShapes(shapes);
  const byLength = new Map();
  for (const value of shapes.values) {
    if (!byLength.has(value.length)) byLength.set(value.length, new Set());
    byLength.get(value.length).add(value.digest);
  }
  for (const text of strings) for (const [length, hashes] of byLength) {
    for (let i = 0; i + length <= text.length; i++) {
      if (hashes.has(digest(shapes.salt, text.slice(i, i + length)))) refuse();
    }
  }
}
