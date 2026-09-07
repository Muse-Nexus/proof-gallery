import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { readFile, writeFile, mkdtemp, mkdir, readdir, stat, rm } from 'node:fs/promises';
import { dirname, join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';

// Explicit local assets + synthetic native authority. No live site requests,
// existing browser/profile, production Origin changes, or security bypass flags.
const repository = dirname(dirname(fileURLToPath(import.meta.url)));
const options = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => {
  if (index % 2 === 0) { assert(['--dist', '--chromium', '--agent-browser'].includes(value) && all[index + 1], 'Usage: node scripts/e2e-native.mjs --dist /absolute/built/dist [--chromium /cached/binary] [--agent-browser /cached/binary]'); pairs.push([value.slice(2), all[index + 1]]); }
  return pairs;
}, []));
assert(options.dist && options.dist.startsWith('/'), 'Supply the existing locally built dist directory; this harness never installs dependencies.');
const dist = resolve(options.dist);
const runtimeHome = process.env.HOME;
const chromium = options.chromium ?? join(runtimeHome, 'Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const agent = options['agent-browser'] ?? join(runtimeHome, '.npm/_npx/6de2aa2fded2970c/node_modules/agent-browser/bin/agent-browser-darwin-arm64');
await Promise.all([stat(chromium), stat(agent), stat(join(dist, 'index.html'))]);
const origin = 'https://proof-gallery-9jn.pages.dev';
const output = await mkdtemp('/private/tmp/proof-native-e2e-');
const profile = join(output, 'browser-profile'); await mkdir(profile, { mode: 0o700 });
const config = join(output, 'agent-browser.json'); await writeFile(config, '{}\n', { mode: 0o600 });
const cleanKeys = new Set(['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ']);
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => cleanKeys.has(key)));
const session = `native${randomUUID().slice(0, 8)}`;
const execute = promisify(execFile);
const receipts = [], nativeRequests = [], publicRequests = [], blocked = [], errors = [];
let chrome, fixtureProcess, socket, browserPort, fixture, fixtureLog = '', chromeLog = '';
let nextID = 0;
const pending = new Map(), attached = new Set();
let fatal;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message, timeout = 30_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (fatal) throw fatal; if (await check()) return; await sleep(80); }
  throw new Error(message);
}
async function walk(directory, prefix = '') {
  const files = new Map();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const path = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) for (const [key, value] of await walk(join(directory, entry.name), path)) files.set(key, value);
    else if (/\.(html|js|css|svg|png|webp|jpe?g|gif|ico|woff2?|webmanifest)$/.test(path)) files.set(path, await readFile(join(directory, entry.name)));
  }
  return files;
}
const files = await walk(dist);
const headers = await readFile(join(dist, '_headers'), 'utf8').catch(() => '');
const csp = headers.match(/Content-Security-Policy: (.+)/)?.[1];
assert(csp, 'Built public CSP is required; never weaken it for the fixture.');
function mime(path) { return ({ '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' })[extname(path)] ?? 'text/html'; }
function cdp(method, params = {}, sessionId) {
  const id = ++nextID;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15_000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
async function intercept(event) {
  const { requestId, request } = event.params;
  const url = new URL(request.url);
  if (url.origin === origin) {
    const path = url.pathname === '/' ? '/index.html' : url.pathname === '/offline' ? '/offline.html' : url.pathname;
    publicRequests.push(path);
    const bytes = files.get(path);
    await cdp('Fetch.fulfillRequest', { requestId, responseCode: bytes && request.method === 'GET' ? 200 : 404,
      responseHeaders: [{ name: 'Content-Type', value: mime(path) }, { name: 'Cache-Control', value: 'no-store' },
        { name: 'Content-Security-Policy', value: csp }, { name: 'Referrer-Policy', value: 'no-referrer' }],
      body: (bytes && request.method === 'GET' ? bytes : Buffer.from('Synthetic fixture: not found')).toString('base64') }, event.sessionId);
  } else if (url.origin === `http://127.0.0.1:${fixture.port}` && url.pathname.startsWith('/v2/gallery/') && ['POST', 'OPTIONS'].includes(request.method)) {
    nativeRequests.push({ method: request.method, path: url.pathname });
    await cdp('Fetch.continueRequest', { requestId }, event.sessionId);
  } else {
    blocked.push(`${url.origin}${url.pathname}`);
    await cdp('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }, event.sessionId);
  }
}
async function guardTarget(event) {
  const id = event.params.sessionId;
  attached.add(id);
  await cdp('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }, id);
  await cdp('Network.enable', {}, id).catch(() => {});
  await cdp('Network.setBypassServiceWorker', { bypass: true }, id).catch(() => {});
  await cdp('Runtime.enable', {}, id).catch(() => {});
  await cdp('Runtime.runIfWaitingForDebugger', {}, id);
}
async function browser(...command) {
  const { stdout } = await execute(agent, ['--config', config, '--namespace', session, '--session', session,
    '--cdp', String(browserPort), '--json', '--no-webmcp', '--no-auto-dialog', ...command],
  { cwd: output, env: { ...environment, AGENT_BROWSER_AUTOSAVE_INTERVAL_MS: '0' }, timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
  const result = JSON.parse(stdout.trim()); assert.equal(result.success, true, `agent-browser ${command[0]} failed`); return result.data;
}
async function snapshot() { return browser('snapshot', '-i'); }
async function ref(role, name) {
  const state = await snapshot();
  const visible = new Set(Array.from(state.snapshot.matchAll(/\bref=(e\d+)\b/g), m => m[1]));
  const matches = Object.entries(state.refs ?? {}).filter(([id, entry]) => visible.has(id) && entry.role === role && entry.name === name);
  assert.equal(matches.length, 1, `Expected one ${role} ${name}; found ${matches.length}. ${state.snapshot}`); return `@${matches[0][0]}`;
}
async function click(name) { const id = await ref('button', name); await browser('scrollintoview', id); await browser('click', id); }
async function fill(name, value) { await browser('fill', await ref('textbox', name), value); }
async function text() { return (await browser('get', 'text', 'body')).text; }
async function hasText(value) { await until(async () => (await text()).includes(value), `Missing UI text: ${value}`); }
function pass(value) { receipts.push(value); console.log(`PASS ${value}`); }
async function assistantGet() {
  const response = await fetch(`http://127.0.0.1:${fixture.port}/v2/assistant/get`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fixture.assistantToken}` }, body: JSON.stringify({ id: fixture.pendingID }), redirect: 'error',
  });
  return { status: response.status, value: response.ok ? await response.json() : null };
}
try {
  fixtureProcess = spawn('swift', ['test', '--package-path', join(repository, 'companion/macos'), '--filter', 'NativeBrowserFixtureTests'],
    { cwd: output, env: { ...environment, PROOF_E2E_FIXTURE_DIRECTORY: output }, stdio: ['ignore', 'pipe', 'pipe'] });
  fixtureProcess.stdout.on('data', d => { fixtureLog += d.toString(); }); fixtureProcess.stderr.on('data', d => { fixtureLog += d.toString(); });
  await until(async () => { try { fixture = JSON.parse(await readFile(join(output, 'fixture.json'), 'utf8')); return true; } catch { if (fixtureProcess.exitCode !== null) throw new Error('Synthetic native fixture failed to start'); return false; } }, 'Native fixture timed out', 60_000);
  chrome = spawn(chromium, ['--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-pings',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=127.0.0.1', 'about:blank'],
    { cwd: output, env: environment, stdio: ['ignore', 'ignore', 'pipe'] });
  chrome.stderr.on('data', d => { chromeLog += d.toString(); });
  let endpoint;
  await until(async () => { try { const [port, path] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split('\n'); browserPort = Number(port); endpoint = `ws://127.0.0.1:${port}${path}`; return true; } catch { return false; } }, 'Isolated Chromium failed to start');
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) { const call = pending.get(message.id); if (call) { clearTimeout(call.timeout); pending.delete(message.id); message.error ? call.reject(new Error(`CDP ${message.error.message}`)) : call.resolve(message.result); } return; }
    if (message.method === 'Fetch.requestPaused') intercept(message).catch(error => { if (!/Session with given id not found/.test(error.message)) fatal = error; });
    if (message.method === 'Target.attachedToTarget') guardTarget(message).catch(error => { if (!/Session with given id not found/.test(error.message)) fatal = error; });
    if (message.method === 'Target.detachedFromTarget') attached.delete(message.params.sessionId);
    if (message.method === 'Runtime.exceptionThrown') errors.push({ text: message.params.exceptionDetails.text, url: message.params.exceptionDetails.url, description: message.params.exceptionDetails.exception?.description });
  });
  await cdp('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  await until(() => attached.size > 0, 'No guarded browser target attached');
  // Fixture-only permission for the isolated profile. No user OS/browser grant.
  await cdp('Browser.setPermission', { permission: { name: 'loopback-network' }, setting: 'granted', origin });
  await browser('open', origin);
  await snapshot();
  assert((await text()).trim().length > 0, 'Blank app');
  await browser('screenshot', join(output, 'landing.png'));
  pass('agent-browser loaded local public app assets at unchanged official Origin');
  await click('Connect native vault');
  await fill('Native gallery connection code', `${fixture.port}.${fixture.galleryToken}.${fixture.collectionID}`);
  await click('Connect native vault');
  await hasText('Connected to a separate native collection.');
  assert(!(await text()).includes(fixture.literal), 'Connect unexpectedly surfaced evidence');
  assert.notEqual((await assistantGet()).status, 200, 'Pending item leaked to assistant');
  pass('actual browser connected to native authority without surfacing pending evidence');
  await click('Open pending review'); await hasText(fixture.literal);
  await click('Review candidate'); await browser('select', await ref('combobox', 'Category'), 'creativity');
  await click('Approve and save Proof'); await hasText('Saved in the native vault.');
  const approved = await assistantGet(); assert.equal(approved.status, 200); assert.equal(approved.value.item.fields.evidenceText, fixture.literal); assert.equal(approved.value.item.fields.occurredOn, fixture.occurredOn);
  pass('browser approval changed the same native record exposed to assistant reads');
  await click('Open saved Proof'); await hasText(fixture.literal); await click('Open attachment');
  await until(async () => (await browser('eval', 'Boolean(document.querySelector(".native-vault img")?.complete && document.querySelector(".native-vault img")?.naturalWidth > 0)')).result === true, 'Synthetic native attachment did not decode');
  await browser('screenshot', join(output, 'native-saved.png'), '--full');
  await click('Edit Proof'); const edited = 'I did not promise a result. Synthetic owner edit.';
  await fill('Exact words or note', edited); await click('Save in native vault'); await hasText('Saved in the native vault.');
  assert.equal((await assistantGet()).value.item.fields.evidenceText, edited);
  pass('native media decoded and browser edit remained source-faithful in same vault');
  await click('Open saved Proof'); await hasText(edited);
  await writeFile(join(output, 'revoke'), 'revoke', { mode: 0o600 });
  await until(async () => { try { await stat(join(output, 'revoked')); return true; } catch { return false; } }, 'Synthetic revocation not acknowledged');
  await click('Open saved Proof'); await hasText('Native connection unavailable or changed.');
  assert(!(await text()).includes(edited), 'Revoked UI retained literal evidence');
  pass('native grant revocation cleared browser evidence and disconnected');
  assert.equal(errors.length, 0, 'Uncaught browser exception');
  assert(nativeRequests.some(r => r.path === '/v2/gallery/approve' && r.method === 'POST'));
  await browser('errors'); await browser('screenshot', join(output, 'native-revoked.png'));
  await writeFile(join(output, 'receipt.json'), JSON.stringify({ origin, dist, indexSHA256: createHash('sha256').update(files.get('/index.html')).digest('hex'), receipts, publicRequests, nativeRequests, blocked, browserExceptions: errors, ephemeralLoopbackNetworkPermission: true }, null, 2));
  console.log(`Synthetic browser/native receipt: ${join(output, 'receipt.json')}`);
} catch (error) {
  await writeFile(join(output, 'failure.txt'), String(error));
  if (browserPort) {
    await browser('screenshot', join(output, 'failure.png')).catch(() => {});
    await writeFile(join(output, 'browser-errors.json'), JSON.stringify(await browser('errors').catch(() => ({})), null, 2));
    await writeFile(join(output, 'browser-console.json'), JSON.stringify(await browser('console').catch(() => ({})), null, 2));
    await writeFile(join(output, 'failure-snapshot.json'), JSON.stringify(await snapshot().catch(() => ({})), null, 2));
  }
  await writeFile(join(output, 'network-receipt.json'), JSON.stringify({publicRequests, nativeRequests, blocked, errors}, null, 2));
  console.error(`Native browser E2E failed: ${error.message}. Synthetic diagnostics: ${output}`);
  process.exitCode = 1;
} finally {
  await writeFile(join(output, 'stop'), 'stop', { mode: 0o600 });
  if (browserPort) await browser('close').catch(() => {});
  if (socket?.readyState === WebSocket.OPEN) socket.close();
  if (chrome && chrome.exitCode === null) {
    const closed = new Promise(resolve => chrome.once('exit', resolve)); chrome.kill('SIGTERM');
    await Promise.race([closed, sleep(2000)]);
    if (chrome.exitCode === null) { chrome.kill('SIGKILL'); await Promise.race([closed, sleep(1000)]); }
  }
  if (fixtureProcess) { await Promise.race([new Promise(resolve => fixtureProcess.once('exit', resolve)), sleep(2000)]); if (fixtureProcess.exitCode === null) fixtureProcess.kill('SIGTERM'); }
  await writeFile(join(output, 'native-test.log'), fixtureLog);
  await writeFile(join(output, 'chromium.log'), chromeLog);
  await rm(join(output, 'fixture.json'), { force: true });
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
