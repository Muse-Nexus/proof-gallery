import { describe, expect, it } from "vitest";
import { relatedSavedProof, storySequence, suggestNoteOrganization } from "./note-assist";
import type { ProofItem } from "./proof";

function syntheticProof(overrides: Partial<ProofItem> = {}): ProofItem {
  return { id: "fixture-a", userId: "fixture-owner", visibility: "personal", title: "Synthetic source",
    evidenceText: "We walked beside the river.", occurredOn: "2026-01-02", category: "belonging",
    sourceType: "memory", source: "Synthetic fixture only", tags: [], person: null, project: null,
    imagePath: null, imageUrl: null, provenance: {}, relevance: null,
    createdAt: "2026-01-03T00:00:00.000Z", updatedAt: "2026-01-03T00:00:00.000Z", ...overrides };
}
describe("local note organization", () => {
  it("suggests only literal words and never explains crying or dates", () => {
    const note = "River walk with my brother. Cried. Synthetic example.";
    expect(suggestNoteOrganization(note)).toMatchObject({ title: note, category: "belonging", cue: "brother" });
    expect(suggestNoteOrganization(note).tags).toContain("river");
    expect(suggestNoteOrganization("Cried.")).toMatchObject({ category: null, cue: null });
    expect(suggestNoteOrganization("A tree.").category).toBeNull();
    expect(suggestNoteOrganization("I was not invited.").category).toBeNull();
    expect(suggestNoteOrganization("They didn’t hire me.").category).toBeNull();
    for (const negative of ["I haven’t finished it.", "They weren't invited.", "She hasn’t recovered.", "We aren't together.", "It doesn't show a payment."]) {
      expect(suggestNoteOrganization(negative).category).toBeNull();
    }
    expect(suggestNoteOrganization("My brother finished the painting.").category).toBeNull();
  });
  it("bounds suggestions and does not invent a title for a blank note", () => {
    expect(suggestNoteOrganization("   ")).toEqual({ title: "", category: null, cue: null, tags: [] });
    expect(suggestNoteOrganization("word ".repeat(100)).title.length).toBe(100);
    expect(suggestNoteOrganization("maple oak pine birch cedar willow ash elm").tags).toHaveLength(6);
  });
});
describe("source-bound connections and stories", () => {
  it("matches meaningful words only inside the same owner's saved Proof", () => {
    const seed = syntheticProof();
    const match = syntheticProof({ id: "fixture-b", evidenceText: "Another river walk." });
    const unrelated = syntheticProof({ id: "fixture-c", evidenceText: "The train arrived.", category: "belonging" });
    const otherOwner = syntheticProof({ id: "fixture-d", userId: "different-owner" });
    const team = { ...match, id: "fixture-e", visibility: "team" } as unknown as ProofItem;
    const pending = { id: "pending", userId: seed.userId, visibility: "personal", input: { evidenceText: "river" } } as unknown as ProofItem;
    expect(relatedSavedProof(seed, [seed, match, unrelated, otherOwner, team, pending])).toEqual([{ item: match, sharedWords: ["river"] }]);
    expect(relatedSavedProof({ ...seed, evidenceText: "photo memory note" }, [match])).toEqual([]);
  });
  it("keeps exact notes, missing dates and sources, without mutating or storing a story", () => {
    const earlier = syntheticProof({ id: "earlier", occurredOn: "2026-01-01", evidenceText: "Exact words.\nUnchanged." });
    const later = syntheticProof();
    const unknown = syntheticProof({ id: "unknown", occurredOn: null, source: null });
    const values = [unknown, later, earlier]; const before = structuredClone(values);
    expect(storySequence(values, values.map(row => row.id), later.userId)).toEqual([earlier, later, unknown]);
    expect(values).toEqual(before);
    expect(storySequence(values, values.map(row => row.id), "different-owner")).toEqual([]);
    expect(storySequence(values, ["deleted"], later.userId)).toEqual([]);
  });
});
