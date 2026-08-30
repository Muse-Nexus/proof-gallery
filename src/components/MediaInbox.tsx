import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  listLocalProofCandidates, stageLocalProofMedia, resolveLocalProofCandidates,
  subscribeToLocalProofChanges, requestLocalProofPersistence,
  clearLocalProofCandidates, stageLocalProofCompanion,
  type CandidateInput, type LocalProofCandidate,
} from "../lib/local-proof-store";
import { LOCAL_MEDIA_ACCEPT } from "../lib/media";
import { PROOF_CATEGORIES, categoryLabel, formatProofDate, parseTags, type ProofCategory, type ProofItem } from "../lib/proof";
import { relatedSavedProof, suggestNoteOrganization } from "../lib/note-assist";
import { ProofMedia } from "./ProofMedia";

function CandidateDetails({ candidate, disabled, savedProof, onSave, onDirtyChange }: {
  candidate: LocalProofCandidate; disabled: boolean;
  savedProof: readonly ProofItem[];
  onSave: (input: CandidateInput) => Promise<void>;
  onDirtyChange: (id: string, dirty: boolean) => void;
}) {
  const [input, setInput] = useState(candidate.input);
  const [tags, setTags] = useState(input.tags.join(", "));
  const [useSuggestions, setUseSuggestions] = useState(!candidate.input.evidenceText.trim());
  const [touched, setTouched] = useState({ title: false, category: false, tags: false });
  const [showRelated, setShowRelated] = useState(false);
  const suggestions = suggestNoteOrganization(input.evidenceText);
  const canSuggestCategory = !touched.category && !input.category && suggestions.category;
  const newTags = touched.tags ? [] : suggestions.tags.filter(tag => !parseTags(tags).includes(tag));
  const related = showRelated ? relatedSavedProof({ id: candidate.id, userId: candidate.userId, ...input, tags: parseTags(tags) }, savedProof) : [];
  const dirty = JSON.stringify(input) !== JSON.stringify(candidate.input) || tags !== candidate.input.tags.join(", ");
  useEffect(() => {
    onDirtyChange(candidate.id, dirty);
    return () => onDirtyChange(candidate.id, false);
  }, [candidate.id, dirty, onDirtyChange]);
  function submit(event: FormEvent) {
    event.preventDefault();
    const importedTitle = (candidate.companionReceipt?.originalFilename ?? candidate.fileName).slice(0, 200);
    const filenameTitle = input.title === candidate.input.title && candidate.input.title === importedTitle;
    void onSave({ ...input,
      ...(useSuggestions ? {
        title: !touched.title && filenameTitle && suggestions.title ? suggestions.title : input.title,
        category: touched.category ? input.category : input.category ?? suggestions.category,
      } : {}),
      tags: parseTags([...parseTags(tags), ...(useSuggestions ? newTags : [])].join(",")),
    });
  }
  return <form className="candidate-note" onSubmit={submit}>
      <fieldset disabled={disabled}>
        <label>Your short note <span className="optional">a few words are enough</span>
          <textarea value={input.evidenceText} maxLength={20000} rows={3} placeholder="What would you like to remember about this?" onChange={e => setInput({ ...input, evidenceText: e.target.value })} />
        </label>
        {input.evidenceText.trim() && <div className="note-suggestions">
          <p>{input.category ? `Keeping your category: ${categoryLabel(input.category)}.` : canSuggestCategory ? `Suggested from your words: ${categoryLabel(suggestions.category!)} (word cue: “${suggestions.cue}”).` : "Category left for review. You can choose one in Extra details."}</p>
          {newTags.length > 0 && <p>Tags: {newTags.map(tag => `#${tag}`).join(" ")}</p>}
          <label className="checkbox-row"><input type="checkbox" checked={useSuggestions} onChange={e => setUseSuggestions(e.target.checked)} />Use suggestions when saving this note</label>
          <small>Simple word matches, not AI interpretation. Your note, date, source, and manual choices stay intact.</small>
        </div>}
        <button className="secondary-button">Save note</button>
        <details className="candidate-details">
        <summary>Extra details · optional</summary>
        <div className="candidate-extra-fields">
        <label>Title<input value={input.title} maxLength={200} required onChange={e => { setTouched({ ...touched, title: true }); setInput({ ...input, title: e.target.value }); }} /></label>
        <label>Category<select value={input.category ?? ""} onChange={e => { setTouched({ ...touched, category: true }); setInput({ ...input, category: (e.target.value || null) as ProofCategory | null }); }}>
          <option value="">Choose during review</option>
          {PROOF_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select></label>
        <label>Occurred date <span className="optional">leave blank if unknown</span><input type="date" value={input.occurredOn ?? ""} onChange={e => setInput({ ...input, occurredOn: e.target.value || null })} /></label>
        <label>Source<input value={input.source ?? ""} maxLength={500} onChange={e => setInput({ ...input, source: e.target.value || null })} /></label>
        <label>Person <span className="optional">optional</span><input value={input.person ?? ""} maxLength={200} onChange={e => setInput({ ...input, person: e.target.value || null })} /></label>
        <label>Tags <span className="optional">comma separated</span><input value={tags} onChange={e => { setTouched({ ...touched, tags: true }); setTags(e.target.value); }} /></label>
        <button className="secondary-button">Save details</button>
        </div>
        </details>
        {dirty && <button type="button" className="text-button" onClick={() => {
          setInput(candidate.input); setTags(candidate.input.tags.join(", "));
          setTouched({ title: false, category: false, tags: false }); setUseSuggestions(!candidate.input.evidenceText.trim());
        }}>Discard detail edits</button>}
        <button className="text-button" type="button" disabled={!input.evidenceText.trim()} onClick={() => setShowRelated(value => !value)}>{showRelated ? "Hide related Proof" : "Find related saved Proof"}</button>
        {showRelated && <div className="related-proof-list">
          <p>Possible connections by shared words—not a conclusion about what this moment means. Only saved Proof in this collection is checked.</p>
          {dirty && <p>Your current note is still an unsaved draft.</p>}
          {related.length === 0 && <p>No shared-word matches yet. This does not say anything about the value of this moment.</p>}
          {related.map(({ item, sharedWords }) => <article key={item.id}>
            <h4>{item.title}</h4><p>Shared words: {sharedWords.join(", ")}</p>
            {item.evidenceText ? <blockquote>{item.evidenceText}</blockquote> : <p>No note saved; see the original attachment in your gallery.</p>}
            <p>{formatProofDate(item.occurredOn)} · {item.source ?? "Source: MISSING"}</p>
          </article>)}
        </div>}
      </fieldset>
    </form>;
}

export function MediaInbox({ busy, onBusyChange, onSaved, onClose, onDirtyStateChange, savedProof = [] }: {
  busy: boolean; onBusyChange: (busy: boolean) => void;
  onSaved: () => Promise<void>; onClose: () => void;
  onDirtyStateChange?: (dirty: boolean) => void;
  savedProof?: readonly ProofItem[];
}) {
  const [candidates, setCandidates] = useState<LocalProofCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [category, setCategory] = useState<ProofCategory | "">("");
  const [tags, setTags] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejected, setRejected] = useState<{ name: string; reason: string }[]>([]);
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set());
  const [externalChange, setExternalChange] = useState(false);
  const dirtyRef = useRef<Set<string>>(new Set());
  const onDirtyChange = useCallback((id: string, dirty: boolean) => {
    const current = dirtyRef.current;
    if (current.has(id) === dirty) return;
    const next = new Set(current); if (dirty) next.add(id); else next.delete(id);
    dirtyRef.current = next;
    setDirtyIds(next);
  }, []);
  useEffect(() => {
    onDirtyStateChange?.(dirtyIds.size > 0);
    return () => onDirtyStateChange?.(false);
  }, [dirtyIds.size, onDirtyStateChange]);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const companionInput = useRef<HTMLInputElement>(null);
  const [folderSupported] = useState(() => "webkitdirectory" in document.createElement("input"));

  async function refresh(options: { replaceIds?: string[]; discardDrafts?: boolean } = {}) {
    try {
      const incoming = await listLocalProofCandidates();
      // Read dirty state after the asynchronous load. Every refresh path must
      // preserve drafts, not just the cross-tab subscription.
      const preserveIds = new Set(options.discardDrafts ? [] : dirtyRef.current);
      options.replaceIds?.forEach(id => preserveIds.delete(id));
      if (preserveIds.size) setExternalChange(true);
      setCandidates(current => {
        const drafts = new Map(current.filter(c => preserveIds.has(c.id)).map(c => [c.id, c]));
        const incomingIds = new Set(incoming.map(c => c.id));
        return [
          ...incoming.map(c => drafts.get(c.id) ?? c),
          ...current.filter(c => preserveIds.has(c.id) && !incomingIds.has(c.id)),
        ];
      });
      setSelected(new Set());
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load review inbox"); }
  }
  useEffect(() => {
    folderInput.current?.setAttribute("webkitdirectory", "");
    void refresh();
    return subscribeToLocalProofChanges(() => {
      if (dirtyRef.current.size) setExternalChange(true);
      else void refresh();
    });
  }, []);
  useEffect(() => {
    if (externalChange && !dirtyIds.size && !busy) {
      setExternalChange(false);
      void refresh();
    }
  }, [externalChange, dirtyIds.size, busy]);

  async function importFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length || busy) return;
    onBusyChange(true); setError(null); setMessage(null); setRejected([]);
    try {
      const result = await stageLocalProofMedia(files);
      await requestLocalProofPersistence();
      setRejected(result.rejected);
      setMessage(`${result.added} added to review · ${result.duplicates} already here · ${result.rejected.length} unsupported. Nothing saved as Proof yet.`);
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Import failed"); }
    finally { onBusyChange(false); }
  }

  async function clearReview() {
    if (busy || !window.confirm("Remove every pending photo, clip, and draft from this browser's review inbox? Saved Proof and original files are untouched. Unsaved detail edits will be lost.")) return;
    onBusyChange(true); setError(null);
    try { await clearLocalProofCandidates(); await refresh({ discardDrafts: true }); setMessage("Review inbox cleared. Saved Proof and original files are untouched."); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not clear review inbox"); }
    finally { onBusyChange(false); }
  }

  async function importCompanion(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file || busy) return;
    onBusyChange(true); setError(null); setMessage(null); setRejected([]);
    try {
      const result = await stageLocalProofCompanion(file);
      await requestLocalProofPersistence();
      setMessage(`${result.added} companion photos added to review · ${result.duplicates} already here. Nothing saved as Proof yet.`);
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Companion import failed"); }
    finally { onBusyChange(false); }
  }

  async function act(action: "approve" | "skip" | "edit", one?: LocalProofCandidate, input?: CandidateInput) {
    if (busy) return;
    if (action !== "edit" && dirtyIds.size) { setError("Save or discard edited details first."); return; }
    const targets = one ? [one] : candidates.filter(c => selected.has(c.id));
    if (!targets.length) return;
    if (action === "skip" && !window.confirm(`Remove ${targets.length} item(s) from review? Original files are untouched. You can select them again later.`)) return;
    onBusyChange(true); setError(null); setMessage(null);
    try {
      await resolveLocalProofCandidates(targets.map(candidate => ({ candidate, input: input ?? (action === "approve" ? {
        ...candidate.input,
        category: category || candidate.input.category,
        tags: parseTags([...candidate.input.tags, ...parseTags(tags)].join(",")),
      } : candidate.input) })), action);
      setMessage(action === "approve" ? `${targets.length} saved to your local Proof. Back up saved Proof to keep a recovery copy.` : action === "edit" ? "Review details saved. This is not saved Proof yet." : "Removed from review. Original files were not changed.");
      await refresh({ replaceIds: action === "edit" ? targets.map(c => c.id) : [] });
      if (action === "approve") await onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Review could not be saved"); }
    finally { onBusyChange(false); }
  }

  return <section className="media-inbox" aria-labelledby="media-inbox-title" aria-busy={busy}>
    <header className="media-inbox-header">
      <div><span className="landing-eyebrow">Only the files you choose</span><h2 id="media-inbox-title">Photos & media</h2>
        <p>Bring a batch from Mac, Android, or PC. Review it here, then keep what belongs in your Proof.</p></div>
      <button className="text-button" disabled={busy || dirtyIds.size > 0} onClick={onClose}>Close media inbox</button>
    </header>
    <div className="media-intake-actions">
      <button className="primary-button" disabled={busy} onClick={() => fileInput.current?.click()}>Choose photos or clips</button>
      <input ref={fileInput} className="visually-hidden" type="file" multiple accept={LOCAL_MEDIA_ACCEPT} aria-label="Choose photos or clips" tabIndex={-1} onChange={event => void importFiles(event)} />
      {folderSupported && <>
        <button className="secondary-button" disabled={busy} onClick={() => folderInput.current?.click()}>Choose a folder</button>
        <input ref={folderInput} className="visually-hidden" type="file" multiple aria-label="Choose a media folder" tabIndex={-1} onChange={event => void importFiles(event)} />
      </>}
      <button className="secondary-button" disabled={busy} onClick={() => companionInput.current?.click()}>Import companion review</button>
      <input ref={companionInput} className="visually-hidden" type="file" accept=".json,application/json" aria-label="Import companion review file" tabIndex={-1} onChange={event => void importCompanion(event)} />
      <button className="text-button" disabled={busy} onClick={() => void clearReview()}>Clear review inbox</button>
    </div>
    <p className="media-guidance">File picker: JPEG, PNG, WebP, GIF, MP4, or WebM · 10 MB each · up to 50 files / 48 MiB per batch. Export Apple Photos selections as JPEG, or use the Mac companion for HEIC previews. Direct HEIC and MOV imports are not supported. Clip playback depends on your browser.</p>
    <p className="media-guidance">Local and unencrypted, including original file metadata. This website does not scan your library or keep folder access. No face recognition, AI analysis, or sync. File modification dates are not treated as event dates.</p>
    <p className="media-guidance">The Mac Photos companion can prepare a private review file from a source you allow. Import that file here—not with Restore. This website does not inherit Photos access. Companion dates come from Photos metadata, not an inferred event; HEIC previews are labelled JPEG copies.</p>
    <p className="media-guidance"><strong>Review items are not in search or backups.</strong> Original files are untouched. Keep them until you save and back up your Proof.</p>
    {message && <p className="notice-banner" role="status">{message}</p>}
    {error && <p className="error-banner" role="alert">{error}</p>}
    {externalChange && <p className="notice-banner" role="status">Review has changes to load. Your unsaved details are still here. Saving checks for conflicts; discard edits to reload the latest items.</p>}
    {rejected.length > 0 && <details><summary>{rejected.length} files could not be imported</summary><ul>{rejected.map((r, i) => <li key={i}>{r.name}: {r.reason}</li>)}</ul></details>}
    {candidates.length > 0 ? <>
      {dirtyIds.size > 0 && <p role="status">Save or discard edited details before saving a selection or closing the inbox.</p>}
      <div className="review-batch-controls">
        <label className="checkbox-row"><input type="checkbox" disabled={busy} checked={selected.size === candidates.length} onChange={e => setSelected(e.target.checked ? new Set(candidates.map(c => c.id)) : new Set())} />Select all {candidates.length}</label>
        <label>Category for selected<select value={category} disabled={busy} onChange={e => setCategory(e.target.value as ProofCategory | "")}>
          <option value="">Use each item's category</option>{PROOF_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select></label>
        <label>Add tags to selected<input value={tags} disabled={busy} onChange={e => setTags(e.target.value)} placeholder="care, together…" /></label>
        <button className="primary-button" disabled={busy || !selected.size || dirtyIds.size > 0} onClick={() => void act("approve")}>Save selected ({selected.size})</button>
        <button className="text-button" disabled={busy || !selected.size || dirtyIds.size > 0} onClick={() => void act("skip")}>Remove selected from review</button>
      </div>
      <div className="review-grid">{candidates.map(candidate => <article className="review-card" key={`${candidate.id}:${candidate.revision}`}>
        <label className="checkbox-row"><input type="checkbox" disabled={busy} checked={selected.has(candidate.id)} onChange={e => setSelected(current => { const next = new Set(current); if (e.target.checked) next.add(candidate.id); else next.delete(candidate.id); return next; })} />{candidate.input.title}</label>
        {candidate.mediaUrl && <ProofMedia url={candidate.mediaUrl} type={candidate.mediaType} title={candidate.input.title} />}
        <p className="review-state">Pending review · not saved Proof</p>
        <p className="review-source">{candidate.input.source ?? "Source: MISSING"}</p>
        <p className="review-source">Occurred: {candidate.input.occurredOn ?? "MISSING"}</p>
        {candidate.companionReceipt && <p className="review-source">{candidate.companionReceipt.representation === "jpeg-preview" ? "JPEG preview · original remains in Apple Photos" : "Original photo bytes from Apple Photos"}. Imported date source: Photos metadata. No identity or meaning inferred.</p>}
        <CandidateDetails candidate={candidate} savedProof={savedProof} disabled={busy} onSave={input => act("edit", candidate, input)} onDirtyChange={onDirtyChange} />
      </article>)}</div>
    </> : <p className="review-empty">No media waiting for review. Choose a few photos or screenshots to begin.</p>}
  </section>;
}
