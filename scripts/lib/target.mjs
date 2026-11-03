import { realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const localOnly = 'Refused: break-it only attacks a local copy, never a live site.';
export function checkUrl(input) {
  // Check literal authority too: URL normalizes numeric and abbreviated IPs.
  const authority = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#]|$)/i;
  if (!authority.test(input)) throw new Error(localOnly);
  let url;
  try { url = new URL(input); } catch { throw new Error(localOnly); }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase()) ||
      url.username || url.password || /[\s\\]/.test(input)) throw new Error(localOnly);
  return url;
}
export async function checkTarget(input, url) {
  if (url !== undefined) checkUrl(url);
  if (!input || /^(?:[a-zA-Z]:[\\/]?$|[\\/]{2}|[a-z]+:\/\/)/.test(input)) {
    throw new Error('Refused: choose an existing local project folder, never a system root.');
  }
  const resolved = await realpath(path.resolve(input));
  const home = await realpath(homedir());
  const system = new Set(['/', '/System', '/Library', '/Applications', '/Users', '/Volumes',
    '/private', '/private/var', '/usr', '/etc', '/var', '/bin', '/sbin', '/opt',
    'C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)', 'C:\\Users']);
  const equal = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  if (equal(resolved, home) || equal(resolved, path.parse(resolved).root) ||
      [...system].some(p => equal(resolved, p))) throw new Error('Refused: home and system folders are not projects.');
  if (!(await stat(resolved)).isDirectory()) throw new Error('Refused: target must be a folder.');
  return resolved;
}
