# Automatic sources

The browser folder source offers two approval styles: private review by default,
or automatic saving after the owner explicitly confirms one exact trusted folder.
Neither mode assigns personal meaning or initiates recall.

## Confirming a trusted source

Choose a read-only folder, select the unchecked automatic-saving option, choose
a category and optional tags, then confirm. The grant covers existing and future
supported media directly in that folder, not subfolders, other directories,
accounts, or an entire photo library. Use a dedicated folder whose contents you
want in Proof. Categories and tags are the user's source defaults, not AI findings.

Auto-saved items contain original validated media, filename/digest, known source,
and a source-consent receipt. The title is the filename, not a claim about the
photo. Text, occurred date, people, and projects remain blank. Imported/modified
time never substitutes for an unknown occurred date. Edit items to add context.
Existing pending candidates are not promoted by source approval.

## Behavior

- Local mode only, in a secure context with `showDirectoryPicker` support.
  Other browsers retain the ordinary file picker.
- Choose through the browser's read-only picker, then Start review checks or
  explicitly confirm trusted automatic saving. Choosing alone does not scan media.
- Checks run about once a minute while the gallery is open and visible.
  Check now requests an immediate pass. Scans do not overlap.
- Review-mode handles stay in memory and are lost on reload. Confirmed trusted
  handles and source grants are remembered in this profile's IndexedDB. On reopening
  the gallery an active trusted source can resume only after a noninteractive read
  permission check succeeds. A missing permission requires explicit Reconnect;
  startup never prompts, picks another folder, or falls back to broader scope.
- Pause requires explicit Resume; a trusted source's pause survives reload.
  Temporary hidden-page or busy/editor suspension may resume an active source.
- Leaving for About/another storage mode or closing stops the running check.
  Switching between Sources and Saved Proof keeps an already-running source active.
  Forget removes the remembered handle/grant and stops future automatic saving.
- Disconnect/Forget does not revoke a permission the browser
  remembers or delete staged items. Browser site settings manage OS/browser grants.

## Scope and limits

Only immediate files are considered; subfolders are never traversed. Every
entry counts toward the 250-entry scan cap, including directories and unsupported
files. A pass handles at most 50 files / 48 MiB. Use a small dedicated folder:
oversized directories must be split or imported manually.

Existing validation applies: JPEG, PNG, WebP, GIF, MP4, WebM; 10 MiB per file,
container signatures, and SHA-256 deduplication. The inbox has a separate
100-item / 48-MiB limit. Modification times are bookkeeping, never occurred dates.

Handled file versions are tracked for the connection so unchanged files do
not reappear every minute after removal from review. Reconnecting or changing a
file creates another discovery opportunity. Duplicate bytes still skip across
saved and pending stores. Trusted sources also retain up to 2,000 processed content
hashes in their grant, so unchanged bytes do not reappear after an individual
auto-saved item is deleted or the page reloads. A newly confirmed source is new
consent and can re-import old files. Capacity failures remain retryable after room is made.
After 2,000 handled file versions the connection stops. Review-mode connections
can reconnect for another bounded session. A trusted source's durable hash ledger
survives Resume/Reconnect; review its scope, Forget it, and explicitly confirm
fresh consent to reset that ledger. Previously deleted files may then re-import.

Automatic saving has the existing 10,000-item / 48-MiB saved-media limits.
Each automatic commit checks the current owner-private active grant ID/revision
inside the same transaction as the saved items, pending-digest check and processed
hashes. A stale tab cannot write after Pause/Forget has committed. Rejected files,
digest duplicates and capacity failures never silently enter saved Proof.

Cancellation guards file reads, validation, and the eventual store transaction.
A late read cannot start a write after cancellation. A transaction that already
completed remains committed; Pause cannot retract it.

## Permission and privacy

The browser grant may cover a directory and children; the app enforces the
narrower top-level scope. It requests no write permission and never mutates
original files. Only explicit trusted consent stores a handle in the browser
database. Handles and live source grants never enter backups, URLs, logs, or remote
services. Backup/restore preserves saved item receipts but never restores approval
or reconnects a source. Clear saved Proof atomically forgets source consent too;
pending review remains. It cannot erase original files or previously exported copies.

Automatic arrivals show an aggregate notice, not evidence content. Existing
search, story, and image previews stay unchanged. Newly saved items become visible
when the owner requests a refresh, opens Saved Proof, or submits another search.

A folder can be managed by another program, including a sync client. Opening
a cloud placeholder may cause that program or the OS to download it. Choose
already-local media if this matters; the source is not a cloud account connector.

Original bytes can contain EXIF metadata. Imported files live unencrypted in
the browser profile; encrypted full backups include pending review. The source
sends no evidence to external models, analytics, or other services.

## Development

IndexedDB version 3 adds `source_grants`; existing saved and pending records stay
unchanged. Old tabs may need to reload to release their previous connection.
Any web rollback must retain v3-compatible database opening: shipping older code
that requests version 2 will fail for upgraded profiles. Never delete or
down-version user storage to roll back the UI. Source receipts in saved items
are historical and survive backup/restore; they are not active grants.

Use synthetic handles and media to test no auto-start, permission denial,
scope/limits, deduplication, capacity, cancellation during async reads and
validation, hidden-page suspension, review-by-default, explicit consent, restart
permission checks without prompts, persistent Pause, cross-tab revision races,
revoke/Clear, pending isolation, deleted-byte suppression, and backup exclusion.
Distinguish manual Pause from temporary suspension. No daemon, reminder delivery,
MCP retrieval service, or closed-browser collector is installed by this feature.

See [Chrome's File System Access documentation](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access).
Behavior is feature-detected, not inferred from a device name. The independent
[Mac Photos companion](COMPANION.md) keeps its own source and permission flow.
