import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { root, cli } from './helpers.mjs';
import { runLoad, loadOptions, formatLoad } from '../scripts/lib/load.mjs';

async function server(t, handler) {
  const app = http.createServer(handler);
  const sockets = new Set();
  app.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
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

test('load CLI completes failed measurements with exit zero and no response or error bodies', async t => {
  let seen = 0;
  const url = await server(t, req => { seen++; req.socket.destroy(); });
  const result = await loadCli('GET', url, '--requests', '3', '--concurrency', '2');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(seen, 4, 'three failed burst requests and one failed recovery probe');
  assert.match(result.stdout, /requests: 3  completed: 0  failed: 3  cancelled at deadline: 0/);
  assert.match(result.stdout, /status: 2xx 0  3xx 0  4xx 0  5xx 0  other 0  no status 3/);
  assert.match(result.stdout, /latency ms: min n\/a  median n\/a  p95 n\/a  max n\/a/);
  assert.match(result.stdout, /after burst: app did not answer\n$/);
  assert.equal(result.stdout.trimEnd().split('\n').length, 4);
});

test('load defaults and valid option boundaries are accepted without enlarging ceilings', () => {
  const defaults = loadOptions([]);
  assert.equal(defaults.requests ?? 200, 200);
  assert.equal(defaults.concurrency ?? 10, 10);
  assert.equal(defaults.duration ?? 30, 30);
  for (const values of [[1, 1, 1], [2000, 50, 30]]) {
    const options = loadOptions(['--requests', String(values[0]), '--concurrency', String(values[1]),
      '--duration', String(values[2]), '--json', '{broken', '--token', 'invented-session']);
    assert.deepEqual([options.requests, options.concurrency, options.duration], values);
    assert.equal(options.json, '{broken');
    assert.equal(options.token, 'invented-session');
  }
});

for (const [option, maximum] of [['requests', 2000], ['concurrency', 50], ['duration', 30]]) {
  test(`load refuses malformed and out-of-range --${option} values`, () => {
    for (const value of [String(maximum + 1), '0', '-1', 'NaN', 'Infinity', '1.5', '1e2', '0x10', '', ' 1', '9'.repeat(1000)]) {
      assert.throws(() => loadOptions([`--${option}`, value]), /^Error: Refused:/, `${option}: ${value}`);
      const result = cli('load', 'GET', 'http://127.0.0.1:1', `--${option}`, value);
      assert.notEqual(result.status, 0, `${option}: ${value}`);
      assert.match(result.stderr, /^Refused:/);
      assert.equal(result.stdout, '');
    }
  });
}

test('load refuses missing, unknown and duplicate options', () => {
  for (const args of [['--requests'], ['--json'], ['--token'], ['--unknown', '1'],
    ['--duration', '1', '--duration', '2'], ['--json', '{}', '--json', '{}']]) {
    assert.throws(() => loadOptions(args), /^Error: Refused:/);
  }
});

test('load reuses send non-localhost refusal exactly, including disguised authorities', async () => {
  for (const url of ['http://example.com', 'https://example.com', 'http://127.0.0.1@evil.com',
    'http://localhost.evil.com', 'http://127.1', 'http://2130706433', 'http://192.168.0.5']) {
    const sent = cli('send', 'GET', url);
    const loaded = cli('load', 'GET', url);
    assert.equal(loaded.status, 1);
    assert.equal(loaded.stderr, sent.stderr);
    assert.equal(loaded.stdout, '');
    await assert.rejects(runLoad('GET', url), /Refused: break-it only attacks a local copy, never a live site\./);
  }
});

test('load validates method, body and header before sending even the health probe', async t => {
  let seen = 0;
  const url = await server(t, (req, res) => { seen++; res.end('unexpected'); });
  for (const [method, options] of [['GET\r\nX-Bad: injected', {}],
    ['POST', { json: 'é'.repeat(32769) }], ['GET', { token: 'invented\r\nX-Bad: header' }]]) {
    await assert.rejects(runLoad(method, url, { requests: 2, ...options }), /Refused:/);
    const args = Object.entries(options).flatMap(([name, value]) => [`--${name}`, value]);
    const result = await loadCli(method, url, '--requests', '2', ...args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^Refused:/);
    assert.equal(result.stdout, '');
  }
  assert.equal(seen, 0);
});

test('load stops at exactly N burst requests, caps concurrency and probes once afterward', async t => {
  let seen = 0, active = 0, maximum = 0;
  const bodies = [];
  const url = await server(t, async (req, res) => {
    seen++;
    active++;
    maximum = Math.max(maximum, active);
    let body = '';
    for await (const chunk of req) body += chunk;
    bodies.push({ body, method: req.method, token: req.headers.authorization });
    setImmediate(() => { active--; res.writeHead(201); res.end('saved'); });
  });
  const result = await runLoad('POST', `${url}/items`, { requests: 11, concurrency: 3,
    json: '{malformed', token: 'invented-bearer' });
  assert.equal(result.sent, 11);
  assert.equal(result.completed, 11);
  assert.equal(result.failed, 0);
  assert.deepEqual(result.statuses, { '2xx': 11, '3xx': 0, '4xx': 0, '5xx': 0, other: 0, 'no status': 0 });
  assert.equal(result.afterBurst.status, 201);
  assert.equal(seen, 12, 'N burst calls plus one uncounted health probe');
  assert.ok(maximum <= 3, `at most C in flight, observed ${maximum}`);
  assert.equal(bodies.length, 12);
  for (const body of bodies) assert.deepEqual(body, { body: '{malformed', method: 'POST', token: 'Bearer invented-bearer' });
  assert.ok(result.latency.min >= 0);
  assert.ok(result.latency.min <= result.latency.median);
  assert.ok(result.latency.median <= result.latency.p95);
  assert.ok(result.latency.p95 <= result.latency.max);
});

test('load CLI prints only a bounded four-line summary, never response bodies', async t => {
  const body = 'known-private-body-123456789';
  const secret = `ghp_${'Q'.repeat(36)}`;
  const url = await server(t, (req, res) => res.end(`${body} password=${secret} ${'x'.repeat(100000)}`));
  const result = await loadCli('GET', url, '--requests', '7', '--concurrency', '2');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.doesNotMatch(result.stdout, new RegExp(body));
  assert.ok(!result.stdout.includes(secret));
  assert.ok(!result.stdout.includes('x'.repeat(100)));
  assert.ok(Buffer.byteLength(result.stdout) < 1024);
  assert.equal(result.stdout.trimEnd().split('\n').length, 4);
  assert.match(result.stdout, /^LOAD GET .*requests: 7\s+completed: 7\s+failed: 0\s+cancelled at deadline: 0\n/);
  assert.match(result.stdout, /status: 2xx 7\s+3xx 0\s+4xx 0\s+5xx 0\s+other 0\s+no status 0/);
  assert.match(result.stdout, /latency ms: min [\d.]+\s+median [\d.]+\s+p95 [\d.]+\s+max [\d.]+\s+\(completed requests\)/);
  assert.match(result.stdout, /after burst: app answered 200\n$/);
});

test('load records status families and transport failures separately from completed latencies', async t => {
  let seen = 0;
  const statuses = [200, 404, 503, 302, null];
  const url = await server(t, (req, res) => {
    const status = statuses[seen++];
    if (status === null) return req.socket.destroy();
    res.writeHead(status ?? 204);
    res.end();
  });
  const result = await runLoad('GET', url, { requests: 5, concurrency: 1 });
  assert.equal(result.sent, 5);
  assert.equal(result.completed, 4);
  assert.equal(result.failed, 1);
  assert.deepEqual(result.statuses, { '2xx': 1, '3xx': 1, '4xx': 1, '5xx': 1, other: 0, 'no status': 1 });
  assert.equal(result.afterBurst.status, 204);
});

test('load records concurrent re-entry errors absent from a single request', async t => {
  let busy = false, burst = false, burstSeen = 0, pending;
  const url = await server(t, (req, res) => {
    if (!burst) return res.end('ok');
    burstSeen++;
    try {
      if (busy) throw new Error('shared-resource-reentry');
      busy = true;
      pending = res;
    } catch {
      res.writeHead(503);
      res.end('private-internal-error');
      pending.end('ok');
      busy = false;
      if (burstSeen === 12) burst = false;
    }
  });
  const single = await runLoad('GET', url, { requests: 1, concurrency: 1 });
  assert.equal(single.statuses['5xx'], 0);
  burst = true;
  const concurrent = await runLoad('GET', url, { requests: 12, concurrency: 4 });
  assert.ok(concurrent.statuses['5xx'] > 0);
  assert.equal(concurrent.afterBurst.status, 200);
  assert.ok(!formatLoad(concurrent).includes('private-internal-error'));
});

test('load never follows localhost or external redirects', async t => {
  let destinations = 0;
  const target = await server(t, (req, res) => { destinations++; res.end('must not arrive'); });
  const url = await server(t, (req, res) => {
    res.writeHead(302, { Location: req.url === '/local' ? target : 'http://example.com' });
    res.end('redirect');
  });
  for (const route of ['/local', '/external']) {
    const result = await runLoad('GET', url + route, { requests: 3, concurrency: 2 });
    assert.equal(result.statuses['3xx'], 3);
    assert.equal(result.statuses['no status'], 0);
    assert.equal(result.afterBurst.status, 302);
  }
  assert.equal(destinations, 0);
});

test('load duration one aborts in-flight burst requests promptly and then probes', async t => {
  let seen = 0;
  const url = await server(t, (req, res) => {
    seen++;
    if (seen > 2) res.end('probe answered');
  });
  const start = performance.now();
  const result = await runLoad('GET', url, { requests: 2000, concurrency: 2, duration: 1 });
  const elapsed = performance.now() - start;
  assert.equal(result.sent, 2);
  assert.equal(result.completed, 0);
  assert.equal(result.failed, 0);
  assert.equal(result.cancelled, 2);
  assert.equal(result.afterBurst.status, 200);
  assert.equal(seen, 3);
  assert.ok(elapsed >= 900 && elapsed < 3000, `one-second burst elapsed ${elapsed} ms`);
});

test('load preserves send five-second per-request deadline and still completes measurement', async t => {
  let seen = 0;
  const url = await server(t, (req, res) => {
    seen++;
    if (seen > 1) res.end('probe');
  });
  const start = performance.now();
  const result = await runLoad('GET', url, { requests: 1, concurrency: 1, duration: 10 });
  const elapsed = performance.now() - start;
  assert.equal(result.failed, 1);
  assert.equal(result.sent, 1);
  assert.equal(result.cancelled, 0);
  assert.equal(result.afterBurst.status, 200);
  assert.ok(elapsed >= 4800 && elapsed < 8000, `send deadline elapsed ${elapsed} ms`);
});

test('load has an implicit thirty-second hard stop without --duration', { timeout: 40000 }, async t => {
  const arrivals = [];
  const start = performance.now();
  const url = await server(t, (req, res) => {
    const elapsed = performance.now() - start;
    arrivals.push(elapsed);
    if (elapsed >= 29500) res.end('health probe');
  });
  const result = await runLoad('GET', url, { requests: 2000, concurrency: 2 });
  const elapsed = performance.now() - start;
  assert.ok(elapsed >= 29000 && elapsed < 33500, `hard stop elapsed ${elapsed} ms`);
  assert.ok(result.sent < 2000);
  assert.equal(result.completed + result.failed + result.cancelled, result.sent);
  assert.equal(arrivals.length, result.sent + 1);
  assert.ok(arrivals.slice(0, -1).every(time => time < 30250), 'no burst work after the hard stop');
  assert.equal(result.afterBurst.status, 200);
});
