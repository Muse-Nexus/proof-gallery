import { useEffect, useRef, useState } from "react";
import { formatProofDate, type ProofItem } from "../lib/proof";
import { relatedSavedProof, storySequence } from "../lib/note-assist";
import { ProofMedia } from "./ProofMedia";
import { companionLabel } from "./ProofCard";

export function ProofStory({ seed, savedProof, onClose }: {
  seed: ProofItem; savedProof: readonly ProofItem[]; onClose: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([seed.id]);
  const region = useRef<HTMLElement>(null);
  const related = relatedSavedProof(seed, savedProof);
  const allowed = [seed, ...related.map(match => match.item)];
  const sequence = storySequence(allowed, selected, seed.userId);
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
    <details className="story-connections">
      <summary>Add a related saved moment ({related.length})</summary>
      <p>Shared words suggest a connection; you decide whether these belong together. No other memories or pending photos are searched.</p>
      {related.map(({ item, sharedWords }) => <label className="checkbox-row" key={item.id}>
        <input type="checkbox" checked={selected.includes(item.id)} onChange={e => setSelected(current => e.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} />
        <span>{item.title}<small>{formatProofDate(item.occurredOn)} · {item.source ?? "Source: MISSING"} · Shared words: {sharedWords.join(", ")}</small></span>
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
