import test from 'node:test';
import assert from 'node:assert/strict';
import { formatLoad } from '../scripts/lib/load.mjs';

test('load summary has four bounded lines and excludes response/error bodies', () => {
  const output = formatLoad({ method: 'M'.repeat(4000), url: `http://localhost/?q=${'x'.repeat(4000)}`,
    sent: 3, completed: 2, failed: 1,
    statuses: { '2xx': 1, '4xx': 0, '5xx': 1, 'other/none': 1 },
    latency: { min: 1, median: 2, p95: 3, max: 3 }, afterBurst: { status: 503 },
    body: 'PRIVATE_RESPONSE_BODY', error: 'PRIVATE_ERROR_BODY' });
  assert.equal(output.split('\n').length, 4);
  assert.ok(output.length < 1000);
  assert.doesNotMatch(output, /PRIVATE/);
  assert.match(output, /after burst: app answered 503$/);
});
