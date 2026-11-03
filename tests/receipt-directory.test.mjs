import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { project, root } from './helpers.mjs';

async function isolatedRun(t) {
  const source = await project(t);
  const temporary = await project(t);
  const base = path.join(temporary, 'break-it');
  const input = path.join(temporary, 'findings.json');
  await writeFile(input, JSON.stringify({ project: 'fixture', round: 1,
    attacks: { tried: 1, blocked: 1, gotThrough: 0 }, findings: [] }));
  const cli = (...args) => spawnSync(process.execPath, [path.join(root, 'scripts/break-it.mjs'), ...args], {
    encoding: 'utf8', timeout: 15000,
    env: { ...process.env, TMPDIR: temporary, TMP: temporary, TEMP: temporary },
  });
  const succeeds = (...args) => {
    const result = cli(...args);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const create = () => {
    const id = succeeds('copy', source);
    succeeds('seal', id);
    succeeds('cleanup', id);
    return id;
  };
  return { base, receipts: path.join(base, 'receipts'), input, cli, succeeds, create };
}

test('N2 last report removes empty receipts folder while preserving the base', async t => {
  const s = await isolatedRun(t);
  const id = s.create();
  s.succeeds('report', id, s.input);
  await assert.rejects(lstat(s.receipts), { code: 'ENOENT' });
  assert.ok((await lstat(s.base)).isDirectory());
  // Missing-receipt lookups and teardown must not recreate the empty directory.
  assert.notEqual(s.cli('report', id, s.input).status, 0);
  assert.notEqual(s.cli('cleanup', id).status, 0);
  await assert.rejects(lstat(s.receipts), { code: 'ENOENT' });
});

test('N2 one report preserves another run’s waiting receipt unchanged', async t => {
  const s = await isolatedRun(t);
  const first = s.create();
  const second = s.create();
  const pending = path.join(s.receipts, `${second}.json`);
  const original = await readFile(pending, 'utf8');
  s.succeeds('report', first, s.input);
  assert.ok((await lstat(s.receipts)).isDirectory());
  assert.equal(await readFile(pending, 'utf8'), original);
  s.succeeds('report', second, s.input);
  await assert.rejects(lstat(s.receipts), { code: 'ENOENT' });
  assert.ok((await lstat(s.base)).isDirectory());
});

test('N2 cleanup discard removes the final empty receipts folder', async t => {
  const s = await isolatedRun(t);
  const id = s.create();
  assert.match(s.succeeds('cleanup', id), /Receipt deleted\. Nothing left behind\./);
  await assert.rejects(lstat(s.receipts), { code: 'ENOENT' });
  assert.ok((await lstat(s.base)).isDirectory());
});

test('N2 a receipt save tolerates the empty directory disappearing before creation', async t => {
  const s = await isolatedRun(t);
  const id = '11111111-1111-4111-8111-111111111111';
  // Reproduce another run removing the empty folder between validation and open.
  const script = `
    import fs from 'node:fs/promises';
    import path from 'node:path';
    import { syncBuiltinESMExports } from 'node:module';
    const original = fs.open;
    let removed = false;
    fs.open = async (file, ...args) => {
      if (!removed && path.basename(file) === ${JSON.stringify(`${id}.json`)} && path.basename(path.dirname(file)) === 'receipts') {
        removed = true;
        await fs.rmdir(path.dirname(file));
      }
      return original(file, ...args);
    };
    syncBuiltinESMExports();
    const { saveReceipt } = await import(${JSON.stringify(pathToFileURL(path.join(root, 'scripts/lib/receipts.mjs')).href)});
    await saveReceipt(${JSON.stringify(id)}, { runId: ${JSON.stringify(id)} });
    if (!removed) throw new Error('The directory-removal race was not exercised');
  `;
  const temporary = path.dirname(s.base);
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8', env: { ...process.env, TMPDIR: temporary, TMP: temporary, TEMP: temporary },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(await readFile(path.join(s.receipts, `${id}.json`), 'utf8')), { runId: id });
  s.succeeds('cleanup', id);
});
