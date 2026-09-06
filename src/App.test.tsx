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
  countLocalProofCandidates,
  deleteLocalProofItem,
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
  countLocalProofCandidates: vi.fn().mockResolvedValue(0),
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
vi.mock("./lib/encrypted-backup", () => ({ isEncryptedProofBackup: vi.fn().mockResolvedValue(false) }));
vi.mock("./components/FolderSource", () => ({
  FolderSource: ({ suspended, onCandidatesAdded }: { suspended: boolean; onCandidatesAdded: () => void }) => (
    <section aria-label="Chosen folder source" data-suspended={String(suspended)}>
      <button type="button" onClick={onCandidatesAdded}>Synthetic new candidate notification</button>
    </section>
  ),
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
  vi.mocked(countLocalProofCandidates).mockResolvedValue(0);
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
        name: "Evidence that you matter.",
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
      pendingImported: 0,
    });
    vi.mocked(requestLocalProofPersistence).mockResolvedValue(true);
    render(<App />);
    fireEvent.click(
      screen.getByRole("button", { name: "Start in this browser" }),
    );
    await screen.findByRole("button", { name: "Add Proof" });
    fireEvent.click(screen.getByText("More"));

    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    fireEvent.change(screen.getByLabelText("Backup file"), {
      target: {
        files: [
          new File(["synthetic backup"], "proof-backup.json", {
            type: "application/json",
          }),
        ],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Validate and restore" }));

    await waitFor(() =>
      expect(requestLocalProofPersistence).toHaveBeenCalledOnce(),
    );
    expect(
      screen.getByText(
        "Restored 2 saved Proof and 0 pending review items. Identical existing items were left unchanged.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps saved Proof when deletion is cancelled", async () => {
    const item = localItem();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    vi.mocked(listLocalProofItems).mockResolvedValue([item]);
    window.localStorage.setItem("proof-gallery-storage-mode", "local");
    render(<App />);
    await screen.findByRole("heading", { name: item.title });

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(confirm).toHaveBeenCalledExactlyOnceWith(
      "Delete this Proof item? This cannot be undone.",
    );
    expect(deleteLocalProofItem).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: item.title })).toBeInTheDocument();
    expect(screen.getByText("1 saved Proof item")).toBeInTheDocument();
    expect(screen.queryByText("Proof deleted.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Proof" })).toBeEnabled();
  });

  it("clears the old deletion notice after successfully restoring the deleted Proof", async () => {
    const item = localItem();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(listLocalProofItems)
      .mockResolvedValueOnce([item])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([item]);
    vi.mocked(deleteLocalProofItem).mockResolvedValueOnce({ cleanupFailed: false });
    vi.mocked(importLocalProofBackup).mockResolvedValueOnce({
      imported: 1,
      importedCount: 1,
      items: [item],
      pendingImported: 0,
    });
    window.localStorage.setItem("proof-gallery-storage-mode", "local");
    render(<App />);
    await screen.findByRole("heading", { name: item.title });

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await screen.findByRole("heading", { name: "Your local gallery is empty" });
    expect(screen.getByText("Proof deleted.")).toBeInTheDocument();

    fireEvent.click(screen.getByText("More"));
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    fireEvent.change(screen.getByLabelText("Backup file"), {
      target: {
        files: [new File(["synthetic backup"], "proof-backup.json", { type: "application/json" })],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Validate and restore" }));

    await screen.findByText(
      "Restored 1 saved Proof and 0 pending review items. Identical existing items were left unchanged.",
    );
    expect(screen.getByRole("heading", { name: item.title })).toBeInTheDocument();
    expect(screen.getByText("1 saved Proof item")).toBeInTheDocument();
    expect(screen.queryByText("Proof deleted.")).not.toBeInTheDocument();
  });

  it("lets a returning local user revisit the shareable landing page", async () => {
    window.localStorage.setItem("proof-gallery-storage-mode", "local");
    render(<App />);

    await screen.findByRole("button", { name: "Add Proof" });
    fireEvent.click(screen.getByText("More"));
    fireEvent.click(screen.getByRole("button", { name: "About" }));

    expect(
      screen.getByRole("heading", {
        name: "Evidence that you matter.",
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

    await waitFor(() => expect(searchLocalProofItems).toHaveBeenCalledOnce());
    await act(async () => finishSearch({ items: [item], semanticDegraded: true }));
    const edit = screen.getByRole("button", { name: "Edit" });
    expect(edit).toBeEnabled();
    fireEvent.click(edit);
    expect(screen.getByRole("button", { name: "Close editor" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Close editor" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("fills a search idea without retrieving evidence until the user submits", async () => {
    window.localStorage.setItem("proof-gallery-storage-mode", "local");
    render(<App />);
    await screen.findByRole("heading", { name: "Your local gallery is empty" });

    fireEvent.click(screen.getByRole("button", { name: /Times people valued my work/ }));
    const search = screen.getByRole("searchbox", { name: "Search your Proof" });
    expect(search).toHaveValue("Times people valued my work");
    expect(search).toHaveFocus();
    expect(searchLocalProofItems).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Search Proof" }));
    await waitFor(() => expect(searchLocalProofItems).toHaveBeenCalledOnce());
  });

  it("keeps a chosen folder mounted across views and suspends it while editing", async () => {
    window.localStorage.setItem("proof-gallery-storage-mode", "local");
    const { container } = render(<App />);
    await screen.findByRole("heading", { name: "Your local gallery is empty" });
    const folder = container.querySelector('[aria-label="Chosen folder source"]');
    expect(folder).not.toBeVisible();
    expect(folder).toHaveAttribute("data-suspended", "false");

    fireEvent.click(screen.getByRole("button", { name: "Sources" }));
    expect(screen.getByRole("region", { name: "Chosen folder source" })).toBe(folder);
    fireEvent.click(screen.getByRole("button", { name: "Saved Proof" }));
    expect(container.querySelector('[aria-label="Chosen folder source"]')).toBe(folder);
    expect(folder).toHaveAttribute("data-suspended", "false");

    fireEvent.click(screen.getByRole("button", { name: "Add Proof" }));
    expect(folder).toHaveAttribute("data-suspended", "true");
    fireEvent.click(screen.getByRole("button", { name: "Close editor" }));
    expect(folder).toHaveAttribute("data-suspended", "false");
  });

  it("updates only the review count when background media arrives during saved search", async () => {
    const item = localItem();
    vi.mocked(listLocalProofItems).mockResolvedValue([item]);
    vi.mocked(searchLocalProofItems).mockResolvedValue({ items: [item], semanticDegraded: true });
    vi.mocked(countLocalProofCandidates).mockResolvedValue(2);
    window.localStorage.setItem("proof-gallery-storage-mode", "local");
    render(<App />);
    await screen.findByRole("button", { name: "Review media, 2 pending" });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search your Proof" }), { target: { value: "synthetic" } });
    fireEvent.click(screen.getByRole("button", { name: "Search Proof" }));
    await screen.findByText("1 search result");
    const listCalls = vi.mocked(listLocalProofItems).mock.calls.length;
    const releaseCalls = vi.mocked(releaseLocalProofImageUrls).mock.calls.length;

    vi.mocked(countLocalProofCandidates).mockResolvedValue(3);
    const notify = vi.mocked(subscribeToLocalProofChanges).mock.calls[0]?.[0];
    if (!notify) throw new Error("Local change subscription was not registered");
    act(() => notify("pending"));

    await screen.findByRole("button", { name: "Review media, 3 pending" });
    expect(screen.getByText("1 search result")).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search your Proof" })).toHaveValue("synthetic");
    expect(listLocalProofItems).toHaveBeenCalledTimes(listCalls);
    expect(releaseLocalProofImageUrls).toHaveBeenCalledTimes(releaseCalls);
    expect(searchLocalProofItems).toHaveBeenCalledOnce();
  });

  it("keeps an active search intact when automatic Proof arrives until explicitly opened", async () => {
    const item = localItem();
    const added = { ...item, id: "33333333-3333-4333-8333-333333333333", title: "Synthetic auto-saved photo" };
    vi.mocked(listLocalProofItems).mockResolvedValue([item]);
    vi.mocked(searchLocalProofItems).mockResolvedValue({ items: [item], semanticDegraded: true });
    window.localStorage.setItem("proof-gallery-storage-mode", "local");
    render(<App />);
    await screen.findByText("1 saved Proof item");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "synthetic" } });
    fireEvent.click(screen.getByRole("button", { name: "Search Proof" }));
    await screen.findByText("1 search result");
    const listCalls = vi.mocked(listLocalProofItems).mock.calls.length;
    const releaseCalls = vi.mocked(releaseLocalProofImageUrls).mock.calls.length;
    vi.mocked(listLocalProofItems).mockResolvedValue([item, added]);
    const notify = vi.mocked(subscribeToLocalProofChanges).mock.calls[0][0];
    act(() => notify("automatic"));
    expect(screen.getByText("1 search result")).toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toHaveValue("synthetic");
    expect(screen.queryByText(added.title)).not.toBeInTheDocument();
    expect(listLocalProofItems).toHaveBeenCalledTimes(listCalls);
    expect(releaseLocalProofImageUrls).toHaveBeenCalledTimes(releaseCalls);
    fireEvent.click(screen.getByRole("button", { name: "Show newly saved Proof" }));
    expect(await screen.findByText(added.title)).toBeInTheDocument();
    expect(screen.getByText("2 saved Proof items")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show newly saved Proof" })).not.toBeInTheDocument();
  });

  it("loads newly auto-saved sources for a new search and its requested story", async () => {
    const item = { ...localItem(), title: "Synthetic newly saved source" };
    window.localStorage.setItem("proof-gallery-storage-mode", "local");
    render(<App />);
    await screen.findByText("Your local gallery is empty");
    vi.mocked(listLocalProofItems).mockResolvedValue([item]);
    vi.mocked(searchLocalProofItems).mockResolvedValue({ items: [item], semanticDegraded: true });
    const notify = vi.mocked(subscribeToLocalProofChanges).mock.calls[0][0];
    act(() => notify("automatic"));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "synthetic" } });
    fireEvent.click(screen.getByRole("button", { name: "Search Proof" }));
    await screen.findByText("1 search result");
    fireEvent.click(screen.getByRole("button", { name: "Read as a story" }));
    expect(screen.getByRole("heading", { name: "A story in your own words" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show newly saved Proof" })).not.toBeInTheDocument();
  });

  it("does not reload evidence when source consent changes in another tab", async () => {
    vi.mocked(listLocalProofItems).mockResolvedValue([localItem()]);
    window.localStorage.setItem("proof-gallery-storage-mode", "local");
    render(<App />);
    await screen.findByText("1 saved Proof item");
    const calls = vi.mocked(listLocalProofItems).mock.calls.length;
    const notify = vi.mocked(subscribeToLocalProofChanges).mock.calls[0][0];
    act(() => notify("source"));
    expect(listLocalProofItems).toHaveBeenCalledTimes(calls);
    expect(screen.getByText(localItem().title)).toBeInTheDocument();
  });

  it("defers arrivals and changed revisions during recall until a new explicit source snapshot", async () => {
    const original = localItem();
    const older = { ...original, id: "22222222-2222-4222-8222-222222222222", title: "Synthetic earlier revision" };
    const changed = { ...older, title: "Synthetic revised source", updatedAt: "2026-09-06T12:00:00.000Z", relevance: 0.8 };
    const added = { ...original, id: "33333333-3333-4333-8333-333333333333", title: "Synthetic later arrival", relevance: 0.9 };
    const matches = { items: [added, changed, { ...original, relevance: 0.7 }], semanticDegraded: true };
    let finishSearch!: (value: Awaited<ReturnType<typeof searchLocalProofItems>>) => void;
    vi.mocked(listLocalProofItems).mockResolvedValue([original, older]);
    vi.mocked(searchLocalProofItems).mockImplementationOnce(() => new Promise(resolve => { finishSearch = resolve; }));
    window.localStorage.setItem("proof-gallery-storage-mode", "local");
    render(<App />);
    await screen.findByText("2 saved Proof items");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "synthetic" } });
    fireEvent.click(screen.getByRole("button", { name: "Search Proof" }));
    await waitFor(() => expect(searchLocalProofItems).toHaveBeenCalledOnce());

    vi.mocked(listLocalProofItems).mockResolvedValue([original, changed, added]);
    const notify = vi.mocked(subscribeToLocalProofChanges).mock.calls[0][0];
    act(() => notify("automatic"));
    await act(async () => finishSearch(matches));
    expect(screen.getByText("1 search result")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: added.title })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: changed.title })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show newly saved Proof" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Read as a story" }));
    expect(screen.getByRole("heading", { name: original.title, level: 3 })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close story" }));

    vi.mocked(searchLocalProofItems).mockResolvedValue(matches);
    fireEvent.click(screen.getByRole("button", { name: "Search Proof" }));
    await screen.findByText("3 search results");
    expect(screen.queryByRole("button", { name: "Show newly saved Proof" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 }).filter(heading => heading.closest(".proof-card")).map(heading => heading.textContent)).toEqual([added.title, changed.title, original.title]);
    fireEvent.click(screen.getAllByRole("button", { name: "Read as a story" })[0]);
    expect(screen.getByRole("heading", { name: added.title, level: 3 })).toBeInTheDocument();
  });
});
