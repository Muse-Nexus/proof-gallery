import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
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
  const dialogRef = useRef<HTMLElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    titleInputRef.current?.focus();
    return () => previouslyFocused?.focus();
  }, []);

  function handleDialogKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

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
    item?.imagePath && item.imageUrl ? item.imageUrl : null;
  const existingPreviewUnavailable = Boolean(
    item?.imagePath && !item.imageUrl,
  );

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="editor-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="editor-title"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={handleDialogKeyDown}
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
            <input ref={titleInputRef} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} required />
          </label>
          <label className="full-width evidence-image-field">
            Evidence image or screenshot <span className="optional">optional · JPEG, PNG, WebP, or GIF · 10 MB max</span>
            <span className="field-guidance">
              Attach only an image that is part of this evidence. Decorative
              landing visuals are never attached automatically.
            </span>
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
            <div
              className={`image-preview full-width${
                removeExistingImage ? " image-preview--removing" : ""
              }`}
            >
              <div className="image-preview-label">Current evidence attachment</div>
              <img
                src={existingPreview}
                alt={`Current evidence image for ${item?.title ?? "this Proof"}`}
                referrerPolicy="no-referrer"
              />
              {item?.imagePath && (
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={removeExistingImage}
                    onChange={(event) => setRemoveExistingImage(event.target.checked)}
                  />
                  Remove this evidence image
                </label>
              )}
            </div>
          )}
          {existingPreviewUnavailable && !image && (
            <div className="image-preview-unavailable full-width" role="status">
              <strong>
                {removeExistingImage
                  ? "Evidence attachment marked for removal"
                  : "Evidence attachment saved · preview unavailable"}
              </strong>
              <span>
                The saved image could not be previewed right now. This does not
                mean the attachment is missing.
              </span>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={removeExistingImage}
                  onChange={(event) => setRemoveExistingImage(event.target.checked)}
                />
                Remove this evidence image
              </label>
            </div>
          )}
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
