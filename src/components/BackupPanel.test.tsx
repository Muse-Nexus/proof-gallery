import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BackupPanel } from "./BackupPanel";
import { exportLocalProofFullBackup, exportLocalProofBackupParts, importLocalProofBackup, requestLocalProofPersistence } from "../lib/local-proof-store";
import { decryptProofBackup, encryptProofBackup, isEncryptedProofBackup } from "../lib/encrypted-backup";
vi.mock("../lib/local-proof-store", () => ({ exportLocalProofFullBackup: vi.fn().mockResolvedValue(new Blob(["synthetic"])), exportLocalProofBackupParts: vi.fn(), importLocalProofBackup: vi.fn(), requestLocalProofPersistence: vi.fn() }));
vi.mock("../lib/encrypted-backup", () => ({ encryptProofBackup: vi.fn().mockResolvedValue(new Blob(["encrypted-synthetic"])), decryptProofBackup: vi.fn(), isEncryptedProofBackup: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); });
function setupRecovery() {
  const download = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  URL.createObjectURL = vi.fn(() => "blob:synthetic"); URL.revokeObjectURL = vi.fn();
  vi.mocked(exportLocalProofBackupParts).mockImplementation(async function* () {
    for (let part = 1; part <= 2; part++) yield { exportId: "synthetic-export", createdAt: "2026-09-06T00:00:00.000Z", part, totalParts: 2, isLast: part === 2, savedCount: 1, pendingCount: 0, blob: new Blob([`synthetic-part-${part}`]) };
  });
  render(<BackupPanel mode="export" blocked={false} onClose={vi.fn()} onBusyChange={vi.fn()} onRestored={vi.fn()} />);
  fireEvent.click(screen.getByLabelText("Download smaller recovery parts"));
  fireEvent.change(screen.getByLabelText(/Passphrase \(/), { target: { value: "synthetic long password" } });
  fireEvent.change(screen.getByLabelText("Repeat passphrase"), { target: { value: "synthetic long password" } });
  return download;
}
it("requires a separate click per encrypted recovery part and only declares preparation complete at the end", async () => {
  const download = setupRecovery();
  fireEvent.click(screen.getByRole("button", { name: "Download first recovery part" }));
  await screen.findByText(/Part 1 of 2 prepared/);
  expect(download).toHaveBeenCalledOnce();
  expect(screen.getByLabelText(/Passphrase \(/)).toBeDisabled();
  expect(exportLocalProofFullBackup).not.toHaveBeenCalled();
  expect(screen.queryByText(/All 2 encrypted recovery parts/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Download part 2 of 2" }));
  await screen.findByText(/All 2 encrypted recovery parts/);
  expect(download).toHaveBeenCalledTimes(2);
  expect(encryptProofBackup).toHaveBeenCalledTimes(2);
  expect(screen.getByLabelText(/Passphrase \(/)).toHaveValue("");
  expect(importLocalProofBackup).not.toHaveBeenCalled();
});
it("cancels even while encryption is running without releasing a late file", async () => {
  const download = setupRecovery();
  let finish!: (value: Blob) => void;
  vi.mocked(encryptProofBackup).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByRole("button", { name: "Download first recovery part" }));
  await waitFor(() => expect(encryptProofBackup).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "Stop recovery export" }));
  await act(async () => finish(new Blob(["encrypted-synthetic"])));
  expect(download).not.toHaveBeenCalled();
  expect(screen.getByText(/Recovery export stopped/)).toBeInTheDocument();
  expect(screen.getByLabelText(/Passphrase \(/)).toHaveValue("");
  expect(screen.getByRole("button", { name: "Download first recovery part" })).toBeEnabled();
});
it("can start a fresh recovery immediately after stopping between parts", async () => {
  setupRecovery();
  fireEvent.click(screen.getByRole("button", { name: "Download first recovery part" }));
  await screen.findByText(/Part 1 of 2 prepared/);
  fireEvent.click(screen.getByRole("button", { name: "Stop recovery export" }));
  fireEvent.change(screen.getByLabelText(/Passphrase \(/), { target: { value: "synthetic new password" } });
  fireEvent.change(screen.getByLabelText("Repeat passphrase"), { target: { value: "synthetic new password" } });
  fireEvent.click(screen.getByRole("button", { name: "Download first recovery part" }));
  await screen.findByText(/Part 1 of 2 prepared/);
  expect(exportLocalProofBackupParts).toHaveBeenCalledTimes(2);
  expect(vi.mocked(exportLocalProofBackupParts).mock.calls[0][0]?.aborted).toBe(true);
  expect(vi.mocked(exportLocalProofBackupParts).mock.calls[1][0]?.aborted).toBe(false);
});
it("guards an already-open form when pending details become dirty", async () => {
  const props = { mode: "export" as const, onClose: vi.fn(), onBusyChange: vi.fn(), onRestored: vi.fn() };
  const { rerender } = render(<BackupPanel {...props} blocked={false} />);
  fireEvent.change(screen.getByLabelText(/Passphrase \(/), { target: { value: "synthetic long password" } });
  fireEvent.change(screen.getByLabelText("Repeat passphrase"), { target: { value: "synthetic long password" } });
  rerender(<BackupPanel {...props} blocked />);
  expect(screen.getByRole("button", { name: "Download encrypted backup" })).toBeDisabled();
  fireEvent.submit(screen.getByRole("button", { name: "Download encrypted backup" }).closest("form")!);
  expect(exportLocalProofFullBackup).not.toHaveBeenCalled();
});
it("uses the full snapshot and clears passphrase fields after export", async () => {
  URL.createObjectURL = vi.fn(() => "blob:synthetic"); URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const onBusyChange = vi.fn();
  render(<BackupPanel mode="export" blocked={false} onClose={vi.fn()} onBusyChange={onBusyChange} onRestored={vi.fn()} />);
  fireEvent.change(screen.getByLabelText(/Passphrase \(/), { target: { value: "synthetic long password" } });
  fireEvent.change(screen.getByLabelText("Repeat passphrase"), { target: { value: "synthetic long password" } });
  fireEvent.click(screen.getByRole("button", { name: "Download encrypted backup" }));
  await waitFor(() => expect(encryptProofBackup).toHaveBeenCalledOnce());
  await screen.findByText(/Encrypted download prepared/);
  expect(screen.getByLabelText(/Passphrase \(/)).toHaveValue("");
  expect(onBusyChange).toHaveBeenLastCalledWith(false);
});

it("cancels a decrypted restore without importing or leaving the panel busy", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const onBusyChange = vi.fn();
  const onRestored = vi.fn();
  const archive = new File(["encrypted synthetic archive"], "synthetic.proof");
  const payload = new Blob(["decrypted synthetic archive"]);
  vi.mocked(isEncryptedProofBackup).mockResolvedValueOnce(true);
  vi.mocked(decryptProofBackup).mockResolvedValueOnce(payload);
  render(<BackupPanel mode="restore" blocked={false} onClose={vi.fn()} onBusyChange={onBusyChange} onRestored={onRestored} />);
  fireEvent.change(screen.getByLabelText("Backup file"), { target: { files: [archive] } });
  fireEvent.change(screen.getByLabelText(/Passphrase \(/), { target: { value: "synthetic long password" } });

  fireEvent.click(screen.getByRole("button", { name: "Validate and restore" }));
  expect(screen.getByRole("button", { name: "Working…" })).toBeDisabled();

  await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
  expect(decryptProofBackup).toHaveBeenCalledWith(archive, "synthetic long password");
  expect(confirm).toHaveBeenCalledOnce();
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Backups do not reconnect or enable trusted sources."));
  expect(screen.getByText(/Folder permissions and trusted-source connections are not included/)).toBeInTheDocument();
  expect(importLocalProofBackup).not.toHaveBeenCalled();
  expect(requestLocalProofPersistence).not.toHaveBeenCalled();
  expect(onRestored).not.toHaveBeenCalled();
  expect(onBusyChange.mock.calls).toEqual([[true], [false]]);
  expect(screen.getByRole("button", { name: "Validate and restore" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Close" })).toBeEnabled();
  expect(screen.queryByText(/^Restored /)).not.toBeInTheDocument();
});
it("does not confirm or restore when the panel unmounts during decryption", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  let finish!: (blob: Blob) => void;
  vi.mocked(isEncryptedProofBackup).mockResolvedValueOnce(true);
  vi.mocked(decryptProofBackup).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const { unmount } = render(<BackupPanel mode="restore" blocked={false} onClose={vi.fn()} onBusyChange={vi.fn()} onRestored={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Backup file"), { target: { files: [new File(["synthetic"], "synthetic.proof")] } });
  fireEvent.click(screen.getByRole("button", { name: "Validate and restore" }));
  await waitFor(() => expect(decryptProofBackup).toHaveBeenCalledOnce());
  unmount();
  await act(async () => finish(new Blob(["synthetic decrypted backup"])));
  expect(confirm).not.toHaveBeenCalled();
  expect(importLocalProofBackup).not.toHaveBeenCalled();
});

it("rejects a wrong passphrase before confirmation or import and resets busy state", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  const onBusyChange = vi.fn();
  const onRestored = vi.fn();
  const message = "The passphrase is incorrect or this backup is damaged. Nothing was restored.";
  vi.mocked(isEncryptedProofBackup).mockResolvedValueOnce(true);
  vi.mocked(decryptProofBackup).mockRejectedValueOnce(new Error(message));
  render(<BackupPanel mode="restore" blocked={false} onClose={vi.fn()} onBusyChange={onBusyChange} onRestored={onRestored} />);
  fireEvent.change(screen.getByLabelText("Backup file"), {
    target: { files: [new File(["encrypted synthetic archive"], "synthetic.proof")] },
  });
  fireEvent.change(screen.getByLabelText(/Passphrase \(/), { target: { value: "incorrect synthetic password" } });

  fireEvent.click(screen.getByRole("button", { name: "Validate and restore" }));

  expect(await screen.findByRole("status")).toHaveTextContent(message);
  expect(confirm).not.toHaveBeenCalled();
  expect(importLocalProofBackup).not.toHaveBeenCalled();
  expect(requestLocalProofPersistence).not.toHaveBeenCalled();
  expect(onRestored).not.toHaveBeenCalled();
  expect(onBusyChange.mock.calls).toEqual([[true], [false]]);
  expect(screen.getByRole("button", { name: "Validate and restore" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Close" })).toBeEnabled();
});

it("shows an import conflict without claiming restoration and resets busy state", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  const onBusyChange = vi.fn();
  const onRestored = vi.fn();
  const archive = new File(["synthetic legacy archive"], "synthetic.json", { type: "application/json" });
  const message = "Backup conflicts with existing review details; nothing was imported.";
  vi.mocked(isEncryptedProofBackup).mockResolvedValueOnce(false);
  vi.mocked(importLocalProofBackup).mockRejectedValueOnce(new Error(message));
  render(<BackupPanel mode="restore" blocked={false} onClose={vi.fn()} onBusyChange={onBusyChange} onRestored={onRestored} />);
  fireEvent.change(screen.getByLabelText("Backup file"), { target: { files: [archive] } });

  fireEvent.click(screen.getByRole("button", { name: "Validate and restore" }));

  expect(await screen.findByRole("status")).toHaveTextContent(message);
  expect(confirm).toHaveBeenCalledOnce();
  expect(decryptProofBackup).not.toHaveBeenCalled();
  expect(importLocalProofBackup).toHaveBeenCalledExactlyOnceWith(archive);
  expect(requestLocalProofPersistence).not.toHaveBeenCalled();
  expect(onRestored).not.toHaveBeenCalled();
  expect(onBusyChange.mock.calls).toEqual([[true], [false]]);
  expect(screen.getByRole("button", { name: "Validate and restore" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Close" })).toBeEnabled();
  expect(screen.queryByText(/^Restored /)).not.toBeInTheDocument();
});
