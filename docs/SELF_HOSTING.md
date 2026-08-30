# Self-hosting

## Choose a storage mode

Proof Gallery can run as a static local-first app with no account or as an
authenticated Supabase-backed app. The modes are separate. The app does not
silently fall back, sync, co-search, or migrate evidence between them.

## Browser-local development

1. Install Bun.
2. Run `bun install` and `bun run dev`.
3. Open `http://localhost:5173` and choose **Use this browser**.

Items and image bytes are stored in IndexedDB for that exact browser origin and
profile. Search is deterministic Proof-only lexical ranking and calls no model,
Supabase project, Drive, Dropbox, or other provider.

Local mode is not encrypted by Proof Gallery and has no authenticated owner
identity. Anyone with access to the browser profile, a privileged extension,
device-administrator access, or JavaScript executing on the same origin may be
able to read it. Clearing site data, eviction, private-browsing teardown, or
profile/device loss may erase it. Export a backup regularly.

## Supabase local development

1. Install Bun, Docker, and the Supabase CLI.
2. Run `bun install` and `supabase start`.
3. Copy `.env.example` to `.env.local` and enter the local API URL and anon key.
4. In one terminal, run `supabase functions serve --env-file .env.local`.
5. In another, run `bun run dev`.

The initial migration creates the private table, bucket, RLS policies, scoped
search RPCs, and optional embedding budget guard.

## Hosted Supabase

Use a dedicated new project. Row-level policies are permissive when combined,
so an unrelated pre-existing Storage policy could silently broaden access. The
initial migration fails if it sees any pre-existing `storage.objects` policy
rather than guessing that it is safe.

```bash
supabase link --project-ref your-project-ref
supabase db push
supabase secrets set ALLOWED_ORIGINS=https://your-proof-domain.example
supabase functions deploy proof-search
supabase functions deploy embed-proof
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the frontend build
environment. The anon key is designed to be public; never expose a service-role
key or embedding-provider key in any `VITE_` variable.

Create the owner account, verify sign-in, then disable new signups if this is a
single-owner installation. Before adding evidence, set the exact Auth Site URL
and redirect allowlist, require email confirmation, and use a strong unique
password (plus MFA when your Auth configuration supports it). Do not operate an
open-registration public instance with a shared paid embedding key unless you
add appropriate abuse controls, terms, monitoring, and storage budgets.

## Optional embeddings

No provider is required. Without one, lexical search remains available.

Hosted OpenAI-compatible provider:

```bash
supabase secrets set \
  OPENAI_API_KEY=your-server-side-key \
  EMBEDDING_MODEL=text-embedding-3-small \
  EMBEDDING_DIMENSIONS=1536
```

Local OpenAI-compatible provider:

```bash
supabase secrets set \
  EMBEDDING_BASE_URL=http://host.docker.internal:11434/v1 \
  EMBEDDING_API_KEY=optional-custom-provider-key \
  EMBEDDING_MODEL=your-local-embedding-model
```

The local endpoint must be reachable from the Edge Function runtime. After
changing models, edit and save an item to re-index it. Existing vectors from a
different model or dimension are excluded from comparison.

`OPENAI_API_KEY` is used only with the fixed OpenAI endpoint. When
`EMBEDDING_BASE_URL` is set, the app sends only `EMBEDDING_API_KEY` (when
present), so an OpenAI credential is never forwarded to a custom host. Omit the
custom-provider key for a trusted local endpoint that does not require auth.
Remote custom endpoints must use HTTPS; cleartext HTTP is accepted only for
localhost, loopback, and `host.docker.internal` development endpoints.

## Frontend hosting

`bun run build` creates `dist/`, which can be served by any static host. Use a
dedicated trusted hostname that runs no unrelated or third-party JavaScript.
Both IndexedDB and the Supabase owner session use the browser origin as a trust
boundary. URL paths do not isolate browser storage, so GitHub Pages project
paths under one `*.github.io` site are not separate storage boundaries. Use a
dedicated exact hostname for a real local-data isolation boundary.

The included `_headers` file provides a restrictive baseline for hosts that
support that format. Update its `connect-src` and `img-src` directives if your
Supabase host is not under `*.supabase.co`.

Deployment is deliberately manual. This repository does not deploy into an
operator's account on push.

## Local backup and restore

Use **Back up** to create a passphrase-encrypted `.proof` archive containing
saved Proof, pending media, and saved review notes. The passphrase is not stored
or recoverable. Older version-1/2 plaintext JSON files still restore. Manual
Drive/Dropbox storage is not a connector or background sync. Encryption protects
the downloaded file, not the active browser database; SHA receipts detect
corruption rather than establishing source authorship. Exact formats, limits,
conflicts, and recovery caveats: [private completion contract](PRIVATE_COMPLETION.md).

Restore is also user-initiated and accepts a supported, validated archive. Test
restore before depending on a backup. Browser persistence is best-effort and is
not a replacement for an exported copy.

Clearing local data removes records controlled by that site origin. It cannot
remove downloaded archives, original source files, copies held by another
program, or device/browser backups, and it does not guarantee secure erasure
from the underlying medium.

## Supabase backup and restore

Back up both systems:

1. Postgres: use the Supabase backup/PITR facility or `pg_dump` for
   `public.proof_items` plus required auth metadata according to your recovery
   plan.
2. Storage: export the private `proof-images` bucket while preserving object
   paths and metadata.

Test restoration into a non-production project. A database-only restore will
leave image references without objects; a Storage-only restore will leave
private orphans.

## Cleanup recovery

If the UI reports that an old private image could not be removed:

1. Stay signed in as the affected owner.
2. Inspect only that owner's folder in `proof-images`.
3. Compare object paths with the owner's non-null `proof_items.image_path`
   values.
4. Delete only unreferenced objects after taking a backup.

Never run a bucket-wide delete based on a client cache or partial query.

## Account deletion

Delete the owner's Storage folder before deleting the Auth user. The database
rows cascade from `auth.users`; Storage objects do not. Confirm both the table
and bucket contain zero rows/objects for that owner before calling deletion
complete.
