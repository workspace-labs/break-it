import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { root, cli } from './helpers.mjs';

function send(...args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'scripts/break-it.mjs'), 'send', ...args]);
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', status => resolve({ status, stdout, stderr }));
  });
}

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

test('send refuses the same non-local URLs with the check refusal message', () => {
  for (const url of ['https://example.com', 'http://192.168.1.5', 'http://127.1',
    'http://localhost.example.com', 'http://localhost@evil.example', 'http://2130706433']) {
    const checked = cli('check', root, '--url', url);
    const sent = cli('send', 'GET', url);
    assert.equal(sent.status, 1);
    assert.equal(sent.stderr, checked.stderr);
    assert.equal(sent.stderr.trim(), 'Refused: break-it only attacks a local copy, never a live site.');
  }
});

test('send makes one request with the chosen method, raw JSON and bearer token', async t => {
  const seen = [];
  const url = await server(t, async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    seen.push({ method: req.method, path: req.url, body, token: req.headers.authorization,
      type: req.headers['content-type'] });
    res.writeHead(201);
    res.end('created');
  });
  const result = await send('POST', `${url}/items?test=1`, '--token', 'synthetic-token', '--json', '{bad-json');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'Status: 201\ncreated\n');
  assert.deepEqual(seen, [{ method: 'POST', path: '/items?test=1', body: '{bad-json',
    token: 'Bearer synthetic-token', type: 'application/json' }]);
});

test('send accepts localhost without resolving an external address', async t => {
  let count = 0;
  const url = await server(t, (req, res) => { count++; res.end('local'); });
  const result = await send('GET', url.replace('127.0.0.1', 'localhost'));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'Status: 200\nlocal\n');
  assert.equal(count, 1);
});

test('send returns redirects without contacting either local or external destinations', async t => {
  let destinations = 0, requests = 0;
  const destination = await server(t, (req, res) => { destinations++; res.end('must not arrive'); });
  const url = await server(t, (req, res) => {
    requests++;
    res.writeHead(302, { Location: req.url === '/local' ? destination : 'https://example.com' });
    res.end('redirect stays here');
  });
  for (const route of ['/local', '/external']) {
    const result = await send('GET', `${url}${route}`);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'Status: 302\nredirect stays here\n');
  }
  assert.equal(requests, 2);
  assert.equal(destinations, 0);
});

test('send refuses oversized UTF-8 bodies before any request and accepts exactly 64 KiB', async t => {
  const seen = [];
  const url = await server(t, async (req, res) => {
    let bytes = 0;
    for await (const chunk of req) bytes += chunk.length;
    seen.push(bytes);
    res.end(String(bytes));
  });
  for (const body of ['a'.repeat(65537), 'é'.repeat(32769)]) {
    const result = await send('POST', url, '--json', body);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /64 KiB/);
  }
  assert.deepEqual(seen, []);
  const exact = await send('POST', url, '--json', 'é'.repeat(32768));
  assert.equal(exact.status, 0, exact.stderr);
  assert.equal(exact.stdout, 'Status: 200\n65536\n');
  assert.deepEqual(seen, [65536]);
});

test('send prints at most 2 KiB of a long response and marks it cut', async t => {
  let requests = 0;
  const url = await server(t, (req, res) => { requests++; res.end('x'.repeat(100000)); });
  const result = await send('GET', url);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `Status: 200\n${'x'.repeat(2048)}\n(cut)\n`);
  assert.equal(requests, 1);
});

test('send does not mark an exact 2 KiB response as cut', async t => {
  const url = await server(t, (req, res) => res.end('x'.repeat(2048)));
  const result = await send('GET', url);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `Status: 200\n${'x'.repeat(2048)}\n`);
});

test('send truncates a multibyte response without exceeding the output byte cap', async t => {
  const url = await server(t, (req, res) => res.end('€'.repeat(1000)));
  const result = await send('GET', url);
  assert.equal(result.status, 0, result.stderr);
  const body = result.stdout.split('\n')[1];
  assert.ok(Buffer.byteLength(body) <= 2048);
  assert.equal(body, '€'.repeat(682));
  assert.match(result.stdout, /\n\(cut\)\n$/);
});

test('send marks normalized malformed UTF-8 output cut when replacement characters exceed 2 KiB', async t => {
  const url = await server(t, (req, res) => res.end(Buffer.alloc(1000, 0xff)));
  const result = await send('GET', url);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `Status: 200\n${'\uFFFD'.repeat(682)}\n(cut)\n`);
});

test('send displays incomplete UTF-8 at end of a short response without silently dropping it', async t => {
  const url = await server(t, (req, res) => res.end(Buffer.from([0x61, 0xe2])));
  const result = await send('GET', url);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'Status: 200\na\uFFFD\n');
});

test('send has an absolute five-second deadline even while a response keeps streaming', async t => {
  let requests = 0;
  const intervals = [];
  const url = await server(t, (req, res) => {
    requests++;
    if (req.url === '/silent') return;
    res.writeHead(200);
    intervals.push(setInterval(() => res.write('x'), 150));
  });
  t.after(() => intervals.forEach(clearInterval));
  const started = Date.now();
  const results = await Promise.all(['/silent', '/stream'].map(route => send('GET', `${url}${route}`)));
  const elapsed = Date.now() - started;
  for (const result of results) {
    assert.equal(result.status, 1);
    assert.match(result.stderr, /five seconds|5 seconds/i);
  }
  assert.ok(elapsed >= 4800 && elapsed < 8000, `deadline elapsed ${elapsed} ms`);
  assert.equal(requests, 2);
});

test('send refuses malformed command options without sending a request', async t => {
  let count = 0;
  const url = await server(t, (req, res) => { count++; res.end('unexpected'); });
  for (const args of [['--json'], ['--token'], ['--unknown', 'x'], ['--json', '{}', '--json', '{}']]) {
    const result = await send('POST', url, ...args);
    assert.equal(result.status, 1);
  }
  const invalidMethod = await send('GET\r\nX-Test: injected', url);
  assert.equal(invalidMethod.status, 1);
  assert.equal(count, 0);
});
