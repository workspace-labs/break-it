import { performance } from 'node:perf_hooks';
import { runPath } from './runs.mjs';
import { validateRequest, sendRequest, sendBadConnection } from './send.mjs';
import { withUploadBody } from './upload.mjs';
import { safeLabel } from './leaks.mjs';

const kinds = ['cut', 'slow', 'leave', 'short', 'garbage', 'bad-header', 'huge-header', 'two-lengths'];
const keys = ['probe', 'json', 'file', 'token', 'seconds'];

export function netOptions(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = typeof args[i] === 'string' ? args[i].slice(2) : '';
    if (!args[i]?.startsWith('--') || !keys.includes(key) || i + 1 >= args.length || Object.hasOwn(options, key)) {
      throw new Error('Refused: net accepts one each of --probe, --json or --file, --token and --seconds.');
    }
    const value = args[i + 1];
    if (key === 'seconds' && !/^\d+$/.test(value)) throw new Error('Refused: --seconds must be an integer from 1 to 30.');
    options[key] = key === 'seconds' ? Number(value) : value;
  }
  return options;
}

export async function runNet(id, kind, method, input, options = {}) {
  const deadline = performance.now() + 30000;
  await runPath(id);
  if (!kinds.includes(kind)) throw new Error('Refused: unknown net kind. Use ' + kinds.join(', ') + '.');
  if (Object.keys(options).some(key => !keys.includes(key))) throw new Error('Refused: unknown net option.');
  const url = validateRequest(method, input, options);
  if (url.protocol !== 'http:') throw new Error('Refused: net supports http://localhost only');
  if (!options.probe) throw new Error('Refused: net requires --probe <URL> for a GET health check.');
  const probe = validateRequest('GET', options.probe);
  if (probe.protocol !== 'http:') throw new Error('Refused: net supports http://localhost only');
  if (probe.host !== url.host) throw new Error('Refused: --probe must use the same host and port as the net URL.');
  const held = kind === 'slow' || kind === 'short';
  if (options.seconds !== undefined && (!held || !Number.isSafeInteger(options.seconds) || options.seconds < 1 || options.seconds > 30)) {
    throw new Error('Refused: --seconds must be an integer from 1 to 30, only for slow and short.');
  }
  if (options.file !== undefined && (kind !== 'cut' || options.json !== undefined)) {
    throw new Error('Refused: --file is only for cut, and cannot be combined with --json.');
  }
  if (kinds.indexOf(kind) >= 4 && (options.json !== undefined || options.file !== undefined)) {
    throw new Error('Refused: broken request kinds accept neither --json nor --file.');
  }
  if (kind === 'short' && (options.json === undefined || Buffer.byteLength(options.json) <= 10)) {
    throw new Error('Refused: short requires a --json body of more than 10 bytes.');
  }
  const measureProbe = async signal => {
    const start = performance.now();
    try {
      const response = await sendRequest('GET', options.probe, { token: options.token, signal });
      return { status: response.status, ms: performance.now() - start };
    } catch (error) {
      // sendRequest distinguishes our AbortSignal from its own timeout or a socket failure.
      if (signal?.aborted && error.message === 'Refused: request stopped at the load deadline.') {
        return { stopped: true };
      }
      return { failed: true };
    }
  };
  let during;
  const execute = async body => {
    const result = await sendBadConnection(kind, method, input, {
      ...body, token: options.token, seconds: options.seconds ?? 10, deadline,
      onDuring: held ? signal => { during = measureProbe(signal); } : undefined,
    });
    return { ...result, kind, method: method.toUpperCase(), url: String(input),
      probeDuring: during ? await during : held ? { failed: true } : null,
      probeAfter: await measureProbe() };
  };
  if (options.file !== undefined) return withUploadBody(id, options, execute);
  const body = Buffer.from(options.json ?? '');
  return execute({ body, length: body.length, type: options.json === undefined ? undefined : 'application/json' });
}

export function formatNet(result) {
  const seconds = value => value.toFixed(3);
  const url = safeLabel(result.url).slice(0, 512);
  const method = result.method.slice(0, 32);
  const app = result.kind === 'leave' ? 'not observed (we left first)' :
    result.outcome === 'answered' ? `answered ${result.response.status} after ${seconds(result.appSeconds)} s` :
    result.outcome === 'limit' ? `still open at our limit (${seconds(result.seconds)} s)` :
      `${result.outcome === 'reset' ? 'reset' : 'closed'} the connection after ${seconds(result.appSeconds)} s`;
  return [
    `NET ${result.kind} ${method} ${url}`,
    `sent: ${result.sentBytes} of ${result.totalBytes} bytes over ${seconds(result.seconds)} s   we closed: ${result.weClosed ? 'yes' : 'no'}`,
    `app: ${app}`,
    `probe during: ${result.probeDuring === null ? 'n/a' : result.probeDuring.status ?
      `app answered ${result.probeDuring.status} in ${result.probeDuring.ms.toFixed(1)} ms` :
      result.probeDuring.stopped ? `stopped when the try ended after ${seconds(result.seconds)} s (not evidence)` : 'app did not answer'}`,
    `probe after: ${result.probeAfter.status ? `app answered ${result.probeAfter.status}` : 'app did not answer'}`,
  ].join('\n');
}
