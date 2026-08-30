import "fake-indexeddb/auto";
import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import { webcrypto } from "node:crypto";
import { beforeAll, beforeEach, afterAll, expect, it, vi } from "vitest";
import { COMPANION_FORMAT, parseCompanionPackage } from "./companion-package";
import { clearLocalProofItems, clearLocalProofCandidates, stageLocalProofCompanion, listLocalProofCandidates, listLocalProofItems, searchLocalProofItems, exportLocalProofBackup, importLocalProofBackup, resolveLocalProofCandidates, updateLocalProofItem } from "./local-proof-store";

beforeAll(() => {
  vi.stubGlobal("Blob", NodeBlob); vi.stubGlobal("File", NodeFile); vi.stubGlobal("crypto", webcrypto); vi.stubGlobal("BroadcastChannel", undefined);
  URL.createObjectURL = vi.fn(() => "blob:synthetic-companion"); URL.revokeObjectURL = vi.fn();
});
beforeEach(async () => { await clearLocalProofItems(); await clearLocalProofCandidates(); });
afterAll(() => vi.unstubAllGlobals());
async function document(bytes = new Uint8Array([137,80,78,71,13,10,26,10])) {
  const sha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), n => n.toString(16).padStart(2, "0")).join("");
  return { format: COMPANION_FORMAT, version: 1, visibility: "personal", encryption: "none", exportedAt: "2026-08-30T00:00:00.000Z", items: [{
    filename: "synthetic.png", mimeType: "image/png", base64: Buffer.from(bytes).toString("base64"), sha256: sha, occurredOn: "2026-08-29" as string | null,
    receipt: { assetIdentifier: "synthetic-asset", originalFilename: "synthetic.png", originalSha256: sha, representation: "original", captureDate: "2026-08-30T01:00:00.000Z" as string | null, timeZone: "Pacific/Honolulu", scope: "Synthetic album" },
  }] };
}
const file = (value: unknown) => new Blob([JSON.stringify(value)], { type: "application/json" });

it("stages only private pending photos with no inferred meaning or network calls", async () => {
  const network = vi.spyOn(globalThis, "fetch");
  const review = file(await document());
  expect(await stageLocalProofCompanion(review)).toEqual({ added: 1, duplicates: 0 });
  const [candidate] = await listLocalProofCandidates();
  expect(candidate).toMatchObject({ visibility: "personal", input: { category: null, person: null, evidenceText: "", occurredOn: "2026-08-29" }, companionReceipt: { scope: "Synthetic album", representation: "original" } });
  expect(await listLocalProofItems()).toEqual([]);
  expect((await searchLocalProofItems("synthetic")).items).toEqual([]);
  expect(JSON.parse(await (await exportLocalProofBackup()).text()).items).toEqual([]);
  expect(network).not.toHaveBeenCalled(); network.mockRestore();
  await expect(importLocalProofBackup(review)).rejects.toThrow();
});
it("preserves source receipts through approval, edit, backup and duplicate import", async () => {
  const review = file(await document()); await stageLocalProofCompanion(review);
  const [candidate] = await listLocalProofCandidates();
  await resolveLocalProofCandidates([{ candidate, input: { ...candidate.input, category: "belonging" } }], "approve");
  const [saved] = await listLocalProofItems();
  expect(saved.provenance.import_receipt).toMatchObject({ method: "mac_photos_companion", companion: { assetIdentifier: "synthetic-asset", timeZone: "Pacific/Honolulu" } });
  const edited = await updateLocalProofItem(saved, { ...candidate.input, category: "belonging", title: "Synthetic edit" }, null, false);
  expect(edited.item.provenance.import_receipt).toEqual(saved.provenance.import_receipt);
  expect(await stageLocalProofCompanion(review)).toEqual({ added: 0, duplicates: 1 });
  const backup = await exportLocalProofBackup(); await clearLocalProofItems(); await importLocalProofBackup(backup);
  expect((await listLocalProofItems())[0].provenance.import_receipt).toEqual(saved.provenance.import_receipt);
});
it("retains unknown dates and labels a JPEG preview separately from the original", async () => {
  const doc = await document(new Uint8Array([255,216,255,0]));
  doc.items[0].mimeType = "image/jpeg"; doc.items[0].filename = "synthetic-preview.jpg";
  doc.items[0].receipt.representation = "jpeg-preview"; doc.items[0].receipt.originalSha256 = "f".repeat(64);
  doc.items[0].receipt.captureDate = null; doc.items[0].occurredOn = null;
  await stageLocalProofCompanion(file(doc)); const [candidate] = await listLocalProofCandidates();
  expect(candidate.input.source).toContain("JPEG preview, original remains in Photos");
  expect(candidate.input.occurredOn).toBeNull(); expect(candidate.companionReceipt?.originalSha256).toBe("f".repeat(64));
});
it("marks the import receipt historical if an attachment is replaced", async () => {
  await stageLocalProofCompanion(file(await document())); const [candidate] = await listLocalProofCandidates();
  await resolveLocalProofCandidates([{ candidate, input: { ...candidate.input, category: "belonging" } }], "approve");
  const [saved] = await listLocalProofItems();
  const replacement = new File([new Uint8Array([137,80,78,71,13,10,26,10,1])], "synthetic-replacement.png", { type: "image/png" });
  const { item } = await updateLocalProofItem(saved, { ...candidate.input, category: "belonging" }, replacement, false);
  expect(item.provenance.import_attachment_changed).toBe(true);
  expect(item.provenance.import_receipt).toEqual(saved.provenance.import_receipt);
});
it("rejects corrupt batches atomically, wrong privacy, arbitrary fields and mismatched dates", async () => {
  const doc = await document(); doc.items.push({ ...doc.items[0], sha256: "0".repeat(64) });
  await expect(stageLocalProofCompanion(file(doc))).rejects.toThrow("integrity");
  expect(await listLocalProofCandidates()).toHaveLength(0);
  doc.items.pop(); doc.visibility = "team"; await expect(parseCompanionPackage(file(doc))).rejects.toThrow("private");
  doc.visibility = "personal"; await expect(parseCompanionPackage(file({ ...doc, url: "https://invalid.example" }))).rejects.toThrow("schema");
  doc.items[0].occurredOn = "2026-08-30"; await expect(parseCompanionPackage(file(doc))).rejects.toThrow("date");
  doc.items[0].occurredOn = "2026-08-29"; doc.items[0].receipt.captureDate = "2026-02-30T01:00:00.000Z";
  await expect(parseCompanionPackage(file(doc))).rejects.toThrow("timestamp");
});
it("handles a valid large photo without regex stack overflow and rejects bad padding", async () => {
  const bytes = new Uint8Array(7 * 1024 * 1024); bytes.set([137,80,78,71,13,10,26,10]);
  const doc = await document(bytes); expect((await parseCompanionPackage(file(doc)))[0].file.size).toBe(bytes.length);
  doc.items[0].base64 = "===="; await expect(parseCompanionPackage(file(doc))).rejects.toThrow("bytes");
});
it("rejects out-of-range dates atomically without poisoning the existing review inbox", async () => {
  await stageLocalProofCompanion(file(await document()));
  const before = await listLocalProofCandidates();
  const next = await document(new Uint8Array([137,80,78,71,13,10,26,10,2]));
  next.items.push({ ...next.items[0], occurredOn: "10000-08-29", receipt: {
    ...next.items[0].receipt, captureDate: "+010000-08-30T00:00:00.000Z",
  } });
  await expect(stageLocalProofCompanion(file(next))).rejects.toThrow("timestamp");
  expect((await listLocalProofCandidates()).map(row => row.id)).toEqual(before.map(row => row.id));
  expect(await listLocalProofItems()).toEqual([]);
});
it("enforces file, count, and inbox limits without partially adding candidates", async () => {
  const doc = await document(); doc.items = Array.from({ length: 51 }, () => doc.items[0]);
  await expect(stageLocalProofCompanion(file(doc))).rejects.toThrow("1–50");
  expect(await listLocalProofCandidates()).toEqual([]);
  const oversized = new Blob([new Uint8Array(64 * 1024 * 1024 + 1)]);
  await expect(parseCompanionPackage(oversized)).rejects.toThrow("64 MiB");
});
