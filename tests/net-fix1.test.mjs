import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { root } from './helpers.mjs';
import { copyProject } from '../scripts/lib/copy.mjs';
import { cleanupRun } from '../scripts/lib/cleanup.mjs';

async function run(t) {
  const source = await mkdtemp(path.join(tmpdir(), 'break-it-net-fix1-'));
  await writeFile(path.join(source, 'control.txt'), 'original');
  const id = await copyProject(source);
  t.after(async () => {
    try { await cleanupRun(id); await cleanupRun(id); }
    finally { await rm(source, { recursive: true, force: true }); }
  });
  return id;
}

function cli(...args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'scripts/break-it.mjs'), 'net', ...args]);
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('fix-round net CLI exceeded 15 seconds')); }, 15000);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', status => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
  });
}

async function listen(t, app) {
  const sockets = new Set();
  app.on('connection', socket => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    app.once('error', reject);
    app.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => app.close(resolve));
  });
  return `http://127.0.0.1:${app.address().port}`;
}

function stoppedProbe(result) {
  assert.equal(result.status, 0, result.stderr);
  const time = /^probe during: stopped when the try ended after ([\d.]+) s \(not evidence\)$/m.exec(result.stdout);
  assert.ok(time, result.stdout);
  assert.ok(Number(time[1]) > 0, 'stopped duration is measured');
  assert.doesNotMatch(result.stdout, /^probe during: app did not answer$/m);
}

test('F1 healthy two-second health page is stopped, never failed, at a one-second slow limit', async t => {
  const id = await run(t);
  const timers = new Set();
  t.after(() => { for (const timer of timers) clearTimeout(timer); });
  let healthRequests = 0;
  const app = http.createServer({ headersTimeout: 0, requestTimeout: 0 }, (req, res) => {
    assert.equal(req.method, 'GET');
    assert.equal(req.url, '/health');
    healthRequests++;
    const timer = setTimeout(() => { timers.delete(timer); res.end('healthy'); }, 2000);
    timers.add(timer);
  });
  const base = await listen(t, app);
  const result = await cli(id, 'slow', 'POST', `${base}/items`, '--probe', `${base}/health`, '--seconds', '1');
  stoppedProbe(result);
  assert.match(result.stdout, /^app: still open at our limit/m);
  assert.match(result.stdout, /^probe after: app answered 200$/m);
  assert.equal(healthRequests, 2);
});

test('F1 app header timeout does not turn a healthy 600 ms probe into an outage', async t => {
  const id = await run(t);
  const timers = new Set();
  t.after(() => { for (const timer of timers) clearTimeout(timer); });
  const app = http.createServer({ headersTimeout: 300, requestTimeout: 1000,
    connectionsCheckingInterval: 25 }, (req, res) => {
    assert.equal(req.url, '/health');
    const timer = setTimeout(() => { timers.delete(timer); res.end('healthy'); }, 600);
    timers.add(timer);
  });
  const base = await listen(t, app);
  const result = await cli(id, 'slow', 'POST', `${base}/items`, '--probe', `${base}/health`, '--seconds', '2');
  stoppedProbe(result);
  assert.match(result.stdout, /^app: answered 408 after/m);
  assert.match(result.stdout, /^probe after: app answered 200$/m);
});

test('F1 a genuinely blocked health page times out while the bad connection is still held', async t => {
  const id = await run(t);
  let locked = false, blockedHealth = 0, healthyHealth = 0;
  const app = http.createServer({ headersTimeout: 0, requestTimeout: 0 }, (req, res) => {
    assert.equal(req.url, '/health');
    if (locked) { blockedHealth++; return; }
    healthyHealth++;
    res.end('recovered');
  });
  app.on('connection', socket => {
    socket.once('data', bytes => {
      if (bytes[0] !== 0x50) return;
      locked = true;
      socket.once('close', () => { locked = false; });
    });
  });
  const base = await listen(t, app);
  const result = await cli(id, 'slow', 'POST', `${base}/items`, '--probe', `${base}/health`, '--seconds', '6');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^app: still open at our limit/m);
  assert.match(result.stdout, /^probe during: app did not answer$/m);
  assert.doesNotMatch(result.stdout, /^probe during: stopped/m);
  assert.match(result.stdout, /^probe after: app answered 200$/m);
  assert.equal(blockedHealth, 1);
  assert.equal(healthyHealth, 1);
});

test('F1 a reset during-probe stays a genuine failure even when the try later ends', async t => {
  const id = await run(t);
  let healthRequests = 0;
  const app = http.createServer({ headersTimeout: 0, requestTimeout: 0 }, (req, res) => {
    healthRequests++;
    if (healthRequests === 1) { req.socket.resetAndDestroy(); return; }
    res.end('healthy');
  });
  const base = await listen(t, app);
  const result = await cli(id, 'slow', 'POST', `${base}/items`, '--probe', `${base}/health`, '--seconds', '1');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^probe during: app did not answer$/m);
  assert.doesNotMatch(result.stdout, /^probe during: stopped/m);
  assert.match(result.stdout, /^probe after: app answered 200$/m);
});

test('F3 leave does not attribute our departure to an app that replies 302 and never closes', async t => {
  const id = await run(t);
  const body = '{"text":"saved once"}';
  let mainBody, mainFin = false, mainReplied = false;
  const app = net.createServer({ allowHalfOpen: true }, socket => {
    let bytes = Buffer.alloc(0), handled = false;
    socket.on('end', () => {
      if (mainBody !== undefined && bytes.toString().startsWith('POST ')) mainFin = true;
    });
    socket.on('data', chunk => {
      bytes = Buffer.concat([bytes, chunk]);
      if (handled || !bytes.includes('\r\n\r\n')) return;
      if (bytes.toString().startsWith('GET /health ')) {
        handled = true;
        socket.end('HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok');
        return;
      }
      const at = bytes.indexOf('\r\n\r\n') + 4;
      if (bytes.length - at < Buffer.byteLength(body)) return;
      mainBody = bytes.subarray(at).toString();
      handled = true;
      mainReplied = true;
      // Deliberately keep our write side open after replying and after client FIN.
      socket.write('HTTP/1.1 302 Found\r\nLocation: /elsewhere\r\nContent-Length: 2\r\n\r\nok');
    });
  });
  const base = await listen(t, app);
  const result = await cli(id, 'leave', 'POST', `${base}/items`, '--probe', `${base}/health`, '--json', body);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^app: not observed \(we left first\)$/m);
  assert.match(result.stdout, /we closed: yes/);
  assert.match(result.stdout, /^probe during: n\/a$/m);
  assert.match(result.stdout, /^probe after: app answered 200$/m);
  assert.doesNotMatch(result.stdout, /^Status:/m);
  assert.equal(mainBody, body);
  assert.equal(mainReplied, true);
  assert.equal(mainFin, true);
});
