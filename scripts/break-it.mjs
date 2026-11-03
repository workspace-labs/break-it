import { readFile } from 'node:fs/promises';
import { checkTarget } from './lib/target.mjs';
import { copyProject } from './lib/copy.mjs';
import { sealRun } from './lib/seal.mjs';
import { cleanupRun } from './lib/cleanup.mjs';
import { redactSecrets } from './lib/leaks.mjs';

async function main(args) {
  const [command, first, ...rest] = args;
  if (command === 'check' && first && (rest.length === 0 || rest.length === 2 && rest[0] === '--url')) {
    await checkTarget(first, rest[1]);
    console.log('Ready: local project folder checked. Reviewer must confirm ownership.');
  } else if (command === 'copy' && first && (rest.length === 0 || rest.length === 1 && rest[0] === '--skip')) {
    console.log(await copyProject(first, rest[0] === '--skip'));
  } else if (command === 'seal' && first && rest.length === 0) {
    console.log(await sealRun(first));
  } else if (command === 'scan' && first && rest.length === 0) {
    const { scanRun } = await import('./lib/scan.mjs');
    console.log(await scanRun(first));
  } else if (command === 'mask' && first === undefined) {
    const { maskInput } = await import('./lib/mask.mjs');
    const output = await maskInput(process.stdin);
    if (output) console.log(output);
  } else if (command === 'cleanup' && first && rest.length === 0) {
    const receipt = await cleanupRun(first);
    if (receipt.discarded) console.log('Receipt deleted. Nothing left behind.');
    else {
      console.log('Copy deleted. Receipt saved for report.');
      console.log('Receipt file: ' + receipt.file);
    }
  } else if (command === 'report' && first && rest.length === 1) {
    const { reportRun } = await import('./lib/report.mjs');
    console.log(await reportRun(first, JSON.parse(await readFile(rest[0], 'utf8'))));
  } else if (command === 'send' && first && rest.length >= 1) {
    const { sendRequest, sendOptions } = await import('./lib/send.mjs');
    const response = await sendRequest(first, rest[0], sendOptions(rest.slice(1)));
    const masked = redactSecrets(response.body, { minimumLength: 1 });
    // Masking short values can add a length label; preserve send's display cap.
    const bytes = Buffer.from(masked);
    const { StringDecoder } = await import('node:string_decoder');
    const display = new StringDecoder('utf8').write(bytes.subarray(0, 2048));
    console.log(`Status: ${response.status}\n${display}${response.cut || bytes.length > 2048 ? '\n(cut)' : ''}`);
  } else {
    throw new Error('Usage: node scripts/break-it.mjs check <project> [--url URL] | copy <project> [--skip] | seal <run-id> | scan <run-id> | mask | cleanup <run-id> | report <run-id> <findings.json> | send <METHOD> <URL> [--json <body>] [--token <bearer>]');
  }
}
main(process.argv.slice(2)).catch(error => {
  console.error(redactSecrets(error.message.startsWith('Refused:') || error.exitCode === 3 ? error.message : `Refused: ${error.message}`));
  process.exitCode = error.exitCode || 1;
});
