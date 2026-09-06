import "fake-indexeddb/auto";
import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import { webcrypto } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearLocalProofCandidates, clearLocalProofItems, confirmTrustedFolderSource,
  countLocalProofCandidates, createLocalProofItem, deleteLocalProofItem,
  exportLocalProofFullBackup, forgetTrustedFolderSource, getTrustedFolderSource,
  importLocalProofBackup, listLocalProofCandidates, listLocalProofItems,
  setTrustedFolderActive, stageLocalProofMedia, stageTrustedFolderMedia,
  subscribeToLocalProofChanges,
} from "./local-proof-store";
import type { ProofFolder } from "./folder-source";

const prefix = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
function png(n = 1, size = 9): File {
  const bytes = new Uint8Array(size); bytes.set(prefix); bytes[8] = n;
  return new File([bytes], `synthetic-${n}.png`, { type: "image/png", lastModified: 1 });
}
// fake-indexeddb cannot clone native browser handles. This inert, cloneable
// stand-in tests storage only; controller tests exercise real handle methods.
function handle(name = "Synthetic trusted folder"): ProofFolder {
  return { name, kind: "directory" } as ProofFolder;
}
async function grant() { return confirmTrustedFolderSource(handle(), "creativity", ["#Synthetic", " care ", "synthetic"]); }
async function rows(store: string): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("muse-nexus-proof-gallery-local");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(store, "readonly");
      const read = tx.objectStore(store).getAll();
      tx.oncomplete = () => { db.close(); resolve(read.result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
}
async function putRaw(store: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("muse-nexus-proof-gallery-local");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(value);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
beforeAll(() => {
  vi.stubGlobal("Blob", NodeBlob); vi.stubGlobal("File", NodeFile); vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("BroadcastChannel", undefined);
  URL.createObjectURL = vi.fn(() => "blob:synthetic-trusted"); URL.revokeObjectURL = vi.fn();
});
beforeEach(async () => { await clearLocalProofItems(); await clearLocalProofCandidates(); });
afterEach(() => vi.restoreAllMocks());
afterAll(() => vi.unstubAllGlobals());

describe("explicit private source consent", () => {
  it("stores one exact grant with normalized owner-selected fields and no media reads", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const current = await grant();
    expect(await getTrustedFolderSource()).toEqual(current);
    expect(current).toMatchObject({ userId: "local-browser-owner", visibility: "personal", paused: false,
      handle: { name: "Synthetic trusted folder", kind: "directory" }, category: "creativity", tags: ["synthetic", "care"], processedDigests: [] });
    expect(current.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(await listLocalProofItems()).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("serializes simultaneous confirmations and never silently replaces an existing grant", async () => {
    const results = await Promise.allSettled([grant(), confirmTrustedFolderSource(handle("Other folder"), "parenting", [])]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    expect(await rows("source_grants")).toHaveLength(1);
  });

  it("does not turn an invalid category or noncloneable handle into persisted consent", async () => {
    await expect(confirmTrustedFolderSource(handle(), "guessed" as "belonging", [])).rejects.toThrow("settings");
    await expect(confirmTrustedFolderSource({ ...handle(), values: async function* () {} }, "belonging", [])).rejects.toThrow();
    expect(await getTrustedFolderSource()).toBeNull();
  });

  it("rotates revision on pause/resume and prevents stale tabs from changing or using consent", async () => {
    const current = await grant();
    const paused = await setTrustedFolderActive(current.id, current.revision, false);
    expect(paused.paused).toBe(true); expect(paused.revision).not.toBe(current.revision);
    await expect(stageTrustedFolderMedia(current.id, current.revision, [png()])).rejects.toThrow("consent changed");
    await expect(stageTrustedFolderMedia(paused.id, paused.revision, [png()])).rejects.toThrow("paused");
    await expect(setTrustedFolderActive(current.id, current.revision, true)).rejects.toThrow("another tab");
    await expect(forgetTrustedFolderSource(current.id, current.revision)).rejects.toThrow("another tab");
    const resumed = await setTrustedFolderActive(paused.id, paused.revision, true);
    expect(resumed.paused).toBe(false);
    expect((await stageTrustedFolderMedia(resumed.id, resumed.revision, [png()])).added).toBe(1);
  });
});

describe("bounded atomic automatic media", () => {
  it("saves literal media with private source-consent receipts but no fabricated meaning, dates or preview", async () => {
    const current = await grant();
    const network = vi.spyOn(globalThis, "fetch");
    const urls = vi.spyOn(URL, "createObjectURL"); urls.mockClear();
    const notices = vi.fn(); const unsubscribe = subscribeToLocalProofChanges(notices);
    try {
      expect(await stageTrustedFolderMedia(current.id, current.revision, [png()])).toEqual({ added: 1, duplicates: 0, rejected: [] });
      expect(notices).toHaveBeenCalledExactlyOnceWith("automatic");
      expect(urls).not.toHaveBeenCalled();
      expect(network).not.toHaveBeenCalled();
      const [item] = await listLocalProofItems();
      expect(item).toMatchObject({ visibility: "personal", userId: "local-browser-owner", category: "creativity",
        tags: ["synthetic", "care"], occurredOn: null, evidenceText: "", person: null, project: null,
        title: "synthetic-1.png", source: "Trusted folder: synthetic-1.png", provenance: { kind: "automatic_media", import_receipt: {
          method: "trusted_folder", original_filename: "synthetic-1.png", source_id: current.id,
          source_revision: current.revision, source_approved_at: current.approvedAt,
          source_category: "creativity", source_tags: ["synthetic", "care"],
        } } });
      expect((item.provenance.import_receipt as Record<string, unknown>).sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(await countLocalProofCandidates()).toBe(0);
    } finally { unsubscribe(); }
  });

  it("emits source state notices to this tab only after consent changes commit", async () => {
    const notices = vi.fn(); const unsubscribe = subscribeToLocalProofChanges(notices);
    try {
      const current = await grant();
      expect(notices).toHaveBeenLastCalledWith("source");
      await forgetTrustedFolderSource(current.id, current.revision);
      expect(notices).toHaveBeenCalledTimes(2);
      expect(await getTrustedFolderSource()).toBeNull();
    } finally { unsubscribe(); }
  });

  it("deduplicates concurrent scans and remembers deleted media through grant reload and pause/resume", async () => {
    const current = await grant();
    const outcomes = await Promise.all([stageTrustedFolderMedia(current.id, current.revision, [png()]), stageTrustedFolderMedia(current.id, current.revision, [png()])]);
    expect(outcomes.reduce((sum, outcome) => sum + outcome.added, 0)).toBe(1);
    expect(outcomes.reduce((sum, outcome) => sum + outcome.duplicates, 0)).toBe(1);
    const [saved] = await listLocalProofItems(); await deleteLocalProofItem(saved);
    const loaded = (await getTrustedFolderSource())!;
    expect(loaded.processedDigests).toHaveLength(1);
    const paused = await setTrustedFolderActive(loaded.id, loaded.revision, false);
    const resumed = await setTrustedFolderActive(paused.id, paused.revision, true);
    expect((await stageTrustedFolderMedia(resumed.id, resumed.revision, [png()])).duplicates).toBe(1);
    expect(await listLocalProofItems()).toEqual([]);
  });

  it("never promotes existing pending media and remembers the duplicate after review removal", async () => {
    await stageLocalProofMedia([png()]);
    const pending = await listLocalProofCandidates();
    const current = await grant();
    expect((await stageTrustedFolderMedia(current.id, current.revision, [png()])).duplicates).toBe(1);
    expect(await listLocalProofItems()).toEqual([]);
    expect((await listLocalProofCandidates())[0].revision).toBe(pending[0].revision);
    await clearLocalProofCandidates();
    expect((await stageTrustedFolderMedia(current.id, current.revision, [png()])).duplicates).toBe(1);
    expect(await listLocalProofItems()).toEqual([]);
  });

  it("validates signatures and batch limits before committing anything", async () => {
    const current = await grant();
    const invalid = new File(["not a PNG"], "synthetic.png", { type: "image/png" });
    const result = await stageTrustedFolderMedia(current.id, current.revision, [invalid]);
    expect(result.added).toBe(0); expect(result.rejected).toHaveLength(1);
    expect((await getTrustedFolderSource())!.processedDigests).toEqual([]);
    await expect(stageTrustedFolderMedia(current.id, current.revision, Array.from({ length: 51 }, () => png()))).rejects.toThrow("50 files");
    expect(await listLocalProofItems()).toEqual([]);
  });

  it("rechecks exact consent after hashing when another tab forgets it", async () => {
    const current = await grant();
    const hashing = deferred<void>(); const hash = deferred<ArrayBuffer>();
    vi.spyOn(crypto.subtle, "digest").mockImplementationOnce(() => { hashing.resolve(); return hash.promise; });
    const staging = stageTrustedFolderMedia(current.id, current.revision, [png()]);
    await hashing.promise;
    await forgetTrustedFolderSource(current.id, current.revision);
    hash.resolve(new ArrayBuffer(32));
    await expect(staging).rejects.toThrow("forgotten");
    expect(await listLocalProofItems()).toEqual([]);
  });

  it("cancels during MIME work and while an IDB add is in flight without saved rows or digest advancement", async () => {
    const current = await grant();
    const bytes = deferred<ArrayBuffer>(); const first = png();
    vi.spyOn(first, "slice").mockReturnValueOnce({ arrayBuffer: () => bytes.promise } as Blob);
    const early = new AbortController();
    const pending = stageTrustedFolderMedia(current.id, current.revision, [first], early.signal);
    early.abort(); bytes.resolve(prefix.buffer);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    const controller = new AbortController();
    const add = IDBObjectStore.prototype.add;
    vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(function(this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      const result = add.call(this, value, key);
      if (this.name === "proof_items") controller.abort();
      return result;
    });
    await expect(stageTrustedFolderMedia(current.id, current.revision, [png()], controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(await listLocalProofItems()).toEqual([]);
    expect((await getTrustedFolderSource())!.processedDigests).toEqual([]);
  });

  it("rolls back the whole batch and digest ledger at the durable 2,000-file boundary", async () => {
    const current = await grant();
    await putRaw("source_grants", { ...current, processedDigests: Array.from({ length: 1999 }, (_, i) => i.toString(16).padStart(64, "0")) });
    await expect(stageTrustedFolderMedia(current.id, current.revision, [png(1), png(2)])).rejects.toThrow("2,000");
    expect(await listLocalProofItems()).toEqual([]);
    expect((await getTrustedFolderSource())!.processedDigests).toHaveLength(1999);
  });

  it("rolls back earlier writes when a batch exceeds saved-media capacity", async () => {
    for (let i = 0; i < 5; i++) await createLocalProofItem({ title: "Synthetic capacity fixture", evidenceText: "", occurredOn: null,
      category: "creativity", sourceType: "photo", source: "Synthetic fixture", tags: [], person: null, project: null }, png(i, 8 * 1024 * 1024));
    const current = await grant();
    await expect(stageTrustedFolderMedia(current.id, current.revision, [png(8, 5 * 1024 * 1024), png(9, 5 * 1024 * 1024)])).rejects.toThrow("Saved Proof is full");
    expect(await listLocalProofItems()).toHaveLength(5);
    expect((await getTrustedFolderSource())!.processedDigests).toEqual([]);
  });
});

describe("backup and reset boundaries", () => {
  it("exports historical source receipts but not handles or active grants, and restore cannot create consent", async () => {
    const current = await grant();
    await stageTrustedFolderMedia(current.id, current.revision, [png()]);
    const backup = await exportLocalProofFullBackup();
    const document = JSON.parse(await backup.text());
    expect(Object.keys(document).sort()).toEqual(["encryption", "exportedAt", "format", "items", "pending", "version"]);
    expect(document.items[0].provenance.import_receipt.source_id).toBe(current.id);
    expect(await backup.text()).not.toContain('"handle"');
    expect(await backup.text()).not.toContain('"processedDigests"');
    await clearLocalProofItems();
    expect(await getTrustedFolderSource()).toBeNull();
    await expect(stageTrustedFolderMedia(current.id, current.revision, [png()])).rejects.toThrow("forgotten");
    await importLocalProofBackup(backup);
    expect(await getTrustedFolderSource()).toBeNull();
    expect(await listLocalProofItems()).toHaveLength(1);
  });

  it("fails closed when persisted consent is not owner-private", async () => {
    const current = await grant();
    await putRaw("source_grants", { ...current, visibility: "team" });
    await expect(getTrustedFolderSource()).rejects.toThrow("another owner");
    await expect(stageTrustedFolderMedia(current.id, current.revision, [png()])).rejects.toThrow("another owner");
    expect(await listLocalProofItems()).toEqual([]);
    await clearLocalProofItems();
    expect(await getTrustedFolderSource()).toBeNull();
  });
});
