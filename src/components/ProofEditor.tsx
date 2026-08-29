import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  PROOF_CATEGORIES,
  parseTags,
  type ProofCategory,
  type ProofItem,
  type ProofItemInput,
} from "../lib/proof";

type EditorResult = {
  input: ProofItemInput;
  image: File | null;
  removeExistingImage: boolean;
};

export function ProofEditor({
  item,
  busy,
  onClose,
  onSave,
}: {
  item: ProofItem | null;
  busy: boolean;
  onClose: () => void;
  onSave: (result: EditorResult) => Promise<void>;
}) {
  const [title, setTitle] = useState(item?.title ?? "");
  const [evidenceText, setEvidenceText] = useState(item?.evidenceText ?? "");
  const [occurredOn, setOccurredOn] = useState(item?.occurredOn ?? "");
  const [category, setCategory] = useState<ProofCategory>(
    item?.category ?? "belonging",
  );
  const [source, setSource] = useState(item?.source ?? "");
  const [tags, setTags] = useState(item?.tags.join(", ") ?? "");
  const [person, setPerson] = useState(item?.person ?? "");
  const [project, setProject] = useState(item?.project ?? "");
  const [image, setImage] = useState<File | null>(null);
  const [removeExistingImage, setRemoveExistingImage] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useMemo(
    () => (image ? URL.createObjectURL(image) : null),
    [image],
  );
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await onSave({
        input: {
          title,
          evidenceText,
          occurredOn: occurredOn || null,
          category,
          source: source || null,
          tags: parseTags(tags),
          person: person || null,
          project: project || null,
        },
        image,
        removeExistingImage,
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Proof could not be saved");
    }
  }

  const existingPreview =
    item?.imageUrl && !removeExistingImage ? item.imageUrl : null;

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="editor-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="editor-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="editor-header">
          <div>
            <span className="privacy-badge">Private · only you</span>
            <h2 id="editor-title">{item ? "Edit Proof" : "Add Proof"}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close editor">
            ×
          </button>
        </header>
        <form className="editor-form" onSubmit={submit}>
          <label>
            Title
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} required />
          </label>
          <label className="full-width">
            Exact quote or evidence
            <textarea
              value={evidenceText}
              onChange={(event) => setEvidenceText(event.target.value)}
              rows={5}
              maxLength={20_000}
              required
            />
          </label>
          <label>
            Occurred date
            <input type="date" value={occurredOn} onChange={(event) => setOccurredOn(event.target.value)} />
          </label>
          <label>
            Category
            <select value={category} onChange={(event) => setCategory(event.target.value as ProofCategory)}>
              {PROOF_CATEGORIES.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            Source or provenance
            <input value={source} onChange={(event) => setSource(event.target.value)} maxLength={500} placeholder="Email, message, receipt, photo…" />
          </label>
          <label>
            Tags
            <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="launch, family, client" />
          </label>
          <label>
            Person <span className="optional">optional</span>
            <input value={person} onChange={(event) => setPerson(event.target.value)} maxLength={200} />
          </label>
          <label>
            Project <span className="optional">optional</span>
            <input value={project} onChange={(event) => setProject(event.target.value)} maxLength={200} />
          </label>
          <label className="full-width">
            Image or screenshot <span className="optional">optional · JPEG, PNG, WebP, or GIF · 10 MB max</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={(event) => {
                setImage(event.target.files?.[0] ?? null);
                if (event.target.files?.[0]) setRemoveExistingImage(false);
              }}
            />
          </label>
          {(preview || existingPreview) && (
            <div className="image-preview full-width">
              <img src={preview ?? existingPreview ?? ""} alt="Proof attachment preview" />
              {item?.imagePath && !image && (
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={removeExistingImage}
                    onChange={(event) => setRemoveExistingImage(event.target.checked)}
                  />
                  Remove this image
                </label>
              )}
            </div>
          )}
          {error && <p className="error-banner full-width">{error}</p>}
          <footer className="editor-actions full-width">
            <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="primary-button" disabled={busy}>{busy ? "Saving…" : "Save Proof"}</button>
          </footer>
        </form>
      </section>
    </div>
  );
}
