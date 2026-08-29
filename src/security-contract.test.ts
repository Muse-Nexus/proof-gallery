import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("supabase/migrations/20260829000000_proof_gallery.sql"),
  "utf8",
).toLowerCase();
const search = readFileSync(
  resolve("supabase/functions/proof-search/index.ts"),
  "utf8",
);
const indexHtml = readFileSync(resolve("index.html"), "utf8");
const publicHeaders = readFileSync(resolve("public/_headers"), "utf8");
const app = readFileSync(resolve("src/App.tsx"), "utf8");
const decorativeVisual = readFileSync(
  resolve("src/components/DecorativeVisual.tsx"),
  "utf8",
);
const notice = readFileSync(resolve("NOTICE.md"), "utf8");
const visualAssets = readFileSync(resolve("docs/VISUAL_ASSETS.md"), "utf8");

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(resolve(path))).digest("hex");
}

describe("database privacy contract", () => {
  it("forces owner RLS for every CRUD action", () => {
    expect(migration).toContain("alter table public.proof_items force row level security");
    for (const operation of ["select", "insert", "update", "delete"]) {
      expect(migration).toContain(`proof_items_${operation}_own`);
    }
    expect(migration.match(/auth\.uid\(\) = user_id/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("resets table grants before authenticated CRUD only", () => {
    expect(migration).toContain(
      "revoke all on table public.proof_items from public, anon, authenticated",
    );
    expect(migration).toContain(
      "grant select, insert, update, delete on table public.proof_items to authenticated",
    );
    expect(migration).not.toMatch(/grant\s+(truncate|trigger|references)/);
  });

  it("uses a private owner-folder image bucket with safe MIME types", () => {
    expect(migration).toContain("'proof-images',\n  'proof-images',\n  false");
    expect(migration).toContain("storage.foldername(name))[1] = auth.uid()::text");
    expect(migration).not.toContain("image/svg+xml");
  });

  it("scopes both retrieval functions to proof_items and authenticated owner", () => {
    expect(migration).toContain("from public.proof_items as item");
    expect(migration).toContain("and item.user_id = auth.uid()");
    expect(migration).not.toContain("memory_items");
    expect(search).toContain('client.rpc("search_proof_items"');
    expect(search).toContain('client.rpc("match_proof_items"');
  });

  it("rate-limits optional embeddings without disabling lexical retrieval", () => {
    expect(migration).toContain("create function public.claim_proof_embedding_slot()");
    expect(migration).toContain("request_count <= 20");
    expect(search.indexOf('client.rpc("search_proof_items"')).toBeLessThan(
      search.indexOf('client.rpc(\n        "claim_proof_embedding_slot"'),
    );
  });
});

describe("public share contract", () => {
  it("describes the browser-local boundary and includes complete social metadata", () => {
    expect(indexHtml).toContain("free, browser-local gallery");
    expect(indexHtml).toContain('property="og:title" content="Proof Gallery"');
    expect(indexHtml).toContain('name="twitter:card" content="summary_large_image"');
    expect(indexHtml).toContain(
      'rel="canonical" href="https://proof-gallery-9jn.pages.dev/"',
    );
    expect(indexHtml).toContain(
      "https://proof-gallery-9jn.pages.dev/og.png",
    );
    expect(indexHtml).toContain("No account, no app analytics");
    expect(indexHtml).not.toMatch(/no telemetry/i);
    expect(indexHtml).toContain('rel="icon" type="image/svg+xml" href="/favicon.svg"');
  });

  it("keeps scripts and fonts first-party under a restrictive hosting policy", () => {
    expect(publicHeaders).toContain("script-src 'self'");
    expect(publicHeaders).toContain("font-src 'self'");
    expect(publicHeaders).toContain("frame-ancestors 'none'");
    expect(publicHeaders).not.toMatch(/google-analytics|googletagmanager|segment\.com/i);
  });

  it("bundles decorative images first-party without widening the provider boundary", () => {
    expect(app).toContain('src="/visuals/evidence-desk-ai.webp"');
    expect(app).toContain('src="/visuals/paper-collage-unsplash.webp"');
    expect(`${app}\n${decorativeVisual}`).not.toMatch(
      /https:\/\/(?:images|source)\.unsplash\.com/i,
    );
    expect(publicHeaders).not.toMatch(/unsplash|openai/i);
    for (const asset of [
      "evidence-desk-ai.webp",
      "paper-collage-unsplash.webp",
    ]) {
      expect(notice).toContain(asset);
      expect(visualAssets).toContain(asset);
    }
    expect(visualAssets).toContain(
      "f0ac276d835f105df9c94297a1a1cb10323c1c111f0f4c043db8aa7d4bdaef8d",
    );
    expect(sha256("public/visuals/evidence-desk-ai.webp")).toBe(
      "f0ac276d835f105df9c94297a1a1cb10323c1c111f0f4c043db8aa7d4bdaef8d",
    );
    expect(visualAssets).toContain(
      "c68239ac19ff1ec2ca1fa149f36bc0e694c13048e1d1f8b3d8ebed75f0ebab2e",
    );
    expect(sha256("public/visuals/paper-collage-unsplash.webp")).toBe(
      "c68239ac19ff1ec2ca1fa149f36bc0e694c13048e1d1f8b3d8ebed75f0ebab2e",
    );
  });
});
