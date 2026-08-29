export type EmbeddingProvider = {
  url: string;
  apiKey: string | null;
};

export type EnvReader = (name: string) => string | undefined;

export function isUsableEmbeddingVector(value: unknown): value is number[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 4096 ||
    !value.every(
      (entry: unknown) => typeof entry === "number" && Number.isFinite(entry),
    )
  ) {
    return false;
  }
  const squaredNorm = value.reduce(
    (total: number, entry: number) => total + entry * entry,
    0,
  );
  return squaredNorm > 1e-12;
}

export function resolveEmbeddingProvider(
  readEnv: EnvReader,
): EmbeddingProvider | null {
  const customBase = readEnv("EMBEDDING_BASE_URL")?.trim();
  if (customBase) {
    let parsed: URL;
    try {
      parsed = new URL(customBase);
    } catch {
      return null;
    }
    const localHttpHosts = new Set([
      "localhost",
      "127.0.0.1",
      "[::1]",
      "host.docker.internal",
    ]);
    if (
      parsed.protocol !== "https:" &&
      !(parsed.protocol === "http:" && localHttpHosts.has(parsed.hostname))
    ) {
      return null;
    }
    return {
      url: `${customBase.replace(/\/$/, "")}/embeddings`,
      apiKey: readEnv("EMBEDDING_API_KEY")?.trim() || null,
    };
  }

  const openAIKey = readEnv("OPENAI_API_KEY")?.trim();
  if (!openAIKey) return null;
  return {
    url: "https://api.openai.com/v1/embeddings",
    apiKey: openAIKey,
  };
}
