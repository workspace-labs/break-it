import { randomInt } from 'node:crypto';

export const forgeKinds = ['made-up', 'one-char', 'jwt-none', 'jwt-bad-sig'];
export function validateForge(kind) {
  if (kind !== undefined && !forgeKinds.includes(kind)) throw new Error('Refused: unknown forge kind; use made-up, one-char, jwt-none or jwt-bad-sig.');
}
function alphabet(value) {
  if (/^\d+$/.test(value)) return '0123456789';
  if (/^[0-9a-f]+$/.test(value)) return '0123456789abcdef';
  if (/^[0-9A-F]+$/.test(value)) return '0123456789ABCDEF';
  if (/^[A-Za-z0-9_-]+$/.test(value)) return 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  // Other opaque cookie/bearer values retain their observed alphabet. A one-
  // character alphabet needs one additional member of the same visible class.
  const chars = [...new Set(value)];
  return chars.length > 1 ? chars.join('') : `${chars[0]}${chars[0] === '~' ? '!' : '~'}`;
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
  const chars = alphabet(value);
  if (kind === 'one-char') {
    const last = value.at(-1);
    return value.slice(0, -1) + chars[(chars.indexOf(last) + 1) % chars.length];
  }
  let made = Array.from({ length: value.length }, () => chars[randomInt(chars.length)]).join('');
  if (made === value) made = value.slice(0, -1) + chars[(chars.indexOf(value.at(-1)) + 1) % chars.length];
  return made;
}
