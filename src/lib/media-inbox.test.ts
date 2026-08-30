import "fake-indexeddb/auto";
import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import { webcrypto } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearLocalProofItems, createLocalProofItem, exportLocalProofBackup, importLocalProofBackup,
  listLocalProofCandidates, listLocalProofItems, resolveLocalProofCandidates,
  searchLocalProofItems, stageLocalProofMedia, updateLocalProofItem,
  type LocalProofCandidate,
} from "./local-proof-store";
import { validateLocalProofMedia } from "./media";

function png(index = 0) {
  return new File([new Uint8Array([137,80,78,71,13,10,26,10,index])], `synthetic-${index}.png`, { type: "image/png", lastModified: 1 });
}
function mp4() {
  return new File([new Uint8Array([0,0,0,24]), "ftypisom", new Uint8Array(12)], "synthetic.mp4", { type: "video/mp4" });
}
function approved(candidate: LocalProofCandidate) {
  return { candidate, input: { ...candidate.input, category: "belonging" as const } };
}
beforeAll(() => {
  vi.stubGlobal("Blob", NodeBlob); vi.stubGlobal("File", NodeFile); vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("BroadcastChannel", undefined);
  URL.createObjectURL = vi.fn(() => "blob:synthetic-review");
  URL.revokeObjectURL = vi.fn();
});
beforeEach(async () => {
  await clearLocalProofItems();
  const pending = await listLocalProofCandidates();
  if (pending.length) await resolveLocalProofCandidates(pending.map(candidate => ({ candidate })), "skip");
});
afterAll(() => vi.unstubAllGlobals());

describe("private local media review", () => {
  it("persists pending bytes separately, without inventing date, category, or words", async () => {
    const network = vi.spyOn(globalThis, "fetch");
    expect(await stageLocalProofMedia([png()])).toEqual({ added: 1, duplicates: 0, rejected: [] });
    const [pending] = await listLocalProofCandidates();
    expect(pending.input).toMatchObject({ occurredOn: null, category: null, evidenceText: "", source: "Selected file: synthetic-0.png" });
    expect((await listLocalProofCandidates())[0].id).toBe(pending.id);
    expect(await listLocalProofItems()).toEqual([]);
    expect((await searchLocalProofItems("synthetic")).items).toEqual([]);
    expect(JSON.parse(await (await exportLocalProofBackup()).text()).items).toEqual([]);
    expect(network).not.toHaveBeenCalled(); network.mockRestore();
  });
  it("requires an explicit category and atomically rolls back an invalid batch", async () => {
    await stageLocalProofMedia([png(1), png(2)]);
    const candidates = await listLocalProofCandidates();
    await expect(resolveLocalProofCandidates([approved(candidates[0]), { candidate: candidates[1] }], "approve")).rejects.toThrow("category");
    expect(await listLocalProofItems()).toHaveLength(0);
    expect(await listLocalProofCandidates()).toHaveLength(2);
  });
  it("approves once, preserves source bytes and receipt, and deduplicates saved media", async () => {
    await stageLocalProofMedia([png(), png()]);
    const [candidate] = await listLocalProofCandidates();
    await resolveLocalProofCandidates([approved(candidate)], "approve");
    expect(await listLocalProofCandidates()).toHaveLength(0);
    const [item] = await listLocalProofItems();
    expect(item).toMatchObject({ id: candidate.id, evidenceText: "", occurredOn: null, visibility: "personal", mediaType: "image/png" });
    expect(item.provenance.import_receipt).toMatchObject({ original_filename: "synthetic-0.png", method: "selected_files" });
    await expect(resolveLocalProofCandidates([approved(candidate)], "approve")).rejects.toThrow("changed");
    expect(await listLocalProofItems()).toHaveLength(1);
    expect(await stageLocalProofMedia([png()])).toMatchObject({ added: 0, duplicates: 1 });
    const { item: edited } = await updateLocalProofItem(item, { ...candidate.input, category: "belonging", title: "Synthetic edited photo" }, null, false);
    expect(edited.provenance.import_receipt).toEqual(item.provenance.import_receipt);
    await expect(updateLocalProofItem(edited, { ...candidate.input, category: "belonging" }, null, true)).rejects.toThrow("Evidence");
  });
  it("guards stale edits, skip, and simultaneous approvals", async () => {
    await stageLocalProofMedia([png()]);
    const [original] = await listLocalProofCandidates();
    await resolveLocalProofCandidates([{ candidate: original, input: { ...original.input, evidenceText: "Synthetic exact words" } }], "edit");
    await expect(resolveLocalProofCandidates([{ candidate: original }], "skip")).rejects.toThrow("changed");
    const [current] = await listLocalProofCandidates();
    expect(current.input.evidenceText).toBe("Synthetic exact words");
    const attempts = await Promise.allSettled([resolveLocalProofCandidates([approved(current)], "approve"), resolveLocalProofCandidates([approved(current)], "approve")]);
    expect(attempts.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(await listLocalProofItems()).toHaveLength(1);
  });
  it("removes pending bytes without entering the gallery", async () => {
    await stageLocalProofMedia([png()]);
    const [candidate] = await listLocalProofCandidates();
    await resolveLocalProofCandidates([{ candidate }], "skip");
    expect(await listLocalProofCandidates()).toHaveLength(0);
    expect(await listLocalProofItems()).toHaveLength(0);
  });
  it("keeps review previews intact when only saved Proof is cleared", async () => {
    await stageLocalProofMedia([png()]);
    const [candidate] = await listLocalProofCandidates();
    vi.mocked(URL.revokeObjectURL).mockClear();
    await clearLocalProofItems();
    expect(vi.mocked(URL.revokeObjectURL)).not.toHaveBeenCalled();
    expect((await listLocalProofCandidates())[0].mediaUrl).toBe(candidate.mediaUrl);
  });
  it("rejects unsupported media honestly and caps batch size before any write", async () => {
    const result = await stageLocalProofMedia([png(), new File(["bad"], "synthetic.heic", { type: "image/heic" })]);
    expect(result.added).toBe(1); expect(result.rejected).toHaveLength(1);
    await expect(stageLocalProofMedia(Array.from({ length: 51 }, () => png()))).rejects.toThrow("50");
    expect(await listLocalProofCandidates()).toHaveLength(1);
    await expect(validateLocalProofMedia(new File(["<script>bad</script>"], "synthetic.mp4", { type: "video/mp4" }))).rejects.toThrow("MP4");
    await expect(validateLocalProofMedia(new File(["bad"], "synthetic.webm", { type: "video/webm" }))).rejects.toThrow("WebM");
  });
  it("round-trips local video and an empty note in v2 without approving pending items", async () => {
    await stageLocalProofMedia([mp4()]);
    const [candidate] = await listLocalProofCandidates();
    await resolveLocalProofCandidates([approved(candidate)], "approve");
    const backup = await exportLocalProofBackup();
    const document = JSON.parse(await backup.text());
    expect(document.version).toBe(2);
    await clearLocalProofItems();
    await importLocalProofBackup(backup);
    expect((await listLocalProofItems())[0]).toMatchObject({ mediaType: "video/mp4", evidenceText: "" });
    expect(await listLocalProofCandidates()).toHaveLength(0);
    document.version = 1;
    await expect(importLocalProofBackup(new Blob([JSON.stringify(document)]))).rejects.toThrow("Legacy");
  });
  it("continues to import the previous v1 image/text backup format", async () => {
    const file = png();
    await createLocalProofItem({ title: "Synthetic legacy", evidenceText: "Synthetic words", category: "creativity", occurredOn: null, sourceType: "photo", source: "Synthetic fixture", tags: [], person: null, project: null }, file);
    const document = JSON.parse(await (await exportLocalProofBackup()).text());
    document.version = 1;
    await clearLocalProofItems();
    expect((await importLocalProofBackup(new Blob([JSON.stringify(document)]))).imported).toBe(1);
  });
  it("refuses corrupt pending media instead of poisoning saved Proof or backups", async () => {
    await stageLocalProofMedia([png()]);
    const [candidate] = await listLocalProofCandidates();
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("muse-nexus-proof-gallery-local", 2);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("proof_candidates", "readwrite");
      const store = tx.objectStore("proof_candidates"); const request = store.get(candidate.id);
      request.onsuccess = () => store.put({ ...request.result, digest: "0".repeat(64) });
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    }); db.close();
    await expect(resolveLocalProofCandidates([approved(candidate)], "approve")).rejects.toThrow("integrity");
    expect(await listLocalProofItems()).toHaveLength(0);
    expect(await listLocalProofCandidates()).toHaveLength(1);
  });
});
