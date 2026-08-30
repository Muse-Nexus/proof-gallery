import {
  categoryLabel,
  formatProofDate,
  sourceTypeLabel,
  type ProofItem,
} from "../lib/proof";
import { ProofMedia } from "./ProofMedia";
import { validateCompanionReceipt } from "../lib/companion-package";

function companionLabel(provenance: ProofItem["provenance"]): string | null {
  const receipt = provenance.import_receipt;
  if (!receipt || typeof receipt !== "object" || !("method" in receipt) || receipt.method !== "mac_photos_companion") return null;
  try {
    const source = validateCompanionReceipt("companion" in receipt ? receipt.companion : null);
    return `${provenance.import_attachment_changed ? "Historical import (attachment since changed): " : ""}${source.representation === "jpeg-preview" ? "JPEG preview · original remains in Apple Photos" : "Original photo bytes from Apple Photos"}. Imported date source: Photos metadata.`;
  } catch { return "Companion source metadata unavailable. Do not assume this attachment is the original."; }
}

export function ProofCard({
  item,
  onEdit,
  onDelete,
  disabled = false,
}: {
  item: ProofItem;
  onEdit: (item: ProofItem) => void;
  onDelete: (item: ProofItem) => void;
  disabled?: boolean;
}) {
  const hasEvidenceAttachment = Boolean(item.imagePath);
  const hasEvidencePreview = Boolean(item.imagePath && item.imageUrl);
  const importedMediaLabel = companionLabel(item.provenance);

  return (
    <article
      className={`proof-card proof-card--${
        hasEvidencePreview
          ? "with-image"
          : hasEvidenceAttachment
            ? "preview-unavailable"
            : "text-only"
      } proof-card--${item.category}`}
    >
      {hasEvidencePreview ? (
        <figure className="proof-evidence-media">
          <ProofMedia url={item.imageUrl!} type={item.mediaType} title={item.title} />
          <figcaption>Evidence attachment</figcaption>
        </figure>
      ) : hasEvidenceAttachment ? (
        <div className="proof-preview-unavailable">
          <span>Evidence attachment saved</span>
          <strong>Preview unavailable</strong>
          <p>The image remains attached, but its preview could not be loaded right now.</p>
          <span className="proof-text-cover-shapes" aria-hidden="true" />
        </div>
      ) : (
        <div className="proof-text-cover">
          <span>Text-only Proof</span>
          <strong>No image attached</strong>
          <span className="proof-text-cover-shapes" aria-hidden="true" />
        </div>
      )}
      <dl className="proof-receipt" aria-label="Evidence receipt">
        <div>
          <dt>Occurred</dt>
          <dd>
            {item.occurredOn ? (
              <time dateTime={item.occurredOn}>
                {formatProofDate(item.occurredOn)}
              </time>
            ) : (
              "MISSING"
            )}
          </dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>
            {item.source || "MISSING"}
            <small>{sourceTypeLabel(item.sourceType)}</small>
          </dd>
        </div>
      </dl>
      {importedMediaLabel && <p className="media-guidance">{importedMediaLabel}</p>}
      <div className="proof-card-body">
        <div className="card-heading-row">
          <span className="category-pill">{categoryLabel(item.category)}</span>
        </div>
        <h2>{item.title}</h2>
        {item.evidenceText ? <blockquote>{item.evidenceText}</blockquote> : <p className="media-guidance">No note added. The attachment is the evidence.</p>}
        {(item.person || item.project) && (
          <dl className="proof-meta">
            {item.person && (
              <div>
                <dt>Person</dt>
                <dd>{item.person}</dd>
              </div>
            )}
            {item.project && (
              <div>
                <dt>Project</dt>
                <dd>{item.project}</dd>
              </div>
            )}
          </dl>
        )}
        {item.tags.length > 0 && (
          <ul className="tag-list" aria-label="Tags">
            {item.tags.map((tag) => (
              <li key={tag}>#{tag}</li>
            ))}
          </ul>
        )}
        <div className="card-actions">
          <button type="button" className="secondary-button" disabled={disabled} onClick={() => onEdit(item)}>
            Edit
          </button>
          <button type="button" className="danger-button" disabled={disabled} onClick={() => onDelete(item)}>
            Delete
          </button>
        </div>
      </div>
    </article>
  );
}
