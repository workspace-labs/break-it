import test from 'node:test';
import assert from 'node:assert/strict';
import { findSecrets, redactSecrets } from '../scripts/lib/leaks.mjs';

test('generic credentials may contain other quote types and escaped delimiters', () => {
  for (const value of ["long'quoted-password-0123456789", 'long\\"escaped-password-0123456789']) {
    const text = `password = "${value}"`;
    const hits = findSecrets(text);
    assert.equal(hits.length, 1, 'quoted assignment is detected');
    assert.ok(hits[0].value === value, 'the entire value is masked');
    assert.ok(!redactSecrets(text).includes(value), 'redaction hides the whole value');
  }
});

test('a generic value overlapping a private-key header cannot expose the key body', () => {
  const body = 'SYNTHETIC-KEY-BODY-NEVER-DISPLAY';
  const text = `password = "prefix-----BEGIN PRIVATE KEY-----"\n${body}\n-----END PRIVATE KEY-----`;
  const output = redactSecrets(text);
  assert.ok(!output.includes(body), 'overlapping matches still hide the private-key body');
});
