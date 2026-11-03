import { readdir, lstat, readFile, readlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { readSeal } from './runs.mjs';
import { checkTarget } from './target.mjs';
import { safeLabel } from './leaks.mjs';

export async function fingerprint(root) {
  const files = Object.create(null);
  async function walk(dir, prefix = '') {
    for (const name of (await readdir(dir)).sort()) {
      const absolute = path.join(dir, name);
      const relative = prefix + name;
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) files[relative] = { type: 'symlink', text: await readlink(absolute) };
      else if (info.isDirectory()) await walk(absolute, relative + '/');
      else if (info.isFile()) files[relative] = createHash('sha256').update(await readFile(absolute)).digest('hex');
      else throw new Error(`Refused: special file in project: ${safeLabel(relative)}`);
    }
  }
  await walk(root);
  return files;
}
export function differences(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().flatMap(file => {
    if (JSON.stringify(before[file]) === JSON.stringify(after[file])) return [];
    return [`${!Object.hasOwn(before, file) ? 'added' : !Object.hasOwn(after, file) ? 'removed' : 'changed'}: ${safeLabel(file)}`];
  });
}
export async function verifySeal(data) {
  let current;
  try {
    if (await checkTarget(data.source) !== data.source) throw new Error('project path redirected');
    current = await fingerprint(data.source);
  } catch (error) {
    const failed = new Error(`REAL PROJECT CHANGED — could not verify: ${safeLabel(error.message)}`);
    failed.exitCode = 3;
    throw failed;
  }
  const changed = differences(data.files, current);
  if (changed.length) {
    const error = new Error(`REAL PROJECT CHANGED\n${changed.join('\n')}`);
    error.exitCode = 3;
    throw error;
  }
  return 'Seal: real project unchanged';
}
export async function sealRun(id) {
  const { data } = await readSeal(id);
  return verifySeal(data);
}
