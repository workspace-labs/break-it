import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFindings } from '../scripts/lib/report.mjs';

const finding = { id: 'D04', severity: 'CRITICAL', title: 'App does not recover after a bounded burst',
  Tried: 'Eight localhost requests on the throwaway copy', Saw: 'The final health probe did not answer',
  Where: 'server.mjs:42', Advice: 'Release the shared resource when each request finishes' };
const data = () => ({ project: 'synthetic-shop', round: 1,
  attacks: { tried: 1, blocked: 0, gotThrough: 1 }, findings: [{ ...finding }] });

test('Dxx finding uses the existing ordinary relative file:line report contract', () => {
  assert.doesNotThrow(() => validateFindings(data()));
});

test('Dxx cannot bypass zero-try or zero-line report refusals', () => {
  const zeroLine = data();
  zeroLine.findings[0].Where = 'server.mjs:0';
  assert.throws(() => validateFindings(zeroLine), /Refused: Where needs a relative file:line/);
  const zeroTries = data();
  zeroTries.attacks = { tried: 0, blocked: 0, gotThrough: 0 };
  assert.throws(() => validateFindings(zeroTries), /Refused: report requires at least one completed try/);
});
