# Privacy and threat model

## Durable native collection (unreleased full-version work)

The new native collection is a third, separately chosen authority, not a sync
layer over browser or hosted data. Explicit setup creates a private local SQLite
store. Directory/file permissions are 0700/0600; the active database is not
app-encrypted and cannot protect against other software running as the same OS
user. A single companion holds its file lock. Browser and assistant clients
access this store through scoped, expiring, revocable loopback grants, never by
opening its database. The browser pairing code stays in memory, not browser
storage. Connecting does not automatically fetch evidence; hiding the page
redacts evidence and unsaved drafts, and revocation/expiry erases client state.

Sources, background collection, exact-source automatic saving, login startup,
assistant access and reminders each require separate owner actions. A selected
Photos scope or immediate-files-only folder defaults to pending review. Explicit
trusted-source approval may save new validated images with owner-chosen category
and tags; it does not approve existing candidates or infer emotional meaning.
Originals are never edited. Background collection runs only while the authorized
companion process is running. No reads occur while the Mac is shut down or asleep;
a later bounded source check does not widen the selected scope.

Gallery grants permit review/CRUD/media for 24 hours. Assistant grants permit
saved text only for 30 days. Search is restricted to saved Proof in this native
collection; on-device semantic matching uses the newest 100 filtered items and
labels that window and fallback. A cloud assistant may send requested text to
its provider: local storage is not a promise that the selected assistant runs
locally. No media, source, approval or write authority follows from the MCP grant.
Bytes another client already received or queued for transmission cannot be
retracted by revocation or deletion.

Native reminders require both explicit app consent and OS permission. They send
only generic text, with quiet hours, cooldown and no missed-reminder replay;
no evidence, person, count or item ID appears in the OS notification. Turning
them off is separate from stopping source collection or assistant access.

Native passphrase-encrypted backups contain saved/pending evidence and literal
receipts, not source bookmarks, client tokens, reminder settings or active
permissions. Restore validates the whole archive into an empty, unconnected
native collection. Browser backups use a different inner format; no silent
conversion occurs. Native deletion tombstones prevent automatic source
resurrection, but retained backups and original files remain separate copies.
Deletion cannot promise forensic erasure from device snapshots or storage media.
See [native setup and device gates](NATIVE_SETUP.md).

## Legacy Mac Photos review/export flow

The separate [Mac companion](COMPANION.md) can request a Photos grant and watch
a user-selected Recent Photos/Favorites/album date scope only while active. Web permission
does not inherit that grant. Photos are exported to an owner-selected local
review file or an explicitly paired same-Mac connection, then imported into
pending review. No automatic saved Proof or cloud upload is introduced. The
five-minute loopback server is documented in [the private connection contract](PRIVATE_COMPLETION.md).
iCloud downloading is
a separate off-by-default option for one bounded batch, not a continuing grant.
It uses Apple Photos to retrieve existing originals and switches off on Pause
or completion. No general network entitlement is added. Apple's cache/network
traffic can exceed our retained-media limits; downloaded originals may remain
cached after Pause. This does not authorize cloud AI processing or uploads.

An off-by-default toggle permits on-device Apple Vision text recognition within
that selected source. It operates on a bounded preview off the main thread;
Pause cancels the request and generation checks discard late results. Excerpts
are unverified native-memory review aids, not quotes or semantic judgments.
They and metadata cue flags are omitted from the unchanged v1 export. Clear,
remove, disconnect, or quitting removes the corresponding native cues. No GPS,
caption, People label, or additional album membership lookup is performed.

HEIC JPEG previews are labelled derivatives with original-resource digest/name
receipts; original HEIC bytes remain in Photos. Original supported media may
retain EXIF metadata. Capture dates are attributed to Photos metadata. Native
in-memory batches disappear on exit unless exported, and OS Photos permission
must be revoked separately from app Disconnect. Both native export files and
browser storage remain unencrypted. See the companion guide for full limits.

## Selected-media review (local mode)

Local media intake uses a separate `proof_candidates` IndexedDB store. Database
version 3 adds private source grants for explicit trusted-folder consent, without
changing existing saved or pending records. Pending photos/clips and details are unencrypted, private
only to the browser profile, and excluded from saved-Proof search. Encrypted full
backups include pending media and saved draft notes; legacy saved-only exports do not.
Ordinary file/folder selection is a one-time import. The separate folder source
uses a read-only directory handle and explicit Start for bounded checks while
the gallery is open and visible. By default its handle stays in memory and new
media stays pending. An explicit confirmation can remember one trusted folder
and allow new validated media to save directly, with an approval receipt and
owner-chosen category/tags. The exact handle, grant/revision, paused state and
processed hashes stay in this profile's unencrypted IndexedDB, never backups.
Reopening resumes only an active grant with existing read permission; no startup
permission prompts. Persistent Pause and Forget cancel work. Each auto-save
rechecks current consent atomically; another tab cannot continue using revoked
consent. No subfolders are read. Full scope, limits,
permission semantics, and cancellation are in [automatic sources](AUTOMATIC_SOURCES.md).
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

The note-first helper uses deterministic rules entirely in the browser. It
suggests labels only from the user's written note, not photo pixels, OCR,
filenames, or another source. Saving a note edits the pending candidate through
the same revision-checked path; it does not approve it. Manual fields remain
authoritative and suggestions can be disabled.

Related-Proof lookup and the story reading view use only the already-loaded
saved collection, additionally filtered to the same owner and `personal`
visibility. They do not search pending candidates, another mode, or ordinary
memories. Lookup and story opening are user-initiated; related story moments
require individual selection. Stories are derived UI state, not persisted
evidence. Optional paired-Mac tools can match by meaning or select complete
saved notes for a reading; they do not rewrite them or upload to cloud models.
Existing stored-attachment preview handling and
companion derivative labels apply in the story view too.

Version-2 local backups include approved photo/video attachments and allow an
empty note only with a real attachment; version-1 photo/text archives remain
readable. Pending review is excluded from these older formats, but included in
the default encrypted full backup. Removing saved Proof does not remove
pending files: select them in the inbox and use Remove from review. Neither
action deletes original files or downloaded backups. No data is copied from
ChorOS automatically, and a manually authorized copy is separate, not synced.

## Boundary

The public GitHub repository contains software, not anyone's evidence. There is
no Muse Nexus hosted evidence service in this repository.

The browser gallery has two deliberately separate storage modes, alongside the
explicit native connection described above:

- **Local mode** stores evidence and image bytes in IndexedDB for one browser
  origin and profile. It requires no account.
- **Supabase mode** stores evidence in an operator-controlled Supabase project
  behind an authenticated owner identity and row-level security.

Choosing a mode is explicit. A failed login, missing configuration, network
error, or unavailable provider does not silently move evidence into local
storage. Proof Gallery does not automatically sync, migrate, co-search, or
merge these collections.

## Protected assets

- evidence text and exact quotes;
- dates, sources, tags, people, and project names;
- private images and screenshots;
- authentication sessions;
- optional embeddings, which may encode sensitive text.

## Local mode

Local mode makes no evidence or search request to Supabase or an embedding
provider. Retrieval is deterministic lexical ranking over Proof items in the
selected IndexedDB database by default. Optional same-Mac pairing adds explicit
on-device meaning matching and full-note reading selection, never automatic
retrieval or cloud inference. Drive and Dropbox are not connected or queried.

"Local" describes storage location, not an authenticated owner boundary:

- Proof Gallery does not encrypt the active local database. Default downloaded
  full backups are encrypted; older JSON and companion review files are not.
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

The app creates user-initiated, passphrase-encrypted full backups and restores
supported archives after validation. Forgotten passphrases cannot be recovered.
The user may store them privately on disk, Drive, or Dropbox; Proof Gallery does
not upload, watch, or sync that folder. Item/media SHA receipts detect corruption,
not source authorship. Restore is atomic, preserves pending review, and rejects
conflicts. Restoring old backups can resurrect deleted items: there are no deletion
tombstones. See [the exact security contract](PRIVATE_COMPLETION.md).

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
The explicitly started folder source checks selected files while the visible
gallery is open. It does not collect after the browser closes or automatically
surface evidence during distress. The review inbox does not grant connector or library
access. The optional native companion has its own bounded Photos source and
active-session observer, or separately consented native background source,
not general account mining. Any further collector must
preserve the distinction between review and explicitly trusted-source saves,
and add explicit source permissions, revocation,
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
