import { validateLocalProofMedia } from "./media";

export const COMPANION_FORMAT = "muse-nexus-proof-media-candidates";
export type CompanionReceipt = {
  assetIdentifier: string;
  originalFilename: string;
  originalSha256: string;
  representation: "original" | "jpeg-preview";
  captureDate: string | null;
  timeZone: string;
  scope: string;
};
export type CompanionMedia = { file: File; occurredOn: string | null; receipt: CompanionReceipt };
const MAX_BYTES = 48 * 1024 * 1024;

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).sort().join("|") !== [...keys].sort().join("|")) {
    throw new Error("Unsupported companion review schema");
  }
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 1024): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("Invalid companion source detail");
  }
  return value;
}
function digest(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid companion SHA-256 receipt");
  return value;
}
function timestamp(value: unknown): string {
  const result = text(value, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(result) ||
    !Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) {
    throw new Error("Invalid companion timestamp");
  }
  return result;
}
export function validateCompanionReceipt(value: unknown): CompanionReceipt {
  const row = object(value, ["assetIdentifier", "originalFilename", "originalSha256", "representation", "captureDate", "timeZone", "scope"]);
  if (row.representation !== "original" && row.representation !== "jpeg-preview") throw new Error("Unsupported companion representation");
  const timeZone = text(row.timeZone, 100);
  try { new Intl.DateTimeFormat("en-US", { timeZone }); } catch { throw new Error("Invalid companion timezone"); }
  return {
    assetIdentifier: text(row.assetIdentifier, 256), originalFilename: text(row.originalFilename),
    originalSha256: digest(row.originalSha256), representation: row.representation,
    captureDate: row.captureDate === null ? null : timestamp(row.captureDate), timeZone,
    scope: text(row.scope, 160),
  };
}

/** Untrusted file, not a saved-Proof backup. No URLs, paths, models, or network. */
export async function parseCompanionPackage(blob: Blob): Promise<CompanionMedia[]> {
  if (blob.size > 64 * 1024 * 1024) throw new Error("Companion review file exceeds 64 MiB");
  let parsed: unknown;
  try { parsed = JSON.parse(await blob.text()); } catch { throw new Error("Companion review file is not valid JSON"); }
  const document = object(parsed, ["format", "version", "visibility", "encryption", "exportedAt", "items"]);
  if (document.format !== COMPANION_FORMAT || document.version !== 1 || document.visibility !== "personal" || document.encryption !== "none") {
    throw new Error("Use a private companion review file, not a saved-Proof backup");
  }
  timestamp(document.exportedAt);
  if (!Array.isArray(document.items) || !document.items.length || document.items.length > 50) throw new Error("Choose a review file containing 1–50 photos");
  const result: CompanionMedia[] = [];
  let total = 0;
  for (const item of document.items) {
    const row = object(item, ["filename", "mimeType", "base64", "sha256", "occurredOn", "receipt"]);
    const receipt = validateCompanionReceipt(row.receipt);
    const filename = text(row.filename);
    const mime = text(row.mimeType, 40);
    if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mime)) throw new Error("Unsupported companion photo type");
    if (typeof row.base64 !== "string" || !row.base64.length || row.base64.length > 14 * 1024 * 1024 || row.base64.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(row.base64)) throw new Error("Invalid companion photo bytes");
    let binary: string;
    try { binary = atob(row.base64); } catch { throw new Error("Invalid companion photo bytes"); }
    if (btoa(binary) !== row.base64) throw new Error("Noncanonical companion photo bytes");
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    total += bytes.length;
    if (total > MAX_BYTES) throw new Error("Companion review photos exceed 48 MiB");
    const file = new File([bytes], filename, { type: mime });
    await validateLocalProofMedia(file);
    const actual = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), n => n.toString(16).padStart(2, "0")).join("");
    if (actual !== digest(row.sha256) || (receipt.representation === "original" && actual !== receipt.originalSha256)) throw new Error("Companion photo integrity check failed");
    if (receipt.representation === "jpeg-preview" && mime !== "image/jpeg") throw new Error("JPEG preview must be JPEG media");
    let occurredOn: string | null = null;
    if (receipt.captureDate) {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: receipt.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(receipt.captureDate));
      const part = (type: string) => parts.find(p => p.type === type)?.value;
      occurredOn = `${part("year")}-${part("month")}-${part("day")}`;
    }
    if (row.occurredOn !== occurredOn) throw new Error("Companion date does not match Photos metadata and timezone");
    result.push({ file, occurredOn, receipt });
  }
  return result;
}
