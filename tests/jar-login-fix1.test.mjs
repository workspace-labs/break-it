import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { root, project, newRun, cli } from './helpers.mjs';
import { sendRequest, sendBadConnection } from '../scripts/lib/send.mjs';

async function server(t, handler) {
  const app = http.createServer(handler);
  await new Promise((resolve, reject) => { app.once('error', reject); app.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => app.close(resolve)));
  return `http://127.0.0.1:${app.address().port}`;
}
function command(...args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'scripts/break-it.mjs'), ...args]);
    let stdout = '', stderr = '';
    child.stdout.on('data', bytes => { stdout += bytes; }); child.stderr.on('data', bytes => { stderr += bytes; });
    child.once('error', reject); child.once('close', status => resolve({ status, stdout, stderr }));
  });
}
const send = (...args) => command('send', ...args);
const hidden = (result, value) => assert.ok(!`${result.stdout}${result.stderr}`.includes(value), 'login value stays hidden');

test('bearer-only CLI keeps a hidden login and tests logout reuse with and without revocation', async t => {
  for (const revoke of [false, true]) {
    const run = newRun(t, await project(t));
    const value = 'synthetic-bearer-only-private-login';
    let active = true;
    const url = await server(t, (req, res) => {
      if (req.url === '/login') return res.end(JSON.stringify({ token: value }));
      const valid = active && req.headers.authorization === `Bearer ${value}`;
      if (req.url === '/logout') {
        if (valid && revoke) active = false;
        res.setHeader('Set-Cookie', 'sid=; Max-Age=0');
      }
      res.statusCode = valid ? 200 : 401; res.end(JSON.stringify({ loggedIn: valid }));
    });
    const login = await send('POST', `${url}/login`, '--jar', run.id, '--keep-field', 'token');
    assert.equal(login.status, 0, login.stderr); hidden(login, value);
    assert.match(login.stdout, /kept login value from "token" \(\d+ chars\)/);
    assert.match((await send('GET', `${url}/me`, '--jar', run.id)).stdout, /Status: 200/);
    const jar = await readFile(path.join(run.dir, 'jar.json'));
    const forged = await send('GET', `${url}/me`, '--jar', run.id, '--forge', 'made-up');
    assert.match(forged.stdout, /Status: 401/); hidden(forged, value);
    assert.ok((await readFile(path.join(run.dir, 'jar.json'))).equals(jar));
    const logout = await send('POST', `${url}/logout`, '--jar', run.id, '--hold');
    assert.match(logout.stdout, /jar held: this reply's cookies were not applied/); hidden(logout, value);
    assert.ok((await readFile(path.join(run.dir, 'jar.json'))).equals(jar));
    const after = await send('GET', `${url}/me`, '--jar', run.id);
    assert.match(after.stdout, new RegExp(`Status: ${revoke ? 401 : 200}`)); hidden(after, value);
  }
});

test('hold exposes logout reuse when cookie-clearing apps retain sessions and stays blocked when revoked', async t => {
  for (const revoke of [false, true]) {
    const run = newRun(t, await project(t));
    const value = 'synthetic-cookie-logout-private';
    let active = true;
    const url = await server(t, (req, res) => {
      if (req.url === '/login') { res.setHeader('Set-Cookie', `sid=${value}; Path=/`); return res.end('logged in'); }
      const valid = active && req.headers.cookie === `sid=${value}`;
      if (req.url === '/logout') {
        res.setHeader('Set-Cookie', 'sid=; Path=/; Max-Age=0');
        if (valid && revoke) active = false;
      }
      res.statusCode = valid ? 200 : 401; res.end('bounded');
    });
    await send('POST', `${url}/login`, '--jar', run.id);
    assert.match((await send('GET', `${url}/me`, '--jar', run.id)).stdout, /Status: 200/);
    await send('POST', `${url}/logout`, '--jar', run.id, '--hold');
    assert.match((await send('GET', `${url}/me`, '--jar', run.id)).stdout, new RegExp(`Status: ${revoke ? 401 : 200}`));
  }
});

test('kept bearers replace per origin, remain origin-bound and survive cookie updates', async t => {
  const run = newRun(t, await project(t));
  const values = ['synthetic-first-private-value', 'synthetic-second-private-value'];
  const seen = []; let index = 0;
  const url = await server(t, (req, res) => {
    seen.push(req.headers.authorization);
    if (req.url === '/login') return res.end(JSON.stringify({ oddKey: values[index++] }));
    res.setHeader('Set-Cookie', 'control=okay; Path=/'); res.end('bounded');
  });
  const other = [];
  const port2 = await server(t, (req, res) => { other.push(req.headers.authorization); res.end('bounded'); });
  for (let i = 0; i < 2; i++) {
    const login = await send('POST', `${url}/login`, '--jar', run.id, '--keep-field', 'oddKey');
    hidden(login, values[i]); assert.equal(login.status, 0, login.stderr);
    await send('GET', `${url}/me`, '--jar', run.id);
  }
  await send('GET', port2, '--jar', run.id);
  await send('GET', url.replace('127.0.0.1', 'localhost'), '--jar', run.id);
  assert.ok(seen[1] === `Bearer ${values[0]}` && seen[3] === `Bearer ${values[1]}`);
  assert.equal(seen.at(-1), undefined); assert.deepEqual(other, [undefined]);
  const jar = JSON.parse(await readFile(path.join(run.dir, 'jar.json'), 'utf8'));
  assert.equal(jar.bearers.length, 1); assert.ok(jar.bearers[0].value === values[1]);
});

test('send refuses keep-field and hold misuse and explicit bearer conflict before a request', async t => {
  let hits = 0;
  const value = 'synthetic-conflict-private-value';
  const run = newRun(t, await project(t));
  const url = await server(t, (req, res) => { hits++; res.end(JSON.stringify({ token: value })); });
  for (const args of [['--keep-field', 'token'], ['--hold'], ['--jar', run.id, '--hold', '--keep-field', 'token']]) {
    const result = await send('POST', url, ...args); assert.equal(result.status, 1); hidden(result, value);
  }
  assert.equal(hits, 0);
  await send('POST', url, '--jar', run.id, '--keep-field', 'token');
  const result = await send('GET', url, '--jar', run.id, '--token', 'owner-fixed-test-key');
  assert.equal(result.status, 1); assert.match(result.stderr, /--token.*jar bearer|jar bearer.*--token/); hidden(result, value);
  assert.equal(hits, 1);
});

test('keep-field handles numeric and missing values without exposing custom fields or incomplete replies', async t => {
  const run = newRun(t, await project(t));
  const value = 'custom-cut-private-value-'.repeat(4000);
  const url = await server(t, (req, res) => {
    if (req.url === '/number') return res.end('{"custom":1234567890}');
    if (req.url === '/missing') return res.end('{"public":"no login"}');
    if (req.url === '/invalid-header') return res.end(JSON.stringify({ custom: 'private\r\nno-header' }));
    res.end(JSON.stringify({ custom: value }));
  });
  const number = await send('POST', `${url}/number`, '--jar', run.id, '--keep-field', 'custom');
  assert.match(number.stdout, /kept login value from "custom" \(10 chars\)/); hidden(number, '1234567890');
  const missing = await send('POST', `${url}/missing`, '--jar', run.id, '--keep-field', 'custom');
  assert.match(missing.stdout, /no login value at "custom"/);
  const before = await readFile(path.join(run.dir, 'jar.json'));
  const cut = await send('POST', `${url}/cut`, '--jar', run.id, '--keep-field', 'custom');
  assert.ok(!cut.stdout.includes(value.slice(0, 50))); assert.match(cut.stdout, /no login value at "custom"/);
  assert.ok((await readFile(path.join(run.dir, 'jar.json'))).equals(before));
  const invalid = await send('POST', `${url}/invalid-header`, '--jar', run.id, '--keep-field', 'custom');
  assert.equal(invalid.status, 1); hidden(invalid, 'private\r\nno-header');
});

test('keep-field privately captures a complete 4096-character bearer beyond the display cap', async t => {
  const run = newRun(t, await project(t));
  const value = 'X'.repeat(4096);
  const url = await server(t, (req, res) => {
    if (req.url === '/login') return res.end(JSON.stringify({ hiddenValue: value }));
    res.statusCode = req.headers.authorization === `Bearer ${value}` ? 200 : 401; res.end('bounded');
  });
  const login = await send('POST', `${url}/login`, '--jar', run.id, '--keep-field', 'hiddenValue');
  assert.equal(login.status, 0, login.stderr);
  assert.match(login.stdout, /kept login value from "hiddenValue" \(4096 chars\)/);
  assert.ok(!login.stdout.includes(value.slice(0, 30)));
  assert.match((await send('GET', `${url}/me`, '--jar', run.id)).stdout, /Status: 200/);
  const response = await sendRequest('POST', `${url}/login`, { jar: run.id, keepField: 'hiddenValue' });
  assert.equal(response.privateLoginBody, undefined);
});

test('Secure cookies reach protected HTTP localhost routes', async t => {
  const run = newRun(t, await project(t));
  const value = 'synthetic-secure-localhost-private';
  const url = await server(t, (req, res) => {
    if (req.url === '/login') { res.setHeader('Set-Cookie', `sid=${value}; Path=/; Secure; HttpOnly`); return res.end('logged in'); }
    res.statusCode = req.headers.cookie === `sid=${value}` ? 200 : 401; res.end('bounded');
  });
  await send('POST', `${url}/login`, '--jar', run.id);
  assert.match((await send('GET', `${url}/me`, '--jar', run.id)).stdout, /Status: 200/);
});

test('a kept bearer is refused in a fresh-process report after cleanup without disclosure', async t => {
  const run = newRun(t, await project(t));
  const value = 'synthetic-kept-report-private-value';
  const url = await server(t, (req, res) => res.end(JSON.stringify({ hiddenLogin: value })));
  const login = await send('POST', url, '--jar', run.id, '--keep-field', 'hiddenLogin');
  assert.equal(login.status, 0, login.stderr); hidden(login, value);
  assert.equal(cli('cleanup', run.id).status, 0);
  const data = { project: 'fixture', round: 1, attacks: { tried: 1, blocked: 0, gotThrough: 1 }, findings: [{
    id: 'G01', severity: 'CRITICAL', title: 'Session persists', Tried: 'Reused a logged-out session',
    Saw: value, Where: 'server.mjs:1', Advice: 'Invalidate the session' }] };
  const file = path.join(run.dir, '..', `findings-${run.id}.json`);
  t.after(() => unlink(file).catch(() => {}));
  await writeFile(file, JSON.stringify(data));
  const refused = cli('report', run.id, file);
  assert.equal(refused.status, 1); assert.match(refused.stderr, /login value/); hidden(refused, value);
  data.findings[0].Saw = 'Old login still received HTTP 200'; await writeFile(file, JSON.stringify(data));
  assert.equal(cli('report', run.id, file).status, 0);
});

test('read-only jar requests never apply cookies or create new metadata', async t => {
  const run = newRun(t, await project(t));
  const url = await server(t, (req, res) => { res.setHeader('Set-Cookie', 'sid=synthetic-read-only-value; Path=/'); res.end('bounded'); });
  await sendRequest('GET', url, { jar: run.id, readOnlyJar: true });
  await assert.rejects(readFile(path.join(run.dir, 'jar.json')), { code: 'ENOENT' });
  await assert.rejects(readFile(path.join(run.dir, 'login-shapes.json')), { code: 'ENOENT' });
});

test('fixed raw requests preserve a kept Latin-1 bearer exactly as normal HTTP does', async t => {
  const run = newRun(t, await project(t));
  const value = 'synthetic-private-caf\u00e9-login';
  const url = await server(t, (req, res) => {
    if (req.url === '/login') return res.end(JSON.stringify({ token: value }));
    res.statusCode = req.headers.authorization === `Bearer ${value}` ? 200 : 401; res.end('bounded');
  });
  const login = await send('POST', `${url}/login`, '--jar', run.id, '--keep-field', 'token');
  assert.equal(login.status, 0, login.stderr); hidden(login, value);
  const before = await readFile(path.join(run.dir, 'jar.json'));
  assert.equal((await sendRequest('GET', `${url}/me`, { jar: run.id, readOnlyJar: true })).status, 200);
  const response = await sendBadConnection('cut', 'GET', `${url}/me`, { jar: run.id,
    body: Buffer.alloc(0), length: 0, seconds: 1, deadline: performance.now() + 5000 });
  assert.equal(response.response?.status, 200);
  assert.equal(response.sentBytes, response.totalBytes);
  assert.ok((await readFile(path.join(run.dir, 'jar.json'))).equals(before));
});
