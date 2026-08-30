import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MediaInbox } from "./MediaInbox";
import { listLocalProofCandidates, resolveLocalProofCandidates, stageLocalProofMedia, stageLocalProofCompanion, subscribeToLocalProofChanges, type LocalProofCandidate } from "../lib/local-proof-store";
import type { ProofItem } from "../lib/proof";

vi.mock("../lib/local-proof-store", () => ({
  listLocalProofCandidates: vi.fn(), resolveLocalProofCandidates: vi.fn().mockResolvedValue(undefined),
  stageLocalProofMedia: vi.fn().mockResolvedValue({ added: 1, duplicates: 0, rejected: [] }),
  stageLocalProofCompanion: vi.fn().mockResolvedValue({ added: 1, duplicates: 0 }),
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
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); });
it("does not save imported media until explicit review and preserves a selected category", async () => {
  const onSaved = vi.fn().mockResolvedValue(undefined);
  render(<MediaInbox busy={false} onBusyChange={vi.fn()} onSaved={onSaved} onClose={vi.fn()} />);
  await screen.findByText("Pending review · not saved Proof");
  expect(screen.getByText(/Review items are not in Proof search/)).toBeInTheDocument();
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
it("imports a companion review without approving its photos", async () => {
  render(<MediaInbox busy={false} onBusyChange={vi.fn()} onSaved={vi.fn()} onClose={vi.fn()} />);
  const file = new File(["synthetic"], "synthetic.proof-inbox.json", { type: "application/json" });
  fireEvent.change(screen.getByLabelText("Import companion review file"), { target: { files: [file] } });
  await waitFor(() => expect(stageLocalProofCompanion).toHaveBeenCalledWith(file));
  expect(resolveLocalProofCandidates).not.toHaveBeenCalled();
  expect(await screen.findByText(/companion photos added to review/)).toBeInTheDocument();
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
  expect(await screen.findByText(/Review has changes to load/)).toBeInTheDocument();
  expect(screen.getByLabelText("Title")).toHaveValue("Synthetic unsaved detail");
  fireEvent.click(screen.getByRole("button", { name: "Discard detail edits" }));
  await waitFor(() => expect(screen.getByLabelText("Title")).toHaveValue("Synthetic remote title"));
});
it("preserves dirty details when importing after a deferred remote revision", async () => {
  render(<MediaInbox busy={false} onBusyChange={vi.fn()} onSaved={vi.fn()} onClose={vi.fn()} />);
  await screen.findByText("Pending review · not saved Proof");
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Synthetic unsaved detail" } });
  vi.mocked(listLocalProofCandidates).mockResolvedValue([{ ...candidate, revision: "remote-revision", input: { ...candidate.input, title: "Synthetic remote title" } }]);
  act(() => vi.mocked(subscribeToLocalProofChanges).mock.calls[0][0]("change"));
  fireEvent.change(screen.getByLabelText("Choose photos or clips"), { target: { files: [new File(["synthetic"], "second.png", { type: "image/png" })] } });
  await waitFor(() => expect(listLocalProofCandidates).toHaveBeenCalledTimes(2));
  expect(screen.getByLabelText("Title")).toHaveValue("Synthetic unsaved detail");
  fireEvent.click(screen.getByRole("button", { name: "Discard detail edits" }));
  await waitFor(() => expect(screen.getByLabelText("Title")).toHaveValue("Synthetic remote title"));
});
it("applies a saved row without discarding another row's unsaved details", async () => {
  const second = { ...candidate, id: "second", input: { ...candidate.input, title: "Synthetic second photo" } };
  vi.mocked(listLocalProofCandidates).mockResolvedValue([candidate, second]);
  render(<MediaInbox busy={false} onBusyChange={vi.fn()} onSaved={vi.fn()} onClose={vi.fn()} />);
  await screen.findByRole("checkbox", { name: "Select all 2" });
  fireEvent.change(screen.getAllByLabelText("Title")[0], { target: { value: "Synthetic unsaved first" } });
  fireEvent.change(screen.getAllByLabelText("Title")[1], { target: { value: "Synthetic saved second" } });
  vi.mocked(listLocalProofCandidates).mockResolvedValue([
    { ...candidate, revision: "remote-first", input: { ...candidate.input, title: "Synthetic remote first" } },
    { ...second, revision: "saved-second", input: { ...second.input, title: "Synthetic saved second" } },
  ]);
  fireEvent.click(screen.getAllByRole("button", { name: "Save details" })[1]);
  await waitFor(() => expect(screen.getAllByRole("button", { name: "Discard detail edits" })).toHaveLength(1));
  expect(screen.getAllByLabelText("Title")[0]).toHaveValue("Synthetic unsaved first");
  expect(screen.getAllByLabelText("Title")[1]).toHaveValue("Synthetic saved second");
  fireEvent.click(screen.getByRole("button", { name: "Discard detail edits" }));
  await waitFor(() => expect(screen.getAllByLabelText("Title")[0]).toHaveValue("Synthetic remote first"));
});
it("preserves a draft started while a refresh read is in flight", async () => {
  render(<MediaInbox busy={false} onBusyChange={vi.fn()} onSaved={vi.fn()} onClose={vi.fn()} />);
  await screen.findByText("Pending review · not saved Proof");
  let finishRead!: (rows: LocalProofCandidate[]) => void;
  vi.mocked(listLocalProofCandidates).mockReturnValueOnce(new Promise(resolve => { finishRead = resolve; }));
  act(() => vi.mocked(subscribeToLocalProofChanges).mock.calls[0][0]("change"));
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Synthetic new draft" } });
  await act(async () => finishRead([{ ...candidate, revision: "remote-revision", input: { ...candidate.input, title: "Synthetic remote title" } }]));
  expect(screen.getByLabelText("Title")).toHaveValue("Synthetic new draft");
  expect(screen.getByText(/Review has changes to load/)).toBeInTheDocument();
});
it("saves a short note with visible organization suggestions only into pending review", async () => {
  const sourceCandidate = { ...candidate, input: { ...candidate.input, title: candidate.fileName } };
  vi.mocked(listLocalProofCandidates).mockResolvedValue([sourceCandidate]);
  const network = vi.spyOn(globalThis, "fetch");
  render(<MediaInbox busy={false} onBusyChange={vi.fn()} onSaved={vi.fn()} onClose={vi.fn()} />);
  await screen.findByText("Pending review · not saved Proof");
  const note = "River walk with my brother. Cried.";
  const field = screen.getByLabelText(/Your short note/);
  expect(field.closest("details")).toBeNull();
  fireEvent.change(field, { target: { value: note } });
  expect(screen.getByText(/Suggested from your words: Belonging/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  await waitFor(() => expect(resolveLocalProofCandidates).toHaveBeenCalledOnce());
  const [entries, action] = vi.mocked(resolveLocalProofCandidates).mock.calls[0];
  expect(action).toBe("edit");
  expect(entries[0].input).toMatchObject({ evidenceText: note, title: note, category: "belonging", source: candidate.input.source, occurredOn: null, person: null });
  expect(network).not.toHaveBeenCalled(); network.mockRestore();
});
it("allows saving only the note and keeps manual organization untouched", async () => {
  const manual = { ...candidate, input: { ...candidate.input, category: "awards" as const, tags: ["manual-tag"] } };
  vi.mocked(listLocalProofCandidates).mockResolvedValue([manual]);
  render(<MediaInbox busy={false} onBusyChange={vi.fn()} onSaved={vi.fn()} onClose={vi.fn()} />);
  await screen.findByText("Pending review · not saved Proof");
  fireEvent.change(screen.getByLabelText(/Your short note/), { target: { value: "My brother visited." } });
  fireEvent.click(screen.getByRole("checkbox", { name: "Use suggestions when saving this note" }));
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  await waitFor(() => expect(resolveLocalProofCandidates).toHaveBeenCalledOnce());
  expect(vi.mocked(resolveLocalProofCandidates).mock.calls[0][0][0].input).toMatchObject({
    category: "awards", tags: ["manual-tag"], title: "Synthetic photo", evidenceText: "My brother visited.",
  });
});
it("does not re-add explicitly removed tags or a cleared category", async () => {
  const manual = { ...candidate, input: { ...candidate.input, category: "belonging" as const, tags: ["brother"] } };
  vi.mocked(listLocalProofCandidates).mockResolvedValue([manual]);
  render(<MediaInbox busy={false} onBusyChange={vi.fn()} onSaved={vi.fn()} onClose={vi.fn()} />);
  await screen.findByText("Pending review · not saved Proof");
  fireEvent.change(screen.getByLabelText(/Your short note/), { target: { value: "My brother visited." } });
  fireEvent.change(screen.getByLabelText("Category"), { target: { value: "" } });
  fireEvent.change(screen.getByLabelText(/^Tags/), { target: { value: "" } });
  expect(screen.getByRole("checkbox", { name: "Use suggestions when saving this note" })).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  await waitFor(() => expect(resolveLocalProofCandidates).toHaveBeenCalledOnce());
  expect(vi.mocked(resolveLocalProofCandidates).mock.calls[0][0][0].input).toMatchObject({ category: null, tags: [], title: manual.input.title });
});
it("defaults later note edits to no automatic organization", async () => {
  const reviewed = { ...candidate, input: { ...candidate.input, evidenceText: "An earlier note." } };
  vi.mocked(listLocalProofCandidates).mockResolvedValue([reviewed]);
  render(<MediaInbox busy={false} onBusyChange={vi.fn()} onSaved={vi.fn()} onClose={vi.fn()} />);
  await screen.findByText("Pending review · not saved Proof");
  fireEvent.change(screen.getByLabelText(/Your short note/), { target: { value: "My brother visited." } });
  expect(screen.getByRole("checkbox", { name: "Use suggestions when saving this note" })).not.toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  await waitFor(() => expect(resolveLocalProofCandidates).toHaveBeenCalledOnce());
  expect(vi.mocked(resolveLocalProofCandidates).mock.calls[0][0][0].input).toMatchObject({ category: null, tags: [], title: reviewed.input.title });
});
it("derives an untouched HEIC filename title without changing its date or source receipt", async () => {
  const companion: LocalProofCandidate = { ...candidate, fileName: "synthetic-preview.jpg", input: {
    ...candidate.input, title: "synthetic.heic", occurredOn: "2026-01-01",
    source: "Apple Photos — Synthetic scope; synthetic.heic; JPEG preview, original remains in Photos",
  }, companionReceipt: { assetIdentifier: "synthetic", originalFilename: "synthetic.heic", originalSha256: "f".repeat(64), representation: "jpeg-preview", captureDate: "2026-01-01T00:00:00.000Z", timeZone: "UTC", scope: "Synthetic scope" } };
  vi.mocked(listLocalProofCandidates).mockResolvedValue([companion]);
  render(<MediaInbox busy={false} onBusyChange={vi.fn()} onSaved={vi.fn()} onClose={vi.fn()} />);
  await screen.findByText("Pending review · not saved Proof");
  fireEvent.change(screen.getByLabelText(/Your short note/), { target: { value: "River bend. Synthetic example." } });
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  await waitFor(() => expect(resolveLocalProofCandidates).toHaveBeenCalledOnce());
  const [entries, action] = vi.mocked(resolveLocalProofCandidates).mock.calls[0];
  expect(action).toBe("edit");
  expect(entries[0].candidate.companionReceipt).toEqual(companion.companionReceipt);
  expect(entries[0].input).toMatchObject({ title: "River bend. Synthetic example.", category: null, occurredOn: "2026-01-01", source: companion.input.source });
});
it("opens related saved Proof only on request and never quotes generated fallback copy", async () => {
  const related: ProofItem = { id: "synthetic-saved", userId: candidate.userId, visibility: "personal",
    ...candidate.input, title: "Synthetic attachment-only moment", category: "creativity", tags: ["river"],
    imagePath: "synthetic.png", imageUrl: null, provenance: {}, relevance: null,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
  const { rerender } = render(<MediaInbox savedProof={[related]} busy={false} onBusyChange={vi.fn()} onSaved={vi.fn()} onClose={vi.fn()} />);
  await screen.findByText("Pending review · not saved Proof");
  fireEvent.change(screen.getByLabelText(/Your short note/), { target: { value: "An unrelated sentence." } });
  fireEvent.change(screen.getByLabelText(/^Tags/), { target: { value: "river" } });
  expect(screen.queryByText(related.title)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Find related saved Proof" }));
  expect(screen.getByText(related.title)).toBeInTheDocument();
  expect(screen.getByText("Your current note is still an unsaved draft.")).toBeInTheDocument();
  expect(screen.getByText(/No note saved; see the original attachment/).closest("blockquote")).toBeNull();
  rerender(<MediaInbox savedProof={[]} busy={false} onBusyChange={vi.fn()} onSaved={vi.fn()} onClose={vi.fn()} />);
  expect(screen.queryByText(related.title)).not.toBeInTheDocument();
  expect(resolveLocalProofCandidates).not.toHaveBeenCalled();
});
