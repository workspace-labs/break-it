import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, unlink, lstat } from 'node:fs/promises';
import path from 'node:path';
import { cli, project, newRun, receiptFileFrom } from './helpers.mjs';
import { validateFindings } from '../scripts/lib/report.mjs';
import { saveReceipt } from '../scripts/lib/receipts.mjs';

const hole = { id: 'B01', severity: 'CRITICAL', title: 'Other people’s orders are open',
  Tried: 'User A opened user B’s order', Saw: 'B’s synthetic order details',
  Where: 'server.mjs:42', Advice: 'Check the owner before returning an order' };
async function setup(t) {
  const p = await project(t);
  const run = newRun(t, p);
  const data = { project: 'shop-app', round: 1, attacks: { tried: 2, blocked: 1, gotThrough: 1 },
    findings: [{ ...hole }] };
  const receiptFile = receiptFileFrom(cli('cleanup', run.id));
  const file = path.join(p, '..', `findings-${run.id}.json`);
  t.after(() => unlink(file).catch(() => {}));
  return { p, run, data, file, receiptFile, report: async () => {
    await writeFile(file, JSON.stringify(data));
    return cli('report', run.id, file);
  } };
}
for (const field of ['Tried', 'Saw', 'Where', 'Advice']) {
  test(`report refuses missing ${field}`, async t => {
    const s = await setup(t);
    delete s.data.findings[0][field];
    const r = await s.report();
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, new RegExp(field));
  });
}
test('report matches example shape and sorts CRITICAL first', async t => {
  const s = await setup(t);
  s.data.findings.unshift({ ...hole, id: 'A09', severity: 'SMALL', title: 'No login try limit' });
  s.data.attacks = { tried: 3, blocked: 1, gotThrough: 2 };
  const r = await s.report();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^BREAK-IT REPORT shop-app · version 0\.4\.2\nSeal: real project unchanged\nAttacks: 3 tried   1 blocked   2 got through/);
  assert.ok(r.stdout.indexOf('CRITICAL') < r.stdout.indexOf('SMALL'));
  for (const field of ['Tried', 'Saw', 'Where', 'Advice']) assert.match(r.stdout, new RegExp(`  ${field} `));
  assert.match(r.stdout, /Copy deleted\. Nothing left behind\. Break-it changed no code\./);
  s.data.round = 2;
  s.data.findings = [];
  s.data.attacks = { tried: 3, blocked: 3, gotThrough: 0 };
  // A report consumes its receipt; a retest always needs a fresh sealed copy.
  const fresh = newRun(t, s.p);
  cli('cleanup', fresh.id);
  await writeFile(s.file, JSON.stringify(s.data));
  const round2 = cli('report', fresh.id, s.file);
  assert.match(round2.stdout, /^ROUND 2 shop-app/);
  assert.match(round2.stdout, /Critical holes: 0   ->   Ready for the owner's look/);
});
test('W3 report refuses missing cleanup receipt or live run, and rechecks seal after cleanup', async t => {
  const s = await setup(t);
  const receipt = await readFile(s.receiptFile, 'utf8');
  await unlink(s.receiptFile);
  assert.notEqual((await s.report()).status, 0);
  await saveReceipt(s.run.id, JSON.parse(receipt));
  await writeFile(path.join(s.p, 'hello.txt'), 'late change');
  const changed = await s.report();
  assert.equal(changed.status, 3);
  assert.match(changed.stderr, /REAL PROJECT CHANGED\nchanged: hello.txt/);
  const active = newRun(t, s.p);
  const fake = JSON.parse(await readFile(path.join(active.dir, 'seal.json'), 'utf8'));
  fake.cleaned = true;
  s.data.receipt = fake;
  await writeFile(s.file, JSON.stringify(s.data));
  const r = cli('report', active.id, s.file);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /cleanup/i);
  assert.ok((await lstat(s.receiptFile)).isFile());
});
test('report refuses inconsistent counts and invalid evidence locations', async t => {
  const s = await setup(t);
  s.data.attacks.blocked = -1;
  assert.notEqual((await s.report()).status, 0);
  s.data.attacks.blocked = 1;
  s.data.findings[0].Where = '../outside.mjs:42';
  assert.notEqual((await s.report()).status, 0);
});
test('F3 report refuses zero completed tries with a plain reason', () => {
  assert.throws(() => validateFindings({ project: 'fixture', round: 1,
    attacks: { tried: 0, blocked: 0, gotThrough: 0 }, findings: [] }), /at least one completed try/i);
});
test('F4 all finding values start in the same column', async t => {
  const s = await setup(t);
  const r = await s.report();
  assert.equal(r.status, 0, r.stderr);
  const columns = r.stdout.split('\n').filter(line => /^  (Tried|Saw|Where|Advice) /.test(line))
    .map(line => /^(  (?:Tried|Saw|Where|Advice) +)/.exec(line)[1].length);
  assert.equal(columns.length, 4);
  assert.equal(new Set(columns).size, 1);
});

const validData = () => ({ project: 'shop-app', round: 1,
  attacks: { tried: 2, blocked: 1, gotThrough: 1 }, findings: [{ ...hole }] });

test('T1 optional skipped list accepts absent, empty and valid lists without changing counts', () => {
  const data = validData();
  assert.doesNotThrow(() => validateFindings(data));
  data.skipped = [];
  assert.doesNotThrow(() => validateFindings(data));
  data.skipped = [{ id: 'A07', reason: 'No create or update route to submit twice' }];
  const before = JSON.stringify(data);
  assert.doesNotThrow(() => validateFindings(data));
  assert.equal(JSON.stringify(data), before);
});

for (const skipped of [null, {}, 'A07', [null], [{}],
  [{ id: '', reason: 'Not applicable' }], [{ id: '  ', reason: 'Not applicable' }],
  [{ id: 'A07\nA08', reason: 'Not applicable' }], [{ id: 'A07', reason: '' }],
  [{ id: 'A07', reason: '  ' }], [{ id: 'A07', reason: 'line one\nline two' }],
  [{ id: 'A07', reason: 'control\u0000byte' }], [{ id: 7, reason: 'Not applicable' }],
  [{ id: 'A07', reason: 7 }]]) {
  test(`T1 refuses invalid skipped evidence ${JSON.stringify(skipped)}`, () => {
    assert.throws(() => validateFindings({ ...validData(), skipped }), /Refused:.*skipped/);
  });
}

test('T1 refuses duplicate skip ids and overlap with finding ids', () => {
  assert.throws(() => validateFindings({ ...validData(), skipped: [
    { id: 'A07', reason: 'No write route' }, { id: 'A07', reason: 'No write route' }
  ] }), /skipped ids must be unique/);
  assert.throws(() => validateFindings({ ...validData(), skipped: [
    { id: hole.id, reason: 'Already completed' }
  ] }), /skipped id must not also appear in findings/);
});

test('T1 report places skipped evidence after findings before footer without counting it', async t => {
  const s = await setup(t);
  s.data.skipped = [{ id: 'A07', reason: 'No create or update route to submit twice' },
    { id: 'B02', reason: 'No roles beyond normal users' }];
  const r = await s.report();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Attacks: 2 tried   1 blocked   1 got through/);
  assert.match(r.stdout, /Skipped \(not counted\)\n  A07    No create or update route to submit twice\n  B02    No roles beyond normal users/);
  assert.ok(r.stdout.indexOf('Advice') < r.stdout.indexOf('Skipped (not counted)'));
  assert.ok(r.stdout.indexOf('Skipped (not counted)') < r.stdout.indexOf('Copy deleted.'));
});

test('T1 absent skipped list leaves out the skipped block', async t => {
  const s = await setup(t);
  const r = await s.report();
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /Skipped \(not counted\)/);
});

test('T2 report groups one shared file:line, ignoring anchor text and preserving findings', async t => {
  const s = await setup(t);
  s.data.findings = ['A01', 'A03', 'A08'].map((id, index) => ({ ...hole, id,
    severity: 'SMALL', Where: `server.mjs:57${index ? ` -> anchor ${index}:99` : ''}` }));
  s.data.attacks = { tried: 4, blocked: 1, gotThrough: 3 };
  const r = await s.report();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Same cause: A01, A03, A08 point to server\.mjs:57; one fix may close all three\./);
  assert.equal(r.stdout.match(/Same cause:/g)?.length, 1);
  assert.equal(r.stdout.match(/^SMALL  /gm)?.length, 3);
  assert.match(r.stdout, /  Where  server\.mjs:57 -> anchor 1:99/);
  assert.match(r.stdout, /Attacks: 4 tried   1 blocked   3 got through/);
  assert.ok(r.stdout.lastIndexOf('Advice') < r.stdout.indexOf('Same cause:'));
});

test('T2 report omits same cause when files or line numbers differ', async t => {
  const s = await setup(t);
  s.data.findings = ['server.mjs:57', 'server.mjs:58', 'other.mjs:57'].map((Where, index) =>
    ({ ...hole, id: `A0${index + 1}`, Where }));
  s.data.attacks = { tried: 3, blocked: 0, gotThrough: 3 };
  const r = await s.report();
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /Same cause:/);
});

test('T2 each shared location appears once, including groups of two', async t => {
  const s = await setup(t);
  s.data.findings = ['server.mjs:57', 'server.mjs:57 -> first',
    'other.mjs:57', 'other.mjs:57 -> second'].map((Where, index) =>
    ({ ...hole, id: `A0${index + 1}`, Where }));
  s.data.attacks = { tried: 4, blocked: 0, gotThrough: 4 };
  const r = await s.report();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.match(/Same cause:/g)?.length, 2);
  assert.match(r.stdout, /Same cause: A01, A02 point to server\.mjs:57; one fix may close both\./);
  assert.match(r.stdout, /Same cause: A03, A04 point to other\.mjs:57; one fix may close both\./);
});
