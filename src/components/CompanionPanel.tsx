import { useEffect, useRef, useState } from "react";
import { pairCompanion, receiveCompanionReview, type CompanionSession } from "../lib/local-companion";
import { stageLocalProofCompanion } from "../lib/local-proof-store";

export function CompanionPanel({ session, onSession, onImported, disabled, onBusyChange }: {
  session: CompanionSession | null; onSession: (value: CompanionSession | null) => void; onImported: () => void; disabled: boolean; onBusyChange: (value: boolean) => void;
}) {
  const [code, setCode] = useState(""); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  async function connect() {
    if (disabled || busy) return;
    const controller = new AbortController(); pending.current = controller; setBusy(true); setMessage("");
    onBusyChange(true);
    try { const connected = await pairCompanion(code, controller.signal); if (!controller.signal.aborted) { onSession(connected); setCode(""); setMessage("Connected on this Mac. Nothing has been imported or sent for matching."); } }
    catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "Connection failed."); }
    finally { setBusy(false); onBusyChange(false); }
  }
  async function receive() {
    if (!session || disabled || busy) return;
    const controller = new AbortController(); pending.current = controller; setBusy(true); setMessage("");
    onBusyChange(true);
    try {
      const blob = await receiveCompanionReview(session, controller.signal);
      if (controller.signal.aborted) return;
      const result = await stageLocalProofCompanion(blob, controller.signal);
      setMessage(`${result.added} photos added to pending review; ${result.duplicates} duplicates skipped. Nothing approved.`); onImported();
    } catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "Transfer failed."); }
    finally { setBusy(false); onBusyChange(false); }
  }
  return <section className="companion-panel" aria-labelledby="companion-title">
    <h2 id="companion-title">Connect this Mac</h2>
    <p>In the Mac companion, choose “Connect to Gallery on this Mac” and copy the pairing code. This permits a temporary same-Mac connection—not an internet upload. It does not grant this website Photos access.</p>
    {!session ? <form onSubmit={event => { event.preventDefault(); void connect(); }}>
      <label>Pairing code<input type="password" autoComplete="off" value={code} onChange={event => setCode(event.target.value)} disabled={busy} /></label>
      <button className="secondary-button" disabled={busy || disabled || !code}>{busy ? "Connecting…" : "Connect companion"}</button>
    </form> : <>
      <p>On-device meaning matching: {session.semantic ? "available" : "unavailable"}. Source-backed story draft: {session.story ? "available" : "unavailable"}. Text is sent only when you ask. No images are sent for AI analysis.</p>
      <button className="primary-button" disabled={busy || disabled} onClick={() => void receive()}>Receive prepared photos into review</button>
      <button className="text-button" disabled={busy} onClick={() => { pending.current?.abort(); onSession(null); setMessage("Browser pairing cleared. Use Stop connection in the companion to revoke the code now."); }}>Disconnect browser</button>
    </>}
    {busy && <button className="text-button" onClick={() => pending.current?.abort()}>Cancel request</button>}
    <p className="media-guidance">Expires within five minutes. Keep the code private. Cancel stops work before the atomic save completes; it cannot remove an already-received batch. If local-network access is unavailable, use Photos & media → Import companion review. Android and PC use the existing photo/folder picker; they do not need this Mac connection.</p>
    {message && <p role="status">{message}</p>}
  </section>;
}
