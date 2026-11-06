import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { root } from './helpers.mjs';
import { runLoad, formatLoad } from '../scripts/lib/load.mjs';

async function server(t, handler) {
  const app = http.createServer(handler);
  const sockets = new Set();
  app.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    app.once('error', reject);
    app.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    if (app.listening) await new Promise(resolve => app.close(resolve));
  });
  return { app, url: `http://127.0.0.1:${app.address().port}` };
}

function loadCli(...args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'scripts/break-it.mjs'), 'load', ...args]);
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', status => resolve({ status, stdout, stderr }));
  });
}

const emptyStatuses = () => ({ '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0, other: 0, 'no status': 0 });

test('N1 healthy slow duration cancellations read differently from an app that is not listening', async t => {
  let seen = 0;
  const healthy = await server(t, (req, res) => {
    seen++;
    const timer = setTimeout(() => res.end('healthy-slow-private-response'), 1200);
    res.once('close', () => clearTimeout(timer));
  });
  const closed = await server(t, (req, res) => res.end('unreachable'));
  await new Promise(resolve => closed.app.close(resolve));
  const options = ['--requests', '3', '--concurrency', '3', '--duration', '1'];
  const slow = await loadCli('GET', healthy.url, ...options);
  const dead = await loadCli('GET', closed.url, ...options);
  assert.equal(slow.status, 0, slow.stderr);
  assert.equal(dead.status, 0, dead.stderr);
  assert.equal(slow.stderr, '');
  assert.equal(dead.stderr, '');
  assert.equal(seen, 4, 'three cancelled burst requests plus the successful slow recovery probe');
  assert.equal(slow.stdout, [
    `LOAD GET ${healthy.url}  requests: 3  completed: 0  failed: 0  cancelled at deadline: 3`,
    'status: 2xx 0  3xx 0  4xx 0  5xx 0  other 0  no status 0',
    'latency ms: min n/a  median n/a  p95 n/a  max n/a  (completed requests)',
    'after burst: app answered 200', '',
  ].join('\n'));
  assert.equal(dead.stdout, [
    `LOAD GET ${closed.url}  requests: 3  completed: 0  failed: 3  cancelled at deadline: 0`,
    'status: 2xx 0  3xx 0  4xx 0  5xx 0  other 0  no status 3',
    'latency ms: min n/a  median n/a  p95 n/a  max n/a  (completed requests)',
    'after burst: app did not answer', '',
  ].join('\n'));
  assert.notEqual(slow.stdout.split('\n').slice(0, 3).join('\n').replace(healthy.url, '<target>'),
    dead.stdout.split('\n').slice(0, 3).join('\n').replace(closed.url, '<target>'),
    'the burst summary itself distinguishes our cancellation from an app failure');
  assert.ok(!slow.stdout.includes('healthy-slow-private-response'));
});

test('N1 send five-second deadline remains a genuine failure, never a load cancellation', async t => {
  let seen = 0;
  const { url } = await server(t, (req, res) => {
    seen++;
    if (seen > 1) res.end('recovered');
  });
  const result = await runLoad('GET', url, { requests: 1, concurrency: 1, duration: 10 });
  assert.equal(result.sent, 1);
  assert.equal(result.completed, 0);
  assert.equal(result.failed, 1);
  assert.equal(result.cancelled, 0);
  assert.deepEqual(result.statuses, { ...emptyStatuses(), 'no status': 1 });
  assert.deepEqual(result.latency, { min: null, median: null, p95: null, max: null });
  assert.equal(result.afterBurst.status, 200);
  assert.equal(seen, 2);
});

test('N2 each response family has its own bucket while a destroyed socket has no status', async t => {
  const responses = [200, 301, 404, 503, 600, 601, null];
  let seen = 0;
  const { url } = await server(t, (req, res) => {
    const status = responses[seen++];
    if (status === null) return req.socket.destroy();
    res.writeHead(status ?? 204);
    res.end('private-response-body');
  });
  const result = await runLoad('GET', url, { requests: 7, concurrency: 1 });
  assert.deepEqual(result.statuses, { '2xx': 1, '3xx': 1, '4xx': 1, '5xx': 1, other: 2, 'no status': 1 });
  assert.equal(result.completed, 6);
  assert.equal(result.failed, 1);
  assert.equal(result.cancelled, 0);
  assert.equal(result.sent, 7);
  assert.equal(result.afterBurst.status, 204);
  assert.equal(seen, 8);
  const output = formatLoad(result);
  assert.equal(output.split('\n')[1], 'status: 2xx 1  3xx 1  4xx 1  5xx 1  other 2  no status 1');
  assert.ok(!output.includes('private-response-body'));
});

test('N1/N2 a mixed burst balances completed, failed and cancelled without counting cancellation as a status', async t => {
  let seen = 0;
  const { url } = await server(t, (req, res) => {
    seen++;
    if (seen === 1) return res.end('completed');
    if (seen === 2) return req.socket.destroy();
    if (seen === 3) return;
    res.writeHead(204);
    res.end();
  });
  const result = await runLoad('GET', url, { requests: 5, concurrency: 1, duration: 1 });
  assert.equal(result.sent, 3);
  assert.equal(result.completed, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.cancelled, 1);
  assert.equal(result.sent, result.completed + result.failed + result.cancelled);
  assert.deepEqual(result.statuses, { ...emptyStatuses(), '2xx': 1, 'no status': 1 });
  const completedBuckets = ['2xx', '3xx', '4xx', '5xx', 'other'];
  assert.equal(completedBuckets.reduce((sum, key) => sum + result.statuses[key], 0), result.completed);
  assert.equal(result.statuses['no status'], result.failed);
  assert.equal(Object.values(result.statuses).reduce((sum, count) => sum + count, 0), result.sent - result.cancelled);
  assert.equal(result.afterBurst.status, 204);
  assert.equal(seen, 4);
  assert.equal(result.latency.min, result.latency.max, 'latency contains the single completed response only');
});
