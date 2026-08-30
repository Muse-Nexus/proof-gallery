# Private companion, backups, and source-backed reading

## Full encrypted backup

**Back up** downloads `.proof`, containing a consistent snapshot of both local
stores: saved Proof and pending photos/clips with their **saved** notes, source
receipts, and revisions. Unsaved editor fields must be saved or discarded first.
It is not cross-device sync or encryption of active IndexedDB storage.

Binary envelope v1: ASCII `PROOFENC`, version byte `1`, big-endian uint32
PBKDF2 iteration count `600000`, random 16-byte salt, random 12-byte IV, then
AES-256-GCM ciphertext and 128-bit tag. The complete 41-byte header is authenticated
as additional data. PBKDF2-HMAC-SHA256 parameters are fixed and checked before
derivation; passphrases require 12 characters, maximum 1024 UTF-8 bytes, and are
never stored/logged. No metadata is exposed outside encryption. Every export
uses a fresh salt/IV. Forgotten passphrases have no recovery mechanism.

Plaintext inside the envelope is backup format v3 (`items` plus `pending`),
maximum 144 MiB encoded, 48 MiB saved media + 48 MiB pending media, 10,000 saved
items and 100 pending items. Legacy v1/v2 JSON remains importable. All media,
privacy, schema, digest, and companion receipt checks precede one transaction
over both stores. Same-state identical IDs skip; different content/revisions or
saved/pending state conflicts abort everything. Pending is never auto-approved.
Distinct drafts are not silently deduplicated by image hash. Restoring old
archives can resurrect deleted items because there are no deletion tombstones.
Source metadata is not a provider-signed assertion of truth.

## Optional same-Mac connection

In the native companion, **Connect to Gallery on this Mac** pauses Photos and
prepares a snapshot. Pair in the web gallery with its temporary `port.token`
code. No token in URLs, browser storage, logs, analytics, or source files.

Server: explicit `127.0.0.1` bind, random port, 256-bit bearer token, exact Host
and production Origin, five-minute expiry, 8 simultaneous connections, 8 KiB
headers, 256 KiB request body, 10-second request-read deadline, 60-second operation
deadline. Only capabilities, one prepared review download, saved-text matching,
and source-backed reading endpoints exist. No path/file endpoints, cookies,
redirects, LAN binding, arbitrary origins, cloud AI, or Photos-control API.
Stop/Pause/Disconnect/clear/quit revokes listener/connections and cancels work.
Stopping cannot retract bytes already received. Native prepared photos are not
deleted or marked backed up by a transfer. Browser import still requires the
existing pending-only validator and atomic transaction; approval remains separate.

The web CSP permits only `http://127.0.0.1:*` in addition to existing origins.
`upgrade-insecure-requests` is removed so loopback HTTP is not rewritten to TLS;
other network destinations remain HTTPS-restricted. Chrome may require local
network access permission; other browsers may deny it. Never disable browser
security to make pairing work. Use the review-file fallback. A native HTTP test
is not proof of browser permission/CSP compatibility.

## Meaning and reading

Opt-in meaning search sends only current-owner, personal, saved Proof text after
category/tag filtering to the paired Mac. No pending photos or ordinary memories
are included. Apple English sentence embeddings are accessed serially. Limits:
100 sources, 4,000 characters each, 120,000 aggregate characters, and 256 KiB
serialized request. Return up to six matches, retaining relevance order and
literal source/date display. Unsupported language/model or size fails clearly;
the existing lexical search remains available, never a hidden cloud fallback.

Optional reading selection requires macOS 26+, eligible hardware, and available
Apple Intelligence. One on-device model selects up to three IDs among at most six
explicitly selected saved notes (6,000 aggregate characters). Code then displays
the **full original notes**, deterministic dates, and sources. No generated
emotional conclusions, clipped negation, fictional transitions, or saved AI
evidence. The draft is a derived reading only. Cancellation, source edits,
deletions, or pairing changes invalidate stale work. Images never enter these
models. The trusted prompt includes the mental-health constitution verbatim.

Never use proof to invalidate pain, create guilt, demand optimism, or argue
that the user should feel better. Use it only to restore evidence that depression
has hidden. Retrieval remains user-initiated, never triggered by acute distress.

## Distribution gates

Native version 0.2.0/build 4 includes Recent Photos, local OCR, optional one-shot
iCloud downloads, and pairing. macOS 14+ retains non-generative functions;
FoundationModels code is availability-guarded. Android/PC use browser file/folder
selection and encrypted backup transfer, not a native collector.

`build-app.sh` defaults to an ad-hoc local build. A trusted public installer needs
an authorized Developer ID Application identity, hardened runtime, notarization,
stapling, and actual Gatekeeper assessment. `package-release.sh` prepares a signed
DMG but refuses to notarize without a separate explicit flag and keychain profile.
Do not label the local development build a public signed release. Browser pairing
permission/CSP checks and signed-app testing remain release gates.

References: [WebCrypto AES-GCM](https://www.w3.org/TR/2017/REC-WebCryptoAPI-20170126/#aes-gcm),
[OWASP PBKDF2](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#pbkdf2),
[Apple embeddings](https://developer.apple.com/documentation/naturallanguage/nlembedding),
[Apple on-device model](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel),
[loopback binding](https://developer.apple.com/documentation/network/nwparameters/requiredlocalendpoint),
[Chrome local network permission](https://developer.chrome.com/blog/local-network-access),
[Apple notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).
