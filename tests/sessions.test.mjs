import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { project, newRun, root } from './helpers.mjs';
import { runSessions, sessionsOptions, formatSessions } from '../scripts/lib/sessions.mjs';

async function server(t, handler) {
  const app = http.createServer(handler);
  await new Promise((resolve, reject) => {
    app.once('error', reject);
    app.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => app.close(resolve)));
  return `http://127.0.0.1:${app.address().port}`;
}

async function run(t) { return newRun(t, await project(t)); }

function command(...args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'scripts/break-it.mjs'), 'sessions', ...args]);
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', status => resolve({ status, stdout, stderr }));
  });
}

const request = { json: '{"username":"synthetic-alice","password":"synthetic-password"}', field: 'token' };

test('sessions options require JSON and exactly one login value source', () => {
  assert.equal(sessionsOptions(['--json', '{}', '--field', 'token']).count, 10);
  assert.equal(sessionsOptions(['--json', '{}', '--cookie-name', 'sid', '--count', '20']).count, 20);
  for (const args of [[], ['--json', '{}'], ['--field', 'token'],
    ['--json', '{}', '--field', 'token', '--cookie-name', 'sid'],
    ['--json', '{}', '--field', 'token', '--field', 'token'],
    ['--json', '{}', '--field', 'token', '--count'],
    ['--json', '{}', '--field', 'token', '--unknown', 'x']]) {
    assert.throws(() => sessionsOptions(args), /Refused:/);
  }
  for (const value of ['0', '21', '1e1', '-1', '1.5', ' 10', 'Infinity']) {
    assert.throws(() => sessionsOptions(['--json', '{}', '--field', 'token', '--count', value]), /count/);
  }
});

test('sessions defaults to ten sequential logins with the same disposable request and shape-only output', async t => {
  const state = await run(t);
  let active = 0, maximum = 0, count = 0;
  const bodies = [], values = [];
  const url = await server(t, async (req, res) => {
    maximum = Math.max(maximum, ++active);
    let body = '';
    for await (const chunk of req) body += chunk;
    bodies.push(body);
    count++;
    const value = randomUUID();
    values.push(value);
    setTimeout(() => { active--; res.end(JSON.stringify({ token: value })); }, 4);
  });
  const result = await runSessions(state.id, 'POST', url, request);
  assert.equal(count, 10);
  assert.equal(maximum, 1);
  assert.deepEqual(new Set(bodies), new Set([request.json]));
  assert.equal(result.samples, 10);
  assert.equal(result.unique, 10);
  const text = formatSessions(result);
  for (const value of values) assert.ok(!text.includes(value));
  assert.match(text, /samples: 10/);
  assert.match(text, /unique: 10/);
  assert.match(text, /length min\/max: 36\/36/);
  assert.match(text, /characters: base64url/);
  assert.match(text, /rough strength ≈ \d+(?:\.\d+)? bits \(upper bound\)/);
  assert.match(text, /longest shared start \d+ chars/);
  assert.match(text, /no pattern found in 10 samples/);
  assert.doesNotMatch(text, /\b(?:safe|random)\b/i);
  async function checkFiles(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await checkFiles(file);
      else if (entry.isFile()) {
        const saved = await readFile(file, 'utf8');
        for (const value of values) assert.ok(!saved.includes(value), 'sampled login bytes never saved');
      }
    }
  }
  await checkFiles(state.dir);
});

test('sessions accepts twenty and rejects invalid requests before any login', async t => {
  const state = await run(t);
  let count = 0;
  const url = await server(t, (req, res) => { count++; res.end('{"token":"synthetic-constant"}'); });
  assert.equal((await runSessions(state.id, 'POST', url, { ...request, count: 20 })).samples, 20);
  for (const options of [{ ...request, count: 21 }, { ...request, count: 0 }, { ...request, count: '10' },
    { ...request, count: 1.2 }, { ...request, unknown: true }]) {
    await assert.rejects(runSessions(state.id, 'POST', url, options), /Refused:/);
  }
  await assert.rejects(runSessions('../outside', 'POST', url, request), /run id/);
  await assert.rejects(runSessions(state.id, 'GET', url, request), /POST/);
  await assert.rejects(runSessions(state.id, 'POST', 'http://example.com/login', request), /local copy/);
  assert.equal(count, 20);
});

test('sessions detects repeated, increasing, timestamp and user-name patterns without their bytes', async t => {
  const state = await run(t);
  for (const [kind, make] of [
    ['repeats', () => 'repeated-synthetic-value'],
    ['counts up', i => `local-session-${1000 + i}`],
    ['contains the time', i => `local-${Math.floor(Date.now() / 1000)}-${i}`],
    ['contains the time', i => `local-${Date.now()}-${i}`],
    ['contains the user name', i => `synthetic-alice-${1000 + i}`],
  ]) {
    let count = 0;
    const values = [];
    const url = await server(t, (req, res) => {
      const value = make(++count); values.push(value); res.end(JSON.stringify({ token: value }));
    });
    const text = formatSessions(await runSessions(state.id, 'POST', url, { ...request, count: 4 }));
    assert.ok(text.split('\n').includes(kind), kind);
    for (const value of values) assert.ok(!text.includes(value), kind);
  }
});

test('sessions character and length analysis labels digits, hex and other without overclaiming', async t => {
  const state = await run(t);
  for (const [value, characters] of [['009911', 'digits'], ['aaffee', 'hex'], ['quoted.value', 'other']]) {
    const url = await server(t, (req, res) => res.end(JSON.stringify({ token: value })));
    const result = await runSessions(state.id, 'POST', url, { ...request, count: 1 });
    assert.match(formatSessions(result), new RegExp(`characters: ${characters}`));
    assert.ok(!JSON.stringify(result).includes(value));
  }
});

test('sessions matches the literal user name and does not case-fold a short name into UUID samples', async t => {
  const state = await run(t);
  const url = await server(t, (req, res) => res.end(JSON.stringify({ token: randomUUID() })));
  const result = await runSessions(state.id, 'POST', url,
    { json: '{"username":"A","password":"synthetic-password"}', field: 'token', count: 10 });
  assert.deepEqual(result.patterns, []);
  const named = await server(t, (req, res) => res.end('{"token":"prefix-A-suffix"}'));
  const includesName = await runSessions(state.id, 'POST', named,
    { json: '{"username":"A","password":"synthetic-password"}', field: 'token', count: 1 });
  assert.ok(includesName.patterns.includes('contains the user name'));
});

test('sessions can read a named cookie while ignoring unrelated cookies and never persists it', async t => {
  const state = await run(t);
  let count = 0;
  const values = [];
  const url = await server(t, (req, res) => {
    assert.equal(req.headers.cookie, undefined, 'sampler has no jar and does not re-send cookies');
    count++;
    const value = `synthetic-cookie-${count}`;
    values.push(value);
    res.setHeader('Set-Cookie', ['unrelated=unrelated-value; Path=/', `sid=${value}; Path=/; HttpOnly`]);
    res.end('{}');
  });
  const result = await runSessions(state.id, 'POST', url, { json: request.json, cookieName: 'sid', count: 3 });
  assert.equal(result.samples, 3);
  const text = formatSessions(result);
  assert.match(text, /counts up/);
  for (const value of values) assert.ok(!text.includes(value));
  assert.ok(!(await readdir(state.dir)).includes('jar.json'));
});

test('sessions failed login stops at the failed status and discards analysis', async t => {
  const state = await run(t);
  let count = 0;
  const url = await server(t, (req, res) => {
    count++;
    res.statusCode = count === 3 ? 429 : 200;
    res.end(JSON.stringify({ token: 'synthetic-prior-secret', error: 'synthetic-reflected-secret' }));
  });
  const result = await runSessions(state.id, 'POST', url, request);
  assert.equal(count, 3);
  assert.deepEqual(result, { failed: true, status: 429 });
  assert.equal(formatSessions(result), 'Login failed: status 429');
});

test('sessions refuses malformed or missing login values without printing response data', async t => {
  const state = await run(t);
  for (const response of ['not-json synthetic-sensitive-data', '{"wrong":"synthetic-sensitive-data"}', '{"token":""}']) {
    let count = 0;
    const url = await server(t, (req, res) => { count++; res.end(response); });
    await assert.rejects(runSessions(state.id, 'POST', url, request), error => {
      assert.match(error.message, /Refused:/);
      assert.ok(!error.message.includes('synthetic-sensitive-data'));
      return true;
    });
    assert.equal(count, 1);
  }
});

test('sessions CLI has shape-only stdout and stderr including short sampled values', async t => {
  const state = await run(t);
  const url = await server(t, (req, res) => res.end('{"custom_login":"xy!z"}'));
  const result = await command(state.id, 'POST', url, '--json', request.json, '--field', 'custom_login', '--count', '2');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /samples: 2/);
  assert.match(result.stdout, /repeats/);
  assert.ok(!(result.stdout + result.stderr).includes('xy!z'));
  for (const value of ['0', '21', '1e1']) {
    const refused = await command(state.id, 'POST', url, '--json', request.json, '--field', 'custom_login', '--count', value);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /count/);
  }
});

test('sessions returns redirects without following them or making an extra request', async t => {
  const state = await run(t);
  let requests = 0;
  const url = await server(t, (req, res) => {
    requests++; res.writeHead(302, { Location: 'https://example.com' }); res.end('synthetic-hidden-body');
  });
  assert.deepEqual(await runSessions(state.id, 'POST', url, request), { failed: true, status: 302 });
  assert.equal(requests, 1);
});
