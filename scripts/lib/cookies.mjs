import { lstat, realpath, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { readSeal } from './runs.mjs';

const cookieName = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const cookieValue = /^[\x21-\x7e]*$/;
const jarLimit = 128 * 1024;
const localOrigin = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;

function validBearer(bearer) {
  return bearer && typeof bearer.origin === 'string' && localOrigin.test(bearer.origin) &&
    typeof bearer.value === 'string' && bearer.value.length > 0 && bearer.value.length <= 4096 &&
    /^[\x20-\x7e\x80-\xff]+$/.test(bearer.value);
}

export function parseSetCookie(raw) {
  if (typeof raw !== 'string') return undefined;
  const end = raw.indexOf(';');
  const pair = end < 0 ? raw : raw.slice(0, end);
  const equal = pair.indexOf('=');
  if (equal < 1) return undefined;
  const name = pair.slice(0, equal).trim(), value = pair.slice(equal + 1).trim();
  if (!cookieName.test(name) || !cookieValue.test(value)) return undefined;
  return { name, value, flags: end < 0 ? '' : raw.slice(end) };
}
export function formatSetCookie(raw) {
  const cookie = parseSetCookie(raw);
  return cookie ? `Set-Cookie: ${cookie.name}=•••• (${cookie.value.length} chars)${cookie.flags}` :
    'Set-Cookie: (unparseable; value hidden)';
}
function validStored(cookie) {
  return cookie && typeof cookie.origin === 'string' && localOrigin.test(cookie.origin) &&
    typeof cookie.name === 'string' && cookieName.test(cookie.name) && typeof cookie.value === 'string' &&
    cookieValue.test(cookie.value) && !cookie.value.includes(';') &&
    typeof cookie.path === 'string' && cookie.path.startsWith('/') && cookie.path.length <= 4096 &&
    typeof cookie.secure === 'boolean' && (cookie.expires === null || Number.isFinite(cookie.expires)) &&
    Buffer.byteLength(`${cookie.name}=${cookie.value}`) <= 4096;
}
async function jarFile(id) {
  const { dir } = await readSeal(id);
  const file = path.join(dir, 'jar.json');
  let info;
  try { info = await lstat(file); } catch (error) {
    if (error.code === 'ENOENT') return { file };
    throw error;
  }
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > jarLimit || await realpath(file) !== file) {
    throw new Error('Refused: cookie jar must be a bounded regular file without symbolic or hard links.');
  }
  return { file, info };
}
function sameFile(opened, info) {
  return opened.isFile() && opened.nlink === 1 && opened.dev === info.dev && opened.ino === info.ino && opened.size === info.size;
}
export async function readJar(id) {
  const { file, info } = await jarFile(id);
  if (!info) return { version: 1, cookies: [] };
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    if (!sameFile(await handle.stat(), info)) throw new Error('Refused: cookie jar changed while opening.');
    let jar;
    try { jar = JSON.parse(await handle.readFile('utf8')); } catch { throw new Error('Refused: invalid cookie jar.'); }
    if (jar?.version !== 1 || !Array.isArray(jar.cookies) || jar.cookies.length > 20 || !jar.cookies.every(validStored) ||
        jar.bearers !== undefined && (!Array.isArray(jar.bearers) || jar.bearers.length > 20 ||
          !jar.bearers.every(validBearer) || new Set(jar.bearers.map(b => b.origin)).size !== jar.bearers.length)) {
      throw new Error('Refused: invalid cookie jar; at most 20 cookies of 4 KiB each.');
    }
    return jar;
  } finally { await handle.close(); }
}
export function matchingCookies(jar, url) {
  return jar.cookies.filter(cookie => cookie.origin === url.origin &&
    (cookie.expires === null || cookie.expires > Date.now()) &&
    (url.pathname === cookie.path || url.pathname.startsWith(cookie.path.endsWith('/') ? cookie.path : cookie.path + '/')));
}
export function matchingBearer(jar, url) {
  return jar.bearers?.find(bearer => bearer.origin === url.origin)?.value;
}
export function keepBearer(jar, url, value) {
  const bearer = { origin: url.origin, value };
  if (!validBearer(bearer)) throw new Error('Refused: login value is not a bounded HTTP header value.');
  const bearers = [...(jar.bearers ?? []).filter(item => item.origin !== url.origin), bearer];
  if (bearers.length > 20) throw new Error('Refused: cookie jar exceeds 20 bearer origins.');
  return { ...jar, bearers };
}
export function updateJar(jar, url, headers = []) {
  const cookies = jar.cookies.filter(cookie => cookie.expires === null || cookie.expires > Date.now());
  for (const raw of headers) {
    if (Buffer.byteLength(raw) > 4096) throw new Error('Refused: cookie exceeds 4 KiB.');
    const parsed = parseSetCookie(raw);
    if (!parsed) continue;
    const attrs = new Map(parsed.flags.split(';').slice(1).map(flag => {
      const equal = flag.indexOf('=');
      return equal < 0 ? [flag.trim().toLowerCase(), ''] : [flag.slice(0, equal).trim().toLowerCase(), flag.slice(equal + 1).trim()];
    }));
    // Domain may narrow/describe this host, never select a different target.
    const domain = attrs.get('domain')?.replace(/^\./, '').toLowerCase();
    if (domain && domain !== url.hostname.toLowerCase()) continue;
    const directory = url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1) || '/';
    const cookie = { origin: url.origin, name: parsed.name, value: parsed.value,
      path: attrs.get('path')?.startsWith('/') ? attrs.get('path') : directory,
      secure: attrs.has('secure'), expires: null };
    const maxAge = attrs.get('max-age');
    if (maxAge !== undefined && /^-?\d+$/.test(maxAge)) cookie.expires = Date.now() + Math.min(Number(maxAge), 315360000) * 1000;
    else if (attrs.has('expires') && Number.isFinite(Date.parse(attrs.get('expires')))) cookie.expires = Date.parse(attrs.get('expires'));
    const old = cookies.findIndex(item => item.origin === cookie.origin && item.name === cookie.name && item.path === cookie.path);
    if (old >= 0) cookies.splice(old, 1);
    if (cookie.expires === null || cookie.expires > Date.now()) cookies.push(cookie);
    if (cookies.length > 20) throw new Error('Refused: cookie jar exceeds 20 cookies.');
  }
  return { ...jar, version: 1, cookies };
}
export async function writeJar(id, jar) {
  const { file, info } = await jarFile(id);
  const bytes = JSON.stringify(jar);
  if (Buffer.byteLength(bytes) > jarLimit) throw new Error('Refused: cookie jar exceeded its size cap.');
  const handle = await open(file, info ? constants.O_RDWR | (constants.O_NOFOLLOW || 0) :
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
  try {
    if (info && !sameFile(await handle.stat(), info)) throw new Error('Refused: cookie jar changed while opening.');
    if (info) await handle.truncate(0);
    await handle.writeFile(bytes);
  } finally { await handle.close(); }
}
