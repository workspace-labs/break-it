// Shared, offline heuristics. Keep the exact list in references/leak-patterns.md.
const patterns = [
  ['private key', /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----|$)/g],
  ['GitHub ghp', /\bghp_[A-Za-z0-9]{36,}\b/g],
  ['GitHub github_pat', /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g],
  ['Slack xox', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g],
  ['AWS AKIA', /\bAKIA[A-Z0-9]{16}\b/g],
  ['Stripe sk_live', /\bsk_live_[A-Za-z0-9]{16,}\b/g],
  ['OpenAI sk', /\bsk-[A-Za-z0-9_-]{20,}\b/g]
];

function placeholder(value, quoted = true) {
  const text = value.trim();
  if (/^(?:|example|changeme|x+)$/i.test(text) ||
      text.length >= 10 && /^your[-_]/i.test(text.slice(0, 5)) && /^[-_]here$/i.test(text.slice(-5))) return true;
  if (/^(?:process\.env|os\.environ)(?:\b|\[)/.test(text) ||
      /^(?:\$\{|\{\{|<)/.test(text) ||
      !quoted && /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*\(/.test(text)) return true;
  // References read a value instead of storing a credential literal. Terminal
  // JS/JSON punctuation is ignored only for this classification, not evidence.
  let end = text.length;
  while (end && (text[end - 1] === ',' || text[end - 1] === ';')) end--;
  const reference = text.slice(0, end);
  if (/^(?:null|undefined|true|false)$/i.test(reference)) return true;
  // A compact object may put its closing brace immediately after the read.
  let dottedEnd = end;
  while (dottedEnd && text[dottedEnd - 1] === '}') dottedEnd--;
  return !quoted && (/^[A-Za-z]+$/.test(reference) ||
    /^[A-Za-z_$]+(?:\.[A-Za-z_$]+)+$/.test(text.slice(0, dottedEnd)));
}

function sensitiveName(name) {
  const words = name.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[_\-.\s]+/);
  const singles = new Set(['password', 'passwords', 'passwd', 'passwds', 'pwd', 'pwds',
    'secret', 'secrets', 'token', 'tokens', 'auth', 'credential', 'credentials',
    'apikey', 'apikeys', 'privatekey', 'privatekeys', 'passwordhash', 'passwordhashes']);
  return words.some((word, index) => singles.has(word) ||
    ['api key', 'api keys', 'private key', 'private keys', 'password hash', 'password hashes']
      .includes(`${word} ${words[index + 1]}`));
}

const valueKeys = new Set(['value', 'current', 'previous', 'data', 'raw', 'plain',
  'key', 'k', 'v', 'primary', 'secondary', 'default']);

// One iterative, string-aware walk per outer credential container. Keep at most
// 64 frames; beyond that, count delimiters but leave detection to scalar rules.
function nestedValues(text, start, parent, minimumLength, hits, review, quotedSpans) {
  const frames = [];
  const word = /[A-Za-z0-9_$][\w$.-]*/y;
  const arrayValue = /[^\s,[\]{}"'`#]+/y;
  let depth = 0;
  let cursor = start;
  while (cursor < text.length) {
    const char = text[cursor];
    if (char === '{' || char === '[') {
      if (depth < 64) frames.push({ close: char === '{' ? '}' : ']',
        key: frames.at(-1)?.key ?? null, array: char === '[',
        pending: [], unquotedState: { closed: false } });
      else if (depth === 64) {
        // Delimiter types beyond the cap cannot certify these open frames.
        for (const frame of frames) frame.pending = null;
      }
      depth++;
      cursor++;
      continue;
    }
    if (char === '}' || char === ']') {
      // A mismatched close cannot justify inheriting into later siblings.
      if (depth <= 64 && frames.at(-1)?.close !== char) return cursor + 1;
      if (depth <= 64) {
        const frame = frames.pop();
        if (frame.array && frame.pending) {
          frame.unquotedState.closed = true;
          for (const { target, item } of frame.pending) target.push(item);
        }
      }
      depth--;
      cursor++;
      if (!depth) return cursor;
      continue;
    }
    const frame = depth <= 64 ? frames.at(-1) : undefined;
    if (char === ',') {
      if (frame && !frame.array) frame.key = null;
      cursor++;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      const quoteStart = cursor++;
      const valueStart = cursor;
      while (cursor < text.length && text[cursor] !== char && !/[\r\n]/.test(text[cursor])) {
        cursor += text[cursor] === '\\' && cursor + 1 < text.length ? 2 : 1;
      }
      const value = text.slice(valueStart, cursor);
      const closed = text[cursor] === char;
      if (closed) cursor++;
      let after = cursor;
      while (/\s/.test(text[after] || '\0')) after++;
      if (closed && (text[after] === ':' || text[after] === '=')) {
        quotedSpans.push({ start: quoteStart, end: cursor, key: true });
        let key = value;
        if (char === '"') {
          try { key = JSON.parse(text.slice(quoteStart, cursor)); } catch { /* literal label */ }
        }
        if (frame) frame.key = key;
        cursor = after + 1;
      } else {
        // Bound scalar fallback to this token, so text inside it cannot open
        // a new container or consume unrelated following fields.
        quotedSpans.push({ start: quoteStart, end: cursor, closed });
        if (frame && !/\s/.test(value) && !placeholder(value, true) &&
            Array.from(value).length >= minimumLength) {
          const item = { pattern: `generic nested ${parent}`, value, index: valueStart };
          const key = frame.key ?? '';
          if (valueKeys.has(key.toLowerCase()) || sensitiveName(key) ||
              frame.array && frame.key === null) {
            hits.push(item);
          } else review.push({ ...item, parent, key });
        }
        cursor = after;
      }
      continue;
    }
    const tokenPattern = frame?.array ? arrayValue : word;
    tokenPattern.lastIndex = cursor;
    const token = tokenPattern.exec(text);
    if (token) {
      const valueStart = cursor;
      cursor = tokenPattern.lastIndex;
      let after = cursor;
      while (/\s/.test(text[after] || '\0')) after++;
      if (frame && (text[after] === ':' || text[after] === '=') &&
          text[after + 1] !== '=' && text[after + 1] !== '>') {
        frame.key = token[0];
        cursor = after + 1;
      } else {
        // Bound scalar fallback inside an unquoted element just as for a
        // quoted token; an embedded assignment must not consume the list tail.
        if (frame?.array) quotedSpans.push({ start: valueStart, end: cursor, closed: false,
          unquotedState: frame.unquotedState });
        if (frame?.array && frame.pending && !placeholder(token[0], false) &&
            Array.from(token[0]).length >= minimumLength) {
          const item = { pattern: `generic nested ${parent}`, value: token[0], index: valueStart };
          const key = frame.key ?? '';
          if (valueKeys.has(key.toLowerCase()) || sensitiveName(key) || frame.key === null) {
            frame.pending.push({ target: hits, item });
          } else frame.pending.push({ target: review, item: { ...item, parent, key } });
        }
        cursor = after;
      }
    } else cursor++;
  }
  return cursor;
}

function genericSecrets(text, minimumLength) {
  const hits = [];
  const review = [];
  const quotedSpans = [];
  let quoteIndex = 0;
  const fields = /(?<![\w$.-])([A-Za-z_$][\w$.-]{0,127})(?![\w$.-])["']?\s*[:=](?!=|>)(\s*)/g;
  const quotedValue = /(["'`])((?:\\[^\r\n]|(?!\1)[^\\\r\n])*)(?:\1|$)/y;
  const unquotedValue = /[^\s#]+/y;
  const maskedValue = /(?:.{3}….{4}|••••) \(\d+ chars\)/y;
  let unquotedEnd = 0;
  let containerEnd = 0;
  let field;
  while ((field = fields.exec(text))) {
    let fieldLimit = text.length;
    let inQuotedValue = false;
    while (quoteIndex < quotedSpans.length && quotedSpans[quoteIndex].end <= field.index) quoteIndex++;
    if (quoteIndex < quotedSpans.length) {
      const span = quotedSpans[quoteIndex];
      if (field.index >= span.start) {
        // Scalar fallback cannot revive an element from an unclosed list.
        if (span.unquotedState && !span.unquotedState.closed) continue;
        if (span.key) {
          if (field.index !== span.start + 1 || field[1].length !== span.end - span.start - 2) continue;
        } else {
          fieldLimit = span.end - Number(span.closed);
          inQuotedValue = true;
        }
      }
    }
    if (!sensitiveName(field[1])) continue;
    const start = field.index + field[0].length;
    if (start >= fieldLimit) continue;
    const fieldText = fieldLimit < text.length ? text.slice(0, fieldLimit) : text;
    const quoted = /["'`]/.test(text[start] || '\0');
    // Lists and object values inherit sensitivity up to their matching close.
    // Preserve brace-wrapped scalars; never re-walk an already covered span.
    if (!quoted && !inQuotedValue && (text[start] === '[' ||
        /^\{\s*(?:(?:(["'])(?:\\[^\r\n]|(?!\1)[^\\\r\n])*\1|[A-Za-z0-9_$][\w$.-]*)\s*[:=]|\})/.test(fieldText.slice(start)))) {
      if (start >= containerEnd && fieldLimit === text.length) {
        containerEnd = nestedValues(text, start, field[1].toLowerCase(), minimumLength, hits, review, quotedSpans);
      }
      continue;
    }
    // An empty unquoted .env value ends at its newline. Preserve the older
    // quoted case where whitespace between '=' and the literal spans lines.
    if (!quoted && /[\r\n]/.test(field[2])) continue;
    // Already-masked unquoted evidence includes spaces in its length label.
    // Consume that whole form before the whitespace-delimited value rule.
    if (!quoted) {
      maskedValue.lastIndex = start;
      if (maskedValue.exec(fieldText)) { fields.lastIndex = maskedValue.lastIndex; continue; }
    }
    let match;
    if (quoted) {
      quotedValue.lastIndex = start;
      match = quotedValue.exec(fieldText);
    } else if (start < unquotedEnd) {
      // Ignored minified reads can resume inside the same whitespace/# run.
      // Reuse its known end instead of matching the whole suffix each time.
      match = [text.slice(start, Math.min(unquotedEnd, fieldLimit))];
    } else {
      unquotedValue.lastIndex = start;
      match = unquotedValue.exec(fieldText);
      if (match) unquotedEnd = unquotedValue.lastIndex;
    }
    if (!match) {
      // A failed quoted value has already been read through its line. Do not
      // retry its escaped field-like contents from every interior position.
      if (quoted) {
        const newline = fieldText.indexOf('\n', start);
        fields.lastIndex = newline < 0 ? fieldLimit : newline + 1;
      }
      continue;
    }
    const value = quoted ? match[2] : match[0];
    const parsedEnd = Math.min(quoted ? quotedValue.lastIndex : unquotedEnd, fieldLimit);
    fields.lastIndex = parsedEnd;
    const ignored = placeholder(value, quoted);
    if (ignored && !quoted) {
      // An ignored read can precede another minified statement. Resume there
      // without re-reading the same value suffix from nested assignment text.
      let next = start;
      while (next < parsedEnd && text[next] !== ';' && text[next] !== ',') next++;
      if (next < parsedEnd) fields.lastIndex = next + 1;
    }
    if (ignored || /^(?:.{3}….{4}|••••) \(\d+ chars\)$/.test(value) ||
        Array.from(value).length < minimumLength) continue;
    hits.push({ pattern: `generic ${field[1].toLowerCase()}`, value, index: start + (quoted ? 1 : 0) });
  }
  return { hits, review };
}

function jwtSecrets(text) {
  const hits = [];
  // Inspect each base64url run at most as part of three adjacent segments.
  // A failed two-dot match must not retry every '-eyJ' inside one long run.
  const triples = /(?<![A-Za-z0-9_-])(?=([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{8,})\.([A-Za-z0-9_-]{8,}))/g;
  let previousEnd = -1;
  for (const triple of text.matchAll(triples)) {
    let end = triple[3].length;
    while (end && triple[3][end - 1] === '-') end--;
    if (end < 8) continue;
    const prefix = /\beyJ[A-Za-z0-9_-]{5,}$/.exec(triple[1]);
    if (!prefix) continue;
    const index = triple.index + prefix.index;
    if (index < previousEnd) continue;
    const value = `${triple[1].slice(prefix.index)}.${triple[2]}.${triple[3].slice(0, end)}`;
    hits.push({ pattern: 'JWT', value, index });
    previousEnd = index + value.length;
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
  const candidates = genericSecrets(text, minimumLength).hits;
  for (const [name, pattern] of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = match[0];
      if (placeholder(value) || /^(?:.{3}….{4}|••••) \(\d+ chars\)$/.test(value)) continue;
      candidates.push({ pattern: name, value, index: match.index });
    }
  }
  for (const hit of jwtSecrets(text)) candidates.push(hit);
  return mergeHits(text, candidates);
}

function mergeHits(text, candidates) {
  // Merge overlapping spans: an assignment must not hide a longer private block.
  candidates.sort((a, b) => a.index - b.index || b.value.length - a.value.length);
  const merged = [];
  for (const hit of candidates) {
    const previous = merged.at(-1);
    if (previous && hit.index < previous.index + previous.value.length) {
      const end = Math.max(previous.index + previous.value.length, hit.index + hit.value.length);
      previous.value = text.slice(previous.index, end);
      // A review span can surround a provider hit. Merge its full value for
      // masking, retaining the confirmed classification and provider name.
      if (previous.byEye && !hit.byEye) {
        previous.byEye = false;
        previous.pattern = hit.pattern;
      }
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

export function findNestedReview(text, { minimumLength = 9 } = {}) {
  return mergeHits(text, genericSecrets(text, minimumLength).review);
}

// Output paths share overlap handling so review evidence cannot hide a
// confirmed provider token or expose a surrounding, possibly secret value.
export function findLeakEvidence(text, options) {
  return mergeHits(text, [...findSecrets(text, options),
    ...findNestedReview(text, options).map(hit => ({ ...hit, byEye: true }))]);
}

export function redactSecrets(text, options) {
  let output = '';
  let start = 0;
  for (const hit of findLeakEvidence(text, options)) {
    output += text.slice(start, hit.index) + maskValue(hit.value);
    start = hit.index + hit.value.length;
  }
  return output + text.slice(start);
}

export function safeLabel(text) {
  return redactSecrets(text).replace(/[\x00-\x1f\x7f]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
