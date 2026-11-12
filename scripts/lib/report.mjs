import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { runPath, validId } from './runs.mjs';
import { verifySeal } from './seal.mjs';
import { loadReceipt, deleteReceipt } from './receipts.mjs';
import { findSecrets, findNestedReview, safeLabel } from './leaks.mjs';

function guardSecrets(value, id) {
  if (typeof value === 'string' && (findSecrets(value).length || findNestedReview(value).length)) {
    throw new Error(`Refused: finding ${safeLabel(id)} contains an unmasked secret; use the masked form.`);
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      guardSecrets(key, id);
      guardSecrets(item, id);
    }
  }
}

function text(value, field) {
  if (typeof value !== 'string' || !value.trim() || /[\r\n\x00-\x1f\x7f]/.test(value)) {
    throw new Error(`Refused: ${field} must be nonempty, single-line evidence.`);
  }
}
export function validateFindings(data) {
  for (const finding of Array.isArray(data?.findings) ? data.findings : []) {
    guardSecrets(finding, typeof finding?.id === 'string' ? finding.id : 'unknown');
  }
  for (const skipped of Array.isArray(data?.skipped) ? data.skipped : []) {
    guardSecrets(skipped, typeof skipped?.id === 'string' ? skipped.id : 'skipped');
  }
  guardSecrets(data?.project, 'project');
  text(data.project, 'project');
  if (!Number.isSafeInteger(data.round) || data.round < 1) throw new Error('Refused: round must be a positive integer.');
  if (!Array.isArray(data.findings)) throw new Error('Refused: findings must be a list.');
  const counts = data.attacks;
  if (counts?.tried === 0) throw new Error('Refused: report requires at least one completed try.');
  if (!counts || !['tried', 'blocked', 'gotThrough'].every(k => Number.isSafeInteger(counts[k]) && counts[k] >= 0) ||
      counts.tried !== counts.blocked + counts.gotThrough || counts.gotThrough !== data.findings.length) {
    throw new Error('Refused: attack counts must balance; each got-through try needs one finding.');
  }
  const ids = new Set();
  for (const finding of data.findings) {
    for (const key of ['id', 'title', 'Tried', 'Saw', 'Where', 'Advice']) text(finding[key], key);
    if (ids.has(finding.id)) throw new Error('Refused: finding ids must be unique.');
    ids.add(finding.id);
    if (!['CRITICAL', 'SMALL'].includes(finding.severity)) throw new Error('Refused: severity must be CRITICAL or SMALL.');
    const location = /^(.+):([1-9]\d*)(?: -> .+)?$/.exec(finding.Where);
    if (!location || /^[\\/]|^[A-Za-z]:/.test(location[1]) || location[1].split(/[\\/]/).includes('..')) {
      throw new Error('Refused: Where needs a relative file:line, optionally followed by -> anchor text.');
    }
  }
  if (data.skipped !== undefined) {
    if (!Array.isArray(data.skipped)) throw new Error('Refused: skipped must be a list.');
    const skippedIds = new Set();
    for (const skip of data.skipped) {
      text(skip?.id, 'skipped id');
      text(skip?.reason, 'skipped reason');
      if (skippedIds.has(skip.id)) throw new Error('Refused: skipped ids must be unique.');
      if (ids.has(skip.id)) throw new Error('Refused: skipped id must not also appear in findings.');
      skippedIds.add(skip.id);
    }
  }
}
function validateReceipt(receipt, id) {
  const entryValid = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ||
    value && typeof value === 'object' && value.type === 'symlink' && typeof value.text === 'string';
  if (!receipt || receipt.version !== 1 || receipt.runId !== id || receipt.cleaned !== true ||
      typeof receipt.source !== 'string' || !path.isAbsolute(receipt.source) ||
      !receipt.files || typeof receipt.files !== 'object' || Array.isArray(receipt.files) ||
      !Object.values(receipt.files).every(entryValid)) {
    throw new Error('Refused: report needs the receipt returned by cleanup after a passing seal.');
  }
}
export async function reportRun(id, data) {
  validId(id);
  validateFindings(data);
  const dir = await runPath(id, { exists: false });
  let present = true;
  try { await lstat(dir); } catch (error) { if (error.code === 'ENOENT') present = false; else throw error; }
  if (present) throw new Error('Refused: run cleanup before writing the report.');
  const { receipt, identity } = await loadReceipt(id);
  validateReceipt(receipt, id);
  await verifySeal(receipt);
  const header = data.round === 1 ? `BREAK-IT REPORT ${data.project} · version 0.5.0` : `ROUND ${data.round} ${data.project}`;
  const { tried, blocked, gotThrough } = data.attacks;
  const lines = [header, 'Seal: real project unchanged', `Attacks: ${tried} tried   ${blocked} blocked   ${gotThrough} got through`];
  const sorted = [...data.findings].sort((a, b) => Number(b.severity === 'CRITICAL') - Number(a.severity === 'CRITICAL'));
  for (const finding of sorted) {
    lines.push('', `${finding.severity}  ${finding.title}`);
    for (const label of ['Tried', 'Saw', 'Where', 'Advice']) lines.push(`  ${label.padEnd(6)} ${finding[label]}`);
  }
  const causes = new Map();
  for (const finding of sorted) {
    const location = finding.Where.split(' -> ', 1)[0];
    if (!causes.has(location)) causes.set(location, []);
    causes.get(location).push(finding.id);
  }
  let firstCause = true;
  for (const [location, ids] of causes) {
    if (ids.length < 2) continue;
    if (firstCause) { lines.push(''); firstCause = false; }
    const shared = ids.length === 2 ? 'both' : `all ${ids.length === 3 ? 'three' : ids.length}`;
    lines.push(`Same cause: ${ids.join(', ')} point to ${location}; one fix may close ${shared}.`);
  }
  if (data.round > 1) {
    const critical = sorted.filter(f => f.severity === 'CRITICAL').length;
    const result = sorted.length === 0 ? "Ready for the owner's look" : 'Holes remain; send advice to the builder';
    lines.push(`Critical holes: ${critical}   ->   ${result}`);
  }
  if (data.skipped !== undefined) {
    lines.push('', 'Skipped (not counted)');
    const width = Math.max(3, ...data.skipped.map(skip => skip.id.length));
    for (const skip of data.skipped) lines.push(`  ${skip.id.padEnd(width)}    ${skip.reason}`);
  }
  lines.push('', 'Copy deleted. Nothing left behind. Break-it changed no code.');
  await deleteReceipt(id, identity);
  return lines.join('\n');
}
