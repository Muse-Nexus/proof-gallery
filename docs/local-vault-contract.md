# Native local Proof authority — contract v1

This is the first integrated Mac milestone. It is not Windows/Android background
collection, native public distribution, or complete cross-platform delivery.
The lead owns transport, app setup, integration, acceptance, and release. Nothing
in this implementation activates a source, permission, login item, or notification.

## Authority and storage

`CompanionVault` uses system SQLite, Foundation, Security and existing
`CompanionCore`. It adds zero third-party packages or portable runtimes. Swift
remains the existing macOS 14+ companion platform; Windows would need a separately
packaged native adapter/runtime and verified file ACLs, not a claim of parity from
this Mac implementation. A portable Node service was considered but deliberately
not implemented alongside this authority.

The running companion alone opens `ProofVault(directory:collectionID:ownerID:now:)`.
There is no default path or automatic browser migration in the library. The app
chooses a path only through its explicit setup flow. The parent must exist; the
library creates only the final directory. It rejects symlink path components,
nonowner files/directories, weak existing permissions, nonregular/multiply-linked
files and unsafe SQLite sidecars. Directory mode is 0700, database/lock mode 0600.
A lifetime exclusive file lock excludes another process, including a direct-DB
MCP helper. Schema version, owner and collection identity are checked on reopen;
unknown schema fails closed. Corruption must not create a replacement empty vault.

**Active SQLite storage is unencrypted.** These permissions isolate OS accounts,
not applications running as the same user. FileVault is an owner OS setting and
is not enabled, checked, or implied here. SQLite secure deletion does not promise
forensic erasure from snapshots, storage devices or owner-created backups. No
credentials, evidence, source selections or tokens are logged by this library.

SQLite transactions contain record metadata and media BLOBs together. Writes,
approval, revision checks, source consent checks, capacity and processed hashes
commit together or roll back. A recursive authority lock also spans authenticated
gallery operations. There is no saved-result cache to invalidate.

Limits: 10 MiB/media; 50 items and 47 MiB/source batch; 100 pending and 10,000 saved;
48 MiB/media and 16 MiB/record JSON per state; 100 source entries and 100 client
entries; 100,000 handled hashes and 100,000 consumed reminder claims. Overflow
fails without deleting old evidence or committing processed hashes. These are
bounded first-milestone limits, not unlimited-library claims.

## Source and evidence contract

`VaultTypes.swift` is the public Codable/Sendable interface. `VaultRecord` has
collection/id/revision, explicit `pending` or `saved`, exact `VaultFields`, immutable
provider receipt/provenance, media descriptor, approval receipt, and added/updated
times. Optional source facts remain absent/nil; added time is never an occurred date.
The record has no filesystem URL, worth score, inferred identity, or generated
emotional meaning. Relevance is a search concern, not evidence metadata.

The existing Photos ReviewPackage v1 is unchanged. An adapter explicitly maps it
to independent `VaultProviderReceipt(version:1, provider:photos|folder, sourceID,
assetIdentifier?, originalFilename, originalSha256, representation, captureDate?,
timeZone?, scope)`. A folder receipt must never be labelled Photos. Original and
JPEG-preview representations retain both transported and original digests. MIME,
bounded container signatures, SHA-256, receipt provider/source identity, dates and
capacities are validated. The check does not promise codec playback support.

`createSourceGrant`, `updateSourceGrant`, `pauseSource`, `revokeSource`, and
`sourceGrants` are owner-only **in-process** APIs. A native selected-source UI owns
the bounded bookmark/selection payload in `configuration.selection`; it never goes
to browser/MCP responses or backups. Source identity/provider cannot be changed
under an existing grant. Review and background-off are defaults. Trusted source
saving requires explicit native source-level confirmation and owner-selected
category/tags. Grant creation returns an active grant; native UI must not ingest
until its explicit Start. Pausing/revoking rotates the revision; revoke erases the
selection payload. Unchanged resume preserves the original confirmation timestamp.

`ingest(sourceGrantID:revision:inputs:background:isCancelled:)` checks live consent,
revision, pause/revocation, separate background permission, and cancellation inside
one transaction. It accepts no approval claims. Default intake stays pending;
trusted intake writes blank title/text/person/project and owner source category,
tags and label. Previously pending items never auto-promote. A missing capture
date cannot be replaced with an incoming source item's invented occurred date.

Both original and transported hashes enter a handled ledger. Delete/removal adds
tombstones; these survive restart, revocation and Clear. Reconnecting a source
cannot silently revive deleted bytes. **Clear removes saved/pending records,
source selections/grants, clients and reminder consent; it retains hashes and
consumed claims.** Explicit manual save is an intentional new owner action and
can re-add bytes; no automatic collector gets that bypass.

## Gallery and assistant boundaries

The lead's v2 bridge owns HTTP framing/envelopes. Keep its route/schema version
separate from SQLite version 1 and the existing v1 Photos package. Bind only IPv4
loopback, use exact Host and approved browser Origin checks, bounded bodies,
no cookies/redirects/cache/logging, and separate client kinds. No route exposes
arbitrary SQL, paths, Photos commands, source configuration or token minting.

Native UI calls `issueClient(kind:scopes:expiresAt:)`; token is 32 random bytes
hex-encoded and returned once. Only its SHA-256 is stored. Client lists never
return secrets. Every grant is collection-scoped and expiring (up to 30 days),
with explicit revoke. There is no default permanent grant. Installing an assistant
or pairing a legacy bridge does not create this permission.

For gallery routes, `withClient(token:kind:.gallery,scope:...,collectionID:operation:)`
holds authorization and synchronous CRUD inside one authority lock. `galleryReview`
permits pending review/manual mutations; `savedMedia` is separate from text-only
access. The bridge must choose the scope matching each route, and must not expose
owner-only grant, reminder or source methods. Manual save/stage, edit, approve,
delete and clear operate on this same store with revision fences. Importing a
browser copy is an explicit bounded action; a claimed browser approval is not a
native source grant. Ordinary incoming copies should use pending review.

Assistant `search(token:collectionID:query:)` and `get(token:collectionID:id:)`
require assistant-kind savedText permission. Search is labelled `local-literal-text`,
requires a nonempty query up to 500 UTF-8 bytes, supports category/tag filters, and
accepts a result limit of 3–10 (fewer matches return fewer; never pad). It reads only
saved records in this collection and returns full literal notes, sources and known
dates. It performs no semantic inference or cloud call. Any optional on-device
matching lives in the lead's separately bounded bridge flow.

`readMedia` requires savedMedia plus savedText and the current record revision.
Pending items cannot be read by assistants. The in-process `media(id:revision:)`
is for owner/gallery use under the matching authenticated scope; it has no network
route of its own. Lead-owned `ProofMCP` is a stdio proxy and depends only on
CompanionCore, never CompanionVault or Photos. Text-only results may contain
source/filename/digest metadata, but no media bytes or source bookmark selections.
Retrieval is requested, never triggered by inferred distress.

## Durable reminder claims

ReminderPolicy types remain in CompanionCore. `reminderConsent`,
`setReminderConsent(_:expectedRevision:)`, `reminderLedger`,
`claimReminder(permission:observedAt:expectedRevision:)`, and
`isReminderClaimCurrent(_:)` are owner/coordinator in-process APIs. Consent owner
and collection are checked, and the vault allocates monotonic revisions.

Claim evaluates the current consent, eligible saved records, fresh permission
observation and durable ledger in a single transaction, then consumes the claim
before returning a generic notification intent. A crash, OS error or unknown
delivery never reopens it. Claim history and last-claimed time survive Pause,
revision changes and Clear. No evidence payload enters the notification intent.

After any await, the adapter must immediately recheck `isReminderClaimCurrent`
before OS submission. It rejects Off/Pause, stale consent, missing saved evidence,
future/rollback claims, claims older than 30 seconds, and absolute-minute changes.
The adapter also owns cancellation/removal of pending or delivered notifications
on Pause/Off; the database alone cannot retract an OS notification. Permission
grants and actual delivery require separately authorized native UI/device checks.

## Verification and remaining integration gates

### Encrypted native content backup

Owner-only `exportEncryptedBackup(passphrase:) -> Data` takes a coherent saved and
pending snapshot, verifies media integrity, then encrypts in memory.
`restoreEncryptedBackup(_:passphrase:) -> VaultRestoreResult` decrypts and validates
the entire archive before an atomic write. Both are library methods with no file
picker, default path, network route, or automatic data access. UI must run expensive
crypto off the UI thread and bounds-check an archive before loading its bytes.

Encryption uses the browser's existing PROOFENC v1 binary framing: 41-byte header,
600,000 PBKDF2-HMAC-SHA256 iterations via system CommonCrypto, 16-byte random salt,
12-byte random nonce, AES-256-GCM with a 16-byte tag, and the full header as
authenticated additional data. A synthetic WebCrypto vector checks byte-level
compatibility. The native plaintext cap is 192 MiB (archive cap adds 57 bytes),
allowing the native store's media base64 expansion and bounded metadata. Browser
decrypt has a separate 144 MiB cap. Passphrases require at least 12 UTF-16 code units
and at most 1,024 UTF-8 bytes; the library persists neither passphrases nor keys.
Temporary mutable password/key/plaintext buffers are cleared where possible;
Swift/CryptoKit memory-copy behavior is not a promise of forensic RAM erasure.

The inner schema is **distinct**: `proof-gallery-native-content`, version 1,
exportedAt, sourceCollectionID and entries of record plus optional media. Native
and browser archives are not interchangeable restore formats. Source bookmarks,
source/client grant tables, tokens, reminders, notification permissions, handled
hashes and claim ledgers are never exported. Provenance and historical approval
receipts remain literal evidence metadata; encryption detects damage but does not
independently authenticate historical claims made by the archive's creator.

Restore requires no records, source entries, clients or reminder consent in the
receiving authority, rechecked inside the transaction. It preserves item IDs,
literal fields, media, saved/pending states, source receipts, historical approval,
and original added/updated dates. It allocates fresh revisions and maps collection
identity to the receiver. A separate `restoreReceipt` truthfully records original
and last-source collection plus restore time without altering original provenance.
Historical source approval never recreates a grant. Existing tombstones/consumed
claims are retained; explicit owner restore is an intentional content action and
does not enable automatic intake. Unknown schema/extra permission fields, excessive
nesting, malformed/corrupt media, duplicate IDs, invalid categories and capacity
overflow reject the whole archive. Wrong passwords/tamper return a generic archive
error without partially restoring content.

### Checks and integration boundaries

Synthetic `ProofVaultTests` cover transaction rollback, approval/pending isolation,
source revision fences, exact notes/receipts, MIME/hash/date checks, capacity,
permissions/symlinks/exclusive authority, hashed expiring client grants,
cross-vault isolation, deletion/restart/no-resurrection, reminder claims across
restart/revision/clear, stale observations, live deletion, clock rollback and
missed-minute dropping. No real Photos, files, browser profiles, app-support data
or external evidence calls are used.

The vault source commit is tested independently of the lead's MCP target wiring.
Full `bun run check`, frozen Deno checks, combined native/bridge/UI tests and signed
distribution acceptance belong to lead integration. This worktree installs no web
dependencies. Native backup file pickers and real-device export/restore acceptance
belong to lead integration; browser encrypted backups remain a separate collection.
Never copy a live SQLite file as if that were a consistent encrypted backup.
