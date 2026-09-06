import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FolderSource } from "./FolderSource";
import { countLocalProofCandidates, stageLocalProofMedia } from "../lib/local-proof-store";
import type { ProofFolder } from "../lib/folder-source";

vi.mock("../lib/local-proof-store", () => ({
  countLocalProofCandidates: vi.fn().mockResolvedValue(0),
  stageLocalProofMedia: vi.fn().mockResolvedValue({ added: 1, duplicates: 0, rejected: [] }),
  subscribeToLocalProofChanges: vi.fn(() => () => undefined),
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
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("keeps the standard media picker path when folder watching is unsupported", async () => {
  vi.stubGlobal("showDirectoryPicker", undefined);
  const onReview = vi.fn();
  render(<FolderSource suspended={false} onReview={onReview} />);
  expect(screen.getByText(/does not support automatic folder checks/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Start watching" })).not.toBeInTheDocument();
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
  fireEvent.click(screen.getByRole("button", { name: "Choose a folder" }));
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
  fireEvent.click(screen.getByRole("button", { name: "Choose a folder" }));
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
  fireEvent.click(screen.getByRole("button", { name: "Choose a folder" }));
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
  fireEvent.click(screen.getByRole("button", { name: "Choose a folder" }));
  rendered.unmount();
  const folder = source();
  await act(async () => { complete(folder); });
  expect(folder.queryPermission).not.toHaveBeenCalled();
  expect(folder.values).not.toHaveBeenCalled();
});
