import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { uploadRequest } from '../scripts/lib/upload.mjs';
import { makeFile } from '../scripts/lib/files.mjs';
import { cleanupRun } from '../scripts/lib/cleanup.mjs';
import { project, newRun } from './helpers.mjs';

test('an early 413 stops a streamed big upload and leaves the next control usable', async t => {
  const run = newRun(t, await project(t));
  const big = await makeFile(run.id, 'big');
  const normal = await makeFile(run.id, 'normal-png');
  const sockets = new Set();
  let earlyRequests = 0;
  let resetRequests = 0;
  const connections = [];
  const received = [];
  const app = http.createServer((req, res) => {
    if (req.url === '/reject') {
      earlyRequests++;
      const observed = { bytes: 0 };
      received.push(observed);
      req.on('data', chunk => { observed.bytes += chunk.length; });
      connections.push(req.headers.connection);
      res.writeHead(413);
      res.end('File too large');
    } else if (req.url === '/reset') {
      resetRequests++;
      req.socket.destroy();
    } else {
      req.resume();
      req.once('end', () => { res.writeHead(201); res.end('Saved'); });
    }
  });
  app.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => {
    app.once('error', reject);
    app.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => app.close(resolve));
  });
  const base = `http://127.0.0.1:${app.address().port}`;
  const start = Date.now();
  for (let index = 0; index < 3; index++) {
    const response = await uploadRequest(run.id, 'POST', base + '/reject', { file: big.name });
    assert.equal(response.status, 413);
    assert.equal(response.body, 'File too large');
  }
  const control = await uploadRequest(run.id, 'POST', base + '/control', { file: normal.name });
  assert.equal(control.status, 201);
  assert.equal(earlyRequests, 3);
  assert.ok(connections.every(value => value === 'keep-alive'), 'allow the early reply to arrive before closing our single-use socket');
  assert.ok(Date.now() - start < 5000, 'early 4xx does not wait for the big-upload deadline');
  assert.ok(received.length > 0);
  assert.ok(received.every(({ bytes }) => bytes < big.bytes), 'early rejection stops sending before the whole file');
  await assert.rejects(uploadRequest(run.id, 'POST', base + '/reset', { file: normal.name }), /EPIPE|ECONNRESET|socket hang up/);
  assert.equal(resetRequests, 1, 'a reset is reported without retry');
  // Exercise cleanup after repeated early stream destruction, while the server
  // remains alive. No file handle or pending request may delay the operation.
  await cleanupRun(run.id);
});
