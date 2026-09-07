# Native collector contract and current limits

Status: native collector adapter integrated with the single `VaultAuthority`.
Native-device acceptance and public distribution remain separate gates. `PhotosModel.attachVault`
accepts the single authority created by explicit native storage setup; it does
not create storage or grants by itself. This document is not a release claim.
The existing Photos v1 export remains unchanged.

## Mac collection and consent

Reuse `PhotosModel` resource reading, PhotoKit observer, limits, original receipt,
HEIC derivative labeling and generation cancellation. A persistent source records
an opaque ID, exact selected scope/date floor, consent revision, paused state and
separate background choice. Never persist iCloud download consent or OCR output.
Startup checks current OS authorization without prompting; only an explicitly
active background source can resume. A missing album or lost grant pauses the
source without falling back to Recent Photos or expanding scope.

An explicit background choice permits the native process to continue when its
window closes; a menu-bar control reopens the window, pauses collection or quits.
Quitting stops collection. macOS suspension and sleep are not reliable execution
windows; reconcile the bounded selection when the app wakes. Launch at login is
a separate explicit choice through `SMAppService.mainApp`, with actual OS status
shown and registration errors preserved as a disabled/unavailable result. Never
register services during tests or infer this grant from background consent.

Selected folders use an owner-picked, read-only security-scoped bookmark for one
exact directory. Resolve without UI or mounting; stale/unavailable bookmarks
require owner reconnection. Scan top-level regular files only, with bounded
enumeration, validated image signatures, per-item and aggregate size limits.
Reject symlinks, aliases, directories, placeholders and nonlocal resources before
opening; never hydrate cloud placeholders. Hold and balance security-scope access
only around a scan. Detect changed files during reading and retry in a later scan.
Do not infer occurred dates from filenames or modification times.

## Shared vault boundary

The shared vault is the sole durable candidate store and consent authority.
Collector storage must not become a second saved-Proof database. A candidate
append carries source ID, captured consent revision, stable resource fingerprint,
original SHA-256, rendition digest and source-faithful receipt. An atomic write
rechecks active consent/revision, dedup ledger and capacity before appending.
Default sources remain pending. Trusted-folder automatic save requires a separate
exact-source approval contract; collector code cannot mint that permission.

Pause increments the revision and cancels readers before further commits.
Revoke removes the grant/bookmark and fences queued callbacks. Deleting a candidate
retains its handled digest under that grant so it cannot silently reappear.
Clearing the vault first revokes all sources and fences callbacks, then deletes
content. Restoring data never restores active grants. Failed durable writes stop
collection rather than advancing the handled ledger or claiming success.

Keep current 50-item / 47 MiB retained-media capacity until the lead changes the
common limit. Full queue pauses with aggregate status; no silent eviction or
unbounded backlog. Dedup history must itself have a cap; reaching it pauses for
owner action rather than discarding tombstones. The existing most-recent-50
Photos query is a bounded window, not a complete library backfill guarantee.

Existing `/v1/review` transfers a prepared snapshot once and cannot acknowledge
durable web receipt. Do not delete native queue bytes on HTTP send success.
Any new acknowledgment must identify the exact batch and digests and be committed
by the receiver first. Transfer consent does not approve candidates as Proof.

## Platform claims and release gates

Windows and Android currently have explicit browser-selected media intake and
supported-format import, subject to actual browser/device validation. Browser
installation does not provide a closed-browser folder collector. There is no
Windows service, Android MediaStore worker, or Android share target in this lane.
Those require separately implemented native permission/lifecycle integrations and
device receipts before advertising native collection.

Mac acceptance uses synthetic media in an explicitly authorized test library or
folder: first-launch no read/prompt; selected scope only; closed-window collection;
restart active versus paused state; revoke while a read/commit is pending; missing
album; queue overflow; duplicate after deletion; sleep/wake reconciliation; stale
bookmark; symlink swap; cloud placeholder refusal; disk-write failure; and login
registration success, denial, external disabling and unregister. Unit tests and
browser tests do not prove those OS behaviors. Real user media remains untouched.

Public release still requires a reviewed clean commit, exact architecture receipt,
Developer ID signature with hardened runtime and secure timestamp, notarization
result and clean log, stapling, Gatekeeper assessment, then clean-machine first
launch and permission/revocation checks. Existing `package-release.sh` gates
signing/upload by explicit action approval and artifact hash. Do not change that
boundary or label ad-hoc builds publicly ready. Signing, upload, installation,
source activation and login registration need action-time confirmation.

API references: [Apple main-app login service](https://developer.apple.com/documentation/servicemanagement/smappservice/mainapp),
[registration](https://developer.apple.com/documentation/servicemanagement/smappservice/register()),
[bookmark resolution without UI](https://developer.apple.com/documentation/foundation/nsurl/bookmarkresolutionoptions/withoutui).


## Implementation receipts and remaining integration

`FolderCollector` scans at most 200 top-level entries and emits at most 50 new
images / 47 MiB per pass. Handled digests do not consume the new-item pass limit.
It rejects aliases, symlinks, nonlocal volumes, ubiquitous items and `SF_DATALESS`
files, opens with `O_NOFOLLOW`, and rechecks device/inode/size/timestamps around
bounded reads. Cloud-provider race behavior still needs real-device verification.
There is no cloud hydration API call. Filesystem read failures skip the item;
source resolution/enumeration/receiver failures stop and durably pause the source.

`PhotosModel` uses current grant revisions on every append, persists Pause,
revokes on Disconnect, and polls/observes only an explicitly started source.
Foreground Photos preparation still produces the unchanged export batch.
Background Photos preparation omits OCR and the ephemeral thumbnail batch;
new media goes to the vault's pending queue by default. An explicitly confirmed
trusted Photos source can save new items under its exact source/date/category/tag
approval. The native UI defaults to review mode. Trusted-folder approval displays the exact
resolved folder path, owner-chosen category and tags in a separate confirmation;
it persists a paused trusted grant and never promotes existing pending items. Quit
stops in-process work without rewriting source consent; an active background
source can resume at the next launch, while explicit Pause remains persisted.
Closing the window may keep the process running for separately granted client
connections or reminders as well as background collection. Only the source's own
background consent permits continued collection; foreground-only sources pause.
Login registration remains a separate native action.

Focused synthetic tests cover byte/receipt fidelity, folder top-level isolation,
symlink rejection, bounded enumeration, stop-on-receiver-failure, login startup
without registration and actual-status handling after OS action failure.
No real Photos library, folder grant, login item, notification permission or
release action was used. The integrated Mac build wires one vault instance into
native setup and transport. Synthetic integration receipts remain distinct from
actual OS source permission, restart, notification and public distribution checks.
