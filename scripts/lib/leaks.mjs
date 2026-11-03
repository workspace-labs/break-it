// Shared, offline heuristics. Keep the exact list in references/leak-patterns.md.
const patterns = [
  ['private key', /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----|$)/g],
  ['GitHub ghp', /\bghp_[A-Za-z0-9]{36,}\b/g],
  ['GitHub github_pat', /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g],
  ['Slack xox', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g],
  ['AWS AKIA', /\bAKIA[A-Z0-9]{16}\b/g],
  ['Stripe sk_live', /\bsk_live_[A-Za-z0-9]{16,}\b/g],
  ['OpenAI sk', /\bsk-[A-Za-z0-9_-]{20,}\b/g],
  ['JWT', /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g]
];

function placeholder(value, quoted = true) {
  const text = value.trim();
  if (/^(?:|example|changeme|x+|your[-_].*[-_]here)$/i.test(text)) return true;
  // References read a value instead of storing a credential literal. Terminal
  // JS/JSON punctuation is ignored only for this classification, not evidence.
  const reference = text.replace(/[,;]+$/, '');
  if (/^(?:process\.env|os\.environ)(?:\b|\[)/.test(reference) ||
      /^(?:\$\{|\{\{|<)/.test(reference) ||
      /^(?:null|undefined|true|false)$/i.test(reference)) return true;
  return !quoted && (/^[A-Za-z]+$/.test(reference) ||
    /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*\(/.test(reference));
}

function sensitiveName(name) {
  const words = name.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[_\-.\s]+/);
  const singles = new Set(['password', 'passwd', 'pwd', 'secret', 'token', 'auth',
    'credential', 'credentials', 'apikey', 'privatekey', 'passwordhash']);
  return words.some((word, index) => singles.has(word) ||
    ['api key', 'private key', 'password hash'].includes(`${word} ${words[index + 1]}`));
}

function genericSecrets(text, minimumLength) {
  const hits = [];
  const fields = /([A-Za-z_$][\w$.-]*)["']?\s*[:=](?!=|>)\s*/g;
  const quotedValue = /(["'`])((?:\\[^\r\n]|(?!\1)[^\\\r\n])*)(?:\1|$)/y;
  const unquotedValue = /[^\s#]+/y;
  const maskedValue = /(?:.{3}….{4}|••••) \(\d+ chars\)/y;
  for (const field of text.matchAll(fields)) {
    if (!sensitiveName(field[1])) continue;
    const start = field.index + field[0].length;
    const quoted = /["'`]/.test(text[start] || '\0');
    // An empty unquoted .env value ends at its newline. Preserve the older
    // quoted case where whitespace between '=' and the literal spans lines.
    if (!quoted && /[\r\n]/.test(field[0].match(/\s*$/)[0])) continue;
    // Already-masked unquoted evidence includes spaces in its length label.
    // Consume that whole form before the whitespace-delimited value rule.
    const pattern = quoted ? quotedValue : unquotedValue;
    if (!quoted) {
      maskedValue.lastIndex = start;
      if (maskedValue.exec(text)) continue;
    }
    pattern.lastIndex = start;
    const match = pattern.exec(text);
    if (!match) continue;
    const value = quoted ? match[2] : match[0];
    if (placeholder(value, quoted) || /^(?:.{3}….{4}|••••) \(\d+ chars\)$/.test(value) ||
        Array.from(value).length < minimumLength) continue;
    hits.push({ pattern: `generic ${field[1].toLowerCase()}`, value, index: start + (quoted ? 1 : 0) });
  }
  return hits;
}

export function maskValue(value) {
  const chars = Array.from(value);
  const masked = chars.length <= 8 ? '••••' : `${chars.slice(0, 3).join('')}…${chars.slice(-4).join('')}`;
  // A private-key block may contain line breaks; output is always one line.
  return `${masked.replace(/[\x00-\x1f\x7f]/g, ' ')} (${chars.length} chars)`;
}

export function findSecrets(text, { minimumLength = 9 } = {}) {
  const candidates = genericSecrets(text, minimumLength);
  for (const [name, pattern] of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = match[0];
      if (placeholder(value) || /^(?:.{3}….{4}|••••) \(\d+ chars\)$/.test(value)) continue;
      candidates.push({ pattern: name, value, index: match.index });
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
