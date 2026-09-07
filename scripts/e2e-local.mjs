import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";

// No production URL, existing browser, user profile, connector, or app-store API.
// All application writes below use its rendered controls and actual IndexedDB.
const execute = promisify(execFile);
const repository = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
assert(args.length === 0 || (args.length === 2 && args[0] === "--url"), "Usage: bun run test:e2e [--url http://127.0.0.1:PORT/]");
async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
const target = new URL(args[1] ?? `http://127.0.0.1:${await freePort()}/`);
assert(target.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) &&
  !target.username && !target.password && target.pathname === "/" && !target.search && !target.hash,
"Browser E2E refuses anything except a bare loopback HTTP origin.");
const output = await mkdtemp(join(tmpdir(), "proof-gallery-e2e-synthetic-"));
const downloads = join(output, "downloads");
await mkdir(downloads);
const config = join(output, "agent-browser.json");
await writeFile(config, "{}\n");
const session = `pg${randomUUID().slice(0, 8)}`;
const runtimeEnvironment = new Set(["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "SystemRoot", "WINDIR"]);
// Pass runtime necessities only: account/provider credentials and CLI overrides
// must not reach either the browser launcher or the synthetic Vite server.
const cleanEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => runtimeEnvironment.has(key)));
const flags = ["agent-browser@0.36.0", "--config", config, "--namespace", session, "--session", session,
  "--json", "--no-webmcp", "--no-auto-dialog", "--allowed-domains", target.hostname,
  "--download-path", downloads, "--idle-timeout", "3m"];
const receipts = [];
let server;
let serverLog = "";
let opened = false;

async function browser(...command) {
  const { stdout } = await execute("bunx", [...flags, ...command], {
    cwd: output, env: cleanEnvironment, timeout: 40_000, maxBuffer: 4 * 1024 * 1024,
  });
  const result = JSON.parse(stdout.trim());
  assert.equal(result.success, true, `${command[0]} failed: ${JSON.stringify(result)}`);
  return result.data;
}
async function snapshot(scope) { return browser("snapshot", "-i", ...(scope ? ["-s", scope] : [])); }
async function reference(role, name, scope) {
  const state = await snapshot(scope);
  const visibleRefs = new Set(Array.from(state.snapshot.matchAll(/\bref=(e\d+)\b/g), match => match[1]));
  const matches = Object.entries(state.refs ?? {}).filter(([id, entry]) => visibleRefs.has(id) && entry.role === role &&
    (name instanceof RegExp ? name.test(entry.name) : entry.name === name));
  assert.equal(matches.length, 1, `Expected one ${role} ${String(name)}; found ${matches.length}.\n${state.snapshot}`);
  return `@${matches[0][0]}`;
}
async function click(name, scope) {
  const ref = await reference("button", name, scope);
  await browser("scrollintoview", ref);
  return browser("click", ref);
}
async function fill(name, value, scope) { return browser("fill", await reference(name === "Search your Proof" ? "searchbox" : "textbox", name, scope), value); }
async function select(name, value, scope) { return browser("select", await reference("combobox", name, scope), value); }
async function text() { return (await browser("get", "text", "body")).text; }
async function until(check, message, timeout = 12_000) {
  const deadline = Date.now() + timeout;
  do {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error(message);
}
async function hasText(value) { await until(async () => (await text()).includes(value), `Missing visible text: ${value}`); }
async function actionWithDialog(action, accept = true) {
  const running = action();
  // The click and dialog response must be allowed to run concurrently.
  await until(async () => {
    const status = await browser("dialog", "status");
    return status.hasDialog === true || status.open === true || Boolean(status.dialog);
  }, "Expected browser confirmation dialog");
  await browser("dialog", accept ? "accept" : "dismiss");
  await running;
}
async function menu(name) {
  await snapshot();
  await browser("click", ".gallery-tools > summary");
  await click(name);
}
function passed(name) { receipts.push(name); console.log(`PASS ${name}`); }

// A known valid, synthetic one-pixel PNG, not user media or decorative artwork.
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5xkAAAAASUVORK5CYII=", "base64");
const image = join(output, "SYNTHETIC-saved.png");
const pendingImage = join(output, "SYNTHETIC-pending.png");
await writeFile(image, png);
// The validator retains original bytes; trailing marker makes the fixture distinct.
await writeFile(pendingImage, Buffer.concat([png, Buffer.from("synthetic-pending-fixture")]));
const title = "SYNTHETIC · A clear contribution";
const editedTitle = "SYNTHETIC · A thoughtful contribution";
const quote = "Synthetic reviewer: Thank you for the clear contribution. It helped our project.";
const source = "Synthetic review message · not a personal receipt";
const pendingNote = "SYNTHETIC pending-only bluebird note";
const passphrase = "synthetic-only-backup-passphrase";
const backup = join(output, "synthetic-roundtrip.proof");

try {
  if (!args.length) {
    const envFiles = (await readdir(repository)).filter(name => (name === ".env" || name.startsWith(".env.")) && name !== ".env.example");
    assert.equal(envFiles.length, 0, "Use a clean E2E checkout without .env files; the runner will not let Bun/Vite load private configuration.");
    server = spawn("bun", ["run", "dev", "--host", "127.0.0.1", "--port", target.port, "--strictPort"],
      { cwd: repository, env: cleanEnvironment, stdio: ["ignore", "pipe", "pipe"] });
    server.stdout.on("data", chunk => { serverLog = (serverLog + chunk).slice(-10_000); });
    server.stderr.on("data", chunk => { serverLog = (serverLog + chunk).slice(-10_000); });
  }
  await until(async () => { try { return (await fetch(target, { redirect: "error" })).ok; } catch { return false; } }, `Local server unavailable: ${serverLog}`, 20_000);
  opened = true; await browser("open", target.href);
  await browser("set", "viewport", "1280", "900");
  await browser("set", "media", "light", "reduced-motion");
  await click("Start in this browser");
  await hasText("Your local gallery is empty");
  await click("Add Proof");
  await fill("Title", title, '[role="dialog"]');
  await fill("Exact quote or evidence", quote, '[role="dialog"]');
  await snapshot('[role="dialog"]');
  await browser("upload", '[role="dialog"] input[type="file"]', image);
  await hasText("Media validated and ready to save");
  await snapshot('[role="dialog"]');
  // agent-browser 0.36.0 cannot reliably fill Chromium's segmented date widget.
  // Exercise the real input and React events, never app state or storage APIs.
  await browser("eval", `(() => { const input = document.querySelector('[role="dialog"] input[type="date"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '2026-08-30'); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); return input.value; })()`);
  await select("Category", "kindness_received", '[role="dialog"]');
  await select("Source type", "message", '[role="dialog"]');
  await fill(/^Exact source detail/, source, '[role="dialog"]');
  await fill("Tags", "synthetic, contribution", '[role="dialog"]');
  await click("Save Proof", '[role="dialog"]');
  await hasText(title);
  await browser("reload");
  await hasText(quote);
  await hasText(source);
  const dateLabel = (await browser("eval", `new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date('2026-08-30T00:00:00Z'))`)).result;
  await hasText(dateLabel);
  // Media resolves its blob asynchronously and the image is deliberately lazy.
  // Put the saved card in view, then wait for decoding, not just the note text.
  await browser("scrollintoview", ".gallery-grid > .proof-card");
  await until(async () => {
    const imageStatus = await browser("eval", 'Array.from(document.querySelectorAll(".proof-card img")).map(image => ({ loaded: image.complete && image.naturalWidth > 0, url: image.src.startsWith("blob:") }))');
    return imageStatus.result?.length > 0 && imageStatus.result.every(value => value.loaded && value.url);
  }, "Saved attachment must reload as an actual decoded browser blob image");
  await click("Edit");
  await fill("Title", editedTitle, '[role="dialog"]');
  await click("Save Proof", '[role="dialog"]');
  await hasText(editedTitle);
  await select("Category", "parenting", ".filters");
  await hasText("No Proof matches these filters");
  await click("Clear filters");
  await select("Tag", "contribution", ".filters");
  await hasText(editedTitle);
  await fill("Search your Proof", "clear contribution");
  await click("Search Proof");
  await hasText(editedTitle);
  await click("Read as a story");
  await hasText("A story in your own words");
  await hasText(quote);
  await click("Close story");
  await click("Clear search");
  await click("Clear filters");
  passed("Attachment + exact quote/date/source/tags survive reload; edit, filters, lexical search, and source-faithful story");

  await click(/^Review media/);
  await snapshot(".media-inbox");
  await browser("upload", '.media-inbox input[aria-label="Choose photos or clips"]', pendingImage);
  await hasText("Pending review · not saved Proof");
  await fill(/^Your short note/, pendingNote, ".media-inbox");
  await click("Save note", ".media-inbox");
  await hasText("Review details saved. This is not saved Proof yet.");
  await click("Close media inbox");
  await fill("Search your Proof", "bluebird");
  await click("Search Proof");
  await hasText("No matching Proof yet");
  await click("Clear search");
  await click(/^Review media/);
  await hasText(pendingNote);
  await click("Close media inbox");
  passed("Pending note saves without entering saved Proof search");

  await menu("Back up");
  await fill(/^Passphrase/, passphrase, ".backup-panel");
  await fill("Repeat passphrase", passphrase, ".backup-panel");
  await browser("download", await reference("button", "Download encrypted backup", ".backup-panel"), backup);
  const encrypted = await readFile(backup);
  assert.equal(encrypted.subarray(0, 8).toString(), "PROOFENC");
  assert(!encrypted.includes(Buffer.from(quote)) && !encrypted.includes(Buffer.from(pendingNote)), "Downloaded backup must not expose notes");
  await click("Close", ".backup-panel");
  await menu("Restore");
  await snapshot(".backup-panel");
  await browser("upload", '.backup-panel input[type="file"]', backup);
  await fill(/^Passphrase/, "synthetic-wrong-passphrase", ".backup-panel");
  await click("Validate and restore", ".backup-panel");
  await hasText("The passphrase is incorrect or this backup is damaged. Nothing was restored.");
  await click("Close", ".backup-panel");
  await hasText(editedTitle);
  await click(/^Review media/);
  await hasText(pendingNote);
  await click("Close media inbox");
  passed("Actual encrypted backup downloads; wrong passphrase preserves saved and pending data");

  await snapshot();
  await browser("click", ".gallery-tools > summary");
  await actionWithDialog(() => click("Remove all saved local Proof"));
  await click(/^Review media/);
  await actionWithDialog(() => click("Clear review inbox"));
  await click("Close media inbox");
  await menu("Restore");
  await snapshot(".backup-panel");
  await browser("upload", '.backup-panel input[type="file"]', backup);
  await fill(/^Passphrase/, passphrase, ".backup-panel");
  await actionWithDialog(() => click("Validate and restore", ".backup-panel"));
  await hasText("Restored 1 saved Proof and 1 pending review items");
  await click("Close", ".backup-panel");
  await hasText(editedTitle);
  await click(/^Review media/);
  await hasText(pendingNote);
  await select("Category for selected", "creativity", ".media-inbox");
  await browser("check", await reference("checkbox", "Select all 1", ".media-inbox"));
  await click("Save selected (1)", ".media-inbox");
  await click("Close media inbox");
  await fill("Search your Proof", "bluebird");
  await click("Search Proof");
  await hasText(pendingNote);
  await click("Clear search");
  passed("Downloaded backup restores saved attachment and pending note; explicit approval enables pending search");

  await click("Sources");
  // Test-only picker seam: a genuine browser-owned OPFS directory handle, never
  // an OS directory, forged handle, stored grant, or application store API.
  const folderName = "SYNTHETIC-E2E-trusted-folder";
  const automaticName = "SYNTHETIC-automatic.png";
  async function writeSyntheticSourceFile(name, marker) {
    return browser("eval", `(async () => {
      const root = await navigator.storage.getDirectory();
      const folder = await root.getDirectoryHandle(${JSON.stringify(folderName)}, { create: true });
      const file = await folder.getFileHandle(${JSON.stringify(name)}, { create: true });
      const output = await file.createWritable();
      const png = Uint8Array.from(atob(${JSON.stringify(png.toString("base64"))}), character => character.charCodeAt(0));
      await output.write(new Blob([png, ${JSON.stringify(marker)}], { type: 'image/png' }));
      await output.close();
      window.showDirectoryPicker = async options => {
        if (options?.mode !== 'read') throw new Error('E2E only permits read-mode selection');
        return folder;
      };
      return { nativeHandle: folder instanceof FileSystemDirectoryHandle, name: folder.name };
    })()`);
  }
  assert.equal((await writeSyntheticSourceFile(automaticName, "synthetic-automatic-fixture")).result.nativeHandle, true);
  await click("Choose a folder", ".folder-source");
  const consentRef = await reference("checkbox", "Allow automatic saving from this folder", ".folder-source");
  assert.equal((await browser("is", "checked", consentRef)).checked, false, "Source auto-save must start unchecked");
  await browser("check", consentRef);
  assert.equal((await browser("is", "enabled", await reference("button", "Confirm automatic saving", ".folder-source"))).enabled, false,
    "Automatic confirmation requires a manual category");
  await select("Category for every file", "creativity", ".folder-source");
  await fill("Tags for every file (optional)", "synthetic-auto", ".folder-source");
  await click("Confirm automatic saving", ".folder-source");
  await hasText("1 new item was saved automatically from your trusted folder.");
  assert(!(await text()).includes(automaticName), "Automatic intake must not surface the saved evidence before requested retrieval");
  await click("Saved Proof");
  await hasText(automaticName);
  const cardIndex = (await browser("eval", `Array.from(document.querySelectorAll('.gallery-grid > .proof-card')).findIndex(card => card.querySelector('h2')?.textContent === ${JSON.stringify(automaticName)})`)).result;
  assert(cardIndex >= 0, "Automatically saved evidence must be in the gallery only after opening it");
  const automaticCard = `.gallery-grid > .proof-card:nth-child(${cardIndex + 1})`;
  const automaticText = (await browser("get", "text", automaticCard)).text;
  assert(automaticText.includes("MISSING") && automaticText.includes(`Trusted folder: ${automaticName}`), "Unknown date stays unknown and exact source is displayed");
  await actionWithDialog(() => click("Delete", automaticCard));
  await browser("reload");
  await click("Sources");
  await hasText("Up to date. Checking again in about a minute.");
  await click("Saved Proof");
  const titlesAfterReload = (await browser("eval", `Array.from(document.querySelectorAll('.gallery-grid > .proof-card h2'), heading => heading.textContent)`)).result;
  assert.equal(titlesAfterReload.length, 2, "Only the two preexisting saved items remain after deleting and rechecking trusted media");
  assert(!titlesAfterReload.includes(automaticName), "Deleted bytes must not reappear after the trusted handle is restored");
  passed("Trusted-folder unchecked opt-in, category confirmation, actual native-handle persistence, direct save, and deleted-byte suppression after reload");

  await click("Sources");
  await click("Pause", ".folder-source");
  await hasText("Automatic saving paused");
  await browser("reload");
  await click("Sources");
  await hasText("Automatic saving paused");
  const laterName = "SYNTHETIC-later.png";
  await writeSyntheticSourceFile(laterName, "synthetic-later-fixture");
  await click("Saved Proof");
  assert(!(await text()).includes(laterName), "A persisted Pause must not collect a new file");
  await click("Sources");
  await click("Resume", ".folder-source");
  await hasText("1 new item was saved automatically from your trusted folder.");
  await click("Forget trusted folder", ".folder-source");
  await hasText("You choose the source");
  await browser("reload");
  await click("Sources");
  await hasText("You choose the source");
  await reference("button", "Choose a folder", ".folder-source");
  assert(!(await text()).includes("Automatic saving allowed"), "Forget must survive reload");
  await click("Saved Proof");
  await hasText(laterName);
  passed("Trusted Pause survives reload, explicit Resume collects new media, and Forget survives reload without deleting saved evidence");

  await browser("screenshot", join(output, "completed.png"), "--full");
  const errors = await browser("errors");
  assert.equal(errors.errors?.length ?? 0, 0, `Browser errors: ${JSON.stringify(errors)}`);
  await writeFile(join(output, "receipt.json"), JSON.stringify({ target: target.href, session, receipts,
    limitations: ["Native date input uses DOM setter plus real events", "Folder picker returns a genuine synthetic OPFS handle; not OS permission proof", "No native Photos/pairing proof", "Lexical search only; no external account or model"] }, null, 2));
  console.log(`Browser E2E passed. Synthetic-only receipt and artifacts: ${output}`);
} catch (error) {
  if (opened) {
    try { await browser("screenshot", join(output, "failure.png"), "--full"); } catch { /* Preserve original failure. */ }
    try {
      const state = await snapshot();
      await writeFile(join(output, "failure-snapshot.json"), JSON.stringify(state, null, 2));
      console.error(`Synthetic failure snapshot: ${state.snapshot}`);
    } catch { /* Preserve original failure. */ }
    try { await writeFile(join(output, "failure-text.txt"), await text()); } catch { /* Preserve original failure. */ }
  }
  console.error(`Browser E2E failed. Synthetic-only artifacts: ${output}`);
  throw error;
} finally {
  if (opened) { try { await browser("close"); } catch (error) { console.error(`Could not close owned session ${session}: ${error.message}`); } }
  server?.kill("SIGTERM");
}
