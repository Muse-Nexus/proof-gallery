import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FolderSource } from "./FolderSource";
import { confirmTrustedFolderSource, countLocalProofCandidates, forgetTrustedFolderSource, getTrustedFolderSource, setTrustedFolderActive, stageLocalProofMedia, stageTrustedFolderMedia, subscribeToLocalProofChanges, type TrustedFolderSource } from "../lib/local-proof-store";
import type { ProofFolder } from "../lib/folder-source";

vi.mock("../lib/local-proof-store", () => ({
  countLocalProofCandidates: vi.fn().mockResolvedValue(0),
  stageLocalProofMedia: vi.fn().mockResolvedValue({ added: 1, duplicates: 0, rejected: [] }),
  subscribeToLocalProofChanges: vi.fn(() => () => undefined),
  getTrustedFolderSource: vi.fn().mockResolvedValue(null),
  confirmTrustedFolderSource: vi.fn(),
  setTrustedFolderActive: vi.fn(),
  forgetTrustedFolderSource: vi.fn(),
  stageTrustedFolderMedia: vi.fn().mockResolvedValue({ added: 1, duplicates: 0, rejected: [] }),
}));
function source(getFile = vi.fn().mockResolvedValue(new File(["synthetic"], "synthetic.png", { type: "image/png", lastModified: 1 }))) {
  return { kind: "directory" as const, name: "Synthetic folder",
    queryPermission: vi.fn().mockResolvedValue("granted"), requestPermission: vi.fn().mockResolvedValue("granted"),
    values: vi.fn(async function* () { yield { kind: "file" as const, name: "synthetic.png", getFile }; }),
  } satisfies ProofFolder;
}
beforeEach(() => {
  vi.stubGlobal("isSecureContext", true);
  vi.mocked(countLocalProofCandidates).mockResolvedValue(0);
  vi.mocked(getTrustedFolderSource).mockResolvedValue(null);
  vi.mocked(confirmTrustedFolderSource).mockReset();
  vi.mocked(setTrustedFolderActive).mockReset();
  vi.mocked(forgetTrustedFolderSource).mockReset();
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function chooseFolder() {
  await waitFor(() => expect(screen.getByRole("button", { name: "Choose a folder" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Choose a folder" }));
}

it("keeps the standard media picker path when folder watching is unsupported", async () => {
  vi.stubGlobal("showDirectoryPicker", undefined);
  const onReview = vi.fn();
  render(<FolderSource suspended={false} onReview={onReview} />);
  expect(screen.getByText(/does not support automatic folder checks/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Start watching" })).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("button", { name: "Choose photos or clips" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Choose photos or clips" }));
  expect(onReview).toHaveBeenCalledOnce();
});

it("requires Start after folder selection and reports pending items without reading previews", async () => {
  const folder = source();
  const picker = vi.fn().mockResolvedValue(folder);
  const onCandidatesAdded = vi.fn();
  vi.stubGlobal("showDirectoryPicker", picker);
  const onReview = vi.fn();
  render(<FolderSource suspended={false} onReview={onReview} onCandidatesAdded={onCandidatesAdded} />);
  expect(picker).not.toHaveBeenCalled();
  await chooseFolder();
  await screen.findByRole("button", { name: "Start watching" });
  expect(folder.values).not.toHaveBeenCalled();
  vi.mocked(countLocalProofCandidates).mockResolvedValue(1);
  fireEvent.click(screen.getByRole("button", { name: "Start watching" }));
  await screen.findByText(/1 new item is ready/);
  expect(onCandidatesAdded).toHaveBeenCalledOnce();
  fireEvent.click(await screen.findByRole("button", { name: "Open review (1)" }));
  expect(onReview).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Disconnect folder" }));
  expect(screen.getByRole("button", { name: "Choose a folder" })).toBeInTheDocument();
});

it("preserves explicit Pause when editing suspension starts and ends", async () => {
  const folder = source();
  vi.stubGlobal("showDirectoryPicker", vi.fn().mockResolvedValue(folder));
  const props = { suspended: false, onReview: vi.fn() };
  const rendered = render(<FolderSource {...props} />);
  await chooseFolder();
  fireEvent.click(await screen.findByRole("button", { name: "Start watching" }));
  await screen.findByText(/1 new item is ready/);
  fireEvent.click(screen.getByRole("button", { name: "Pause" }));
  rendered.rerender(<FolderSource {...props} suspended />);
  rendered.rerender(<FolderSource {...props} />);
  expect(screen.getByText(/Paused by you/)).toBeInTheDocument();
  expect(folder.values).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Resume" })).toBeEnabled();
});

it("unmount cancels a pending read before staging", async () => {
  let complete!: (file: File) => void;
  const read = new Promise<File>(resolve => { complete = resolve; });
  const getFile = vi.fn().mockReturnValue(read);
  const folder = source(getFile);
  vi.stubGlobal("showDirectoryPicker", vi.fn().mockResolvedValue(folder));
  const rendered = render(<FolderSource suspended={false} onReview={vi.fn()} />);
  await chooseFolder();
  fireEvent.click(await screen.findByRole("button", { name: "Start watching" }));
  await waitFor(() => expect(getFile).toHaveBeenCalledOnce());
  rendered.unmount();
  await act(async () => { complete(new File(["synthetic"], "synthetic.png", { type: "image/png" })); });
  expect(stageLocalProofMedia).not.toHaveBeenCalled();
});

it("does not reopen an abandoned picker after unmount", async () => {
  let complete!: (folder: ProofFolder) => void;
  vi.stubGlobal("showDirectoryPicker", vi.fn(() => new Promise<ProofFolder>(resolve => { complete = resolve; })));
  const rendered = render(<FolderSource suspended={false} onReview={vi.fn()} />);
  await chooseFolder();
  rendered.unmount();
  const folder = source();
  await act(async () => { complete(folder); });
  expect(folder.queryPermission).not.toHaveBeenCalled();
  expect(folder.values).not.toHaveBeenCalled();
});

function trustedSource(handle = source(), paused = false): TrustedFolderSource {
  return { id: "synthetic-grant", revision: "synthetic-revision", userId: "local-browser-owner", visibility: "personal",
    handle, label: handle.name, category: "kindness_received", tags: ["synthetic"], approvedAt: "2026-09-06T00:00:00.000Z", paused, processedDigests: [] };
}

it("keeps automatic saving unchecked and requires a manual category plus final confirmation", async () => {
  const folder = source();
  const record = trustedSource(folder);
  vi.stubGlobal("showDirectoryPicker", vi.fn().mockResolvedValue(folder));
  vi.mocked(confirmTrustedFolderSource).mockImplementation(async () => {
    vi.mocked(getTrustedFolderSource).mockResolvedValue(record);
    return record;
  });
  const onReview = vi.fn();
  const onCandidatesAdded = vi.fn();
  render(<FolderSource suspended={false} onReview={onReview} onCandidatesAdded={onCandidatesAdded} />);
  await chooseFolder();
  const consent = await screen.findByRole("checkbox", { name: "Allow automatic saving from this folder" });
  expect(consent).not.toBeChecked();
  expect(confirmTrustedFolderSource).not.toHaveBeenCalled();
  expect(stageTrustedFolderMedia).not.toHaveBeenCalled();
  fireEvent.click(consent);
  expect(screen.getByRole("button", { name: "Confirm automatic saving" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Start watching" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Category for every file"), { target: { value: "kindness_received" } });
  fireEvent.change(screen.getByLabelText("Tags for every file (optional)"), { target: { value: "Synthetic, care, synthetic" } });
  expect(confirmTrustedFolderSource).not.toHaveBeenCalled();
  expect(folder.values).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm automatic saving" }));
  await screen.findByText(/1 new item was saved automatically/);
  expect(confirmTrustedFolderSource).toHaveBeenCalledWith(folder, "kindness_received", ["synthetic", "care"]);
  expect(stageTrustedFolderMedia).toHaveBeenCalledWith(record.id, record.revision, expect.any(Array), expect.any(AbortSignal));
  expect(stageLocalProofMedia).not.toHaveBeenCalled();
  expect(onReview).not.toHaveBeenCalled();
  expect(onCandidatesAdded).not.toHaveBeenCalled();
  expect(screen.getByText(/cannot collect when the browser is closed/)).toBeInTheDocument();
});

it("restores only an already-confirmed active source and never requests permission on startup", async () => {
  const folder = source();
  vi.stubGlobal("showDirectoryPicker", vi.fn());
  vi.mocked(getTrustedFolderSource).mockResolvedValue(trustedSource(folder));
  render(<FolderSource suspended={false} onReview={vi.fn()} />);
  await screen.findByText(/1 new item was saved automatically/);
  expect(folder.queryPermission).toHaveBeenCalledWith({ mode: "read" });
  expect(folder.requestPermission).not.toHaveBeenCalled();
  expect(confirmTrustedFolderSource).not.toHaveBeenCalled();
});

it("requires an explicit Reconnect when remembered browser read permission is missing", async () => {
  const folder = source();
  folder.queryPermission.mockResolvedValue("prompt");
  vi.stubGlobal("showDirectoryPicker", vi.fn());
  vi.mocked(getTrustedFolderSource).mockResolvedValue(trustedSource(folder));
  render(<FolderSource suspended={false} onReview={vi.fn()} />);
  const reconnect = await screen.findByRole("button", { name: "Reconnect" });
  expect(folder.requestPermission).not.toHaveBeenCalled();
  expect(folder.values).not.toHaveBeenCalled();
  expect(stageTrustedFolderMedia).not.toHaveBeenCalled();
  fireEvent.click(reconnect);
  await screen.findByText(/1 new item was saved automatically/);
  expect(folder.requestPermission).toHaveBeenCalledOnce();
});

it("persists Pause and does not resume the trusted folder on a new mount", async () => {
  const folder = source();
  const record = trustedSource(folder);
  vi.stubGlobal("showDirectoryPicker", vi.fn());
  vi.mocked(getTrustedFolderSource).mockResolvedValue(record);
  vi.mocked(setTrustedFolderActive).mockImplementation(async () => {
    const paused = { ...record, revision: "paused-revision", paused: true };
    vi.mocked(getTrustedFolderSource).mockResolvedValue(paused);
    return paused;
  });
  const rendered = render(<FolderSource suspended={false} onReview={vi.fn()} />);
  await screen.findByText(/1 new item was saved automatically/);
  fireEvent.click(screen.getByRole("button", { name: "Pause" }));
  await screen.findByText("Automatic saving paused");
  expect(setTrustedFolderActive).toHaveBeenCalledWith(record.id, record.revision, false);
  rendered.unmount();
  folder.queryPermission.mockClear();
  folder.values.mockClear();
  render(<FolderSource suspended={false} onReview={vi.fn()} />);
  await screen.findByText("Automatic saving paused");
  expect(folder.queryPermission).not.toHaveBeenCalled();
  expect(folder.values).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Resume" })).toBeEnabled();
});

it("forget cancels a read before removing the exact grant and never deletes saved items", async () => {
  let complete!: (file: File) => void;
  const getFile = vi.fn(() => new Promise<File>(resolve => { complete = resolve; }));
  const folder = source(getFile);
  const record = trustedSource(folder);
  vi.stubGlobal("showDirectoryPicker", vi.fn());
  vi.mocked(getTrustedFolderSource).mockResolvedValue(record);
  vi.mocked(forgetTrustedFolderSource).mockImplementation(async () => { vi.mocked(getTrustedFolderSource).mockResolvedValue(null); });
  render(<FolderSource suspended={false} onReview={vi.fn()} />);
  await waitFor(() => expect(getFile).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "Forget trusted folder" }));
  await screen.findByRole("button", { name: "Choose a folder" });
  await act(async () => { complete(new File(["synthetic"], "synthetic.png", { type: "image/png" })); });
  expect(forgetTrustedFolderSource).toHaveBeenCalledWith(record.id, record.revision);
  expect(stageTrustedFolderMedia).not.toHaveBeenCalled();
});

it("reacts to another tab revoking its grant before a pending read can be saved", async () => {
  let complete!: (file: File) => void;
  const getFile = vi.fn(() => new Promise<File>(resolve => { complete = resolve; }));
  const folder = source(getFile);
  vi.stubGlobal("showDirectoryPicker", vi.fn());
  vi.mocked(getTrustedFolderSource).mockResolvedValue(trustedSource(folder));
  render(<FolderSource suspended={false} onReview={vi.fn()} />);
  await waitFor(() => expect(getFile).toHaveBeenCalledOnce());
  vi.mocked(getTrustedFolderSource).mockResolvedValue(null);
  await act(async () => { vi.mocked(subscribeToLocalProofChanges).mock.calls.at(-1)![0]("source"); });
  await screen.findByRole("button", { name: "Choose a folder" });
  await act(async () => { complete(new File(["synthetic"], "synthetic.png", { type: "image/png" })); });
  expect(stageTrustedFolderMedia).not.toHaveBeenCalled();
});

it("allows forgetting an existing trusted grant even if folder watching is no longer supported", async () => {
  vi.stubGlobal("showDirectoryPicker", undefined);
  vi.mocked(getTrustedFolderSource).mockResolvedValue(trustedSource());
  render(<FolderSource suspended={false} onReview={vi.fn()} />);
  expect(await screen.findByRole("button", { name: "Forget trusted folder" })).toBeEnabled();
  expect(stageTrustedFolderMedia).not.toHaveBeenCalled();
});

it("a failed consent persistence never starts automatic saving", async () => {
  const folder = source();
  vi.stubGlobal("showDirectoryPicker", vi.fn().mockResolvedValue(folder));
  vi.mocked(confirmTrustedFolderSource).mockRejectedValueOnce(new DOMException("Folder handles cannot be stored", "DataCloneError"));
  render(<FolderSource suspended={false} onReview={vi.fn()} />);
  await chooseFolder();
  fireEvent.click(await screen.findByRole("checkbox", { name: "Allow automatic saving from this folder" }));
  fireEvent.change(screen.getByLabelText("Category for every file"), { target: { value: "belonging" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirm automatic saving" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Folder handles cannot be stored");
  expect(folder.values).not.toHaveBeenCalled();
  expect(stageTrustedFolderMedia).not.toHaveBeenCalled();
  expect(screen.queryByText("Automatic saving allowed")).not.toBeInTheDocument();
});

it("suspends a running review watch while editing the automatic consent form", async () => {
  const folder = source();
  vi.stubGlobal("showDirectoryPicker", vi.fn().mockResolvedValue(folder));
  render(<FolderSource suspended={false} onReview={vi.fn()} />);
  await chooseFolder();
  fireEvent.click(await screen.findByRole("button", { name: "Start watching" }));
  await screen.findByText(/1 new item is ready/);
  fireEvent.click(screen.getByRole("checkbox", { name: "Allow automatic saving from this folder" }));
  expect(screen.getByText(/Waiting while you review or edit/)).toBeInTheDocument();
  expect(confirmTrustedFolderSource).not.toHaveBeenCalled();
});

it("a same-tab confirmation notice does not start two watches", async () => {
  const folder = source();
  const record = trustedSource(folder);
  vi.stubGlobal("showDirectoryPicker", vi.fn().mockResolvedValue(folder));
  vi.mocked(confirmTrustedFolderSource).mockImplementation(async () => {
    vi.mocked(getTrustedFolderSource).mockResolvedValue(record);
    vi.mocked(subscribeToLocalProofChanges).mock.calls.at(-1)![0]("source");
    return record;
  });
  render(<FolderSource suspended={false} onReview={vi.fn()} />);
  await chooseFolder();
  fireEvent.click(await screen.findByRole("checkbox", { name: "Allow automatic saving from this folder" }));
  fireEvent.change(screen.getByLabelText("Category for every file"), { target: { value: "kindness_received" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirm automatic saving" }));
  await screen.findByText(/1 new item was saved automatically/);
  expect(folder.values).toHaveBeenCalledOnce();
  expect(stageTrustedFolderMedia).toHaveBeenCalledOnce();
});

it("honors current editing suspension after asynchronous consent persistence finishes", async () => {
  const folder = source();
  const record = trustedSource(folder);
  let complete!: (record: TrustedFolderSource) => void;
  vi.stubGlobal("showDirectoryPicker", vi.fn().mockResolvedValue(folder));
  vi.mocked(confirmTrustedFolderSource).mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const rendered = render(<FolderSource suspended={false} onReview={vi.fn()} />);
  await chooseFolder();
  fireEvent.click(await screen.findByRole("checkbox", { name: "Allow automatic saving from this folder" }));
  fireEvent.change(screen.getByLabelText("Category for every file"), { target: { value: "kindness_received" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirm automatic saving" }));
  rendered.rerender(<FolderSource suspended onReview={vi.fn()} />);
  vi.mocked(getTrustedFolderSource).mockResolvedValue(record);
  await act(async () => { complete(record); });
  expect(screen.getByText(/Waiting while you review or edit/)).toBeInTheDocument();
  expect(folder.values).not.toHaveBeenCalled();
  rendered.rerender(<FolderSource suspended={false} onReview={vi.fn()} />);
  await screen.findByText(/1 new item was saved automatically/);
});

it("stops an in-flight read immediately on a source notice before metadata can finish loading", async () => {
  let completeRead!: (file: File) => void;
  let completeMetadata!: (record: TrustedFolderSource | null) => void;
  const getFile = vi.fn(() => new Promise<File>(resolve => { completeRead = resolve; }));
  const folder = source(getFile);
  vi.stubGlobal("showDirectoryPicker", vi.fn());
  vi.mocked(getTrustedFolderSource).mockResolvedValue(trustedSource(folder));
  render(<FolderSource suspended={false} onReview={vi.fn()} />);
  await waitFor(() => expect(getFile).toHaveBeenCalledOnce());
  vi.mocked(getTrustedFolderSource).mockImplementationOnce(() => new Promise(resolve => { completeMetadata = resolve; }));
  act(() => { vi.mocked(subscribeToLocalProofChanges).mock.calls.at(-1)![0]("source"); });
  await act(async () => { completeRead(new File(["synthetic"], "synthetic.png", { type: "image/png" })); });
  expect(stageTrustedFolderMedia).not.toHaveBeenCalled();
  await act(async () => { completeMetadata(null); });
  expect(screen.getByRole("button", { name: "Choose a folder" })).toBeInTheDocument();
});

it("honors another tab's persisted Pause without requesting permission or restarting", async () => {
  const folder = source();
  const record = trustedSource(folder);
  vi.stubGlobal("showDirectoryPicker", vi.fn());
  vi.mocked(getTrustedFolderSource).mockResolvedValue(record);
  render(<FolderSource suspended={false} onReview={vi.fn()} />);
  await screen.findByText(/1 new item was saved automatically/);
  vi.mocked(getTrustedFolderSource).mockResolvedValue({ ...record, revision: "other-tab-pause", paused: true });
  await act(async () => { vi.mocked(subscribeToLocalProofChanges).mock.calls.at(-1)![0]("source"); });
  expect(screen.getByText("Automatic saving paused")).toBeInTheDocument();
  expect(folder.values).toHaveBeenCalledOnce();
  expect(folder.requestPermission).not.toHaveBeenCalled();
});

it("refreshes the revision after a failed Pause without automatically restarting", async () => {
  const folder = source();
  const record = trustedSource(folder);
  const newer = { ...record, revision: "newer-revision" };
  vi.stubGlobal("showDirectoryPicker", vi.fn());
  vi.mocked(getTrustedFolderSource).mockResolvedValue(record);
  vi.mocked(setTrustedFolderActive).mockRejectedValueOnce(new Error("Source changed in another tab"));
  render(<FolderSource suspended={false} onReview={vi.fn()} />);
  await screen.findByText(/1 new item was saved automatically/);
  vi.mocked(getTrustedFolderSource).mockResolvedValue(newer);
  fireEvent.click(screen.getByRole("button", { name: "Pause" }));
  await screen.findByRole("alert");
  await waitFor(() => expect(getTrustedFolderSource).toHaveBeenCalledTimes(2));
  const paused = { ...newer, revision: "paused-revision", paused: true };
  vi.mocked(setTrustedFolderActive).mockResolvedValueOnce(paused);
  vi.mocked(getTrustedFolderSource).mockResolvedValue(paused);
  fireEvent.click(screen.getByRole("button", { name: "Remember Pause" }));
  await screen.findByText("Automatic saving paused");
  expect(setTrustedFolderActive).toHaveBeenLastCalledWith(newer.id, newer.revision, false);
  expect(folder.values).toHaveBeenCalledOnce();
});

it("refreshes the revision after failed Forget so retry can remove the current grant", async () => {
  const folder = source();
  const record = trustedSource(folder);
  const newer = { ...record, revision: "newer-revision" };
  vi.stubGlobal("showDirectoryPicker", vi.fn());
  vi.mocked(getTrustedFolderSource).mockResolvedValue(record);
  vi.mocked(forgetTrustedFolderSource).mockRejectedValueOnce(new Error("Source changed in another tab"));
  render(<FolderSource suspended={false} onReview={vi.fn()} />);
  await screen.findByText(/1 new item was saved automatically/);
  vi.mocked(getTrustedFolderSource).mockResolvedValue(newer);
  fireEvent.click(screen.getByRole("button", { name: "Forget trusted folder" }));
  await screen.findByRole("alert");
  await waitFor(() => expect(getTrustedFolderSource).toHaveBeenCalledTimes(2));
  vi.mocked(forgetTrustedFolderSource).mockImplementationOnce(async () => { vi.mocked(getTrustedFolderSource).mockResolvedValue(null); });
  fireEvent.click(screen.getByRole("button", { name: "Forget trusted folder" }));
  await screen.findByRole("button", { name: "Choose a folder" });
  expect(forgetTrustedFolderSource).toHaveBeenLastCalledWith(newer.id, newer.revision);
  expect(folder.values).toHaveBeenCalledOnce();
});
