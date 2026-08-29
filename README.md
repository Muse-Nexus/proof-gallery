# Proof Gallery

**A private, self-hosted gallery for saving and retrieving concrete evidence — source-faithful, user-initiated, and free/open source.**

Proof Gallery is for moments when depression or a difficult week makes positive
autobiographical evidence hard to access. Save the actual message, receipt,
photo, finished work, award, recovery moment, or memory with its date and
source. Later, search only that collection.

> Proof does not cancel pain or demand optimism. It restores concrete evidence
> you chose to save.

## What it is

- An explicit, no-account local mode backed by this browser profile's IndexedDB.
- An optional hosted Supabase mode with owner accounts and row-level security.
- Images or screenshots stored beside the item in the selected mode.
- Exact evidence, occurred date, source type/detail, category, tags, person, and
  project.
- Category/tag filters, newest ordering, and relevance ordering during search.
- Deterministic Proof-only lexical search that works locally without a model,
  provider, or paid API key.
- Optional semantic embeddings for Supabase mode through one OpenAI-compatible
  endpoint.
- No telemetry, advertising, social feed, automatic collection, or ChorOS
  subscription.

## What it is not

This is not a gratitude journal, mood diagnosis, worth score, public profile, or
argument that suffering is not real. It does not mine email, photos, messages,
finances, memories, or accounts. It does not automatically surface evidence
during distress.

The repository is public. Evidence is not: local-mode evidence remains in the
chosen browser profile, and hosted-mode evidence remains in the Supabase
instance the operator controls. This repository contains synthetic test text
only — no personal entries, production data, screenshots, or credentials.

## Quick start

The fastest route needs only [Bun](https://bun.sh):

```bash
git clone https://github.com/Muse-Nexus/proof-gallery.git
cd proof-gallery
bun install
bun run dev
```

Open `http://localhost:5173`, choose **Use this browser**, and add an item. That
choice is explicit: an unavailable or misconfigured Supabase connection never
silently falls back to local storage.

Local mode needs no account and makes no evidence or search request to
Supabase, an embedding service, Drive, or Dropbox. Items and image bytes stay in
IndexedDB for that browser profile. Local mode is not account-authenticated,
not encrypted by Proof Gallery, and not automatically synchronized. Back up
regularly with the user-initiated versioned JSON export; the resulting plaintext
file can be kept in a private local folder or placed in a private Google Drive
or Dropbox folder by the user. Integrity receipts detect backup corruption but
do not authenticate or encrypt the file.

For authenticated, multi-device storage, use the optional Supabase mode. It
requires the [Supabase CLI](https://supabase.com/docs/guides/local-development)
and Docker for local development, or a dedicated hosted Supabase project. The
fail-closed migration rejects pre-existing Storage object policies that could
broaden access.

See [Self-hosting](docs/SELF_HOSTING.md) for both modes, deployment origins,
optional embeddings, backups, and account deletion.

## Search modes

Local mode uses deterministic lexical ranking over Proof items in the selected
browser profile. It does not call a model or provider. Local and Supabase
collections are separate: Proof Gallery does not silently sync, migrate,
co-search, or merge them.

In Supabase mode, Postgres full-text and trigram ranking operate only on
`proof_items`, with owner RLS applied before ranking.

Semantic retrieval is optional. Configure one OpenAI-compatible embedding
endpoint in Edge Function secrets:

```bash
supabase secrets set \
  OPENAI_API_KEY=your-server-side-key \
  EMBEDDING_MODEL=text-embedding-3-small \
  EMBEDDING_DIMENSIONS=1536
```

For a fully local route, point `EMBEDDING_BASE_URL` at an OpenAI-compatible
local server such as Ollama and choose its model. The provider and dimension are
stored with each vector so unlike embeddings are never compared. Search falls
back visibly to lexical results if embeddings are missing, rate-limited, or
unavailable.

Proof text and search text leave your Supabase instance only when you configure
an external embedding endpoint. Images are never sent for vision analysis.

## Privacy architecture

- Local mode stores items and image bytes in IndexedDB for the current origin
  and browser profile. It has no owner authentication and is not encrypted by
  Proof Gallery; other users of that profile, privileged extensions, device
  administrators, and JavaScript executing on the same origin may be able to
  read it.
- Clearing site data, browser eviction, private-browsing teardown, or profile
  loss can erase local data. Export files are portable plaintext and must be
  protected by the user.
- A dedicated hostname is required for meaningful browser-storage isolation.
  GitHub Pages project paths share their parent origin and therefore share its
  browser-storage trust boundary.
- `proof_items.visibility` is fixed to `personal`.
- Postgres uses `ENABLE ROW LEVEL SECURITY` plus `FORCE ROW LEVEL SECURITY`.
- Separate owner-only policies cover SELECT, INSERT, UPDATE, and DELETE.
- Table grants are reset before authenticated CRUD is granted; `TRUNCATE`,
  `TRIGGER`, and `REFERENCES` are not granted.
- Images use signed URLs from a private `proof-images` bucket with owner-folder
  policies, a 10 MB limit, safe raster MIME allowlist, and browser magic-byte
  validation.
- Search and indexing authenticate the JWT and use the caller's RLS-scoped
  Supabase client. There is no service-role fallback for evidence reads.
- Optional embedding requests have a distributed 20-per-minute owner budget.
- No analytics, session replay, public media URLs, or request-body logging.

Read the full [privacy and threat model](docs/PRIVACY.md) and
[safety constitution](docs/SAFETY.md).

## Development

```bash
bun run typecheck
bun run test
bun run build
deno check supabase/functions/proof-search/index.ts
deno check supabase/functions/embed-proof/index.ts
```

Database integration tests require Docker and a local Supabase stack at
`127.0.0.1:54321`. They fail closed for any non-local URL because they create
and delete synthetic fixture users:

```bash
proof_env_file="$(mktemp -t proof-gallery.XXXXXX)"
trap 'rm -f "$proof_env_file"' EXIT
supabase status -o env > "$proof_env_file"
set -a && source "$proof_env_file" && set +a
psql "$DB_URL" -f tests/integration/grants.sql
bun run test:integration:local
```

The temporary file contains a local service-role credential and is removed on
shell exit. All tests and examples must stay explicitly synthetic.

## Scope

The standalone MVP stops at manual CRUD, images, filtering, scoped retrieval,
and explicit local backup/restore. Drive and Dropbox connectors, background
sync, autonomous mining, review inboxes, public sharing, digests, model
orchestration, mood diagnosis, and generalized life logging are deliberately
out of scope. Manually placing an exported backup in a private Drive or Dropbox
folder does not make either service a Proof Gallery connector.

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md). Never paste personal evidence,
credentials, signed URLs, or production identifiers into an issue, test,
screenshot, discussion, or pull request.

Report security or privacy problems privately using the repository's Security
tab as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE). The software is free. Hosting and optional third-party embedding
providers may have their own costs. See [NOTICE.md](NOTICE.md) for origin and
bundled dependency notices.
