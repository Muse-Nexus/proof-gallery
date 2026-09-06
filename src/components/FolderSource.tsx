import { useEffect, useRef, useState } from "react";
import { chooseProofFolder, FolderSourceWatch, supportsFolderWatching, type FolderSourceState, type ProofFolder } from "../lib/folder-source";
import { confirmTrustedFolderSource, countLocalProofCandidates, forgetTrustedFolderSource, getTrustedFolderSource, setTrustedFolderActive, stageTrustedFolderMedia, subscribeToLocalProofChanges, type TrustedFolderSource } from "../lib/local-proof-store";
import { categoryLabel, parseTags, PROOF_CATEGORIES, type ProofCategory } from "../lib/proof";

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
  const [trusted, setTrusted] = useState<TrustedFolderSource | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [autoConsent, setAutoConsent] = useState(false);
  const [category, setCategory] = useState<ProofCategory | "">("");
  const [tags, setTags] = useState("");
  const [error, setError] = useState("");
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const watch = useRef<FolderSourceWatch | null>(null);
  const selectedFolder = useRef<ProofFolder | null>(null);
  const grant = useRef<TrustedFolderSource | null>(null);
  const mounted = useRef(false);
  const choice = useRef(0);
  const mutation = useRef(false);
  const onAdded = useRef(onCandidatesAdded);
  onAdded.current = onCandidatesAdded;
  const suspendedNow = useRef(suspended);
  suspendedNow.current = suspended || autoConsent;
  const externalSuspendedNow = useRef(suspended);
  externalSuspendedNow.current = suspended;

  function remember(record: TrustedFolderSource | null) {
    grant.current = record;
    setTrusted(record);
  }

  async function refreshCount() {
    try {
      const count = await countLocalProofCandidates();
      if (mounted.current) setPendingCount(count);
    } catch {
      if (mounted.current) setPendingCount(null);
    }
  }

  function attach(folder: ProofFolder, record: TrustedFolderSource | null) {
    watch.current?.disconnect();
    let previousAdded = 0;
    const next = new FolderSourceWatch(folder, incoming => {
      if (!mounted.current || watch.current !== next) return;
      setState(incoming);
      if (incoming.added > previousAdded) {
        previousAdded = incoming.added;
        if (incoming.destination === "review") {
          void refreshCount();
          onAdded.current?.();
        }
      }
    }, record ? (files, signal) => stageTrustedFolderMedia(record.id, record.revision, files, signal) : undefined,
    record ? "saved" : "review");
    watch.current = next;
    selectedFolder.current = folder;
    next.setSuspended(suspendedNow.current);
    next.setVisible(document.visibilityState === "visible");
    setState(next.snapshot());
    return next;
  }

  async function syncSource(allowResume = true, force = false) {
    // Stop reading immediately on a source/clear notice, before IndexedDB yields.
    // The transaction guard independently prevents a stale grant from committing.
    if (force) watch.current?.pause();
    const generation = ++choice.current;
    try {
      const record = await getTrustedFolderSource();
      if (!mounted.current || generation !== choice.current || mutation.current) return;
      if (!force && record?.id === grant.current?.id && record?.revision === grant.current?.revision) return;
      if (!record) {
        if (grant.current) {
          watch.current?.disconnect();
          watch.current = null;
          selectedFolder.current = null;
          setState(null);
          remember(null);
        }
        return;
      }
      remember(record);
      setAutoConsent(false);
      suspendedNow.current = externalSuspendedNow.current;
      const next = attach(record.handle, record);
      if (record.paused || !supported || !allowResume) next.pause();
      else void next.restore();
    } catch (cause) {
      if (mounted.current && generation === choice.current) {
        setError(cause instanceof Error ? cause.message : "The remembered source could not be loaded.");
      }
    } finally {
      if (mounted.current && generation === choice.current) setLoading(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    void refreshCount();
    void syncSource();
    const unsubscribe = subscribeToLocalProofChanges(kind => {
      void refreshCount();
      if ((kind === "source" || kind === "clear") && !mutation.current) void syncSource(true, true);
    });
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

  useEffect(() => { watch.current?.setSuspended(suspended || autoConsent); }, [suspended, autoConsent]);

  async function choose() {
    const generation = ++choice.current;
    setChoosing(true);
    setError("");
    try {
      const folder = await chooseProofFolder();
      if (!mounted.current || generation !== choice.current) return;
      setAutoConsent(false);
      setCategory("");
      setTags("");
      attach(folder, null);
    } catch (cause) {
      if (mounted.current && generation === choice.current && !(cause instanceof DOMException && cause.name === "AbortError")) {
        setError(cause instanceof Error ? cause.message : "The folder could not be selected. Try again or choose individual photos.");
      }
    } finally {
      if (mounted.current && generation === choice.current) setChoosing(false);
    }
  }

  async function confirmAutomatic() {
    const folder = selectedFolder.current;
    if (!folder || !autoConsent || !category || grant.current || mutation.current) return;
    mutation.current = true;
    choice.current++;
    watch.current?.pause();
    setBusy(true);
    setError("");
    try {
      const record = await confirmTrustedFolderSource(folder, category, parseTags(tags));
      if (!mounted.current) return;
      remember(record);
      setAutoConsent(false);
      suspendedNow.current = externalSuspendedNow.current;
      const next = attach(folder, record);
      // The owner just confirmed; no new browser permission dialog is needed.
      void next.restore();
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error || cause instanceof DOMException ? cause.message : "Automatic saving could not be enabled. No source permission was saved.");
    } finally {
      mutation.current = false;
      if (mounted.current) { setBusy(false); void syncSource(); }
    }
  }

  async function pause() {
    watch.current?.pause();
    const current = grant.current;
    if (!current || mutation.current) return;
    mutation.current = true;
    choice.current++;
    setBusy(true);
    setError("");
    try {
      const record = await setTrustedFolderActive(current.id, current.revision, false);
      if (mounted.current) remember(record);
    } catch (cause) {
      if (mounted.current) setError(`Paused on this page, but that preference could not be remembered. Try Pause again before reloading. ${cause instanceof Error ? cause.message : ""}`);
    } finally {
      mutation.current = false;
      if (mounted.current) { setBusy(false); void syncSource(false); }
    }
  }

  async function start() {
    const current = grant.current;
    if (!current) { await watch.current?.start(); return; }
    if (mutation.current) return;
    mutation.current = true;
    choice.current++;
    setBusy(true);
    setError("");
    try {
      const record = current.paused ? await setTrustedFolderActive(current.id, current.revision, true) : current;
      if (!mounted.current) return;
      remember(record);
      const next = attach(record.handle, record);
      void next.start();
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "The source could not be resumed.");
    } finally {
      mutation.current = false;
      if (mounted.current) { setBusy(false); void syncSource(); }
    }
  }

  async function disconnect() {
    if (mutation.current) return;
    choice.current++;
    watch.current?.disconnect();
    const current = grant.current;
    setError("");
    if (current) {
      mutation.current = true;
      setBusy(true);
      try {
        await forgetTrustedFolderSource(current.id, current.revision);
        if (!mounted.current) return;
        remember(null);
      } catch (cause) {
        if (mounted.current) {
          attach(current.handle, current).pause();
          setError(`Stopped on this page, but the remembered permission could not be removed. Try Forget again before reloading. ${cause instanceof Error ? cause.message : ""}`);
        }
        return;
      } finally {
        mutation.current = false;
        if (mounted.current) { setBusy(false); void syncSource(false); }
      }
    }
    watch.current = null;
    selectedFolder.current = null;
    setState(null);
    setAutoConsent(false);
  }

  const canStart = state && ["ready", "paused", "error"].includes(state.status);
  const isActive = state && ["checking", "watching", "hidden", "suspended"].includes(state.status);
  const disabled = suspended || busy || loading;

  return <section className="folder-source" aria-labelledby="folder-source-title">
    <div className="folder-source-header">
      <div><p className="eyebrow">A little less collecting by hand</p><h3 id="folder-source-title">Let a folder bring things to you</h3></div>
      <span className="folder-source-status" data-state={state?.status ?? "disconnected"}>{loading ? "Checking remembered source…" : state ? STATUS_LABEL[state.status] : "You choose the source"}</span>
    </div>
    <p>Choose a small folder for photos, screenshots, or clips. It is checked about every minute while this page is open and visible. Review new media yourself, or explicitly trust this one folder to save automatically.</p>
    {state && <p className="folder-source-detail"><strong>{trusted?.label ?? state.folderName}</strong> · This folder only; no subfolders.</p>}
    {trusted && <div className="folder-source-mode"><strong>Automatic saving {trusted.paused ? "paused" : "allowed"}</strong><p>Existing and new valid media from this folder can become saved, searchable Proof without item-by-item review. Your category: {categoryLabel(trusted.category)}. {trusted.tags.length > 0 ? `Your tags: ${trusted.tags.join(", ")}.` : "No default tags."} These are your labels, not an interpretation of the image.</p><p>This exact source and your Pause preference are remembered in this browser profile. It resumes only when the gallery is open and visible and browser read permission is still granted.</p></div>}
    {supported ? <>
      {state && !trusted && <fieldset className="folder-source-consent" disabled={disabled}>
        <label className="folder-source-consent-check"><input type="checkbox" checked={autoConsent} onChange={event => setAutoConsent(event.target.checked)} />Allow automatic saving from this folder</label>
        {autoConsent && <>
          <p>Only <strong>{state.folderName}</strong>. All existing and new valid top-level media will save directly into Proof and become searchable, without individual review. Choose a folder you have already curated. Nothing assesses whether a photo is meaningful or says what happened.</p>
          <div className="folder-source-consent-grid">
            <label>Category for every file<select value={category} onChange={event => setCategory(event.target.value as ProofCategory | "")}><option value="">Choose a category</option>{PROOF_CATEGORIES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label>Tags for every file (optional)<input value={tags} onChange={event => setTags(event.target.value)} placeholder="For example: my collection, photos" /></label>
          </div>
          <p>File names stay file names; dates, quotes, identities, and meaning are not inferred. This remembers the exact folder handle and your choice in this unencrypted browser profile. No uploads. No access to other folders. Pause or Forget at any time; saved items remain.</p>
          <button className="primary-button" disabled={!category || disabled} onClick={() => void confirmAutomatic()}>Confirm automatic saving</button>
          <button className="text-button" onClick={() => setAutoConsent(false)}>Keep individual review</button>
        </>}
      </fieldset>}
      <div className="folder-source-actions">
        {!state && <button className="primary-button" disabled={disabled || choosing} onClick={() => void choose()}>{choosing ? "Choosing folder…" : "Choose a folder"}</button>}
        {canStart && !autoConsent && <button className="primary-button" disabled={disabled} onClick={() => void start()}>{state.status === "ready" ? "Start watching" : state.status === "error" && trusted ? "Reconnect" : "Resume"}</button>}
        {isActive && <button className="text-button" disabled={busy} onClick={() => void pause()}>Pause</button>}
        {state?.status === "paused" && trusted && !trusted.paused && <button className="text-button" disabled={busy} onClick={() => void pause()}>Remember Pause</button>}
        {state?.status === "watching" && <button className="text-button" disabled={disabled || autoConsent} onClick={() => void watch.current?.checkNow()}>Check now</button>}
        {state && <button className="text-button" disabled={busy} onClick={() => void disconnect()}>{trusted ? "Forget trusted folder" : "Disconnect folder"}</button>}
        <button className="text-button" disabled={disabled} onClick={onReview}>Open review{pendingCount !== null && pendingCount > 0 ? ` (${pendingCount})` : ""}</button>
      </div>
      {state && <p role="status" className="folder-source-detail">{state.message}{state.lastChecked !== null && <> Last checked {new Date(state.lastChecked).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.</>}</p>}
      {state && (state.added > 0 || state.duplicates > 0 || state.rejected > 0) && <p className="folder-source-detail">Since last start: {state.added} {state.destination === "saved" ? "saved automatically" : "added to review"} · {state.duplicates} duplicates skipped · {state.rejected} unsupported or oversized files skipped.</p>}
      {state?.limited && <p className="folder-source-detail">A check covers up to 250 entries, 50 new files, and 48 MiB. More new files may arrive on later checks. For folders larger than 250 entries, choose a smaller folder so nothing is missed.</p>}
    </> : <>
      <p className="folder-source-detail">This browser does not support automatic folder checks. You can still select photos and clips from your device in the review inbox. Folder watching is available in supporting desktop browsers such as Chrome or Edge.</p>
      <button className="text-button" disabled={disabled} onClick={onReview}>Choose photos or clips</button>
      {trusted && <button className="text-button" disabled={busy} onClick={() => void disconnect()}>Forget trusted folder</button>}
    </>}
    {error && <p role="alert" className="form-message">{error}</p>}
    <p className="folder-source-detail">Read-only access. Nothing uploads. Without automatic-save confirmation, the connection lasts until you disconnect or reload and new files stay in review. It cannot collect when the browser is closed. JPEG, PNG, WebP, GIF, MP4, and WebM up to 10 MB each. Dates and meaning stay blank until you add them.</p>
  </section>;
}
