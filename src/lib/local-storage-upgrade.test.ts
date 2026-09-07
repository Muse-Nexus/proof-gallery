import { IDBFactory } from "fake-indexeddb";
import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ProofFolder } from "./folder-source";

const DATABASE_NAME = "muse-nexus-proof-gallery-local";
const TIMESTAMP = "2026-08-30T12:00:00.000Z";
const PASSPHRASE = "synthetic archive passphrase only";

function png(index: number): File {
  return new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, index])],
    `synthetic-${index}.png`, { type: "image/png", lastModified: 1 });
}

async function digest(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

beforeEach(() => {
  // Each test exercises a genuinely fresh database and newly loaded connection,
  // rather than simulating an upgrade on a cached v3 module connection.
  vi.resetModules();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("Blob", NodeBlob); vi.stubGlobal("File", NodeFile);
  vi.stubGlobal("crypto", webcrypto); vi.stubGlobal("BroadcastChannel", undefined);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:synthetic-storage-integration");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("upgrades a populated v2 IndexedDB in place without altering saved media, pending drafts, or privacy", async () => {
  const savedFile = png(1); const pendingFile = png(2);
  const saved = {
    id: crypto.randomUUID(), userId: "local-browser-owner", visibility: "personal",
    title: "Synthetic legacy saved image", evidenceText: "Synthetic original exact words.",
    occurredOn: "2026-07-12", category: "creativity", sourceType: "photo",
    source: "Synthetic v2 source", tags: ["synthetic", "legacy"], person: null, project: null,
    provenance: { kind: "manual", captured_via: "proof_gallery", source_type: "photo", source: "Synthetic v2 source" },
    createdAt: TIMESTAMP, updatedAt: TIMESTAMP,
    imageBlob: savedFile.slice(0, savedFile.size, savedFile.type), imageName: savedFile.name,
    imageRevision: crypto.randomUUID(), imageDigest: await digest(savedFile),
  };
  const pending = {
    id: crypto.randomUUID(), revision: crypto.randomUUID(), userId: "local-browser-owner", visibility: "personal",
    importedAt: TIMESTAMP, fileName: pendingFile.name,
    blob: pendingFile.slice(0, pendingFile.size, pendingFile.type), digest: await digest(pendingFile),
    input: { title: "Synthetic pending review", evidenceText: "Synthetic unopened draft aardvark.",
      occurredOn: null, category: null, sourceType: "photo", source: "Synthetic original selected file",
      tags: ["synthetic"], person: null, project: null },
  };
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 2);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("proof_items", { keyPath: "id" });
      request.result.createObjectStore("proof_candidates", { keyPath: "id" });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(["proof_items", "proof_candidates"], "readwrite");
      tx.objectStore("proof_items").add(saved);
      tx.objectStore("proof_candidates").add(pending);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });

  const store = await import("./local-proof-store");
  const [actualSaved] = await store.listLocalProofItems();
  const [actualPending] = await store.listLocalProofCandidates();
  expect(actualSaved).toMatchObject({ id: saved.id, userId: saved.userId, visibility: saved.visibility,
    title: saved.title, evidenceText: saved.evidenceText, occurredOn: saved.occurredOn,
    category: saved.category, tags: saved.tags, source: saved.source, provenance: saved.provenance,
    createdAt: saved.createdAt, updatedAt: saved.updatedAt });
  expect(actualPending).toMatchObject({ id: pending.id, revision: pending.revision, userId: pending.userId,
    visibility: pending.visibility, importedAt: pending.importedAt, fileName: pending.fileName, input: pending.input });
  expect(await store.getTrustedFolderSource()).toBeNull();
  expect((await store.searchLocalProofItems("aardvark")).items).toEqual([]);
  const exported = JSON.parse(await (await store.exportLocalProofFullBackup()).text());
  expect(exported.items[0].image.integritySha256).toBe(saved.imageDigest);
  expect(exported.pending[0].media.integritySha256).toBe(pending.digest);
  expect(exported.pending[0].input).toEqual(pending.input);
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      try {
        expect(db.version).toBe(3);
        expect(Array.from(db.objectStoreNames)).toEqual(["proof_candidates", "proof_items", "source_grants"]);
        resolve();
      } catch (error) { reject(error); }
      finally { db.close(); }
    };
  });
});

it("round-trips an encrypted full archive with trusted saved media and pending notes without restoring source consent", async () => {
  const store = await import("./local-proof-store");
  const encryption = await import("./encrypted-backup");
  // Only native browsers can clone real directory handles; this inert stand-in
  // makes no permission/read capability claim and only tests grant exclusion.
  const handle = { kind: "directory", name: "Synthetic exact folder" } as ProofFolder;
  const grant = await store.confirmTrustedFolderSource(handle, "creativity", ["synthetic"]);
  await store.stageTrustedFolderMedia(grant.id, grant.revision, [png(3)]);
  await store.stageLocalProofMedia([png(4)]);
  const [candidate] = await store.listLocalProofCandidates();
  const draft = { ...candidate.input, evidenceText: "Synthetic saved draft aardvark; no invented story.", tags: ["synthetic", "draft"] };
  await store.resolveLocalProofCandidates([{ candidate, input: draft }], "edit");
  const [savedBefore] = await store.listLocalProofItems();
  const [pendingBefore] = await store.listLocalProofCandidates();
  const payload = await store.exportLocalProofFullBackup();
  const archive = await encryption.encryptProofBackup(payload, PASSPHRASE);
  expect(await encryption.isEncryptedProofBackup(archive)).toBe(true);
  expect(await archive.text()).not.toContain(draft.evidenceText);

  await store.clearLocalProofItems(); await store.clearLocalProofCandidates();
  await expect(encryption.decryptProofBackup(archive, "wrong synthetic passphrase")).rejects.toThrow("incorrect");
  expect(await store.listLocalProofItems()).toEqual([]);
  expect(await store.listLocalProofCandidates()).toEqual([]);
  const restoredPayload = await encryption.decryptProofBackup(archive, PASSPHRASE);
  expect(await restoredPayload.text()).toBe(await payload.text());
  const document = JSON.parse(await restoredPayload.text());
  expect(Object.keys(document).sort()).toEqual(["encryption", "exportedAt", "format", "items", "pending", "version"]);
  expect(await restoredPayload.text()).not.toContain('"handle"');
  expect(await restoredPayload.text()).not.toContain('"processedDigests"');
  expect(await store.importLocalProofBackup(restoredPayload)).toMatchObject({ importedCount: 1, pendingImported: 1 });
  const [savedAfter] = await store.listLocalProofItems();
  const [pendingAfter] = await store.listLocalProofCandidates();
  // Restore intentionally rotates the image cache revision, not evidence bytes.
  expect(savedAfter).toEqual({ ...savedBefore, imagePath: expect.stringContaining(`local-proof://${savedBefore.id}/`) });
  expect(pendingAfter).toEqual(pendingBefore);
  const reexported = JSON.parse(await (await store.exportLocalProofFullBackup()).text());
  expect(reexported.items).toEqual(document.items);
  expect(reexported.pending).toEqual(document.pending);
  expect(await store.getTrustedFolderSource()).toBeNull();
  expect((await store.searchLocalProofItems("aardvark")).items).toEqual([]);
  expect(await store.importLocalProofBackup(restoredPayload)).toMatchObject({ importedCount: 0, pendingImported: 0 });
  await expect(store.stageTrustedFolderMedia(grant.id, grant.revision, [png(5)])).rejects.toThrow("forgotten");
});

it("rejects injected source grants in a full restore before writing either saved or pending media", async () => {
  const store = await import("./local-proof-store");
  await store.createLocalProofItem({ title: "Synthetic saved note", evidenceText: "Synthetic exact note.",
    occurredOn: null, category: "belonging", sourceType: "other", source: "Synthetic fixture",
    tags: ["synthetic"], person: null, project: null }, null);
  await store.stageLocalProofMedia([png(6)]);
  const document = JSON.parse(await (await store.exportLocalProofFullBackup()).text());
  await store.clearLocalProofItems(); await store.clearLocalProofCandidates();
  document.source_grants = [{ id: crypto.randomUUID(), paused: false, handle: { name: "Unauthorized synthetic folder", kind: "directory" } }];
  await expect(store.importLocalProofBackup(new Blob([JSON.stringify(document)], { type: "application/json" }))).rejects.toThrow();
  expect(await store.listLocalProofItems()).toEqual([]);
  expect(await store.listLocalProofCandidates()).toEqual([]);
  expect(await store.getTrustedFolderSource()).toBeNull();
});
