import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, cp, rm, access, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runDemo, startShop, stopShop, probeShop, examplePath } from '../scripts/demo-shop.mjs';
import { sendRequest } from '../scripts/lib/send.mjs';

test('shop source gives away no hole, try id or demo answer', async () => {
  for (const file of await readdir(examplePath)) {
    const source = await readFile(path.join(examplePath, file), 'utf8');
    assert.doesNotMatch(source, /PLANTED|HOLE|[ABC]0|demo/i, file);
  }
});

test('shop answer key stays outside the app and identifies actual source lines', async () => {
  const keyPath = path.join(examplePath, '..', 'shop-app-answers.md');
  assert.equal(path.dirname(keyPath), path.dirname(examplePath));
  const key = await readFile(keyPath, 'utf8');
  const source = await readFile(path.join(examplePath, 'server.mjs'), 'utf8');
  for (const [id, anchor] of [
    ['A09', 'const limited ='],
    ['A01', 'if (!data.text) throw'],
    ['B01', 'const requireOwner ='],
    ['C03', 'if (!omitPrivate) profile.passwordHash'],
    ['C04', 'const hideDetails =']
  ]) {
    const line = source.split('\n').findIndex(text => text.includes(anchor)) + 1;
    assert.ok(line > 0, anchor);
    assert.ok(key.includes(`\`${id}\` — \`server.mjs:${line}\``), `${id} answer line`);
    assert.ok(key.includes(`\`${anchor}\``), `${id} answer anchor`);
  }
  const config = await readFile(path.join(examplePath, 'config.mjs'), 'utf8');
  const line = config.split('\n').findIndex(text => text.includes('export const API_KEY =')) + 1;
  assert.ok(key.includes(`\`C01\` — \`config.mjs:${line}\``));
});

test('shop end to end detects planted holes and preserves the safe route', async () => {
  const result = await runDemo();
  assert.deepEqual(result.rounds[0].findings.map(f => [f.id, f.severity]),
    [['C01', 'CRITICAL'], ['B01', 'CRITICAL'], ['A01', 'SMALL'], ['A09', 'SMALL'],
      ['C03', 'CRITICAL'], ['C04', 'SMALL']]);
  assert.ok(result.rounds[0].findings.every(f => /^(?:server|config)\.mjs:\d+$/.test(f.Where)));
  assert.equal(result.rounds[0].findings.some(f => f.id === 'B02-safe'), false);
  assert.equal(result.rounds[0].attacks.blocked, 2);
  assert.equal(result.rounds[0].attacks.tried, 8);
  assert.equal(result.rounds[0].findings.some(f => f.Where.startsWith('.env.example:')), false);
  const config = await readFile(path.join(examplePath, 'config.mjs'), 'utf8');
  const value = /API_KEY = ["']([^"']+)/.exec(config)?.[1];
  assert.ok(value, 'synthetic config assignment exists');
  assert.equal(result.output.includes(value), false);
  assert.equal(result.output.includes('synthetic-password-hash-local-only'), false);
  assert.deepEqual(result.rounds[1].findings, []);
  assert.equal(result.rounds[1].attacks.blocked, 8);
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


test('shop leak routes expose only synthetic data on a disposable copy', async () => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'break-it-shop-leaks-'));
  let app;
  try {
    await cp(examplePath, scratch, { recursive: true });
    app = await startShop(scratch);
    const base = `http://127.0.0.1:${app.port}`;
    const login = await sendRequest('POST', `${base}/login`, {
      json: JSON.stringify({ user: 'A', password: 'example-a' })
    });
    const token = JSON.parse(login.body).session;
    const profile = await sendRequest('GET', `${base}/profile`, { token });
    assert.equal(profile.status, 200);
    assert.equal(JSON.parse(profile.body).passwordHash, 'synthetic-password-hash-local-only');
    const error = await sendRequest('GET', `${base}/catalog-error`, { token });
    assert.equal(error.status, 500);
    assert.match(error.body, /SQLITE_ERROR/);
    assert.match(error.body, /\/srv\/shop\/catalog\.mjs:18/);
  } finally {
    if (app) await stopShop(app);
    await rm(scratch, { recursive: true, force: true });
  }
});

test('shop config uses a synthetic generic assignment and documents its placeholder control', async () => {
  const config = await readFile(path.join(examplePath, 'config.mjs'), 'utf8');
  assert.match(config, /export const API_KEY = ["']shopkey-EXAMPLE-/);
  assert.doesNotMatch(config, /ghp_|github_pat_|AKIA|sk_live_/);
  const server = await readFile(path.join(examplePath, 'server.mjs'), 'utf8');
  assert.match(server, /import \{ API_KEY \} from ['"]\.\/config\.mjs['"]/);
  const placeholder = await readFile(path.join(examplePath, '.env.example'), 'utf8');
  assert.match(placeholder, /API_KEY=["']?your-key-here/);
});
