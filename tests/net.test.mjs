import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { symlink, readdir, readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { root } from './helpers.mjs';
import { copyProject } from '../scripts/lib/copy.mjs';
import { cleanupRun } from '../scripts/lib/cleanup.mjs';
import { runPath } from '../scripts/lib/runs.mjs';
import { makeFile } from '../scripts/lib/files.mjs';

async function run(t) {
  const source = await mkdtemp(path.join(tmpdir(), 'break-it-net-source-'));
  await writeFile(path.join(source, 'hello.txt'), 'original');
  const id = await copyProject(source);
  t.after(async () => {
    try { await cleanupRun(id); await cleanupRun(id); }
    finally { await rm(source, { recursive: true, force: true }); }
  });
  return { id, dir: await runPath(id) };
}

function cli(...args) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const child = spawn(process.execPath, [path.join(root, 'scripts/break-it.mjs'), ...args], {
      env: { ...process.env, HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1',
        ALL_PROXY: 'http://127.0.0.1:1' },
    });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('net CLI exceeded 39 seconds')); }, 39000);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', status => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr, elapsed: Date.now() - start });
    });
  });
}

function pause(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function capture(t, onMain = () => {}, { probeStatus = 200, holdProbe = false } = {}) {
  const records = [];
  const sockets = new Set();
  const app = net.createServer({ allowHalfOpen: true }, socket => {
    sockets.add(socket);
    const record = { socket, bytes: Buffer.alloc(0), chunks: [], closed: false, fin: false, probe: false };
    records.push(record);
    socket.on('error', () => {});
    socket.on('close', () => { record.closed = true; sockets.delete(socket); });
    socket.on('end', () => { record.fin = true; socket.end(); });
    socket.on('data', chunk => {
      record.bytes = Buffer.concat([record.bytes, chunk]);
      record.chunks.push({ bytes: chunk.length, at: Date.now() });
      if (/^GET \/health(?:\?| )/.test(record.bytes.toString())) {
        if (record.probe) return;
        record.probe = true;
        record.whileHeld = records.some(r => r !== record && !r.probe && !r.closed && !r.fin);
        if (!holdProbe) socket.end(`HTTP/1.1 ${probeStatus} Health\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok`);
      } else onMain(record, records);
    });
  });
  await new Promise((resolve, reject) => {
    app.once('error', reject);
    app.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => app.close(resolve));
  });
  return { base: `http://127.0.0.1:${app.address().port}`, records, sockets };
}

function mainRecord(server) {
  // An early app answer may cancel the during probe between connect and write.
  // Such an empty socket is not another bad request on the wire.
  const records = server.records.filter(r => !r.probe && r.bytes.length > 0);
  assert.equal(records.length, 1, 'exactly one bad connection');
  return records[0];
}

function parts(record) {
  const at = record.bytes.indexOf('\r\n\r\n');
  assert.ok(at >= 0, 'complete request headers arrived');
  return { headers: record.bytes.subarray(0, at).toString(), body: record.bytes.subarray(at + 4) };
}

function measured(result, kind) {
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`^NET ${kind} POST http://127\\.0\\.0\\.1:`));
  assert.match(result.stdout, /^sent: \d+ of \d+ bytes over [\d.]+ s   we closed: (?:yes|no)$/m);
  assert.match(result.stdout, /^app: /m);
  assert.match(result.stdout, /^probe during: /m);
  assert.match(result.stdout, /^probe after: /m);
}

test('net refuses every out-of-bounds option before opening any connection', async t => {
  const r = await run(t);
  const server = await capture(t);
  const url = `${server.base}/items`;
  const probe = `${server.base}/health`;
  const ordinary = ['--probe', probe];
  const cases = [
    ['cut', 'POST', 'https://example.com', ...ordinary],
    ['cut', 'POST', 'http://127.0.0.1@evil.com', ...ordinary],
    ['cut', 'POST', 'http://127.1', ...ordinary],
    ['cut', 'POST', url.replace('http:', 'https:'), ...ordinary],
    ['cut', 'POST', url, '--probe', 'http://127.0.0.1:1/health'],
    ['cut', 'POST', url, '--probe', probe.replace('127.0.0.1', 'localhost')],
    ['cut', 'POST', url, '--probe', probe.replace('http:', 'https:')],
    ['cut', 'POST', url, '--probe', 'POST /health'],
    ['cut', 'POST', url],
    ['unknown', 'POST', url, ...ordinary],
    ['cut', 'POST\r\nX: bad', url, ...ordinary],
    ...['0', '31', '-1', '1.5', '1e1', 'NaN'].map(n => ['slow', 'POST', url, ...ordinary, '--seconds', n]),
    ['cut', 'POST', url, ...ordinary, '--seconds', '1'],
    ['leave', 'POST', url, ...ordinary, '--seconds', '1'],
    ['garbage', 'POST', url, ...ordinary, '--seconds', '1'],
    ['short', 'POST', url, ...ordinary],
    ...['', '1234567890'].map(body => ['short', 'POST', url, ...ordinary, '--json', body]),
    ['cut', 'POST', url, ...ordinary, '--json', 'a'.repeat(65537)],
    ['cut', 'POST', url, ...ordinary, '--json', 'é'.repeat(32769)],
    ['cut', 'POST', url, ...ordinary, '--token', 'bad\r\nX: injected'],
    ['cut', 'POST', url, ...ordinary, '--probe-method', 'POST'],
    ['cut', 'POST', url, ...ordinary, '--raw', 'anything'],
    ['cut', 'POST', url, ...ordinary, '--repeat', '2'],
    ['cut', 'POST', url, ...ordinary, '--concurrency', '2'],
    ['cut', 'POST', url, ...ordinary, '--probe', probe],
    ['cut', 'POST', url, ...ordinary, '--json', '{}', '--file', 'normal.png'],
    ...['slow', 'leave', 'short', 'garbage', 'bad-header', 'huge-header', 'two-lengths'].map(kind =>
      [kind, 'POST', url, ...ordinary, '--file', 'normal.png']),
    ...['garbage', 'bad-header', 'huge-header', 'two-lengths'].map(kind =>
      [kind, 'POST', url, ...ordinary, '--json', '{}']),
    ...['../normal.png', 'x/normal.png', 'x\\normal.png', '..', 'missing.png'].map(name =>
      ['cut', 'POST', url, ...ordinary, '--file', name]),
  ];
  for (const args of cases) {
    const result = await cli('net', r.id, ...args);
    assert.notEqual(result.status, 0, args.join(' '));
    assert.match(result.stderr, /Refused:/);
    if (args[2].startsWith('https://127')) assert.match(result.stderr, /net supports http:\/\/localhost only/);
  }
  for (const id of ['../run', 'not-an-id', '00000000-0000-0000-0000-000000000000']) {
    const result = await cli('net', id, 'cut', 'POST', url, ...ordinary);
    assert.notEqual(result.status, 0);
  }
  assert.equal(server.records.length, 0);
});

test('net cut refuses a symlink made file without following it', async t => {
  const r = await run(t);
  const made = await makeFile(r.id, 'empty');
  await symlink(path.join(r.dir, 'files', made.name), path.join(r.dir, 'files', 'normal.png'));
  const server = await capture(t);
  const result = await cli('net', r.id, 'cut', 'POST', `${server.base}/items`,
    '--probe', `${server.base}/health`, '--file', 'normal.png');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /symbolic|regular file/);
  assert.equal(server.records.length, 0);
});

test('net cut sends true length and exactly half the UTF-8 body then FIN', async t => {
  const r = await run(t);
  const server = await capture(t);
  const json = '{"message":"مرحبا 🙂"}';
  const result = await cli('net', r.id, 'cut', 'POST', `${server.base}/items?q=1`,
    '--probe', `${server.base}/health`, '--json', json, '--token', 'synthetic-token');
  measured(result, 'cut');
  const main = mainRecord(server);
  const { headers, body } = parts(main);
  assert.match(headers, /^POST \/items\?q=1 HTTP\/1\.1\r\n/);
  assert.match(headers, new RegExp(`Content-Length: ${Buffer.byteLength(json)}(?:\\r\\n|$)`, 'i'));
  assert.match(headers, /Authorization: Bearer synthetic-token/i);
  assert.deepEqual(body, Buffer.from(json).subarray(0, Math.floor(Buffer.byteLength(json) / 2)));
  assert.equal(main.fin, true);
  assert.match(result.stdout, /^probe during: n\/a$/m);
  assert.equal(server.records.filter(r => r.probe).length, 1);
});

test('net cut reuses the made-file multipart framing and writes nothing into the run', async t => {
  const r = await run(t);
  const made = await makeFile(r.id, 'normal-png');
  const before = (await readdir(r.dir)).sort();
  const source = await readFile(path.join(r.dir, 'files', made.name));
  const server = await capture(t);
  const result = await cli('net', r.id, 'cut', 'POST', `${server.base}/upload`,
    '--probe', `${server.base}/health`, '--file', made.name);
  measured(result, 'cut');
  const { headers, body } = parts(mainRecord(server));
  const boundary = /Content-Type: multipart\/form-data; boundary=([^\r\n]+)/i.exec(headers)?.[1];
  assert.ok(boundary);
  const complete = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="normal.png"\r\nContent-Type: image/png\r\n\r\n`), source,
    Buffer.from(`\r\n--${boundary}--\r\n`)]);
  assert.match(headers, new RegExp(`Content-Length: ${complete.length}(?:\\r\\n|$)`, 'i'));
  assert.deepEqual(body, complete.subarray(0, Math.floor(complete.length / 2)));
  assert.deepEqual((await readdir(r.dir)).sort(), before);
});

test('net slow drips at most one byte per 500 ms, probes while held, and closes at the chosen limit', async t => {
  const r = await run(t);
  const server = await capture(t);
  const result = await cli('net', r.id, 'slow', 'POST', `${server.base}/items`,
    '--probe', `${server.base}/health`, '--seconds', '2');
  measured(result, 'slow');
  const main = mainRecord(server);
  assert.ok(main.bytes.length >= 2 && main.bytes.length <= 5, `dripped ${main.bytes.length}`);
  assert.equal(main.bytes.toString(), 'POST '.slice(0, main.bytes.length));
  assert.ok(main.chunks.every(c => c.bytes === 1));
  for (let i = 1; i < main.chunks.length; i++) {
    assert.ok(main.chunks[i].at - main.chunks[i - 1].at >= 450);
  }
  const probes = server.records.filter(r => r.probe);
  assert.equal(probes.length, 2);
  assert.equal(probes[0].whileHeld, true);
  assert.equal(probes[1].whileHeld, false);
  assert.match(result.stdout, /still open at our limit/);
  assert.ok(result.elapsed >= 1900 && result.elapsed < 4000, String(result.elapsed));
  await pause(20);
  assert.ok(main.fin || main.closed);
});

test('net short sends exactly ten bytes and stays silent while its during probe runs', async t => {
  const r = await run(t);
  const server = await capture(t);
  const json = '{"message":"more than ten bytes"}';
  const result = await cli('net', r.id, 'short', 'POST', `${server.base}/items`,
    '--probe', `${server.base}/health`, '--json', json, '--seconds', '1');
  measured(result, 'short');
  const main = mainRecord(server);
  const { headers, body } = parts(main);
  assert.match(headers, new RegExp(`Content-Length: ${Buffer.byteLength(json)}(?:\\r\\n|$)`, 'i'));
  assert.deepEqual(body, Buffer.from(json).subarray(0, 10));
  const probes = server.records.filter(r => r.probe);
  assert.equal(probes.length, 2);
  assert.equal(probes[0].whileHeld, true);
  assert.equal(probes[1].whileHeld, false);
  assert.match(result.stdout, /still open at our limit/);
  assert.ok(result.elapsed >= 900 && result.elapsed < 3000, String(result.elapsed));
});

test('net leave sends a complete request and closes without reading an app reply', async t => {
  const r = await run(t);
  const secret = 'must-not-be-read';
  const server = await capture(t, record => {
    if (!record.bytes.includes('\r\n\r\n')) return;
    if (parts(record).body.length < Buffer.byteLength('{"message":"done once"}')) return;
    record.socket.write(`HTTP/1.1 201 Created\r\nContent-Length: ${secret.length}\r\n\r\n${secret}`);
  });
  const json = '{"message":"done once"}';
  const result = await cli('net', r.id, 'leave', 'POST', `${server.base}/items`,
    '--probe', `${server.base}/health`, '--json', json);
  measured(result, 'leave');
  const main = mainRecord(server);
  assert.deepEqual(parts(main).body, Buffer.from(json));
  assert.ok(main.fin || main.closed);
  assert.doesNotMatch(result.stdout, /Status:|must-not-be-read/);
  assert.match(result.stdout, /we closed: yes/);
  assert.equal(server.records.length, 2);
});

for (const kind of ['garbage', 'bad-header', 'huge-header', 'two-lengths']) {
  test(`net ${kind} sends only its fixed broken request shape`, async t => {
    const r = await run(t);
    const server = await capture(t, record => {
      if (record.answered) return;
      if (kind === 'garbage' ? record.bytes.length < 64 : !record.bytes.includes('\r\n\r\n')) return;
      record.answered = true;
      record.socket.end('HTTP/1.1 400 Bad Request\r\nContent-Length: 3\r\nConnection: close\r\n\r\nbad');
    });
    const result = await cli('net', r.id, kind, 'POST', `${server.base}/items`, '--probe', `${server.base}/health`);
    measured(result, kind);
    const main = mainRecord(server);
    if (kind === 'garbage') {
      assert.equal(main.bytes.length, 64);
      assert.doesNotMatch(main.bytes.toString(), /^(GET|POST|PUT) /);
      const second = await cli('net', r.id, kind, 'POST', `${server.base}/items`, '--probe', `${server.base}/health`);
      assert.equal(second.status, 0, second.stderr);
      assert.deepEqual(server.records.filter(r => !r.probe)[1].bytes, main.bytes, 'constant non-HTTP bytes');
    } else {
      const { headers, body } = parts(main);
      assert.match(headers, /^POST \/items HTTP\/1\.1\r\n/);
      if (kind === 'bad-header') assert.ok(headers.split('\r\n').slice(1).some(line => !line.includes(':')));
      if (kind === 'huge-header') {
        const values = headers.split('\r\n').slice(1).map(line => line.slice(line.indexOf(':') + 1).trim());
        assert.ok(values.some(value => value.length === 32768 && new Set(value).size === 1));
      }
      if (kind === 'two-lengths') {
        const lengths = [...headers.matchAll(/^Content-Length: (\d+)$/gmi)].map(m => Number(m[1]));
        assert.equal(lengths.length, 2);
        assert.notEqual(lengths[0], lengths[1]);
        assert.ok(body.length > 0 && body.length < 10);
      }
    }
    assert.match(result.stdout, /^app: answered 400 after /m);
    assert.match(result.stdout, /^probe during: n\/a$/m);
    assert.match(result.stdout, /^probe after: app answered 200$/m);
    assert.match(result.stdout, /Status: 400\nbad/);
  });
}

test('net displays only a masked 2 KiB app body and never follows its redirect', async t => {
  const r = await run(t);
  let followed = 0;
  const destination = http.createServer((req, res) => { followed++; res.end('unexpected'); });
  await new Promise(resolve => destination.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => destination.close(resolve)));
  const body = JSON.stringify({ password: 'tinyPass', message: '€'.repeat(2000) });
  const server = await capture(t, record => {
    if (!record.bytes.includes('\r\n\r\n') || record.answered) return;
    record.answered = true;
    record.socket.end(`HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:${destination.address().port}/secret\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  });
  const result = await cli('net', r.id, 'bad-header', 'POST', `${server.base}/items`, '--probe', `${server.base}/health`);
  measured(result, 'bad-header');
  assert.match(result.stdout, /Status: 302\n/);
  assert.doesNotMatch(result.stdout, /tinyPass/);
  assert.match(result.stdout, /•••• \(8 chars\)/);
  const display = result.stdout.split('Status: 302\n')[1].split('\n(cut)')[0].trimEnd();
  assert.ok(Buffer.byteLength(display) <= 2048);
  assert.match(result.stdout, /\n\(cut\)\n$/);
  assert.equal(followed, 0);
});

test('net probe failures and non-GET-able health responses are measurements', async t => {
  const r = await run(t);
  const server = await capture(t, record => record.socket.end(), { probeStatus: 405 });
  const result = await cli('net', r.id, 'cut', 'POST', `${server.base}/items`, '--probe', `${server.base}/health`, '--json', '{}');
  measured(result, 'cut');
  assert.match(result.stdout, /probe after: app answered 405/);
  const silent = await capture(t, record => record.socket.destroy(), { holdProbe: true });
  const failed = await cli('net', r.id, 'cut', 'POST', `${silent.base}/items`, '--probe', `${silent.base}/health`, '--json', '{}');
  measured(failed, 'cut');
  assert.match(failed.stdout, /probe after: app did not answer/);
  assert.ok(failed.elapsed < 7000);
});

test('net uses localhost literally despite proxy variables and accepts exactly 64 KiB of JSON', async t => {
  const r = await run(t);
  const server = await capture(t, record => {
    if (!record.bytes.includes('\r\n\r\n')) return;
    record.socket.end('HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok');
  });
  const base = server.base.replace('127.0.0.1', 'localhost');
  const result = await cli('net', r.id, 'short', 'POST', `${base}/items`, '--probe', `${base}/health`,
    '--json', 'a'.repeat(65536), '--seconds', '1');
  assert.equal(result.status, 0, result.stderr);
  const { headers, body } = parts(mainRecord(server));
  assert.match(headers, /Content-Length: 65536\r?$/mi);
  assert.deepEqual(body, Buffer.from('a'.repeat(10)));
  assert.match(result.stdout, /probe after: app answered 200/);
});

test('net slow stops dripping when the app answers instead of waiting for its own cap', async t => {
  const r = await run(t);
  const server = await capture(t, record => {
    if (record.answered) return;
    record.answered = true;
    record.socket.end('HTTP/1.1 408 Request Timeout\r\nContent-Length: 4\r\n\r\nstop');
  });
  const result = await cli('net', r.id, 'slow', 'POST', `${server.base}/items`, '--probe', `${server.base}/health`, '--seconds', '2');
  measured(result, 'slow');
  assert.equal(mainRecord(server).bytes.length, 1);
  assert.match(result.stdout, /app: answered 408 after/);
  assert.match(result.stdout, /Status: 408\nstop/);
  assert.ok(result.elapsed < 1500, String(result.elapsed));
});

test('net reports a server reset as a measurement and still probes afterward', async t => {
  const r = await run(t);
  const server = await capture(t, record => record.socket.resetAndDestroy());
  const result = await cli('net', r.id, 'bad-header', 'POST', `${server.base}/items`, '--probe', `${server.base}/health`);
  measured(result, 'bad-header');
  assert.match(result.stdout, /app: reset the connection after/);
  assert.match(result.stdout, /probe after: app answered 200/);
  assert.doesNotMatch(result.stdout, /Status:/);
  assert.equal(server.records.length, 2);
});

test('net decodes chunked app replies before applying the normal masked display', async t => {
  const r = await run(t);
  const body = '{"password":"tinyPass","ok":true}';
  const split = [body.slice(0, 7), body.slice(7, 18), body.slice(18)];
  const wire = split.map(part => `${Buffer.byteLength(part).toString(16)}\r\n${part}\r\n`).join('') + '0\r\n\r\n';
  const server = await capture(t, record => {
    if (!record.bytes.includes('\r\n\r\n') || record.answered) return;
    record.answered = true;
    record.socket.write('HTTP/1.1 400 Bad Request\r\nTransfer-Encoding: chunked\r\n\r\n');
    record.socket.end(wire);
  });
  const result = await cli('net', r.id, 'bad-header', 'POST', `${server.base}/items`, '--probe', `${server.base}/health`);
  measured(result, 'bad-header');
  assert.match(result.stdout, /Status: 400\n\{"password":"•••• \(8 chars\)","ok":true\}/);
  assert.doesNotMatch(result.stdout, /tinyPass/);
});

test('net broken request with no app reaction is stopped by its fixed five-second limit', async t => {
  const r = await run(t);
  const server = await capture(t);
  const result = await cli('net', r.id, 'garbage', 'POST', `${server.base}/items`, '--probe', `${server.base}/health`);
  measured(result, 'garbage');
  assert.match(result.stdout, /still open at our limit/);
  assert.ok(result.elapsed >= 4900 && result.elapsed < 7000, String(result.elapsed));
  assert.equal(mainRecord(server).bytes.length, 64);
  assert.equal(server.records.length, 2);
});

test('net retains an answered status but marks an unfinished response body cut at its deadline', async t => {
  const r = await run(t);
  const server = await capture(t, record => {
    if (!record.bytes.includes('\r\n\r\n') || record.answered) return;
    record.answered = true;
    record.socket.write('HTTP/1.1 400 Bad Request\r\nContent-Length: 1000\r\n\r\npartial body');
  });
  const result = await cli('net', r.id, 'bad-header', 'POST', `${server.base}/items`, '--probe', `${server.base}/health`);
  measured(result, 'bad-header');
  assert.match(result.stdout, /app: answered 400 after/);
  assert.match(result.stdout, /Status: 400\npartial body\n\(cut\)\n$/);
  assert.ok(result.elapsed >= 4900 && result.elapsed < 7000, String(result.elapsed));
  assert.equal(server.records.length, 2);
});

test('net marks a prematurely closed Content-Length body as incomplete evidence', async t => {
  const r = await run(t);
  const server = await capture(t, record => {
    if (!record.bytes.includes('\r\n\r\n') || record.answered) return;
    record.answered = true;
    record.socket.end('HTTP/1.1 500 Error\r\nContent-Length: 1000\r\n\r\npartial body');
  });
  const result = await cli('net', r.id, 'bad-header', 'POST', `${server.base}/items`, '--probe', `${server.base}/health`);
  measured(result, 'bad-header');
  assert.match(result.stdout, /app: answered 500 after/);
  assert.match(result.stdout, /Status: 500\npartial body\n\(cut\)\n$/);
  assert.ok(result.elapsed < 1500);
});

test('net displays a nonstandard HTTP status consistently with send', async t => {
  const r = await run(t);
  const server = await capture(t, record => {
    if (!record.bytes.includes('\r\n\r\n') || record.answered) return;
    record.answered = true;
    record.socket.end('HTTP/1.1 600 Custom\r\nContent-Length: 6\r\n\r\ncustom');
  });
  const result = await cli('net', r.id, 'bad-header', 'POST', `${server.base}/items`, '--probe', `${server.base}/health`);
  measured(result, 'bad-header');
  assert.match(result.stdout, /app: answered 600 after/);
  assert.match(result.stdout, /Status: 600\ncustom\n$/);
});

test('net never-answering server returns by seconds plus final probe and leaves every socket closed', async t => {
  const r = await run(t);
  const server = await capture(t, () => {}, { holdProbe: true });
  const result = await cli('net', r.id, 'short', 'POST', `${server.base}/items`,
    '--probe', `${server.base}/health`, '--json', '{"long":"more than ten"}', '--seconds', '1');
  measured(result, 'short');
  assert.match(result.stdout, /still open at our limit/);
  assert.match(result.stdout, /probe during: app did not answer/);
  assert.match(result.stdout, /probe after: app did not answer/);
  assert.ok(result.elapsed < 7000, `seconds + five-second probe: ${result.elapsed}`);
  await pause(30);
  assert.ok(server.records.every(record => record.fin || record.closed), 'all client socket sides closed');
  assert.equal(server.records.length, 3);
});

test('net thirty-second absolute ceiling closes the held socket with no retry', async t => {
  const r = await run(t);
  const server = await capture(t);
  const result = await cli('net', r.id, 'short', 'POST', `${server.base}/items`,
    '--probe', `${server.base}/health`, '--json', '{"long":"more than ten"}', '--seconds', '30');
  measured(result, 'short');
  assert.match(result.stdout, /still open at our limit/);
  assert.ok(result.elapsed >= 29500 && result.elapsed < 33000, String(result.elapsed));
  const main = mainRecord(server);
  await pause(20);
  assert.ok(main.fin || main.closed);
  assert.equal(server.records.length, 3);
});
