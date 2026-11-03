import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { cli, project, newRun } from './helpers.mjs';

const MiB = 1024 * 1024;
function textWith(total, entries) {
  const data = Buffer.alloc(total, ' ');
  for (const [offset, text] of entries) Buffer.from(text).copy(data, offset);
  return data;
}
async function scan(t, files) {
  const source = await project(t);
  for (const [name, text] of Object.entries(files)) await writeFile(path.join(source, name), text);
  const run = newRun(t, source);
  const result = cli('scan', run.id);
  assert.equal(result.status, 0, 'scan succeeds');
  return result.stdout + result.stderr;
}
function hits(output, file) {
  return output.split('\n').filter(line => line.startsWith(`${file}:`));
}
function absent(output, ...values) {
  for (const value of values) assert.ok(!output.includes(value), 'whole synthetic value absent');
}

test('F2 scan finds a secret in the middle of a five MiB bundle with the correct line', async t => {
  const value = 'window-middle-SYNTHETIC-0123456789';
  const output = await scan(t, {
    'bundle.js': textWith(5 * MiB, [[0, '\n\n'], [1.5 * MiB, `token = "${value}";`]])
  });
  absent(output, value);
  assert.equal(hits(output, 'bundle.js').length, 1);
  assert.match(output, /bundle\.js:3  generic token  win…6789 \(34 chars\)/);
});

test('F2 scan finds crossing and overlapping window hits once without partial masked values', async t => {
  const across = 'boundary-SYNTHETIC-0123456789-abcdefghijklmnopqrstuvwxyz';
  const overlap = `ghp_${'Q'.repeat(36)}`;
  const output = await scan(t, {
    'boundary.js': textWith(2 * MiB, [
      [0, '\n\n\n'], [MiB - 1000, ` ${overlap} `], [MiB - 25, `api_key = "${across}";`]
    ])
  });
  absent(output, across, overlap);
  const found = hits(output, 'boundary.js');
  assert.equal(found.length, 2);
  assert.ok(found.every(line => line.startsWith('boundary.js:4  ')));
  assert.equal(found.filter(line => line.includes('generic api_key')).length, 1);
  assert.ok(found.some(line => line.includes(`(${across.length} chars)`)), 'full crossing value length');
});

test('F2 scan preserves provider tokens across a window boundary', async t => {
  const value = `sk-${'R'.repeat(80)}`;
  const output = await scan(t, {
    'provider.js': textWith(2 * MiB, [[0, '\n'], [MiB - 30, ` ${value} `]])
  });
  absent(output, value);
  assert.equal(hits(output, 'provider.js').length, 1);
  assert.match(output, /provider\.js:2  OpenAI sk  sk-…RRRR \(83 chars\)/);
});

test('F2 scan does not treat a UTF8 character split between windows as binary', async t => {
  const value = 'utf8-window-SYNTHETIC-0123456789';
  const output = await scan(t, {
    'utf8.log': ' '.repeat(MiB - 1) + `😀\nsecret = "${value}";\n`
  });
  absent(output, value);
  assert.equal(hits(output, 'utf8.log').length, 1);
  assert.match(output, /utf8\.log:2  generic secret/);
});

test('F2 scan preserves a complete private-key block across a window boundary', async t => {
  const body = 'SYNTHETIC-BLOCK-BODY-'.repeat(60);
  const block = `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`;
  const output = await scan(t, {
    'key.pem': textWith(2 * MiB, [[0, '\n\n'], [MiB - 300, block]])
  });
  absent(output, block, body);
  assert.equal(hits(output, 'key.pem').length, 1);
  assert.match(output, /key\.pem:3  private key/);
  assert.ok(output.includes(`(${block.length} chars)`), 'entire block length is used');
});

test('F2 scan accepts exactly twenty MiB and skips twenty-five MiB with the exact size note', async t => {
  const accepted = 'exact-limit-SYNTHETIC-0123456789';
  const skipped = 'oversized-SYNTHETIC-0123456789';
  const assignment = `token = "${accepted}";`;
  const output = await scan(t, {
    'exact.txt': textWith(20 * MiB, [[20 * MiB - assignment.length, assignment]]),
    'large.txt': textWith(25 * MiB, [[0, `password = "${skipped}";`]])
  });
  absent(output, accepted, skipped);
  assert.equal(hits(output, 'exact.txt').length, 1);
  assert.equal(hits(output, 'large.txt').length, 0);
  assert.match(output, /^Skipped for size \(over 20 MiB\): large\.txt$/m);
});

test('F2 scan discards a file when a later window contains binary bytes', async t => {
  const value = 'binary-window-SYNTHETIC-0123456789';
  const output = await scan(t, {
    'later.bin': textWith(2 * MiB, [[0, `token = "${value}";`], [MiB + 20, '\x00']])
  });
  absent(output, value);
  assert.equal(hits(output, 'later.bin').length, 0);
  assert.match(output, /No secrets found/);
});

test('F2 scan names an unfinished match beyond the overlap without publishing partial evidence', async t => {
  const value = 'long-boundary-SYNTHETIC-' + 'L'.repeat(7000);
  const output = await scan(t, {
    'long.txt': textWith(2 * MiB, [[MiB - 5000, `token = "${value}";`]])
  });
  absent(output, value);
  assert.equal(hits(output, 'long.txt').length, 0);
  assert.match(output, /^Skipped long boundary-spanning match \(over 4 KiB overlap\): long\.txt$/m);
});

test('F2 scan handles split field names, unquoted values and a closing quote at the window edge', async t => {
  const named = 'split-name-SYNTHETIC-0123456789';
  const unquoted = 'unquoted-SYNTHETIC-0123456789-abcdefghijklmnopqrstuvwxyz';
  const closed = 'closed-edge-SYNTHETIC-0123456789';
  const assignment = `token="${closed}"`;
  const output = await scan(t, {
    'name.env': textWith(2 * MiB, [[0, '\n\n'], [MiB - 8, `accessToken="${named}"`]]),
    'value.env': textWith(2 * MiB, [[0, '\n\n\n'], [MiB - 25, `DB_PASSWORD=${unquoted} # local fixture`]]),
    'closed.env': textWith(2 * MiB, [[0, '\n'], [MiB - assignment.length, assignment]])
  });
  absent(output, named, unquoted, closed);
  for (const file of ['name.env', 'value.env', 'closed.env']) assert.equal(hits(output, file).length, 1);
  assert.match(output, /name\.env:3  generic accesstoken/);
  assert.match(output, /value\.env:4  generic db_password/);
  assert.match(output, /closed\.env:2  generic token/);
  assert.ok(output.includes(`(${unquoted.length} chars)`), 'unquoted crossing value is complete');
});

test('F2 overlap does not rediscover a provider token inside an already reported assignment', async t => {
  const provider = `ghp_${'T'.repeat(36)}`;
  const value = 'synthetic-' + 'A'.repeat(3000) + ` ${provider} ` + 'Z'.repeat(1080);
  const output = await scan(t, {
    'merged.txt': textWith(2 * MiB, [[MiB - 4230, `token = "${value}";`]])
  });
  absent(output, value, provider);
  assert.equal(hits(output, 'merged.txt').length, 1);
  assert.match(output, /merged\.txt:1  generic token/);
  assert.ok(output.includes(`(${value.length} chars)`), 'one complete merged value is reported');
});
