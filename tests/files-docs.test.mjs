import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { root } from './helpers.mjs';
import path from 'node:path';

const read = file => readFile(path.join(root, file), 'utf8');

test('Family E instructions cover every try and stop uploads that could write outside the copy', async () => {
  const text = await read('references/attacks-files.md');
  for (const id of ['E01', 'E02', 'E03', 'E04', 'E05', 'E06', 'E07', 'E08']) {
    const section = text.split(new RegExp(`## ${id}:`))[1]?.split('\n## ')[0];
    assert.ok(section, id);
    for (const label of ['Send', 'BLOCKED', 'HOLE', 'Severity']) assert.ok(section.includes(`**${label}:**`), `${id} ${label}`);
  }
  assert.match(text, /Before any E-try/);
  assert.match(text, /STOP the family/);
  assert.match(text, /cloud bucket/);
  assert.match(text, /Safe control/);
  assert.match(text, /break-it-escape-/);
  assert.match(text, /send GET[^\n]+--headers/);
});

test('E08 documents bounded copy-only download traversal and content-free findings', async () => {
  const text = await read('references/attacks-files.md');
  const section = text.split('## E08: Reads outside the upload folder')[1]?.split('\n## ')[0];
  assert.ok(section, 'E08 instructions');
  assert.match(text, /\[E08: Reads outside the upload folder\]\(#e08-reads-outside-the-upload-folder\)/);
  for (const spelling of ['..%2F', '%2E%2E%2F']) assert.ok(section.includes(spelling), spelling);
  assert.match(section, /send GET/);
  assert.match(section, /one level above/i);
  assert.match(section, /inside the copy/i);
  assert.match(section, /STOP/);
  assert.match(section, /Never[^.]*system files/i);
  assert.match(section, /4xx\/404/);
  assert.match(section, /no file content/);
  assert.match(section, /\*\*Severity:\*\* CRITICAL/);
  assert.match(section, /only the status and (?:the )?file name/);
  assert.match(section, /never (?:the )?content/);
  assert.match(await read('references/report-format.md'), /E08 \(reading outside the upload folder\)/);
  const part2 = (await read('SKILL.md')).split('## Part 2: Attack the copy')[1].split('## Part 3:')[0];
  assert.match(part2, /E08/);
});

test('Family E documents only generated inputs and all fixed names with capped sizes', async () => {
  const text = await read('references/attacks-files.md');
  for (const kind of ['normal-png', 'big', 'fake-image', 'html-script', 'svg-script', 'zip-bomb', 'empty', 'truncated-png']) {
    assert.ok(text.includes(`\`${kind}\``), kind);
  }
  for (const preset of ['traversal', 'null-byte', 'long', 'arabic', 'emoji', 'reserved']) {
    assert.ok(text.includes(`\`${preset}\``), preset);
  }
  assert.match(text, /50 MiB/);
  assert.match(text, /100 MiB/);
  assert.match(text, /51 MiB/);
  assert.match(text, /never\s+nested/);
});

test('Family E release versions agree across the skill, package and current report reference', async () => {
  assert.equal(JSON.parse(await read('package.json')).version, '0.5.0');
  assert.match(await read('SKILL.md'), /^# Break-it 0\.5\.0$/m);
  assert.match(await read('README.md'), /^# Break-it · 0\.5\.0$/m);
  assert.match(await read('references/report-format.md'), /version 0\.5\.0/);
  assert.match(await read('CHANGELOG.md'), /## \[0\.5\.0\] - 2026-11-13/);
});
