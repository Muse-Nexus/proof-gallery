import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { buildProofWorker, PROOF_SHELL_CACHE_PREFIX } from "./pwa-worker";

const assets = ["/index.html", "/offline.html", "/assets/app-a123.js", "/assets/app-b456.css"];
function worker({ failInstall = false, offline = false } = {}) {
  type WorkerEvent = { request?: Request; waitUntil: (promise: Promise<unknown>) => void; respondWith: (promise: Promise<Response>) => void };
  const handlers = new Map<string, (event: WorkerEvent) => void>();
  const cache = { addAll: vi.fn(async (_requests: Request[]) => { if (failInstall) throw new Error("Synthetic install failure"); }), match: vi.fn(async (path: string) => new Response(`Public ${path}`)) };
  const caches = {
    open: vi.fn(async () => cache),
    keys: vi.fn(async () => ["unrelated-cache", `${PROOF_SHELL_CACHE_PREFIX}old`, `${PROOF_SHELL_CACHE_PREFIX}1234567890abcdef`]),
    delete: vi.fn(async () => true),
  };
  const fetch = vi.fn(async () => { if (offline) throw new Error("Offline"); return new Response("Network"); });
  const self = { location: { origin: "https://proof.example" }, addEventListener: (name: string, fn: (event: WorkerEvent) => void) => handlers.set(name, fn) };
  runInNewContext(buildProofWorker(assets, "1234567890abcdef"), { self, caches, fetch, Request, Response, URL });
  async function run(name: string, request?: Request) {
    let work: Promise<unknown> | undefined;
    let response: Promise<Response> | undefined;
    handlers.get(name)!({ request, waitUntil: promise => { work = promise; }, respondWith: promise => { response = promise; } });
    await work;
    return response ? await response : undefined;
  }
  return { run, cache, caches, fetch, handlers };
}

describe("public app-shell worker", () => {
  it("rejects a cache manifest containing API, media, query strings, or arbitrary files", () => {
    for (const path of ["/api/proof", "/media/one.png", "/?token=private", "https://elsewhere.example/app.js", "/assets/private.png"]) {
      expect(() => buildProofWorker([...assets, path], "1234567890abcdef")).toThrow("Invalid public");
    }
  });
  it("precaches only the explicit public list, without credentials or redirects", async () => {
    const fixture = worker();
    await fixture.run("install");
    const requests = fixture.cache.addAll.mock.calls[0][0];
    expect(requests.map(request => new URL(request.url).pathname).sort()).toEqual([...assets].sort());
    expect(requests.every(request => request.credentials === "omit" && request.redirect === "error" && request.cache === "reload")).toBe(true);
    expect([...fixture.handlers.keys()].sort()).toEqual(["activate", "fetch", "install"]);
    expect(buildProofWorker(assets, "1234567890abcdef")).not.toMatch(/skipWaiting\(|clients\.claim\(|indexedDB|postMessage\(|caches\.match\(/);
  });
  it("fails a new install cleanly without touching another cache", async () => {
    const fixture = worker({ failInstall: true });
    await expect(fixture.run("install")).rejects.toThrow("Synthetic install failure");
    expect(fixture.caches.delete).toHaveBeenCalledExactlyOnceWith(`${PROOF_SHELL_CACHE_PREFIX}1234567890abcdef`);
  });
  it("deletes only old caches with its exact owned prefix on activation", async () => {
    const fixture = worker();
    await fixture.run("activate");
    expect(fixture.caches.delete).toHaveBeenCalledExactlyOnceWith(`${PROOF_SHELL_CACHE_PREFIX}old`);
  });
  it.each([
    ["https://proof.example/api/proof", {}],
    ["https://proof.example/media/private.png", {}],
    ["https://owner.supabase.co/storage/private.png", {}],
    ["https://proof.example/assets/app-a123.js?secret=1", {}],
    ["https://proof.example/assets/app-a123.js", { headers: { Authorization: "Synthetic" } }],
    ["https://proof.example/assets/app-a123.js", { headers: { Range: "bytes=0-4" } }],
    ["https://proof.example/", { method: "POST", body: "Synthetic" }],
  ])("does not intercept or cache private/non-shell request %s", async (url, options) => {
    const fixture = worker();
    expect(await fixture.run("fetch", new Request(url, options))).toBeUndefined();
    expect(fixture.cache.match).not.toHaveBeenCalled();
    expect(fixture.fetch).not.toHaveBeenCalled();
  });
  it("serves an offline root from the public shell and unknown navigation from generic help", async () => {
    const fixture = worker({ offline: true });
    const root = new Request("https://proof.example/");
    Object.defineProperty(root, "mode", { value: "navigate" });
    expect(await (await fixture.run("fetch", root))!.text()).toBe("Public /index.html");
    const unknown = new Request("https://proof.example/unavailable");
    Object.defineProperty(unknown, "mode", { value: "navigate" });
    expect(await (await fixture.run("fetch", unknown))!.text()).toBe("Public /offline.html");
    expect(fixture.cache.addAll).not.toHaveBeenCalled();
  });
});
