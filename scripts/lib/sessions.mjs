import { readSeal } from './runs.mjs';
import { sendRequest, validateRequest } from './send.mjs';
import { rememberLoginValue, rememberRunLoginValue } from './login-values.mjs';

const allowed = ['json', 'field', 'cookieName', 'count'];

function boundedOptions(input) {
  if (!input || typeof input !== 'object' || Object.keys(input).some(key => !allowed.includes(key))) {
    throw new Error('Refused: sessions accepts only --json, --field or --cookie-name, and --count.');
  }
  const options = { count: 10, ...input };
  if (!Number.isSafeInteger(options.count) || options.count < 1 || options.count > 20) {
    throw new Error('Refused: --count must be an integer from 1 to 20.');
  }
  if (typeof options.json !== 'string') throw new Error('Refused: sessions requires --json <body>.');
  if ((options.field !== undefined) === (options.cookieName !== undefined)) {
    throw new Error('Refused: sessions requires exactly one of --field or --cookie-name.');
  }
  const name = options.field ?? options.cookieName;
  if (typeof name !== 'string' || !name.length || name.length > 256 || /[\x00-\x20\x7f]/.test(name)) {
    throw new Error('Refused: the login field or cookie name must be a nonempty name of at most 256 characters.');
  }
  if (options.cookieName !== undefined && !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) {
    throw new Error('Refused: --cookie-name must be a cookie name.');
  }
  try { JSON.parse(options.json); }
  catch { throw new Error('Refused: sessions requires a JSON login body.'); }
  return options;
}

export function sessionsOptions(args) {
  const options = {};
  const flags = { '--json': 'json', '--field': 'field', '--cookie-name': 'cookieName', '--count': 'count' };
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const key = Object.hasOwn(flags, flag) ? flags[flag] : undefined;
    if (!key || i + 1 >= args.length || Object.hasOwn(options, key)) {
      throw new Error('Refused: sessions accepts one --json, one --field or --cookie-name, and one --count.');
    }
    if (key === 'count') {
      if (typeof args[i + 1] !== 'string' || !/^\d+$/.test(args[i + 1])) {
        throw new Error('Refused: --count must be an integer from 1 to 20.');
      }
      options.count = Number(args[i + 1]);
    } else options[key] = args[i + 1];
  }
  return boundedOptions(options);
}

function loginValue(response, options) {
  let value;
  if (options.field !== undefined) {
    if (response.cut) throw new Error('Refused: login reply was cut; session evidence is incomplete.');
    let body;
    try { body = JSON.parse(response.body); }
    catch { throw new Error('Refused: login reply is not JSON; no session analysis.'); }
    if (body && typeof body === 'object' && Object.hasOwn(body, options.field)) value = body[options.field];
  } else {
    const headers = response.headers?.['set-cookie'];
    for (const header of Array.isArray(headers) ? headers : typeof headers === 'string' ? [headers] : []) {
      const pair = header.split(';', 1)[0];
      const equals = pair.indexOf('=');
      if (equals > 0 && pair.slice(0, equals).trim() === options.cookieName) {
        value = pair.slice(equals + 1).trim();
        break;
      }
    }
  }
  // Some synthetic apps use numeric session identifiers. Keep even those bytes
  // out of messages and persisted run state, just like a string-valued key.
  if (typeof value === 'number' && Number.isFinite(value)) value = String(value);
  if (typeof value !== 'string' || !value.length || Buffer.byteLength(value) > 4096) {
    throw new Error('Refused: login reply has no bounded, nonempty login value at the requested field or cookie.');
  }
  return value;
}

function usernameFrom(json) {
  const body = JSON.parse(json);
  const names = ['username', 'user', 'email', 'login', 'name'];
  if (!body || typeof body !== 'object') return '';
  for (const name of names) {
    const key = Object.keys(body).find(key => key.toLowerCase() === name);
    if (key && typeof body[key] === 'string' && body[key].length) return body[key];
  }
  const user = body.user;
  if (user && typeof user === 'object') {
    for (const name of names) if (typeof user[name] === 'string' && user[name].length) return user[name];
  }
  return '';
}

function countsUp(values) {
  if (values.length < 2) return false;
  const runs = values.map(value => [...value.matchAll(/\d+/g)].map(match => match[0]));
  if (!runs[0].length || runs.some(run => run.length !== runs[0].length)) return false;
  const shape = values[0].replace(/\d+/g, '#');
  if (values.some(value => value.replace(/\d+/g, '#') !== shape)) return false;
  return runs[0].some((_, index) => {
    for (let sample = 1; sample < runs.length; sample++) {
      const step = BigInt(runs[sample][index]) - BigInt(runs[sample - 1][index]);
      if (step < 1n || step > 10n) return false;
    }
    return true;
  });
}

function containsTime(values, now) {
  return values.some(value => [...value.matchAll(/\d+/g)].some(match => {
    if (match[0].length !== 10 && match[0].length !== 13) return false;
    const milliseconds = Number(match[0]) * (match[0].length === 10 ? 1000 : 1);
    return Math.abs(milliseconds - now) <= 86400000;
  }));
}

function analyze(values, username, now) {
  const lengths = values.map(value => value.length);
  const joined = values.join('');
  const characters = /^\d+$/.test(joined) ? 'digits' : /^[0-9a-f]+$/i.test(joined) ? 'hex' :
    /^[A-Za-z0-9_-]+$/.test(joined) ? 'base64url' : 'other';
  const alphabet = characters === 'digits' ? 10 : characters === 'hex' ?
    (/[a-f]/.test(joined) && /[A-F]/.test(joined) ? 22 : 16) :
    characters === 'base64url' ? 64 : /^[\x20-\x7e]+$/.test(joined) ? 95 : 65536;
  let longestSharedStart = values[0].length;
  for (const value of values.slice(1)) {
    let i = 0;
    while (i < longestSharedStart && i < value.length && value[i] === values[0][i]) i++;
    longestSharedStart = i;
  }
  const unique = new Set(values).size;
  const patterns = [];
  if (unique < values.length) patterns.push('repeats');
  if (countsUp(values)) patterns.push('counts up');
  if (containsTime(values, now)) patterns.push('contains the time');
  if (username && values.some(value => value.includes(username))) {
    patterns.push('contains the user name');
  }
  return { samples: values.length, unique, length: { min: Math.min(...lengths), max: Math.max(...lengths) },
    characters, roughStrengthBits: Math.round(Math.min(...lengths) * Math.log2(alphabet) * 10) / 10,
    longestSharedStart, patterns };
}

// Values live only in this call. The persisted report guard records one-way
// fingerprints, never sampled login bytes. Every request uses send's sole,
// loopback-pinned transport and its existing five-second deadline.
export async function runSessions(id, method, input, inputOptions = {}) {
  const options = boundedOptions(inputOptions);
  if (method !== 'POST') throw new Error('Refused: sessions requires POST for the login request.');
  validateRequest(method, input, { json: options.json });
  await readSeal(id);
  const values = [];
  for (let i = 0; i < options.count; i++) {
    const response = await sendRequest('POST', input, { json: options.json });
    if (response.status < 200 || response.status >= 300) return { failed: true, status: response.status };
    const value = loginValue(response, options);
    rememberLoginValue(value);
    await rememberRunLoginValue(id, value);
    values.push(value);
  }
  return analyze(values, usernameFrom(options.json), Date.now());
}

export function formatSessions(result) {
  if (result.failed) return `Login failed: status ${result.status}`;
  return [
    `samples: ${result.samples}`,
    `unique: ${result.unique}`,
    `length min/max: ${result.length.min}/${result.length.max}`,
    `characters: ${result.characters}`,
    `rough strength ≈ ${result.roughStrengthBits} bits (upper bound)`,
    `longest shared start ${result.longestSharedStart} chars`,
    ...(result.patterns.length ? result.patterns : [`no pattern found in ${result.samples} samples`]),
  ].join('\n');
}
