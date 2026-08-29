import {
  isUsableEmbeddingVector,
  resolveEmbeddingProvider,
} from "./embedding-provider.ts";

export type EmbeddingResult = {
  vector: number[];
  model: string;
  dimensions: number;
};

function provider() {
  return resolveEmbeddingProvider((name) => Deno.env.get(name));
}

export function embeddingsConfigured(): boolean {
  return provider() !== null;
}

export async function embedText(text: string): Promise<EmbeddingResult | null> {
  const configuredProvider = provider();
  if (!configuredProvider) return null;

  const model = Deno.env.get("EMBEDDING_MODEL")?.trim() ||
    "text-embedding-3-small";
  const requestedDimensions = Number(
    Deno.env.get("EMBEDDING_DIMENSIONS")?.trim() || "0",
  );
  const body: Record<string, unknown> = {
    model,
    input: text.slice(0, 24_000),
    encoding_format: "float",
  };
  if (
    Number.isInteger(requestedDimensions) &&
    requestedDimensions > 0 &&
    requestedDimensions <= 4096
  ) {
    body.dimensions = requestedDimensions;
  }

  const response = await fetch(configuredProvider.url, {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
    headers: {
      "Content-Type": "application/json",
      ...(configuredProvider.apiKey
        ? { Authorization: `Bearer ${configuredProvider.apiKey}` }
        : {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`EMBEDDING_PROVIDER_${response.status}`);
  }

  const payload: unknown = await response.json();
  const vector = payload &&
      typeof payload === "object" &&
      "data" in payload &&
      Array.isArray(payload.data) &&
      payload.data[0] &&
      typeof payload.data[0] === "object" &&
      "embedding" in payload.data[0] &&
      Array.isArray(payload.data[0].embedding)
    ? payload.data[0].embedding
    : null;
  if (!isUsableEmbeddingVector(vector)) {
    throw new Error("EMBEDDING_PROVIDER_INVALID_VECTOR");
  }

  return { vector, model, dimensions: vector.length };
}
