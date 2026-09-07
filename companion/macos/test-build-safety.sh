#!/bin/bash
# Synthetic command stubs only: never signs, launches or installs an app.
set -euo pipefail
companion_fixture="$(mktemp -d -t proof-build-safety.XXXXXX)"
trap 'rm -rf "$companion_fixture"' EXIT
companion_fixture_app="$companion_fixture/macos"
companion_fixture_bin="$companion_fixture/bin"
mkdir -p "$companion_fixture_app" "$companion_fixture_bin"
cp "$(dirname "$0")/build-app.sh" "$(dirname "$0")/Info.plist" "$(dirname "$0")/ProofMCP-Info.plist" "$(dirname "$0")/ProofPhotosCompanion.entitlements" "$(dirname "$0")/ProofMCP.entitlements" "$companion_fixture_app/"
cat > "$companion_fixture_bin/swift" <<'STUB'
#!/bin/bash
set -euo pipefail
printf '%s\n' build >> "$PROOF_TEST_ROOT/swift.log"
if [[ " $* " == *" --show-bin-path "* ]]; then printf '%s\n' "$PROOF_TEST_ROOT/products"; exit 0; fi
if [[ " $* " == *" --product ProofMCP "* ]]; then
  [[ " $* " == *" -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker "* ]]
  [[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' ProofMCP-Info.plist)" == nexus.muse.proof.mcp ]]
fi
mkdir -p "$PROOF_TEST_ROOT/products"
printf '#!/bin/bash\nexit 0\n' > "$PROOF_TEST_ROOT/products/ProofPhotosCompanion"
chmod +x "$PROOF_TEST_ROOT/products/ProofPhotosCompanion"
if [[ "$PROOF_TEST_MODE" != missing-helper ]]; then
  printf '#!/bin/bash\nexit 0\n' > "$PROOF_TEST_ROOT/products/ProofMCP"
  chmod +x "$PROOF_TEST_ROOT/products/ProofMCP"
fi
STUB
cat > "$companion_fixture_bin/lipo" <<'STUB'
#!/bin/bash
if [[ "$PROOF_TEST_MODE" == architectures && "$1" == */ProofMCP ]]; then printf '%s\n' x86_64; else printf '%s\n' arm64; fi
STUB
cat > "$companion_fixture_bin/codesign" <<'STUB'
#!/bin/bash
set -euo pipefail
for companion_arg in "$@"; do companion_target="$companion_arg"; done
companion_kind=app
[[ "$companion_target" == */ProofMCP ]] && companion_kind=helper
if [[ "$1" == --force ]]; then
  printf 'sign-%s\n' "$companion_kind" >> "$PROOF_TEST_ROOT/sign.log"
  if [[ -n "$PROOF_SIGNING_IDENTITY" ]]; then
    [[ " $* " == *' --options runtime '* && " $* " == *' --timestamp '* ]]
  else [[ " $* " == *' --sign - '* ]]; fi
  if [[ "$companion_kind" == helper ]]; then
    [[ " $* " == *' --identifier nexus.muse.proof.mcp '* && " $* " == *' --entitlements ProofMCP.entitlements '* ]]
  else [[ " $* " == *' --entitlements ProofPhotosCompanion.entitlements '* ]]; fi
  exit 0
fi
if [[ "$1" == --verify ]]; then
  [[ "$PROOF_TEST_MODE" != verify-helper || "$companion_kind" != helper ]]
  exit $?
fi
if [[ "$2" == --entitlements ]]; then
  if [[ "$companion_kind" == helper ]]; then
    if [[ "$PROOF_TEST_MODE" == helper-entitlements ]]; then
      printf '%s\n' '<plist version="1.0"><dict><key>com.apple.security.app-sandbox</key><true/><key>com.apple.security.network.client</key><true/><key>com.apple.security.network.server</key><true/></dict></plist>'
    else cat ProofMCP.entitlements; fi
  else cat ProofPhotosCompanion.entitlements; fi
  exit 0
fi
if [[ "$1" == --display ]]; then
  companion_team=ABCDEFGHIJ
  [[ "$PROOF_TEST_MODE" == "$companion_kind-team" ]] && companion_team=ZZZZZZZZZZ
  companion_identifier=nexus.muse.proof.photos-companion
  [[ "$companion_kind" == helper ]] && companion_identifier=nexus.muse.proof.mcp
  [[ "$PROOF_TEST_MODE" == helper-identifier && "$companion_kind" == helper ]] && companion_identifier=wrong.helper
  printf 'Identifier=%s\nTeamIdentifier=%s\n' "$companion_identifier" "$companion_team" >&2
  if [[ "$PROOF_TEST_MODE" != helper-authority || "$companion_kind" != helper ]]; then
    printf '%s\n' 'Authority=Developer ID Application: Synthetic (ABCDEFGHIJ)' >&2
  else printf '%s\n' 'Authority=Developer ID Application: Other (ABCDEFGHIJ)' >&2; fi
  if [[ "$PROOF_TEST_MODE" != helper-runtime || "$companion_kind" != helper ]]; then printf '%s\n' 'CodeDirectory v=20500 size=100 flags=0x10000(runtime)' >&2; fi
  if [[ "$PROOF_TEST_MODE" != helper-timestamp || "$companion_kind" != helper ]]; then printf '%s\n' 'Timestamp=synthetic' >&2; fi
  exit 0
fi
exit 1
STUB
chmod +x "$companion_fixture_bin/"*
run_build() {
  local companion_mode="$1" companion_identity="${2-Developer ID Application: Synthetic (ABCDEFGHIJ)}" companion_approval="${3-approved}"
  rm -rf "$companion_fixture/products" "$companion_fixture_app/.build"
  rm -f "$companion_fixture/sign.log" "$companion_fixture/swift.log"
  PATH="$companion_fixture_bin:$PATH" PROOF_TEST_ROOT="$companion_fixture" PROOF_TEST_MODE="$companion_mode" \
    PROOF_SIGNING_IDENTITY="$companion_identity" PROOF_PREPARE_SIGNING="$companion_approval" PROOF_EXPECTED_TEAM_ID=ABCDEFGHIJ \
    bash "$companion_fixture_app/build-app.sh" > "$companion_fixture/output" 2>&1
}
if run_build clean 'Developer ID Application: Synthetic (ABCDEFGHIJ)' ''; then
  printf '%s\n' 'Signing build accepted missing action approval.' >&2; exit 1
fi
[[ ! -e "$companion_fixture/sign.log" && ! -e "$companion_fixture/swift.log" ]]
for companion_mode in missing-helper architectures verify-helper helper-entitlements helper-team app-team helper-identifier helper-authority helper-runtime helper-timestamp; do
  if run_build "$companion_mode"; then printf 'Unsafe build passed: %s\n' "$companion_mode" >&2; exit 1; fi
done
if ! run_build clean; then cat "$companion_fixture/output" >&2; exit 1; fi
[[ "$(cat "$companion_fixture/sign.log")" == $'sign-helper\nsign-app' ]]
[[ -x "$companion_fixture_app/.build/Proof Photos Companion.app/Contents/Helpers/ProofMCP" ]]
if ! run_build clean '' ''; then cat "$companion_fixture/output" >&2; exit 1; fi
grep -Fq 'Ad-hoc local development bundle only' "$companion_fixture/output"
printf '%s\n' 'Helper packaging safety checks passed (stub tools only).'
