import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { root, project, newRun } from './helpers.mjs';
import { uploadOptions } from '../scripts/lib/upload.mjs';
import { netOptions } from '../scripts/lib/network.mjs';
import { loadOptions } from '../scripts/lib/load.mjs';

function command(...args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'scripts/break-it.mjs'), ...args]);
    let stdout = '', stderr = '';
    child.stdout.on('data', bytes => { stdout += bytes; });
    child.stderr.on('data', bytes => { stderr += bytes; });
    child.once('error', reject);
    child.once('close', status => resolve({ status, stdout, stderr }));
  });
}

async function server(t, handler) {
  const app = http.createServer(handler);
  const connections = new Map();
  app.on('connection', socket => {
    connections.set(socket, []);
    socket.on('data', bytes => connections.get(socket).push(Buffer.from(bytes)));
  });
  await new Promise((resolve, reject) => {
    app.once('error', reject);
    app.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    for (const socket of connections.keys()) socket.destroy();
    await new Promise(resolve => app.close(resolve));
  });
  return { url: `http://127.0.0.1:${app.address().port}`, connections };
}

async function login(t, mode) {
  const run = newRun(t, await project(t));
  const value = `synthetic-${mode}-jar-session-for-commands`;
  const replacement = `synthetic-${mode}-reply-cookie-not-applied`;
  const seen = [];
  const app = await server(t, async (req, res) => {
    if (req.url === '/login') {
      if (mode === 'cookie') res.setHeader('Set-Cookie', `sid=${value}; Path=/`);
      res.end(JSON.stringify(mode === 'bearer' ? { token: value } : { loggedIn: true }));
      return;
    }
    const accepted = mode === 'cookie' ? req.headers.cookie === `sid=${value}` :
      req.headers.authorization === `Bearer ${value}`;
    let bytes = 0;
    for await (const chunk of req) bytes += chunk.length;
    seen.push({ method: req.method, path: req.url, accepted, socket: req.socket, bytes });
    res.setHeader('Set-Cookie', `sid=${replacement}; Path=/`);
    res.statusCode = accepted ? 200 : 401;
    res.end(JSON.stringify(accepted ? { accepted: true, echo: value } : { error: 'Log in first' }));
  });
  const args = ['send', 'POST', `${app.url}/login`, '--jar', run.id];
  if (mode === 'bearer') args.push('--keep-field', 'token');
  const result = await command(...args);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!(result.stdout + result.stderr).includes(value), 'login value stays hidden');
  const jarFile = path.join(run.dir, 'jar.json');
  await command('make', run.id, 'normal-png');
  return { ...app, run, value, replacement, seen, jarFile, jar: await readFile(jarFile) };
}

for (const mode of ['cookie', 'bearer']) {
  test(`upload, net and load use a ${mode} jar without changing it or printing values`, async t => {
    const app = await login(t, mode);
    const upload = await command('upload', app.run.id, 'POST', `${app.url}/upload`,
      '--file', 'normal.png', '--jar', app.run.id);
    assert.equal(upload.status, 0, upload.stderr);
    assert.match(upload.stdout, /^Status: 200\n/);
    assert.ok(app.seen.some(item => item.path === '/upload' && item.accepted && item.bytes > 0));
    assert.deepEqual(await readFile(app.jarFile), app.jar, 'upload is jar-read-only');

    const load = await command('load', 'GET', `${app.url}/private`, '--requests', '2',
      '--concurrency', '1', '--jar', app.run.id);
    assert.equal(load.status, 0, load.stderr);
    assert.match(load.stdout, /status: 2xx 2  3xx 0  4xx 0/);
    assert.match(load.stdout, /after burst: app answered 200/);
    assert.deepEqual(await readFile(app.jarFile), app.jar, 'load is jar-read-only');

    const net = await command('net', app.run.id, 'leave', 'POST', `${app.url}/private`,
      '--json', '{"text":"local control"}', '--probe', `${app.url}/probe`, '--jar', app.run.id);
    assert.equal(net.status, 0, net.stderr);
    assert.match(net.stdout, /probe after: app answered 200/);
    const raw = app.seen.find(item => item.path === '/private' && item.method === 'POST');
    assert.ok(raw?.accepted, 'fixed raw request carries matching authentication');
    const wireBytes = Buffer.concat(app.connections.get(raw.socket)).length;
    const sent = /sent: (\d+) of (\d+) bytes/.exec(net.stdout);
    assert.equal(Number(sent[1]), wireBytes, 'sent byte count includes actual authentication headers');
    assert.equal(Number(sent[2]), wireBytes, 'total byte count includes actual authentication headers');
    assert.ok(app.seen.every(item => item.accepted), 'all requests including probes are authenticated');
    assert.deepEqual(await readFile(app.jarFile), app.jar, 'net and probes are jar-read-only');

    for (const result of [upload, load, net]) {
      assert.ok(!(result.stdout + result.stderr).includes(app.value), 'jar login value stays hidden');
      assert.ok(!(result.stdout + result.stderr).includes(app.replacement), 'reply cookie value stays hidden');
    }
  });
}

test('auxiliary commands never send jar credentials to a different localhost port', async t => {
  const app = await login(t, 'bearer');
  const seen = [];
  const other = await server(t, async (req, res) => {
    for await (const chunk of req) { /* drain the bounded request */ }
    seen.push({ authorization: req.headers.authorization, cookie: req.headers.cookie });
    res.statusCode = 401;
    res.end('Log in first');
  });
  for (const args of [
    ['upload', app.run.id, 'POST', `${other.url}/upload`, '--file', 'normal.png'],
    ['load', 'GET', `${other.url}/private`, '--requests', '1', '--concurrency', '1'],
    ['net', app.run.id, 'leave', 'POST', `${other.url}/private`, '--probe', `${other.url}/probe`]
  ]) {
    const result = await command(...args, '--jar', app.run.id);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!(result.stdout + result.stderr).includes(app.value));
  }
  assert.ok(seen.length >= 4);
  assert.ok(seen.every(headers => headers.authorization === undefined && headers.cookie === undefined));
  assert.deepEqual(await readFile(app.jarFile), app.jar);
});

test('auxiliary commands refuse conflicting bearer inputs or an invalid jar before any request', async t => {
  const app = await login(t, 'bearer');
  const cases = [
    ['upload', app.run.id, 'POST', `${app.url}/upload`, '--file', 'normal.png'],
    ['load', 'GET', `${app.url}/private`, '--requests', '1', '--concurrency', '1'],
    ['net', app.run.id, 'leave', 'POST', `${app.url}/private`, '--probe', `${app.url}/probe`]
  ];
  for (const args of cases) {
    for (const options of [['--jar', app.run.id, '--token', 'fixed-owner-test-key'], ['--jar', '../not-a-run']]) {
      const result = await command(...args, ...options);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /Refused:/);
      assert.ok(!result.stderr.includes(app.value));
      assert.ok(!result.stderr.includes('fixed-owner-test-key'));
    }
  }
  assert.equal(app.seen.length, 0, 'no burst, raw connection or health probe happened');
  assert.deepEqual(await readFile(app.jarFile), app.jar);
});

test('auxiliary jar option accepts one run id and refuses missing or duplicate options', () => {
  assert.equal(uploadOptions(['--file', 'normal.png', '--jar', 'run-id']).jar, 'run-id');
  assert.equal(netOptions(['--probe', 'http://localhost:1', '--jar', 'run-id']).jar, 'run-id');
  assert.equal(loadOptions(['--jar', 'run-id']).jar, 'run-id');
  for (const parse of [args => uploadOptions(['--file', 'normal.png', ...args]), netOptions, loadOptions]) {
    assert.throws(() => parse(['--jar']), /Refused:/);
    assert.throws(() => parse(['--jar', 'one', '--jar', 'two']), /Refused:/);
  }
});
