import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { forgeLoginValue } from '../scripts/lib/login-forge.mjs';
import { sendRequest } from '../scripts/lib/send.mjs';

const uuid = '01234567-89ab-cdef-ABCD-ef012345678f';
const uuidShape = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

test('F3 made-up preserves separators and each position class in UUID, hex and mixed keys', () => {
  for (const original of [uuid, 'A1-b2-C3_f4!', 'User-ID_0012.END', '0123456789']) {
    const hex = /^[a-f]*$/i.test(original.replace(/[^a-z]/gi, ''));
    for (let sample = 0; sample < 30; sample++) {
      const forged = forgeLoginValue(original, 'made-up');
      assert.ok(forged !== original, 'made-up must differ');
      assert.ok(forged.length === original.length, 'same length');
      for (let i = 0; i < original.length; i++) {
        const before = original[i], after = forged[i];
        if (/\d/.test(before)) assert.ok(/\d/.test(after), 'digit position stays a digit');
        else if (/[a-z]/.test(before)) assert.ok((hex ? /^[a-f]$/ : /^[a-z]$/).test(after), 'lowercase class stays');
        else if (/[A-Z]/.test(before)) assert.ok((hex ? /^[A-F]$/ : /^[A-Z]$/).test(after), 'uppercase class stays');
        else assert.ok(after === before, 'separator stays in place');
      }
      if (original === uuid) assert.ok(uuidShape.test(forged), 'UUID format stays');
    }
  }
});

test('F3 one-char changes the last alphanumeric, preserves suffixes and wraps hex f to zero', () => {
  for (const [original, last] of [[uuid, '0'], ['ABCD-F', '0'], ['1239--', '0'], ['UserZ!!', 'A'], ['userz..', 'a']]) {
    const forged = forgeLoginValue(original, 'one-char');
    const index = original.search(/[a-z0-9][^a-z0-9]*$/i);
    assert.ok(forged.length === original.length);
    assert.ok(forged.slice(0, index) === original.slice(0, index), 'prefix unchanged');
    assert.ok(forged.slice(index + 1) === original.slice(index + 1), 'separator suffix unchanged');
    assert.ok(forged[index] === last, 'last alphanumeric wraps within its class');
    assert.ok(forged !== original);
    if (original === uuid) assert.ok(uuidShape.test(forged));
  }
  assert.throws(() => forgeLoginValue('---', 'made-up'), /letter or digit/);
  assert.throws(() => forgeLoginValue('---', 'one-char'), /letter or digit/);
});

test('F3 format-only localhost app is found by both fixed UUID forgeries', async t => {
  const accepted = [];
  const app = http.createServer((req, res) => {
    const value = req.headers.authorization?.slice(7) ?? '';
    const valid = uuidShape.test(value);
    accepted.push(valid && value !== uuid);
    res.writeHead(valid ? 200 : 401);
    res.end(valid ? '{"user":"synthetic"}' : '{"error":"invalid shape"}');
  });
  await new Promise((resolve, reject) => { app.once('error', reject); app.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => app.close(resolve)));
  const url = `http://127.0.0.1:${app.address().port}/private`;
  for (const kind of ['made-up', 'one-char']) {
    const result = await sendRequest('GET', url, { token: uuid, forge: kind });
    assert.ok(result.status === 200, 'forged shape must reach the vulnerable logged-in path');
  }
  assert.ok(accepted.length === 2 && accepted.every(Boolean));
});
