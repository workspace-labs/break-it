import { rm, lstat } from 'node:fs/promises';
import { runPath, readSeal } from './runs.mjs';
import { verifySeal } from './seal.mjs';

export async function removeRun(id) {
  const dir = await runPath(id);
  // The only recursive deletion boundary. Never accept a caller-supplied path.
  await rm(dir, { recursive: true, force: false });
  try { await lstat(dir); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error('Refused: run folder still exists after cleanup.');
}
export async function cleanupRun(id) {
  const { data } = await readSeal(id);
  let failure;
  try { await verifySeal(data); } catch (error) { failure = error; }
  await removeRun(id);
  if (failure) {
    failure.message += '\nCopy deleted. No report receipt: the seal did not pass.';
    throw failure;
  }
  return { ...data, cleaned: true };
}
