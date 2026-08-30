import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProofStory } from "./ProofStory";
import type { ProofItem } from "../lib/proof";

const seed: ProofItem = { id: "fixture-a", userId: "fixture-owner", visibility: "personal", title: "Synthetic river moment",
  evidenceText: "Exact river words.\nNo explanation added.", occurredOn: "2026-01-01", category: "belonging",
  sourceType: "photo", source: "Synthetic source A", tags: [], person: null, project: null,
  imagePath: null, imageUrl: null, provenance: {}, relevance: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("only includes a related moment after selection, preserves notes and reacts to deletion", () => {
  const network = vi.spyOn(globalThis, "fetch");
  const related = { ...seed, id: "fixture-b", title: "Synthetic river sequel", evidenceText: "River at dusk.", source: null, occurredOn: null };
  const { rerender } = render(<ProofStory seed={seed} savedProof={[seed, related]} onClose={vi.fn()} />);
  expect(screen.getByText(/Exact river words/).textContent).toBe(seed.evidenceText);
  expect(screen.queryByText("River at dusk.")).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("Add a related saved moment (1)"));
  fireEvent.click(screen.getByRole("checkbox", { name: /Synthetic river sequel/ }));
  expect(screen.getByText("River at dusk.")).toBeInTheDocument();
  expect(screen.getByText("Date unknown · not placed in the timeline")).toBeInTheDocument();
  expect(screen.getByText("Source: MISSING")).toBeInTheDocument();
  rerender(<ProofStory seed={seed} savedProof={[seed]} onClose={vi.fn()} />);
  expect(screen.queryByText("River at dusk.")).not.toBeInTheDocument();
  expect(network).not.toHaveBeenCalled();
});
it("uses only real attachment previews and keeps companion provenance visible", () => {
  const photo = { ...seed, imagePath: "synthetic-preview.jpg", imageUrl: "blob:synthetic", evidenceText: "",
    provenance: { import_receipt: { method: "mac_photos_companion", companion: {
      assetIdentifier: "synthetic", originalFilename: "synthetic.heic", originalSha256: "f".repeat(64),
      representation: "jpeg-preview", captureDate: null, timeZone: "UTC", scope: "Synthetic scope",
    } } } };
  const { rerender } = render(<ProofStory seed={photo} savedProof={[photo]} onClose={vi.fn()} />);
  expect(screen.getByRole("img")).toHaveAttribute("src", "blob:synthetic");
  expect(screen.getByText(/JPEG preview · original remains in Apple Photos/)).toBeInTheDocument();
  expect(screen.getByText(/No note added/).closest("blockquote")).toBeNull();
  rerender(<ProofStory seed={{ ...photo, imageUrl: null }} savedProof={[photo]} onClose={vi.fn()} />);
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(screen.getByText("Attachment saved · preview unavailable.")).toBeInTheDocument();
  rerender(<ProofStory seed={{ ...photo, imagePath: null }} savedProof={[photo]} onClose={vi.fn()} />);
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
});
it("moves focus into the reading view and restores it on close", () => {
  const trigger = document.createElement("button"); document.body.appendChild(trigger); trigger.focus();
  const { unmount } = render(<ProofStory seed={seed} savedProof={[seed]} onClose={vi.fn()} />);
  expect(screen.getByRole("region", { name: "A story in your own words" })).toHaveFocus();
  unmount(); expect(trigger).toHaveFocus(); trigger.remove();
});
