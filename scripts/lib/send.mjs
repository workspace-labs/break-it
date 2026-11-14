import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { performance } from 'node:perf_hooks';
import { StringDecoder } from 'node:string_decoder';
import { Readable } from 'node:stream';
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
  return requestOnce(method, url, { headers, json, signal });
}

// Both JSON and file requests use this single transport. No DNS, proxy,
// redirect or retry path is available to either caller.
function requestOnce(method, url, { headers, json, source, signal, deadline = 5000 }) {
  // Pin localhost to a literal loopback address; never consult DNS or proxies.
  const hostname = url.hostname === '[::1]' ? '::1' : '127.0.0.1';
  const transport = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    let settled = false;
    let req;
    let sentBytes = 0;
    const countSent = chunk => { sentBytes += chunk.length; };
    const timer = setTimeout(() => {
      finish(new Error(deadline === 5000 ? 'Refused: request exceeded five seconds.' :
        'Refused: big upload exceeded thirty seconds.'));
    }, deadline);
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      source?.unpipe(req);
      source?.removeListener('data', countSent);
      source?.destroy();
      req?.destroy();
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
        // An app may reject a large file before reading it. Stop the upload as
        // soon as final headers arrive, while still reading its bounded reply.
        source?.unpipe(req);
        source?.destroy();
        const chunks = [];
        let size = 0;
        const result = cut => {
          const display = boundedText(Buffer.concat(chunks));
          return { status: res.statusCode, body: display.body, cut: cut || display.cut,
            ...(source ? { sentBytes } : {}),
            headers: Object.fromEntries(['content-type', 'content-disposition', 'content-security-policy']
              .filter(key => res.headers[key] !== undefined).map(key => [key, res.headers[key]])) };
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
      if (source) {
        source.once('error', error => finish(error));
        // Count only chunks consumed by this pipe, not generator read-ahead.
        source.on('data', countSent);
        source.pipe(req);
      } else req.end(json);
    } catch (error) {
      finish(error);
      req?.destroy();
    }
  });
}

// Only upload.mjs prepares file bodies. Validate its independently computed
// length here as well, so transport can never send a body above 51 MiB.
export function sendFileRequest(method, input, { source, length, boundary, token, big = false }) {
  const url = validateRequest(method, input, { token });
  if (!/^(POST|PUT)$/.test(method) || !Number.isSafeInteger(length) || length < 0 || length > 51 * 1024 * 1024) {
    throw new Error('Refused: upload requires POST or PUT and at most 51 MiB total.');
  }
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(boundary)) throw new Error('Refused: invalid multipart boundary.');
  const headers = { Host: url.host, 'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': length, Connection: 'keep-alive' };
  // Let early refusals arrive before the server closes with unread input.
  // agent:false and finish() still make this a single-use socket, never a pool.
  if (token !== undefined) headers.Authorization = `Bearer ${token}`;
  const bounded = Readable.from((async function* () {
    let sent = 0;
    try {
      for await (const value of source) {
        const chunk = typeof value === 'string' ? Buffer.from(value) : value;
        if (!Buffer.isBuffer(chunk) && !(chunk instanceof Uint8Array)) {
          throw new Error('Refused: upload stream must contain bytes.');
        }
        sent += chunk.length;
        if (sent > length) throw new Error('Refused: upload stream exceeded its bounded body length.');
        yield chunk;
      }
      if (sent !== length) throw new Error('Refused: upload stream ended before its bounded body length.');
    } finally { source.destroy(); }
  })());
  return requestOnce(method, url, { headers, source: bounded, deadline: big === true ? 30000 : 5000 });
}

export function sendOptions(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (args[i] === '--headers' && options.headers === undefined) {
      options.headers = true;
      i--;
      continue;
    }
    const key = args[i] === '--json' ? 'json' : args[i] === '--token' ? 'token' : undefined;
    if (!key || i + 1 >= args.length || options[key] !== undefined) {
      throw new Error('Refused: send accepts one --json body and one --token bearer.');
    }
    options[key] = args[i + 1];
  }
  return options;
}

// The raw transport has no caller-supplied wire format: only these eight shapes.
const garbageBytes = Buffer.alloc(64, 0xff);
function badRequestShape(kind, method, url, { length, type, boundary, token }) {
  const line = `${method.toUpperCase()} ${url.pathname + url.search} HTTP/1.1\r\n`;
  const host = `Host: ${url.host}\r\n`;
  const auth = token === undefined ? '' : `Authorization: Bearer ${token}\r\n`;
  if (kind === 'garbage') return { headers: garbageBytes, length: 0 };
  if (kind === 'bad-header') return { headers: Buffer.from(line + host + auth + 'Broken-Header\r\n\r\n'), length: 0 };
  if (kind === 'huge-header') return { headers: Buffer.from(line + host + auth + `X-Filler: ${'a'.repeat(32768)}\r\n\r\n`), length: 0 };
  if (kind === 'two-lengths') return { headers: Buffer.from(line + host + auth +
    'Content-Length: 1\r\nContent-Length: 2\r\n\r\nx'), length: 0 };
  const contentType = boundary ? `multipart/form-data; boundary=${boundary}` : type;
  return { headers: Buffer.from(line + host + auth +
    (contentType ? `Content-Type: ${contentType}\r\n` : '') + `Content-Length: ${length}\r\n\r\n`), length };
}

// Incremental HTTP reply reader: bounded headers, bounded body and chunk framing.
// No redirect handling, decompression, retry or second socket lives here.
function rawReply(method, answered, completed) {
  let header = Buffer.alloc(0), response, chunked = false, remaining = null;
  let chunkLine = '', chunkRemaining = null, chunkCRLF = 0, received = 0;
  const chunks = [];
  const save = bytes => {
    const keep = Math.min(bytes.length, outputLimit - received);
    chunks.push(bytes.subarray(0, keep));
    received += keep;
    if (bytes.length > keep) { response.cut = true; completed(); return false; }
    return true;
  };
  const result = reason => {
    if (!response) return undefined;
    const display = boundedText(Buffer.concat(chunks));
    return { ...response, body: display.body, cut: response.cut || display.cut ||
      reason === 'limit' || reason === 'reset' || remaining > 0 || (chunked && chunkRemaining !== 0) };
  };
  const feed = data => {
    if (!response) {
      // Do not retain an oversized header even when delivered in one huge chunk.
      const joined = Buffer.concat([header, data.subarray(0, 16385 - header.length)]);
      const boundary = joined.indexOf('\r\n\r\n');
      if (boundary < 0) {
        header = joined;
        if (header.length > 16384) completed('limit');
        return;
      }
      const text = joined.subarray(0, boundary).toString('latin1');
      const status = /^HTTP\/1\.[01] ([1-9]\d\d)(?: |\r\n|$)/.exec(text);
      if (!status) { completed('limit'); return; }
      const used = boundary + 4 - header.length;
      header = Buffer.alloc(0);
      if (Number(status[1]) < 200) { feed(data.subarray(used)); return; }
      response = { status: Number(status[1]), cut: false };
      answered();
      chunked = /\r\ntransfer-encoding:\s*chunked\s*(?:\r\n|$)/i.test(text);
      const size = /\r\ncontent-length:\s*(\d+)\s*(?:\r\n|$)/i.exec(text);
      if (size) remaining = Number(size[1]);
      if (method.toUpperCase() === 'HEAD' || [204, 304].includes(response.status)) {
        remaining = 0; chunked = false; completed(); return;
      }
      if (remaining === 0) { completed(); return; }
      data = data.subarray(used);
    }
    if (!chunked) {
      const bytes = remaining === null ? data : data.subarray(0, remaining);
      if (!save(bytes)) return;
      if (remaining !== null) {
        remaining -= bytes.length;
        if (remaining === 0) completed();
      }
      return;
    }
    // Parse chunk framing without allowing an unbounded size line or trailers.
    for (let i = 0; i < data.length;) {
      if (chunkCRLF) { i++; chunkCRLF--; continue; }
      if (chunkRemaining === null) {
        chunkLine += String.fromCharCode(data[i++]);
        if (chunkLine.length > 128) { completed('limit'); return; }
        if (!chunkLine.endsWith('\r\n')) continue;
        if (!/^[0-9a-f]+(?:;[^\r\n]*)?\r\n$/i.test(chunkLine)) { completed('limit'); return; }
        chunkRemaining = parseInt(chunkLine, 16);
        chunkLine = '';
        if (!Number.isSafeInteger(chunkRemaining)) { completed('limit'); return; }
        if (chunkRemaining === 0) { completed(); return; }
      } else {
        const count = Math.min(chunkRemaining, data.length - i);
        if (!save(data.subarray(i, i + count))) return;
        i += count;
        chunkRemaining -= count;
        if (chunkRemaining === 0) { chunkRemaining = null; chunkCRLF = 2; }
      }
    }
  };
  return { feed, result };
}

export function sendBadConnection(kind, method, input, options) {
  const url = validateRequest(method, input, { token: options.token });
  if (url.protocol !== 'http:') throw new Error('Refused: net supports http://localhost only');
  if (!['cut', 'slow', 'leave', 'short', 'garbage', 'bad-header', 'huge-header', 'two-lengths'].includes(kind)) {
    throw new Error('Refused: unknown net kind.');
  }
  if (!Number.isSafeInteger(options.length) || options.length < 0 || options.length > 51 * 1024 * 1024) {
    throw new Error('Refused: net body exceeds 51 MiB.');
  }
  const shape = badRequestShape(kind, method, url, options);
  const held = kind === 'slow' || kind === 'short';
  const milliseconds = Math.max(0, Math.min(held ? options.seconds * 1000 : 5000, 30000,
    options.deadline - performance.now()));
  // Pin localhost to the same literal loopback as requestOnce, never DNS.
  const hostname = url.hostname === '[::1]' ? '::1' : '127.0.0.1';
  return new Promise(resolve => {
    const start = performance.now();
    const controller = new AbortController();
    let socket, settled = false, drip, sentBytes = 0, weClosed = false, appSeconds;
    let outcome, finalResult;
    const elapsed = () => (performance.now() - start) / 1000;
    const finish = reason => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(drip);
      controller.abort();
      options.source?.destroy();
      const response = reply.result(reason);
      if (response && !socket?.readableEnded && !socket?.destroyed) weClosed = true;
      outcome = response ? 'answered' : reason;
      finalResult = { sentBytes, totalBytes: shape.headers.length + shape.length,
        seconds: elapsed(), weClosed, outcome, appSeconds: appSeconds ?? elapsed(),
        ...(response ? { response } : {}) };
      if (!socket || socket.closed) resolve(finalResult);
      else {
        socket.once('close', () => resolve(finalResult));
        socket.destroy();
      }
    };
    const reply = rawReply(method, () => {
      appSeconds = elapsed();
      clearTimeout(drip);
      options.source?.destroy();
    }, reason => {
      if (reason === 'limit') weClosed = true;
      finish(reason ?? 'closed');
    });
    const timer = setTimeout(() => { weClosed = true; finish('limit'); }, milliseconds);
    const write = bytes => {
      if (settled || socket.destroyed) return false;
      sentBytes += bytes.length;
      return socket.write(bytes);
    };
    const during = () => options.onDuring?.(controller.signal);
    const endOurSide = () => { weClosed = true; socket.end(); };
    socket = net.connect({ host: hostname, port: Number(url.port || 80) });
    socket.once('error', () => finish('reset'));
    socket.once('end', () => finish('closed'));
    socket.once('close', hadError => finish(hadError ? 'reset' : 'closed'));
    // leave never attaches a reader: flush the complete request, then destroy.
    if (kind !== 'leave') socket.on('data', data => { if (!settled) reply.feed(data); });
    socket.once('connect', async () => {
      try {
        if (kind === 'slow') {
          let position = 0;
          const sendByte = () => {
            if (settled || reply.result()) return;
            if (position < shape.headers.length) write(shape.headers.subarray(position, ++position));
            drip = setTimeout(sendByte, 500);
          };
          sendByte();
          during();
          return;
        }
        write(shape.headers);
        const count = kind === 'cut' ? Math.floor(shape.length / 2) : kind === 'short' ? 10 : shape.length;
        if (options.source) {
          let left = count;
          for await (const chunk of options.source) {
            if (settled || reply.result() || left === 0) break;
            const bytes = chunk.subarray(0, left);
            left -= bytes.length;
            if (!write(bytes)) await new Promise(done => {
              const clear = () => { socket.off('drain', clear); socket.off('close', clear); done(); };
              socket.once('drain', clear); socket.once('close', clear);
            });
          }
        } else if (count) write(options.body.subarray(0, count));
        if (settled) return;
        if (kind === 'short') { during(); return; }
        if (kind === 'leave') {
          weClosed = true;
          socket.end(() => finish('closed'));
        } else if (kind === 'cut') endOurSide();
        // F05 waits for the app's reply/close or the fixed five-second ceiling.
      } catch { finish('reset'); }
    });
  });
}
