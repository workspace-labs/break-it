import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, cp, rm, access, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runDemo, startShop, stopShop, probeShop, examplePath } from '../scripts/demo-shop.mjs';
import { sendRequest, sendFileRequest } from '../scripts/lib/send.mjs';
import { Readable } from 'node:stream';
import { uploadRequest } from '../scripts/lib/upload.mjs';
import { makeFile } from '../scripts/lib/files.mjs';
import { copyProject } from '../scripts/lib/copy.mjs';
import { runPath } from '../scripts/lib/runs.mjs';
import { cleanupRun } from '../scripts/lib/cleanup.mjs';

test('shop source gives away no hole, try id or demo answer', async () => {
  for (const file of await readdir(examplePath)) {
    const source = await readFile(path.join(examplePath, file), 'utf8');
    assert.doesNotMatch(source, /PLANTED|HOLE|[ABCDE]0|demo/i, file);
  }
});

test('shop answer key stays outside the app and identifies actual source lines', async () => {
  const keyPath = path.join(examplePath, '..', 'shop-app-answers.md');
  assert.equal(path.dirname(keyPath), path.dirname(examplePath));
  const key = await readFile(keyPath, 'utf8');
  const source = await readFile(path.join(examplePath, 'server.mjs'), 'utf8');
  for (const [id, anchor] of [
    ['A09', 'const limited ='],
    ['A01', 'if (!data.text) throw'],
    ['B01', 'const requireOwner ='],
    ['C03', 'if (!omitPrivate) profile.passwordHash'],
    ['C04', 'const hideDetails ='],
    ['D01', 'if (catalogJobs.length > 4) catalogAvailable = false;'],
    ['D02', 'const limited ='],
    ['D04', 'if (!catalogAvailable) return req.socket.destroy();'],
    ['E01', 'const limitUploads ='],
    ['E03', 'const safeUploadNames ='],
    ['E04', 'const downloadUploads ='],
    ['E07', 'const privateUploads ='],
    ['E08', 'try { bytes = await readFile(path.join(uploadsFolder, name)); }']
  ]) {
    const line = source.split('\n').findIndex(text => text.includes(anchor)) + 1;
    assert.ok(line > 0, anchor);
    assert.ok(key.includes(`\`${id}\` — \`server.mjs:${line}\``), `${id} answer line`);
    assert.ok(key.includes(`\`${anchor}\``), `${id} answer anchor`);
  }
  const config = await readFile(path.join(examplePath, 'config.mjs'), 'utf8');
  const line = config.split('\n').findIndex(text => text.includes('export const API_KEY =')) + 1;
  assert.ok(key.includes(`\`C01\` — \`config.mjs:${line}\``));
});

test('shop end to end detects planted holes and preserves the safe route', async () => {
  const result = await runDemo();
  assert.deepEqual(result.rounds[0].findings.map(f => [f.id, f.severity]),
    [['C01', 'CRITICAL'], ['B01', 'CRITICAL'], ['A01', 'SMALL'], ['A09', 'SMALL'],
      ['C03', 'CRITICAL'], ['C04', 'SMALL'], ['D01', 'CRITICAL'], ['D02', 'SMALL'], ['D04', 'CRITICAL'],
      ['E01', 'SMALL'], ['E03', 'CRITICAL'], ['E04', 'CRITICAL'], ['E07', 'CRITICAL'], ['E08', 'CRITICAL']]);
  assert.ok(result.rounds[0].findings.every(f => /^(?:server|config)\.mjs:\d+$/.test(f.Where)));
  assert.equal(result.rounds[0].findings.some(f => f.id === 'B02-safe'), false);
  assert.equal(result.rounds[0].attacks.blocked, 4);
  assert.equal(result.rounds[0].attacks.tried, 18);
  const traversal = result.rounds[0].findings.find(f => f.id === 'E08');
  assert.match(traversal.Saw, /HTTP 200/);
  assert.match(traversal.Saw, /server\.mjs/);
  assert.doesNotMatch(traversal.Saw, /import http/);
  assert.equal(result.rounds[0].findings.some(f => f.Where.startsWith('.env.example:')), false);
  const config = await readFile(path.join(examplePath, 'config.mjs'), 'utf8');
  const value = /API_KEY = ["']([^"']+)/.exec(config)?.[1];
  assert.ok(value, 'synthetic config assignment exists');
  assert.equal(result.output.includes(value), false);
  assert.equal(result.output.includes('synthetic-password-hash-local-only'), false);
  assert.deepEqual(result.rounds[1].findings, []);
  assert.equal(result.rounds[1].attacks.blocked, 18);
  for (const round of result.rounds) {
    assert.equal(round.findings.some(f => f.id === 'D-safe'), false);
    assert.equal(round.findings.some(f => f.id === 'E-safe'), false);
  }
  assert.match(result.output, /BREAK-IT REPORT shop-app/);
  assert.match(result.output, /ROUND 2 shop-app/);
  assert.match(result.output, /Seal: real project unchanged/);
  assert.match(result.output, /Copy deleted\. Nothing left behind\. Break-it changed no code\./);
  for (const folder of result.runFolders) await assert.rejects(access(folder));
});

test('probe detects a safe-route owner check removed in a scratch fixture', async () => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'break-it-shop-test-'));
  let child;
  try {
    await cp(examplePath, scratch, { recursive: true });
    const file = path.join(scratch, 'server.mjs');
    const source = await readFile(file, 'utf8');
    const guard = "if (order.owner !== user) return send(res, 403, { error: 'Not your order' });";
    assert.ok(source.includes(guard));
    await writeFile(file, source.replace(guard, '/* owner check deliberately absent in this test */'));
    child = await startShop(scratch);
    const result = await probeShop(child.port, scratch);
    assert.equal(result.findings.find(f => f.id === 'B02-safe')?.severity, 'CRITICAL');
  } finally {
    if (child) await stopShop(child);
    await rm(scratch, { recursive: true, force: true });
  }
});


test('shop leak routes expose only synthetic data on a disposable copy', async () => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'break-it-shop-leaks-'));
  let app;
  try {
    await cp(examplePath, scratch, { recursive: true });
    app = await startShop(scratch);
    const base = `http://127.0.0.1:${app.port}`;
    const login = await sendRequest('POST', `${base}/login`, {
      json: JSON.stringify({ user: 'A', password: 'example-a' })
    });
    const token = JSON.parse(login.body).session;
    const profile = await sendRequest('GET', `${base}/profile`, { token });
    assert.equal(profile.status, 200);
    assert.equal(JSON.parse(profile.body).passwordHash, 'synthetic-password-hash-local-only');
    const error = await sendRequest('GET', `${base}/catalog-error`, { token });
    assert.equal(error.status, 500);
    assert.match(error.body, /SQLITE_ERROR/);
    assert.match(error.body, /\/srv\/shop\/catalog\.mjs:18/);
  } finally {
    if (app) await stopShop(app);
    await rm(scratch, { recursive: true, force: true });
  }
});

test('shop config uses a synthetic generic assignment and documents its placeholder control', async () => {
  const config = await readFile(path.join(examplePath, 'config.mjs'), 'utf8');
  assert.match(config, /export const API_KEY = ["']shopkey-EXAMPLE-/);
  assert.doesNotMatch(config, /ghp_|github_pat_|AKIA|sk_live_/);
  const server = await readFile(path.join(examplePath, 'server.mjs'), 'utf8');
  assert.match(server, /import \{ API_KEY \} from ['"]\.\/config\.mjs['"]/);
  const placeholder = await readFile(path.join(examplePath, '.env.example'), 'utf8');
  assert.match(placeholder, /API_KEY=["']?your-key-here/);
});

test('shop download path guard blocks both E08 spellings without the owner check and keeps benign dotted names', async t => {
  for (const [label, guarded, ownerCheck] of [
    ['round 1 read hole', false, false],
    ['path guard alone', true, false],
    ['round 2 path and owner guards', true, true]
  ]) {
    await t.test(label, async () => {
      const scratch = await mkdtemp(path.join(os.tmpdir(), 'break-it-shop-download-'));
      let app;
      try {
        await cp(examplePath, scratch, { recursive: true });
        const file = path.join(scratch, 'server.mjs');
        let source = await readFile(file, 'utf8');
        assert.ok(source.includes('const privateUploads = false;'));
        if (guarded) {
          source = source.replace('const safeDownloadPaths = false;', 'const safeDownloadPaths = true;')
            .replace('const safeUploadNames = false;', 'const safeUploadNames = true;');
          if (ownerCheck) source = source.replace('const privateUploads = false;', 'const privateUploads = true;');
          await writeFile(file, source);
        }
        app = await startShop(scratch);
        const base = `http://127.0.0.1:${app.port}`;
        const login = await sendRequest('POST', `${base}/login`, {
          json: JSON.stringify({ user: 'A', password: 'example-a' })
        });
        const token = JSON.parse(login.body).session;
        for (const name of ['..%2Fserver.mjs', '%2E%2E%2Fserver.mjs']) {
          const read = await sendRequest('GET', `${base}/uploads/${name}`, { token });
          if (guarded) {
            assert.equal(read.status, 400);
            assert.equal(JSON.parse(read.body).error, 'Invalid file name');
            assert.doesNotMatch(read.body, /import http/);
          } else {
            assert.equal(read.status, 200);
            assert.ok(read.body.length > 0 && source.startsWith(read.body), 'observed app-source bytes');
          }
        }
        // A dotted basename is still inside uploads; it must not be mistaken
        // for a parent-directory segment when the round-2 guards are enabled.
        const boundary = 'break-it-dotted-name-control';
        const payload = Buffer.from('synthetic image control');
        const multipart = Buffer.concat([
          Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="..notes.png"\r\nContent-Type: image/png\r\n\r\n`),
          payload, Buffer.from(`\r\n--${boundary}--\r\n`)
        ]);
        const posted = await sendFileRequest('POST', `${base}/upload`, {
          source: Readable.from([multipart]), length: multipart.length, boundary, token
        });
        assert.equal(posted.status, 201);
        const read = await sendRequest('GET', `${base}${JSON.parse(posted.body).url}`, { token });
        assert.equal(read.status, 200);
        assert.equal(read.body, payload.toString());
      } finally {
        if (app) await stopShop(app);
        await rm(scratch, { recursive: true, force: true });
      }
    });
  }
});

test('shop retains catalog work until that route stops answering; the plain catalog survives', async () => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'break-it-shop-load-'));
  let app;
  try {
    await cp(examplePath, scratch, { recursive: true });
    app = await startShop(scratch);
    const base = `http://127.0.0.1:${app.port}`;
    assert.equal((await sendRequest('GET', `${base}/catalog-refresh`)).status, 200);
    await Promise.all(Array.from({ length: 8 }, () =>
      sendRequest('GET', `${base}/catalog-refresh`).catch(() => undefined)));
    await assert.rejects(sendRequest('GET', `${base}/catalog-refresh`));
    const control = await Promise.all(Array.from({ length: 8 }, () =>
      sendRequest('GET', `${base}/catalog`)));
    assert.ok(control.every(response => response.status === 200));
    assert.equal((await sendRequest('GET', `${base}/catalog`)).status, 200);
  } finally {
    if (app) await stopShop(app);
    await rm(scratch, { recursive: true, force: true });
  }
});


test('shop Family E generated type, archive and broken-file cases stay on the copy', async t => {
  const id = await copyProject(examplePath);
  const run = await runPath(id);
  const copy = path.join(run, 'copy');
  let app;
  t.after(async () => {
    if (app) await stopShop(app);
    await cleanupRun(id);
    await cleanupRun(id);
    await assert.rejects(access(run));
  });
  app = await startShop(copy);
  const base = `http://127.0.0.1:${app.port}`;
  const login = await sendRequest('POST', `${base}/login`, {
    json: JSON.stringify({ user: 'A', password: 'example-a' })
  });
  const token = JSON.parse(login.body).session;
  async function upload(kind, options = {}) {
    const made = await makeFile(id, kind);
    const response = await uploadRequest(id, 'POST', `${base}/upload`, { file: made.name, token, ...options });
    assert.equal(response.status, 201);
    assert.equal(JSON.parse(response.body).bytes, made.bytes);
    return { made, url: JSON.parse(response.body).url };
  }
  await t.test('E02 claimed JPEG is accepted despite carrying HTML text', async () => {
    const { url } = await upload('fake-image', { type: 'image/jpeg' });
    const read = await sendRequest('GET', `${base}${url}`, { token });
    assert.equal(read.status, 200);
    assert.equal(read.headers['content-type'], 'image/jpeg');
    assert.match(read.body, /<html|<!doctype/i);
    assert.doesNotMatch(read.body, /<script\s+src=/i);
  });
  await t.test('E05 is skipped because this shop stores archives without unpacking', async () => {
    const { made } = await upload('zip-bomb');
    const stored = await readFile(path.join(copy, 'uploads', made.name));
    assert.ok(stored.length < 1024 * 1024);
    assert.equal(stored.readUInt32LE(0), 0x04034b50);
    assert.deepEqual((await readdir(path.join(copy, 'uploads'))).sort(), ['photo.jpg', 'zeros.zip']);
    assert.equal((await sendRequest('GET', `${base}/catalog`)).status, 200);
  });
  for (const kind of ['empty', 'truncated-png']) {
    await t.test(`E06 ${kind} remains bounded and does not crash or hang the shop`, async () => {
      const { made, url } = await upload(kind);
      const read = await sendRequest('GET', `${base}${url}`, { token });
      assert.equal(read.status, 200);
      assert.equal(read.headers['content-type'], 'image/png');
      assert.equal(read.cut, false);
      assert.equal((await readFile(path.join(copy, 'uploads', made.name))).length, made.bytes);
      assert.equal((await sendRequest('GET', `${base}/catalog`)).status, 200);
    });
  }
});
