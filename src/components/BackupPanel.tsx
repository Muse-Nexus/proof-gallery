import { useEffect, useRef, useState, type FormEvent } from "react";
import { decryptProofBackup, encryptProofBackup, isEncryptedProofBackup } from "../lib/encrypted-backup";
import { exportLocalProofFullBackup, exportLocalProofBackupParts, importLocalProofBackup, requestLocalProofPersistence } from "../lib/local-proof-store";

export function BackupPanel({ mode, onClose, onRestored, onBusyChange, blocked }: {
  mode: "export" | "restore"; onClose: () => void; onRestored: () => Promise<void>; onBusyChange: (busy: boolean) => void; blocked: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [split, setSplit] = useState(false);
  const [progress, setProgress] = useState<{ part: number; totalParts: number } | null>(null);
  const recovery = useRef<ReturnType<typeof exportLocalProofBackupParts> | null>(null);
  const operation = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; operation.current?.abort(); void recovery.current?.return(undefined); };
  }, []);
  function cancelRecovery() {
    operation.current?.abort();
    void recovery.current?.return(undefined);
    recovery.current = null;
    setProgress(null); setPassword(""); setConfirmation("");
    setMessage("Recovery export stopped. Already downloaded parts remain encrypted, but they are not a complete collection backup. Your gallery is unchanged.");
  }
  function download(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = filename;
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (blocked || busy) return; setMessage(""); setBusy(true); onBusyChange(true);
    const controller = operation.current && !operation.current.signal.aborted ? operation.current : new AbortController();
    operation.current = controller;
    try {
      if (mode === "export") {
        if (password !== confirmation) throw new Error("The passphrases do not match.");
        if (password.length < 12) throw new Error("Use a passphrase of at least 12 characters.");
        if (split) {
          recovery.current ??= exportLocalProofBackupParts(controller.signal);
          const next = await recovery.current.next();
          if (next.done) throw new Error("No recovery part was prepared. Start a new export.");
          const part = next.value;
          const blob = await encryptProofBackup(part.blob, password);
          if (controller.signal.aborted || !mounted.current) return;
          download(blob, `proof-gallery-${part.createdAt.slice(0, 10)}-${part.exportId}-part-${part.part}-of-${part.totalParts}.proof`);
          setProgress({ part: part.part, totalParts: part.totalParts });
          if (!part.isLast) {
            setMessage(`Part ${part.part} of ${part.totalParts} prepared for download. This export is incomplete; continue with the next part.`);
            return;
          }
          await recovery.current.return(undefined); recovery.current = null;
          setMessage(`${part.totalParts === 1 ? "The encrypted recovery part was" : `All ${part.totalParts} encrypted recovery parts were`} prepared for download. Check that every file finished downloading and keep them together with the passphrase. Each part restores separately; a collection over the browser limit cannot be restored here as one library.`);
        } else {
          const blob = await encryptProofBackup(await exportLocalProofFullBackup(), password);
          if (controller.signal.aborted || !mounted.current) return;
          download(blob, `proof-gallery-${new Date().toISOString().slice(0, 10)}.proof`);
          setMessage("Encrypted download prepared, including saved Proof, pending media, and saved review notes. Keep the file and passphrase safe.");
        }
      } else {
        if (!file) throw new Error("Choose a backup first.");
        const payload = await isEncryptedProofBackup(file) ? await decryptProofBackup(file, password) : file;
        if (controller.signal.aborted || !mounted.current) return;
        if (!window.confirm("Restore this backup? Conflicts cancel the entire restore. Previously deleted items in this backup may return. Pending items will remain pending. Backups do not reconnect or enable trusted sources.")) return;
        if (controller.signal.aborted || !mounted.current) return;
        const result = await importLocalProofBackup(payload);
        await requestLocalProofPersistence();
        await onRestored();
        setMessage(`Restored ${result.imported} saved Proof and ${result.pendingImported} pending review items. Identical existing items were left unchanged.`);
      }
      setPassword(""); setConfirmation("");
    } catch (error) {
      if (!controller.signal.aborted && mounted.current) setMessage(error instanceof Error ? error.message : "Backup operation failed.");
      void recovery.current?.return(undefined); recovery.current = null;
      setProgress(null); setPassword(""); setConfirmation("");
    } finally {
      if (!recovery.current) operation.current = null;
      if (mounted.current) { setBusy(false); onBusyChange(false); }
    }
  }
  return <section className="backup-panel" aria-labelledby="backup-title">
    <h2 id="backup-title" ref={heading} tabIndex={-1}>{mode === "export" ? "Encrypted backup" : "Restore a backup"}</h2>
    <p>Includes saved Proof and pending photos with their saved notes. This protects the downloaded file—not the active data in this browser. Forgotten passphrases cannot be recovered.</p>
    <p>Folder permissions and trusted-source connections are not included. Restoring a backup does not reconnect or enable sources.</p>
    {mode === "export" && <label className="checkbox-row"><input type="checkbox" checked={split} disabled={busy || blocked || Boolean(recovery.current)} onChange={event => { setSplit(event.target.checked); setProgress(null); setMessage(""); }} />Download smaller recovery parts</label>}
    {split && <p>For larger or older galleries. Each click encrypts one part. Keep all numbered parts. Restore is atomic per part, not across the whole set; normal storage limits still apply. Leave this panel open until every part is prepared. No originals are compressed or removed.</p>}
    <form onSubmit={event => void submit(event)}>
      <fieldset disabled={busy || blocked}>
      {mode === "restore" && <label>Backup file<input type="file" accept=".proof,.json,application/json,application/octet-stream" disabled={busy} onChange={event => setFile(event.target.files?.[0] ?? null)} /></label>}
      <label>Passphrase{mode === "restore" ? " (not needed for older unencrypted backups)" : " (12 characters or more)"}
        <input type="password" autoComplete={mode === "export" ? "new-password" : "current-password"} value={password} onChange={event => setPassword(event.target.value)} disabled={busy || Boolean(recovery.current)} required={mode === "export"} minLength={mode === "export" ? 12 : undefined} />
      </label>
      {mode === "export" && <label>Repeat passphrase<input type="password" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} required disabled={busy || Boolean(recovery.current)} /></label>}
      <div className="gallery-actions"><button className="primary-button" disabled={busy}>{busy ? "Working…" : mode === "export" ? recovery.current && progress ? `Download part ${progress.part + 1} of ${progress.totalParts}` : split ? "Download first recovery part" : "Download encrypted backup" : "Validate and restore"}</button><button type="button" className="secondary-button" onClick={() => { if (recovery.current) cancelRecovery(); onClose(); }} disabled={busy}>Close</button></div>
      </fieldset>
    </form>
    {split && (busy || recovery.current) && <button type="button" className="text-button" onClick={cancelRecovery}>Stop recovery export</button>}
    {blocked && !busy && <p role="status">Save or discard pending note edits and finish other operations before backing up or restoring.</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}
