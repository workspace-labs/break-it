// Reproducible teaching fixture only; not a generic attack runner or code fixer.
import { fork, spawnSync } from 'node:child_process';
import { sendRequest } from './lib/send.mjs';
import { runLoad } from './lib/load.mjs';
import { makeFile } from './lib/files.mjs';
import { uploadRequest } from './lib/upload.mjs';
import { runPath } from './lib/runs.mjs';
import { mkdtemp, readFile, writeFile, cp, rm, realpath, readdir } from 'node:fs/promises';
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

async function request(port, route, { method = 'GET', data, token } = {}) {
  const response = await sendRequest(method, `http://127.0.0.1:${port}${route}`, {
    json: data === undefined ? undefined : JSON.stringify(data), token
  });
  if (response.cut) throw new Error('Copy response exceeded the bounded fixture output');
  try { return { status: response.status, data: JSON.parse(response.body), text: response.body }; }
  catch { throw new Error('Copy returned invalid JSON'); }
}

async function probeLoad(port, where) {
  const base = `http://127.0.0.1:${port}`;
  const options = { requests: 8, concurrency: 2 };
  const safeBefore = await runLoad('GET', `${base}/catalog`, options);
  const before = await request(port, '/catalog-refresh');
  if (before.status !== 200) throw new Error('Catalog-refresh single-request control failed');
  const burst = await runLoad('GET', `${base}/catalog-refresh`, options);
  const login = await runLoad('POST', `${base}/login`, {
    ...options, json: JSON.stringify({ user: 'admin', password: 'wrong-demo-password' })
  });
  const safeAfter = await runLoad('GET', `${base}/catalog`, options);
  const findings = [];
  let blocked = 0;
  if (burst.failed > 0) {
    findings.push({ id: 'D01', severity: 'CRITICAL', title: 'Catalog refresh stops answering under load',
      Tried: 'After one successful request, sent 8 localhost catalog-refresh requests with concurrency 2',
      Saw: `${burst.failed} requests failed without an HTTP status`,
      Where: where('if (catalogJobs.length > 4) catalogAvailable = false;'),
      Advice: 'Release completed catalog work and keep resource use bounded between requests' });
  } else if (burst.completed === options.requests && burst.statuses['2xx'] === options.requests) blocked++;
  else throw new Error('Inconclusive catalog-refresh burst');
  if (login.statuses['4xx'] === options.requests && !login.failed && login.afterBurst.status === 401) {
    findings.push({ id: 'D02', severity: 'SMALL', title: 'Login never throttles a concurrent burst',
      Tried: 'Sent 8 wrong logins for synthetic admin with concurrency 2 on localhost',
      Saw: 'The burst answered consistently and its final probe still returned HTTP 401; no retry-later response',
      Where: where('const limited ='),
      Advice: 'Bound login attempts and return a clear retry-later response to slow password guessing' });
  } else if (login.afterBurst.status === 429) blocked++;
  else throw new Error('Inconclusive login burst');
  if (!burst.afterBurst.status) {
    findings.push({ id: 'D04', severity: 'CRITICAL', title: 'Catalog refresh does not recover after the burst',
      Tried: 'Compared the successful pre-burst catalog-refresh request with the final health probe',
      Saw: 'The final request to the same target did not answer with an HTTP status',
      Where: where('if (!catalogAvailable) return req.socket.destroy();'),
      Advice: 'Release retained work so new requests still answer after the burst' });
  } else if (burst.afterBurst.status === 200) blocked++;
  else throw new Error('Inconclusive catalog-refresh recovery');
  const safe = [safeBefore, safeAfter].every(result => result.sent === options.requests &&
    result.completed === options.requests && result.failed === 0 &&
    result.statuses['2xx'] === options.requests && result.afterBurst.status === 200);
  if (!safe) throw new Error('Plain catalog safe control failed under load');
  blocked++;
  return { findings, blocked };
}

async function probeFiles(port, folder, runId, token, otherToken, where) {
  const run = await runPath(runId);
  const copy = path.join(run, 'copy');
  const uploads = await realpath(path.join(folder, 'uploads'));
  if (await realpath(folder) !== copy || path.relative(copy, uploads) !== 'uploads') {
    throw new Error('Upload folder is not inside the disposable copy; stop Family E');
  }
  const base = `http://127.0.0.1:${port}`;
  const findings = [];
  let blocked = 0;
  const normal = await makeFile(runId, 'normal-png');
  const control = await uploadRequest(runId, 'POST', `${base}/upload`, { file: normal.name, token });
  if (control.status !== 201) throw new Error('Normal upload safe control failed');
  const normalUrl = JSON.parse(control.body).url;
  const normalBytes = await readFile(path.join(run, 'files', normal.name));
  const ownerRead = await sendRequest('GET', `${base}${normalUrl}`, { token });
  if (ownerRead.status !== 200 || ownerRead.cut || ownerRead.body !== normalBytes.toString('utf8')) {
    throw new Error('Normal upload owner-read safe control failed');
  }
  blocked++;
  const big = await makeFile(runId, 'big');
  const large = await uploadRequest(runId, 'POST', `${base}/upload`, { file: big.name, token });
  const healthy = await sendRequest('GET', `${base}/catalog`);
  if (healthy.status !== 200) throw new Error('Copy stopped answering after the oversized upload');
  if (large.status >= 400 && large.status < 500) blocked++;
  else if (large.status === 201 && JSON.parse(large.body).bytes === big.bytes) {
    findings.push({ id: 'E01', severity: 'SMALL', title: 'Oversized uploads are accepted',
      Tried: 'Uploaded a generated 20 MiB file to the disposable copy',
      Saw: 'HTTP 201 accepted every byte; the copy stayed healthy',
      Where: where('const limitUploads ='), Advice: 'Reject oversized uploads with a clear 4xx before reading the whole body' });
  } else throw new Error('Inconclusive oversized-upload response');
  const escaped = await uploadRequest(runId, 'POST', `${base}/upload`, { file: normal.name, name: 'traversal', token });
  async function escapedFiles(dir, prefix = '') {
    const found = [];
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const relative = prefix + item.name;
      if (item.isFile() && item.name.startsWith('break-it-escape-')) found.push(relative);
      if (item.isDirectory()) found.push(...await escapedFiles(path.join(dir, item.name), relative + '/'));
    }
    return found;
  }
  const escapes = await escapedFiles(run);
  const expectedEscape = `copy/break-it-escape-${runId}.txt`;
  if (escapes.includes(expectedEscape)) {
    if (escaped.status !== 201 || escapes.length !== 1) throw new Error('Unexpected traversal result');
    findings.push({ id: 'E03', severity: 'CRITICAL', title: 'An upload can escape its upload folder',
      Tried: 'Uploaded a generated PNG using the one-level traversal name preset',
      Saw: `Found ${escapes.join(', ')} inside the run, outside the app upload folder`,
      Where: where('const safeUploadNames ='), Advice: 'Reject path segments and keep every saved file inside the upload folder' });
  } else if (escaped.status >= 400 && escaped.status < 500 && escapes.length === 0) blocked++;
  else throw new Error('Inconclusive traversal-upload response');
  const inlineTypes = [];
  for (const kind of ['html-script', 'svg-script']) {
    const made = await makeFile(runId, kind);
    const posted = await uploadRequest(runId, 'POST', `${base}/upload`, { file: made.name, token });
    if (posted.status !== 201) throw new Error('Script-marker upload did not return a file address');
    const response = await sendRequest('GET', `${base}${JSON.parse(posted.body).url}`, { token });
    if (response.status !== 200 || !response.body.includes('document.title')) throw new Error('Script-marker read failed');
    const headers = response.headers;
    if (/^(text\/html|image\/svg\+xml)\b/.test(headers['content-type'] || '') &&
        !/attachment/i.test(headers['content-disposition'] || '') &&
        !/sandbox/.test(headers['content-security-policy'] || '')) inlineTypes.push(headers['content-type']);
  }
  if (inlineTypes.length) findings.push({ id: 'E04', severity: 'CRITICAL', title: 'Uploaded script markers are served inline',
    Tried: 'Uploaded generated HTML and SVG title markers, then fetched the returned file addresses',
    Saw: `Served inline as ${inlineTypes.join(' and ')} without attachment or sandboxing CSP`,
    Where: where('const downloadUploads ='), Advice: 'Serve untrusted active files as attachments or isolate them with a sandboxing policy' });
  else blocked++;
  const otherRead = await sendRequest('GET', `${base}${normalUrl}`, { token: otherToken });
  const anonymousRead = await sendRequest('GET', `${base}${normalUrl}`);
  if ([otherRead, anonymousRead].some(response => response.status === 200 && response.body === normalBytes.toString('utf8'))) {
    findings.push({ id: 'E07', severity: 'CRITICAL', title: "Other people's private uploads are readable",
      Tried: "Uploaded a generated PNG as user A; fetched its address as user B and without a login",
      Saw: `User B received HTTP ${otherRead.status}; no login received HTTP ${anonymousRead.status}`,
      Where: where('const privateUploads ='), Advice: 'Check the file owner before returning any private upload' });
  } else if ([otherRead, anonymousRead].every(response => [401, 403, 404].includes(response.status))) blocked++;
  else throw new Error('Inconclusive private-upload response');
  return { findings, blocked };
}

export async function probeShop(port, folder, runId) {
  const source = await readFile(path.join(folder, 'server.mjs'), 'utf8');
  const where = anchor => {
    const index = source.split('\n').findIndex(line => line.includes(anchor));
    if (index < 0) throw new Error(`Fixture anchor absent: ${anchor}`);
    return `server.mjs:${index + 1}`;
  };
  const login = await request(port, '/login', {
    method: 'POST', data: { user: 'A', password: 'example-a' }
  });
  if (login.status !== 200 || !login.data.session) throw new Error('Control login failed');
  const token = login.data.session;
  const otherLogin = runId ? await request(port, '/login', { method: 'POST',
    data: { user: 'B', password: 'example-b' } }) : undefined;
  if (runId && !otherLogin?.data.session) throw new Error('Second upload user login failed');
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
  const profile = await request(port, '/profile', { token });
  if (profile.status !== 200 || profile.data.user !== 'A') throw new Error('Profile control failed');
  if (Object.hasOwn(profile.data, 'passwordHash')) {
    findings.push({ id: 'C03', severity: 'CRITICAL', title: 'Profile replies expose a password hash',
      Tried: 'Opened /profile as synthetic user A',
      Saw: 'The reply included a passwordHash field; its value is withheld',
      Where: where('if (!omitPrivate) profile.passwordHash'),
      Advice: 'Return only the public profile fields; never return password hashes' });
  } else blocked++;
  const detail = await request(port, '/catalog-error', { token });
  if (detail.status !== 500) throw new Error('Error-route control failed');
  if (/SQLITE_ERROR|\/srv\/shop\/catalog\.mjs/.test(detail.text)) {
    findings.push({ id: 'C04', severity: 'SMALL', title: 'Error replies expose internal details',
      Tried: 'Opened /catalog-error as synthetic user A',
      Saw: 'HTTP 500 included a database error and an internal source path',
      Where: where('const hideDetails ='),
      Advice: 'Return a plain error message without database or internal path details' });
  } else if (detail.data.error === 'Request failed') blocked++;
  else throw new Error('Inconclusive error-detail response');
  const alive = await request(port, '/safe-orders/1', { token });
  if (alive.status !== 200) throw new Error('Server-alive control failed');
  const load = await probeLoad(port, where);
  findings.push(...load.findings);
  blocked += load.blocked;
  if (runId) {
    const files = await probeFiles(port, folder, runId, token, otherLogin.data.session, where);
    findings.push(...files.findings);
    blocked += files.blocked;
  }
  const skipped = [
    { id: 'E02', reason: 'Claimed-type case covered by separate upload tests' },
    { id: 'E05', reason: 'Shop stores archives without unpacking them; archive bytes covered by separate tests' },
    { id: 'E06', reason: 'Empty and truncated PNG cases covered by separate upload tests' }
  ];
  if (!runId) skipped.push(...['E01', 'E03', 'E04', 'E07', 'E-safe'].map(id => ({
    id, reason: 'No sealed run id provided to this standalone fixture probe' })));
  return { project: 'shop-app', findings, skipped,
    attacks: { tried: runId ? 15 : 10, blocked, gotThrough: findings.length } };
}

async function round(source, number, workspace, runFolders) {
  cli('check', source, '--url', 'http://localhost:4000');
  const runId = cli('copy', source);
  const copy = path.join(os.tmpdir(), 'break-it', runId, 'copy');
  runFolders.push(path.dirname(copy));
  let app;
  let reported = false;
  try {
    const before = cli('scan', runId);
    const configHit = /^(config\.mjs:[1-9]\d*)  (.+)$/m.exec(before);
    if (before !== 'No secrets found' && (!configHit || before.split('\n').length !== 1)) {
      throw new Error('Unexpected file-scan result in synthetic shop');
    }
    if (before.includes('.env.example:')) throw new Error('Placeholder safe control was flagged');
    app = await startShop(copy);
    const findings = await probeShop(app.port, copy, runId);
    const after = cli('scan', runId);
    if (after !== before) throw new Error('Unexpected new file-scan result after synthetic tries');
    findings.attacks.tried += 2;
    findings.attacks.blocked++;
    if (configHit) {
      findings.findings.unshift({ id: 'C01', severity: 'CRITICAL', title: 'A secret is stored in configuration',
        Tried: 'Scanned the copy before startup and after the requests',
        Saw: `A config assignment matched ${configHit[2]}`,
        Where: configHit[1], Advice: 'Keep secret values out of source files and build output' });
      findings.attacks.gotThrough++;
    } else findings.attacks.blocked++;

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
    for (const name of ['limited', 'validateEmpty', 'requireOwner', 'omitPrivate', 'hideDetails', 'releaseCatalogWork',
      'limitUploads', 'safeUploadNames', 'downloadUploads', 'privateUploads']) {
      source = source.replace(`const ${name} = false;`, `const ${name} = true;`);
    }
    await writeFile(file, source);
    await writeFile(path.join(fixed, 'config.mjs'), 'export const API_KEY = "";\n');
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
