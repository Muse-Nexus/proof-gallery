import { isProofCategory, normalizeTags } from "./proof";
import { LOCAL_MEDIA_TYPES } from "./media";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function timestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value;
}

/** Historical source context only; it neither identifies a person nor grants access. */
export function getTrustedSourceContext(provenance: Record<string, unknown>): string {
  const value = provenance.import_receipt;
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const receipt = value as Record<string, unknown>;
  if (receipt.method !== "trusted_folder" ||
      typeof receipt.source_id !== "string" || !UUID.test(receipt.source_id) ||
      typeof receipt.source_revision !== "string" || !UUID.test(receipt.source_revision) ||
      typeof receipt.source_label !== "string" || !receipt.source_label.trim() || receipt.source_label.length > 200 ||
      !timestamp(receipt.source_approved_at) || !timestamp(receipt.automatically_saved_at) ||
      typeof receipt.original_filename !== "string" || !receipt.original_filename || receipt.original_filename.length > 1024 ||
      typeof receipt.mime_type !== "string" || !LOCAL_MEDIA_TYPES.has(receipt.mime_type) ||
      typeof receipt.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(receipt.sha256) ||
      !isProofCategory(receipt.source_category) || !Array.isArray(receipt.source_tags) || receipt.source_tags.length > 30 ||
      !receipt.source_tags.every((tag): tag is string => typeof tag === "string" && tag.length > 0 && tag.length <= 80) ||
      JSON.stringify(normalizeTags(receipt.source_tags)) !== JSON.stringify(receipt.source_tags)) return "";
  return receipt.source_label;
}
