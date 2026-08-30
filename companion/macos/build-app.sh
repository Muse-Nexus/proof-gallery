#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
swift build -c release
companion_bin_dir="$(swift build -c release --show-bin-path)"
companion_app="$PWD/.build/Proof Photos Companion.app"
mkdir -p "$companion_app/Contents/MacOS" "$companion_app/Contents/Resources"
cp "$companion_bin_dir/ProofPhotosCompanion" "$companion_app/Contents/MacOS/ProofPhotosCompanion"
cp Info.plist "$companion_app/Contents/Info.plist"
codesign --force --sign - --entitlements ProofPhotosCompanion.entitlements "$companion_app"
codesign --verify --strict "$companion_app"
printf '%s\n' "$companion_app"
