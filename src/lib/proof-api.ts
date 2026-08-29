import type { User } from "@supabase/supabase-js";
import {
  EMPTY_PROOF_FILTERS,
  PROOF_VISIBILITY,
  isProofCategory,
  isProofSourceType,
  normalizeTags,
  safeImageName,
  validateProofImage,
  type ProofFilters,
  type ProofItem,
  type ProofItemInput,
} from "./proof";
import { getSupabase } from "./supabase";

const PROOF_SELECT = [
  "id",
  "user_id",
  "title",
  "evidence_text",
  "occurred_on",
  "category",
  "source",
  "tags",
  "person",
  "project",
  "image_path",
  "provenance",
  "visibility",
  "created_at",
  "updated_at",
].join(",");

type ProofRow = {
  id: string;
  user_id: string;
  title: string;
  evidence_text: string;
  occurred_on: string | null;
  category: string;
  source: string | null;
  tags: unknown;
  person: string | null;
  project: string | null;
  image_path: string | null;
  provenance: unknown;
  visibility: string;
  created_at: string;
  updated_at: string;
  relevance?: number | string | null;
  similarity?: number | string | null;
};

export type ProofSearchResult = {
  items: ProofItem[];
  semanticDegraded: boolean;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function optional(value: string | null | undefined): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function payload(input: ProofItemInput) {
  const title = input.title.trim();
  const evidenceText = input.evidenceText.trim();
  const source = optional(input.source);

  if (!title || !evidenceText) {
    throw new Error("Title and evidence are required");
  }
  if (!isProofSourceType(input.sourceType)) {
    throw new Error("Choose a valid Proof source type");
  }
  if (
    input.tags.some(
      (tag) => tag.trim().replace(/^#+/, "").toLowerCase().length > 80,
    )
  ) {
    throw new Error("Each Proof tag must be 80 characters or fewer");
  }

  return {
    title,
    evidence_text: evidenceText,
    occurred_on: optional(input.occurredOn),
    category: input.category,
    source,
    tags: normalizeTags(input.tags),
    person: optional(input.person),
    project: optional(input.project),
    provenance: {
      kind: "manual",
      captured_via: "proof_gallery",
      source_type: input.sourceType,
      ...(source ? { source } : {}),
    },
    visibility: PROOF_VISIBILITY,
  };
}

async function signedImageUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  try {
    const { data, error } = await getSupabase()
      .storage.from("proof-images")
      .createSignedUrl(path, 60 * 60);
    if (error) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

async function mapRow(row: ProofRow): Promise<ProofItem> {
  if (!isProofCategory(row.category)) {
    throw new Error(`Unsupported Proof category: ${row.category}`);
  }
  if (row.visibility !== PROOF_VISIBILITY) {
    throw new Error("Proof Gallery refused a non-private item");
  }

  const tags = Array.isArray(row.tags)
    ? row.tags.filter((tag): tag is string => typeof tag === "string")
    : [];
  const provenance = asRecord(row.provenance);
  const sourceType = isProofSourceType(provenance.source_type)
    ? provenance.source_type
    : "other";
  const rawRelevance = row.relevance ?? row.similarity ?? null;
  const relevance =
    rawRelevance === null || rawRelevance === ""
      ? null
      : Number(rawRelevance);

  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    evidenceText: row.evidence_text,
    occurredOn: row.occurred_on,
    category: row.category,
    sourceType,
    source: row.source,
    tags: normalizeTags(tags),
    person: row.person,
    project: row.project,
    imagePath: row.image_path,
    imageUrl: await signedImageUrl(row.image_path),
    provenance,
    visibility: PROOF_VISIBILITY,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    relevance: Number.isFinite(relevance) ? relevance : null,
  };
}

async function mapRows(rows: ProofRow[]): Promise<ProofItem[]> {
  return Promise.all(rows.map(mapRow));
}

async function requireUser(): Promise<User> {
  const {
    data: { user },
    error,
  } = await getSupabase().auth.getUser();
  if (error || !user) throw new Error("You must be signed in");
  return user;
}

async function uploadImage(user: User, file: File): Promise<string> {
  await validateProofImage(file);
  const path = `${user.id}/${safeImageName(file.type)}`;
  const { error } = await getSupabase()
    .storage.from("proof-images")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return path;
}

async function removeImage(path: string | null): Promise<void> {
  if (!path) return;
  const { error } = await getSupabase()
    .storage.from("proof-images")
    .remove([path]);
  if (error) throw error;
}

async function requestEmbedding(id: string): Promise<boolean> {
  try {
    const { data, error } = await getSupabase().functions.invoke("embed-proof", {
      body: { id },
    });
    if (error) return false;
    const response = asRecord(data);
    return response.semantic_ready === true;
  } catch {
    return false;
  }
}

async function failAfterUpload(
  imagePath: string | null,
  originalError: unknown,
): Promise<never> {
  try {
    await removeImage(imagePath);
  } catch {
    const message =
      originalError instanceof Error ? originalError.message : "Proof write failed";
    throw new Error(
      `${message}. The private upload also could not be removed; follow the cleanup recovery guide.`,
      { cause: originalError },
    );
  }
  throw originalError;
}

export async function listProofItems(
  filters: ProofFilters = EMPTY_PROOF_FILTERS,
): Promise<ProofItem[]> {
  const user = await requireUser();
  let query = getSupabase()
    .from("proof_items")
    .select(PROOF_SELECT)
    .eq("user_id", user.id)
    .eq("visibility", PROOF_VISIBILITY);

  if (filters.category) query = query.eq("category", filters.category);
  if (filters.tag) query = query.contains("tags", normalizeTags([filters.tag]));

  const { data, error } = await query
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return mapRows((data ?? []) as unknown as ProofRow[]);
}

export async function createProofItem(
  input: ProofItemInput,
  image: File | null,
): Promise<{ item: ProofItem; semanticReady: boolean }> {
  const user = await requireUser();
  const imagePath = image ? await uploadImage(user, image) : null;

  let row: ProofRow;
  try {
    const { data, error } = await getSupabase()
      .from("proof_items")
      .insert({ ...payload(input), user_id: user.id, image_path: imagePath })
      .select(PROOF_SELECT)
      .single();
    if (error) throw error;
    row = data as unknown as ProofRow;
  } catch (error) {
    return failAfterUpload(imagePath, error);
  }

  const item = await mapRow(row);
  return { item, semanticReady: await requestEmbedding(item.id) };
}

export async function updateProofItem(
  existing: ProofItem,
  input: ProofItemInput,
  image: File | null,
  removeExistingImage: boolean,
): Promise<{ item: ProofItem; semanticReady: boolean; cleanupFailed: boolean }> {
  const user = await requireUser();
  const newImagePath = image ? await uploadImage(user, image) : null;
  const nextImagePath = image
    ? newImagePath
    : removeExistingImage
      ? null
      : existing.imagePath;

  let row: ProofRow;
  try {
    let query = getSupabase()
      .from("proof_items")
      .update({
        ...payload(input),
        image_path: nextImagePath,
        embedding: null,
        embedding_model: null,
        embedding_dimensions: null,
      })
      .eq("id", existing.id)
      .eq("user_id", user.id)
      .eq("visibility", PROOF_VISIBILITY);
    query = existing.imagePath
      ? query.eq("image_path", existing.imagePath)
      : query.is("image_path", null);
    const { data, error } = await query.select(PROOF_SELECT).maybeSingle();
    if (error) throw error;
    if (!data) {
      throw new Error("Proof changed in another tab. Reload before editing it.");
    }
    row = data as unknown as ProofRow;
  } catch (error) {
    return failAfterUpload(newImagePath, error);
  }

  const item = await mapRow(row);
  let cleanupFailed = false;
  if (existing.imagePath && existing.imagePath !== nextImagePath) {
    try {
      await removeImage(existing.imagePath);
    } catch {
      cleanupFailed = true;
    }
  }
  return {
    item,
    semanticReady: await requestEmbedding(item.id),
    cleanupFailed,
  };
}

export async function deleteProofItem(
  item: ProofItem,
): Promise<{ cleanupFailed: boolean }> {
  const user = await requireUser();
  let query = getSupabase()
    .from("proof_items")
    .delete()
    .eq("id", item.id)
    .eq("user_id", user.id)
    .eq("visibility", PROOF_VISIBILITY);
  query = item.imagePath
    ? query.eq("image_path", item.imagePath)
    : query.is("image_path", null);
  const { data, error } = await query.select("id").maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new Error("Proof changed in another tab. Reload before deleting it.");
  }

  let cleanupFailed = false;
  try {
    await removeImage(item.imagePath);
  } catch {
    cleanupFailed = true;
  }
  return { cleanupFailed };
}

export async function searchProofItems(
  query: string,
  filters: ProofFilters = EMPTY_PROOF_FILTERS,
): Promise<ProofSearchResult> {
  const trimmed = query.trim();
  if (trimmed.length < 3) throw new Error("Search needs at least 3 characters");

  const { data, error } = await getSupabase().functions.invoke("proof-search", {
    body: {
      query: trimmed,
      limit: 10,
      ...(filters.category ? { category: filters.category } : {}),
      ...(filters.tag ? { tag: normalizeTags([filters.tag])[0] } : {}),
    },
  });
  if (error) throw error;
  const response = asRecord(data);
  if (response.error) throw new Error(String(response.error));
  const rows = Array.isArray(response.items) ? response.items : [];
  return {
    items: await mapRows(rows as ProofRow[]),
    semanticDegraded: response.semantic_degraded === true,
  };
}
