import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { root } from './helpers.mjs';

test('mask keeps bounded memory for many tiny lines within the stdin cap', () => {
  const result = spawnSync(process.execPath, ['--max-old-space-size=128', path.join(root, 'scripts/break-it.mjs'), 'mask'], {
    input: '\n'.repeat(4 * 1024 * 1024), encoding: 'utf8', timeout: 15000
  });
  assert.equal(result.status, 0, 'bounded input must not exhaust the process heap');
  assert.equal(result.stdout, '');
});
