# Native release checklist

Use [current release status](RELEASE_STATUS.md) first. This checklist separates
artifact, device, permission, and publication evidence. A passing earlier gate
does not complete a later one; record unobserved behavior as **unverified**.

## 1. Preserve and identify the candidate

- Record version/build, architecture, minimum OS, and full source commit.
- Keep the accepted signed/stapled installer immutable. Compare its final SHA-256
  with `release-sha256.txt` and the protected release receipt before using it.
  Web/docs/test-only changes do not require rebuilding an unchanged native app.
- Apple's notarization log must match the submitted pre-staple SHA-256, exact
  archive filename, and submission ID, with `Accepted`, numeric status code zero,
  and no issues. Stapling changes bytes: the final download digest is distinct
  from the submitted digest. Never substitute one for the other.
- Record successful stapler validation, DMG integrity, app/helper signatures and
  entitlements, and Gatekeeper assessments. See [packaging](COMPANION.md) and
  [helper packaging](HELPER-PACKAGING.md). Ad-hoc CI artifacts are not substitutes.
- Do not expose Apple credentials, account identities, local vault paths,
  connection configurations, or private evidence in public release material.

## 2. Complete device acceptance with separate consent

The following are **unverified for the build 4 candidate** until a device receipt
records them. Use a clean test account/device; never reset an existing private
profile to manufacture a clean test. The owner enters credentials in the OS, not
chat. If that UI is unavailable, leave this gate open and continue safe work only.

- Install the exact candidate and first-launch its GUI. Verify no source starts,
  Photos/notification prompt appears, or client listener opens before consent.
  Explicitly set up an empty private vault; verify persistence after app restart.
- Use only a bounded, owner-selected test source. Prefer synthetic folder media;
  Photos validation separately requires the owner's permission and chosen scope.
  Verify default pending intake, exact provenance, approval, gallery display,
  search, edit, delete, and that pending records stay out of saved-Proof retrieval.
- Exercise denied/revoked source permission, Pause/Disconnect, source limits,
  restart, and sleep/wake. Previously handled or deleted bytes must not return
  under the same grant. Test trusted automatic saving only after separately
  confirming that exact source; old pending items must remain pending.
- Separately enable and test background work and login startup if accepting those
  features. Closing a window, quitting, and sleep are different lifecycle events.
  Pause/Off must persist; installation or source access alone grants neither.
- Explicitly connect the browser gallery and chosen real assistant client. Verify
  gallery CRUD/media scopes, assistant saved-text-only reads, pending exclusion,
  expiry/revocation, and stale-edit/delete behavior. Show the cloud-provider text
  disclosure before assistant consent; never paste a live token into a receipt.
- Test reminders only after separate app and OS consent: generic text, no private
  evidence, quiet hours, cooldown, no catch-up after sleep, and Off cancellation.
- Restore a synthetic encrypted backup only into an empty, unconnected collection.
  Verify exact content and that no source, login, assistant, gallery or reminder
  authority is restored. Do not reuse the owner's existing vault for this check.

The [installed-helper test](HELPER-PACKAGING.md#check-an-already-installed-helper-without-opening-photos)
can run independently with temporary synthetic evidence. It verifies the selected
helper process, not the app's first launch, real Photos, OS dialogs or assistant
host. Keep optional features unverified if their separate consent is declined;
do not advertise them as device-tested.

## 3. Approve and verify publication

- Review the device receipt and any remaining restrictions. Obtain explicit
  approval for the exact installer bytes, destination release/tag and intended
  draft/prerelease/public visibility before uploading anything.
- Preserve historical source-preview receipts. Do not silently convert a source
  preview into an install recommendation or imply Windows/Android native support.
- After upload, read back the release: resolve its tag to the expected full source
  commit; confirm draft/prerelease state, exact asset filename, size and expected
  final SHA-256. A successful upload command alone is not acceptance.
- Download the actual asset through its intended release URL and hash those bytes.
  Compare against the final stapled `release-sha256.txt`, not a rebuilt copy or
  Apple's pre-staple digest. Recheck the download's signature/staple/Gatekeeper
  acceptance. Stop promotion if any receipt disagrees.
- Only then update release notes, download links and `RELEASE_STATUS.md` to match
  what is actually available. Record the exact release URL/tag/source commit and
  final artifact digest. Publication does not activate anyone's private sources.

No step above authorizes production changes, an upload, an installation, or a
private-source grant merely by appearing in this document.
