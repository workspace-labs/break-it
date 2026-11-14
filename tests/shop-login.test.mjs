import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { copyProject } from '../scripts/lib/copy.mjs';
import { runPath } from '../scripts/lib/runs.mjs';
import { cleanupRun } from '../scripts/lib/cleanup.mjs';
import { sendRequest } from '../scripts/lib/send.mjs';
import { startShop, stopShop, examplePath } from '../scripts/demo-shop.mjs';

const switches = ['invalidateLogout', 'unpredictableSessions', 'expireSessions',
  'invalidateOtherSessions', 'protectedCookie', 'uniformLoginErrors'];

for (const repaired of [false, true]) {
  test(`shop login/session controls on ${repaired ? 'repaired' : 'initial'} throwaway copy`, async t => {
    const id = await copyProject(examplePath);
    const folder = path.join(await runPath(id), 'copy');
    let app;
    t.after(async () => {
      if (app) await stopShop(app);
      await cleanupRun(id);
      await cleanupRun(id);
    });
    if (repaired) {
      const file = path.join(folder, 'server.mjs');
      let source = await readFile(file, 'utf8');
      for (const name of switches) {
        assert.ok(source.includes(`const ${name} = false;`));
        source = source.replace(`const ${name} = false;`, `const ${name} = true;`);
      }
      await writeFile(file, source);
    }
    app = await startShop(folder);
    const base = `http://127.0.0.1:${app.port}`;
    const login = async () => sendRequest('POST', `${base}/login`, {
      json: JSON.stringify({ user: 'A', password: 'example-a' }), jar: id
    });
    const first = await login();
    const second = await login();
    const token = JSON.parse(first.body).session;
    const other = JSON.parse(second.body).session;
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal((await sendRequest('GET', `${base}/safe-orders/1`, { jar: id })).status, 200);
    assert.equal((await sendRequest('GET', `${base}/safe-orders/1`, { token })).status, 200);
    const cookie = first.headers['set-cookie']?.find(value => value.startsWith('shop_session='));
    assert.ok(cookie?.startsWith(`shop_session=${token}; Path=/`));
    assert.equal(/HttpOnly/.test(cookie), repaired);
    assert.equal(/SameSite=Lax/.test(cookie), repaired);
    assert.equal(/Max-Age=1800/.test(cookie), repaired);
    if (repaired) assert.match(token, /^[a-f0-9-]{36}$/);
    else assert.equal(BigInt(other) - BigInt(token), 10n);
    assert.equal((await sendRequest('POST', `${base}/logout`, { token })).status, 200);
    assert.equal((await sendRequest('GET', `${base}/safe-orders/1`, { token })).status, repaired ? 401 : 200);
    const changed = await sendRequest('POST', `${base}/password`, { token: other,
      json: JSON.stringify({ current: 'wrong-local-password', password: 'example-a-new' }) });
    assert.equal(changed.status, 403);
    const third = JSON.parse((await login()).body).session;
    assert.equal((await sendRequest('POST', `${base}/password`, { token: other,
      json: JSON.stringify({ current: 'example-a', password: 'example-a-new' }) })).status, 200);
    assert.equal((await sendRequest('GET', `${base}/safe-orders/1`, { token: third })).status, repaired ? 401 : 200);
    assert.equal((await sendRequest('GET', `${base}/safe-orders/1`, { token: other })).status, 200);
    const wrong = await sendRequest('POST', `${base}/login`, {
      json: JSON.stringify({ user: 'A', password: 'wrong-local-password' }) });
    const missing = await sendRequest('POST', `${base}/login`, {
      json: JSON.stringify({ user: 'absent-local-user', password: 'wrong-local-password' }) });
    assert.equal(wrong.status, 401);
    assert.equal(missing.status, 401);
    assert.equal(wrong.body === missing.body, repaired);
  });
}

test('shop server source keeps every Family G answer outside the app', async () => {
  for (const name of await readdir(examplePath)) {
    assert.doesNotMatch(await readFile(path.join(examplePath, name), 'utf8'), /PLANTED|HOLE|[ABCDEFG]0|demo/i);
  }
});

test('shop repaired lifetime is enforced by the server without a real-time wait', async t => {
  const id = await copyProject(examplePath);
  const folder = path.join(await runPath(id), 'copy');
  let app;
  t.after(async () => {
    if (app) await stopShop(app);
    await cleanupRun(id);
    await cleanupRun(id);
  });
  const file = path.join(folder, 'server.mjs');
  const source = await readFile(file, 'utf8');
  await writeFile(file, source.replace('const expireSessions = false;', 'const expireSessions = true;')
    .replace('const sessionLifetime = 1800;', 'const sessionLifetime = 0;'));
  app = await startShop(folder);
  const base = `http://127.0.0.1:${app.port}`;
  const login = await sendRequest('POST', `${base}/login`, {
    json: JSON.stringify({ user: 'A', password: 'example-a' }) });
  const token = JSON.parse(login.body).session;
  assert.equal(login.status, 200);
  assert.equal((await sendRequest('GET', `${base}/safe-orders/1`, { token })).status, 401);
});
