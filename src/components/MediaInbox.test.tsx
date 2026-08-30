import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MediaInbox } from "./MediaInbox";
import { listLocalProofCandidates, resolveLocalProofCandidates, stageLocalProofMedia, subscribeToLocalProofChanges, type LocalProofCandidate } from "../lib/local-proof-store";

vi.mock("../lib/local-proof-store", () => ({
  listLocalProofCandidates: vi.fn(), resolveLocalProofCandidates: vi.fn().mockResolvedValue(undefined),
  stageLocalProofMedia: vi.fn().mockResolvedValue({ added: 1, duplicates: 0, rejected: [] }),
  subscribeToLocalProofChanges: vi.fn(() => () => undefined),
  requestLocalProofPersistence: vi.fn().mockResolvedValue(false),
  clearLocalProofCandidates: vi.fn().mockResolvedValue(undefined),
}));
const candidate: LocalProofCandidate = {
  id: "11111111-1111-4111-8111-111111111111", revision: "22222222-2222-4222-8222-222222222222",
  userId: "local-browser-owner", visibility: "personal", importedAt: "2026-08-30T00:00:00.000Z",
  fileName: "synthetic.png", mediaUrl: "blob:synthetic", mediaType: "image/png", size: 20,
  input: { title: "Synthetic photo", evidenceText: "", category: null, occurredOn: null, sourceType: "photo", source: "Selected file: synthetic.png", tags: [], person: null, project: null },
};
beforeEach(() => { vi.mocked(listLocalProofCandidates).mockResolvedValue([candidate]); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("does not save imported media until explicit review and preserves a selected category", async () => {
  const onSaved = vi.fn().mockResolvedValue(undefined);
  render(<MediaInbox busy={false} onBusyChange={vi.fn()} onSaved={onSaved} onClose={vi.fn()} />);
  await screen.findByText("Pending review · not saved Proof");
  expect(screen.getByText(/Review items are not in search or backups/)).toBeInTheDocument();
  const file = new File(["synthetic"], "synthetic.png", { type: "image/png" });
  fireEvent.change(screen.getByLabelText("Choose photos or clips"), { target: { files: [file] } });
  await waitFor(() => expect(stageLocalProofMedia).toHaveBeenCalledWith([file]));
  expect(resolveLocalProofCandidates).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox", { name: "Select all 1" }));
  fireEvent.change(screen.getByLabelText("Category for selected"), { target: { value: "belonging" } });
  fireEvent.click(screen.getByRole("button", { name: "Save selected (1)" }));
  await waitFor(() => expect(resolveLocalProofCandidates).toHaveBeenCalledWith([{ candidate, input: { ...candidate.input, category: "belonging" } }], "approve"));
  expect(onSaved).toHaveBeenCalledOnce();
});
it("never approves older metadata while a visible draft is unsaved", async () => {
  render(<MediaInbox busy={false} onBusyChange={vi.fn()} onSaved={vi.fn()} onClose={vi.fn()} />);
  await screen.findByText("Pending review · not saved Proof");
  fireEvent.click(screen.getByRole("checkbox", { name: "Select all 1" }));
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Synthetic changed title" } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Save selected (1)" })).toBeDisabled());
  expect(screen.getByRole("button", { name: "Close media inbox" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Save selected (1)" }));
  expect(resolveLocalProofCandidates).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Discard detail edits" }));
  expect(screen.getByLabelText("Title")).toHaveValue("Synthetic photo");
  expect(screen.getByRole("button", { name: "Save selected (1)" })).toBeEnabled();
});
it("retains a visible unsaved draft when another tab changes the candidate", async () => {
  render(<MediaInbox busy={false} onBusyChange={vi.fn()} onSaved={vi.fn()} onClose={vi.fn()} />);
  await screen.findByText("Pending review · not saved Proof");
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Synthetic unsaved detail" } });
  vi.mocked(listLocalProofCandidates).mockResolvedValue([{ ...candidate, revision: "33333333-3333-4333-8333-333333333333", input: { ...candidate.input, title: "Synthetic remote title" } }]);
  const notify = vi.mocked(subscribeToLocalProofChanges).mock.calls[0][0];
  notify("change");
  expect(await screen.findByText(/Review changed in another tab/)).toBeInTheDocument();
  expect(screen.getByLabelText("Title")).toHaveValue("Synthetic unsaved detail");
  fireEvent.click(screen.getByRole("button", { name: "Discard detail edits" }));
  await waitFor(() => expect(screen.getByLabelText("Title")).toHaveValue("Synthetic remote title"));
});
