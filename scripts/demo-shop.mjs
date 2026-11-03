// Reproducible teaching fixture only; not a generic attack runner or code fixer.
import { fork, spawnSync } from 'node:child_process';
import http from 'node:http';
import { mkdtemp, readFile, writeFile, cp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(root, 'scripts', 'break-it.mjs');
export const examplePath = path.join(root, 'examples', 'shop-app');

function cli(...args) {
  const result = spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'CLI failed');
  return result.stdout.trim();
}

export async function startShop(folder) {
  return new Promise((resolve, reject) => {
    const child = fork(path.join(folder, 'server.mjs'), [], {
      cwd: folder, stdio: ['ignore', 'ignore', 'pipe', 'ipc']
    });
    let errors = '';
    child.stderr.on('data', chunk => { errors += chunk; });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Copy did not start within five seconds'));
    }, 5000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`Copy exited ${code}: ${errors}`));
    });
    child.once('message', message => {
      clearTimeout(timer);
      resolve({ child, port: message.port });
    });
  });
}

export async function stopShop({ child }) {
  if (child.exitCode !== null) return;
  await new Promise(resolve => {
    const timer = setTimeout(() => child.kill(), 3000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.send('stop');
  });
}

function request(port, route, { method = 'GET', data, token } = {}) {
  // Host is a literal loopback address. HTTP redirects are returned, never followed.
  return new Promise((resolve, reject) => {
    const payload = data === undefined ? undefined : JSON.stringify(data);
    const req = http.request({ hostname: '127.0.0.1', port, path: route, method,
      headers: { ...(payload ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}) } }, res => {
      let text = '';
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(text), text }); }
        catch { reject(new Error('Copy returned invalid JSON')); }
      });
    });
    req.setTimeout(3000, () => req.destroy(new Error('Copy request timed out')));
    req.on('error', reject);
    req.end(payload);
  });
}

export async function probeShop(port, folder) {
  const source = await readFile(path.join(folder, 'server.mjs'), 'utf8');
  const where = anchor => {
    const index = source.split('\n').findIndex(line => line.includes(anchor));
    if (index < 0) throw new Error(`Fixture anchor absent: ${anchor}`);
    return `server.mjs:${index + 1}`;
  };
  const login = await request(port, '/login', {
    method: 'POST', data: { user: 'A', password: 'demo-a' }
  });
  if (login.status !== 200 || !login.data.session) throw new Error('Control login failed');
  const token = login.data.session;
  const findings = [];
  let blocked = 0;
  for (const [route, id, anchor] of [
    ['/orders/6', 'B01', 'const requireOwner'],
    ['/safe-orders/6', 'B02-safe', "if (match[1] === 'safe-orders')"]
  ]) {
    const response = await request(port, route, { token });
    if ((response.status === 403 || response.status === 404) && response.data.owner !== 'B') { blocked++; continue; }
    if (response.data.owner !== 'B') {
      throw new Error(`Inconclusive access-control response from ${route}`);
    }
    findings.push({ id, severity: 'CRITICAL', title: "Other people's orders are open",
      Tried: `Logged in as user A, opened ${route} (user B's order)`,
      Saw: "User B's order, item and example delivery address",
      Where: where(anchor), Advice: 'Show an order only to the user who owns it' });
  }
  const empty = await request(port, '/echo', { method: 'POST', data: { text: '' }, token });
  if (empty.status === 400) blocked++;
  else if (empty.status === 500) {
    findings.push({ id: 'A01', severity: 'SMALL', title: 'Empty input crashes one request',
      Tried: 'Submitted empty text to /echo', Saw: 'HTTP 500; the server remained alive',
      Where: where('if (!data.text) throw'),
      Advice: 'Reject empty text with a clear validation message before processing it' });
  } else throw new Error('Inconclusive empty-input response');
  let limited = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    const response = await request(port, '/login', {
      method: 'POST', data: { user: 'B', password: 'wrong-demo-password' }
    });
    if (response.status === 429) { limited = true; break; }
    if (response.status !== 401) throw new Error('Unexpected wrong-login response');
  }
  if (limited) blocked++;
  else findings.push({ id: 'A09', severity: 'SMALL', title: 'No limit on login tries',
    Tried: 'Sent 50 wrong logins for synthetic user B, sequentially on localhost',
    Saw: 'All 50 answered without a retry limit', Where: where('const limited ='),
    Advice: 'Apply a bounded retry limit and a clear retry-later response' });
  const alive = await request(port, '/safe-orders/1', { token });
  if (alive.status !== 200) throw new Error('Server-alive control failed');
  return { project: 'shop-app', findings,
    attacks: { tried: 4, blocked, gotThrough: findings.length } };
}

async function round(source, number, workspace, runFolders) {
  cli('check', source, '--url', 'http://localhost:4000');
  const runId = cli('copy', source);
  const copy = path.join(os.tmpdir(), 'break-it', runId, 'copy');
  runFolders.push(path.dirname(copy));
  let app;
  let reported = false;
  try {
    app = await startShop(copy);
    const findings = await probeShop(app.port, copy);
    await stopShop(app);
    app = undefined;
    const seal = cli('seal', runId);
    if (!seal.includes('Seal: real project unchanged')) throw new Error('Seal did not pass');
    const cleanup = cli('cleanup', runId);
    if (!/^Receipt file: .+$/m.test(cleanup)) throw new Error('Cleanup returned no receipt file');
    findings.round = number;
    const file = path.join(workspace, `round-${number}.json`);
    await writeFile(file, JSON.stringify(findings));
    const report = cli('report', runId, file);
    reported = true;
    return { findings, report };
  } finally {
    if (app) await stopShop(app);
    if (!reported) {
      // A failed demo needs no future report. Dispose of the copy and any receipt.
      const disposed = spawnSync(process.execPath, [cliPath, 'cleanup', runId], { encoding: 'utf8' });
      if (/^Receipt file: /m.test(disposed.stdout || '')) cli('cleanup', runId);
    }
  }
}

export async function runDemo() {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'break-it-shop-demo-'));
  const runFolders = [];
  try {
    const first = await round(examplePath, 1, workspace, runFolders);
    const fixed = path.join(workspace, 'builder-fixed-source');
    await cp(examplePath, fixed, { recursive: true });
    const file = path.join(fixed, 'server.mjs');
    let source = await readFile(file, 'utf8');
    // Builder simulation is restricted to this synthetic fixture in the harness workspace.
    for (const name of ['limited', 'validateEmpty', 'requireOwner']) {
      source = source.replace(`const ${name} = false;`, `const ${name} = true;`);
    }
    await writeFile(file, source);
    const second = await round(fixed, 2, workspace, runFolders);
    return { output: `${first.report}\n\n${second.report}\n`,
      rounds: [first.findings, second.findings], runFolders };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await runDemo();
    if (process.argv.includes('--write')) {
      await writeFile(path.join(root, 'examples', 'shop-app-report.md'), result.output);
    }
    process.stdout.write(result.output);
  } catch (error) {
    process.stderr.write(`Demo failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
