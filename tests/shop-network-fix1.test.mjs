import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { root, cli } from './helpers.mjs';
import { copyProject } from '../scripts/lib/copy.mjs';
import { runPath } from '../scripts/lib/runs.mjs';
import { sealRun } from '../scripts/lib/seal.mjs';
import { cleanupRun } from '../scripts/lib/cleanup.mjs';
import { sendRequest } from '../scripts/lib/send.mjs';
import { startShop, stopShop, examplePath } from '../scripts/demo-shop.mjs';

function documentedArgs(command, runId, base, token) {
  return command.trim().split(/\s+/).slice(2).map(value => value
    .replace('<run-id>', runId).replace('http://localhost:4000', base).replace('LOCAL_TEST_SESSION', token));
}

for (const repaired of [false, true]) {
  test(`documented F01 CLI finds half-saved PNG only on ${repaired ? 'repaired round-2' : 'planted round-1'} shop`, async t => {
    const id = await copyProject(examplePath);
    const dir = await runPath(id);
    const copy = path.join(dir, 'copy');
    let app;
    t.after(async () => {
      if (app) await stopShop(app);
      await cleanupRun(id);
      await cleanupRun(id);
      await assert.rejects(access(dir));
    });
    if (repaired) {
      const file = path.join(copy, 'server.mjs');
      const source = await readFile(file, 'utf8');
      assert.ok(source.includes('const keepCompleteUploads = false;'));
      await writeFile(file, source.replace('const keepCompleteUploads = false;', 'const keepCompleteUploads = true;'));
    }
    app = await startShop(copy);
    const base = `http://127.0.0.1:${app.port}`;
    const login = await sendRequest('POST', `${base}/login`, { json: JSON.stringify({ user: 'A', password: 'example-a' }) });
    assert.equal(login.status, 200);
    const token = JSON.parse(login.body).session;
    const reference = await readFile(path.join(root, 'references/attacks-network.md'), 'utf8');
    const section = reference.split('## F01:')[1].split('\n## ')[0];
    const commands = section.split('\n').filter(line => /^\s*node scripts\/break-it\.mjs (?:make|upload|net) /.test(line));
    assert.equal(commands.length, 3, 'run the documented make, baseline upload, and cut commands');
    assert.match(commands[0], /make <run-id> medium-png$/);
    assert.match(commands[1], /--file medium\.png /);
    assert.match(commands[2], /net <run-id> cut POST .*--file medium\.png /);
    for (const command of commands.slice(0, 2)) {
      const result = cli(...documentedArgs(command, id, base, token));
      assert.equal(result.status, 0, result.stderr);
      if (command.includes(' upload ')) assert.match(result.stdout, /^Status: 201\n/);
    }
    const made = await readFile(path.join(dir, 'files', 'medium.png'));
    assert.equal(made.length, 102400);
    const file = path.join(copy, 'uploads', 'medium.png');
    assert.deepEqual(await readFile(file), made, 'complete control was accepted before cutting');
    const cut = cli(...documentedArgs(commands[2], id, base, token));
    assert.equal(cut.status, 0, cut.stderr);
    assert.match(cut.stdout, /^NET cut POST /);
    // The reference's generic /health URL is used word for word. This fixture
    // answers it with 404; its actual catalog health route is checked separately.
    assert.match(cut.stdout, /^probe after: app answered 404$/m);
    assert.equal((await sendRequest('GET', `${base}/catalog`)).status, 200);
    const stored = await readFile(file);
    const read = await sendRequest('GET', `${base}/uploads/medium.png`, { token });
    assert.equal(read.status, 200);
    if (repaired) assert.deepEqual(stored, made, 'cut leaves the complete prior file unchanged');
    else {
      assert.ok(stored.length > 0 && stored.length < made.length, `${stored.length} bytes expose the partial-save hole`);
      assert.deepEqual(stored, made.subarray(0, stored.length));
      assert.equal(read.headers['content-type'], 'image/png');
      assert.ok(read.body.startsWith('\ufffdPNG\r\n'), 'GET serves the PNG signature through UTF-8 display');
      assert.ok(read.body.includes('Padding\0' + 'a'.repeat(1000)), 'GET serves retained PNG content');
    }
    assert.equal(await sealRun(id), 'Seal: real project unchanged');
  });
}

test('Family F demo uses the same medium PNG and never an archive', async () => {
  const demo = await readFile(path.join(root, 'scripts/demo-shop.mjs'), 'utf8');
  const family = demo.split('async function probeNetwork(')[1].split('\nexport async function probeShop(')[0];
  assert.match(family, /makeFile\(runId, 'medium-png'\)/);
  assert.doesNotMatch(family, /zip-bomb|generated archive|const normal\b/);
});
