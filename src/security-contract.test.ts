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
    expect(indexHtml).toContain('rel="icon" type="image/svg+xml" href="/favicon.svg"');
  });

  it("keeps scripts and fonts first-party under a restrictive hosting policy", () => {
    expect(publicHeaders).toContain("script-src 'self'");
    expect(publicHeaders).toContain("font-src 'self'");
    expect(publicHeaders).toContain("frame-ancestors 'none'");
    expect(publicHeaders).not.toMatch(/google-analytics|googletagmanager|segment\.com/i);
  });
});
