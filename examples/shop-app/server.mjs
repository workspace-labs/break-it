import http from 'node:http';
import { randomUUID } from 'node:crypto';

// All people, credentials and orders below are synthetic teaching data.
const users = { A: 'demo-a', B: 'demo-b', admin: 'demo-admin' };
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
      // PLANTED HOLE: A09
      const limited = false; // demo builder replaces this line in its scratch source
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
    if (req.method === 'POST' && url.pathname === '/echo') {
      const data = await body(req);
      // PLANTED HOLE: A01
      const validateEmpty = false; // demo builder replaces this line in its scratch source
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
        // PLANTED HOLE: B01
        const requireOwner = false; // demo builder replaces this line in its scratch source
        if (requireOwner && order.owner !== user) return send(res, 403, { error: 'Not your order' });
      }
      return send(res, 200, order);
    }
    send(res, 404, { error: 'No such route' });
  } catch {
    // Request-scoped crash: process survives and no stack is returned. SMALL, not CRITICAL.
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
