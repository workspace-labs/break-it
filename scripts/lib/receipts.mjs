import { mkdir, lstat, realpath, open, unlink, rmdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { basePath, validId } from './runs.mjs';

async function receiptPath(id, optional = false) {
  validId(id);
  const base = await basePath();
  const dir = path.join(base, 'receipts');
  // Only saves create the folder; a failed lookup must not leave it behind again.
  if (optional) await mkdir(dir, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  let info;
  try { info = await lstat(dir); } catch (error) {
    if (optional && error.code === 'ENOENT') throw error;
    if (error.code === 'ENOENT') throw new Error('Refused: no cleanup receipt for this run; run cleanup first.');
    throw error;
  }
  if (info.isSymbolicLink() || !info.isDirectory() || await realpath(dir) !== dir) {
    throw new Error('Refused: receipt directory is not a plain folder or is redirected by a symbolic link.');
  }
  const file = path.join(dir, `${id}.json`);
  let stat;
  try { stat = await lstat(file); } catch (error) {
    if (optional && error.code === 'ENOENT') return { file };
    if (error.code === 'ENOENT') throw new Error('Refused: no cleanup receipt for this run; run cleanup first.');
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile() || await realpath(file) !== file) {
    throw new Error('Refused: receipt file is not a regular file or is a symbolic link.');
  }
  return { file, stat };
}
export async function saveReceipt(id, receipt) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { file, stat } = await receiptPath(id, true);
      if (stat) throw new Error('Refused: a receipt already exists for this run; it will not be overwritten.');
      // Exclusive creation also refuses a link planted after the path check.
      const handle = await open(file, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(receipt)); } finally { await handle.close(); }
      return file;
    } catch (error) {
      // Another report can remove the empty folder before this save opens its file.
      if (error.code !== 'ENOENT' || attempt === 2) throw error;
    }
  }
}
export async function loadReceipt(id) {
  const { file, stat } = await receiptPath(id);
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino) {
      throw new Error('Refused: receipt changed while it was opened.');
    }
    return { receipt: JSON.parse(await handle.readFile('utf8')), identity: opened };
  } finally { await handle.close(); }
}
export async function deleteReceipt(id, identity) {
  const { file, stat } = await receiptPath(id);
  if (identity && (identity.dev !== stat.dev || identity.ino !== stat.ino)) {
    throw new Error('Refused: receipt changed before removal.');
  }
  // Unlink only this validated regular file, never recursively delete the base.
  await unlink(file);
  // Non-recursive and best-effort: another receipt or a busy folder must survive.
  await rmdir(path.dirname(file)).catch(() => {});
}
