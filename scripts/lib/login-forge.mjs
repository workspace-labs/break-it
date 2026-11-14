import { randomInt } from 'node:crypto';

export const forgeKinds = ['made-up', 'one-char', 'jwt-none', 'jwt-bad-sig'];
export function validateForge(kind) {
  if (kind !== undefined && !forgeKinds.includes(kind)) throw new Error('Refused: unknown forge kind; use made-up, one-char, jwt-none or jwt-bad-sig.');
}
function characterClass(character, hex, oneChar = false) {
  if (/[0-9]/.test(character)) return '0123456789';
  if (/[a-z]/.test(character)) return hex ? (oneChar ? '0123456789abcdef' : 'abcdef') : 'abcdefghijklmnopqrstuvwxyz';
  if (/[A-Z]/.test(character)) return hex ? (oneChar ? '0123456789ABCDEF' : 'ABCDEF') : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return undefined;
}
export function forgeLoginValue(value, kind) {
  validateForge(kind);
  if (typeof value !== 'string' || !value || value.length > 4096 || /[^\x21-\x7e]|;/.test(value)) {
    throw new Error('Refused: forge needs a nonempty bounded login value.');
  }
  if (kind === 'jwt-none' || kind === 'jwt-bad-sig') {
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) {
      throw new Error('Refused: this forge kind needs a JWT with three base64url parts.');
    }
    const [header, payload, signature] = value.split('.');
    if (kind === 'jwt-none') return `${Buffer.from('{"alg":"none"}').toString('base64url')}.${payload}.`;
    const bytes = Buffer.from(signature, 'base64url');
    if (!bytes.length) throw new Error('Refused: JWT signature has no bytes to alter.');
    bytes[0] ^= 1;
    return `${header}.${payload}.${bytes.toString('base64url')}`;
  }
  const hex = /^[a-f]*$/i.test(value.replace(/[^a-z]/gi, ''));
  const last = value.search(/[a-z0-9][^a-z0-9]*$/i);
  if (last < 0) throw new Error('Refused: forge needs a login value with a letter or digit.');
  const next = oneChar => {
    const chars = characterClass(value[last], hex, oneChar);
    return chars[(chars.indexOf(value[last]) + 1) % chars.length];
  };
  if (kind === 'one-char') {
    return value.slice(0, last) + next(true) + value.slice(last + 1);
  }
  let made = Array.from(value, character => {
    const chars = characterClass(character, hex);
    return chars ? chars[randomInt(chars.length)] : character;
  }).join('');
  if (made === value) made = value.slice(0, last) + next(false) + value.slice(last + 1);
  return made;
}
