// Reproducible teaching fixture only; not a generic attack runner or code fixer.
import { fork, spawnSync } from 'node:child_process';
import { sendRequest } from './lib/send.mjs';
import { runLoad } from './lib/load.mjs';
import { runNet } from './lib/network.mjs';
import { makeFile } from './lib/files.mjs';
import { uploadRequest } from './lib/upload.mjs';
import { runSessions, formatSessions } from './lib/sessions.mjs';
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
  const knownSource = await readFile(path.join(copy, 'server.mjs'), 'utf8');
  const outsideReads = [];
  for (const name of ['..%2Fserver.mjs', '%2E%2E%2Fserver.mjs']) {
    outsideReads.push(await sendRequest('GET', `${base}/uploads/${name}`, { token }));
  }
  const hasSource = response => response.body.length > 0 && knownSource.startsWith(response.body);
  if (outsideReads.some(response => response.status === 200 && hasSource(response))) {
    findings.push({ id: 'E08', severity: 'CRITICAL', title: 'Reads outside the upload folder',
      Tried: 'Requested server.mjs one level above uploads inside the copy using ..%2F and %2E%2E%2F',
      Saw: `server.mjs: HTTP ${outsideReads.map(response => response.status).join(' and HTTP ')}`,
      Where: where('try { bytes = await readFile(path.join(uploadsFolder, name)); }'),
      Advice: 'Refuse download names whose resolved paths leave the upload folder before checking file ownership' });
  } else if (outsideReads.every(response => response.status >= 400 && response.status < 500 && !hasSource(response))) blocked++;
  else throw new Error('Inconclusive outside-upload-folder read');
  return { findings, blocked };
}

async function probeNetwork(port, folder, runId, token, where, source) {
  const base = `http://127.0.0.1:${port}`;
  const probe = `${base}/catalog`;
  const findings = [], observations = [];
  let blocked = 0;
  const cutFile = await makeFile(runId, 'medium-png');
  const complete = await uploadRequest(runId, 'POST', `${base}/upload`, { file: cutFile.name, token });
  if (complete.status !== 201 || JSON.parse(complete.body).bytes !== cutFile.bytes) {
    throw new Error('Complete upload control failed before the cut connection');
  }
  const before = await request(port, '/notes', { method: 'POST', token, data: { text: 'network-control' } });
  if (before.status !== 201) throw new Error('Normal save control failed before Family F');
  const cut = await runNet(runId, 'cut', 'POST', `${base}/upload`, { file: cutFile.name, token, probe });
  observations.push({ id: 'F01', result: cut });
  if (cut.probeAfter.status !== 200) throw new Error('Copy stopped answering after cut; stop Family F');
  const file = path.join(folder, 'uploads', cutFile.name);
  const stored = await readFile(file);
  const read = await sendRequest('GET', `${base}/uploads/${cutFile.name}`, { token });
  if (read.status !== 200) throw new Error('Upload read-back control failed after cut');
  if (stored.length < cutFile.bytes) {
    findings.push({ id: 'F01', severity: 'SMALL', title: 'A cut upload leaves an incomplete file available',
      Tried: 'Uploaded a complete generated 100 KiB PNG, then sent half its multipart body and closed',
      Saw: `The copy still answered; ${stored.length} of ${cutFile.bytes} file bytes remained in uploads and GET served HTTP 200`,
      Where: where('const keepCompleteUploads ='),
      Advice: 'Keep the prior file intact and publish an upload only after the complete request has arrived' });
  } else if (stored.length === cutFile.bytes) blocked++;
  else throw new Error('Unexpected cut-upload storage size');
  for (const [id, kind] of [['F02', 'slow'], ['F04', 'short']]) {
    const result = await runNet(runId, kind, 'POST', `${base}/notes`, {
      probe, token, seconds: 1, ...(kind === 'short' ? { json: JSON.stringify({ text: 'not-complete' }) } : {})
    });
    observations.push({ id, result });
    if (result.probeAfter.status !== 200) throw new Error(`Copy stopped answering after ${kind}; stop Family F`);
    if (result.probeDuring?.status !== 200) {
      throw new Error(`Unexpected during-probe outage for ${kind}; stop Family F`);
    }
    if (result.outcome === 'limit' && source.includes('const boundedConnections = false;')) {
      findings.push({ id, severity: 'SMALL', title: kind === 'slow' ? 'Slow headers have no app time limit' : 'An incomplete body has no app time limit',
        Tried: kind === 'slow' ? 'Dripped request headers one byte every 500 ms for one second while probing catalog'
          : 'Sent ten bytes of a longer JSON body and went silent for one second while probing catalog',
        Saw: 'The during and after probes answered HTTP 200; the connection stayed open at our cap and source confirms headersTimeout and requestTimeout are 0',
        Where: where('const boundedConnections ='),
        Advice: 'Set short bounded header and request time limits; F02 and F04 share this one configuration cause' });
    } else if (result.outcome !== 'limit') blocked++;
    else throw new Error(`Inconclusive ${kind} connection at our own cap`);
  }
  const leave = await runNet(runId, 'leave', 'POST', `${base}/notes`, {
    probe, token, json: JSON.stringify({ text: 'left-early' })
  });
  observations.push({ id: 'F03', result: leave });
  if (leave.probeAfter.status !== 200) throw new Error('Copy stopped answering after leave; stop Family F');
  const saved = await request(port, '/notes', { token });
  const actions = saved.data.notes?.filter(note => note.text === 'left-early');
  if (saved.status !== 200 || !actions || actions.length > 1 ||
      actions.some(note => note.owner !== 'A')) throw new Error('Leave save control was duplicated or half-done');
  blocked++;
  for (const kind of ['garbage', 'bad-header', 'huge-header', 'two-lengths']) {
    const result = await runNet(runId, kind, 'GET', `${base}/catalog`, { probe });
    observations.push({ id: `F05-${kind}`, result });
    if (result.probeAfter.status !== 200) throw new Error(`Copy stopped answering after ${kind}; stop Family F`);
    if (result.outcome === 'closed' || result.outcome === 'reset' ||
        result.response?.status >= 400 && result.response.status < 500) blocked++;
    else throw new Error(`Broken-request safe control failed for ${kind}`);
  }
  const after = await request(port, '/notes', { method: 'POST', token, data: { text: 'network-after-control' } });
  if (after.status !== 201) throw new Error('Normal save control failed after Family F');
  return { findings, blocked, observations };
}

export async function probeLogin(port, runId, where, source) {
  const base = `http://127.0.0.1:${port}`;
  const findings = [], observations = [];
  let blocked = 0;
  const login = async (password = 'example-a', jar) => {
    const response = await sendRequest('POST', `${base}/login`, {
      json: JSON.stringify({ user: 'A', password }), ...(jar ? { jar } : {})
    });
    if (response.status !== 200 || response.cut) throw new Error('Family G correct-login control failed; stop at any lockout');
    const token = JSON.parse(response.body).session;
    if (typeof token !== 'string' || !token) throw new Error('Family G login returned no session');
    return { response, token };
  };
  const read = options => sendRequest('GET', `${base}/safe-orders/1`, options);
  const initial = await login('example-a', runId);
  if ((await read({ token: initial.token })).status !== 200 || (await read({ jar: runId })).status !== 200) {
    throw new Error('Family G bearer and cookie controls failed before the family');
  }
  const samples = await runSessions(runId, 'POST', `${base}/login`, {
    json: JSON.stringify({ user: 'A', password: 'example-a' }), field: 'session', count: 10
  });
  if (samples.status !== undefined) throw new Error('Family G sampling stopped; stop at any lockout');
  const patterned = samples.patterns.some(pattern => ['repeats', 'counts up', 'contains the time', 'contains the user name'].includes(pattern));
  if (patterned || samples.roughStrengthBits < 64) findings.push({ id: 'G03', severity: patterned ? 'CRITICAL' : 'SMALL',
    title: 'Login values have a predictable shape',
    Tried: 'Logged in ten times sequentially as synthetic user A; A09 uses separate user B and budgets are tracked per user',
    Saw: formatSessions(samples).replace(/\n/g, '; '), Where: where('const unpredictableSessions ='),
    Advice: 'Issue unpredictable session values; no pattern found in a small sample would not prove randomness' });
  else blocked++;
  observations.push({ id: 'G03', samples });
  await login('example-a', runId);
  if ((await read({ jar: runId })).status !== 200) throw new Error('Family G jar control failed before logout');
  const logout = await sendRequest('POST', `${base}/logout`, { jar: runId, hold: true });
  if (logout.status !== 200 || !logout.headers['set-cookie']?.some(cookie => /;\s*Max-Age=0(?:;|$)/i.test(cookie))) {
    throw new Error('Family G logout control failed');
  }
  const reused = await read({ jar: runId });
  if (reused.status === 200) findings.push({ id: 'G01', severity: 'CRITICAL', title: 'Logout leaves the old login working',
    Tried: 'Logged in with the jar, called POST /logout with hold, then reused its old cookie on the own-order route',
    Saw: 'Logout cleared the cookie, but the held old session still answered HTTP 200', Where: where('const invalidateLogout ='),
    Advice: 'Invalidate the server session when logging out' });
  else if (reused.status === 401) blocked++;
  else throw new Error('Inconclusive logout reuse response');
  observations.push({ id: 'G01', status: reused.status });
  for (const forge of ['made-up', 'one-char']) {
    const forged = await read({ token: initial.token, forge });
    if (forged.status !== 401) throw new Error('Family G forged-session safe control failed');
  }
  blocked++;
  observations.push({ id: 'G02', blocked: true, kinds: ['made-up', 'one-char'], skipped: 'JWT kinds: the shop does not issue JWTs' });
  const cookie = initial.response.headers['set-cookie'].find(value => value.startsWith('shop_session='));
  if (!cookie) throw new Error('Family G cookie control absent');
  if (!/;\s*(?:Max-Age|Expires)=/i.test(cookie) && source.includes('const expireSessions = false;')) {
    findings.push({ id: 'G04', severity: 'SMALL', title: 'Login sessions have no enforced lifetime',
      Tried: 'Read the copy session lifetime code and the login cookie attributes without waiting',
      Saw: 'Session expiration is disabled; stored sessions have no expiry and the cookie has no Max-Age or Expires',
      Where: where('const expireSessions ='), Advice: 'Enforce a bounded server lifetime and give the session cookie a matching lifetime' });
  } else if (/;\s*Max-Age=1800(?:;|$)/.test(cookie) && source.includes('const expireSessions = true;')) blocked++;
  else throw new Error('Inconclusive session lifetime configuration');
  if (!/;\s*HttpOnly(?:;|$)/i.test(cookie) || !/;\s*SameSite=/i.test(cookie)) {
    findings.push({ id: 'G06', severity: 'SMALL', title: 'The login cookie lacks protective flags',
      Tried: 'Read only the session cookie attribute names from the login reply',
      Saw: 'The session cookie lacks HttpOnly and SameSite; Secure needs production configuration review, not a localhost HTTP verdict',
      Where: where('const protectedCookie ='), Advice: 'Add HttpOnly and SameSite, and judge Secure from the production HTTPS settings' });
  } else blocked++;
  const wrong = await sendRequest('POST', `${base}/login`, {
    json: JSON.stringify({ user: 'A', password: 'wrong-local-password' }) });
  const absent = await sendRequest('POST', `${base}/login`, {
    json: JSON.stringify({ user: 'absent-local-user', password: 'wrong-local-password' }) });
  if (wrong.status === 429 || absent.status === 429) throw new Error('Family G login locked out; stop');
  if (wrong.status !== 401 || absent.status !== 401) throw new Error('Family G wrong-login controls failed');
  if (wrong.body !== absent.body) findings.push({ id: 'G07', severity: 'SMALL', title: 'Login errors reveal which users exist',
    Tried: 'Compared one wrong password for synthetic user A with one made-up user name',
    Saw: 'Both replies were HTTP 401, but one said Wrong password and the other No such user',
    Where: where('const uniformLoginErrors ='), Advice: 'Return the same status and plain message for both failed logins' });
  else blocked++;
  const first = await login(), other = await login();
  const changed = await sendRequest('POST', `${base}/password`, { token: first.token,
    json: JSON.stringify({ current: 'example-a', password: 'example-a-new' }) });
  if (changed.status !== 200) throw new Error('Family G own-password-change control failed');
  const oldLogin = await read({ token: other.token });
  if (oldLogin.status === 200) findings.push({ id: 'G05', severity: 'SMALL', title: 'Changing the password leaves another login working',
    Tried: 'Logged in twice, changed the own password with one session, then tested the other session',
    Saw: 'The other session still answered HTTP 200 after the password change',
    Where: where('const invalidateOtherSessions ='), Advice: 'End the user other sessions when the password changes' });
  else if (oldLogin.status === 401) blocked++;
  else throw new Error('Inconclusive other-session response after password change');
  const after = await login('example-a-new', runId);
  if ((await read({ token: after.token })).status !== 200 || (await read({ jar: runId })).status !== 200) {
    throw new Error('Family G correct-login/session controls failed after the family');
  }
  blocked++;
  observations.push({ id: 'G-safe', before: 200, after: 200 });
  const order = ['G01', 'G02', 'G03', 'G04', 'G05', 'G06', 'G07'];
  findings.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  return { findings, blocked, observations };
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
  let network = [];
  if (runId) {
    const results = await probeNetwork(port, folder, runId, token, where, source);
    findings.push(...results.findings);
    blocked += results.blocked;
    network = results.observations;
  }
  let loginObservations = [];
  if (runId) {
    const results = await probeLogin(port, runId, where, source);
    findings.push(...results.findings);
    blocked += results.blocked;
    loginObservations = results.observations;
  }
  const skipped = [
    { id: 'E02', reason: 'Claimed-type case covered by separate upload tests' },
    { id: 'E05', reason: 'Shop stores archives without unpacking them; archive bytes covered by separate tests' },
    { id: 'E06', reason: 'Empty and truncated PNG cases covered by separate upload tests' }
  ];
  if (runId) skipped.push(...['G02-jwt-none', 'G02-jwt-bad-sig'].map(id => ({
    id, reason: 'The shop does not issue JWTs; unsigned and bad-signature JWT behavior is covered by local fixture tests' })));
  if (!runId) skipped.push(...['E01', 'E03', 'E04', 'E07', 'E08', 'E-safe', 'F01', 'F02', 'F03', 'F04',
    'G01', 'G02', 'G03', 'G04', 'G05', 'G06', 'G07', 'G-safe',
    'F05-garbage', 'F05-bad-header', 'F05-huge-header', 'F05-two-lengths'].map(id => ({
    id, reason: 'No sealed run id provided to this standalone fixture probe' })));
  return { project: 'shop-app', findings, skipped, network, login: loginObservations,
    attacks: { tried: runId ? 32 : 10, blocked, gotThrough: findings.length } };
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
      'limitUploads', 'safeUploadNames', 'downloadUploads', 'safeDownloadPaths', 'privateUploads',
      'keepCompleteUploads', 'boundedConnections', 'invalidateLogout', 'unpredictableSessions', 'expireSessions',
      'invalidateOtherSessions', 'protectedCookie', 'uniformLoginErrors']) {
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
