export const PROOF_SHELL_CACHE_PREFIX = "proof-gallery-public-shell-v1-";

/** Build-time code generation: an explicit public asset list, never runtime/evidence caching. */
export function buildProofWorker(assets: readonly string[], revision: string): string {
  if (!/^[a-f0-9]{16}$/.test(revision) || !assets.includes("/") || !assets.includes("/offline") ||
    assets.some(path => path !== "/" && !/^\/(?:offline|manifest\.webmanifest|favicon\.svg|icons\/proof-(?:192|512)\.svg|assets\/[A-Za-z0-9_.-]+\.(?:js|css|woff2?))$/.test(path))) {
    throw new Error("Invalid public app-shell cache manifest");
  }
  return `/* Generated public app shell only. No gallery reads, uploads, share target, or background collection. */
const PREFIX = ${JSON.stringify(PROOF_SHELL_CACHE_PREFIX)};
const CACHE = PREFIX + ${JSON.stringify(revision)};
const ASSETS = ${JSON.stringify([...new Set(assets)].sort())};
const ALLOWED = new Set(ASSETS);
self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      await cache.addAll(ASSETS.map(path => new Request(new URL(path, self.location.origin), { credentials: "omit", cache: "reload", redirect: "error" })));
    } catch (error) { await caches.delete(CACHE); throw error; }
  })());
  // Updates wait for all old tabs/windows to close. Never force activation or reload an editor.
});
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(PREFIX) && name !== CACHE).map(name => caches.delete(name)));
  })());
  // Already-open pages keep their existing controller/version.
});
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.search ||
      request.headers.has("authorization") || request.headers.has("range")) return;
  if (ALLOWED.has(url.pathname)) {
    event.respondWith((async () => {
      const cached = await (await caches.open(CACHE)).match(url.pathname);
      // Missing shell entries do not trigger runtime caching, even during recovery.
      return cached || fetch(request);
    })());
  } else if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () =>
      (await (await caches.open(CACHE)).match("/offline")) || new Response("Proof is offline. Reopen the gallery when connected.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })
    ));
  }
});
`;
}
