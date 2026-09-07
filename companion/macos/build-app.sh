#!/bin/bash
set -euo pipefail
umask 077
cd "$(dirname "$0")"
if [[ -n "${PROOF_SIGNING_IDENTITY:-}" ]]; then
  [[ "${PROOF_PREPARE_SIGNING:-}" == "approved" ]] || { printf '%s\n' 'Fresh Developer ID signing approval is required.' >&2; exit 1; }
  [[ "$PROOF_SIGNING_IDENTITY" == "Developer ID Application: "* ]] || { printf '%s\n' 'A Developer ID Application identity is required.' >&2; exit 1; }
  : "${PROOF_EXPECTED_TEAM_ID:?Set the authorized Apple Developer Team ID.}"
  [[ "$PROOF_EXPECTED_TEAM_ID" =~ ^[A-Z0-9]{10}$ ]] || { printf '%s\n' 'The expected Apple Developer Team ID is malformed.' >&2; exit 1; }
fi
companion_build_args=(-c release)
if [[ -n "${PROOF_BUILD_TRIPLE:-}" ]]; then
  companion_build_args+=(--triple "$PROOF_BUILD_TRIPLE")
fi
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' ProofMCP-Info.plist)" == nexus.muse.proof.mcp ]] || { printf '%s\n' 'Assistant helper bundle identity does not match.' >&2; exit 1; }
swift build "${companion_build_args[@]}" --product ProofPhotosCompanion
# This independently sandboxed command-line tool needs its own bundle identity.
# It is launched by the selected assistant, never by inheriting the Photos app.
swift build "${companion_build_args[@]}" --product ProofMCP \
  -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker "$PWD/ProofMCP-Info.plist"
companion_bin_dir="$(swift build "${companion_build_args[@]}" --show-bin-path)"
[[ -x "$companion_bin_dir/ProofPhotosCompanion" && -x "$companion_bin_dir/ProofMCP" ]] || { printf '%s\n' 'Both native executables must be built before packaging.' >&2; exit 1; }
companion_app_archs="$(lipo "$companion_bin_dir/ProofPhotosCompanion" -archs)"
companion_helper_archs="$(lipo "$companion_bin_dir/ProofMCP" -archs)"
[[ -n "$companion_app_archs" && "$companion_app_archs" == "$companion_helper_archs" ]] || { printf '%s\n' 'App and assistant helper architectures differ.' >&2; exit 1; }
companion_app="$PWD/.build/Proof Photos Companion.app"
companion_helper="$companion_app/Contents/Helpers/ProofMCP"
rm -rf "$companion_app"
mkdir -p "$companion_app/Contents/MacOS" "$companion_app/Contents/Resources" "$companion_app/Contents/Helpers"
cp "$companion_bin_dir/ProofPhotosCompanion" "$companion_app/Contents/MacOS/ProofPhotosCompanion"
cp "$companion_bin_dir/ProofMCP" "$companion_helper"
cp Info.plist "$companion_app/Contents/Info.plist"
# The bundle contains public code/resources only; make it runnable by its recipient.
chmod 755 "$companion_app" "$companion_app/Contents" "$companion_app/Contents/MacOS" \
  "$companion_app/Contents/Resources" "$companion_app/Contents/Helpers" \
  "$companion_app/Contents/MacOS/ProofPhotosCompanion" "$companion_helper"
chmod 644 "$companion_app/Contents/Info.plist"
# Sign nested code first. The helper must never inherit Photos/file/server grants.
if [[ -n "${PROOF_SIGNING_IDENTITY:-}" ]]; then
  codesign --force --sign "$PROOF_SIGNING_IDENTITY" --identifier nexus.muse.proof.mcp --options runtime --timestamp --entitlements ProofMCP.entitlements "$companion_helper"
  codesign --force --sign "$PROOF_SIGNING_IDENTITY" --options runtime --timestamp --entitlements ProofPhotosCompanion.entitlements "$companion_app"
else
  codesign --force --sign - --identifier nexus.muse.proof.mcp --entitlements ProofMCP.entitlements "$companion_helper"
  codesign --force --sign - --entitlements ProofPhotosCompanion.entitlements "$companion_app"
fi
codesign --verify --strict --verbose=2 "$companion_helper"
codesign --verify --deep --strict --verbose=2 "$companion_app"
companion_entitlements="$(mktemp -t proof-gallery-entitlements.XXXXXX)"
trap 'rm -f "$companion_entitlements"' EXIT
codesign --display --entitlements :- "$companion_helper" > "$companion_entitlements" 2>/dev/null
# Check the SIGNED helper's entire entitlement dictionary, not just our input file.
/usr/bin/osascript -l JavaScript -e '
ObjC.import("Foundation");
function run(argv) {
  const data = $.NSData.dataWithContentsOfFile(argv[0]);
  if (!data) throw new Error("Missing helper entitlement receipt");
  const plist = $.NSPropertyListSerialization.propertyListWithDataOptionsFormatError(data, 0, null, null);
  const value = ObjC.deepUnwrap(plist);
  const keys = Object.keys(value).sort();
  const allowed = ["com.apple.security.app-sandbox", "com.apple.security.network.client"];
  if (JSON.stringify(keys) !== JSON.stringify(allowed) || allowed.some(k => value[k] !== true))
    throw new Error("Helper entitlements must contain only sandbox and network client");
}' "$companion_entitlements" >/dev/null

verify_developer_id() {
  local companion_target="$1" companion_identifier="$2" companion_signature
  companion_signature="$(codesign --display --verbose=4 "$companion_target" 2>&1)"
  printf '%s\n' "$companion_signature" | grep -Eq '^CodeDirectory .*flags=.*\(runtime\)' || { printf '%s\n' 'Release executable is missing hardened runtime.' >&2; exit 1; }
  printf '%s\n' "$companion_signature" | grep -Fqx "Identifier=$companion_identifier" || { printf '%s\n' 'Release executable identifier does not match.' >&2; exit 1; }
  printf '%s\n' "$companion_signature" | grep -Fqx "TeamIdentifier=$PROOF_EXPECTED_TEAM_ID" || { printf '%s\n' 'Release executable does not match the approved Apple Developer team.' >&2; exit 1; }
  printf '%s\n' "$companion_signature" | grep -Fqx "Authority=$PROOF_SIGNING_IDENTITY" || { printf '%s\n' 'Release executable does not match the approved signing identity.' >&2; exit 1; }
  printf '%s\n' "$companion_signature" | grep -Eq '^Timestamp=.+$' || { printf '%s\n' 'Release executable is missing an Apple secure timestamp.' >&2; exit 1; }
}
if [[ -n "${PROOF_SIGNING_IDENTITY:-}" ]]; then
  verify_developer_id "$companion_helper" nexus.muse.proof.mcp
  verify_developer_id "$companion_app" nexus.muse.proof.photos-companion
  codesign --display --entitlements :- "$companion_app" > "$companion_entitlements" 2>/dev/null
  if get_task_allow="$(/usr/libexec/PlistBuddy -c 'Print :com.apple.security.get-task-allow' "$companion_entitlements" 2>/dev/null)"; then
    [[ "$get_task_allow" != "true" ]] || { printf '%s\n' 'Release app cannot include com.apple.security.get-task-allow=true.' >&2; exit 1; }
  fi
else
  printf '%s\n' 'Ad-hoc local development bundle only; not Developer ID signed, notarized, or publicly ready.' >&2
fi
printf '%s\n' "$companion_app"
