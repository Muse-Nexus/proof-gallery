# Web access to the native Mac vault

Choose **Connect native vault** and paste the gallery connection code created by
the companion. The code identifies one port, private grant token and collection.
The page contacts only `127.0.0.1` on that Mac. This is a separate collection view;
it does not import, merge, restore or synchronize the browser-local database.
Connecting checks permission but does not open evidence. Choose **Open saved
Proof** or **Open pending review** explicitly.

The native companion is the durable authority. A gallery grant allows saved
text/media access and pending review; assistant-only grants are rejected here.
This view cannot create grants, change sources, enable auto-save, clear the vault,
start login items or enable notifications. Those choices remain native owner UI
operations. Connecting the browser is not permission for any of them.

## Reading and review

Saved and pending records have separate views. Search uses saved records only and
preserves the returned relevance order and full literal words, including negation.
The current native search considers up to the newest 100 category/tag-filtered
saved records; its label identifies on-device meaning matching or literal-text
fallback. Fewer than three actual matches is valid. Clear the query and browse
pages to access the entire collection. Search queries are limited to 500 UTF-8
bytes, not 500 characters.

Dates, source labels, original filenames, original/preview hashes and source
receipts stay intact. Unknown dates remain unknown. A JPEG preview is explicitly
labeled as a derivative with the original remaining in Photos. Historical restore
receipts are displayed with provenance; they grant no current permission.
Attachments load only when opened and must match the returned record's byte
length, SHA-256 and supported MIME signature before a temporary object URL exists.

Add can save an owner-entered note and optional selected media directly. Review
requires an explicit category choice and **Approve and save Proof**. Editing sends
only editable fields plus the current record revision: existing media and provider
receipts are preserved by the authority. Removal asks for confirmation and leaves
original source files untouched. This UI does not replace existing attachments;
add a separately chosen item if different media is needed.

## Connection lifetime and privacy

Tokens stay only in this page's memory and the Authorization header; never URLs,
localStorage, IndexedDB, backup files or app caches. Requests omit credentials and
referrers, disable caching and reject redirects. The public service worker does
not cache loopback responses. Responses are streamed with bounds; no provider
errors, tokens or source paths are echoed as diagnostics.

Disconnect, expiry, failed authorization and leaving the view abort requests and
clear evidence, edit drafts, temporary media URLs and connection state. Hiding
the page removes displayed evidence and temporary media URLs immediately, while
keeping an unsaved editor draft and its selected File only in page memory. Returning
checks current permission before a neutral screen; **Resume draft** is a separate
owner action with another permission check. Neither check retrieves evidence or
reveals the draft automatically. Existing edits keep their original record revision
so stale saves conflict instead of overwriting newer edits. Explicit navigation or
replacing/canceling a draft confirms discard; browser unload warns of an unsaved
draft. A save interrupted by hiding may already have completed, so a resumed draft
warns the owner to inspect saved Proof before repeating the write. While visible,
an auth-only check every 15 seconds bounds detection of revocation when idle; each
owner action also revalidates. This is polling, not instantaneous cross-process
revocation. The native authority separately checks every request. No evidence is
retrieved by the periodic permission check.

Writes are never automatically replayed. If a connection fails after submission,
a change may have completed; reconnect and inspect before trying again. Native
storage is OS-account-local and not encrypted by Proof. Browser backups remain a
separate collection and do not include the native vault.

## Verification and remaining gates

Focused synthetic tests cover strict connection parsing, no automatic retrieval,
owner/collection and pending isolation, full literal text, malformed/expired
grants, query byte bounds, bounded streaming, hash/MIME verification, hidden-page
redaction, in-memory text/File preservation with explicit resume and fresh permission
checks, revocation, pending approval and late-result
suppression. Run:

```sh
bun run test -- src/lib/native-vault.test.ts src/components/NativeVaultGallery.test.tsx
```

This page still requires integrated browser/native server verification on an
allowed origin and actual Mac browser permission checks. A loopback code on a
phone or another computer cannot reach the Mac. This implementation is not a
Windows/Android native collector or a cross-device sync release. No real evidence,
OS permission, installation or production release is needed for the fixtures.
