import { rm, lstat } from 'node:fs/promises';
import { runPath, readSeal } from './runs.mjs';
import { verifySeal } from './seal.mjs';
import { saveReceipt, deleteReceipt } from './receipts.mjs';
import { readLoginShapes } from './login-values.mjs';

export async function removeRun(id) {
  const dir = await runPath(id);
  // The only recursive deletion boundary. Never accept a caller-supplied path.
  await rm(dir, { recursive: true, force: false });
  try { await lstat(dir); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error('Refused: run folder still exists after cleanup.');
}
export async function cleanupRun(id) {
  const dir = await runPath(id, { exists: false });
  let present = true;
  try { await lstat(dir); } catch (error) { if (error.code === 'ENOENT') present = false; else throw error; }
  if (!present) {
    await deleteReceipt(id);
    return { discarded: true };
  }
  let data;
  let failure;
  try {
    ({ data } = await readSeal(id));
    await verifySeal(data);
    const loginShapes = await readLoginShapes(id);
    if (loginShapes) data.loginShapes = loginShapes;
  } catch (error) { failure = error; }
  await removeRun(id);
  if (failure) {
    failure.message += '\nCopy deleted. No report receipt: the seal did not pass.';
    throw failure;
  }
  return { file: await saveReceipt(id, { ...data, cleaned: true }) };
}
