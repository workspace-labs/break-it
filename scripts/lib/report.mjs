import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { runPath, validId } from './runs.mjs';
import { verifySeal } from './seal.mjs';

function text(value, field) {
  if (typeof value !== 'string' || !value.trim() || /[\r\n\x00-\x1f\x7f]/.test(value)) {
    throw new Error(`Refused: ${field} must be nonempty, single-line evidence.`);
  }
}
export function validateFindings(data) {
  text(data.project, 'project');
  if (!Number.isSafeInteger(data.round) || data.round < 1) throw new Error('Refused: round must be a positive integer.');
  if (!Array.isArray(data.findings)) throw new Error('Refused: findings must be a list.');
  const counts = data.attacks;
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
}
function validateReceipt(receipt, id) {
  if (!receipt || receipt.version !== 1 || receipt.runId !== id || receipt.cleaned !== true ||
      typeof receipt.source !== 'string' || !path.isAbsolute(receipt.source) ||
      !receipt.files || typeof receipt.files !== 'object' || Array.isArray(receipt.files) ||
      !Object.values(receipt.files).every(v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v))) {
    throw new Error('Refused: report needs the receipt returned by cleanup after a passing seal.');
  }
}
export async function reportRun(id, data) {
  validId(id);
  validateFindings(data);
  validateReceipt(data.receipt, id);
  const dir = await runPath(id, { exists: false });
  let present = true;
  try { await lstat(dir); } catch (error) { if (error.code === 'ENOENT') present = false; else throw error; }
  if (present) throw new Error('Refused: run cleanup before writing the report.');
  await verifySeal(data.receipt);
  const header = data.round === 1 ? `BREAK-IT REPORT ${data.project} · version 0.1.0` : `ROUND ${data.round} ${data.project}`;
  const { tried, blocked, gotThrough } = data.attacks;
  const lines = [header, 'Seal: real project unchanged', `Attacks: ${tried} tried   ${blocked} blocked   ${gotThrough} got through`];
  const sorted = [...data.findings].sort((a, b) => Number(b.severity === 'CRITICAL') - Number(a.severity === 'CRITICAL'));
  for (const finding of sorted) {
    lines.push('', `${finding.severity}  ${finding.title}`);
    for (const label of ['Tried', 'Saw', 'Where', 'Advice']) lines.push(`  ${label} ${finding[label]}`);
  }
  if (data.round > 1) {
    const critical = sorted.filter(f => f.severity === 'CRITICAL').length;
    const result = sorted.length === 0 ? "Ready for the owner's look" : 'Holes remain; send advice to the builder';
    lines.push(`Critical holes: ${critical}   ->   ${result}`);
  }
  lines.push('', 'Copy deleted. Nothing left behind. Break-it changed no code.');
  return lines.join('\n');
}
