import { useState, type ChangeEvent, type FormEvent } from "react";
import {
  PROOF_CATEGORIES,
  PROOF_SOURCE_TYPES,
  parseTags,
  validateProofImage,
  type ProofCategory,
  type ProofItem,
  type ProofItemInput,
  type ProofSourceType,
} from "../lib/proof";

type EditorResult = {
  input: ProofItemInput;
  image: File | null;
  removeExistingImage: boolean;
};

export function ProofEditor({
  item,
  busy,
  privacyLabel = "Private · only you",
  onClose,
  onSave,
}: {
  item: ProofItem | null;
  busy: boolean;
  privacyLabel?: string;
  onClose: () => void;
  onSave: (result: EditorResult) => Promise<void>;
}) {
  const [title, setTitle] = useState(item?.title ?? "");
  const [evidenceText, setEvidenceText] = useState(item?.evidenceText ?? "");
  const [occurredOn, setOccurredOn] = useState(item?.occurredOn ?? "");
  const [category, setCategory] = useState<ProofCategory>(
    item?.category ?? "belonging",
  );
  const [sourceType, setSourceType] = useState<ProofSourceType>(
    item?.sourceType ?? "other",
  );
  const [source, setSource] = useState(item?.source ?? "");
  const [tags, setTags] = useState(item?.tags.join(", ") ?? "");
  const [person, setPerson] = useState(item?.person ?? "");
  const [project, setProject] = useState(item?.project ?? "");
  const [image, setImage] = useState<File | null>(null);
  const [removeExistingImage, setRemoveExistingImage] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function selectImage(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setError(null);

    if (!selected) {
      setImage(null);
      return;
    }

    try {
      await validateProofImage(selected);
      setImage(selected);
      setRemoveExistingImage(false);
    } catch (selectionError) {
      event.target.value = "";
      setImage(null);
      setError(
        selectionError instanceof Error
          ? selectionError.message
          : "The selected image could not be validated",
      );
    }
  }

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
          sourceType,
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
            <span className="privacy-badge">{privacyLabel}</span>
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
            <input
              type="date"
              value={occurredOn}
              onInput={(event) => setOccurredOn(event.currentTarget.value)}
              onChange={(event) => setOccurredOn(event.currentTarget.value)}
            />
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
            Source type
            <select
              value={sourceType}
              onChange={(event) => setSourceType(event.target.value as ProofSourceType)}
            >
              {PROOF_SOURCE_TYPES.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            Exact source detail <span className="optional">optional</span>
            <input value={source} onChange={(event) => setSource(event.target.value)} maxLength={500} placeholder="Sender, publication, filename, event…" />
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
              onChange={selectImage}
            />
          </label>
          {image && (
            <p className="selection-status full-width" role="status">
              Image validated and ready to save: <strong>{image.name}</strong>
            </p>
          )}
          {existingPreview && !image && (
            <div className="image-preview full-width">
              <img
                src={existingPreview}
                alt="Current Proof attachment"
                referrerPolicy="no-referrer"
              />
              {item?.imagePath && (
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
