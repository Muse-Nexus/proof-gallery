# Automatic sources

The browser folder source reduces repeated picking while retaining private
review. It never adds to saved Proof, assigns personal meaning, or initiates recall.

## Behavior

- Local mode only, in a secure context with `showDirectoryPicker` support.
  Other browsers retain the ordinary file picker.
- Choose a folder through the browser's read-only picker, then explicitly
  Start. Choosing alone does not scan media.
- Checks run about once a minute while the gallery is open and visible.
  Check now requests an immediate pass. Scans do not overlap.
- Pause requires explicit Resume. Hidden-page or busy/editor suspension can
  resume only an already-running source.
- Disconnect, leaving the gallery for About or another storage mode, reload, or closing ends the
  connection. The directory handle exists only in memory; choose again next time.
  Switching between Sources and Saved Proof keeps an already-running source active.
- Disconnect drops the handle but does not revoke a permission the browser
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
saved and pending stores. Capacity failures remain retryable after room is made.
After 2,000 handled file versions the connection stops; reconnect explicitly to
begin another bounded session.

Cancellation guards file reads, validation, and the pending-store transaction.
A late read cannot start a write after cancellation. A transaction that already
completed remains committed; Pause cannot retract it.

## Permission and privacy

The browser grant may cover a directory and children; the app enforces the
narrower top-level scope. It requests no write permission and never mutates
original files. Handles are not stored in backups, browser databases, URLs,
logs, or remote services.

A folder can be managed by another program, including a sync client. Opening
a cloud placeholder may cause that program or the OS to download it. Choose
already-local media if this matters; the source is not a cloud account connector.

Original bytes can contain EXIF metadata. Imported files live unencrypted in
the browser profile; encrypted full backups include pending review. The source
sends no evidence to external models, analytics, or other services.

## Development

Use synthetic handles and media to test no auto-start, permission denial,
scope/limits, deduplication, capacity, cancellation during async reads and
validation, hidden-page suspension, and pending-only writes. Distinguish manual
Pause from temporary suspension. No daemon or closed-browser collector is installed.

See [Chrome's File System Access documentation](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access).
Behavior is feature-detected, not inferred from a device name. The independent
[Mac Photos companion](COMPANION.md) keeps its own source and permission flow.
