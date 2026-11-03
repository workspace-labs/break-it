import { readFile } from 'node:fs/promises';
import { checkTarget } from './lib/target.mjs';
import { copyProject } from './lib/copy.mjs';
import { sealRun } from './lib/seal.mjs';
import { cleanupRun } from './lib/cleanup.mjs';

async function main(args) {
  const [command, first, ...rest] = args;
  if (command === 'check' && first && (rest.length === 0 || rest.length === 2 && rest[0] === '--url')) {
    await checkTarget(first, rest[1]);
    console.log('Ready: local project folder checked. Reviewer must confirm ownership.');
  } else if (command === 'copy' && first && (rest.length === 0 || rest.length === 1 && rest[0] === '--skip')) {
    console.log(await copyProject(first, rest[0] === '--skip'));
  } else if (command === 'seal' && first && rest.length === 0) {
    console.log(await sealRun(first));
  } else if (command === 'cleanup' && first && rest.length === 0) {
    const receipt = await cleanupRun(first);
    console.log('Copy deleted. Nothing left behind.');
    console.log('Receipt: ' + Buffer.from(JSON.stringify(receipt)).toString('base64url'));
  } else if (command === 'report' && first && rest.length === 1) {
    const { reportRun } = await import('./lib/report.mjs');
    console.log(await reportRun(first, JSON.parse(await readFile(rest[0], 'utf8'))));
  } else {
    throw new Error('Usage: node scripts/break-it.mjs check <project> [--url URL] | copy <project> [--skip] | seal <run-id> | cleanup <run-id> | report <run-id> <findings.json>');
  }
}
main(process.argv.slice(2)).catch(error => {
  console.error(error.message.startsWith('Refused:') || error.exitCode === 3 ? error.message : `Refused: ${error.message}`);
  process.exitCode = error.exitCode || 1;
});
