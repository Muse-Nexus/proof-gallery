# Proof Gallery

**A private, self-hosted gallery for saving and retrieving concrete evidence — source-faithful, user-initiated, and free/open source.**

Proof Gallery is for moments when depression or a difficult week makes positive
autobiographical evidence hard to access. Save the actual message, receipt,
photo, finished work, award, recovery moment, or memory with its date and
source. Later, search only that collection.

> Proof does not cancel pain or demand optimism. It restores concrete evidence
> you chose to save.

## What it is

- Private manual evidence with owner-only accounts and row-level security.
- Images or screenshots in a dedicated private Storage bucket.
- Exact evidence, occurred date, source type/detail, category, tags, person, and
  project.
- Category/tag filters, newest ordering, and relevance ordering during search.
- Proof-only lexical search that works without a model or paid API key.
- Optional semantic embeddings through one OpenAI-compatible endpoint.
- No telemetry, advertising, social feed, automatic collection, or ChorOS
  subscription.

## What it is not

This is not a gratitude journal, mood diagnosis, worth score, public profile, or
argument that suffering is not real. It does not mine email, photos, messages,
finances, memories, or accounts. It does not automatically surface evidence
during distress.

The repository is public. **Every user's evidence remains private in the
Supabase instance they control.** This repository contains synthetic test text
only — no personal entries, production data, screenshots, or credentials.

## Quick start

Requirements: [Bun](https://bun.sh), [Supabase CLI](https://supabase.com/docs/guides/local-development), and Docker for the local Supabase stack. Use a dedicated new Supabase project; the fail-closed migration rejects pre-existing Storage object policies that could broaden access.

```bash
git clone https://github.com/Muse-Nexus/proof-gallery.git
cd proof-gallery
bun install
supabase start
cp .env.example .env.local
```

Copy the local `API URL` and `anon key` printed by `supabase start` into
`.env.local`, then run:

```bash
supabase functions serve --env-file .env.local
bun run dev
```

Open `http://localhost:5173`, create the owner account, and add one synthetic or
real item manually. For a hosted single-owner install, create the owner first
and then disable new signups in Supabase Auth.

See [Self-hosting](docs/SELF_HOSTING.md) for deployment, origins, optional local
embeddings, backups, and account deletion.

## Search modes

Lexical retrieval is the free default. Postgres full-text and trigram ranking
operate only on `proof_items`, with owner RLS applied before ranking.

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

The standalone MVP stops at private manual CRUD, images, filtering, and scoped
retrieval. Connectors, autonomous mining, review inboxes, public sharing,
digests, model orchestration, mood diagnosis, and generalized life logging are
deliberately out of scope.

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
