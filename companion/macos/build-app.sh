#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
swift build -c release
companion_bin_dir="$(swift build -c release --show-bin-path)"
companion_app="$PWD/.build/Proof Photos Companion.app"
mkdir -p "$companion_app/Contents/MacOS" "$companion_app/Contents/Resources"
cp "$companion_bin_dir/ProofPhotosCompanion" "$companion_app/Contents/MacOS/ProofPhotosCompanion"
cp Info.plist "$companion_app/Contents/Info.plist"
if [[ -n "${PROOF_SIGNING_IDENTITY:-}" ]]; then
  [[ "$PROOF_SIGNING_IDENTITY" == "Developer ID Application: "* ]] || { printf '%s\n' 'A Developer ID Application identity is required.' >&2; exit 1; }
  codesign --force --sign "$PROOF_SIGNING_IDENTITY" --options runtime --timestamp --entitlements ProofPhotosCompanion.entitlements "$companion_app"
else
  codesign --force --sign - --entitlements ProofPhotosCompanion.entitlements "$companion_app"
fi
codesign --verify --strict "$companion_app"
printf '%s\n' "$companion_app"
