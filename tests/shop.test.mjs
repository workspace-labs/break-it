import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, cp, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runDemo, startShop, stopShop, probeShop, examplePath } from '../scripts/demo-shop.mjs';

test('shop source gives away no hole, try id or demo answer', async () => {
  const source = await readFile(path.join(examplePath, 'server.mjs'), 'utf8');
  assert.doesNotMatch(source, /PLANTED|HOLE|A0|B0|demo/i);
});

test('shop answer key stays outside the app and identifies actual source lines', async () => {
  const keyPath = path.join(examplePath, '..', 'shop-app-answers.md');
  assert.equal(path.dirname(keyPath), path.dirname(examplePath));
  const key = await readFile(keyPath, 'utf8');
  const source = await readFile(path.join(examplePath, 'server.mjs'), 'utf8');
  for (const [id, anchor] of [
    ['A09', 'const limited ='],
    ['A01', 'if (!data.text) throw'],
    ['B01', 'const requireOwner =']
  ]) {
    const line = source.split('\n').findIndex(text => text.includes(anchor)) + 1;
    assert.ok(line > 0, anchor);
    assert.ok(key.includes(`\`${id}\` — \`server.mjs:${line}\``), `${id} answer line`);
    assert.ok(key.includes(`\`${anchor}\``), `${id} answer anchor`);
  }
});

test('shop end to end detects planted holes and preserves the safe route', async () => {
  const result = await runDemo();
  assert.deepEqual(result.rounds[0].findings.map(f => [f.id, f.severity]),
    [['B01', 'CRITICAL'], ['A01', 'SMALL'], ['A09', 'SMALL']]);
  assert.ok(result.rounds[0].findings.every(f => /^server\.mjs:\d+$/.test(f.Where)));
  assert.equal(result.rounds[0].findings.some(f => f.id === 'B02-safe'), false);
  assert.equal(result.rounds[0].attacks.blocked, 1);
  assert.deepEqual(result.rounds[1].findings, []);
  assert.equal(result.rounds[1].attacks.blocked, 4);
  assert.match(result.output, /BREAK-IT REPORT shop-app/);
  assert.match(result.output, /ROUND 2 shop-app/);
  assert.match(result.output, /Seal: real project unchanged/);
  assert.match(result.output, /Copy deleted\. Nothing left behind\. Break-it changed no code\./);
  for (const folder of result.runFolders) await assert.rejects(access(folder));
});

test('probe detects a safe-route owner check removed in a scratch fixture', async () => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'break-it-shop-test-'));
  let child;
  try {
    await cp(examplePath, scratch, { recursive: true });
    const file = path.join(scratch, 'server.mjs');
    const source = await readFile(file, 'utf8');
    const guard = "if (order.owner !== user) return send(res, 403, { error: 'Not your order' });";
    assert.ok(source.includes(guard));
    await writeFile(file, source.replace(guard, '/* owner check deliberately absent in this test */'));
    child = await startShop(scratch);
    const result = await probeShop(child.port, scratch);
    assert.equal(result.findings.find(f => f.id === 'B02-safe')?.severity, 'CRITICAL');
  } finally {
    if (child) await stopShop(child);
    await rm(scratch, { recursive: true, force: true });
  }
});
