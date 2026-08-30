# Mac Photos companion

The companion makes source discovery less manual without treating every photo
as Proof. It is a source adapter, not a judge of identity, relationships, worth,
or emotional meaning. No words or categories are generated from an image.

## Run locally

Requires macOS 14+ and Xcode with Swift 6 (the package uses Swift 5 language mode).
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
2. Choose an album or Favorites and an earliest date. Click **Start selected
   source**. Permission alone does not start a media scan.
3. The app checks at most the most recent 50 still photos in that scope. Photos
   changes trigger another check only while active. Pause removes the observer
   and cancels reads. There is no historical pagination or closed-app daemon.
4. Remove unwanted candidates or **Export for review**. This pauses reading and
   writes one unencrypted `.proof-inbox.json` file to the location you choose,
   with owner-only file permissions. Keep it somewhere private.
5. In Proof Gallery choose **Photos & media → Import companion review**, not
   Restore. Review categories/details, then explicitly save selected items.
6. Back up saved Proof separately. A companion file is not a gallery backup.

Prepared photos are memory-only until export. Closing the window or quitting
pauses collection and asks before discarding an unexported batch. Clearing a
batch keeps session deduplication for the same source; changing the source or
disconnecting resets it. Exported files, browser candidates, and saved Proof
are independent copies and are never remotely deleted by Disconnect.

## Permission and fidelity boundaries

- PhotoKit requires the OS `.readWrite` access level even to read. Our app
  enforces read-only behavior; it contains no PhotoKit mutation calls.
- Disconnect does not revoke the OS grant. Revoke in System Settings → Privacy
  & Security → Photos. Revocation is checked before and after each media read.
- Album/date selection is an app-enforced restriction within the OS grant.
  Hidden, shared-source, burst expansion, videos and Live Photo motion are not
  collected. The still component of a Live Photo may be collected.
- Original resources must already be local. PhotoKit network access is false;
  there is no iCloud fetch or network client/server entitlement.
- Original JPEG/PNG/GIF/WebP bytes pass through. HEIC/HEIF is rendered on-device
  as an orientation-correct, uncropped JPEG preview, max 4096 pixels on its long
  side, quality 0.9. It is always labelled as a derivative, including saved-card
  display after source edits. Its original resource name and SHA-256 remain in
  the receipt; the original bytes remain in Photos, not in the JPEG package.
  Replacing/removing the saved attachment marks that receipt as historical so
  it does not mislabel replacement media as the original companion import.
- Dates come from optional `PHAsset.creationDate`, with the source timestamp
  and timezone retained. This is Photos metadata, not proof of the true event
  date. Unknown dates stay null, never import time.
- No GPS fields are separately collected, but original image bytes may include
  EXIF location/device metadata. No image is sent to a model or cloud service.

## Limits and review format

Native input/export: 10 MiB per photo, 50 photos, 47 MiB decoded per package.
The 47 MiB limit reserves metadata room beneath the browser's 64 MiB encoded
file cap. Current browser inbox caps remain 100 candidates / 48 MiB.
Unsupported/cloud-only/oversized photos are counted as skipped, not successful.

`muse-nexus-proof-media-candidates`, version 1, declares `visibility: personal`
and `encryption: none`. It contains original/preview bytes in base64, SHA-256,
Photos source identifier, original filename/hash, representation, capture date,
timezone and scope. It contains no saved-Proof category, quote, or person.

The browser validates exact keys, allowed MIME/signatures, byte/count limits,
canonical base64, hashes, and date/timezone consistency before one atomic
pending-only transaction. SHA-256 detects corruption, not authorship. A crafted
file can claim a Photos source; it is not a provider-signed attestation. Nothing
is fetched from URLs or written using filenames/paths from the file.

Pending candidates remain excluded from search and saved backups. Approval
preserves the companion receipt in saved provenance, which survives edits and
backup/restore. There is no new database migration or hosted behavior change.

## Verification and distribution

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
[Photos entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.personal-information.photos-library).
