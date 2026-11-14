import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { API_KEY } from './config.mjs';

// All people, credentials and orders below are synthetic teaching data.
const users = { A: 'example-a', B: 'example-b', admin: 'example-admin' };
const orders = {
  '1': { id: '1', owner: 'A', item: 'Notebook' },
  '6': { id: '6', owner: 'B', item: 'Lamp', address: '6 Example Lane' }
};
const attempts = new Map();
const sessions = new Map();
const invalidateLogout = false;
const unpredictableSessions = false;
const expireSessions = false;
const invalidateOtherSessions = false;
const protectedCookie = false;
const uniformLoginErrors = false;
const sessionLifetime = 1800;
let sessionSequence = 1000000000000000n;
const notes = [];
const catalogJobs = [];
let catalogAvailable = true;
const uploadsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), 'uploads');
const uploadOwners = new Map();
await mkdir(uploadsFolder, { recursive: true });

function send(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(value));
}

async function body(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 70000) throw new Error('Body too large');
  }
  return JSON.parse(text || '{}');
}

async function uploadedPart(req, res, limited) {
  const boundary = /boundary=([^;]+)/.exec(req.headers['content-type'] || '')?.[1];
  if (!boundary) { send(res, 400, { error: 'Multipart file required' }); return; }
  if (limited && Number(req.headers['content-length']) > 1024 * 1024) {
    send(res, 413, { error: 'File too large' });
    return;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (limited && size > 1024 * 1024) { send(res, 413, { error: 'File too large' }); return; }
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  const split = bytes.indexOf('\r\n\r\n');
  const end = bytes.lastIndexOf(Buffer.from(`\r\n--${boundary}--`));
  const header = bytes.subarray(0, split).toString('utf8');
  const name = /filename="([^"]*)"/.exec(header)?.[1];
  if (!name || split < 0 || end < split + 4) { send(res, 400, { error: 'Invalid file part' }); return; }
  return { name, bytes: bytes.subarray(split + 4, end) };
}

async function streamedPart(req, res, limited, user, safeNames) {
  const boundary = /boundary=([^;]+)/.exec(req.headers['content-type'] || '')?.[1];
  if (!boundary) { send(res, 400, { error: 'Multipart file required' }); return; }
  if (limited && Number(req.headers['content-length']) > 1024 * 1024) {
    send(res, 413, { error: 'File too large' }); return;
  }
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
  let pending = Buffer.alloc(0), handle, name, size = 0, received = 0;
  try {
    for await (const chunk of req) {
      received += chunk.length;
      if (limited && received > 1024 * 1024) { send(res, 413, { error: 'File too large' }); return; }
      pending = Buffer.concat([pending, chunk]);
      if (!handle) {
        const split = pending.indexOf('\r\n\r\n');
        if (split < 0) {
          if (pending.length > 4096) { send(res, 400, { error: 'Invalid file part' }); return; }
          continue;
        }
        name = /filename="([^"]*)"/.exec(pending.subarray(0, split).toString('utf8'))?.[1];
        if (!name) { send(res, 400, { error: 'Invalid file part' }); return; }
        if (safeNames && (!/^[a-zA-Z0-9._-]{1,100}$/.test(name) || ['.', '..'].includes(name))) {
          send(res, 400, { error: 'Invalid file name' }); return;
        }
        handle = await open(path.join(uploadsFolder, name), 'w');
        uploadOwners.set(name, user);
        pending = pending.subarray(split + 4);
      }
      const count = Math.max(0, pending.length - suffix.length);
      if (count) { await handle.writeFile(pending.subarray(0, count)); size += count; }
      pending = pending.subarray(count);
    }
    if (!handle || !pending.equals(suffix)) { send(res, 400, { error: 'Invalid file part' }); return; }
    return { name, size, saved: true };
  } catch (error) {
    if (handle && pending.length) await handle.writeFile(pending);
    throw error;
  } finally { await handle?.close(); }
}

const boundedConnections = false;
const server = http.createServer({
  headersTimeout: boundedConnections ? 350 : 0,
  requestTimeout: boundedConnections ? 600 : 0,
  connectionsCheckingInterval: 50
}, async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/catalog') {
      return send(res, 200, { items: ['Notebook', 'Lamp'] });
    }
    if (req.method === 'GET' && url.pathname === '/catalog-refresh') {
      const releaseCatalogWork = false;
      catalogJobs.push({ items: Object.values(orders) });
      if (releaseCatalogWork) catalogJobs.length = 0;
      if (catalogJobs.length > 4) catalogAvailable = false;
      if (!catalogAvailable) return req.socket.destroy();
      return send(res, 200, { refreshed: true });
    }
    if (req.method === 'POST' && url.pathname === '/login') {
      const data = await body(req);
      const limited = false;
      const count = attempts.get(data.user) || 0;
      if (limited && count >= 5) return send(res, 429, { error: 'Try later' });
      if (!users[data.user] || data.password !== users[data.user]) {
        attempts.set(data.user, count + 1);
        return send(res, 401, { error: uniformLoginErrors ? 'Wrong login'
          : !users[data.user] ? 'No such user' : 'Wrong password' });
      }
      sessionSequence += 10n;
      const token = unpredictableSessions ? randomUUID() : String(sessionSequence);
      sessions.set(token, { user: data.user, expires: expireSessions ? Date.now() + sessionLifetime * 1000 : null });
      res.setHeader('Set-Cookie', `shop_session=${token}; Path=/` +
        (protectedCookie ? '; HttpOnly; SameSite=Lax' : '') +
        (expireSessions ? `; Max-Age=${sessionLifetime}` : ''));
      return send(res, 200, { session: token });
    }
    const bearer = req.headers.authorization?.replace('Bearer ', '');
    const cookie = req.headers.cookie?.split(';').map(part => part.trim())
      .find(part => part.startsWith('shop_session='))?.slice('shop_session='.length);
    const activeSession = value => {
      const session = sessions.get(value);
      if (session?.expires !== null && session?.expires <= Date.now()) {
        sessions.delete(value);
        return undefined;
      }
      return session;
    };
    const token = activeSession(bearer) ? bearer : cookie;
    const user = activeSession(token)?.user;
    if (!user) return send(res, 401, { error: 'Log in first' });
    if (req.method === 'POST' && url.pathname === '/logout') {
      res.setHeader('Set-Cookie', 'shop_session=; Path=/; Max-Age=0');
      if (invalidateLogout) sessions.delete(token);
      return send(res, 200, { loggedOut: true });
    }
    if (req.method === 'POST' && url.pathname === '/password') {
      const data = await body(req);
      if (data.current !== users[user]) return send(res, 403, { error: 'Current password required' });
      if (typeof data.password !== 'string' || !data.password.trim()) {
        return send(res, 400, { error: 'New password required' });
      }
      users[user] = data.password;
      if (invalidateOtherSessions) {
        for (const [value, session] of sessions) {
          if (value !== token && session.user === user) sessions.delete(value);
        }
      }
      return send(res, 200, { changed: true });
    }
    if (req.method === 'POST' && url.pathname === '/upload') {
      const limitUploads = false;
      const keepCompleteUploads = false;
      const safeUploadNames = false;
      const part = keepCompleteUploads ? await uploadedPart(req, res, limitUploads)
        : await streamedPart(req, res, limitUploads, user, safeUploadNames);
      if (!part) return;
      if (safeUploadNames && (!/^[a-zA-Z0-9._-]{1,100}$/.test(part.name) || ['.', '..'].includes(part.name))) {
        return send(res, 400, { error: 'Invalid file name' });
      }
      if (!part.saved) await writeFile(path.join(uploadsFolder, part.name), part.bytes);
      uploadOwners.set(part.name, user);
      return send(res, 201, { url: `/uploads/${encodeURIComponent(part.name)}`, bytes: part.saved ? part.size : part.bytes.length });
    }
    if (req.method === 'GET' && url.pathname.startsWith('/uploads/')) {
      const name = decodeURIComponent(url.pathname.slice('/uploads/'.length));
      const safeDownloadPaths = false;
      const relative = path.relative(uploadsFolder, path.resolve(uploadsFolder, name));
      if (safeDownloadPaths && (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))) {
        return send(res, 400, { error: 'Invalid file name' });
      }
      const privateUploads = false;
      if (privateUploads && uploadOwners.get(name) !== user) return send(res, 403, { error: 'Not your file' });
      let bytes;
      try { bytes = await readFile(path.join(uploadsFolder, name)); }
      catch { return send(res, 404, { error: 'No such file' }); }
      const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.html': 'text/html', '.svg': 'image/svg+xml' };
      const downloadUploads = false;
      res.writeHead(200, { 'Content-Type': types[path.extname(name)] || 'application/octet-stream',
        ...(downloadUploads ? { 'Content-Disposition': 'attachment', 'Content-Security-Policy': "sandbox; default-src 'none'" } : {}) });
      return res.end(bytes);
    }
    if (req.method === 'GET' && url.pathname === '/admin') {
      return user === 'admin' ? send(res, 200, { admin: true })
        : send(res, 403, { error: 'Admin only' });
    }
    if (req.method === 'GET' && url.pathname === '/profile') {
      const omitPrivate = false;
      const profile = { user };
      const digest = 'synthetic-password-hash-local-only';
      if (!omitPrivate) profile.passwordHash = digest;
      return send(res, 200, profile);
    }
    if (req.method === 'GET' && url.pathname === '/catalog-error') {
      const hideDetails = false;
      return send(res, 500, hideDetails ? { error: 'Request failed' } : {
        error: 'SQLITE_ERROR: no such table: inventory at /srv/shop/catalog.mjs:18',
        integrationEnabled: Boolean(API_KEY)
      });
    }
    if (url.pathname === '/notes') {
      if (req.method === 'GET') return send(res, 200, { notes: notes.filter(note => note.owner === user) });
      if (req.method === 'POST') {
        const data = await body(req);
        if (typeof data.text !== 'string' || !data.text) return send(res, 400, { error: 'Text required' });
        notes.push({ owner: user, text: data.text });
        return send(res, 201, { saved: true });
      }
    }
    if (req.method === 'POST' && url.pathname === '/echo') {
      const data = await body(req);
      const validateEmpty = false;
      if (validateEmpty && (typeof data.text !== 'string' || !data.text.trim())) {
        return send(res, 400, { error: 'Text required' });
      }
      if (!data.text) throw new Error('Empty text crashed this request');
      return send(res, 200, { text: data.text });
    }
    const match = /^\/(safe-orders|orders)\/([^/]+)$/.exec(url.pathname);
    if (req.method === 'GET' && match) {
      const order = orders[match[2]];
      if (!order) return send(res, 404, { error: 'No such order' });
      if (match[1] === 'safe-orders') {
        if (order.owner !== user) return send(res, 403, { error: 'Not your order' });
      } else {
        const requireOwner = false;
        if (requireOwner && order.owner !== user) return send(res, 403, { error: 'Not your order' });
      }
      return send(res, 200, order);
    }
    send(res, 404, { error: 'No such route' });
  } catch {
    send(res, 500, { error: 'Request failed' });
  }
});

server.listen(0, '127.0.0.1', () => {
  const ready = { port: server.address().port };
  if (process.send) process.send(ready);
  else process.stdout.write(`${JSON.stringify(ready)}\n`);
});

process.on('message', message => {
  if (message === 'stop') server.close(() => process.exit(0));
});
