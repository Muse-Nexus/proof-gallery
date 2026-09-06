import "fake-indexeddb/auto";
import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import { webcrypto } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { clearLocalProofCandidates, clearLocalProofItems, countLocalProofCandidates, listLocalProofCandidates, resolveLocalProofCandidates, searchLocalProofItems, stageLocalProofMedia } from "./local-proof-store";
import { FolderSourceWatch } from "./folder-source";

const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);
function png() { return new File([pngBytes], "synthetic.png", { type: "image/png", lastModified: 1 }); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}
beforeAll(() => {
  vi.stubGlobal("Blob", NodeBlob); vi.stubGlobal("File", NodeFile); vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("BroadcastChannel", undefined);
  URL.createObjectURL = vi.fn(() => "blob:synthetic-review"); URL.revokeObjectURL = vi.fn();
});
beforeEach(async () => { await clearLocalProofItems(); await clearLocalProofCandidates(); });
afterEach(() => vi.restoreAllMocks());
afterAll(() => vi.unstubAllGlobals());

it("folder checks stage private pending media and leave dates, meaning, and saved search untouched", async () => {
  const network = vi.spyOn(globalThis, "fetch");
  const watch = new FolderSourceWatch({ kind: "directory", name: "Synthetic folder",
    queryPermission: async () => "granted", requestPermission: async () => "granted",
    values: async function* () { yield { kind: "file", name: "synthetic.png", getFile: async () => png() }; },
  }, vi.fn());
  try {
    await watch.start();
    const [candidate] = await listLocalProofCandidates();
    expect(candidate).toMatchObject({ visibility: "personal", userId: "local-browser-owner",
      input: { occurredOn: null, evidenceText: "", category: null, source: "Selected file: synthetic.png" } });
    expect((await searchLocalProofItems("synthetic")).items).toEqual([]);
    expect(network).not.toHaveBeenCalled();
  } finally { watch.disconnect(); }
});

it("counts pending candidates without reading records or allocating previews", async () => {
  await stageLocalProofMedia([png()]);
  const getAll = vi.spyOn(IDBObjectStore.prototype, "getAll");
  const preview = vi.spyOn(URL, "createObjectURL");
  preview.mockClear();
  expect(await countLocalProofCandidates()).toBe(1);
  expect(getAll).not.toHaveBeenCalled();
  expect(preview).not.toHaveBeenCalled();
});

it("a previously aborted staging request cannot open a write transaction", async () => {
  const controller = new AbortController(); controller.abort();
  await expect(stageLocalProofMedia([png()], controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(await countLocalProofCandidates()).toBe(0);
});

it("cancellation during MIME validation cannot become an ordinary rejection or a pending write", async () => {
  const bytes = deferred<ArrayBuffer>();
  const file = png();
  vi.spyOn(file, "slice").mockReturnValueOnce({ arrayBuffer: () => bytes.promise } as Blob);
  const controller = new AbortController();
  const staging = stageLocalProofMedia([file], controller.signal);
  controller.abort();
  bytes.resolve(pngBytes.buffer);
  await expect(staging).rejects.toMatchObject({ name: "AbortError" });
  expect(await countLocalProofCandidates()).toBe(0);
});

it("cancellation during SHA validation prevents the late pending write", async () => {
  const hash = deferred<ArrayBuffer>();
  const hashing = deferred<void>();
  vi.spyOn(crypto.subtle, "digest").mockImplementationOnce(() => { hashing.resolve(); return hash.promise; });
  const controller = new AbortController();
  const staging = stageLocalProofMedia([png()], controller.signal);
  await hashing.promise;
  controller.abort();
  hash.resolve(new ArrayBuffer(32));
  await expect(staging).rejects.toMatchObject({ name: "AbortError" });
  expect(await countLocalProofCandidates()).toBe(0);
});

it("aborts an in-flight IndexedDB write atomically when Pause arrives before commit", async () => {
  const controller = new AbortController();
  const original = IDBObjectStore.prototype.add;
  vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(function(this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
    const request = original.call(this, value, key);
    if (this.name === "proof_candidates") controller.abort();
    return request;
  });
  await expect(stageLocalProofMedia([png()], controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(await countLocalProofCandidates()).toBe(0);
});

it("pending changes have distinct cross-tab notices; only approval changes saved Proof", async () => {
  const sent = vi.fn();
  vi.stubGlobal("BroadcastChannel", class { postMessage = sent; close() {} });
  try {
    await stageLocalProofMedia([png()]);
    expect(sent).toHaveBeenLastCalledWith("pending");
    const [candidate] = await listLocalProofCandidates();
    await resolveLocalProofCandidates([{ candidate, input: { ...candidate.input, evidenceText: "Synthetic note" } }], "edit");
    expect(sent).toHaveBeenLastCalledWith("pending");
    const [edited] = await listLocalProofCandidates();
    await resolveLocalProofCandidates([{ candidate: edited, input: { ...edited.input, category: "belonging" } }], "approve");
    expect(sent).toHaveBeenLastCalledWith("change");
    await clearLocalProofCandidates();
    expect(sent).toHaveBeenLastCalledWith("pending");
  } finally { vi.stubGlobal("BroadcastChannel", undefined); }
});
