export const PROOF_VISIBILITY = "personal" as const;

export const PROOF_CATEGORIES = [
  { value: "belonging", label: "Belonging" },
  { value: "competence", label: "Competence" },
  { value: "creativity", label: "Creativity" },
  { value: "parenting", label: "Parenting" },
  { value: "recovery", label: "Recovery" },
  { value: "money", label: "Money" },
  { value: "shipped", label: "Shipped" },
  { value: "awards", label: "Awards" },
  { value: "kindness_received", label: "Kindness received" },
] as const;

export type ProofCategory = (typeof PROOF_CATEGORIES)[number]["value"];
export type ProofSort = "newest" | "relevance";

export interface ProofItem {
  id: string;
  userId: string;
  title: string;
  evidenceText: string;
  occurredOn: string | null;
  category: ProofCategory;
  source: string | null;
  tags: string[];
  person: string | null;
  project: string | null;
  imagePath: string | null;
  imageUrl: string | null;
  provenance: Record<string, unknown>;
  visibility: typeof PROOF_VISIBILITY;
  createdAt: string;
  updatedAt: string;
  relevance: number | null;
}

export interface ProofItemInput {
  title: string;
  evidenceText: string;
  occurredOn: string | null;
  category: ProofCategory;
  source: string | null;
  tags: string[];
  person: string | null;
  project: string | null;
}

export interface ProofFilters {
  category: ProofCategory | null;
  tag: string | null;
}

export const EMPTY_PROOF_FILTERS: ProofFilters = {
  category: null,
  tag: null,
};

export const PROOF_CONSTITUTION =
  "Proof does not cancel pain or demand optimism. It restores concrete evidence you chose to save.";

const categoryValues = new Set<string>(
  PROOF_CATEGORIES.map((category) => category.value),
);

export function isProofCategory(value: unknown): value is ProofCategory {
  return typeof value === "string" && categoryValues.has(value);
}

export function categoryLabel(category: ProofCategory): string {
  return (
    PROOF_CATEGORIES.find((candidate) => candidate.value === category)?.label ??
    category
  );
}

export function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const tag of tags) {
    const value = tag.trim().replace(/^#+/, "").toLowerCase();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }

  return normalized.slice(0, 30);
}

export function parseTags(value: string): string[] {
  return normalizeTags(value.split(","));
}

export function formatProofDate(value: string | null | undefined): string {
  if (!value) return "MISSING";
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const parsed = dateOnly
    ? new Date(
        Date.UTC(
          Number(dateOnly[1]),
          Number(dateOnly[2]) - 1,
          Number(dateOnly[3]),
        ),
      )
    : new Date(value);

  if (Number.isNaN(parsed.getTime())) return "MISSING";

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: dateOnly ? "UTC" : undefined,
  }).format(parsed);
}

export function sortProofItems(
  items: readonly ProofItem[],
  sort: ProofSort,
): ProofItem[] {
  return [...items].sort((left, right) => {
    if (sort === "relevance") {
      const difference = (right.relevance ?? 0) - (left.relevance ?? 0);
      if (difference !== 0) return difference;
    }

    const rightDate = right.occurredOn
      ? Date.parse(right.occurredOn)
      : Number.NaN;
    const leftDate = left.occurredOn ? Date.parse(left.occurredOn) : Number.NaN;
    const rightHasDate = Number.isFinite(rightDate);
    const leftHasDate = Number.isFinite(leftDate);

    if (rightHasDate !== leftHasDate) return leftHasDate ? -1 : 1;
    if (rightHasDate && leftHasDate && rightDate !== leftDate) {
      return rightDate - leftDate;
    }

    return Date.parse(right.createdAt) - Date.parse(left.createdAt);
  });
}

const SAFE_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

function detectedImageType(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (value, index) => bytes[index] === value,
    )
  ) {
    return "image/png";
  }
  const ascii = new TextDecoder().decode(bytes);
  if (ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a")) {
    return "image/gif";
  }
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}

export async function validateProofImage(file: File): Promise<void> {
  if (!SAFE_IMAGE_TYPES.has(file.type)) {
    throw new Error("Proof attachments must be JPEG, PNG, WebP, or GIF images");
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error("Proof images must be 10 MB or smaller");
  }
  const signature = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (detectedImageType(signature) !== file.type) {
    throw new Error("The image contents do not match its file type");
  }
}

export function safeImageName(mimeType: string): string {
  const extension: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
  };
  return `${crypto.randomUUID()}${extension[mimeType] ?? ".img"}`;
}
