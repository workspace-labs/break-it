import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { project, newRun, cli, receiptFileFrom } from './helpers.mjs';
import { rememberLoginValue, rememberRunLoginValue, maskLoginValues, readLoginShapes,
  guardLoginValues } from '../scripts/lib/login-values.mjs';
import { reportRun, validateFindings } from '../scripts/lib/report.mjs';

const data = () => ({ project: 'synthetic shop', round: 1,
  attacks: { tried: 1, blocked: 0, gotThrough: 1 }, findings: [{ id: 'G03', severity: 'CRITICAL',
    title: 'Login values repeat', Tried: 'Logged in ten times', Saw: 'repeats',
    Where: 'server.mjs:1', Advice: 'Issue unpredictable values' }] });

test('login masking fully hides short, harmless and long JSON login fields', () => {
  for (const [index, key] of ['token', 'access_token', 'sessionId', 'login_key', 'jwt', 'authToken', 'session_token'].entries()) {
    for (const value of [`z${String.fromCharCode(97 + index)}`, `aZ${index}`.repeat(50)]) {
      const output = maskLoginValues(JSON.stringify({ [key]: value, message: 'logged in' }));
      assert.ok(!output.includes(value));
      assert.ok(output.includes('••••'));
      assert.ok(output.includes('logged in'));
    }
  }
});

test('known login values are fully masked in echoes and incomplete JSON', () => {
  const value = 'known-local-session-123456';
  rememberLoginValue(value);
  assert.ok(!maskLoginValues(`echo ${value}`).includes(value));
  assert.ok(!maskLoginValues('{"token":"arbitrary-partial').includes('arbitrary-partial'));
  const findings = data();
  findings.findings[0].Saw = `echo ${value}`;
  assert.throws(() => validateFindings(findings), /login value/);
});

test('echoes preceding a JSON login field are masked after decoding escapes', () => {
  const value = 'opaque\\synthetic';
  const output = maskLoginValues(JSON.stringify({ echo: value, token: value }));
  assert.ok(!JSON.parse(output).echo.includes(value));
  assert.ok(!output.includes(JSON.stringify(value).slice(1, -1)));
});

test('sample fingerprints survive cleanup without raw values and block fresh-process findings', async t => {
  const p = await project(t), run = newRun(t, p);
  const value = 'localOnlySyntheticFingerprint123';
  await rememberRunLoginValue(run.id, value);
  const shapes = await readLoginShapes(run.id);
  assert.throws(() => guardLoginValues({ Saw: `prefix ${value} suffix` }, shapes), /login value/);
  const stored = await readFile(path.join(run.dir, 'login-shapes.json'), 'utf8');
  assert.ok(!stored.includes(value));
  const file = receiptFileFrom(cli('cleanup', run.id));
  const receipt = await readFile(file, 'utf8');
  assert.ok(!receipt.includes(value));
  assert.ok(receipt.includes('loginShapes'));
  const findings = data();
  findings.findings[0].Saw = `prefix ${value} suffix`;
  // Importing reportRun has no access to the removed run's raw sample.
  await assert.rejects(reportRun(run.id, findings), /login value/);
  assert.match(await reportRun(run.id, data()), /BREAK-IT REPORT/);
});

test('login fingerprint paths refuse bad ids and never echo input values in errors', async () => {
  await assert.rejects(rememberRunLoginValue('../escape', 'do-not-echo-this'), /run id/);
});
