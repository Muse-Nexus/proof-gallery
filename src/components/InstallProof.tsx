import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { checkProofPwaUpdate, getProofPwaState, subscribeProofPwa, takeProofInstallPrompt } from "../lib/pwa";

export function InstallProof({ disabled = false }: { disabled?: boolean }) {
  const pwa = useSyncExternalStore(subscribeProofPwa, getProofPwaState);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const pending = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  async function install() {
    if (!pwa.installPrompt || disabled || pending.current) return;
    const offered = takeProofInstallPrompt();
    if (!offered) return;
    pending.current = true; setBusy(true); setMessage("");
    try {
      await offered.prompt();
      const choice = await offered.userChoice;
      if (mounted.current) setMessage(choice.outcome === "accepted" ? "Installation requested. Your browser will finish it; your gallery remains local to its profile." : "Installation canceled. You can keep using the browser gallery.");
    } catch { if (mounted.current) setMessage("The browser could not open installation. Use its menu instructions below."); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  return <details className="install-proof">
    <summary>{pwa.installed ? "Proof app & offline access" : "Install Proof for easy access"}</summary>
    <p>Add an app icon without an account or subscription. Keep using the same browser profile; another browser or installed app may have a separate gallery. Installation is not a backup.</p>
    {pwa.installPrompt && !pwa.installed && <button className="secondary-button" type="button" disabled={disabled || busy} onClick={() => void install()}>Install Proof</button>}
    <ul>
      <li><strong>Android:</strong> in Chrome or your supporting browser, open its menu and choose Install app or Add to Home screen.</li>
      <li><strong>Mac or PC:</strong> use Chrome or Edge’s install icon/menu. In Safari on supported Macs, use File → Add to Dock.</li>
      <li><strong>iPhone or iPad:</strong> open the browser’s Share menu and choose Add to Home Screen.</li>
    </ul>
    <p>Installation options vary by browser. If none appears, bookmark Proof and use the same local file picker, paste, or drop. This version is not an OS share-sheet destination.</p>
    <p role="status">{pwa.error ? "Offline setup or update checking is unavailable. Keep this page open and make a backup before depending on offline access."
      : pwa.offlineReady ? "Public app files are ready offline. Previously saved browser-local Proof stays in browser storage; hosted accounts and external services still need a connection."
        : "Open once while connected and let offline setup finish before relying on it. Development previews do not install an offline worker."}</p>
    {pwa.updateWaiting && <p role="status">An app update is ready. Save any open edits, then close every Proof tab and app window and reopen. No page will reload automatically.</p>}
    {pwa.available && <button className="text-button" type="button" disabled={disabled || busy} onClick={() => void checkProofPwaUpdate()}>Check for app update</button>}
    {message && <p role="status">{message}</p>}
    <p>Offline access does not encrypt storage, sync devices, or collect anything after closing the app. Keep an encrypted backup.</p>
  </details>;
}
