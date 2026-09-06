import { LOCAL_PROOF_OWNER_ID } from "./local-proof-store";
import type { ProofItem } from "./proof";

export type CompanionSession = { port: number; token: string; expiresAt: number; semantic: boolean; story: boolean };
export type StoryExcerpt = { sourceID: string; exactExcerpt: string };
export function parsePairingCode(code: string): Pick<CompanionSession, "port" | "token"> {
  const match = /^(\d{1,5})\.([a-f0-9]{64})$/.exec(code.trim());
  const port = Number(match?.[1]);
  if (!match || port < 1024 || port > 65535) throw new Error("Paste the complete code from the Mac companion.");
  return { port, token: match[2] };
}

async function request(session: Pick<CompanionSession, "port" | "token">, path: "capabilities" | "review" | "search" | "story", body?: unknown, signal?: AbortSignal): Promise<Blob> {
  // Revalidate even internal callers. No arbitrary hosts, paths, cookies, redirects or persisted token.
  parsePairingCode(`${session.port}.${session.token}`);
  const serialized = body === undefined ? undefined : JSON.stringify(body);
  if (serialized && new TextEncoder().encode(serialized).length > 262_144) throw new Error("Choose fewer Proof items for this on-device request.");
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = window.setTimeout(abort, 60_000);
  try {
    const response = await fetch(`http://127.0.0.1:${session.port}/v1/${path}`, {
      method: serialized ? "POST" : "GET", headers: { Authorization: `Bearer ${session.token}`, ...(serialized ? { "Content-Type": "application/json" } : {}) },
      body: serialized, credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", signal: controller.signal,
    });
    if (!response.ok || !response.body) throw new Error(path === "review" ? "No prepared batch is available. Start a new companion connection, or import its review file." : "The on-device tool is unavailable. Your saved evidence is unchanged; text matching is still available.");
    const limit = path === "review" ? 64 * 1024 * 1024 : 64 * 1024;
    const declared = response.headers.get("Content-Length");
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new Error("Companion response exceeds its safe size limit.");
    const reader = response.body.getReader(); const chunks: Uint8Array<ArrayBuffer>[] = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength; if (size > limit) throw new Error("Companion response exceeds its safe size limit.");
        chunks.push(new Uint8Array(value));
      }
    } finally { await reader.cancel(); reader.releaseLock(); }
    return new Blob(chunks, { type: "application/json" });
  } catch (error) {
    if (error instanceof TypeError) throw new Error("The browser could not reach the companion. Check that both are on this Mac and allow local-network access if prompted. The review-file fallback still works.");
    throw error;
  } finally { window.clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}

export async function pairCompanion(code: string, signal?: AbortSignal): Promise<CompanionSession> {
  const session = parsePairingCode(code);
  const capabilities: unknown = JSON.parse(await (await request(session, "capabilities", undefined, signal)).text());
  if (!capabilities || typeof capabilities !== "object" || !("semantic" in capabilities) || !("story" in capabilities) || typeof capabilities.semantic !== "boolean" || typeof capabilities.story !== "boolean") throw new Error("Unsupported companion response.");
  return { ...session, semantic: capabilities.semantic, story: capabilities.story, expiresAt: Date.now() + 300_000 };
}
export const receiveCompanionReview = (session: CompanionSession, signal?: AbortSignal) => request(session, "review", undefined, signal);

function sourcesFor(items: readonly ProofItem[], story: boolean) {
  if (!items.length || items.length > (story ? 6 : 100) || new Set(items.map(item => item.id)).size !== items.length || items.some(item => item.userId !== LOCAL_PROOF_OWNER_ID || item.visibility !== "personal")) throw new Error("Select only saved local Proof (up to 6 for a story, or filter to 100 for matching).");
  const sources = items.map(item => ({ id: item.id, revision: item.updatedAt, text: story ? item.evidenceText : [item.title, item.evidenceText, item.category, item.tags.join(" "), item.person, item.project].filter(Boolean).join("\n") }));
  if (sources.some(source => !source.text || source.text.length > 4000) || sources.reduce((sum, source) => sum + source.text.length, 0) > (story ? 6000 : 120_000)) throw new Error("These notes exceed the on-device context. Choose fewer or shorter notes; nothing was sent.");
  return sources;
}
export async function semanticCompanionSearch(session: CompanionSession, query: string, items: readonly ProofItem[], signal?: AbortSignal): Promise<ProofItem[]> {
  const sources = sourcesFor(items, false);
  const response = JSON.parse(await (await request(session, "search", { query, sources }, signal)).text());
  if (!Array.isArray(response.ids) || response.ids.length > 6 || new Set(response.ids).size !== response.ids.length || response.ids.some((id: unknown) => !items.some(item => item.id === id))) throw new Error("Invalid on-device results; no evidence changed.");
  return response.ids.map((id: string, index: number) => ({ ...items.find(item => item.id === id)!, relevance: response.ids.length - index }));
}
export async function draftCompanionStory(session: CompanionSession, items: readonly ProofItem[], signal?: AbortSignal): Promise<StoryExcerpt[]> {
  const sources = sourcesFor(items, true);
  const response = JSON.parse(await (await request(session, "story", { query: "Select passages for a short source-faithful reading sequence.", sources }, signal)).text());
  const excerpts: unknown = response.excerpts;
  if (!Array.isArray(excerpts) || !excerpts.length || excerpts.length > 3 || new Set(excerpts.map(e => e?.sourceID)).size !== excerpts.length || excerpts.some(excerpt => !excerpt || typeof excerpt.exactExcerpt !== "string" || !excerpt.exactExcerpt.trim() || excerpt.exactExcerpt.length > 4000 || !sources.some(source => source.id === excerpt.sourceID && source.text === excerpt.exactExcerpt))) throw new Error("The draft did not pass full-source checks. Your original notes remain below.");
  return excerpts;
}
