import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export function cli(...args) {
  return spawnSync(process.execPath, [path.join(root, 'scripts/break-it.mjs'), ...args], {
    encoding: 'utf8', timeout: 15000,
  });
}
export async function project(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'break-it-test-'));
  await writeFile(path.join(dir, 'hello.txt'), 'original');
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
export function newRun(t, dir, ...options) {
  const result = cli('copy', dir, ...options);
  if (result.status !== 0) throw new Error(result.stderr);
  const id = result.stdout.trim();
  t.after(() => cli('cleanup', id));
  return { id, dir: path.join(tmpdir(), 'break-it', id), copy: path.join(tmpdir(), 'break-it', id, 'copy') };
}
export function receiptFileFrom(result) {
  const file = result.stdout.match(/^Receipt file: (.+)$/m)?.[1];
  if (!file) throw new Error(result.stderr || result.stdout);
  return file;
}
