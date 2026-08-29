import { describe, expect, it } from "vitest";
import {
  isUsableEmbeddingVector,
  resolveEmbeddingProvider,
} from "../../supabase/functions/_shared/embedding-provider";

function reader(values: Record<string, string | undefined>) {
  return (name: string) => values[name];
}

describe("embedding provider credential boundary", () => {
  it("never forwards the OpenAI key to a custom host", () => {
    expect(
      resolveEmbeddingProvider(
        reader({
          EMBEDDING_BASE_URL: "https://embeddings.example/v1/",
          EMBEDDING_API_KEY: "custom-key",
          OPENAI_API_KEY: "must-not-leave-openai",
        }),
      ),
    ).toEqual({
      url: "https://embeddings.example/v1/embeddings",
      apiKey: "custom-key",
    });
  });

  it("supports a keyless local custom endpoint", () => {
    expect(
      resolveEmbeddingProvider(
        reader({
          EMBEDDING_BASE_URL: "http://127.0.0.1:11434/v1",
          OPENAI_API_KEY: "must-not-leave-openai",
        }),
      ),
    ).toEqual({
      url: "http://127.0.0.1:11434/v1/embeddings",
      apiKey: null,
    });
  });

  it("rejects cleartext non-local and malformed custom endpoints", () => {
    expect(
      resolveEmbeddingProvider(
        reader({
          EMBEDDING_BASE_URL: "http://embeddings.example/v1",
          EMBEDDING_API_KEY: "custom-key",
        }),
      ),
    ).toBeNull();
    expect(
      resolveEmbeddingProvider(
        reader({ EMBEDDING_BASE_URL: "not a valid URL" }),
      ),
    ).toBeNull();
  });

  it("uses the OpenAI key only with the fixed OpenAI endpoint", () => {
    expect(
      resolveEmbeddingProvider(reader({ OPENAI_API_KEY: "openai-key" })),
    ).toEqual({
      url: "https://api.openai.com/v1/embeddings",
      apiKey: "openai-key",
    });
    expect(resolveEmbeddingProvider(reader({}))).toBeNull();
  });
});

describe("embedding vector integrity", () => {
  it("accepts finite non-zero vectors and rejects unstable vectors", () => {
    expect(isUsableEmbeddingVector([1, 0, 0])).toBe(true);
    expect(isUsableEmbeddingVector([0, 0, 0])).toBe(false);
    expect(isUsableEmbeddingVector([1e-8, 0, 0])).toBe(false);
    expect(isUsableEmbeddingVector([Number.NaN, 1])).toBe(false);
    expect(isUsableEmbeddingVector([])).toBe(false);
  });
});
