import { describe, expect, it, vi } from "vitest";
import {
  PROOF_CATEGORIES,
  PROOF_CONSTITUTION,
  PROOF_SOURCE_TYPES,
  formatProofDate,
  normalizeTags,
  safeImageName,
  sortProofItems,
  validateProofImage,
  type ProofItem,
} from "./proof";

function item(overrides: Partial<ProofItem>): ProofItem {
  return {
    id: crypto.randomUUID(),
    userId: "00000000-0000-4000-8000-000000000001",
    title: "Synthetic evidence",
    evidenceText: "A fictional reviewer confirmed that the example was complete.",
    occurredOn: "2026-01-01",
    category: "shipped",
    sourceType: "email",
    source: "Synthetic test fixture",
    tags: ["example"],
    person: null,
    project: null,
    imagePath: null,
    imageUrl: null,
    provenance: { kind: "synthetic" },
    visibility: "personal",
    createdAt: "2026-01-02T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    relevance: null,
    ...overrides,
  };
}

describe("Proof domain", () => {
  it("ships the nine exact MVP categories", () => {
    expect(PROOF_CATEGORIES.map((category) => category.value)).toEqual([
      "belonging",
      "competence",
      "creativity",
      "parenting",
      "recovery",
      "money",
      "shipped",
      "awards",
      "kindness_received",
    ]);
  });

  it("offers broad manual provenance without enabling connectors", () => {
    expect(PROOF_SOURCE_TYPES.map((sourceType) => sourceType.value)).toEqual([
      "email",
      "message",
      "photo",
      "receipt",
      "award",
      "work",
      "memory",
      "conversation",
      "document",
      "web",
      "other",
    ]);
  });

  it("keeps the safety constitution literal and non-coercive", () => {
    expect(PROOF_CONSTITUTION).toContain("does not cancel pain");
    expect(PROOF_CONSTITUTION).not.toMatch(/should feel better|lucky/i);
  });

  it("normalizes, deduplicates, and caps tags", () => {
    const tags = Array.from({ length: 40 }, (_, index) => ` Tag-${index} `);
    expect(normalizeTags([" #Launch ", "launch", ...tags])).toHaveLength(30);
    expect(normalizeTags([" #Launch ", "launch", "  "])).toEqual(["launch"]);
  });

  it("preserves date-only values across time zones and exposes missing dates", () => {
    expect(formatProofDate(null)).toBe("MISSING");
    expect(formatProofDate("not-a-date")).toBe("MISSING");
    expect(formatProofDate("2026-02-03")).toMatch(/2026/);
  });

  it("sorts by relevance only when asked and otherwise uses occurred date", () => {
    const olderRelevant = item({ id: "older", occurredOn: "2024-01-01", relevance: 0.9 });
    const newer = item({ id: "newer", occurredOn: "2026-01-01", relevance: 0.1 });
    expect(sortProofItems([olderRelevant, newer], "newest").map((row) => row.id)).toEqual([
      "newer",
      "older",
    ]);
    expect(sortProofItems([olderRelevant, newer], "relevance").map((row) => row.id)).toEqual([
      "older",
      "newer",
    ]);
  });
});

describe("private image boundary", () => {
  it("accepts a declared PNG only when its magic bytes match", async () => {
    const png = new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      "synthetic.png",
      { type: "image/png" },
    );
    await expect(validateProofImage(png)).resolves.toBeUndefined();
  });

  it("rejects spoofed and active image formats", async () => {
    const spoofed = new File(["<script>synthetic</script>"], "synthetic.png", {
      type: "image/png",
    });
    const svg = new File(["<svg></svg>"], "synthetic.svg", {
      type: "image/svg+xml",
    });
    await expect(validateProofImage(spoofed)).rejects.toThrow("do not match");
    await expect(validateProofImage(svg)).rejects.toThrow("JPEG, PNG, WebP, or GIF");
  });

  it("derives storage extensions from validated MIME, not user filenames", () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "00000000-0000-4000-8000-000000000002",
    );
    expect(safeImageName("image/jpeg")).toBe(
      "00000000-0000-4000-8000-000000000002.jpg",
    );
    vi.restoreAllMocks();
  });
});
