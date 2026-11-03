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
  assert.match(r.stdout, /^BREAK-IT REPORT shop-app · version 0\.1\.0\nSeal: real project unchanged\nAttacks: 3 tried   1 blocked   2 got through/);
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
