# Mac Photos companion

The companion makes source discovery less manual without treating every photo
as Proof. It is a source adapter, not a judge of identity, relationships, worth,
or emotional meaning. Optional on-device text recognition can expose words
for review; it never generates categories or treats those words as exact quotes.

## Run locally

Building locally requires macOS 14+ and Xcode with Swift 6 (the package uses Swift
5 language mode). The distributed v0.2.0 companion is Apple-silicon-only; Intel
Macs and Windows can use the private browser intake.
From the repository root:

```sh
cd companion/macos
swift test
bash build-app.sh
open '.build/Proof Photos Companion.app'
```

The app bundle is built under ignored `.build/`; no private library or generated
review file belongs in the repository. The build script ad-hoc signs only that
local bundle. It does not install a login item, request Photos permission, or
change system security settings. Signing identity/permission persistence is not
guaranteed across development rebuilds.

## Owner flow

1. Click **Connect Apple Photos**, then make the macOS permission choice.
2. Choose **Recent Photos** (no Favorites needed), Favorites, or an album and an
   earliest date (default 90 days ago). Optionally enable **Read text in these
   images on this Mac**. Cloud-only originals need the separate **Download missing
   originals from iCloud for this batch** option. Click **Start selected source**. Permission or
   changing the toggle alone never starts a media scan.
3. The app checks at most the most recent 50 still photos in that scope. Photos
   changes trigger another check only in local-only watch mode. An iCloud-enabled
   batch is one-shot, has no observer, and pauses with downloads off when done.
   Pause removes the observer
   and cancels reads. There is no historical pagination or closed-app daemon.
   Capture dates after the current time are excluded. All prepared images stay
   visible unless you choose a review filter; none is ranked by personal value.
4. Remove unwanted candidates or **Export for review**. This pauses reading and
   writes one unencrypted `.proof-inbox.json` file to the location you choose,
   with owner-only file permissions. Keep it somewhere private.
5. In Proof Gallery choose **Photos & media → Import companion review**, not
   Restore. Review categories/details, then explicitly save selected items.
6. Use the encrypted full backup for saved Proof, pending photos, and saved notes.
   A companion review file is not a gallery backup.

Prepared photos are memory-only until export. Closing the window or quitting
pauses collection and asks before discarding an unexported batch. Clearing a
batch keeps session deduplication for the same source; changing the source or
disconnecting resets it. Exported files, browser candidates, and saved Proof
are independent copies and are never remotely deleted by Disconnect.

## Local context cues

Cards show original filename, date from Photos, selected source, dimensions,
and available Screenshot/Live Photo/Favorite flags. These are metadata, not
verified event descriptions. Public PhotoKit does not expose captions or People
labels here. The companion does not read the Photos database, guess identities,
look up unrelated albums, or collect GPS fields.

Optional Apple Vision OCR runs on this Mac, on orientation-correct previews
bounded to 2048 pixels. It runs off the UI thread with best-effort cancellation
plus generation guards. Language correction is disabled. At most 30 detected
lines / 1,600 characters are shown as an **unverified excerpt** which may be
incorrect or incomplete. A failure keeps the image and says text recognition
was unavailable. No detected text says nothing about whether a photo matters.

Search the prepared batch by literal filename, date, selected source, or
machine-read words; **With detected text** is an optional filter, not an evidence
score. Export always includes the entire prepared batch, not only matches.
These OCR excerpts and metadata cue flags exist only in native memory, are
cleared with their photos, and never enter the v1 package, saved Proof, search,
or backups. The existing export still preserves source/date/name/hash receipts.
If you use machine-read words as evidence, verify them against the actual image
and enter the corrected quote yourself during gallery review.

## Permission and fidelity boundaries

- PhotoKit requires the OS `.readWrite` access level even to read. Our app
  enforces read-only behavior; it contains no PhotoKit mutation calls.
- Disconnect does not revoke the OS grant. Revoke in System Settings → Privacy
  & Security → Photos. Revocation is checked before and after each media read.
- Album/date selection is an app-enforced restriction within the OS grant.
  Hidden, shared-source, burst expansion, videos and Live Photo motion are not
  collected. The still component of a Live Photo may be collected.
- Original resources must already be local by default. The separate iCloud
  option allows PhotoKit to fetch missing originals for one bounded batch.
  It is off on launch and reset on Pause, disconnect, export, and completion.
  There is no network-client entitlement or direct HTTP client. A separate,
  explicit same-Mac pairing uses a loopback-only server entitlement.
  Downloads are through Apple Photos, not a new account connector. No upload
  or cloud model is authorized by this option. Pause cancels the current resource
  request; already downloaded originals may remain in Apple's cache.
  Resource requests have a two-minute cancellation deadline and run one at a
  time; failed/timed-out originals are skipped rather than used as partial media.
- Original JPEG/PNG/GIF/WebP bytes pass through. HEIC/HEIF is rendered on-device
  as an orientation-correct, uncropped JPEG preview, max 4096 pixels on its long
  side, quality 0.9. It is always labelled as a derivative, including saved-card
  display after source edits. Its original resource name and SHA-256 remain in
  the receipt; the original bytes remain in Photos, not in the JPEG package.
  Replacing/removing the saved attachment marks that receipt as historical so
  it does not mislabel replacement media as the original companion import.
- Dates come from optional `PHAsset.creationDate`, with the source timestamp
  and this Mac's scan-time timezone retained (not an original capture timezone).
  This is user-editable Photos metadata, not proof of the true event date.
  Unknown dates stay null, never import time.
- No GPS fields are separately collected, but original image bytes may include
  EXIF location/device metadata. No image is sent to an external model or cloud service.

## Limits and review format

Native input/export: 10 MiB per photo, 50 photos, 47 MiB decoded per package.
These are retained/app-processed media limits, **not network traffic or Apple's
cache limits**: PhotoKit can download an original before delivering its bytes.
Downloads can use data and disk space even when an oversized image is skipped.
The 47 MiB limit reserves metadata room beneath the browser's 64 MiB encoded
file cap. Current browser inbox caps remain 100 candidates / 48 MiB.
Unsupported/cloud-only/oversized photos are counted as skipped, not successful.
The native UI reports aggregate skip reasons without paths, asset identifiers,
or raw provider errors. A download-required error never turns on network access.

`muse-nexus-proof-media-candidates`, version 1, declares `visibility: personal`
and `encryption: none`. It contains original/preview bytes in base64, SHA-256,
Photos source identifier, original filename/hash, representation, capture date,
timezone and scope. It contains no saved-Proof category, quote, or person.

The browser validates exact keys, allowed MIME/signatures, byte/count limits,
canonical base64, hashes, and date/timezone consistency before one atomic
pending-only transaction. SHA-256 detects corruption, not authorship. A crafted
file can claim a Photos source; it is not a provider-signed attestation. Nothing
is fetched from URLs or written using filenames/paths from the file.

Pending candidates remain excluded from search but are included in encrypted
full backups. Approval
preserves the companion receipt in saved provenance, which survives edits and
backup/restore. There is no new database migration or hosted behavior change.

## Verification and distribution

Optional **Connect to Gallery on this Mac** pauses Photos collection and starts
a five-minute loopback session. Paste its code into the web gallery's **Connect
this Mac** control. Receive one prepared batch directly into pending review;
the file fallback remains available. The same session offers optional on-device
text matching and source-ID selection for full-note readings. No cloud AI,
face identification, remote Photos commands, or automatic approval is introduced.
See [exact boundaries and release gates](PRIVATE_COMPLETION.md).

Run the web `bun run check`, focused companion import tests, and native
`swift test`/`bash build-app.sh`. Tests use synthetic media, not real libraries.
Real end-to-end Photos access must be checked after the owner grants permission
and chooses a source. A successful build does not establish that device proof.

Public distribution requires Developer ID signing, hardened runtime,
notarization/stapling, and a reviewed release process. These account-dependent
steps require fresh approval. Do not ship the local ad-hoc bundle as a notarized
release, or claim native Android/Windows versions exist.

Sources: [PhotoKit authorization](https://developer.apple.com/documentation/photos/phphotolibrary/requestauthorization(for:handler:)),
[resource streaming](https://developer.apple.com/documentation/photos/phassetresourcemanager/requestdata(for:options:datareceivedhandler:completionhandler:)),
[Photos entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.personal-information.photos-library),
[on-device text recognition](https://developer.apple.com/documentation/vision/recognizing-text-in-images),
[Photos date](https://developer.apple.com/documentation/photos/phasset/creationdate).
