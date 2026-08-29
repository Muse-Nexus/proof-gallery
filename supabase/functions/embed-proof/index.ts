import { authenticate } from "../_shared/auth.ts";
import { embeddingsConfigured, embedText } from "../_shared/embedding.ts";
import { errorReceipt, json, preflight } from "../_shared/http.ts";

type ProofRow = {
  id: string;
  title: string;
  evidence_text: string;
  category: string;
  source: string | null;
  tags: string[] | null;
  person: string | null;
  project: string | null;
  updated_at: string;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;
  if (request.method !== "POST") {
    return json(request, { error: "Method not allowed" }, 405);
  }

  try {
    const { client, user } = await authenticate(request);
    let id = "";
    try {
      const body: unknown = await request.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw new Error("INVALID_BODY");
      }
      id = String((body as Record<string, unknown>).id ?? "").trim();
    } catch {
      return json(
        request,
        { error: "Request body must be a JSON object" },
        400,
      );
    }
    if (!UUID.test(id)) {
      return json(request, { error: "Invalid Proof id" }, 400);
    }

    const { data, error } = await client
      .from("proof_items")
      .select(
        "id,title,evidence_text,category,source,tags,person,project,updated_at",
      )
      .eq("id", id)
      .eq("user_id", user.id)
      .eq("visibility", "personal")
      .maybeSingle();
    if (error) throw error;
    if (!data) return json(request, { error: "Proof item not found" }, 404);

    if (!embeddingsConfigured()) {
      return json(request, { semantic_ready: false, reason: "not_configured" });
    }
    const { data: slotAllowed, error: slotError } = await client.rpc(
      "claim_proof_embedding_slot",
    );
    if (slotError || slotAllowed !== true) {
      return json(request, { semantic_ready: false, reason: "rate_limited" });
    }

    const row = data as ProofRow;
    const text = [
      row.title,
      row.evidence_text,
      row.category,
      row.source,
      ...(row.tags ?? []),
      row.person,
      row.project,
    ]
      .filter((value): value is string => Boolean(value))
      .join("\n");
    const embedding = await embedText(text);
    if (!embedding) {
      return json(request, { semantic_ready: false, reason: "not_configured" });
    }

    const { data: updated, error: updateError } = await client
      .from("proof_items")
      .update({
        embedding: JSON.stringify(embedding.vector),
        embedding_model: embedding.model,
        embedding_dimensions: embedding.dimensions,
      })
      .eq("id", id)
      .eq("user_id", user.id)
      .eq("visibility", "personal")
      .eq("updated_at", row.updated_at)
      .select("id")
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updated) {
      return json(
        request,
        { semantic_ready: false, reason: "changed_during_indexing" },
        409,
      );
    }

    return json(request, {
      semantic_ready: true,
      model: embedding.model,
      dimensions: embedding.dimensions,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return json(request, { error: "Authentication required" }, 401);
    }
    console.error("[embed-proof] failed", errorReceipt(error));
    return json(request, { error: "Proof indexing failed" }, 500);
  }
});
