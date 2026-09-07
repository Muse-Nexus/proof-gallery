import "fake-indexeddb/auto";
import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import { webcrypto } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { getTrustedSourceContext } from "./source-context";
import { clearLocalProofItems, confirmTrustedFolderSource, listLocalProofItems, searchLocalProofItems, stageTrustedFolderMedia } from "./local-proof-store";
import type { ProofFolder } from "./folder-source";

beforeAll(() => {
  vi.stubGlobal("Blob", NodeBlob); vi.stubGlobal("File", NodeFile); vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("BroadcastChannel", undefined);
  URL.createObjectURL = vi.fn(() => "blob:synthetic-context"); URL.revokeObjectURL = vi.fn();
});
afterAll(() => vi.unstubAllGlobals());

it("finds raw confirmed folder context without fabricating a person, event date, or photo meaning", async () => {
  await clearLocalProofItems();
  const folder = { kind: "directory", name: "Synthetic Juniper outings" } as ProofFolder;
  const grant = await confirmTrustedFolderSource(folder, "creativity", []);
  const image = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 7])], "synthetic-camera-001.png", { type: "image/png" });
  await stageTrustedFolderMedia(grant.id, grant.revision, [image]);
  const [item] = await listLocalProofItems();
  expect(getTrustedSourceContext(item.provenance)).toBe("Synthetic Juniper outings");
  expect((await searchLocalProofItems("Juniper")).items.map(result => result.id)).toEqual([item.id]);
  expect(item).toMatchObject({ title: "synthetic-camera-001.png", evidenceText: "", person: null, occurredOn: null });
  expect((await searchLocalProofItems("Juniper", { category: "money", tag: null })).items).toEqual([]);
  const receipt = item.provenance.import_receipt as Record<string, unknown>;
  expect(getTrustedSourceContext({ import_receipt: { ...receipt, sha256: "missing" } })).toBe("");
  expect(getTrustedSourceContext({ import_receipt: { source_label: "Unverified hidden person" } })).toBe("");
  expect(getTrustedSourceContext({ ...item.provenance, import_attachment_changed: true })).toBe("Synthetic Juniper outings");
});
