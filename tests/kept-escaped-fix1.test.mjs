import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { root, project, newRun } from './helpers.mjs';

async function server(t, handler) {
  const app = http.createServer(handler);
  await new Promise((resolve, reject) => { app.once('error', reject); app.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => app.close(resolve)));
  return `http://127.0.0.1:${app.address().port}`;
}
function send(...args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'scripts/break-it.mjs'), 'send', ...args]);
    let stdout = '', stderr = '';
    child.stdout.on('data', bytes => { stdout += bytes; }); child.stderr.on('data', bytes => { stderr += bytes; });
    child.once('error', reject); child.once('close', status => resolve({ status, stdout, stderr }));
  });
}

test('Unicode-escaped custom login stays wholly masked alongside an unrelated short cookie', async t => {
  const run = newRun(t, await project(t));
  const value = 'synthetic-kept-attribute-private-value';
  const url = await server(t, (req, res) => {
    res.setHeader('Set-Cookie', 'unrelated=a; Path=/; HttpOnly; SameSite=Lax');
    res.end(JSON.stringify({ customLogin: value }).replace(value, value.replaceAll('a', '\\u0061')));
  });
  const result = await send('POST', `${url}/login`, '--jar', run.id, '--keep-field', 'customLogin', '--headers');
  const output = result.stdout + result.stderr;
  assert.ok(result.status === 0, 'login succeeded');
  assert.ok(!output.includes(value), 'whole bearer stays hidden');
  assert.ok(!output.includes('synthetic-kept-'), 'no bearer prefix survives short-cookie masking');
  assert.ok(output.includes('kept login value from "customLogin"'), 'required kept notice remains readable');
  assert.ok(output.includes('Set-Cookie: unrelated=•••• (1 chars); Path=/; HttpOnly; SameSite=Lax'),
    'unrelated cookie does not change ordinary flags');
});

test('Unicode-escaped bearer prefixes stay hidden across cut login and protected jar replies', async t => {
  const run = newRun(t, await project(t));
  const value = 'X'.repeat(3000);
  const encoded = '\\u0058'.repeat(value.length);
  const url = await server(t, (req, res) => {
    if (req.url === '/login') return res.end(`{"customLogin":"${encoded}"}`);
    const valid = req.headers.authorization === `Bearer ${value}`;
    res.statusCode = valid ? 200 : 401;
    res.end(valid ? `{"echo":"${encoded}"}` : '{"error":"Log in first"}');
  });
  const login = await send('POST', `${url}/login`, '--jar', run.id, '--keep-field', 'customLogin');
  const loginOutput = login.stdout + login.stderr;
  assert.ok(login.status === 0, 'login command succeeded');
  assert.ok(loginOutput.includes('kept login value from "customLogin" (3000 chars)'), 'complete private value was kept');
  assert.ok(!loginOutput.includes('\\u0058'.repeat(3)), 'cut login hides the encoded bearer prefix');
  assert.ok(!loginOutput.includes(value.slice(0, 30)), 'cut login hides a decoded bearer prefix');
  const protectedReply = await send('GET', `${url}/me`, '--jar', run.id);
  const protectedOutput = protectedReply.stdout + protectedReply.stderr;
  assert.ok(protectedReply.status === 0 && protectedOutput.includes('Status: 200'), 'stored bearer reaches protected route');
  assert.ok(!protectedOutput.includes('\\u0058'.repeat(3)), 'cut protected reply hides the encoded bearer prefix');
  assert.ok(!protectedOutput.includes(value.slice(0, 30)), 'cut protected reply hides a decoded bearer prefix');
});

test('typed token body keeps the original value length after kept-bearer masking', async t => {
  const run = newRun(t, await project(t));
  const value = 'synthetic-typed-field-token-private';
  const url = await server(t, (req, res) => res.end(JSON.stringify({ token: value })));
  const result = await send('POST', `${url}/login`, '--jar', run.id, '--keep-field', 'token');
  assert.ok(result.status === 0, 'typed login succeeded');
  let displayed;
  try { displayed = JSON.parse(result.stdout.split('\n')[1])?.token; }
  catch { throw new Error('Typed login body did not produce parseable masked JSON'); }
  assert.ok(typeof displayed === 'string' && displayed.includes(`(${value.length} chars)`),
    'typed field displays the original character count rather than marker length');
  assert.ok(!`${result.stdout}${result.stderr}`.includes(value), 'typed value stays hidden');
});
