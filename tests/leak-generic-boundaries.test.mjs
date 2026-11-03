import test from 'node:test';
import assert from 'node:assert/strict';
import { findSecrets } from '../scripts/lib/leaks.mjs';

test('F1 empty unquoted assignments do not consume another field on the next line', () => {
  const value = 'next-line-SYNTHETIC-123456789';
  const hits = findSecrets(`API_KEY=\nTOKEN=${value}\nDB_PASSWORD=\n   \n`);
  assert.equal(hits.length, 1, 'only the field holding a literal is reported');
  assert.equal(hits[0].pattern, 'generic token');
  assert.equal(hits[0].line, 2);
  assert.ok(hits[0].value === value, 'the next field name is not part of its value');
});

test('F1 quoted values still allow assignment whitespace across a line break', () => {
  const value = 'quoted-next-line-SYNTHETIC-123456789';
  const hits = findSecrets(`secret =\n  "${value}";`);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 2);
  assert.ok(hits[0].value === value, 'the complete quoted literal is retained');
});
