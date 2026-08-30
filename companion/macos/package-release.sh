#!/bin/bash
# Run only after owner approval of the exact Developer ID and release build.
set -euo pipefail
cd "$(dirname "$0")"
: "${PROOF_SIGNING_IDENTITY:?Set the authorized Developer ID Application identity.}"
[[ "$PROOF_SIGNING_IDENTITY" == "Developer ID Application: "* ]] || exit 1
bash build-app.sh
companion_release_dir="$PWD/.build/distribution"
mkdir -p "$companion_release_dir"
companion_release_dmg="$companion_release_dir/Proof-Photos-Companion-0.2.0.dmg"
if [[ -e "$companion_release_dmg" ]]; then
  printf '%s\n' 'Distribution already exists. Preserve or move it before preparing a new release.' >&2
  exit 1
fi
hdiutil create -volname 'Proof Photos Companion' -srcfolder "$PWD/.build/Proof Photos Companion.app" -format UDZO "$companion_release_dmg"
codesign --sign "$PROOF_SIGNING_IDENTITY" --timestamp "$companion_release_dmg"
if [[ "${PROOF_SUBMIT_NOTARIZATION:-}" != "approved" ]]; then
  printf '%s\n' 'Signed DMG prepared, NOT notarized or ready for public release. No upload performed.'
  exit 0
fi
: "${PROOF_NOTARY_PROFILE:?Set an already-authorized notarytool keychain profile.}"
xcrun notarytool submit "$companion_release_dmg" --keychain-profile "$PROOF_NOTARY_PROFILE" --wait
xcrun stapler staple "$companion_release_dmg"
xcrun stapler validate "$companion_release_dmg"
spctl --assess --type open --context context:primary-signature --verbose=2 "$companion_release_dmg"
shasum -a 256 "$companion_release_dmg"
printf '%s\n' 'Notarization/stapling checks passed. Owner-approved clean-machine launch is still required before publication.'
