import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, symlink, link, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { root, project, newRun, cli } from './helpers.mjs';
import { maskLoginValues, rememberLoginValue, rememberRunLoginValue, readLoginShapes } from '../scripts/lib/login-values.mjs';

async function server(t, handler) {
  const app = http.createServer(handler);
  await new Promise((resolve, reject) => { app.once('error', reject); app.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => app.close(resolve)));
  return `http://127.0.0.1:${app.address().port}`;
}

function command(...args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'scripts/break-it.mjs'), ...args]);
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', status => resolve({ status, stdout, stderr }));
  });
}

test('login display hides escaped JSON login names and numeric session identifiers', () => {
  const escaped = '{"sess\\u0069on":"synthetic-escaped-login"}';
  assert.ok(!maskLoginValues(escaped).includes('synthetic-escaped-login'));
  assert.ok(!maskLoginValues('{"session":123456789}').includes('123456789'));
  assert.ok(!maskLoginValues('{"sessionId":123456789}').includes('123456789'));
});

test('known bearer echo is hidden even when JSON escapes its string representation', () => {
  const value = 'synthetic-echo-login';
  rememberLoginValue(value);
  const reflected = '{"echo":"synthetic\\u002decho\\u002dlogin"}';
  const output = maskLoginValues(reflected);
  assert.ok(!output.includes('synthetic'));
  assert.match(output, /••••/);
});

test('cut JSON keeps escaped login field names and numeric login values hidden', () => {
  const escaped = '{"sess\\u0069on":"synthetic-cut-private-prefix';
  const numeric = '{"session":987654321';
  assert.ok(!maskLoginValues(escaped, { cut: true }).includes('synthetic-cut-private-prefix'));
  assert.ok(!maskLoginValues(numeric, { cut: true }).includes('987654321'));
});

test('send never prints a cut prefix of an over-two-KiB bearer echoed under an arbitrary key', async t => {
  const value = 'SyntheticLoginPrefix_' + 'xY9_'.repeat(800);
  const url = await server(t, (req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${value}`);
    res.end(JSON.stringify({ echo: value }));
  });
  const result = await command('send', 'GET', url, '--token', value);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!(result.stdout + result.stderr).includes(value.slice(0, 512)), 'even the cut prefix stays hidden');
  assert.match(result.stdout, /\(cut\)/);
});

test('login fingerprint metadata refuses symlinks and hardlinks without changing the outside file', async t => {
  const folder = await mkdtemp(path.join(tmpdir(), 'break-it-login-edge-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const outside = path.join(folder, 'outside.json');
  const content = JSON.stringify({ salt: 'a'.repeat(32), values: [] });
  await writeFile(outside, content);
  for (const kind of ['symlink', 'hardlink']) {
    const run = newRun(t, await project(t));
    const target = path.join(run.dir, 'login-shapes.json');
    if (kind === 'symlink') await symlink(outside, target);
    else await link(outside, target);
    await assert.rejects(readLoginShapes(run.id), /Refused:/);
    await assert.rejects(rememberRunLoginValue(run.id, 'synthetic-private-edge'), /Refused:/);
    assert.equal(await readFile(outside, 'utf8'), content);
  }
});

test('sampled login findings are refused by a fresh report process after cleanup', async t => {
  const run = newRun(t, await project(t));
  const folder = await mkdtemp(path.join(tmpdir(), 'break-it-login-edge-report-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const value = 'sampled-local-value-without-secret-shape';
  const url = await server(t, (req, res) => res.end(JSON.stringify({ odd_login_field: value })));
  const sampled = await command('sessions', run.id, 'POST', url, '--json', '{"username":"synthetic-person"}',
    '--field', 'odd_login_field', '--count', '2');
  assert.equal(sampled.status, 0, sampled.stderr);
  assert.ok(!(sampled.stdout + sampled.stderr).includes(value));
  const cleaned = cli('cleanup', run.id);
  assert.equal(cleaned.status, 0, cleaned.stderr);
  const findings = { project: 'synthetic login report', round: 1,
    attacks: { tried: 1, blocked: 0, gotThrough: 1 }, findings: [{ id: 'G03', title: 'Login repeated',
      severity: 'CRITICAL', Tried: 'Logged in twice', Saw: `prefix ${value} suffix`, Where: 'server.mjs:1',
      Advice: 'Issue independent unpredictable values' }] };
  const file = path.join(folder, 'findings.json');
  await writeFile(file, JSON.stringify(findings));
  const report = cli('report', run.id, file);
  assert.equal(report.status, 1);
  assert.match(report.stderr, /login value/);
  assert.ok(!(report.stdout + report.stderr).includes(value));
});

test('malformed findings JSON never prints a sampled login from a parser source excerpt', async t => {
  const run = newRun(t, await project(t));
  const folder = await mkdtemp(path.join(tmpdir(), 'break-it-login-edge-malformed-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const value = 'q9Z7t3';
  await rememberRunLoginValue(run.id, value);
  assert.equal(cli('cleanup', run.id).status, 0);
  const file = path.join(folder, 'findings.json');
  await writeFile(file, `{"Saw":${value}}`);
  const result = cli('report', run.id, file);
  assert.equal(result.status, 1);
  assert.ok(!(result.stdout + result.stderr).includes(value), 'parser excerpts must not contain private login bytes');
});

test('report checks private login bytes before diagnostics quote a finding id', async t => {
  const run = newRun(t, await project(t));
  const folder = await mkdtemp(path.join(tmpdir(), 'break-it-login-edge-diagnostic-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const value = 'synthetic-private-id-not-a-token-shape';
  await rememberRunLoginValue(run.id, value);
  assert.equal(cli('cleanup', run.id).status, 0);
  const file = path.join(folder, 'findings.json');
  const findings = { project: 'synthetic diagnostic', round: 1,
    attacks: { tried: 1, blocked: 0, gotThrough: 1 }, findings: [{ id: value, severity: 'CRITICAL',
      title: 'api_key = "synthetic-other-credential"', Tried: 'Synthetic diagnostic', Saw: 'Synthetic evidence',
      Where: 'server.mjs:1', Advice: 'Keep private bytes out of evidence' }] };
  await writeFile(file, JSON.stringify(findings));
  const result = cli('report', run.id, file);
  assert.equal(result.status, 1);
  assert.ok(!(result.stdout + result.stderr).includes(value), 'even rejection diagnostics must hide the login value');
});
