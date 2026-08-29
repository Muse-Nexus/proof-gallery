import { describe, expect, it } from "vitest";
import { fuseRows } from "../../supabase/functions/_shared/search";

describe("deterministic Proof-only rank fusion", () => {
  it("combines semantic and lexical rank without synthesizing fields", () => {
    const semantic = [
      { id: "proof-a", title: "Synthetic A", similarity: 0.8 },
      { id: "proof-b", title: "Synthetic B", similarity: 0.7 },
    ];
    const lexical = [
      { id: "proof-b", title: "Synthetic B", relevance: 0.9 },
      { id: "proof-c", title: "Synthetic C", relevance: 0.5 },
    ];
    const result = fuseRows(semantic, lexical, 3);
    expect(result.map(({ row }) => row.id)).toEqual([
      "proof-b",
      "proof-a",
      "proof-c",
    ]);
    expect(result[0]?.row.title).toBe("Synthetic B");
  });

  it("returns no padding when no rows genuinely match", () => {
    expect(fuseRows([], [], 10)).toEqual([]);
  });

  it("enforces the requested result bound", () => {
    const rows = Array.from({ length: 12 }, (_, index) => ({
      id: `proof-${index}`,
    }));
    expect(fuseRows(rows, [], 6)).toHaveLength(6);
  });
});
