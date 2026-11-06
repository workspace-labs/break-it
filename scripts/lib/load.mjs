import { performance } from 'node:perf_hooks';
import { setMaxListeners } from 'node:events';
import { sendRequest, validateRequest } from './send.mjs';

const limits = { requests: 2000, concurrency: 50, duration: 30 };
const defaults = { requests: 200, concurrency: 10, duration: 30 };

function boundedOptions(input) {
  const options = { ...defaults, ...input };
  for (const [name, ceiling] of Object.entries(limits)) {
    if (!Number.isSafeInteger(options[name]) || options[name] < 1 || options[name] > ceiling) {
      throw new Error(`Refused: --${name} must be an integer from 1 to ${ceiling}.`);
    }
  }
  for (const name of Object.keys(input)) {
    if (!(Object.hasOwn(limits, name) || name === 'json' || name === 'token')) {
      throw new Error('Refused: load accepts only --requests, --concurrency, --duration, --json and --token.');
    }
  }
  return options;
}

export function loadOptions(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const name = typeof flag === 'string' && flag.startsWith('--') ? flag.slice(2) : '';
    if (!(Object.hasOwn(limits, name) || name === 'json' || name === 'token') ||
        i + 1 >= args.length || Object.hasOwn(options, name)) {
      throw new Error('Refused: load accepts one each of --requests, --concurrency, --duration, --json and --token.');
    }
    const value = args[i + 1];
    if (Object.hasOwn(limits, name)) {
      if (typeof value !== 'string' || !/^\d+$/.test(value)) {
        throw new Error(`Refused: --${name} must be an integer from 1 to ${limits[name]}.`);
      }
      options[name] = Number(value);
    } else options[name] = value;
  }
  return boundedOptions(options);
}

// N counts the burst only. The one recovery probe is separate, with send's
// five-second deadline. All request validation stays at the send boundary.
export async function runLoad(method, input, inputOptions = {}) {
  const options = boundedOptions(inputOptions);
  try { validateRequest(method, input, options); }
  catch (error) {
    throw new Error(error.message.startsWith('Refused:') ? error.message : `Refused: ${error.message}`);
  }
  const summary = { method: method.toUpperCase(), url: String(input), sent: 0, completed: 0, failed: 0,
    statuses: { '2xx': 0, '4xx': 0, '5xx': 0, 'other/none': 0 },
    latency: { min: null, median: null, p95: null, max: null }, afterBurst: {} };
  const times = [];
  const controller = new AbortController();
  const deadline = performance.now() + options.duration * 1000;
  const timer = setTimeout(() => controller.abort(), options.duration * 1000);
  async function worker() {
    while (summary.sent < options.requests && !controller.signal.aborted) {
      if (performance.now() >= deadline) { controller.abort(); break; }
      // Claim the shared budget synchronously before yielding to another worker.
      summary.sent++;
      const started = performance.now();
      try {
        const response = await sendRequest(method, input, { ...options, signal: controller.signal });
        summary.completed++;
        times.push(performance.now() - started);
        const group = response.status >= 200 && response.status < 300 ? '2xx' :
          response.status >= 400 && response.status < 500 ? '4xx' :
          response.status >= 500 && response.status < 600 ? '5xx' : 'other/none';
        summary.statuses[group]++;
      } catch {
        summary.failed++;
        summary.statuses['other/none']++;
      }
    }
  }
  // AbortSignal's default listener warning starts at 11. Each request removes
  // its listener on settlement; max 50 live listeners are intentional here.
  setMaxListeners(limits.concurrency, controller.signal);
  try {
    await Promise.all(Array.from({ length: Math.min(options.concurrency, options.requests) }, worker));
  } finally {
    clearTimeout(timer);
  }
  times.sort((a, b) => a - b);
  if (times.length) {
    const middle = Math.floor(times.length / 2);
    summary.latency = { min: times[0],
      median: times.length % 2 ? times[middle] : (times[middle - 1] + times[middle]) / 2,
      p95: times[Math.ceil(times.length * 0.95) - 1], max: times.at(-1) };
  }
  try {
    const response = await sendRequest(method, input, options);
    summary.afterBurst = { status: response.status };
  } catch { /* A failed recovery probe is a measurement, never a CLI refusal. */ }
  return summary;
}

export function formatLoad(summary) {
  const { statuses: status, latency, afterBurst } = summary;
  const ms = value => value === null ? 'n/a' : value.toFixed(1);
  // Keep even a very long valid target from turning this into unbounded output.
  const url = summary.url.length > 512 ? summary.url.slice(0, 509) + '...' : summary.url;
  const method = summary.method.length > 32 ? summary.method.slice(0, 29) + '...' : summary.method;
  return [
    `LOAD ${method} ${url}  requests: ${summary.sent}  completed: ${summary.completed}  failed/timeout: ${summary.failed}`,
    `status: 2xx ${status['2xx']}  4xx ${status['4xx']}  5xx ${status['5xx']}  other/none ${status['other/none']}`,
    `latency ms: min ${ms(latency.min)}  median ${ms(latency.median)}  p95 ${ms(latency.p95)}  max ${ms(latency.max)}  (completed requests)`,
    `after burst: ${afterBurst.status ? `app answered ${afterBurst.status}` : 'app did not answer'}`,
  ].join('\n');
}
