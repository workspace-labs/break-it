import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { root, project, newRun } from './helpers.mjs';

test('a kept bearer echoed inside a cookie attribute stays hidden in CLI headers', async t => {
  const run = newRun(t, await project(t));
  const value = 'synthetic-kept-attribute-private-value';
  const app = http.createServer((req, res) => {
    res.setHeader('Set-Cookie', [`control=okay; Path=/${value}; HttpOnly; SameSite=Lax`,
      'unrelated=a; Path=/; HttpOnly; SameSite=Lax']);
    res.end(JSON.stringify({ customLogin: value }));
  });
  await new Promise((resolve, reject) => { app.once('error', reject); app.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => app.close(resolve)));
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'scripts/break-it.mjs'), 'send', 'POST',
      `http://127.0.0.1:${app.address().port}/login`, '--jar', run.id, '--keep-field', 'customLogin', '--headers']);
    let output = '';
    child.stdout.on('data', bytes => { output += bytes; });
    child.stderr.on('data', bytes => { output += bytes; });
    child.once('error', reject); child.once('close', status => resolve({ status, output }));
  });
  assert.ok(result.status === 0, 'login succeeded');
  assert.ok(!result.output.includes(value), 'kept login is hidden everywhere, including cookie attributes');
  assert.ok(!result.output.includes('synthetic-kept-'), 'short unrelated cookies cannot leave a partial bearer echo');
  assert.ok(/HttpOnly; SameSite=Lax/.test(result.output), 'ordinary flags remain visible');
  assert.ok(/kept login value from "customLogin"/.test(result.output), 'kept notice keeps its required shape');
  assert.ok(result.output.includes('Set-Cookie: unrelated=•••• (1 chars); Path=/; HttpOnly; SameSite=Lax'),
    'unrelated cookie values do not change ordinary flags');
});
