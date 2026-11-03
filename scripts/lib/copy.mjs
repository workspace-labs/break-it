import { mkdir, readdir, lstat, copyFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { checkTarget } from './target.mjs';
import { basePath } from './runs.mjs';
import { fingerprint, verifySeal } from './seal.mjs';
import { removeRun } from './cleanup.mjs';

const skipped = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next']);
export async function copyProject(input, skip = false) {
  const source = await checkTarget(input);
  const base = await basePath();
  const relative = path.relative(source, base);
  if (relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)) ||
      source.startsWith(base + path.sep)) throw new Error('Refused: project overlaps the temporary run base.');
  const files = await fingerprint(source);
  const id = randomUUID();
  const dir = path.join(base, id);
  await mkdir(dir, { mode: 0o700 });
  const data = { version: 1, runId: id, source, files };
  try {
    await writeFile(path.join(dir, 'seal.json'), JSON.stringify(data), { flag: 'wx', mode: 0o600 });
    async function copy(from, to) {
      await mkdir(to);
      for (const name of await readdir(from)) {
        if (skip && skipped.has(name)) continue;
        const src = path.join(from, name);
        const dest = path.join(to, name);
        const info = await lstat(src);
        if (info.isSymbolicLink()) throw new Error(`Refused: symbolic link in project: ${name}`);
        if (info.isDirectory()) await copy(src, dest);
        else if (info.isFile()) await copyFile(src, dest);
        else throw new Error(`Refused: special file in project: ${name}`);
      }
    }
    await copy(source, path.join(dir, 'copy'));
    await verifySeal(data);
  } catch (error) {
    await removeRun(id);
    throw error;
  }
  return id;
}
