import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, unlink, lstat, symlink, mkdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cli, project, newRun } from './helpers.mjs';

function receiptFile(result) {
  assert.equal(result.status, 0, result.stderr);
  const file = /^Receipt file: (.+)$/m.exec(result.stdout)?.[1];
  assert.ok(file, 'cleanup must print only the receipt path, not its encoded body');
  return file;
}
function findings() {
  return { project: 'fixture', round: 1, attacks: { tried: 1, blocked: 1, gotThrough: 0 }, findings: [] };
}
async function setup(t) {
  const source = await project(t);
  const output = await project(t);
  const run = newRun(t, source);
  const result = cli('cleanup', run.id);
  const receipt = receiptFile(result);
  const input = path.join(output, 'findings.json');
  await writeFile(input, JSON.stringify(findings()));
  return { source, output, run, result, receipt, input };
}
test('F2 cleanup stores guarded receipt outside run; report consumes it without an input receipt', async t => {
  const s = await setup(t);
  assert.equal(path.dirname(s.receipt), path.join(await realpath(tmpdir()), 'break-it', 'receipts'));
  assert.equal(path.basename(s.receipt), `${s.run.id}.json`);
  await assert.rejects(lstat(s.run.dir), { code: 'ENOENT' });
  assert.equal(JSON.parse(await readFile(s.receipt, 'utf8')).runId, s.run.id);
  assert.doesNotMatch(s.result.stdout, /base64|Receipt:|"files"|"source"/);
  assert.ok(s.result.stdout.length < 1000);
  const report = cli('report', s.run.id, s.input);
  assert.equal(report.status, 0, report.stderr);
  await assert.rejects(lstat(s.receipt), { code: 'ENOENT' });
  assert.match(report.stdout, /Nothing left behind/);
  assert.notEqual(cli('report', s.run.id, s.input).status, 0);
});
test('F2 large manifests never go to cleanup stdout', async t => {
  const p = await project(t);
  for (let i = 0; i < 3000; i++) await writeFile(path.join(p, `file-${i}.txt`), 'data');
  const run = newRun(t, p);
  const result = cli('cleanup', run.id);
  const file = receiptFile(result);
  assert.ok((await readFile(file)).length > 200000);
  assert.ok(result.stdout.length < 1000);
});
test('F2 receipt symlink swap is refused without reading, changing or deleting its target', async t => {
  const s = await setup(t);
  const decoy = path.join(s.output, 'decoy.json');
  const original = await readFile(s.receipt, 'utf8');
  await writeFile(decoy, original);
  await unlink(s.receipt);
  await symlink(decoy, s.receipt, 'file');
  t.after(() => unlink(s.receipt));
  const report = cli('report', s.run.id, s.input);
  assert.notEqual(report.status, 0);
  assert.match(report.stderr, /receipt.*symbolic link|symbolic link.*receipt/i);
  assert.equal(await readFile(decoy, 'utf8'), original);
  assert.ok((await lstat(s.receipt)).isSymbolicLink());
});
test('F2 failed validation keeps receipt for retry; cleanup can discard an abandoned receipt', async t => {
  const s = await setup(t);
  await writeFile(s.input, JSON.stringify({ ...findings(), attacks: { tried: 0, blocked: 0, gotThrough: 0 } }));
  const refused = cli('report', s.run.id, s.input);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /at least one completed try/i);
  assert.ok((await lstat(s.receipt)).isFile());
  const result = cli('cleanup', s.run.id);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Receipt deleted/);
  await assert.rejects(lstat(s.receipt), { code: 'ENOENT' });
});
test('F2 a receipt directory symlink is refused in an isolated temp base', async t => {
  const isolated = await project(t);
  const outside = await project(t);
  await mkdir(path.join(isolated, 'break-it'));
  await symlink(outside, path.join(isolated, 'break-it', 'receipts'), 'junction');
  const { spawnSync } = await import('node:child_process');
  const { root } = await import('./helpers.mjs');
  await writeFile(path.join(outside, 'input.json'), JSON.stringify(findings()));
  const checked = spawnSync(process.execPath, [path.join(root, 'scripts/break-it.mjs'), 'report',
    '11111111-1111-4111-8111-111111111111', path.join(outside, 'input.json')], {
    env: { ...process.env, TMPDIR: isolated, TMP: isolated, TEMP: isolated }, encoding: 'utf8',
  });
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /receipt.*symbolic link|symbolic link.*receipt/i);
  assert.equal(await readFile(path.join(outside, 'hello.txt'), 'utf8'), 'original');
});
test('F1 and F2 report accepts a real stored seal containing typed link entries', async t => {
  const p = await project(t);
  const output = await project(t);
  await symlink('hello.txt', path.join(p, 'alias'), 'file');
  const run = newRun(t, p);
  receiptFile(cli('cleanup', run.id));
  const input = path.join(output, 'findings.json');
  await writeFile(input, JSON.stringify(findings()));
  const report = cli('report', run.id, input);
  assert.equal(report.status, 0, report.stderr);
  assert.match(report.stdout, /Seal: real project unchanged/);
});
test('F3 handmade receipt in findings cannot stand in for a stored cleanup receipt', async t => {
  const p = await project(t);
  const { randomUUID } = await import('node:crypto');
  const { fingerprint } = await import('../scripts/lib/seal.mjs');
  const id = randomUUID();
  const input = path.join(p, 'findings.json');
  await writeFile(input, JSON.stringify({ ...findings(), receipt: {
    version: 1, runId: id, source: p, files: await fingerprint(p), cleaned: true,
  } }));
  const report = cli('report', id, input);
  assert.notEqual(report.status, 0);
  assert.match(report.stderr, /no cleanup receipt/i);
});
