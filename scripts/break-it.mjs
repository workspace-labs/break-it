import { readFile } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';
import { checkTarget } from './lib/target.mjs';
import { copyProject } from './lib/copy.mjs';
import { sealRun } from './lib/seal.mjs';
import { cleanupRun } from './lib/cleanup.mjs';
import { redactSecrets, safeLabel } from './lib/leaks.mjs';

function printResponse(response, showHeaders = false) {
  const masked = redactSecrets(response.body, { minimumLength: 1 });
  const bytes = Buffer.from(masked);
  // Avoid splitting a UTF-8 code point after masking expands a short value.
  const display = new StringDecoder('utf8').write(bytes.subarray(0, 2048));
  console.log(`Status: ${response.status}\n${display}${response.cut || bytes.length > 2048 ? '\n(cut)' : ''}`);
  if (showHeaders) {
    const labels = { 'content-type': 'Content-Type', 'content-disposition': 'Content-Disposition',
      'content-security-policy': 'Content-Security-Policy' };
    const headerBytes = Buffer.from(Object.entries(labels).map(([key, label]) =>
      `${label}: ${safeLabel(redactSecrets(String(response.headers?.[key] ?? '(absent)'), { minimumLength: 1 }))}`).join('\n'));
    console.log(new StringDecoder('utf8').write(headerBytes.subarray(0, 2048)));
    if (headerBytes.length > 2048) console.log('(headers cut; incomplete evidence)');
  }
}

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
  } else if (command === 'load' && first && rest.length >= 1) {
    const { runLoad, loadOptions, formatLoad } = await import('./lib/load.mjs');
    console.log(redactSecrets(formatLoad(await runLoad(first, rest[0], loadOptions(rest.slice(1))))));
  } else if (command === 'make' && first && rest.length >= 1) {
    const { makeFile, makeOptions } = await import('./lib/files.mjs');
    const file = await makeFile(first, rest[0], makeOptions(rest.slice(1)));
    console.log(`${file.name}  ${file.bytes}  ${file.description}`);
  } else if (command === 'upload' && first && rest.length >= 2) {
    const { uploadRequest, uploadOptions } = await import('./lib/upload.mjs');
    const response = await uploadRequest(first, rest[0], rest[1], uploadOptions(rest.slice(2)));
    printResponse(response);
    const file = response.uploaded;
    const progress = file.sentBytes === file.bytes ? `uploaded ${file.bytes} bytes` :
      `sent ${file.sentBytes} of ${file.bytes} bytes (stopped at the app's reply)`;
    console.log(`${progress} as ${JSON.stringify(file.name)} (${file.type})`);
    if (file.deadline === 30000) console.log('Big file: request deadline raised to 30 seconds.');
  } else if (command === 'send' && first && rest.length >= 1) {
    const { sendRequest, sendOptions } = await import('./lib/send.mjs');
    const options = sendOptions(rest.slice(1));
    printResponse(await sendRequest(first, rest[0], options), options.headers);
  } else {
    throw new Error('Usage: node scripts/break-it.mjs check <project> [--url URL] | copy <project> [--skip] | seal <run-id> | scan <run-id> | mask | cleanup <run-id> | report <run-id> <findings.json> | make <run-id> <kind> [--mb N] | upload <run-id> <POST|PUT> <URL> --file <made-file> [--field name] [--type content-type] [--name preset] [--token bearer] | send <METHOD> <URL> [--json <body>] [--token <bearer>] [--headers] | load <METHOD> <URL> [--requests N] [--concurrency C] [--duration S] [--json <body>] [--token <bearer>]');
  }
}
main(process.argv.slice(2)).catch(error => {
  const message = error.message.startsWith('Refused:') || error.exitCode === 3 ? error.message : `Refused: ${error.message}`;
  // Seal alarms have intentional line breaks and already sanitize dynamic labels.
  // Other failures can contain raw filesystem paths or parser input excerpts.
  console.error(error.exitCode === 3 ? redactSecrets(message) : safeLabel(message));
  process.exitCode = error.exitCode || 1;
});
