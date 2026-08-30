# Privacy and threat model

## Optional Mac Photos companion

The separate [Mac companion](COMPANION.md) can request a Photos grant and watch
a user-selected album/recent Favorites scope only while active. Web permission
does not inherit that grant. Photos are exported to an owner-selected local
review file, then explicitly imported into pending review. No automatic saved
Proof, cloud upload, iCloud download, or localhost server is introduced.

HEIC JPEG previews are labelled derivatives with original-resource digest/name
receipts; original HEIC bytes remain in Photos. Original supported media may
retain EXIF metadata. Capture dates are attributed to Photos metadata. Native
in-memory batches disappear on exit unless exported, and OS Photos permission
must be revoked separately from app Disconnect. Both native export files and
browser storage remain unencrypted. See the companion guide for full limits.

## Selected-media review (local mode)

Local media intake adds a separate `proof_candidates` IndexedDB store (database
version 2). Pending original photos/clips and details are unencrypted, private
only to the browser profile, and excluded from saved-Proof search and backups.
File selection or a selected folder is a one-time import, not a continuing grant.
No account connector, OCR, face recognition, or AI image analysis runs.

Approval validates container signatures and SHA-256 against stored bytes, checks
revisions, and atomically inserts saved Proof and removes pending candidates.
Duplicate bytes are skipped across both stores. Unknown dates are left blank;
the file modification time is never substituted. Original metadata is retained.
Local MP4/WebM clips are limited to 10 MB, played only on request through a native
video element, with an original download when the browser cannot decode them.
Hosted Supabase attachments remain raster-only and retain existing RLS/policies.
Unsaved review details are retained across imports and cross-tab refreshes,
including changes received during a storage read. Saving details checks the
stored revision; only a successful save or explicit discard replaces that draft.

Version-2 local backups include approved photo/video attachments and allow an
empty note only with a real attachment; version-1 photo/text archives remain
readable. Pending review is excluded. Removing saved Proof does not remove
pending files: select them in the inbox and use Remove from review. Neither
action deletes original files or downloaded backups. No data is copied from
ChorOS automatically, and a manually authorized copy is separate, not synced.

## Boundary

The public GitHub repository contains software, not anyone's evidence. There is
no Muse Nexus hosted evidence service in this repository.

Proof Gallery has two deliberately separate storage modes:

- **Local mode** stores evidence and image bytes in IndexedDB for one browser
  origin and profile. It requires no account.
- **Supabase mode** stores evidence in an operator-controlled Supabase project
  behind an authenticated owner identity and row-level security.

Choosing a mode is explicit. A failed login, missing configuration, network
error, or unavailable provider does not silently move evidence into local
storage. Proof Gallery does not automatically sync, migrate, co-search, or
merge the two collections.

## Protected assets

- evidence text and exact quotes;
- dates, sources, tags, people, and project names;
- private images and screenshots;
- authentication sessions;
- optional embeddings, which may encode sensitive text.

## Local mode

Local mode makes no evidence or search request to Supabase or an embedding
provider. Retrieval is deterministic lexical ranking over Proof items in the
selected IndexedDB database; it is not semantic search and does not invoke a
model. Drive and Dropbox are not connected or queried.

"Local" describes storage location, not an authenticated owner boundary:

- Proof Gallery does not encrypt local items, images, or backups.
- Anyone who can use the same browser profile may be able to open the gallery.
- Privileged browser extensions, device administrators, malware, browser
  debugging tools, and JavaScript that executes on the same origin may be able
  to read or change the data.
- Clearing site data, storage eviction, private-browsing teardown, browser
  reset, or profile/device loss may permanently remove the IndexedDB database.
  A persistence request is best-effort and does not make browser storage a
  backup.
- Browser storage is isolated by origin, not by URL path. GitHub Pages project
  paths under one `*.github.io` site share an origin. Use a dedicated exact
  hostname that serves no unrelated or third-party JavaScript when storage
  isolation matters.

The app can create a user-initiated, versioned JSON backup and restore a
supported backup after validation. The archive is portable **plaintext**. The
user may keep it in a private local folder or manually place it in a private
Google Drive or Dropbox folder, but Proof Gallery does not upload, watch, or
sync that folder. Item and image SHA-256 receipts detect corruption; they do
not authenticate or encrypt a backup. Protect access to every exported copy.

Removing local Proof data clears records controlled by this origin. It cannot
remove downloaded backups, original source files, copies made by other
software, or browser/device backups, and it cannot guarantee secure erasure
from storage media.

## Supabase-mode enforced controls

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

Local lexical search stays in the browser and calls no provider. Supabase-mode
lexical search stays inside Postgres. If an operator configures an embedding
endpoint, saved Proof text is sent when an item is indexed and submitted search
text is sent when semantic search runs. No image is sent to an embedding or
vision provider. The UI displays when semantic search is unavailable and uses
the private Supabase lexical path instead.

## Known limitations

- Local and uploaded images preserve their original bytes, including any EXIF
  metadata such as GPS coordinates or device details. Exported local backups
  preserve those bytes too. This keeps evidence source-faithful but means users
  should strip metadata before saving when it is not needed. The app does not
  silently alter the original image.
- Browser file-signature checks can be bypassed by a custom authenticated API
  client. The private bucket still enforces owner folders, an image MIME
  allowlist, and size limits. Operators who accept untrusted users should add a
  server-side image decoding/re-encoding gateway.
- Database row changes and Storage object deletion are separate operations. A
  failed cleanup can leave a private orphan. The UI reports this instead of
  claiming full cleanup; operators can reconcile with the recovery steps in
  [SELF_HOSTING.md](SELF_HOSTING.md).
- Anyone controlling the Supabase project, database host, frontend origin, or
  configured embedding provider can access data at that layer. In local mode,
  the browser profile, device, extensions, and frontend origin are the primary
  trust boundary. Choose operators and software accordingly.
- This MVP does not provide application-layer encryption with a user-held key.

## Collection boundary

All source access is user-initiated. The web gallery does not search or mine Drive,
Dropbox, email, photos, messages, finance, ordinary memories, or other accounts.
It does not run background collection or automatically surface evidence during
distress. The selected-media review inbox does not grant connector or library
access. The optional native companion has its own bounded Photos source and
active-session observer, not general account mining. Any further collector must
preserve that review boundary and add explicit source permissions, revocation,
and protected credential handling.

## Decorative visual boundary

Stock and AI-generated visuals are bundled first-party landing-page assets,
not runtime provider content. Page load makes no Unsplash/image-model asset or
API request and sends no evidence or search text to either provider. The
credited Unsplash links navigate there only after a user chooses them. The app
does not widen its Content Security Policy for provider asset or API domains.
Decorative assets are visibly labeled **Not saved Proof** and are excluded from
item data, local backups, database rows, attachment storage, provenance,
embeddings, and search.

Gallery cards never substitute decorative imagery for missing evidence. An
image renders only when a Proof item has a stored attachment path and its
resolved private or local URL. A saved attachment without a current preview is
labeled **Preview unavailable**, not missing; only a missing attachment path is
explicitly text-only. Asset origins and hashes are documented in
[VISUAL_ASSETS.md](VISUAL_ASSETS.md).

## Public issue hygiene

Never paste evidence, photos, account identifiers, signed URLs, secrets, or
production logs into GitHub. Reproduce defects with the synthetic fixture format
described in `CONTRIBUTING.md`.
