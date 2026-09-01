import { useEffect, useRef, useState } from "react";
import { formatProofDate, type ProofItem } from "../lib/proof";
import { relatedSavedProof, storySequence } from "../lib/note-assist";
import { ProofMedia } from "./ProofMedia";
import { companionLabel } from "./ProofCard";
import { draftCompanionStory, semanticCompanionSearch, type CompanionSession, type StoryExcerpt } from "../lib/local-companion";

export function ProofStory({ seed, savedProof, onClose, companion = null }: {
  seed: ProofItem; savedProof: readonly ProofItem[]; onClose: () => void; companion?: CompanionSession | null;
}) {
  const [selected, setSelected] = useState<string[]>([seed.id]);
  const region = useRef<HTMLElement>(null);
  const [meaningIDs, setMeaningIDs] = useState<string[] | null>(null);
  const [excerpts, setExcerpts] = useState<StoryExcerpt[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const pending = useRef<AbortController | null>(null);
  const revisionKey = JSON.stringify(savedProof.map(item => [item.id, item.updatedAt]));
  useEffect(() => { pending.current?.abort(); setExcerpts([]); setMeaningIDs(null); return () => pending.current?.abort(); }, [revisionKey, companion]);
  useEffect(() => { pending.current?.abort(); setExcerpts([]); }, [selected]);
  const related = meaningIDs ? meaningIDs.flatMap(id => {
    const item = savedProof.find(item => item.id === id && item.id !== seed.id && item.userId === seed.userId && item.visibility === "personal");
    return item ? [{ item, sharedWords: [] as string[] }] : [];
  }) : relatedSavedProof(seed, savedProof);
  const allowed = [seed, ...related.map(match => match.item)];
  const sequence = storySequence(allowed, selected, seed.userId);
  async function assist(mode: "match" | "story") {
    if (!companion) return;
    pending.current?.abort(); const controller = new AbortController(); pending.current = controller; setBusy(true); setMessage("");
    try {
      if (mode === "match") {
        const matches = await semanticCompanionSearch(companion, seed.evidenceText || seed.title, savedProof.filter(item => item.id !== seed.id), controller.signal);
        if (!controller.signal.aborted) setMeaningIDs(matches.map(item => item.id));
      } else {
        const draft = await draftCompanionStory(companion, sequence, controller.signal);
        if (!controller.signal.aborted) setExcerpts(draft);
      }
    } catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "On-device assistance unavailable."); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    region.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  return <section className="proof-story" aria-labelledby="proof-story-title" ref={region} tabIndex={-1}>
    <header className="media-inbox-header"><div>
      <h2 id="proof-story-title">A story in your own words</h2>
      <p>Your chosen notes, ordered by their saved dates. No rewritten memories, invented transitions, or explanation of how you should feel.</p>
    </div><button className="text-button" onClick={onClose}>Close story</button></header>
    {companion && <div className="story-tools">
      {companion.semantic && <button className="secondary-button" disabled={busy} onClick={() => void assist("match")}>Find related Proof by meaning on this Mac</button>}
      {companion.story && <button className="secondary-button" disabled={busy} onClick={() => void assist("story")}>Draft a short reading on this Mac</button>}
      {busy && <button className="text-button" onClick={() => pending.current?.abort()}>Cancel</button>}
      <p className="media-guidance">Optional on-device text only. Meaning matching uses saved Proof; drafting uses the notes you select below. No photos, ordinary memories, or pending items are sent. No cloud fallback.</p>
    </div>}
    {message && <p role="status">{message}</p>}
    {excerpts.length > 0 && <aside className="source-reading" aria-label="Source-backed reading draft">
      <h3>A short reading · draft, not new evidence</h3>
      {sequence.flatMap(item => excerpts.filter(excerpt => excerpt.sourceID === item.id && item.evidenceText === excerpt.exactExcerpt).map(excerpt => <p key={item.id}>
        {item.occurredOn ? `On ${formatProofDate(item.occurredOn)}` : "On an unknown date"}, {item.source ? `the saved source “${item.source}” records` : "your saved note records"}: <q>{excerpt.exactExcerpt}</q>
      </p>))}
      <p className="media-guidance">Full notes selected on-device; dates and sources copied from your saved items. Full context is preserved. Nothing was rewritten or saved as new Proof.</p>
    </aside>}
    <details className="story-connections">
      <summary>Add a related saved moment ({related.length})</summary>
      <p>{meaningIDs ? "On-device meaning matching" : "Shared words"} suggests a connection; you decide whether these belong together. No other memories or pending photos are searched.</p>
      {related.map(({ item, sharedWords }) => <label className="checkbox-row" key={item.id}>
        <input type="checkbox" checked={selected.includes(item.id)} onChange={e => setSelected(current => e.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} />
        <span>{item.title}<small>{formatProofDate(item.occurredOn)} · {item.source ?? "Source: MISSING"} · {meaningIDs ? "On-device meaning match" : `Shared words: ${sharedWords.join(", ")}`}</small></span>
      </label>)}
      {related.length === 0 && <p>No shared-word matches. This moment can stand on its own.</p>}
    </details>
    <ol className="story-sequence">{sequence.map(item => <li key={item.id}>
      <article>
        <p className="story-date">{item.occurredOn ? formatProofDate(item.occurredOn) : "Date unknown · not placed in the timeline"}</p>
        {item.imagePath && item.imageUrl && <ProofMedia url={item.imageUrl} type={item.mediaType} title={item.title} />}
        {!item.imageUrl && item.imagePath && <p>Attachment saved · preview unavailable.</p>}
        {companionLabel(item.provenance) && <p className="media-guidance">{companionLabel(item.provenance)}</p>}
        <h3>{item.title}</h3>
        {item.evidenceText ? <blockquote>{item.evidenceText}</blockquote> : <p>No note added. The attachment remains the evidence.</p>}
        <p className="story-source">Source: {item.source ?? "MISSING"}</p>
      </article>
    </li>)}</ol>
    <p className="media-guidance">A reading view of saved Proof, not a new evidence item. You can change the notes using Edit in the gallery.</p>
  </section>;
}
