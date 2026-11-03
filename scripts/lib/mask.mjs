import { findSecrets, maskValue, safeLabel } from './leaks.mjs';

const inputLimit = 20 * 1024 * 1024;

function patchText(text) {
  let diff = false;
  // Replace in place without allocating an object for each input line.
  return text.replace(/^(?:commit [a-f0-9]{7,40}\b[^\n]*|diff --git [^\n]*|[+ -][^\n]*)/gm, line => {
    if (/^commit [a-f0-9]{7,40}\b/.test(line)) diff = false;
    if (line.startsWith('diff --git ')) diff = true;
    return diff && /^[+ -]/.test(line) && !/^(?:---|\+\+\+) /.test(line) ? line.slice(1) : line;
  });
}

export function maskText(text) {
  const hits = findSecrets(patchText(text));
  if (!hits.length) return '';
  const output = [];
  let commit = '';
  let file = '';
  let diff = false;
  let oldLine;
  let newLine;
  let lineNumber = 0;
  let nextHit = 0;
  // Keep context only for hits, so newline-heavy input stays within bounded memory.
  for (const match of text.matchAll(/[^\n]*(?:\n|$)/g)) {
    const line = match[0].replace(/\n$/, '');
    lineNumber++;
    const hash = /^commit ([a-f0-9]{7,40})\b/.exec(line);
    if (hash) { commit = hash[1].slice(0, 7); file = ''; diff = false; oldLine = newLine = undefined; }
    if (line.startsWith('diff --git ')) { file = ''; diff = true; oldLine = newLine = undefined; }
    const before = /^--- a\/(.*)$/.exec(line);
    const after = /^\+\+\+ b\/(.*)$/.exec(line);
    if (before || after) file = (after || before)[1];
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) { oldLine = Number(hunk[1]); newLine = Number(hunk[2]); }
    let historicalLine;
    if (diff && !hunk && !/^(?:---|\+\+\+) /.test(line)) {
      if (line.startsWith('-')) { historicalLine = oldLine; if (oldLine !== undefined) oldLine++; }
      else if (line.startsWith('+')) { historicalLine = newLine; if (newLine !== undefined) newLine++; }
      else if (line.startsWith(' ')) {
        historicalLine = newLine;
        if (oldLine !== undefined) oldLine++;
        if (newLine !== undefined) newLine++;
      }
    }
    while (nextHit < hits.length && hits[nextHit].line === lineNumber) {
      const hit = hits[nextHit++];
      const location = file && safeLabel(file) + (historicalLine > 0 ? `:${historicalLine}` : '');
      output.push([commit && `commit ${commit}`, location, hit.pattern, maskValue(hit.value)].filter(Boolean).join('  '));
    }
    if (nextHit === hits.length) break;
  }
  return output.join('\n');
}

export async function maskInput(input) {
  const chunks = [];
  let size = 0;
  let capped = false;
  for await (const chunk of input) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const remaining = inputLimit - size;
    chunks.push(bytes.subarray(0, remaining));
    size += Math.min(bytes.length, remaining);
    if (size === inputLimit) { capped = true; break; }
  }
  const hits = maskText(Buffer.concat(chunks).toString('utf8'));
  return [hits, capped ? 'Stopped: stdin reached the 20 MiB cap; remaining input was not scanned.' : ''].filter(Boolean).join('\n');
}
