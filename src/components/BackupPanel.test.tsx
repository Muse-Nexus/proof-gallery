import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BackupPanel } from "./BackupPanel";
import { exportLocalProofFullBackup, importLocalProofBackup, requestLocalProofPersistence } from "../lib/local-proof-store";
import { decryptProofBackup, encryptProofBackup, isEncryptedProofBackup } from "../lib/encrypted-backup";
vi.mock("../lib/local-proof-store", () => ({ exportLocalProofFullBackup: vi.fn().mockResolvedValue(new Blob(["synthetic"])), importLocalProofBackup: vi.fn(), requestLocalProofPersistence: vi.fn() }));
vi.mock("../lib/encrypted-backup", () => ({ encryptProofBackup: vi.fn().mockResolvedValue(new Blob(["encrypted-synthetic"])), decryptProofBackup: vi.fn(), isEncryptedProofBackup: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); });
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
  expect(importLocalProofBackup).not.toHaveBeenCalled();
  expect(requestLocalProofPersistence).not.toHaveBeenCalled();
  expect(onRestored).not.toHaveBeenCalled();
  expect(onBusyChange.mock.calls).toEqual([[true], [false]]);
  expect(screen.getByRole("button", { name: "Validate and restore" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Close" })).toBeEnabled();
  expect(screen.queryByText(/^Restored /)).not.toBeInTheDocument();
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
