import { useEffect, useState } from "react";
import { getLocalProofStorageUsage, subscribeToLocalProofChanges, type LocalProofStorageUsage } from "../lib/local-proof-store";

export function LocalStorageStatus({ disabled, onBackup, revision }: { disabled: boolean; onBackup: () => void; revision: number }) {
  const [usage, setUsage] = useState<LocalProofStorageUsage | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let active = true;
    let generation = 0;
    async function refresh() {
      const request = ++generation;
      try {
        const next = await getLocalProofStorageUsage();
        if (active && request === generation) { setUsage(next); setUnavailable(false); }
      } catch {
        if (active && request === generation) { setUsage(null); setUnavailable(true); }
      }
    }
    void refresh();
    const unsubscribe = subscribeToLocalProofChanges(kind => { if (kind !== "source") void refresh(); });
    return () => { active = false; unsubscribe(); };
  // Normal same-tab writes do not broadcast a gallery change to this tab.
  // Parent refresh receipts and completed editing/intake operations refresh counts only.
  }, [revision, disabled]);
  const mib = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);
  return <details className="local-boundary storage-status">
    <summary>Stored in this browser. Keep a backup.</summary>
    <p>Local to this browser profile, not account-isolated, synced, or encrypted by Proof Gallery. Clearing site data, using private browsing, or losing this profile can erase it. Encrypted backups include saved Proof, pending media, and saved notes.</p>
    {usage && <dl className="storage-usage" aria-label="Local storage usage">
      <div><dt>Saved media</dt><dd>{mib(usage.savedBytes)} / {mib(usage.limits.savedBytes)} MiB · {usage.savedCount} / {usage.limits.savedCount.toLocaleString()} items</dd></div>
      <div><dt>Pending media</dt><dd>{mib(usage.pendingBytes)} / {mib(usage.limits.pendingBytes)} MiB · {usage.pendingCount} / {usage.limits.pendingCount} items</dd></div>
    </dl>}
    {usage?.warnings.map(warning => <p key={warning} className="capacity-warning" role="status">{warning}</p>)}
    {unavailable && <p role="status">Storage usage is unavailable. This does not mean your gallery is empty.</p>}
    <p className="storage-help">These are media safety limits, not your device’s free space. Browser quotas can be smaller. Oversized older galleries can use encrypted recovery parts; nothing is automatically removed.</p>
    <button className="text-button" type="button" disabled={disabled} onClick={onBackup}>Create an encrypted backup</button>
  </details>;
}
