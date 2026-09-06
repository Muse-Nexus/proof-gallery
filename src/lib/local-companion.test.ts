import { Blob as NodeBlob } from "node:buffer";
import { afterEach, expect, it, vi } from "vitest";
import { parsePairingCode, pairCompanion, receiveCompanionReview, semanticCompanionSearch, draftCompanionStory } from "./local-companion";
import { sortProofItems, type ProofItem } from "./proof";
const session = { port: 12345, token: "a".repeat(64), expiresAt: Date.now() + 300000, semantic: true, story: true };
const item: ProofItem = { id: "11111111-1111-4111-8111-111111111111", userId: "local-browser-owner", visibility: "personal", title: "Synthetic", evidenceText: "Nobody said I did a great job.", occurredOn: "2020-01-01", category: "belonging", sourceType: "message", source: "Synthetic", tags: [], person: null, project: null, provenance: {}, imagePath: null, imageUrl: null, createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2020-01-01T00:00:00.000Z", relevance: null };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function respond(value: unknown) { vi.stubGlobal("Blob", NodeBlob); return vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } })); }
it("only accepts loopback pairing tokens and never persists them", async () => {
  for (const bad of ["https://evil.example", "12345.short", `80.${session.token}`, `65536.${session.token}`]) expect(() => parsePairingCode(bad)).toThrow();
  const network = respond({ semantic: true, story: false });
  const storage = vi.spyOn(Storage.prototype, "setItem");
  const paired = await pairCompanion(`12345.${session.token}`);
  expect(paired.semantic).toBe(true); expect(storage).not.toHaveBeenCalled();
  expect(network).toHaveBeenCalledWith("http://127.0.0.1:12345/v1/capabilities", expect.objectContaining({ credentials: "omit", redirect: "error", cache: "no-store" }));
});
it("preserves semantic order through gallery sorting and rejects foreign ownership before sending", async () => {
  const newer = { ...item, id: "22222222-2222-4222-8222-222222222222", occurredOn: "2026-01-01" };
  const network = respond({ ids: [item.id, newer.id], excerpts: [] });
  const result = await semanticCompanionSearch(session, "synthetic appreciation", [newer, item]);
  expect(sortProofItems(result, "relevance")[0].id).toBe(item.id);
  network.mockClear();
  await expect(semanticCompanionSearch(session, "synthetic", [{ ...item, userId: "other-owner" }])).rejects.toThrow("saved local Proof");
  expect(network).not.toHaveBeenCalled();
});
it("rejects a misleading substring and accepts only the full original context", async () => {
  const network = respond({ excerpts: [{ sourceID: item.id, exactExcerpt: "I did a great job." }] });
  await expect(draftCompanionStory(session, [item])).rejects.toThrow("full-source");
  network.mockResolvedValue(new Response(JSON.stringify({ excerpts: [{ sourceID: item.id, exactExcerpt: item.evidenceText }] })));
  expect((await draftCompanionStory(session, [item]))[0].exactExcerpt).toBe(item.evidenceText);
});
it("bounds streamed responses even without a content-length", async () => {
  vi.stubGlobal("Blob", NodeBlob);
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(64 * 1024 * 1024 + 1)); controller.close(); } })));
  await expect(receiveCompanionReview(session)).rejects.toThrow("size limit");
});
