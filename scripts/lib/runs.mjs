import { lstat, realpath, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export function validId(id) {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id)) {
    throw new Error('Refused: run id must be the id printed by copy, never a path.');
  }
  return id;
}
export async function basePath() {
  const temp = await realpath(tmpdir());
  const base = path.join(temp, 'break-it');
  await mkdir(base, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  if ((await lstat(base)).isSymbolicLink() || await realpath(base) !== base) {
    throw new Error('Refused: temporary run base is redirected by a symbolic link.');
  }
  if (!(await lstat(base)).isDirectory()) throw new Error('Refused: run base is not a folder.');
  return base;
}
export async function runPath(id, { exists = true } = {}) {
  validId(id);
  const base = await basePath();
  const dir = path.join(base, id);
  let info;
  try { info = await lstat(dir); } catch (e) {
    if (!exists && e.code === 'ENOENT') return dir;
    throw e;
  }
  const resolved = await realpath(dir);
  if (info.isSymbolicLink() || !info.isDirectory() || resolved !== dir || path.dirname(resolved) !== base) {
    throw new Error('Refused: run folder escapes the temporary break-it base.');
  }
  return dir;
}
export async function readSeal(id) {
  const dir = await runPath(id);
  const file = path.join(dir, 'seal.json');
  if ((await lstat(file)).isSymbolicLink()) throw new Error('Refused: seal is a symbolic link.');
  const data = JSON.parse(await readFile(file, 'utf8'));
  if (data.version !== 1 || data.runId !== id || typeof data.source !== 'string' || !data.files) {
    throw new Error('Refused: invalid seal metadata.');
  }
  return { dir, data };
}
