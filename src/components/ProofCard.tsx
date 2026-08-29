import {
  categoryLabel,
  formatProofDate,
  sourceTypeLabel,
  type ProofItem,
} from "../lib/proof";

export function ProofCard({
  item,
  onEdit,
  onDelete,
}: {
  item: ProofItem;
  onEdit: (item: ProofItem) => void;
  onDelete: (item: ProofItem) => void;
}) {
  return (
    <article className="proof-card">
      {item.imageUrl && (
        <img
          src={item.imageUrl}
          alt="Attached evidence"
          className="proof-image"
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      )}
      <div className="proof-card-body">
        <div className="card-heading-row">
          <span className="category-pill">{categoryLabel(item.category)}</span>
          {item.occurredOn ? (
            <time dateTime={item.occurredOn}>{formatProofDate(item.occurredOn)}</time>
          ) : (
            <span>Occurred: MISSING</span>
          )}
        </div>
        <h2>{item.title}</h2>
        <blockquote>{item.evidenceText}</blockquote>
        <dl className="proof-meta">
          <div>
            <dt>Source type</dt>
            <dd>{sourceTypeLabel(item.sourceType)}</dd>
          </div>
          <div>
            <dt>Source detail</dt>
            <dd>{item.source || "MISSING"}</dd>
          </div>
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
        {item.tags.length > 0 && (
          <ul className="tag-list" aria-label="Tags">
            {item.tags.map((tag) => (
              <li key={tag}>#{tag}</li>
            ))}
          </ul>
        )}
        <div className="card-actions">
          <button type="button" className="secondary-button" onClick={() => onEdit(item)}>
            Edit
          </button>
          <button type="button" className="danger-button" onClick={() => onDelete(item)}>
            Delete
          </button>
        </div>
      </div>
    </article>
  );
}
