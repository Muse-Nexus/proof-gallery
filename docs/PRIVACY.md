# Privacy and threat model

## Boundary

Proof Gallery stores private autobiographical evidence in the operator's own
Supabase project. The public GitHub repository contains software, not anyone's
evidence. There is no Muse Nexus hosted evidence service in this repository.

## Protected assets

- evidence text and exact quotes;
- dates, sources, tags, people, and project names;
- private images and screenshots;
- authentication sessions;
- optional embeddings, which may encode sensitive text.

## Enforced controls

- Authenticated owner identity is required at the table, Storage, RPC, and Edge
  Function boundaries.
- `proof_items` has forced RLS and four owner-only CRUD policies.
- `visibility` cannot be changed from `personal`.
- Anonymous table/RPC access is revoked.
- Authenticated table privileges are CRUD only; table-wide destructive and DDL
  privileges are not granted.
- Private images are stored under `<owner uuid>/...`, served only by short-lived
  signed URLs, and never published with `getPublicUrl`.
- The bucket accepts JPEG, PNG, WebP, and GIF only, at 10 MB or less. The browser
  checks file signatures as soon as a file is selected and again before upload;
  SVG and HTML are rejected. A new local file is not assigned to an HTML image
  URL for preview; stored images are displayed through private signed URLs.
- Retrieval functions query only `proof_items`, apply the current owner before
  ranking, and return stored fields rather than generated conclusions.
- The Edge Functions use the caller's anon-key/JWT client. They do not use a
  service-role fallback for reads or search.
- Optional provider errors are logged as type/status receipts without query or
  evidence bodies.

## Provider boundary

Lexical search stays inside Postgres. If an operator configures an embedding
endpoint, saved Proof text is sent when an item is indexed and submitted search
text is sent when semantic search runs. No image is sent to an embedding or
vision provider. The UI displays when semantic search is unavailable and uses
the private lexical path instead.

## Known limitations

- Uploaded images preserve their original bytes, including any EXIF metadata
  such as GPS coordinates or device details. This keeps evidence source-faithful
  but means operators should strip metadata before upload when it is not needed.
  The app does not silently alter the original image.
- Browser file-signature checks can be bypassed by a custom authenticated API
  client. The private bucket still enforces owner folders, an image MIME
  allowlist, and size limits. Operators who accept untrusted users should add a
  server-side image decoding/re-encoding gateway.
- Database row changes and Storage object deletion are separate operations. A
  failed cleanup can leave a private orphan. The UI reports this instead of
  claiming full cleanup; operators can reconcile with the recovery steps in
  [SELF_HOSTING.md](SELF_HOSTING.md).
- Anyone controlling the Supabase project, database host, frontend origin, or
  embedding provider can access data at that layer. Choose operators and
  providers accordingly.
- This MVP does not provide application-layer encryption with a user-held key.

## Public issue hygiene

Never paste evidence, photos, account identifiers, signed URLs, secrets, or
production logs into GitHub. Reproduce defects with the synthetic fixture format
described in `CONTRIBUTING.md`.
