import { constants } from 'node:fs';
import { readdir, lstat, realpath, open } from 'node:fs/promises';
import path from 'node:path';
import { readSeal } from './runs.mjs';
import { findLeakEvidence, maskValue, safeLabel } from './leaks.mjs';

const windowSize = 1024 * 1024;
const overlapSize = 4 * 1024;
const fileLimit = 20 * windowSize;

function retainedTail(text) {
  const bytes = Buffer.from(text);
  let start = Math.max(0, bytes.length - overlapSize);
  // The overlap begins on a complete UTF-8 character, never a continuation byte.
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++;
  return bytes.subarray(start).toString('utf8');
}

async function scanFile(file, relative) {
  const label = safeLabel(relative);
  const sizeNote = `Skipped for size (over 20 MiB): ${label}`;
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  const lines = [];
  const reviewLines = [];
  let reportedSpans = [];
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let position = 0;
  let carried = '';
  let characterBase = 0;
  let lineBase = 1;
  try {
    if ((await handle.stat()).size > fileLimit) return { lines: [sizeNote], found: false };
    while (position < fileLimit) {
      const buffer = Buffer.alloc(Math.min(windowSize, fileLimit - position));
      let size = 0;
      while (size < buffer.length) {
        const read = await handle.read(buffer, size, buffer.length - size, position + size);
        if (!read.bytesRead) break;
        size += read.bytesRead;
      }
      position += size;
      const final = size < buffer.length || position >= (await handle.stat()).size;
      let decoded;
      try { decoded = decoder.decode(buffer.subarray(0, size), { stream: !final }); }
      catch { return { lines: [], found: false }; }
      // Validate every read window. The decoder retains incomplete UTF-8 bytes.
      if (/[\x00-\x08\x0e-\x1f]/.test(decoded)) return { lines: [], found: false };
      const text = carried + decoded;
      const tail = final ? '' : retainedTail(text);
      const tailStart = text.length - tail.length;
      const nextBase = characterBase + tailStart;
      const nextSpans = reportedSpans.filter(span => span.end > nextBase);
      for (const hit of findLeakEvidence(text)) {
        if (!final && hit.index + hit.value.length === text.length) {
          // Never publish a truncated value. The next window supplies its end.
          if (hit.index < tailStart) {
            return { lines: [`Skipped long boundary-spanning match (over 4 KiB overlap): ${label}`], found: false };
          }
          continue;
        }
        const absoluteIndex = characterBase + hit.index;
        const absoluteEnd = absoluteIndex + hit.value.length;
        // An overlap may lose an assignment's name and rediscover an inner
        // provider token. Retain spans, not just starts, across that boundary.
        if (reportedSpans.some(span => absoluteIndex < span.end && absoluteEnd > span.start)) continue;
        if (absoluteEnd > nextBase) nextSpans.push({ start: absoluteIndex, end: absoluteEnd });
        if (hit.byEye) {
          reviewLines.push(`  line ${lineBase + hit.line - 1}  ${safeLabel(hit.parent)}.${safeLabel(hit.key)} = ${maskValue(hit.value)}`);
        } else lines.push(`${label}:${lineBase + hit.line - 1}  ${hit.pattern}  ${maskValue(hit.value)}`);
      }
      if (final) break;
      for (let i = 0; i < tailStart; i++) if (text[i] === '\n') lineBase++;
      characterBase += tailStart;
      carried = tail;
      // Only evidence intersecting the retained overlap is needed next time.
      reportedSpans = nextSpans;
    }
    // A growing file is still bounded, and no partial results escape this file.
    if ((await handle.stat()).size > fileLimit) return { lines: [sizeNote], found: false };
    const found = lines.length > 0;
    if (reviewLines.length) {
      lines.push(`Check by eye — values under credential names (inner key looks like settings): ${label}`, ...reviewLines);
    }
    return { lines, found, reviewed: reviewLines.length > 0 };
  } finally { await handle.close(); }
}

export async function scanRun(id) {
  const { dir } = await readSeal(id);
  const root = path.join(dir, 'copy');
  const info = await lstat(root);
  if (info.isSymbolicLink() || !info.isDirectory() || await realpath(root) !== root) {
    throw new Error('Refused: copy folder is redirected or is not a folder.');
  }
  const lines = [];
  let found = false;
  let reviewed = false;
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
          lines.push(`Skipped for size (over 20 MiB): ${safeLabel(relative)}`);
          continue;
        }
        const result = await scanFile(file, relative);
        for (const line of result.lines) lines.push(line);
        found ||= result.found;
        reviewed ||= result.reviewed;
      }
    }
  }
  await walk(root);
  if (!found) lines.push(reviewed ? 'No confirmed secrets — check the values above by eye' : 'No secrets found');
  return lines.join('\n');
}
