import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, writeFile, symlink, link } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { root, project, newRun, cli } from './helpers.mjs';
import { sendRequest, sendOptions, formatSetCookie } from '../scripts/lib/send.mjs';
import { forgeLoginValue } from '../scripts/lib/login-forge.mjs';

async function server(t, handler) {
  const app = http.createServer(handler);
  await new Promise((resolve, reject) => {
    app.once('error', reject);
    app.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => app.close(resolve)));
  return `http://127.0.0.1:${app.address().port}`;
}
function send(...args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'scripts/break-it.mjs'), 'send', ...args]);
    let stdout = '', stderr = '';
    child.stdout.on('data', bytes => { stdout += bytes; });
    child.stderr.on('data', bytes => { stderr += bytes; });
    child.once('error', reject);
    child.once('close', status => resolve({ status, stdout, stderr }));
  });
}

test('jar keeps cookies only inside its sealed run and sends them only to the exact origin', async t => {
  const run = newRun(t, await project(t));
  const seen = [];
  const url = await server(t, (req, res) => {
    seen.push(req.headers.cookie);
    if (req.url === '/login') res.setHeader('Set-Cookie', ['sid=synthetic-local-value; Path=/; HttpOnly', 'bad=elsewhere; Domain=evil.com']);
    res.end('ok');
  });
  await sendRequest('POST', `${url}/login`, { jar: run.id });
  await sendRequest('GET', `${url}/private`, { jar: run.id });
  const other = [];
  const port2 = await server(t, (req, res) => { other.push(req.headers.cookie); res.end('ok'); });
  await sendRequest('GET', port2, { jar: run.id });
  await sendRequest('GET', url.replace('127.0.0.1', 'localhost'), { jar: run.id });
  assert.deepEqual(seen, [undefined, 'sid=synthetic-local-value', undefined]);
  assert.deepEqual(other, [undefined]);
  const jar = JSON.parse(await readFile(path.join(run.dir, 'jar.json'), 'utf8'));
  assert.equal(jar.cookies.length, 1);
  assert.equal(jar.cookies[0].origin, url);
  assert.equal(cli('cleanup', run.id).status, 0);
  await assert.rejects(readFile(path.join(run.dir, 'jar.json')), { code: 'ENOENT' });
});

test('jar refuses bad run ids and redirected jar files before requests', async t => {
  let hits = 0;
  const url = await server(t, (req, res) => { hits++; res.end('ok'); });
  await assert.rejects(sendRequest('GET', url, { jar: '../escape' }), /run id/);
  for (const kind of ['symlink', 'hardlink']) {
    const dir = await project(t);
    const run = newRun(t, dir);
    const target = path.join(dir, 'target.json');
    await writeFile(target, '{}');
    if (kind === 'symlink') await symlink(target, path.join(run.dir, 'jar.json'));
    else await link(target, path.join(run.dir, 'jar.json'));
    await assert.rejects(sendRequest('GET', url, { jar: run.id }), /jar.*(?:regular|link)|cookie jar/i);
    assert.equal(await readFile(target, 'utf8'), '{}');
  }
  assert.equal(hits, 0);
});

test('jar enforces twenty cookies and four KiB per cookie without partial writes', async t => {
  for (const cookies of [Array.from({ length: 21 }, (_, i) => `c${i}=v`), [`sid=${'x'.repeat(5120)}`]]) {
    const run = newRun(t, await project(t));
    const url = await server(t, (req, res) => { res.setHeader('Set-Cookie', cookies); res.end('ok'); });
    await assert.rejects(sendRequest('GET', url, { jar: run.id }), /20|4 KiB/);
    await assert.rejects(readFile(path.join(run.dir, 'jar.json')), { code: 'ENOENT' });
  }
  const run = newRun(t, await project(t));
  const url = await server(t, (req, res) => { res.setHeader('Set-Cookie', Array.from({ length: 20 }, (_, i) => `c${i}=v`)); res.end('ok'); });
  await sendRequest('GET', url, { jar: run.id });
  assert.equal(JSON.parse(await readFile(path.join(run.dir, 'jar.json'))).cookies.length, 20);
});

test('jar respects path, expiry and secure restrictions without broadening Domain', async t => {
  const run = newRun(t, await project(t));
  const seen = [];
  const url = await server(t, (req, res) => {
    seen.push(req.headers.cookie);
    if (req.url === '/login') res.setHeader('Set-Cookie', ['private=yes; Path=/private', 'gone=old; Max-Age=0', 'secure=only; Secure', 'same=local; Domain=127.0.0.1; Path=/']);
    res.end('ok');
  });
  await sendRequest('POST', `${url}/login`, { jar: run.id });
  await sendRequest('GET', `${url}/public`, { jar: run.id });
  await sendRequest('GET', `${url}/private/a`, { jar: run.id });
  assert.equal(seen[1], 'same=local');
  assert.equal(seen[2], 'private=yes; same=local');
});

test('Set-Cookie formatter fully masks every value and preserves flags byte for byte', () => {
  for (const value of ['a', 'harmless', 'x'.repeat(3000), '"quoted"']) {
    const flags = '; Path=/; HttpOnly; sAmEsItE = Lax; Max-Age=1800';
    const output = formatSetCookie(`shop_session=${value}${flags}`);
    assert.equal(output, `Set-Cookie: shop_session=•••• (${value.length} chars)${flags}`);
    assert.ok(!output.includes(`=${value};`));
  }
});

test('send headers include each masked cookie under the existing 2 KiB cap and cut marker', async t => {
  const values = ['a', 'harmless', 'x'.repeat(3000)];
  const url = await server(t, (req, res) => {
    res.setHeader('Set-Cookie', values.map((value, i) => `s${i}=${value}; Path=/; HttpOnly; SameSite=Lax`));
    if (req.url === '/cut') res.setHeader('Content-Security-Policy', 'x'.repeat(2100));
    res.end('ok');
  });
  const complete = await send('GET', url, '--headers');
  assert.equal(complete.status, 0, complete.stderr);
  for (const [i, value] of values.entries()) assert.ok(complete.stdout.includes(`Set-Cookie: s${i}=•••• (${value.length} chars); Path=/; HttpOnly; SameSite=Lax`));
  assert.ok(!complete.stdout.includes('harmless'));
  const cut = await send('GET', `${url}/cut`, '--headers');
  assert.match(cut.stdout, /\(headers cut; incomplete evidence\)/);
  const header = cut.stdout.split('\n').slice(2, -2).join('\n');
  assert.ok(Buffer.byteLength(header) <= 2048);
});

test('forge has four fixed kinds, preserves JWT payload and changes actual signature bytes', () => {
  const value = '01234567890123456789';
  const made = forgeLoginValue(value, 'made-up');
  assert.equal(made.length, value.length);
  assert.match(made, /^\d+$/);
  assert.notEqual(made, value);
  const changed = forgeLoginValue(value, 'one-char');
  assert.equal(changed.slice(0, -1), value.slice(0, -1));
  assert.notEqual(changed.at(-1), value.at(-1));
  const header = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url');
  const payload = Buffer.from('{"sub":"made-up"}').toString('base64url');
  const signature = Buffer.from('synthetic-signature').toString('base64url');
  const jwt = `${header}.${payload}.${signature}`;
  const none = forgeLoginValue(jwt, 'jwt-none').split('.');
  assert.equal(Buffer.from(none[0], 'base64url').toString(), '{"alg":"none"}');
  assert.equal(none[1], payload);
  assert.equal(none[2], '');
  const bad = forgeLoginValue(jwt, 'jwt-bad-sig').split('.');
  assert.deepEqual(bad.slice(0, 2), [header, payload]);
  assert.notDeepEqual(Buffer.from(bad[2], 'base64url'), Buffer.from(signature, 'base64url'));
  for (const kind of ['jwt-none', 'jwt-bad-sig']) assert.throws(() => forgeLoginValue(value, kind), /JWT/);
  assert.throws(() => forgeLoginValue(value, 'arbitrary'), /unknown.*forge/i);
});

test('forged bearer and cookie are sent for only one request and never change the jar', async t => {
  const run = newRun(t, await project(t));
  const value = 'synthetic-login-value-long';
  const seen = [];
  const url = await server(t, (req, res) => {
    seen.push({ cookie: req.headers.cookie, bearer: req.headers.authorization });
    res.setHeader('Set-Cookie', `sid=${value}; Path=/`);
    res.end('ok');
  });
  await sendRequest('POST', url, { jar: run.id });
  const before = await readFile(path.join(run.dir, 'jar.json'));
  const response = await sendRequest('GET', url, { jar: run.id, forge: 'one-char' });
  assert.equal(response.forged, 'one-char');
  assert.notEqual(seen[1].cookie, `sid=${value}`);
  assert.deepEqual(await readFile(path.join(run.dir, 'jar.json')), before);
  await sendRequest('GET', url, { jar: run.id });
  assert.equal(seen[2].cookie, `sid=${value}`);
  await sendRequest('GET', url, { token: value, forge: 'made-up' });
  assert.notEqual(seen[3].bearer, `Bearer ${value}`);
  await sendRequest('GET', url, { token: value });
  assert.equal(seen[4].bearer, `Bearer ${value}`);
  const cliResult = await send('GET', url, '--token', value, '--forge', 'one-char');
  assert.equal(cliResult.status, 0, cliResult.stderr);
  assert.match(cliResult.stdout, /sent a forged login value \(one-char\)/);
  assert.ok(!`${cliResult.stdout}${cliResult.stderr}`.includes(value));
});

test('JWT forgeries reach permissive local controls and stay blocked by a signature-checking control', async t => {
  const h = Buffer.from('{"alg":"HS256"}').toString('base64url');
  const p = Buffer.from('{"sub":"synthetic"}').toString('base64url');
  const sign = input => createHmac('sha256', 'synthetic-only-local-key').update(input).digest('base64url');
  const jwt = `${h}.${p}.${sign(`${h}.${p}`)}`;
  const seen = [];
  const url = await server(t, (req, res) => {
    const token = req.headers.authorization?.slice(7);
    seen.push(token);
    const [header, payload, signature] = token.split('.');
    const algorithm = JSON.parse(Buffer.from(header, 'base64url')).alg;
    const permissive = req.url === '/none' ? algorithm === 'none' && signature === '' :
      req.url === '/unchecked' ? algorithm === 'HS256' && payload === p : false;
    const valid = algorithm === 'HS256' && signature === sign(`${header}.${payload}`);
    res.statusCode = permissive || valid ? 200 : 401;
    res.end('bounded');
  });
  for (const kind of ['jwt-none', 'jwt-bad-sig']) {
    const route = kind === 'jwt-none' ? '/none' : '/unchecked';
    assert.equal((await sendRequest('GET', `${url}${route}`, { token: jwt, forge: kind })).status, 200);
    assert.equal((await sendRequest('GET', `${url}/strict`, { token: jwt, forge: kind })).status, 401);
  }
  assert.equal(seen.length, 4);
  for (const token of seen) assert.equal(token.split('.')[1], p);
});

test('original and forged values echoed by a local capture server stay absent from both CLI streams', async t => {
  const bearer = 'synthetic-echo-value-long';
  const jwt = ['{"alg":"HS256"}', '{"sub":"synthetic"}', 'signature']
    .map(value => Buffer.from(value).toString('base64url')).join('.');
  const captured = [];
  const url = await server(t, (req, res) => {
    const value = req.headers.authorization?.slice(7);
    captured.push(value);
    res.setHeader('Set-Cookie', `sid=${value}; Path=/`);
    res.end(JSON.stringify({ token: value, echo: value }));
  });
  for (const kind of ['made-up', 'one-char', 'jwt-none', 'jwt-bad-sig']) {
    const original = kind.startsWith('jwt-') ? jwt : bearer;
    const result = await send('GET', url, '--token', original, '--forge', kind, '--headers');
    assert.equal(result.status, 0, result.stderr);
    const output = result.stdout + result.stderr;
    assert.ok(!output.includes(original), 'original absent');
    assert.ok(!output.includes(captured.at(-1)), 'forged value absent');
    assert.match(output, /••••/);
  }
});

test('forge refuses missing values, unknown kinds and non-JWTs without contacting a server', async t => {
  let hits = 0;
  const url = await server(t, (req, res) => { hits++; res.end('ok'); });
  for (const options of [{ forge: 'one-char' }, { token: 'abc', forge: 'unknown' }, { token: 'abc', forge: 'jwt-none' }]) {
    await assert.rejects(sendRequest('GET', url, options), /forge|login value|JWT/i);
  }
  assert.equal(hits, 0);
  assert.throws(() => sendOptions(['--cookie', 'sid=value']), /Refused:/);
  assert.throws(() => sendOptions(['--forge', 'payload-edit']), /unknown.*forge/i);
});

test('stored jar values stay guarded after cleanup in a fresh CLI report process', async t => {
  const run = newRun(t, await project(t));
  const evidence = await project(t);
  const value = 'opaqueJarValueOnlyForReport070';
  const url = await server(t, (req, res) => {
    res.setHeader('Set-Cookie', `sid=${value}; Path=/; HttpOnly`);
    res.end('logged in');
  });
  const login = await send('POST', url, '--jar', run.id, '--headers');
  assert.equal(login.status, 0, login.stderr);
  assert.ok(!(login.stdout + login.stderr).includes(value));
  assert.equal(cli('seal', run.id).status, 0);
  assert.equal(cli('cleanup', run.id).status, 0);
  const file = path.join(evidence, 'findings.json');
  const findings = { project: 'Synthetic jar report', round: 1,
    attacks: { tried: 1, blocked: 0, gotThrough: 1 }, findings: [{
      id: 'G01', severity: 'CRITICAL', title: 'Logout leaves session active',
      Tried: 'Logged out and reused the old login', Saw: `Returned ${value}`,
      Where: 'hello.txt:1', Advice: 'Invalidate the server session at logout',
    }] };
  await writeFile(file, JSON.stringify(findings));
  const refused = cli('report', run.id, file);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /login value/);
  assert.ok(!(refused.stdout + refused.stderr).includes(value), 'refusal cannot disclose the stored cookie');
  findings.findings[0].Saw = 'Old login still received HTTP 200';
  await writeFile(file, JSON.stringify(findings));
  assert.equal(cli('report', run.id, file).status, 0);
});
