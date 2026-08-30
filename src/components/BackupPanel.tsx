import { useEffect, useRef, useState, type FormEvent } from "react";
import { decryptProofBackup, encryptProofBackup, isEncryptedProofBackup } from "../lib/encrypted-backup";
import { exportLocalProofFullBackup, importLocalProofBackup, requestLocalProofPersistence } from "../lib/local-proof-store";

export function BackupPanel({ mode, onClose, onRestored, onBusyChange, blocked }: {
  mode: "export" | "restore"; onClose: () => void; onRestored: () => Promise<void>; onBusyChange: (busy: boolean) => void; blocked: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { heading.current?.focus(); }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (blocked || busy) return; setMessage(""); setBusy(true); onBusyChange(true);
    try {
      if (mode === "export") {
        if (password !== confirmation) throw new Error("The passphrases do not match.");
        const blob = await encryptProofBackup(await exportLocalProofFullBackup(), password);
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url; link.download = `proof-gallery-${new Date().toISOString().slice(0, 10)}.proof`;
        document.body.appendChild(link); link.click(); link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
        setMessage("Encrypted download prepared, including saved Proof, pending media, and saved review notes. Keep the file and passphrase safe.");
      } else {
        if (!file) throw new Error("Choose a backup first.");
        const payload = await isEncryptedProofBackup(file) ? await decryptProofBackup(file, password) : file;
        if (!window.confirm("Restore this backup? Conflicts cancel the entire restore. Previously deleted items in this backup may return. Pending items will remain pending.")) return;
        const result = await importLocalProofBackup(payload);
        await requestLocalProofPersistence();
        await onRestored();
        setMessage(`Restored ${result.imported} saved Proof and ${result.pendingImported} pending review items. Identical existing items were left unchanged.`);
      }
      setPassword(""); setConfirmation("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Backup operation failed."); }
    finally { setBusy(false); onBusyChange(false); }
  }
  return <section className="backup-panel" aria-labelledby="backup-title">
    <h2 id="backup-title" ref={heading} tabIndex={-1}>{mode === "export" ? "Encrypted backup" : "Restore a backup"}</h2>
    <p>Includes saved Proof and pending photos with their saved notes. This protects the downloaded file—not the active data in this browser. Forgotten passphrases cannot be recovered.</p>
    <form onSubmit={event => void submit(event)}>
      <fieldset disabled={busy || blocked}>
      {mode === "restore" && <label>Backup file<input type="file" accept=".proof,.json,application/json,application/octet-stream" disabled={busy} onChange={event => setFile(event.target.files?.[0] ?? null)} /></label>}
      <label>Passphrase{mode === "restore" ? " (not needed for older unencrypted backups)" : " (12 characters or more)"}
        <input type="password" autoComplete={mode === "export" ? "new-password" : "current-password"} value={password} onChange={event => setPassword(event.target.value)} disabled={busy} required={mode === "export"} minLength={mode === "export" ? 12 : undefined} />
      </label>
      {mode === "export" && <label>Repeat passphrase<input type="password" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} required disabled={busy} /></label>}
      <div className="gallery-actions"><button className="primary-button" disabled={busy}>{busy ? "Working…" : mode === "export" ? "Download encrypted backup" : "Validate and restore"}</button><button type="button" className="secondary-button" onClick={onClose} disabled={busy}>Close</button></div>
      </fieldset>
    </form>
    {blocked && !busy && <p role="status">Save or discard pending note edits and finish other operations before backing up or restoring.</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}
