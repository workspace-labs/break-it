import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { root } from './helpers.mjs';

async function instructions() {
  const files = ['SKILL.md', ...(await readdir(path.join(root, 'references'))).map(f => `references/${f}`)];
  return Promise.all(files.map(async file => ({ file, text: await readFile(path.join(root, file), 'utf8') })));
}
test('W7 skill and references contain no banned command words or shell shortcuts', async () => {
  for (const { file, text } of await instructions()) {
    assert.doesNotMatch(text, /\b(?:rm|sudo)\b|curl\s*[^\n]*\|\s*sh\b|git\s+push\s+[^\n]*(?:--force|-f\b)/i, file);
    const commands = text.split('\n').filter(line => /^\s*(?:node|npm|npx|python|bash|sh|git|cd)\s/.test(line));
    for (const command of commands) {
      if (command.trim() === 'git -C "<copy>" log -p --all --no-color | node scripts/break-it.mjs mask') continue;
      assert.match(command.trim(), /^node scripts\/break-it\.mjs (?:check|copy|seal|cleanup|report|send|scan|mask|load|make|upload|net|sessions)\b/, file);
    }
  }
});
test('W2 and W4 reviewer instructions prohibit real startup, repairs and gate moves', async () => {
  const skill = await readFile(path.join(root, 'SKILL.md'), 'utf8');
  assert.match(skill, /only from the copy folder/);
  assert.match(skill, /Never start, attack, or edit\s+the real project/);
  assert.match(skill, /Do not edit code in the real project or the attack copy/);
  assert.match(skill, /Do not make any\s+Backloop\/pipeline status move, Commit, Accept, or Reject/);
  assert.match(skill, /Only the independent reviewer/);
});
test('W6 only send owns network primitives, demo pins literal loopback through send', async () => {
  for (const file of ['scripts/break-it.mjs', ...(await readdir(path.join(root, 'scripts/lib')))
    .filter(f => f !== 'send.mjs').map(f => `scripts/lib/${f}`)]) {
    const source = await readFile(path.join(root, file), 'utf8');
    assert.doesNotMatch(source, /from ['"](?:node:)?(?:https?|net|tls|dgram|dns|child_process)['"]|\bfetch\s*\(/, file);
  }
  const demo = await readFile(path.join(root, 'scripts/demo-shop.mjs'), 'utf8');
  assert.match(demo, /http:\/\/127\.0\.0\.1:\$\{port\}\$\{route\}/);
  assert.match(demo, /sendRequest\(/);
  const sender = await readFile(path.join(root, 'scripts/lib/send.mjs'), 'utf8');
  assert.match(sender, /checkUrl\(input\)/);
  assert.doesNotMatch(sender, /from ['"](?:node:)?(?:tls|dgram|dns|child_process)['"]|\bfetch\s*\(/);
  const skill = await readFile(path.join(root, 'SKILL.md'), 'utf8');
  assert.match(skill, /do not follow redirects or contact other services/);
  assert.match(skill, /If local-only operation cannot be established, stop/);
});

test('W10 every raw connection is in send after URL validation and literal loopback pinning', async () => {
  const sender = await readFile(path.join(root, 'scripts/lib/send.mjs'), 'utf8');
  assert.match(sender, /import net from 'node:net'/);
  const raw = sender.slice(sender.indexOf('export function sendBadConnection('));
  assert.match(raw, /const url = validateRequest\(method, input,/);
  assert.match(raw, /url\.protocol !== 'http:'/);
  assert.match(raw, /const hostname = url\.hostname === '\[::1\]' \? '::1' : '127\.0\.0\.1';/);
  assert.match(raw, /net\.connect\(\{ host: hostname, port: Number\(url\.port \|\| 80\) \}\)/);
  assert.equal([...sender.matchAll(/net\.connect\s*\(/g)].length, 1, 'no second or unguarded raw connection');
  assert.ok(raw.indexOf('validateRequest(') < raw.indexOf('net.connect('));
  assert.ok(raw.indexOf('const hostname =') < raw.indexOf('net.connect('));
});
