import { mkdir, readdir, lstat, copyFile, writeFile, readlink, realpath, symlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { checkTarget } from './target.mjs';
import { basePath } from './runs.mjs';
import { fingerprint, verifySeal } from './seal.mjs';
import { removeRun } from './cleanup.mjs';

const skipped = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next']);
function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}
async function copyLink(src, dest, source) {
  const name = path.relative(source, src);
  const folder = name.split(path.sep).slice(0, -1).find(part => skipped.has(part));
  const hint = folder ? ` It is inside ${folder}/; run copy again with --skip to leave that folder out.` : '';
  const text = await readlink(src);
  if (path.isAbsolute(text) || path.win32.parse(text).root) {
    throw new Error(`Refused: absolute symbolic link: ${name}${hint}`);
  }
  const target = path.resolve(path.dirname(src), text);
  if (!isInside(source, target)) throw new Error(`Refused: symbolic link leads outside the project: ${name}${hint}`);
  let resolved;
  // Resolve the link itself: normalizing its text first changes symlink/.. semantics.
  try { resolved = await realpath(src); } catch {
    throw new Error(`Refused: symbolic link target cannot be resolved safely: ${name}`);
  }
  if (!isInside(source, resolved)) throw new Error(`Refused: symbolic link leads outside the project: ${name}${hint}`);
  const kind = (await lstat(resolved)).isDirectory() ? 'dir' : 'file';
  try { await symlink(text, dest, kind); } catch (error) {
    const windows = process.platform === 'win32'
      ? ' Windows link creation may need permissions or Developer Mode; use --skip for dependency/build folders.' : '';
    throw new Error(`Refused: could not recreate symbolic link ${name}: ${error.code}.${windows}`);
  }
}
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
        if (info.isSymbolicLink()) await copyLink(src, dest, source);
        else if (info.isDirectory()) await copy(src, dest);
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
