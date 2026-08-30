import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProofItem } from "../lib/proof";
import { ProofCard } from "./ProofCard";

function proofItem(overrides: Partial<ProofItem> = {}): ProofItem {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    userId: "synthetic-owner",
    title: "Synthetic launch receipt",
    evidenceText: "The synthetic project shipped exactly as recorded.",
    occurredOn: "2026-08-29",
    category: "shipped",
    sourceType: "work",
    source: "Synthetic release receipt",
    tags: ["synthetic", "launch"],
    person: null,
    project: "Proof Gallery test",
    imagePath: null,
    imageUrl: null,
    provenance: { kind: "manual", source_type: "work" },
    visibility: "personal",
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:00.000Z",
    relevance: null,
    ...overrides,
  };
}

afterEach(cleanup);

describe("ProofCard image truth boundary", () => {
  it("keeps the derivative label even when the editable source text changes", () => {
    const item = proofItem({ source: "Synthetic edited source", provenance: { import_receipt: {
      method: "mac_photos_companion", companion: { assetIdentifier: "synthetic", originalFilename: "synthetic.heic", originalSha256: "f".repeat(64), representation: "jpeg-preview", captureDate: null, timeZone: "UTC", scope: "Synthetic album" },
    } } });
    const { rerender } = render(<ProofCard item={item} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText(/JPEG preview · original remains in Apple Photos/)).toBeInTheDocument();
    rerender(<ProofCard item={{ ...item, provenance: { ...item.provenance, import_attachment_changed: true } }} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText(/Historical import \(attachment since changed\)/)).toBeInTheDocument();
  });
  it("shows a complete evidence attachment only when its stored path and URL exist", () => {
    render(
      <ProofCard
        item={proofItem({
          imagePath: "synthetic-owner/evidence.png",
          imageUrl: "blob:https://example.test/synthetic-evidence",
        })}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("img", { name: "Evidence image for Synthetic launch receipt" }),
    ).toHaveAttribute("src", "blob:https://example.test/synthetic-evidence");
    expect(screen.getByText("Evidence attachment")).toBeInTheDocument();
    expect(screen.getByText("Aug 29, 2026")).toBeInTheDocument();
    expect(screen.getByText("Synthetic release receipt")).toBeInTheDocument();
    expect(screen.getByText("Work or project")).toBeInTheDocument();
  });

  it("uses an explicit text-only cover and no image when none was attached", () => {
    const { container } = render(
      <ProofCard item={proofItem()} onEdit={vi.fn()} onDelete={vi.fn()} />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("Text-only Proof")).toBeInTheDocument();
    expect(screen.getByText("No image attached")).toBeInTheDocument();
    expect(screen.getByText("Synthetic release receipt")).toBeInTheDocument();
  });

  it("distinguishes a saved attachment from a temporarily unavailable preview", () => {
    const { container } = render(
      <ProofCard
        item={proofItem({
          imagePath: "synthetic-owner/evidence.png",
          imageUrl: null,
        })}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("Evidence attachment saved")).toBeInTheDocument();
    expect(screen.getByText("Preview unavailable")).toBeInTheDocument();
    expect(screen.queryByText("No image attached")).not.toBeInTheDocument();
  });

  it("does not render an orphan or decorative URL without an attachment path", () => {
    const { container } = render(
      <ProofCard
        item={proofItem({ imageUrl: "/visuals/evidence-desk-ai.webp" })}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("Text-only Proof")).toBeInTheDocument();
  });
});
