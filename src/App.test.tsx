import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  importLocalProofBackup,
  listLocalProofItems,
  releaseLocalProofImageUrls,
  requestLocalProofPersistence,
  searchLocalProofItems,
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
  vi.mocked(searchLocalProofItems).mockResolvedValue({
    items: [],
    semanticDegraded: true,
  });
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
      screen.getByText(/Stored in this browser profile\. Not synced or encrypted/i),
    ).toBeInTheDocument();
    expect(screen.getByText("AI-generated decorative image")).toBeInTheDocument();
    expect(screen.getAllByText("Not saved Proof")).toHaveLength(2);
    expect(
      screen.getByRole("link", { name: "View the code" }),
    ).toHaveAttribute("href", "https://github.com/Muse-Nexus/proof-gallery");
    expect(
      screen.queryByRole("heading", { name: "What do you need proof of right now?" }),
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
        name: "What do you need proof of right now?",
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

  it("requests durable browser storage after restoring a local backup", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(importLocalProofBackup).mockResolvedValue({
      imported: 2,
      importedCount: 2,
      items: [],
    });
    vi.mocked(requestLocalProofPersistence).mockResolvedValue(true);
    render(<App />);
    fireEvent.click(
      screen.getByRole("button", { name: "Start in this browser" }),
    );
    await screen.findByRole("button", { name: "Restore" });

    fireEvent.change(screen.getByLabelText("Restore Proof Gallery backup"), {
      target: {
        files: [
          new File(["synthetic backup"], "proof-backup.json", {
            type: "application/json",
          }),
        ],
      },
    });

    await waitFor(() =>
      expect(requestLocalProofPersistence).toHaveBeenCalledOnce(),
    );
    expect(
      screen.getByText(
        "2 Proof items restored locally. Keep the backup somewhere private for recovery.",
      ),
    ).toBeInTheDocument();
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
    const savedProof = screen.getByRole("region", { name: "Saved Proof" });
    expect(savedProof.querySelector("img")).toBeNull();
    expect(savedProof).toHaveTextContent("Text-only Proof");

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

  it.each([
    ["Category", "awards"],
    ["Tag", "synthetic"],
  ])("shows honest empty results and clears the %s filter", async (label, value) => {
    const secondItem = {
      ...localItem(),
      id: "22222222-2222-4222-8222-222222222222",
      title: "Synthetic second Proof",
      category: "creativity" as const,
      tags: ["example"],
    };
    vi.mocked(listLocalProofItems).mockResolvedValue([localItem(), secondItem]);
    window.localStorage.setItem("proof-gallery-storage-mode", "local");
    render(<App />);
    expect(await screen.findByText("2 saved Proof items")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    if (label === "Category") {
      expect(screen.getByRole("heading", { name: "No Proof matches these filters" }))
        .toBeInTheDocument();
      expect(screen.getByText("0 of 2 saved Proof items")).toBeInTheDocument();
      expect(screen.queryByText("Your local gallery is empty")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Add the first Proof" }))
        .not.toBeInTheDocument();
    } else {
      expect(screen.getByText("1 of 2 saved Proof items")).toBeInTheDocument();
      expect(screen.queryByText(secondItem.title)).not.toBeInTheDocument();
    }

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("2 saved Proof items")).toBeInTheDocument();
    expect(screen.getByText(secondItem.title)).toBeInTheDocument();
    expect(screen.getByLabelText(label)).toHaveValue("");
    expect(searchLocalProofItems).not.toHaveBeenCalled();
  });

  it("names search accessibly and clears results without removing filters or saved Proof", async () => {
    const item = localItem();
    vi.mocked(listLocalProofItems).mockResolvedValue([item]);
    vi.mocked(searchLocalProofItems).mockResolvedValue({
      items: [item],
      semanticDegraded: true,
    });
    window.localStorage.setItem("proof-gallery-storage-mode", "local");
    render(<App />);
    await screen.findByText("1 saved Proof item");
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "shipped" } });
    const input = screen.getByRole("searchbox", { name: "Search your Proof" });
    fireEvent.change(input, { target: { value: "synthetic shipped" } });
    expect(searchLocalProofItems).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Search Proof" }));
    expect(await screen.findByText("1 search result")).toBeInTheDocument();
    expect(searchLocalProofItems).toHaveBeenCalledWith("synthetic shipped", {
      category: "shipped", tag: null,
    });

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(input).toHaveValue("");
    expect(screen.getByLabelText("Category")).toHaveValue("shipped");
    expect(screen.getByText(item.title)).toBeInTheDocument();
    expect(screen.getByText("1 of 1 saved Proof item")).toBeInTheDocument();
    expect(screen.queryByText("Sorted by relevance")).not.toBeInTheDocument();
  });

  it("can recover from an empty search by showing all saved Proof", async () => {
    vi.mocked(listLocalProofItems).mockResolvedValue([localItem()]);
    window.localStorage.setItem("proof-gallery-storage-mode", "local");
    render(<App />);
    await screen.findByText("1 saved Proof item");
    fireEvent.change(screen.getByLabelText("Tag"), { target: { value: "synthetic" } });
    const input = screen.getByRole("searchbox", { name: "Search your Proof" });
    fireEvent.change(input, { target: { value: "no matching terms" } });
    fireEvent.click(screen.getByRole("button", { name: "Search Proof" }));
    expect(await screen.findByText("0 search results")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show all Proof" }));
    expect(input).toHaveValue("");
    expect(screen.getByLabelText("Tag")).toHaveValue("");
    expect(screen.getByText("1 saved Proof item")).toBeInTheDocument();
    expect(screen.getByText(localItem().title)).toBeInTheDocument();
  });

  it("does not open an editor or start deletion during an unrelated pending operation", async () => {
    const item = localItem();
    vi.mocked(listLocalProofItems).mockResolvedValue([item]);
    let finishSearch!: (value: Awaited<ReturnType<typeof searchLocalProofItems>>) => void;
    vi.mocked(searchLocalProofItems).mockImplementation(() => new Promise((resolve) => {
      finishSearch = resolve;
    }));
    window.localStorage.setItem("proof-gallery-storage-mode", "local");
    render(<App />);
    await screen.findByText("1 saved Proof item");
    fireEvent.change(screen.getByRole("searchbox", { name: "Search your Proof" }), {
      target: { value: "synthetic evidence" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search Proof" }));

    for (const name of ["Add Proof", "Edit", "Delete"]) {
      const control = screen.getByRole("button", { name });
      expect(control).toBeDisabled();
      fireEvent.click(control);
    }
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search your Proof" })).toBeDisabled();
    expect(screen.getByLabelText("Category")).toBeDisabled();
    expect(screen.getByLabelText("Tag")).toBeDisabled();

    await act(async () => finishSearch({ items: [item], semanticDegraded: true }));
    const edit = screen.getByRole("button", { name: "Edit" });
    expect(edit).toBeEnabled();
    fireEvent.click(edit);
    expect(screen.getByRole("button", { name: "Close editor" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Close editor" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
