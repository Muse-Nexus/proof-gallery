import XCTest
import CompanionCore
import CompanionVault

/// Explicitly gated synthetic server for scripts/e2e-native.mjs, never normal tests.
final class NativeBrowserFixtureTests: XCTestCase {
    func testServeExplicitSyntheticBrowserFixture() async throws {
        guard let raw = ProcessInfo.processInfo.environment["PROOF_E2E_FIXTURE_DIRECTORY"] else {
            throw XCTSkip("Only the explicit isolated browser harness starts this fixture")
        }
        let output = URL(fileURLWithPath: raw)
        guard output.deletingLastPathComponent().path == "/private/tmp",
              output.lastPathComponent.hasPrefix("proof-native-e2e-"),
              (try output.resourceValues(forKeys: [.isSymbolicLinkKey])).isSymbolicLink != true else {
            throw VaultError.unsafePath
        }
        let attributes = try FileManager.default.attributesOfItem(atPath: output.path)
        guard (attributes[.posixPermissions] as? NSNumber)?.intValue == 0o700 else { throw VaultError.unsafePath }
        let fixture = try SyntheticVaultBridge(); defer { fixture.close() }
        try await fixture.start()
        let bytes = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")!
        let input = VaultInput(fields: VaultFields(evidenceText: "I did not promise a result. Synthetic creativity evidence.", occurredOn: "2026-08-03", source: "Literal synthetic source"),
            media: VaultMedia(filename: "synthetic.png", mimeType: "image/png", sha256: digest(bytes), bytes: bytes),
            receipt: VaultProviderReceipt(provider: .folder, sourceID: "synthetic-browser-folder", originalFilename: "synthetic.png",
                originalSha256: digest(bytes), captureDate: "2026-08-03T12:00:00.000Z", timeZone: "UTC", scope: "Selected synthetic folder"))
        let source = try fixture.vault.createSourceGrant(VaultSourceConfiguration(provider: .folder, sourceID: "synthetic-browser-folder", label: "Synthetic browser source"))
        _ = try fixture.vault.ingest(sourceGrantID: source.id, revision: source.revision, inputs: [input])
        let pending = try XCTUnwrap(fixture.vault.list(state: .pending).first)
        let gallery = try fixture.grant(.gallery, scopes: [.savedText, .savedMedia, .galleryReview])
        let assistant = try fixture.grant(.assistant, scopes: [.savedText])
        let descriptor: [String: Any] = [
            "port": fixture.port, "galleryToken": gallery.token, "assistantToken": assistant.token,
            "collectionID": fixture.vault.collectionID, "pendingID": pending.id,
            "literal": pending.fields.evidenceText, "occurredOn": pending.fields.occurredOn!,
            "source": pending.fields.source!, "originalSha256": input.media!.sha256,
        ]
        let path = output.appendingPathComponent("fixture.json")
        try JSONSerialization.data(withJSONObject: descriptor).write(to: path, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path.path)
        let deadline = Date().addingTimeInterval(180)
        var revoked = false
        while Date() < deadline && !FileManager.default.fileExists(atPath: output.appendingPathComponent("stop").path) {
            if !revoked && FileManager.default.fileExists(atPath: output.appendingPathComponent("revoke").path) {
                try fixture.vault.revokeClient(id: gallery.grant.id)
                revoked = true
                try Data("revoked".utf8).write(to: output.appendingPathComponent("revoked"), options: .atomic)
            }
            try await Task.sleep(for: .milliseconds(100))
        }
        guard FileManager.default.fileExists(atPath: output.appendingPathComponent("stop").path) else {
            XCTFail("Synthetic browser harness exceeded its 180-second bound"); return
        }
    }
}
