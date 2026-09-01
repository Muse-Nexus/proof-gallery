#!/bin/bash
set -euo pipefail

companion_test_root="$(mktemp -d -t proof-gallery-release-test.XXXXXX)"
trap 'rm -rf "$companion_test_root"' EXIT
companion_test_macos="$companion_test_root/companion/macos"
companion_test_bin="$companion_test_root/bin"
companion_test_release="$companion_test_macos/.build/distribution"
mkdir -p "$companion_test_macos" "$companion_test_bin" "$companion_test_release"
cp "$(dirname "$0")/package-release.sh" "$companion_test_macos/package-release.sh"

printf '%s\n' \
  '#!/bin/bash' \
  'if [[ "$1 $2" == "status --porcelain" ]]; then exit 0; fi' \
  'if [[ "$1 $2" == "rev-parse HEAD" ]]; then printf "%s\n" aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; exit 0; fi' \
  'exit 1' > "$companion_test_bin/git"
printf '%s\n' \
  '#!/bin/bash' \
  'if [[ "$1" == "--verify" ]]; then exit 0; fi' \
  'if [[ "$1" == "--display" ]]; then' \
  '  printf "%s\n" "Authority=Developer ID Application: Synthetic (ABCDEFGHIJ)" "Timestamp=synthetic" "TeamIdentifier=ABCDEFGHIJ" >&2' \
  '  exit 0' \
  'fi' \
  'exit 1' > "$companion_test_bin/codesign"
printf '%s\n' \
  '#!/bin/bash' \
  'printf "%s\n" "$*" >> "$PROOF_TEST_XCRUN_LOG"' \
  'if [[ "$1 $2" == "notarytool submit" ]]; then' \
  '  printf "%s\n" "synthetic submit diagnostic" >&2' \
  '  printf "%s\n" '\''{"id":"abcdefab-cdef-abcd-efab-cdefabcdefab","status":"Accepted"}'\''' \
  '  exit 0' \
  'fi' \
  'if [[ "$1 $2" == "notarytool log" ]]; then' \
  '  for companion_test_arg in "$@"; do companion_test_last="$companion_test_arg"; done' \
  '  case "$PROOF_TEST_LOG_MODE" in' \
  '    malformed) printf "%s\n" "not-json" > "$companion_test_last" ;;' \
  '    warning) printf "%s\n" "{\"jobId\":\"ABCDEFAB-CDEF-ABCD-EFAB-CDEFABCDEFAB\",\"status\":\"Accepted\",\"issues\":[{\"severity\":\"warning\"}]}" > "$companion_test_last" ;;' \
  '    incomplete) printf "%s\n" "{\"jobId\":\"ABCDEFAB-CDEF-ABCD-EFAB-CDEFABCDEFAB\",\"status\":\"Accepted\"}" > "$companion_test_last" ;;' \
  '    invalid-severity) printf "%s\n" "{\"jobId\":\"ABCDEFAB-CDEF-ABCD-EFAB-CDEFABCDEFAB\",\"status\":\"Accepted\",\"issues\":[{\"severity\":\"critical\"}]}" > "$companion_test_last" ;;' \
  '    mismatch-id) printf "%s\n" "{\"jobId\":\"BBCDEFAB-CDEF-ABCD-EFAB-CDEFABCDEFAB\",\"status\":\"Accepted\",\"issues\":[]}" > "$companion_test_last" ;;' \
  '    mismatch-status) printf "%s\n" "{\"jobId\":\"ABCDEFAB-CDEF-ABCD-EFAB-CDEFABCDEFAB\",\"status\":\"Invalid\",\"issues\":[]}" > "$companion_test_last" ;;' \
  '    clean) printf "%s\n" "{\"jobId\":\"ABCDEFAB-CDEF-ABCD-EFAB-CDEFABCDEFAB\",\"status\":\"Accepted\",\"issues\":null}" > "$companion_test_last" ;;' \
  '    *) exit 1 ;;' \
  '  esac' \
  '  exit 0' \
  'fi' \
  'if [[ "$1" == "stapler" ]]; then touch "$PROOF_TEST_STAPLE_MARKER"; exit 0; fi' \
  'exit 1' > "$companion_test_bin/xcrun"
printf '%s\n' '#!/bin/bash' 'exit 0' > "$companion_test_bin/spctl"
chmod +x "$companion_test_bin/git" "$companion_test_bin/codesign" "$companion_test_bin/xcrun" "$companion_test_bin/spctl"

companion_test_dmg="$companion_test_release/Proof-Photos-Companion-0.2.0.dmg"
printf '%s\n' 'synthetic DMG bytes' > "$companion_test_dmg"
printf '%s\n' aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa > "$companion_test_release/source-commit.txt"
(cd "$companion_test_release" && shasum -a 256 "$(basename "$companion_test_dmg")" > pre-notarization-sha256.txt)
companion_test_hash="$(shasum -a 256 "$companion_test_dmg" | cut -d ' ' -f 1)"
companion_test_xcrun_log="$companion_test_root/xcrun.log"
companion_test_staple_marker="$companion_test_root/stapled"
companion_test_run_output="$companion_test_root/notary-run.out"

run_notarize() {
  PATH="$companion_test_bin:$PATH" \
  PROOF_RELEASE_ACTION=notarize-existing \
  PROOF_EXPECTED_TEAM_ID=ABCDEFGHIJ \
  PROOF_SUBMIT_NOTARIZATION=approved \
  PROOF_NOTARY_PROFILE=synthetic-profile \
  PROOF_APPROVED_DMG_SHA256="$1" \
  PROOF_TEST_XCRUN_LOG="$companion_test_xcrun_log" \
  PROOF_TEST_STAPLE_MARKER="$companion_test_staple_marker" \
  PROOF_TEST_LOG_MODE="${2:-malformed}" \
  bash "$companion_test_macos/package-release.sh" >"$companion_test_run_output" 2>&1
}

reset_notary_attempt() {
  rm -f "$companion_test_release/notarization-result.json" \
    "$companion_test_release/notarization-submit.stderr.txt" \
    "$companion_test_release/notarization-log.json" \
    "$companion_test_release/release-sha256.txt" \
    "$companion_test_xcrun_log" \
    "$companion_test_staple_marker"
}

companion_prepare_output="$companion_test_root/prepare.out"
if PATH="$companion_test_bin:$PATH" \
   PROOF_RELEASE_ACTION=prepare \
   PROOF_EXPECTED_TEAM_ID=ABCDEFGHIJ \
   bash "$companion_test_macos/package-release.sh" >"$companion_prepare_output" 2>&1; then
  printf '%s\n' 'Release signing unexpectedly ran without fresh approval.' >&2
  exit 1
fi
grep -Fq 'Fresh Developer ID signing approval is required.' "$companion_prepare_output"

companion_notary_approval_output="$companion_test_root/notary-approval.out"
if PATH="$companion_test_bin:$PATH" \
   PROOF_RELEASE_ACTION=notarize-existing \
   PROOF_EXPECTED_TEAM_ID=ABCDEFGHIJ \
   bash "$companion_test_macos/package-release.sh" >"$companion_notary_approval_output" 2>&1; then
  printf '%s\n' 'Notarization unexpectedly ran without fresh upload approval.' >&2
  exit 1
fi
grep -Fq 'Fresh notarization upload approval is required.' "$companion_notary_approval_output"
[[ ! -e "$companion_test_xcrun_log" && ! -e "$companion_test_staple_marker" ]]

if run_notarize 0000000000000000000000000000000000000000000000000000000000000000; then
  printf '%s\n' 'A mismatched approved hash unexpectedly passed.' >&2
  exit 1
fi
[[ ! -e "$companion_test_xcrun_log" && ! -e "$companion_test_staple_marker" ]]

if run_notarize "$companion_test_hash"; then
  printf '%s\n' 'A malformed Apple log unexpectedly passed.' >&2
  exit 1
fi
[[ -f "$companion_test_release/notarization-result.json" ]]
[[ -f "$companion_test_release/notarization-submit.stderr.txt" ]]
[[ -f "$companion_test_release/notarization-log.json" ]]
grep -Fq 'synthetic submit diagnostic' "$companion_test_release/notarization-submit.stderr.txt"
[[ ! -e "$companion_test_staple_marker" ]]
! grep -Eq '(^| )stapler( |$)' "$companion_test_xcrun_log"

reset_notary_attempt
if run_notarize "$companion_test_hash" warning; then
  printf '%s\n' 'An Apple warning unexpectedly passed.' >&2
  exit 1
fi
[[ ! -e "$companion_test_staple_marker" ]]
! grep -Eq '(^| )stapler( |$)' "$companion_test_xcrun_log"

reset_notary_attempt
if run_notarize "$companion_test_hash" incomplete; then
  printf '%s\n' 'An incomplete Apple log unexpectedly passed.' >&2
  exit 1
fi
[[ ! -e "$companion_test_staple_marker" ]]

reset_notary_attempt
if run_notarize "$companion_test_hash" mismatch-id; then
  printf '%s\n' 'A mismatched Apple job ID unexpectedly passed.' >&2
  exit 1
fi
[[ ! -e "$companion_test_staple_marker" ]]

reset_notary_attempt
if run_notarize "$companion_test_hash" invalid-severity; then
  printf '%s\n' 'An unknown Apple issue severity unexpectedly passed.' >&2
  exit 1
fi
[[ ! -e "$companion_test_staple_marker" ]]

reset_notary_attempt
if run_notarize "$companion_test_hash" mismatch-status; then
  printf '%s\n' 'A mismatched Apple status unexpectedly passed.' >&2
  exit 1
fi
[[ ! -e "$companion_test_staple_marker" ]]

reset_notary_attempt
if ! run_notarize "$companion_test_hash" clean; then
  cat "$companion_test_run_output" >&2
  printf '%s\n' 'A clean accepted Apple response unexpectedly failed.' >&2
  exit 1
fi
[[ -e "$companion_test_staple_marker" ]]
[[ -f "$companion_test_release/release-sha256.txt" ]]
printf '%s\n' 'Release safety checks passed.'
