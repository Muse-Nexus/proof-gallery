import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  listLocalProofItems,
  releaseLocalProofImageUrls,
  subscribeToLocalProofChanges,
} from "./lib/local-proof-store";
import type { ProofItem } from "./lib/proof";
import App from "./App";

vi.mock("./lib/local-proof-store", () => ({
  LOCAL_PROOF_OWNER_ID: "local-browser-profile",
  clearLocalProofItems: vi.fn().mockResolvedValue(undefined),
  createLocalProofItem: vi.fn(),
  deleteLocalProofItem: vi.fn(),
  exportLocalProofBackup: vi.fn(),
  importLocalProofBackup: vi.fn(),
  listLocalProofItems: vi.fn().mockResolvedValue([]),
  releaseLocalProofImageUrls: vi.fn(),
  requestLocalProofPersistence: vi.fn().mockResolvedValue(false),
  searchLocalProofItems: vi.fn().mockResolvedValue({
    items: [],
    semanticDegraded: true,
  }),
  subscribeToLocalProofChanges: vi.fn().mockReturnValue(() => undefined),
  updateLocalProofItem: vi.fn(),
}));

function localItem(): ProofItem {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    userId: "local-browser-profile",
    title: "Synthetic cross-tab Proof",
    evidenceText: "Synthetic evidence visible before an external clear.",
    occurredOn: "2026-08-29",
    category: "shipped",
    sourceType: "work",
    source: "Synthetic App test",
    tags: ["synthetic"],
    person: null,
    project: "Proof Gallery",
    imagePath: null,
    imageUrl: null,
    provenance: { kind: "manual", source_type: "work" },
    visibility: "personal",
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:00.000Z",
    relevance: null,
  };
}

beforeEach(() => {
  vi.mocked(listLocalProofItems).mockResolvedValue([]);
  vi.mocked(subscribeToLocalProofChanges).mockReturnValue(() => undefined);
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("standalone local storage boundary", () => {
  it("requires an explicit choice before opening local Proof", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<App />);

    expect(
      screen.getByRole("heading", {
        name: "Keep the receipts your brain misplaces.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Stored in this browser profile · not synced · not encrypted/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "View the code" }),
    ).toHaveAttribute("href", "https://github.com/Muse-Nexus/proof-gallery");
    expect(
      screen.queryByRole("heading", { name: "Restore the evidence you saved" }),
    ).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();

    const localStart = screen.getByRole("button", {
      name: "Start in this browser",
    });
    expect(localStart).toHaveAccessibleDescription(
      /Stored in this browser profile\. Not synced or encrypted by Proof Gallery\./i,
    );
    fireEvent.click(localStart);

    expect(
      await screen.findByRole("heading", {
        name: "Restore the evidence you saved",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Local · not synced · not encrypted"),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem("proof-gallery-storage-mode")).toBe(
      "local",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("uses the honest local boundary inside the editor", async () => {
    render(<App />);
    fireEvent.click(
      screen.getByRole("button", { name: "Start in this browser" }),
    );
    await screen.findByRole("button", { name: "Add Proof" });

    fireEvent.click(screen.getByRole("button", { name: "Add Proof" }));

    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Local · not synced · not encrypted",
    );
    expect(screen.getByRole("dialog")).not.toHaveTextContent(
      "Private · only you",
    );
  });

  it("lets a returning local user revisit the shareable landing page", async () => {
    window.localStorage.setItem("proof-gallery-storage-mode", "local");
    render(<App />);

    await screen.findByRole("button", { name: "Add Proof" });
    fireEvent.click(screen.getByRole("button", { name: "About" }));

    expect(
      screen.getByRole("heading", {
        name: "Keep the receipts your brain misplaces.",
      }),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem("proof-gallery-storage-mode")).toBe(
      "local",
    );
  });

  it("revokes and removes visible evidence after another tab clears local Proof", async () => {
    const item = localItem();
    vi.mocked(listLocalProofItems)
      .mockResolvedValueOnce([item])
      .mockResolvedValue([]);
    window.localStorage.setItem("proof-gallery-storage-mode", "local");

    render(<App />);
    expect(
      await screen.findByText("Synthetic cross-tab Proof"),
    ).toBeInTheDocument();

    const notify = vi.mocked(subscribeToLocalProofChanges).mock.calls[0]?.[0];
    if (!notify) throw new Error("Local change subscription was not registered");
    notify("clear");

    await waitFor(() =>
      expect(
        screen.queryByText("Synthetic cross-tab Proof"),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("heading", { name: "Your local gallery is empty" }),
    ).toBeInTheDocument();
    expect(releaseLocalProofImageUrls).toHaveBeenCalled();
    expect(
      screen.getByText("Local Proof was removed in another open tab."),
    ).toBeInTheDocument();
  });
});
