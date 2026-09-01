#!/bin/bash
# Run only after owner approval of the exact Developer ID and release build.
set -euo pipefail
umask 077
cd "$(dirname "$0")"
: "${PROOF_RELEASE_ACTION:?Set the explicit release action: prepare or notarize-existing.}"
companion_release_action="$PROOF_RELEASE_ACTION"
[[ "$companion_release_action" == "prepare" || "$companion_release_action" == "notarize-existing" ]] || {
  printf '%s\n' 'PROOF_RELEASE_ACTION must be prepare or notarize-existing.' >&2
  exit 1
}
: "${PROOF_EXPECTED_TEAM_ID:?Set the authorized Apple Developer Team ID.}"
[[ "$PROOF_EXPECTED_TEAM_ID" =~ ^[A-Z0-9]{10}$ ]] || { printf '%s\n' 'The expected Apple Developer Team ID is malformed.' >&2; exit 1; }
companion_release_dir="$PWD/.build/distribution"
companion_release_dmg="$companion_release_dir/Proof-Photos-Companion-0.2.0.dmg"
companion_source_commit="$companion_release_dir/source-commit.txt"
companion_pre_notary_hash="$companion_release_dir/pre-notarization-sha256.txt"
companion_final_hash="$companion_release_dir/release-sha256.txt"
companion_dmg_name="$(basename "$companion_release_dmg")"

verify_release_signature() {
  local companion_signature
  codesign --verify --strict --verbose=2 "$1"
  companion_signature="$(codesign --display --verbose=4 "$1" 2>&1)"
  printf '%s\n' "$companion_signature" | grep -Fqx "TeamIdentifier=$PROOF_EXPECTED_TEAM_ID" || {
    printf '%s\n' 'Release artifact does not match the approved Apple Developer team.' >&2
    exit 1
  }
  printf '%s\n' "$companion_signature" | grep -Eq '^Authority=Developer ID Application: ' || {
    printf '%s\n' 'Release artifact is missing its Developer ID Application authority.' >&2
    exit 1
  }
  printf '%s\n' "$companion_signature" | grep -Eq '^Timestamp=' || {
    printf '%s\n' 'Release artifact is missing an Apple secure timestamp.' >&2
    exit 1
  }
}

if [[ "$companion_release_action" == "prepare" ]]; then
  [[ "${PROOF_PREPARE_SIGNING:-}" == "approved" ]] || {
    printf '%s\n' 'Fresh Developer ID signing approval is required.' >&2
    exit 1
  }
  : "${PROOF_SIGNING_IDENTITY:?Set the authorized Developer ID Application identity.}"
  [[ "$PROOF_SIGNING_IDENTITY" == "Developer ID Application: "* ]] || exit 1
  [[ -z "$(git status --porcelain)" ]] || {
    printf '%s\n' 'Release preparation requires a clean reviewed source commit.' >&2
    exit 1
  }
  if [[ -e "$companion_release_dmg" || -e "$companion_source_commit" || -e "$companion_pre_notary_hash" ||
        -e "$companion_release_dir/notarization-result.json" || -e "$companion_release_dir/notarization-log.json" ||
        -e "$companion_release_dir/notarization-submit.stderr.txt" ||
        -e "$companion_final_hash" ]]; then
    printf '%s\n' 'Distribution receipts already exist. Preserve or move them before preparing a new release.' >&2
    exit 1
  fi
  PROOF_BUILD_TRIPLE=arm64-apple-macosx14.0 bash build-app.sh
  companion_release_archs="$(lipo "$PWD/.build/Proof Photos Companion.app/Contents/MacOS/ProofPhotosCompanion" -archs)"
  [[ "$companion_release_archs" == "arm64" ]] || {
    printf '%s\n' 'The v0.2.0 release must contain exactly the reviewed arm64 architecture.' >&2
    exit 1
  }
  mkdir -p "$companion_release_dir"
  hdiutil create -volname 'Proof Photos Companion' -srcfolder "$PWD/.build/Proof Photos Companion.app" -format UDZO "$companion_release_dmg"
  codesign --sign "$PROOF_SIGNING_IDENTITY" --timestamp "$companion_release_dmg"
  verify_release_signature "$companion_release_dmg"
  git rev-parse HEAD > "$companion_source_commit"
  (cd "$companion_release_dir" && shasum -a 256 "$companion_dmg_name" > "$(basename "$companion_pre_notary_hash")")
  printf '%s\n' 'Signed DMG prepared with source and hash receipts. No upload performed.'
  exit 0
fi

[[ "${PROOF_SUBMIT_NOTARIZATION:-}" == "approved" ]] || {
  printf '%s\n' 'Fresh notarization upload approval is required.' >&2
  exit 1
}
: "${PROOF_NOTARY_PROFILE:?Set an already-authorized notarytool keychain profile.}"
: "${PROOF_APPROVED_DMG_SHA256:?Set the freshly approved pre-notarization DMG SHA-256.}"
[[ "$PROOF_APPROVED_DMG_SHA256" =~ ^[a-f0-9]{64}$ ]] || {
  printf '%s\n' 'The approved DMG SHA-256 is malformed.' >&2
  exit 1
}
[[ -f "$companion_release_dmg" && -f "$companion_source_commit" && -f "$companion_pre_notary_hash" ]] || {
  printf '%s\n' 'A prepared DMG and its source/hash receipts are required.' >&2
  exit 1
}
[[ -z "$(git status --porcelain)" && "$(git rev-parse HEAD)" == "$(<"$companion_source_commit")" ]] || {
  printf '%s\n' 'The prepared artifact does not match this clean source commit.' >&2
  exit 1
}
verify_release_signature "$companion_release_dmg"
(cd "$companion_release_dir" && shasum -a 256 -c "$(basename "$companion_pre_notary_hash")")
companion_actual_dmg_hash="$(shasum -a 256 "$companion_release_dmg" | cut -d ' ' -f 1)"
[[ "$companion_actual_dmg_hash" == "$PROOF_APPROVED_DMG_SHA256" ]] || {
  printf '%s\n' 'The DMG does not match the freshly approved SHA-256. No upload performed.' >&2
  exit 1
}
companion_notary_result="$companion_release_dir/notarization-result.json"
companion_notary_log="$companion_release_dir/notarization-log.json"
companion_notary_stderr="$companion_release_dir/notarization-submit.stderr.txt"
if [[ -e "$companion_notary_result" || -e "$companion_notary_log" || -e "$companion_notary_stderr" || -e "$companion_final_hash" ]]; then
  printf '%s\n' 'Notarization receipts already exist. Preserve or move them before a new submission.' >&2
  exit 1
fi
companion_notary_submit_failed=false
if ! xcrun notarytool submit "$companion_release_dmg" --keychain-profile "$PROOF_NOTARY_PROFILE" --wait --output-format json > "$companion_notary_result" 2> "$companion_notary_stderr"; then
  companion_notary_submit_failed=true
fi
if ! companion_notary_id="$(plutil -extract id raw -o - "$companion_notary_result" 2>/dev/null)"; then
  printf 'Apple did not return a submission ID. Review %s and %s; nothing was stapled.\n' "$companion_notary_result" "$companion_notary_stderr" >&2
  exit 1
fi
[[ "$companion_notary_id" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]] || {
  printf 'Apple returned a malformed submission ID. Review %s and %s; nothing was stapled.\n' "$companion_notary_result" "$companion_notary_stderr" >&2
  exit 1
}
xcrun notarytool log "$companion_notary_id" --keychain-profile "$PROOF_NOTARY_PROFILE" "$companion_notary_log"
[[ "$companion_notary_submit_failed" == "false" ]] || {
  printf 'Notarization submission failed. Review %s, %s, and %s; nothing was stapled.\n' "$companion_notary_result" "$companion_notary_log" "$companion_notary_stderr" >&2
  exit 1
}
companion_notary_status="$(plutil -extract status raw -o - "$companion_notary_result")"
[[ "$companion_notary_status" == "Accepted" ]] || {
  printf 'Notarization status was %s. Review %s; nothing was stapled.\n' "$companion_notary_status" "$companion_notary_log" >&2
  exit 1
}
if ! companion_notary_log_summary="$(osascript -l JavaScript -e '
ObjC.import("Foundation");
function run(argv) {
  const data = $.NSData.dataWithContentsOfFile(argv[0]);
  if (!data) throw new Error("Unreadable notarization log");
  const text = $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding).js;
  const log = JSON.parse(text);
  if (!log || Array.isArray(log) || typeof log !== "object") throw new Error("Invalid notarization log");
  if (typeof log.jobId !== "string" || !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(log.jobId)) throw new Error("Invalid notarization job ID");
  if (typeof log.status !== "string" || !log.status) throw new Error("Invalid notarization status");
  if (!Object.prototype.hasOwnProperty.call(log, "issues")) throw new Error("Missing notarization issues field");
  if (log.issues !== null && !Array.isArray(log.issues)) throw new Error("Invalid notarization issues field");
  const issues = log.issues || [];
  for (const issue of issues) {
    if (!issue || typeof issue !== "object" || typeof issue.severity !== "string") throw new Error("Invalid notarization issue");
    const severity = issue.severity.toLowerCase();
    if (!["warning", "error"].includes(severity)) throw new Error("Unknown notarization issue severity");
  }
  const blocked = issues.length > 0;
  return [log.jobId, log.status, blocked ? "blocked" : "clean"].join("\t");
}' "$companion_notary_log" 2>/dev/null)"; then
  printf 'Apple returned an incomplete notarization log. Review %s; nothing was stapled.\n' "$companion_notary_log" >&2
  exit 1
fi
IFS=$'\t' read -r companion_notary_log_id companion_notary_log_status companion_notary_log_issues <<< "$companion_notary_log_summary"
companion_notary_id_normalized="$(printf '%s' "$companion_notary_id" | tr '[:upper:]' '[:lower:]')"
companion_notary_log_id_normalized="$(printf '%s' "$companion_notary_log_id" | tr '[:upper:]' '[:lower:]')"
[[ "$companion_notary_log_id_normalized" == "$companion_notary_id_normalized" && "$companion_notary_log_status" == "Accepted" ]] || {
  printf 'Apple notarization result and log do not agree. Review %s; nothing was stapled.\n' "$companion_notary_log" >&2
  exit 1
}
if [[ "$companion_notary_log_issues" == "blocked" ]]; then
  printf 'Apple returned notarization warnings or errors. Review %s; nothing was stapled.\n' "$companion_notary_log" >&2
  exit 1
fi
xcrun stapler staple "$companion_release_dmg"
xcrun stapler validate "$companion_release_dmg"
spctl --assess --type open --context context:primary-signature --verbose=2 "$companion_release_dmg"
(cd "$companion_release_dir" && shasum -a 256 "$companion_dmg_name" > "$(basename "$companion_final_hash")")
cat "$companion_final_hash"
printf 'Notarization result: %s\nNotarization log: %s\nSubmission diagnostics: %s\n' "$companion_notary_result" "$companion_notary_log" "$companion_notary_stderr"
printf '%s\n' 'Notarization/stapling checks passed. Owner-approved clean-machine launch is still required before publication.'
