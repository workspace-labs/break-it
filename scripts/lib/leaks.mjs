// Shared, offline heuristics. Keep the exact list in references/leak-patterns.md.
const patterns = [
  ['private key', /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----|$)/g],
  ['generic', /\b(password(?:_?hash)?|secret|token|api_key)\b["']?\s*[:=]\s*(["'`])((?:\\[^\r\n]|(?!\2)[^\\\r\n])*)(?:\2|$)/gi, 3],
  ['GitHub ghp', /\bghp_[A-Za-z0-9]{36,}\b/g],
  ['GitHub github_pat', /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g],
  ['Slack xox', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g],
  ['AWS AKIA', /\bAKIA[A-Z0-9]{16}\b/g],
  ['Stripe sk_live', /\bsk_live_[A-Za-z0-9]{16,}\b/g],
  ['OpenAI sk', /\bsk-[A-Za-z0-9_-]{20,}\b/g],
  ['JWT', /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g]
];

function placeholder(value) {
  return /^(?:|example|changeme|x+|your[-_].*[-_]here)$/i.test(value.trim());
}

export function maskValue(value) {
  const chars = Array.from(value);
  const masked = chars.length <= 8 ? '••••' : `${chars.slice(0, 3).join('')}…${chars.slice(-4).join('')}`;
  // A private-key block may contain line breaks; output is always one line.
  return `${masked.replace(/[\x00-\x1f\x7f]/g, ' ')} (${chars.length} chars)`;
}

export function findSecrets(text, { minimumLength = 9 } = {}) {
  const candidates = [];
  for (const [name, pattern, group] of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = group ? match[group] : match[0];
      if (placeholder(value) || /^(?:.{3}….{4}|••••) \(\d+ chars\)$/.test(value)) continue;
      if (group && Array.from(value).length < minimumLength) continue;
      const index = match.index + (group ? match[0].lastIndexOf(value) : 0);
      candidates.push({ pattern: group ? `generic ${match[1].toLowerCase()}` : name, value, index });
    }
  }
  // Merge overlapping spans: an assignment must not hide a longer private block.
  candidates.sort((a, b) => a.index - b.index || b.value.length - a.value.length);
  const merged = [];
  for (const hit of candidates) {
    const previous = merged.at(-1);
    if (previous && hit.index < previous.index + previous.value.length) {
      const end = Math.max(previous.index + previous.value.length, hit.index + hit.value.length);
      previous.value = text.slice(previous.index, end);
      if (hit.pattern === 'private key') previous.pattern = hit.pattern;
    } else merged.push({ ...hit });
  }
  const hits = [];
  let line = 1;
  let cursor = 0;
  for (const hit of merged) {
    for (; cursor < hit.index; cursor++) if (text[cursor] === '\n') line++;
    hits.push({ ...hit, line });
  }
  return hits;
}

export function redactSecrets(text, options) {
  let output = '';
  let start = 0;
  for (const hit of findSecrets(text, options)) {
    output += text.slice(start, hit.index) + maskValue(hit.value);
    start = hit.index + hit.value.length;
  }
  return output + text.slice(start);
}

export function safeLabel(text) {
  return redactSecrets(text).replace(/[\x00-\x1f\x7f]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
