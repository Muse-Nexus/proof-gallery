# Everyday access: review and release boundaries

This slice makes the existing private gallery easier to use without treating a
browser installation, an AI connection, or file access as permission to scan a
person's life. Production availability must be checked against the released
commit, not this document's presence on a development branch.

## Capture and finding

- Add Proof begins with an exact message or short note. Optional visible word
  cues help organize it; manually edited fields remain the owner's choice.
  Category and tag suggestions skip sentences containing the existing negation cues; literal notes and explicitly chosen tags remain unchanged.
- A focused paste/drop area accepts literal text or one validated attachment.
  It does not read the clipboard in the background or download pasted links.
- Date, source, tags, person, and project are under an expandable details area.
  Unknown facts remain unknown.
- **Recently added** sorts by collection creation time, separately from
  **Newest event first**. Opening newly auto-saved Proof explicitly clears old
  category/tag filters so those filters cannot hide the arrival. Merely receiving
  an automatic arrival changes aggregate status, not the displayed evidence.
- Saved search can use a confirmed folder's historical label as source context.
  A folder name is not an inferred identity, event date, or interpretation of a
  photo. Story excerpts remain full original notes, not source-label summaries.

## Storage and recovery

Saved media has a 48 MiB / 10,000-item safety limit; pending media has a separate
48 MiB / 100-item limit. Creation, attachment replacement, pending approval, and
restore enforce aggregate saved capacity atomically. Older oversized libraries
remain readable/editable without growth. No original is silently compressed or
deleted. Browser storage quotas may be lower, and large text can make a full
single-file archive too large even when media is below the media limit.

The browser storage disclosure shows aggregate media/count usage and warnings,
not device free space or a claim that the active gallery is encrypted. Recovery
parts allow a larger legacy library to be exported in bounded chunks. Each click
encrypts one independently restorable version-3 archive. Numbered filenames
include a shared export identifier and total part count. Keep every part and the
passphrase; a prepared download is not proof that the file finished downloading.

Canceling or encountering changed upcoming records reports an incomplete export
and leaves original data untouched. Never tell someone to remove data before
verifying their recovery files. Restore is atomic per part, **not across a whole
set**; normal collection limits still apply, so an oversized library cannot be
reassembled in one browser collection. A larger durable vault remains separate
work. Source handles, consent grants, credentials, and tokens are never exported.

## Connections are explicit

Sources explains the dedicated drop-folder pattern for an already configured
Drive/Dropbox sync app. Choosing that folder does not connect the whole account,
and provider folder sync is not gallery sync or a backup. Existing top-level,
read-only, bounded scanning and explicit trusted-folder approval remain intact.

The local gallery is not automatically visible to ChorOS, Claude, Codex, or an
MCP client. ChorOS Proof is a separate owner-private collection. New ChorOS
`proof_search` / `proof_get` tools, if released there, do not bridge this database.
The owner must choose a local companion bridge or explicit selected-item private
sync before a cross-storage assistant connection is implemented or enabled.
Temporary Mac pairing retains its existing request-only, five-minute scope.

## Installation is not autonomous collection

An installed web app can provide a simpler launch surface and an offline app
shell. It cannot promise reliable closed-app Photos/folder collection. Cache
only application assets, never evidence, signed URLs, API responses, or POSTs.
Updates must not reload an active editor or review.

OS **Share to Proof** is deliberately deferred: an installed browser share target
with a missing/evicted service worker can send a POST to its website before the
local handler is available. Native share intake is needed before promising that
shared evidence never leaves the device. Existing picker/paste/drop capture does
not introduce that failure path. No manifest `share_target` should be advertised.

## Separate gates, not hidden activation

- A genuine native background collector needs a separate bounded design,
  source permission, start/stop controls, signed distribution, and device tests.
  None is enabled by installing this web app or approving a trusted web folder.
- OS notifications/reminders require their own explicit consent and delivery
  surface. Collection consent does not authorize unsolicited evidence retrieval.
  No acute-distress-triggered evidence, guilt, streaks, or worth scores.
- Screenshot OCR remains machine-read and unverified. Any editable native draft
  and explicit clipboard copy must remain separate from the original evidence,
  candidate export schema, and approval. System clipboard sync may move copied
  content outside the app; disclose that before copying.
- Web, ChorOS migration/functions, and native signing/notarization are distinct
  releases. Do not deploy, migrate production, activate a source, or access real
  owner evidence solely to test this implementation.

Never use proof to invalidate pain, create guilt, demand optimism, or argue that
the user should feel better. Use it only to restore evidence that depression has
hidden. Exact evidence, dates, and sources remain the basis of every result.
