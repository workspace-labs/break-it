import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { API_KEY } from './config.mjs';

// All people, credentials and orders below are synthetic teaching data.
const users = { A: 'example-a', B: 'example-b', admin: 'example-admin' };
const orders = {
  '1': { id: '1', owner: 'A', item: 'Notebook' },
  '6': { id: '6', owner: 'B', item: 'Lamp', address: '6 Example Lane' }
};
const attempts = new Map();
const sessions = new Map();

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

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && url.pathname === '/login') {
      const data = await body(req);
      const limited = false;
      const count = attempts.get(data.user) || 0;
      if (limited && count >= 5) return send(res, 429, { error: 'Try later' });
      if (!users[data.user] || data.password !== users[data.user]) {
        attempts.set(data.user, count + 1);
        return send(res, 401, { error: 'Wrong login' });
      }
      const token = randomUUID();
      sessions.set(token, data.user);
      return send(res, 200, { session: token });
    }
    const user = sessions.get(req.headers.authorization?.replace('Bearer ', ''));
    if (!user) return send(res, 401, { error: 'Log in first' });
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
