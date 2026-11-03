import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { validateFindings } from '../scripts/lib/report.mjs';
import { cli, project, newRun } from './helpers.mjs';

const value = 'local-test-report-0123456789';
const unmasked = `api_key = "${value}"`;
const masked = `api_key = "loc…6789 (${value.length} chars)"`;
function data() {
  return { project: 'local-example', round: 1,
    attacks: { tried: 1, blocked: 0, gotThrough: 1 },
    findings: [{ id: 'C01', severity: 'CRITICAL', title: 'Secret in configuration',
      Tried: 'Scanned the copy', Saw: 'A credential was found',
      Where: 'config.mjs:3', Advice: 'Remove the credential and rotate it separately' }] };
}

for (const field of ['Tried', 'Saw', 'Advice', 'title']) {
  test(`report guard refuses an unmasked secret in ${field} without echoing it`, () => {
    const input = data();
    input.findings[0][field] = unmasked;
    let message = '';
    try { validateFindings(input); } catch (error) { message = error.message; }
    assert.equal(message, 'Refused: finding C01 contains an unmasked secret; use the masked form.');
    assert.ok(!message.includes(value), 'refusal does not reveal the credential');
  });
}

test('report guard refuses an unmasked secret in skipped reason without echoing it', () => {
  const input = data();
  input.skipped = [{ id: 'C02', reason: unmasked }];
  let message = '';
  try { validateFindings(input); } catch (error) { message = error.message; }
  assert.equal(message, 'Refused: finding C02 contains an unmasked secret; use the masked form.');
  assert.ok(!message.includes(value), 'refusal does not reveal the credential');
});

test('report guard checks all finding and skipped text including nested extra evidence', () => {
  const input = data();
  input.findings[0].evidence = { details: [unmasked] };
  assert.throws(() => validateFindings(input), /contains an unmasked secret; use the masked form/);
  delete input.findings[0].evidence;
  input.skipped = [{ id: 'C02', reason: 'History unavailable', details: { note: unmasked } }];
  assert.throws(() => validateFindings(input), /contains an unmasked secret; use the masked form/);
});

test('report guard permits masked evidence and history commit anchors', () => {
  const input = data();
  input.findings[0].Saw = masked;
  input.findings[0].Where = 'config.mjs:3 -> commit 123abcd';
  input.skipped = [{ id: 'C05', reason: `Already identified as ${masked}` }];
  assert.doesNotThrow(() => validateFindings(input));
});

test('report guard rejects provider-shaped secrets even without an assignment label', () => {
  const input = data();
  const provider = `ghp_${'Q'.repeat(36)}`;
  input.findings[0].Saw = `Found ${provider}`;
  let message = '';
  try { validateFindings(input); } catch (error) { message = error.message; }
  assert.equal(message, 'Refused: finding C01 contains an unmasked secret; use the masked form.');
  assert.ok(!message.includes(provider), 'provider-shaped credential stays hidden');
});

for (const candidate of ['local-test…report-0123456789', 'local-test••••report-0123456789', 'loc…6789000']) {
  test(`report guard rejects malformed masked evidence with ${candidate.includes('••••') ? 'bullet' : 'ellipsis'} glyphs`, () => {
    const input = data();
    input.findings[0].Saw = `api_key = "${candidate}"`;
    let message = '';
    try { validateFindings(input); } catch (error) { message = error.message; }
    assert.equal(message, 'Refused: finding C01 contains an unmasked secret; use the masked form.');
    assert.ok(!message.includes(candidate), 'refusal does not print malformed evidence');
  });
}

test('report CLI refuses leaking input before printing any report or consuming its receipt', async t => {
  const p = await project(t);
  const run = newRun(t, p);
  assert.equal(cli('cleanup', run.id).status, 0);
  const file = path.join(p, '..', `leak-findings-${run.id}.json`);
  t.after(() => unlink(file).catch(() => {}));
  const input = data();
  input.findings[0].Saw = unmasked;
  await writeFile(file, JSON.stringify(input));
  const refused = cli('report', run.id, file);
  assert.notEqual(refused.status, 0);
  assert.equal(refused.stdout, '');
  assert.ok(!(refused.stdout + refused.stderr).includes(value), 'CLI refusal is masked');
  input.findings[0].Saw = masked;
  await writeFile(file, JSON.stringify(input));
  const corrected = cli('report', run.id, file);
  assert.equal(corrected.status, 0, 'receipt survives refusal for corrected evidence');
  assert.ok(corrected.stdout.includes(masked), 'masked evidence is preserved');
});

test('report inserts exactly one blank line before the first Same cause line', async t => {
  const p = await project(t);
  const run = newRun(t, p);
  assert.equal(cli('cleanup', run.id).status, 0);
  const file = path.join(p, '..', `same-cause-${run.id}.json`);
  t.after(() => unlink(file).catch(() => {}));
  const input = data();
  input.findings.push({ ...input.findings[0], id: 'C03' });
  input.attacks = { tried: 2, blocked: 0, gotThrough: 2 };
  await writeFile(file, JSON.stringify(input));
  const result = cli('report', run.id, file);
  assert.equal(result.status, 0, 'report succeeds');
  assert.match(result.stdout, /[^\n]\n\nSame cause:/);
  assert.doesNotMatch(result.stdout, /\n\n\nSame cause:/);
});
