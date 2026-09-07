import "fake-indexeddb/auto";
import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import { webcrypto } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import {
  clearLocalProofCandidates, clearLocalProofItems, createLocalProofItem, exportLocalProofBackupParts,
  exportLocalProofFullBackup, getLocalProofStorageUsage, importLocalProofBackup, listLocalProofCandidates,
  listLocalProofItems, resolveLocalProofCandidates, stageLocalProofMedia, updateLocalProofItem,
} from "./local-proof-store";
import { decryptProofBackup, encryptProofBackup } from "./encrypted-backup";
import type { ProofItemInput } from "./proof";

const MiB = 1024 * 1024;
const PREFIX = [137, 80, 78, 71, 13, 10, 26, 10];
function png(n = 1, size = 9) {
  const bytes = new Uint8Array(size); bytes.set(PREFIX); bytes[8] = n;
  return new File([bytes], `synthetic-${n}.png`, { type: "image/png" });
}
function input(): ProofItemInput {
  return { title: "Synthetic capacity fixture", evidenceText: "Synthetic exact evidence.", occurredOn: null,
    category: "creativity", sourceType: "photo", source: "Synthetic fixture", tags: ["synthetic"], person: null, project: null };
}
async function seedLegacy(sizes: number[], textCount = 0) {
  const records: Record<string, unknown>[] = [];
  for (const [index, size] of [...sizes, ...Array<number>(textCount).fill(0)].entries()) {
    const blob = size ? png(index, size).slice(0, size, "image/png") : null;
    const digest = blob ? [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))]
      .map(byte => byte.toString(16).padStart(2, "0")).join("") : null;
    records.push({ ...input(), id: crypto.randomUUID(), userId: "local-browser-owner", visibility: "personal",
      createdAt: "2026-08-30T00:00:00.000Z", updatedAt: "2026-08-30T00:00:00.000Z", provenance: { kind: "manual" },
      imageBlob: blob, imageName: blob ? `synthetic-${index}.png` : null,
      imageRevision: blob ? crypto.randomUUID() : null, imageDigest: digest });
  }
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("muse-nexus-proof-gallery-local");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result; const tx = db.transaction("proof_items", "readwrite");
      for (const record of records) tx.objectStore("proof_items").add(record);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
    };
  });
}
beforeAll(() => {
  vi.stubGlobal("Blob", NodeBlob); vi.stubGlobal("File", NodeFile); vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("BroadcastChannel", undefined);
  URL.createObjectURL = vi.fn(() => "blob:synthetic-capacity"); URL.revokeObjectURL = vi.fn();
});
beforeEach(async () => { await clearLocalProofItems(); await clearLocalProofCandidates(); });
afterEach(() => vi.restoreAllMocks());
afterAll(() => vi.unstubAllGlobals());

it("caps concurrent manual saves against aggregate media inside the same transaction", async () => {
  await seedLegacy([10 * MiB, 10 * MiB, 10 * MiB, 10 * MiB, 7 * MiB]);
  const results = await Promise.allSettled([createLocalProofItem(input(), png(10, MiB)), createLocalProofItem(input(), png(11, MiB))]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
  expect(await getLocalProofStorageUsage()).toMatchObject({ savedCount: 6, savedBytes: 48 * MiB });
});

it("enforces aggregate 10,000 saved records without deleting existing legacy records", async () => {
  await seedLegacy([], 10_000);
  await expect(createLocalProofItem(input(), null)).rejects.toThrow("Saved Proof is full");
  const usage = await getLocalProofStorageUsage();
  expect(usage.savedCount).toBe(10_000);
  expect(usage.warnings.join(" ")).toContain("near its item limit");
}, 15_000);

it("legacy oversized media can be edited or shrunk but cannot grow", async () => {
  await seedLegacy([10 * MiB, 10 * MiB, 10 * MiB, 10 * MiB, 9 * MiB]);
  const [existing] = (await listLocalProofItems()).filter(item => item.imagePath);
  const edited = await updateLocalProofItem(existing, { ...input(), evidenceText: "Synthetic corrected exact words." }, null, false);
  await expect(createLocalProofItem(input(), null)).rejects.toThrow("Saved Proof is full");
  // First remove enough media to get back under the normal backup limit.
  const shrunk = await updateLocalProofItem(edited.item, input(), png(33), false);
  expect(shrunk.item.evidenceText).toBe(input().evidenceText);
  expect((await getLocalProofStorageUsage()).savedBytes).toBeLessThan(48 * MiB);
  expect((await exportLocalProofFullBackup()).size).toBeGreaterThan(0);
}, 15_000);

it("blocks attachment replacements that push a valid gallery over the media limit", async () => {
  await seedLegacy([10 * MiB, 10 * MiB, 10 * MiB, 10 * MiB, 7 * MiB]);
  const existing = (await listLocalProofItems()).find(item => item.title === "Synthetic capacity fixture" && item.imagePath)!;
  // Add a small manually-created record, then try growing that exact attachment.
  const { item } = await createLocalProofItem(input(), png(77));
  await expect(updateLocalProofItem(item, input(), png(78, 2 * MiB), false)).rejects.toThrow("Saved Proof is full");
  expect((await listLocalProofItems()).find(candidate => candidate.id === item.id)?.imagePath).toBe(item.imagePath);
  expect((await listLocalProofItems()).some(candidate => candidate.id === existing.id)).toBe(true);
});

it("rolls back an entire pending approval when the second item would exceed saved capacity", async () => {
  await seedLegacy([10 * MiB, 10 * MiB, 10 * MiB, 10 * MiB, 7 * MiB]);
  await stageLocalProofMedia([png(20, MiB), png(21, MiB)]);
  const pending = await listLocalProofCandidates();
  await expect(resolveLocalProofCandidates(pending.map(candidate => ({ candidate,
    input: { ...candidate.input, category: "creativity" } })), "approve")).rejects.toThrow("Saved Proof is full");
  expect(await getLocalProofStorageUsage()).toMatchObject({ savedCount: 5, savedBytes: 47 * MiB, pendingCount: 2, pendingBytes: 2 * MiB });
  expect((await listLocalProofCandidates()).map(candidate => candidate.id)).toEqual(pending.map(candidate => candidate.id));
});

it("counts existing saved media during restore and preserves pending writes atomically on failure", async () => {
  await createLocalProofItem(input(), png(30, MiB));
  await stageLocalProofMedia([png(31)]);
  const backup = await exportLocalProofFullBackup();
  await clearLocalProofItems(); await clearLocalProofCandidates();
  await seedLegacy([10 * MiB, 10 * MiB, 10 * MiB, 10 * MiB, 8 * MiB]);
  await expect(importLocalProofBackup(backup)).rejects.toThrow("Saved Proof is full");
  expect(await getLocalProofStorageUsage()).toMatchObject({ savedCount: 5, savedBytes: 48 * MiB, pendingCount: 0 });
});

it("returns aggregate limits and recovery warnings without allocating media previews", async () => {
  await seedLegacy([10 * MiB, 10 * MiB, 10 * MiB, 10 * MiB, 9 * MiB]);
  await stageLocalProofMedia([png(41)]);
  const preview = vi.spyOn(URL, "createObjectURL"); preview.mockClear();
  const usage = await getLocalProofStorageUsage();
  expect(usage).toMatchObject({ savedCount: 5, savedBytes: 49 * MiB, pendingCount: 1, pendingBytes: 9,
    limits: { savedBytes: 48 * MiB, pendingBytes: 48 * MiB, savedCount: 10_000, pendingCount: 100 } });
  expect(usage.warnings.join(" ")).toContain("encrypted recovery parts");
  expect(preview).not.toHaveBeenCalled();
});

it("streams intact encrypted recovery parts for oversized legacy data without changing or exposing source grants", async () => {
  await seedLegacy([10 * MiB, 10 * MiB, 10 * MiB, 10 * MiB, 10 * MiB]);
  await stageLocalProofMedia([png(45)]);
  const [candidate] = await listLocalProofCandidates();
  await resolveLocalProofCandidates([{ candidate, input: { ...candidate.input, evidenceText: "Synthetic pending recovery note." } }], "edit");
  await expect(exportLocalProofFullBackup()).rejects.toThrow("safe limits");
  const before = await getLocalProofStorageUsage();
  const parts = [];
  for await (const part of exportLocalProofBackupParts()) {
    expect(part.blob.size).toBeLessThanOrEqual(32 * MiB);
    const contents = JSON.parse(await part.blob.text());
    expect(Object.keys(contents).sort()).toEqual(["encryption", "exportedAt", "format", "items", "pending", "version"]);
    expect(contents.exportedAt).toBe(part.createdAt);
    parts.push(part);
  }
  expect(parts.length).toBeGreaterThan(1);
  expect(new Set(parts.map(part => part.exportId)).size).toBe(1);
  expect(parts.every((part, index) => part.part === index + 1 && part.totalParts === parts.length && part.isLast === (index === parts.length - 1))).toBe(true);
  expect(parts.reduce((count, part) => count + part.savedCount, 0)).toBe(5);
  expect(parts.reduce((count, part) => count + part.pendingCount, 0)).toBe(1);
  expect(await getLocalProofStorageUsage()).toEqual(before);
  // Each part restores independently; never claim one oversized all-part restore.
  for (const part of parts) {
    const encrypted = await encryptProofBackup(part.blob, "synthetic multipart passphrase");
    await clearLocalProofItems(); await clearLocalProofCandidates();
    expect(await importLocalProofBackup(await decryptProofBackup(encrypted, "synthetic multipart passphrase")))
      .toMatchObject({ importedCount: part.savedCount, pendingImported: part.pendingCount });
  }
}, 20_000);

it("cancels multipart export without changing existing data", async () => {
  await createLocalProofItem(input(), png());
  const before = await getLocalProofStorageUsage();
  const controller = new AbortController(); controller.abort();
  await expect(exportLocalProofBackupParts(controller.signal).next()).rejects.toMatchObject({ name: "AbortError" });
  expect(await getLocalProofStorageUsage()).toEqual(before);
});

it("detects changes to an upcoming part instead of reporting an inconsistent complete export", async () => {
  await seedLegacy([], 1001);
  const parts = exportLocalProofBackupParts();
  const first = await parts.next();
  expect(first.value?.totalParts).toBe(2);
  const firstIds = new Set(JSON.parse(await first.value!.blob.text()).items.map((item: { id: string }) => item.id));
  const upcoming = (await listLocalProofItems()).find(item => !firstIds.has(item.id))!;
  await updateLocalProofItem(upcoming, { ...input(), evidenceText: "Synthetic newer words." }, null, false);
  await expect(parts.next()).rejects.toThrow("changed during recovery export");
  expect((await listLocalProofItems()).find(item => item.id === upcoming.id)?.evidenceText).toBe("Synthetic newer words.");
});
