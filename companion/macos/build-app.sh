#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
companion_build_args=(-c release)
if [[ -n "${PROOF_BUILD_TRIPLE:-}" ]]; then
  companion_build_args+=(--triple "$PROOF_BUILD_TRIPLE")
fi
swift build "${companion_build_args[@]}"
companion_bin_dir="$(swift build "${companion_build_args[@]}" --show-bin-path)"
companion_app="$PWD/.build/Proof Photos Companion.app"
rm -rf "$companion_app"
mkdir -p "$companion_app/Contents/MacOS" "$companion_app/Contents/Resources"
cp "$companion_bin_dir/ProofPhotosCompanion" "$companion_app/Contents/MacOS/ProofPhotosCompanion"
cp Info.plist "$companion_app/Contents/Info.plist"
if [[ -n "${PROOF_SIGNING_IDENTITY:-}" ]]; then
  [[ "$PROOF_SIGNING_IDENTITY" == "Developer ID Application: "* ]] || { printf '%s\n' 'A Developer ID Application identity is required.' >&2; exit 1; }
  : "${PROOF_EXPECTED_TEAM_ID:?Set the authorized Apple Developer Team ID.}"
  [[ "$PROOF_EXPECTED_TEAM_ID" =~ ^[A-Z0-9]{10}$ ]] || { printf '%s\n' 'The expected Apple Developer Team ID is malformed.' >&2; exit 1; }
  codesign --force --sign "$PROOF_SIGNING_IDENTITY" --options runtime --timestamp --entitlements ProofPhotosCompanion.entitlements "$companion_app"
else
  codesign --force --sign - --entitlements ProofPhotosCompanion.entitlements "$companion_app"
fi
codesign --verify --deep --strict --verbose=2 "$companion_app"
if [[ -n "${PROOF_SIGNING_IDENTITY:-}" ]]; then
  companion_signature="$(codesign --display --verbose=4 "$companion_app" 2>&1)"
  printf '%s\n' "$companion_signature" | grep -Eq '^CodeDirectory .*flags=.*\(runtime\)' || {
    printf '%s\n' 'Signed app is missing the hardened runtime flag.' >&2
    exit 1
  }
  printf '%s\n' "$companion_signature" | grep -Fqx "TeamIdentifier=$PROOF_EXPECTED_TEAM_ID" || {
    printf '%s\n' 'Signed app does not match the approved Apple Developer team.' >&2
    exit 1
  }
  printf '%s\n' "$companion_signature" | grep -Eq '^Authority=Developer ID Application: ' || {
    printf '%s\n' 'Signed app is missing its Developer ID Application authority.' >&2
    exit 1
  }
  printf '%s\n' "$companion_signature" | grep -Eq '^Timestamp=' || {
    printf '%s\n' 'Signed app is missing an Apple secure timestamp.' >&2
    exit 1
  }
  companion_entitlements="$(mktemp -t proof-gallery-entitlements.XXXXXX)"
  trap 'rm -f "$companion_entitlements"' EXIT
  codesign --display --entitlements :- "$companion_app" > "$companion_entitlements" 2>/dev/null
  if get_task_allow="$(/usr/libexec/PlistBuddy -c 'Print :com.apple.security.get-task-allow' "$companion_entitlements" 2>/dev/null)"; then
    [[ "$get_task_allow" != "true" ]] || {
      printf '%s\n' 'Release app cannot include com.apple.security.get-task-allow=true.' >&2
      exit 1
    }
  fi
fi
printf '%s\n' "$companion_app"
