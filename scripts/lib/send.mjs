import http from 'node:http';
import https from 'node:https';
import { StringDecoder } from 'node:string_decoder';
import { checkUrl } from './target.mjs';

const bodyLimit = 64 * 1024;
const outputLimit = 2 * 1024;

function boundedText(buffer) {
  // Do not print half a UTF-8 character at the boundary. Re-encode invalid input
  // before the final cut so replacement characters cannot expand past the cap.
  const decoded = Buffer.from(buffer.toString('utf8'));
  return { body: new StringDecoder('utf8').write(decoded.subarray(0, outputLimit)),
    cut: decoded.length > outputLimit };
}

export function validateRequest(method, input, { json, token } = {}) {
  const url = checkUrl(input);
  if (typeof method !== 'string' || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(method)) {
    throw new Error('Refused: method must be one HTTP method.');
  }
  if (json !== undefined && (typeof json !== 'string' || Buffer.byteLength(json) > bodyLimit)) {
    throw new Error('Refused: request body must be at most 64 KiB.');
  }
  if (token !== undefined) http.validateHeaderValue('Authorization', `Bearer ${token}`);
  return url;
}

export async function sendRequest(method, input, { json, token, signal } = {}) {
  const url = validateRequest(method, input, { json, token });
  const headers = { Host: url.host };
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(json);
  }
  if (token !== undefined) headers.Authorization = `Bearer ${token}`;
  // Pin localhost to a literal loopback address; never consult DNS or proxies.
  const hostname = url.hostname === '[::1]' ? '::1' : '127.0.0.1';
  const transport = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    let settled = false;
    let req;
    const timer = setTimeout(() => {
      finish(new Error('Refused: request exceeded five seconds.'));
      req.destroy();
    }, 5000);
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(result);
    };
    const abort = () => {
      finish(new Error('Refused: request stopped at the load deadline.'));
      req?.destroy();
    };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    try {
      req = transport.request({ hostname, port: url.port || undefined,
        path: url.pathname + url.search, method: method.toUpperCase(), headers,
        agent: false, ...(url.protocol === 'https:' ? { servername: url.hostname } : {}) }, res => {
        const chunks = [];
        let size = 0;
        const result = cut => {
          const display = boundedText(Buffer.concat(chunks));
          return { status: res.statusCode, body: display.body, cut: cut || display.cut };
        };
        res.on('data', chunk => {
          if (settled) return;
          const remaining = outputLimit - size;
          chunks.push(chunk.subarray(0, remaining));
          size += Math.min(chunk.length, remaining);
          if (chunk.length > remaining) {
            finish(null, result(true));
            res.destroy();
          }
        });
        res.once('end', () => finish(null, result(false)));
        res.once('error', error => finish(error));
        res.once('aborted', () => finish(new Error('Refused: response ended before completion.')));
      });
      req.once('error', error => finish(error));
      req.end(json);
    } catch (error) {
      finish(error);
      req?.destroy();
    }
  });
}

export function sendOptions(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i] === '--json' ? 'json' : args[i] === '--token' ? 'token' : undefined;
    if (!key || i + 1 >= args.length || options[key] !== undefined) {
      throw new Error('Refused: send accepts one --json body and one --token bearer.');
    }
    options[key] = args[i + 1];
  }
  return options;
}
