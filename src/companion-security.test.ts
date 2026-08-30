import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const native = readFileSync("companion/macos/Sources/ProofPhotosCompanion/PhotosModel.swift", "utf8");
const entrypoint = readFileSync("companion/macos/Sources/ProofPhotosCompanion/ProofCompanionApp.swift", "utf8");
const vision = readFileSync("companion/macos/Sources/CompanionVision/LocalTextRead.swift", "utf8");
const entitlements = readFileSync("companion/macos/ProofPhotosCompanion.entitlements", "utf8");
it("keeps the native adapter read-only and without network entitlements", () => {
  expect(native).not.toMatch(/performChanges|PHAssetChangeRequest|PHAssetCollectionChangeRequest|URLSession|URLRequest/);
  expect(native).toContain("options.isNetworkAccessAllowed = false");
  expect(entitlements).toContain("com.apple.security.app-sandbox");
  expect(entitlements).toContain("com.apple.security.personal-information.photos-library");
  expect(entitlements).not.toMatch(/network.client|network.server|pictures.read|all-files/);
});
it("keeps connect, bounded start, pause and lifecycle gates explicit", () => {
  expect(native.indexOf("requestAuthorization")).toBeGreaterThan(native.indexOf("func connect()"));
  expect(native).toContain("options.fetchLimit = ReviewLimits.photoCount");
  expect(native).toContain("options.includeHiddenAssets = false");
  expect(native).toContain("activeRead?.cancel()");
  expect(native).toContain("self.generation == scanGeneration");
  const pause = native.slice(native.indexOf("func pause()"), native.indexOf("func disconnect()"));
  expect(pause).toContain("unregisterChangeObserver");
  expect(entrypoint).toContain("func windowShouldClose");
  expect(entrypoint).toContain("!model.photos.isEmpty && !model.exported");
});
it("keeps Recent Photos bounded and local cues separate from exported evidence", () => {
  expect(entrypoint).toContain('Text("Recent Photos (no Favorites needed)").tag("recent")');
  expect(native).toContain('if selectedSource == "favorites" || selectedSource == "recent"');
  expect(native).toContain('if selectedSource == "favorites" { predicates.append');
  expect(native).toContain('creationDate >= %@'); expect(native).toContain('creationDate <= %@');
  expect(native).toContain('options.includeAssetSourceTypes = .typeUserLibrary');
  expect(native).toContain('@Published var readTextLocally = false');
  expect(native).toContain('activeTextRead?.cancel()');
  expect(native).toContain('ReviewPackage(items: photos).encoded()');
  expect(vision).toContain('DispatchQueue.global(qos: .utility).async');
  expect(vision).toContain('current?.cancel()');
  expect(vision).toContain('request.usesLanguageCorrection = false');
  expect(vision).not.toMatch(/URLSession|URLRequest|PHAsset|PHPhotoLibrary|FileManager/);
  expect(entrypoint).toContain('Machine-read text · unverified excerpt');
  expect(entrypoint).toContain('Export includes the whole batch');
});
