import { authenticate } from "../_shared/auth.ts";
import { embeddingsConfigured, embedText } from "../_shared/embedding.ts";
import { errorReceipt, json, preflight } from "../_shared/http.ts";
import { fuseRows, type ProofSearchRow } from "../_shared/search.ts";

const CATEGORIES = new Set([
  "belonging",
  "competence",
  "creativity",
  "parenting",
  "recovery",
  "money",
  "shipped",
  "awards",
  "kindness_received",
]);

function normalizeLimit(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 6;
  return Math.min(10, Math.max(3, Math.floor(parsed)));
}

function normalizeCategory(value: unknown): string | null {
  if (value == null || String(value).trim() === "") return null;
  const category = String(value).trim().toLowerCase();
  if (!CATEGORIES.has(category)) throw new Error("INVALID_CATEGORY");
  return category;
}

function normalizeTag(value: unknown): string | null {
  if (value == null || String(value).trim() === "") return null;
  const tag = String(value).trim().replace(/^#+/, "").toLowerCase();
  if (!tag || tag.length > 80) throw new Error("INVALID_TAG");
  return tag;
}

Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;
  if (request.method !== "POST") {
    return json(request, { error: "Method not allowed" }, 405);
  }

  try {
    const { client } = await authenticate(request);
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("INVALID_BODY");
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return json(
        request,
        { error: "Request body must be a JSON object" },
        400,
      );
    }

    const query = String(body.query ?? "").trim();
    if (query.length < 3 || query.length > 2_000) {
      return json(request, { error: "query must be 3-2000 characters" }, 400);
    }

    let category: string | null;
    let tag: string | null;
    try {
      category = normalizeCategory(body.category);
      tag = normalizeTag(body.tag);
    } catch (error) {
      return json(
        request,
        {
          error: error instanceof Error && error.message === "INVALID_CATEGORY"
            ? "Unknown Proof category"
            : "tag must be 1-80 characters",
        },
        400,
      );
    }
    const limit = normalizeLimit(body.limit);
    const tags = tag ? [tag] : null;

    const lexicalPromise = client.rpc("search_proof_items", {
      p_query: query,
      p_limit: limit,
      p_category: category,
      p_tags: tags,
    });

    let semanticRows: ProofSearchRow[] = [];
    let semanticDegraded = true;
    if (embeddingsConfigured()) {
      const { data: slotAllowed, error: slotError } = await client.rpc(
        "claim_proof_embedding_slot",
      );
      if (!slotError && slotAllowed === true) {
        try {
          const embedding = await embedText(query);
          if (embedding) {
            const { data, error } = await client.rpc("match_proof_items", {
              query_embedding: JSON.stringify(embedding.vector),
              query_model: embedding.model,
              query_dimensions: embedding.dimensions,
              match_threshold: 0.2,
              match_count: limit,
              match_category: category,
              match_tags: tags,
            });
            if (!error) {
              semanticRows = (data ?? []) as ProofSearchRow[];
              semanticDegraded = false;
            } else {
              console.warn(
                "[proof-search] semantic RPC failed",
                errorReceipt(error),
              );
            }
          }
        } catch (error) {
          console.warn(
            "[proof-search] embedding unavailable",
            errorReceipt(error),
          );
        }
      }
    }

    const lexical = await lexicalPromise;
    if (lexical.error && semanticDegraded) {
      console.warn(
        "[proof-search] lexical RPC failed",
        errorReceipt(lexical.error),
      );
      return json(request, { error: "Proof search is unavailable" }, 503);
    }

    const fused = fuseRows(
      semanticRows,
      (lexical.data ?? []) as ProofSearchRow[],
      limit,
    );
    const items = fused.map(({ row, relevance }) => {
      const item = { ...row };
      delete item.similarity;
      delete item.relevance;
      return { ...item, relevance: Number(relevance.toFixed(8)) };
    });

    return json(request, {
      items,
      ...(semanticDegraded ? { semantic_degraded: true } : {}),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return json(request, { error: "Authentication required" }, 401);
    }
    console.error("[proof-search] failed", errorReceipt(error));
    return json(request, { error: "Proof search failed" }, 500);
  }
});
