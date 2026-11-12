import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { writeFile, symlink, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { project, newRun, root } from './helpers.mjs';
import { uploadRequest, uploadOptions } from '../scripts/lib/upload.mjs';
import { makeFile } from '../scripts/lib/files.mjs';
import { sendFileRequest } from '../scripts/lib/send.mjs';
import { Readable } from 'node:stream';

async function server(t, handler) {
  const app = http.createServer(handler);
  const sockets = new Set();
  app.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => app.close(resolve));
  });
  return `http://127.0.0.1:${app.address().port}`;
}
async function run(t) { return newRun(t, await project(t)); }
function cli(...args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'scripts/break-it.mjs'), ...args]);
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', status => resolve({ status, stdout, stderr }));
  });
}

test('upload refuses paths, missing/generated impostor files, methods and options before sending', async t => {
  const r = await run(t);
  let count = 0;
  const url = await server(t, (req, res) => { count++; res.end('unexpected'); });
  await makeFile(r.id, 'normal-png');
  for (const file of ['../normal.png', '/etc/hosts', 'a/b', 'a\\b', '..', 'a..png', 'missing.png']) {
    await assert.rejects(uploadRequest(r.id, 'POST', url, { file }));
  }
  await writeFile(path.join(r.dir, 'files', 'foreign.png'), 'private data');
  await assert.rejects(uploadRequest(r.id, 'POST', url, { file: 'foreign.png' }));
  for (const method of ['GET', 'DELETE', 'POST\r\nX: bad']) {
    await assert.rejects(uploadRequest(r.id, method, url, { file: 'normal.png' }));
  }
  for (const options of [{ name: 'free-text.png' }, { field: 'x\r\nEvil: yes' },
    { field: 'bad"field' }, { type: 'image/png\r\nEvil: yes' }, { token: 'x\nInjected: yes' }]) {
    await assert.rejects(uploadRequest(r.id, 'POST', url, { file: 'normal.png', ...options }));
  }
  for (const url of ['https://example.com', 'http://192.168.1.1', 'http://127.1']) {
    await assert.rejects(uploadRequest(r.id, 'POST', url, { file: 'normal.png' }), /only attacks a local copy/);
  }
  for (const args of [[], ['--file'], ['--file', 'normal.png', '--file', 'normal.png'],
    ['--name', 'traversal'], ['--unknown', 'yes']]) assert.throws(() => uploadOptions(args));
  assert.equal(count, 0);
});

test('upload refuses a files directory or generated file redirected outside the run', async t => {
  const r = await run(t);
  const source = await project(t);
  await mkdir(path.join(r.dir, 'files'));
  await symlink(path.join(source, 'hello.txt'), path.join(r.dir, 'files', 'normal.png'));
  await assert.rejects(uploadRequest(r.id, 'POST', 'http://localhost:1', { file: 'normal.png' }), /link|regular|generated/i);
  const r2 = await run(t);
  await symlink(source, path.join(r2.dir, 'files'));
  await assert.rejects(uploadRequest(r2.id, 'POST', 'http://localhost:1', { file: 'hello.txt' }));
});

test('upload sends exact single multipart part with raw preset names, type, field and bytes', async t => {
  const r = await run(t);
  const made = await makeFile(r.id, 'fake-image');
  const { readFile } = await import('node:fs/promises');
  const payload = await readFile(path.join(r.dir, 'files', made.name));
  let expectedName, method, field, type;
  let requests = 0;
  const url = await server(t, async (req, res) => {
    requests++;
    assert.equal(req.method, method);
    assert.equal(req.headers.authorization, 'Bearer synthetic-upload-token');
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const boundary = req.headers['content-type'].match(/boundary=(.+)$/)[1];
    const expected = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${expectedName}"\r\nContent-Type: ${type}\r\n\r\n`), payload, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    assert.deepEqual(body, expected);
    assert.equal(Number(req.headers['content-length']), body.length);
    res.writeHead(201); res.end('saved');
  });
  const names = { traversal: `../break-it-escape-${r.id}.txt`, 'null-byte': 'photo.png\u0000.html',
    long: 'a'.repeat(300) + '.png', arabic: 'صورة.png', emoji: '📷.png', reserved: 'CON.png' };
  for (const [name, sent] of Object.entries({ default: made.name, ...names })) {
    expectedName = sent; method = name === 'default' ? 'PUT' : 'POST';
    field = name === 'arabic' ? 'صور[]' : 'picture[]';
    type = name === 'default' ? 'image/jpeg; charset=utf-8' : 'image/jpeg';
    const response = await uploadRequest(r.id, method, url, {
      file: made.name, field, type, token: 'synthetic-upload-token',
      ...(name === 'default' ? {} : { name })
    });
    assert.equal(response.status, 201);
    assert.equal(response.body, 'saved');
    assert.deepEqual(response.uploaded, { bytes: payload.length, sentBytes: payload.length,
      name: sent, type, deadline: 5000 });
  }
  assert.equal(requests, 7);
});

test('upload returns redirect without following, uses literal localhost, and bounds its reply', async t => {
  const r = await run(t);
  const made = await makeFile(r.id, 'normal-png');
  let destinationCount = 0, requests = 0;
  const destination = await server(t, (req, res) => { destinationCount++; res.end('bad'); });
  const url = await server(t, (req, res) => {
    requests++; req.resume();
    res.writeHead(302, { Location: destination }); res.end('x'.repeat(100000));
  });
  const result = await uploadRequest(r.id, 'POST', url.replace('127.0.0.1', 'localhost'), { file: made.name });
  assert.equal(result.status, 302);
  assert.equal(result.body, 'x'.repeat(2048)); assert.equal(result.cut, true);
  assert.equal(requests, 1); assert.equal(destinationCount, 0);
});

test('upload deadline stays absolute at 5 seconds, with 30 seconds granted only to big', async t => {
  const r = await run(t);
  const normal = await makeFile(r.id, 'empty');
  const big = await makeFile(r.id, 'big', { mb: 1 });
  let requests = 0;
  const url = await server(t, (req, res) => {
    requests++; req.resume();
    // A big request must remain alive beyond the ordinary deadline.
    if (req.url === '/big') setTimeout(() => res.end('done'), 5300).unref();
  });
  const start = Date.now();
  const results = await Promise.allSettled([
    uploadRequest(r.id, 'POST', url + '/normal', { file: normal.name }),
    uploadRequest(r.id, 'POST', url + '/big', { file: big.name })
  ]);
  assert.equal(results[0].status, 'rejected'); assert.match(results[0].reason.message, /five seconds/);
  assert.equal(results[1].status, 'fulfilled'); assert.equal(results[1].value.uploaded.deadline, 30000);
  assert.ok(Date.now() - start >= 5000 && Date.now() - start < 8500);
  assert.equal(requests, 2);
});

test('upload CLI retains masked bounded send display and escapes the null-byte label', async t => {
  const r = await run(t);
  const made = await makeFile(r.id, 'normal-png');
  const url = await server(t, (req, res) => { req.resume(); res.end('{"password":"tinyPass"}'); });
  const response = await cli('upload', r.id, 'POST', url, '--file', made.name, '--name', 'null-byte');
  assert.equal(response.status, 0, response.stderr);
  assert.match(response.stdout, /^Status: 200\n/);
  assert.ok(!response.stdout.includes('tinyPass')); assert.ok(!response.stdout.includes('\u0000'));
  assert.ok(response.stdout.includes(`uploaded ${made.bytes} bytes as "photo.png\\u0000.html" (image/png)`));
});

test('upload accepts the 50 MiB file and stops immediately on an early size refusal', async t => {
  const r = await run(t);
  const big = await makeFile(r.id, 'big', { mb: 50 });
  let acceptedBytes = 0, refusedBytes = 0;
  const url = await server(t, async (req, res) => {
    if (req.url === '/refuse') {
      req.on('data', chunk => { refusedBytes += chunk.length; });
      res.writeHead(413); res.end('File too large'); return;
    }
    for await (const chunk of req) acceptedBytes += chunk.length;
    res.end('accepted');
  });
  const accepted = await uploadRequest(r.id, 'POST', url, { file: big.name });
  assert.equal(accepted.status, 200);
  assert.ok(acceptedBytes > 50 * 1024 * 1024 && acceptedBytes < 51 * 1024 * 1024);
  const refused = await uploadRequest(r.id, 'POST', url + '/refuse', { file: big.name });
  assert.equal(refused.status, 413);
  assert.ok(refusedBytes < big.bytes);
});

test('upload stops its body at early response headers while the refusal reply is still streaming', async t => {
  const r = await run(t);
  const big = await makeFile(r.id, 'big');
  let received = 0;
  const url = await server(t, (req, res) => {
    req.on('data', chunk => { received += chunk.length; });
    res.writeHead(413);
    res.write('File ');
    setTimeout(() => res.end('too large'), 300).unref();
  });
  const response = await uploadRequest(r.id, 'POST', url, { file: big.name });
  assert.equal(response.status, 413);
  assert.equal(response.body, 'File too large');
  assert.ok(received < big.bytes, `stopped before whole file: ${received} / ${big.bytes}`);
});

test('upload CLI reports only file bytes streamed before an early reply, retaining full-upload wording', async t => {
  const r = await run(t);
  const big = await makeFile(r.id, 'big');
  let fullBodyBytes = 0;
  const url = await server(t, async (req, res) => {
    if (req.url === '/refuse') {
      req.resume();
      res.writeHead(413); res.end('File too large'); return;
    }
    for await (const chunk of req) fullBodyBytes += chunk.length;
    res.writeHead(201); res.end('saved');
  });
  const early = await cli('upload', r.id, 'POST', url + '/refuse', '--file', big.name);
  assert.equal(early.status, 0, early.stderr);
  assert.match(early.stdout, /^Status: 413\n/);
  const sent = early.stdout.match(/sent (\d+) of 20971520 bytes \(stopped at the app's reply\) as "big.bin" \(application\/octet-stream\)/);
  assert.ok(sent, early.stdout);
  assert.ok(Number(sent[1]) >= 0 && Number(sent[1]) < big.bytes);
  assert.ok(!early.stdout.includes('uploaded 20971520 bytes'));
  const full = await cli('upload', r.id, 'POST', url + '/full', '--file', big.name);
  assert.equal(full.status, 0, full.stderr);
  assert.ok(full.stdout.includes('uploaded 20971520 bytes as "big.bin" (application/octet-stream)'));
  assert.ok(!full.stdout.includes('stopped at'));
  assert.ok(fullBodyBytes > big.bytes, 'multipart framing is sent but excluded from the file count');
});

test('upload metadata excludes multipart framing and tracks early replies without read-ahead bytes', async t => {
  const r = await run(t);
  const big = await makeFile(r.id, 'big');
  const empty = await makeFile(r.id, 'empty');
  const url = await server(t, (req, res) => {
    req.resume();
    if (req.url === '/refuse') { res.writeHead(413); res.end('too large'); }
    else req.once('end', () => res.end('saved'));
  });
  const early = await uploadRequest(r.id, 'POST', url + '/refuse', { file: big.name });
  assert.ok(Number.isSafeInteger(early.uploaded.sentBytes));
  assert.ok(early.uploaded.sentBytes >= 0 && early.uploaded.sentBytes < big.bytes);
  const full = await uploadRequest(r.id, 'POST', url + '/full', { file: big.name });
  assert.equal(full.uploaded.sentBytes, big.bytes);
  const zero = await uploadRequest(r.id, 'POST', url + '/empty', { file: empty.name });
  assert.equal(zero.uploaded.sentBytes, 0);
});

test('shared upload transport independently enforces the 51 MiB body ceiling and actual stream length', async t => {
  let count = 0;
  const url = await server(t, (req, res) => { count++; req.resume(); });
  assert.throws(() => sendFileRequest('POST', url, { source: Readable.from([]),
    length: 51 * 1024 * 1024 + 1, boundary: 'bounded' }), /51 MiB/);
  assert.equal(count, 0);
  for (const [length, actual] of [[1, 'too many bytes'], [10, 'short']]) {
    await assert.rejects(sendFileRequest('POST', url, { source: Readable.from([Buffer.from(actual)]),
      length, boundary: 'bounded' }), /bounded body length/);
  }
  await assert.rejects(sendFileRequest('POST', url, { source: Readable.from(['é']),
    length: 1, boundary: 'bounded' }), /bounded body length/);
});

test('big uploads also stop at their absolute thirty-second ceiling without retries', async t => {
  const r = await run(t);
  const made = await makeFile(r.id, 'big', { mb: 1 });
  let count = 0;
  const url = await server(t, (req, res) => { count++; req.resume(); });
  const start = Date.now();
  await assert.rejects(uploadRequest(r.id, 'POST', url, { file: made.name }), /thirty seconds/);
  assert.ok(Date.now() - start >= 29500 && Date.now() - start < 34000);
  assert.equal(count, 1);
});

test('send GET can show only the relevant bounded file-serving headers on request', async t => {
  const url = await server(t, (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Disposition': 'inline',
      'Content-Security-Policy': "sandbox", 'X-Private': 'never-display' }); res.end('marker');
  });
  const plain = await cli('send', 'GET', url);
  assert.equal(plain.stdout, 'Status: 200\nmarker\n');
  const headers = await cli('send', 'GET', url, '--headers');
  assert.equal(headers.status, 0, headers.stderr);
  assert.match(headers.stdout, /Content-Type: text\/html/);
  assert.match(headers.stdout, /Content-Disposition: inline/);
  assert.match(headers.stdout, /Content-Security-Policy: sandbox/);
  assert.ok(!headers.stdout.includes('never-display'));
});

test('send explicitly marks cut header evidence and caps the optional header block at 2 KiB', async t => {
  const url = await server(t, (req, res) => {
    res.writeHead(200, { 'Content-Security-Policy': "default-src 'none'; " + 'a'.repeat(9000) });
    res.end('marker');
  });
  const result = await cli('send', 'GET', url, '--headers');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\(headers cut; incomplete evidence\)/);
  const headerBlock = result.stdout.split('marker\n')[1].split('\n(headers cut;')[0];
  assert.ok(Buffer.byteLength(headerBlock) <= 2048);
});
