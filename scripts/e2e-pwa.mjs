import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

// Built public files only; fresh loopback server/browser; no user profile or app-store calls.
assert.equal(process.argv.length, 2, "Usage: bun scripts/e2e-pwa.mjs (run bun run build first)");
const repository = dirname(dirname(fileURLToPath(import.meta.url)));
assert(!(await readdir(repository)).some(name => /^\.env(?:\.|$)/.test(name) && name !== ".env.example"), "Use a clean checkout without private environment files");
const dist = join(repository, "dist");
const publicPaths = ["/index.html", "/proof-sw.js", "/offline.html", "/manifest.webmanifest", "/favicon.svg", "/icons/proof-192.svg", "/icons/proof-512.svg",
  ...(await readdir(join(dist, "visuals"))).filter(name => /\.(png|webp|jpg|svg)$/.test(name)).map(name => `/visuals/${name}`),
  ...(await readdir(join(dist, "assets"))).filter(name => /\.(js|css|woff2?)$/.test(name)).map(name => `/assets/${name}`)];
const files = new Map(await Promise.all(publicPaths.map(async path => [path, await readFile(join(dist, path))])));
const cleanHtml = new Map([["/index.html", "/"], ["/offline.html", "/offline"]]);
const htmlFiles = new Map(Array.from(cleanHtml, ([file, url]) => [url, file]));
const shellPaths = publicPaths.filter(path => path !== "/proof-sw.js" && !path.startsWith("/visuals/"))
  .map(path => cleanHtml.get(path) ?? path).sort();
const manifest = JSON.parse(files.get("/manifest.webmanifest").toString());
assert(!manifest.share_target && !manifest.file_handlers, "This release must not register OS sharing/handlers");
const policy = (await readFile(join(repository, "public/_headers"), "utf8")).match(/Content-Security-Policy: (.+)/)?.[1];
let updateVersion = false;
let serverOffline = false;
const server = createServer((request, response) => {
  // CDP's page-target offline emulation can leave worker fetches online.
  // Drop fixture connections too, proving no live server supplies offline HTML.
  if (serverOffline) { request.socket.destroy(); return; }
  const url = new URL(request.url, "http://127.0.0.1");
  const path = url.pathname;
  if (request.method !== "GET") { response.writeHead(404); response.end("Synthetic server: not found"); return; }
  // Match Pages' extensionless HTML redirects: old precache URLs must fail with redirect:error.
  if (cleanHtml.has(path)) {
    response.writeHead(308, { Location: cleanHtml.get(path) + url.search, "Cache-Control": "no-store" });
    response.end(); return;
  }
  const file = files.get(htmlFiles.get(path) ?? path);
  if (!file) { response.writeHead(404); response.end("Synthetic server: not found"); return; }
  const mime = path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".svg") ? "image/svg+xml" : path.endsWith(".webp") ? "image/webp" : path.endsWith(".png") ? "image/png" : path.endsWith(".jpg") ? "image/jpeg" : path.endsWith(".webmanifest") ? "application/manifest+json" : "text/html";
  response.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-store", "Content-Security-Policy": policy, "Referrer-Policy": "no-referrer" });
  // Synthetic second-version fixture exercises the real worker lifecycle, not application storage.
  response.end(path === "/proof-sw.js" && updateVersion ? file.toString().replace(/const CACHE = PREFIX \+ "[a-f0-9]{16}"/, 'const CACHE = PREFIX + "ffffffffffffffff"') : file);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const target = `http://127.0.0.1:${server.address().port}/`;
// A separate loopback origin releases the old worker client without closing a
// Chrome target (agent-browser's per-target network guards reject that churn).
const awayServer = createServer((_request, response) => { response.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" }); response.end("<!doctype html><html lang=en><title>Synthetic empty page</title><body>Worker lifecycle test</body></html>"); });
await new Promise(resolve => awayServer.listen(0, "127.0.0.1", resolve));
const away = `http://127.0.0.1:${awayServer.address().port}/`;
const output = await mkdtemp(join(tmpdir(), "proof-pwa-synthetic-"));
const config = join(output, "agent-browser.json");
await writeFile(config, "{}\n");
const session = `pw${randomUUID().slice(0, 8)}`;
const inherited = new Set(["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "SystemRoot", "WINDIR"]);
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => inherited.has(key)));
const flags = ["agent-browser@0.36.0", "--config", config, "--namespace", session, "--session", session, "--json", "--no-webmcp", "--no-auto-dialog", "--allowed-domains", "127.0.0.1", "--idle-timeout", "3m"];
const execute = promisify(execFile);
async function browser(...command) {
  const { stdout } = await execute("bunx", [...flags, ...command], { cwd: output, env: environment, timeout: 40_000, maxBuffer: 4 * 1024 * 1024 });
  const response = JSON.parse(stdout.trim());
  assert.equal(response.success, true, `${command[0]} failed: ${JSON.stringify(response)}`);
  return response.data;
}
async function snapshot() { return browser("snapshot", "-i"); }
async function ref(role, name, scope) {
  const state = scope ? await browser("snapshot", "-i", "-s", scope) : await snapshot();
  const visible = new Set(Array.from(state.snapshot.matchAll(/\bref=(e\d+)\b/g), match => match[1]));
  const matches = Object.entries(state.refs).filter(([id, entry]) => visible.has(id) && entry.role === role && (name instanceof RegExp ? name.test(entry.name) : entry.name === name));
  assert.equal(matches.length, 1, `Expected ${role} ${name}.\n${state.snapshot}`);
  return `@${matches[0][0]}`;
}
async function click(name) { const found = await ref("button", name); await browser("scrollintoview", found); await browser("click", found); }
async function fill(name, value) { await browser("fill", await ref("textbox", name), value); }
async function text() { return (await browser("get", "text", "body")).text; }
async function evaluate(code) { return (await browser("eval", code)).result; }
async function until(check, message) {
  const end = Date.now() + 15_000;
  do { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)); } while (Date.now() < end);
  throw new Error(message);
}
async function hasText(value) { await until(async () => (await text()).includes(value), `Missing ${value}`); }
const receipts = [];
function pass(name) { receipts.push(name); console.log(`PASS ${name}`); }
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5xkAAAAASUVORK5CYII=", "base64");
const image = join(output, "SYNTHETIC-offline.png");
const pendingImage = join(output, "SYNTHETIC-pending.png");
await writeFile(image, png);
await writeFile(pendingImage, Buffer.concat([png, Buffer.from("synthetic-pending")]));
try {
  await browser("open", target);
  await browser("set", "media", "light", "reduced-motion");
  assert.equal(await evaluate('Boolean(document.body.innerText.trim()) && !document.querySelector("vite-error-overlay")'), true);
  await snapshot();
  await browser("screenshot", join(output, "landing-desktop.png"));
  for (const [file, cleanPath] of cleanHtml) {
    const redirect = await fetch(new URL(file, target), { redirect: "manual" });
    assert.equal(redirect.status, 308);
    assert.equal(redirect.headers.get("location"), cleanPath);
    await assert.rejects(fetch(new URL(file, target), { redirect: "error" }), "Redirecting filenames must not be usable as precache requests");
    const canonical = await fetch(new URL(cleanPath, target), { redirect: "error" });
    assert.equal(canonical.status, 200);
    assert.equal(await canonical.text(), files.get(file).toString());
  }
  await click("Start in this browser");
  await until(async () => await evaluate('(async () => Boolean((await navigator.serviceWorker.getRegistration())?.active))()'), "Public shell worker did not activate");
  await browser("reload");
  await snapshot(); await browser("click", ".install-proof > summary");
  await hasText("Public app files are ready offline");
  const offeredInstall = (await snapshot()).snapshot.includes('button "Install Proof"');
  const iconSizes = await evaluate('(async () => { const manifest = await (await fetch("/manifest.webmanifest")).json(); return Promise.all(manifest.icons.map(icon => new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve([image.naturalWidth, image.naturalHeight]); image.onerror = reject; image.src = icon.src; }))); })()');
  assert.deepEqual(iconSizes, [[192, 192], [512, 512]]);
  await browser("screenshot", join(output, "installation-desktop.png"), "--full");
  pass(`Pages-style HTML redirects rejected; canonical shell ready; manifest icons decoded; native install offer ${offeredInstall ? "observed" : "not offered by this test browser"}`);

  await click("Add Proof");
  await fill(/^Exact quote or evidence/, "Synthetic offline evidence: my sister sent a kind message.");
  await fill("Title", "SYNTHETIC offline saved Proof");
  await browser("select", await ref("combobox", "Category", '[role="dialog"]'), "kindness_received");
  await browser("upload", '[role="dialog"] input[type="file"]', image);
  await hasText("Media validated and ready to save");
  await click("Save Proof");
  await until(async () => !await evaluate('Boolean(document.querySelector("[role=dialog]"))'), "Save did not finish");
  await click(/^Review media/);
  await snapshot(); await browser("upload", '.media-inbox input[type="file"][accept*="image/"]', pendingImage);
  await hasText("SYNTHETIC-pending.png");
  await click("Close media inbox");
  serverOffline = true;
  await browser("set", "offline", "on");
  await browser("reload");
  await hasText("SYNTHETIC offline saved Proof");
  assert(!(await text()).includes("SYNTHETIC-pending.png"), "Pending media leaked into saved gallery");
  await browser("scrollintoview", ".gallery-grid .proof-card");
  await until(async () => await evaluate('Array.from(document.querySelectorAll(".gallery-grid img")).some(image => image.complete && image.naturalWidth > 0 && image.src.startsWith("blob:"))'), "Offline saved attachment did not decode");
  const cached = await evaluate('(async () => { const result = []; for (const name of await caches.keys()) result.push({ name, urls: (await (await caches.open(name)).keys()).map(request => new URL(request.url).pathname) }); return result; })()');
  assert.equal(cached.length, 1, "Expected one owned public shell cache");
  assert(cached[0].name.startsWith("proof-gallery-public-shell-v1-"));
  assert.deepEqual([...cached[0].urls].sort(), shellPaths, "Only the exact canonical public shell may be cached");
  await browser("screenshot", join(output, "offline-gallery-desktop.png"), "--full");
  await browser("open", new URL("synthetic-unavailable", target).href);
  await hasText("This page needs a connection");
  assert(!(await text()).includes("SYNTHETIC offline saved Proof"), "Generic offline help must not contain evidence");
  await browser("open", target);
  await hasText("SYNTHETIC offline saved Proof");
  pass(`offline saved attachment and generic fallback load; pending media excluded; cache contains only ${shellPaths.length} canonical public shell files`);

  await browser("set", "viewport", "390", "844");
  await browser("reload");
  await hasText("SYNTHETIC offline saved Proof");
  assert.equal(await evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"), true, "Mobile layout overflows horizontally");
  await snapshot(); await browser("click", ".install-proof > summary");
  await browser("scrollintoview", ".install-proof");
  await browser("screenshot", join(output, "installation-offline-mobile.png"), "--full");
  pass("mobile-sized offline gallery and installation help remain usable");

  serverOffline = false;
  await browser("set", "offline", "off");
  await browser("set", "viewport", "1280", "900");
  await click("Add Proof");
  await fill(/^Exact quote or evidence/, "SYNTHETIC unsaved editor survives waiting update");
  await evaluate('caches.open("SYNTHETIC-unrelated-cache")');
  updateVersion = true;
  await evaluate('(async () => { await (await navigator.serviceWorker.getRegistration()).update(); return true; })()');
  await until(async () => await evaluate('(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting))()'), "New worker did not wait");
  assert.equal(await evaluate('document.querySelector("[role=dialog] textarea")?.value'), "SYNTHETIC unsaved editor survives waiting update");
  await browser("screenshot", join(output, "waiting-update-keeps-editor.png"));
  await click("Cancel");
  await hasText("An app update is ready");
  await browser("open", away);
  await browser("open", target);
  await until(async () => await evaluate('(async () => { const names = await caches.keys(); return names.includes("proof-gallery-public-shell-v1-ffffffffffffffff") && names.filter(name => name.startsWith("proof-gallery-public-shell-v1-")).length === 1; })()'), "New worker did not activate and remove only old public shell");
  assert.equal(await evaluate('(async () => (await caches.keys()).includes("SYNTHETIC-unrelated-cache"))()'), true);
  const updatedPaths = await evaluate('(async () => (await (await caches.open("proof-gallery-public-shell-v1-ffffffffffffffff")).keys()).map(request => new URL(request.url).pathname).sort())()');
  assert.deepEqual(updatedPaths, shellPaths, "Update changed the canonical public cache allowlist");
  await hasText("SYNTHETIC offline saved Proof");
  pass("second worker waits without editor reload; activates only after old page closes; unrelated cache and Proof survive");
  const errors = await browser("errors");
  await writeFile(join(output, "receipt.json"), JSON.stringify({ target, receipts, offeredInstall, cached, errors, nativeOsInstallation: "not performed" }, null, 2));
  console.log(`Synthetic PWA artifacts: ${output}`);
} catch (error) {
  try { await writeFile(join(output, "failure-snapshot.json"), JSON.stringify(await snapshot(), null, 2)); await browser("screenshot", join(output, "failure.png")); } catch { /* Preserve original failure. */ }
  console.error(`Synthetic PWA failure artifacts: ${output}`);
  throw error;
} finally {
  try { await browser("close"); } finally { await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => awayServer.close(resolve))]); }
}
