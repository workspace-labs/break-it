import { constants } from 'node:fs';
import { readdir, lstat, realpath, open } from 'node:fs/promises';
import path from 'node:path';
import { readSeal } from './runs.mjs';
import { findSecrets, maskValue, safeLabel } from './leaks.mjs';

const fileLimit = 1024 * 1024;

export async function scanRun(id) {
  const { dir } = await readSeal(id);
  const root = path.join(dir, 'copy');
  const info = await lstat(root);
  if (info.isSymbolicLink() || !info.isDirectory() || await realpath(root) !== root) {
    throw new Error('Refused: copy folder is redirected or is not a folder.');
  }
  const lines = [];
  let found = false;
  async function walk(folder, prefix = '') {
    for (const entry of (await readdir(folder)).sort()) {
      if (entry === '.git') continue;
      const file = path.join(folder, entry);
      const relative = prefix + entry;
      const stat = await lstat(file);
      if (stat.isSymbolicLink()) {
        lines.push(`Skipped symbolic link: ${safeLabel(relative)}`);
      } else if (stat.isDirectory()) {
        await walk(file, relative + '/');
      } else if (stat.isFile()) {
        if (stat.size > fileLimit) {
          lines.push(`Skipped for size (over 1 MiB): ${safeLabel(relative)}`);
          continue;
        }
        const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
        let buffer;
        let oversized;
        try {
          // Bounded even if a file grows between stat and read.
          buffer = Buffer.alloc(fileLimit);
          let size = 0;
          while (size < buffer.length) {
            const read = await handle.read(buffer, size, buffer.length - size, size);
            if (!read.bytesRead) break;
            size += read.bytesRead;
          }
          buffer = buffer.subarray(0, size);
          oversized = (await handle.stat()).size > fileLimit;
        } finally { await handle.close(); }
        if (oversized) {
          lines.push(`Skipped for size (over 1 MiB): ${safeLabel(relative)}`);
          continue;
        }
        const text = buffer.toString('utf8');
        // NUL/control bytes and malformed UTF-8 identify non-text content.
        if (/[\x00-\x08\x0e-\x1f]/.test(text) || !Buffer.from(text).equals(buffer)) continue;
        for (const hit of findSecrets(text)) {
          found = true;
          lines.push(`${safeLabel(relative)}:${hit.line}  ${hit.pattern}  ${maskValue(hit.value)}`);
        }
      }
    }
  }
  await walk(root);
  if (!found) lines.push('No secrets found');
  return lines.join('\n');
}
