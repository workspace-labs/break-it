import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { copyProject } from '../scripts/lib/copy.mjs';
import { runPath } from '../scripts/lib/runs.mjs';
import { cleanupRun } from '../scripts/lib/cleanup.mjs';
import { sendRequest } from '../scripts/lib/send.mjs';
import { startShop, stopShop, examplePath } from '../scripts/demo-shop.mjs';
import { root, cli } from './helpers.mjs';

async function setup(t, revoked) {
  const id = await copyProject(examplePath);
  const dir = await runPath(id);
  const copy = path.join(dir, 'copy');
  let app;
  t.after(async () => {
    if (app) await stopShop(app);
    await cleanupRun(id);
    await cleanupRun(id);
  });
  if (revoked) {
    const file = path.join(copy, 'server.mjs');
    let source = await readFile(file, 'utf8');
    for (const name of ['invalidateLogout', 'unpredictableSessions', 'expireSessions',
      'invalidateOtherSessions', 'protectedCookie', 'uniformLoginErrors']) {
      source = source.replace(`const ${name} = false;`, `const ${name} = true;`);
    }
    await writeFile(file, source);
  }
  app = await startShop(copy);
  return { id, dir, base: `http://127.0.0.1:${app.port}` };
}

for (const revoked of [false, true]) {
  test(`shop logout clears its cookie when server revocation is ${revoked ? 'on' : 'off'}`, async t => {
    const { base } = await setup(t, revoked);
    const login = await sendRequest('POST', `${base}/login`, {
      json: JSON.stringify({ user: 'A', password: 'example-a' }) });
    const token = JSON.parse(login.body).session;
    const logout = await sendRequest('POST', `${base}/logout`, { token });
    assert.equal(logout.status, 200);
    assert.ok(logout.headers['set-cookie'].includes('shop_session=; Path=/; Max-Age=0'));
    const reused = await sendRequest('GET', `${base}/safe-orders/1`, { token });
    assert.equal(reused.status, revoked ? 401 : 200);
  });

  test(`documented G01 CLI commands ${revoked ? 'block revoked' : 'find retained'} shop sessions despite cookie clearing`, async t => {
    const { base, id, dir } = await setup(t, revoked);
    const reference = await readFile(path.join(root, 'references/attacks-login.md'), 'utf8');
    const section = reference.split('## G01: Logout does not log out')[1]?.split('## G02:')[0];
    const commands = section?.split('\n').map(line => line.trim()).filter(line => line.startsWith('node scripts/break-it.mjs '));
    assert.equal(commands?.length, 4, 'the four documented G01 commands are present');
    const output = [];
    let jarBeforeLogout;
    for (const [index, command] of commands.entries()) {
      const substituted = command.replaceAll('<run-id>', id).replaceAll('http://localhost:4000', base);
      // The documented shell has one single-quoted JSON body and ordinary
      // whitespace-separated arguments; no shell or response value is executed.
      const args = [...substituted.matchAll(/'([^']*)'|([^\s]+)/g)].map(match => match[1] ?? match[2]).slice(2);
      const result = cli(...args);
      assert.equal(result.status, 0, `documented command ${index + 1} ran successfully`);
      output.push(result.stdout + result.stderr);
      const status = /^Status: (\d+)$/m.exec(result.stdout)?.[1];
      assert.equal(status, index === 3 && revoked ? '401' : '200');
      if (index === 1) jarBeforeLogout = await readFile(path.join(dir, 'jar.json'));
      if (index === 2) assert.ok(result.stdout.includes("jar held: this reply's cookies were not applied"));
    }
    const jarAfterLogout = await readFile(path.join(dir, 'jar.json'));
    assert.ok(jarBeforeLogout.equals(jarAfterLogout), 'the held logout leaves the old cookie intact');
    const values = JSON.parse(jarAfterLogout).cookies.map(cookie => cookie.value);
    for (const value of values) assert.ok(!output.join('\n').includes(value), 'no original login value appears in CLI output');
    const relogin = cli('send', 'POST', `${base}/login`, '--jar', id, '--json', '{"user":"A","password":"example-a"}');
    assert.equal(relogin.status, 0);
    assert.equal(cli('send', 'POST', `${base}/logout`, '--jar', id).status, 0);
    const ordinary = cli('send', 'GET', `${base}/safe-orders/1`, '--jar', id);
    assert.match(ordinary.stdout, /^Status: 401$/m, 'without hold, cookie removal cannot establish revocation');
  });
}
