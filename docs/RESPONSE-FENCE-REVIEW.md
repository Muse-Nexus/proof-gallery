# Native response fence: scoped privacy review

Review baseline: root `0f05a9f`, synthetic development only.

The review found one release blocker: client-grant checks alone did not stop
already prepared media/text responses when their evidence was edited or deleted.
The client could remain authorized while subsequent chunks released stale evidence.

## Fix and exact boundary

`VaultService.handle` now returns an internal `VaultPreparedResponse` containing
the unchanged wire JSON plus the request, all required scopes and exact returned
record IDs/revisions/states. These fence fields never enter the network payload.
Pending-review responses capture pending state; media requires savedText,
savedMedia and galleryReview. Saved text, search, create/edit/approve responses
capture their returned records as well. Info and deletion acknowledgements contain
no evidence records but retain their required grant scopes.

`withAuthorizedResponse` checks the current token, kind, collection, required
scopes and every captured record. It holds the vault's existing recursive lock
through synchronous send enqueue. The bridge invokes it before the response
header and every 64 KiB body chunk. A completed revoke, edit, approval/state change
or delete invalidates later chunks; there is no cached-response fallback. A narrow
owner-only `ProofVault.metadata(id:revision:state:)` reads metadata for this check
without repeated media hashing or a full-library scan. It is not a network route.

Bytes already enqueued before an edit/revoke/delete cannot be retracted. This is
a serialized boundary for new sends, not a claim of erasing peer buffers. If a
change occurs after headers, the connection closes with a truncated body; clients
must reject it rather than display partial JSON. No source or grant-management
routes were added, and existing JSON response shapes remain unchanged.

## Deterministic test evidence

`VaultResponseFenceTests.swift` prepares actual service responses and exercises
the same function the bridge uses for each send. It covers:

- Revocation between a first 64 KiB enqueue and later chunks, including issuing
  a different narrower grant without authorizing the old prepared response.
- Deletion before any bytes and between chunks while the client grant stays valid.
- Edits invalidating old media, with fresh requests preserving exact media bytes.
- Pending approval invalidating a prepared review-state response.
- Saved assistant get/search snapshots invalidated by deletion.
- Concurrent revoke serialized against the synchronous enqueue callback.
- Missing media/review scope rejected before attachment preparation.

Run `swift test --filter 'VaultResponseFenceTests|VaultBridgeTests'` in
`companion/macos`. The existing bridge tests also exercise real synthetic loopback
HTTP without source or OS permission access.

The deterministic between-chunk tests simulate enqueue through the real production
authorization callback; they do not claim an observed midstream TCP revocation.
Socket buffering and send-completion scheduling do not provide a deterministic
remote-client barrier here. No timing race or production test-only backdoor was
added to claim that coverage.

## Native automatic-save consent review

No additional release-blocking consent flaw was found in the opened native paths.
Trusted Photos/folder saving requires native confirmation. Start reuses the exact
provider/source/selection and preserves approval time for unchanged configuration.
Resource/OCR awaits are followed by generation and permission checks. Ingest
checks the live grant revision, pause/revoke/background flags and cancellation in
the same transaction as record/processed-hash writes. Trusted intake takes only
owner-selected organization; existing pending records do not auto-promote.

This was source review and synthetic tests, not Photos/library scanning, real
device permissions, signing, deployment, or public release acceptance.
