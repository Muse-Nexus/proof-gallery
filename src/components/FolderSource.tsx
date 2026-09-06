import { useEffect, useRef, useState } from "react";
import { chooseProofFolder, FolderSourceWatch, supportsFolderWatching, type FolderSourceState } from "../lib/folder-source";
import { countLocalProofCandidates, subscribeToLocalProofChanges } from "../lib/local-proof-store";

const STATUS_LABEL: Record<FolderSourceState["status"], string> = {
  ready: "Ready when you are", checking: "Checking folder", watching: "Watching while open",
  paused: "Paused", suspended: "Waiting for you", hidden: "Waiting for this tab",
  error: "Needs attention", disconnected: "Disconnected",
};

export function FolderSource({ suspended, onReview, onCandidatesAdded }: {
  suspended: boolean;
  onReview: () => void;
  onCandidatesAdded?: () => void;
}) {
  const [supported] = useState(supportsFolderWatching);
  const [state, setState] = useState<FolderSourceState | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState("");
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const watch = useRef<FolderSourceWatch | null>(null);
  const mounted = useRef(false);
  const choice = useRef(0);
  const onAdded = useRef(onCandidatesAdded);
  onAdded.current = onCandidatesAdded;
  const suspendedNow = useRef(suspended);
  suspendedNow.current = suspended;

  async function refreshCount() {
    try {
      const count = await countLocalProofCandidates();
      if (mounted.current) setPendingCount(count);
    } catch {
      if (mounted.current) setPendingCount(null);
    }
  }

  useEffect(() => {
    mounted.current = true;
    void refreshCount();
    const unsubscribe = subscribeToLocalProofChanges(() => void refreshCount());
    const visibility = () => watch.current?.setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", visibility);
    return () => {
      mounted.current = false;
      choice.current++;
      watch.current?.disconnect();
      watch.current = null;
      unsubscribe();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  useEffect(() => { watch.current?.setSuspended(suspended); }, [suspended]);

  async function choose() {
    const generation = ++choice.current;
    setChoosing(true);
    setError("");
    try {
      const folder = await chooseProofFolder();
      if (!mounted.current || generation !== choice.current) return;
      let previousAdded = 0;
      const next = new FolderSourceWatch(folder, incoming => {
        if (!mounted.current || watch.current !== next) return;
        setState(incoming);
        if (incoming.added > previousAdded) {
          previousAdded = incoming.added;
          void refreshCount();
          onAdded.current?.();
        }
      });
      watch.current = next;
      next.setSuspended(suspendedNow.current);
      next.setVisible(document.visibilityState === "visible");
      setState(next.snapshot());
    } catch (cause) {
      if (mounted.current && generation === choice.current && !(cause instanceof DOMException && cause.name === "AbortError")) {
        setError(cause instanceof Error ? cause.message : "The folder could not be selected. Try again or choose individual photos.");
      }
    } finally {
      if (mounted.current && generation === choice.current) setChoosing(false);
    }
  }

  function disconnect() {
    choice.current++;
    watch.current?.disconnect();
    watch.current = null;
    setState(null);
    setError("");
  }

  const canStart = state && ["ready", "paused", "error"].includes(state.status);
  const isActive = state && ["checking", "watching", "hidden", "suspended"].includes(state.status);

  return <section className="folder-source" aria-labelledby="folder-source-title">
    <div className="folder-source-header">
      <div><p className="eyebrow">A little less collecting by hand</p><h3 id="folder-source-title">Let a folder bring things to you</h3></div>
      <span className="folder-source-status" data-state={state?.status ?? "disconnected"}>{state ? STATUS_LABEL[state.status] : "You choose the source"}</span>
    </div>
    <p>Choose a small folder for photos, screenshots, or clips. After you start, it is checked about every minute while this page is open and visible. New media arrives in your private review inbox; you decide what belongs in Proof.</p>
    {supported ? <>
      {state && <p className="folder-source-detail"><strong>{state.folderName}</strong> · This folder only; no subfolders.</p>}
      <div className="folder-source-actions">
        {!state && <button className="primary-button" disabled={suspended || choosing} onClick={() => void choose()}>{choosing ? "Choosing folder…" : "Choose a folder"}</button>}
        {canStart && <button className="primary-button" disabled={suspended} onClick={() => void watch.current?.start()}>{state.status === "ready" ? "Start watching" : "Resume"}</button>}
        {isActive && <button className="text-button" onClick={() => watch.current?.pause()}>Pause</button>}
        {state?.status === "watching" && <button className="text-button" disabled={suspended} onClick={() => void watch.current?.checkNow()}>Check now</button>}
        {state && <button className="text-button" onClick={disconnect}>Disconnect folder</button>}
        <button className="text-button" disabled={suspended} onClick={onReview}>Open review{pendingCount !== null && pendingCount > 0 ? ` (${pendingCount})` : ""}</button>
      </div>
      {state && <p role="status" className="folder-source-detail">{state.message}{state.lastChecked !== null && <> Last checked {new Date(state.lastChecked).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.</>}</p>}
      {state && (state.added > 0 || state.duplicates > 0 || state.rejected > 0) && <p className="folder-source-detail">This connection: {state.added} added to review · {state.duplicates} duplicates skipped · {state.rejected} unsupported or oversized files skipped.</p>}
      {state?.limited && <p className="folder-source-detail">A check covers up to 250 entries, 50 new files, and 48 MiB. More new files may arrive on later checks. For folders larger than 250 entries, choose a smaller folder so nothing is missed.</p>}
    </> : <>
      <p className="folder-source-detail">This browser does not support automatic folder checks. You can still select photos and clips from your device in the review inbox. Folder watching is available in supporting desktop browsers such as Chrome or Edge.</p>
      <button className="text-button" disabled={suspended} onClick={onReview}>Choose photos or clips</button>
    </>}
    {error && <p role="alert" className="form-message">{error}</p>}
    <p className="folder-source-detail">Read-only access. Nothing uploads. The folder connection lasts until you disconnect or reload; unchanged files you skip stay skipped for this connection. JPEG, PNG, WebP, GIF, MP4, and WebM up to 10 MB each. Dates and meaning stay blank until you add them.</p>
  </section>;
}
