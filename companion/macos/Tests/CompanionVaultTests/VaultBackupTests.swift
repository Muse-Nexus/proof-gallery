import XCTest
import Foundation
import CompanionCore
@testable import CompanionVault

final class VaultBackupTests: XCTestCase {
    private var root: URL!
    private let passphrase = "synthetic passphrase only"
    private let originalCollection = "11111111-1111-4111-8111-111111111111"
    private let receivingCollection = "22222222-2222-4222-8222-222222222222"
    override func setUpWithError() throws {
        root = URL(fileURLWithPath: "/private/tmp").appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    }
    override func tearDownWithError() throws { try FileManager.default.removeItem(at: root) }
    private func vault(_ name: String, collection: String? = nil) throws -> ProofVault {
        try ProofVault(directory: root.appendingPathComponent(name), collectionID: collection ?? originalCollection)
    }
    private func mediaInput(_ value: UInt8 = 1) -> VaultInput {
        let bytes = Data([137,80,78,71,13,10,26,10,value])
        return VaultInput(fields: VaultFields(title: "Synthetic literal", evidenceText: "I did not promise a result.\nThese are the original words.", category: "creativity", source: "Synthetic exact source", tags: ["literal"]),
            media: VaultMedia(filename: "synthetic.png", mimeType: "image/png", sha256: digest(bytes), bytes: bytes),
            receipt: VaultProviderReceipt(provider: .folder, sourceID: "synthetic-source", originalFilename: "synthetic.png", originalSha256: digest(bytes), scope: "Synthetic chosen folder"),
            provenance: ["original": .string("Literal source"), "unknown": .null])
    }
    private func mutate(_ archive: Data, _ operation: (inout [String: Any]) throws -> Void) throws -> Data {
        var json = try XCTUnwrap(JSONSerialization.jsonObject(with: VaultBackup.decrypt(archive, passphrase: passphrase)) as? [String: Any])
        try operation(&json)
        return try VaultBackup.encrypt(JSONSerialization.data(withJSONObject: json, options: [.sortedKeys]), passphrase: passphrase)
    }
    func testBrowserWebCryptoEnvelopeKnownVector() throws {
        // Generated using the unchanged browser WebCrypto parameters, fixed synthetic salt/IV.
        let vector = try XCTUnwrap(Data(base64Encoded: "UFJPT0ZFTkMBAAknwAABAgMEBQYHCAkKCwwNDg8QERITFBUWFxgZGhsbRfyArALBfNTlISCPEBt59RzosKW0j1ZUQym5KwyoPCVdbYBp5PsjumuTRnDNvIoo5qRgf86jbBOVMWVWnw=="))
        XCTAssertEqual(String(data: try VaultBackup.decrypt(vector, passphrase: passphrase), encoding: .utf8), "Synthetic literal: I did not promise a result.")
        let first = try VaultBackup.encrypt(Data("synthetic".utf8), passphrase: passphrase)
        let second = try VaultBackup.encrypt(Data("synthetic".utf8), passphrase: passphrase)
        XCTAssertNotEqual(first, second)
        XCTAssertEqual(try VaultBackup.decrypt(first, passphrase: passphrase), Data("synthetic".utf8))
    }
    func testRoundtripPreservesStatesReceiptsMediaAndUnknownFieldsWithoutGrants() throws {
        let source = try vault("source"), target = try vault("target", collection: receivingCollection)
        let saved = try source.saveManual(mediaInput()), pending = try source.stageManual(mediaInput(2))
        let grant = try source.createSourceGrant(VaultSourceConfiguration(provider: .folder, sourceID: "synthetic-source", label: "Synthetic grant", selection: ["bookmark": .string("SYNTHETIC-BOOKMARK-NOT-EXPORTED")]))
        let client = try source.issueClient(kind: .assistant, scopes: [.savedText], expiresAt: Date().addingTimeInterval(300))
        _ = try source.setReminderConsent(ReminderConsent(ownerID: source.ownerID, collectionID: source.collectionID, revision: 1, enabled: true, paused: false, timeZone: "UTC", scheduledMinute: 720, quietHours: nil, cooldownMinutes: 60), expectedRevision: nil)
        let archive = try source.exportEncryptedBackup(passphrase: passphrase)
        let plain = try VaultBackup.decrypt(archive, passphrase: passphrase)
        XCTAssertNil(plain.range(of: Data("SYNTHETIC-BOOKMARK-NOT-EXPORTED".utf8)))
        XCTAssertNil(plain.range(of: Data(client.token.utf8)))
        XCTAssertNil(plain.range(of: Data(grant.id.utf8)))
        XCTAssertNil(archive.range(of: Data(saved.fields.evidenceText.utf8)))
        let result = try target.restoreEncryptedBackup(archive, passphrase: passphrase)
        XCTAssertEqual(result.saved, 1); XCTAssertEqual(result.pending, 1)
        let restored = try XCTUnwrap(target.list(state: .saved).first)
        XCTAssertEqual(restored.fields, saved.fields); XCTAssertNil(restored.fields.occurredOn)
        XCTAssertEqual(restored.provenance, saved.provenance); XCTAssertEqual(restored.receipt, saved.receipt)
        XCTAssertEqual(restored.approval, saved.approval); XCTAssertEqual(restored.id, saved.id)
        XCTAssertNotEqual(restored.revision, saved.revision); XCTAssertEqual(restored.collectionID, receivingCollection)
        XCTAssertEqual(restored.restoreReceipt?.originalCollectionID, originalCollection)
        XCTAssertEqual(try target.media(id: restored.id, revision: restored.revision).bytes, mediaInput().media?.bytes)
        XCTAssertEqual(try target.list(state: .pending).first?.fields, pending.fields)
        XCTAssertNil(try target.list(state: .pending).first?.approval)
        XCTAssertTrue(try target.sourceGrants().isEmpty); XCTAssertTrue(try target.clientGrants().isEmpty)
        XCTAssertNil(try target.reminderConsent())
        XCTAssertThrowsError(try target.validateClient(token: client.token, kind: .assistant, scope: .savedText, collectionID: receivingCollection))
        let edited = try target.edit(id: restored.id, revision: restored.revision, fields: restored.fields)
        XCTAssertEqual(edited.restoreReceipt, restored.restoreReceipt)
    }
    func testTrustedApprovalRemainsHistoricalNotReactivated() throws {
        let source = try vault("source"), target = try vault("target")
        let grant = try source.createSourceGrant(VaultSourceConfiguration(provider: .folder, sourceID: "synthetic-source", label: "Explicit synthetic source", mode: .trusted, category: "creativity"))
        _ = try source.ingest(sourceGrantID: grant.id, revision: grant.revision, inputs: [mediaInput()])
        let saved = try XCTUnwrap(source.list(state: .saved).first)
        _ = try target.restoreEncryptedBackup(source.exportEncryptedBackup(passphrase: passphrase), passphrase: passphrase)
        XCTAssertEqual(try target.list(state: .saved).first?.approval, saved.approval)
        XCTAssertTrue(try target.sourceGrants().isEmpty)
        XCTAssertThrowsError(try target.ingest(sourceGrantID: grant.id, revision: grant.revision, inputs: [mediaInput(2)]))
    }
    func testWrongPassphraseTamperAndUntrustedHeaderFailWithoutWrites() throws {
        let source = try vault("source"), target = try vault("target")
        _ = try source.saveManual(mediaInput())
        let archive = try source.exportEncryptedBackup(passphrase: passphrase)
        XCTAssertThrowsError(try target.restoreEncryptedBackup(archive, passphrase: "wrong synthetic passphrase")) { XCTAssertTrue($0 is VaultBackupError) }
        for index in [0, 8, 9, 13, 29, 42, archive.count - 1] {
            var changed = archive; changed[index] ^= 1
            XCTAssertThrowsError(try target.restoreEncryptedBackup(changed, passphrase: passphrase))
        }
        XCTAssertThrowsError(try target.restoreEncryptedBackup(Data(archive.prefix(41)), passphrase: passphrase))
        XCTAssertThrowsError(try source.exportEncryptedBackup(passphrase: "too short"))
        XCTAssertTrue(try target.list(state: .saved).isEmpty)
        XCTAssertTrue(try target.list(state: .pending).isEmpty)
    }
    func testRejectsConnectedOrNonemptyDestinationAndPreservesExistingData() throws {
        let source = try vault("source"), target = try vault("target")
        _ = try source.saveManual(mediaInput()); let archive = try source.exportEncryptedBackup(passphrase: passphrase)
        let existing = try target.stageManual(mediaInput(2))
        XCTAssertThrowsError(try target.restoreEncryptedBackup(archive, passphrase: passphrase))
        XCTAssertEqual(try target.list(state: .pending).first, existing)
        try target.clear()
        _ = try target.issueClient(kind: .gallery, scopes: [.savedText, .galleryReview], expiresAt: Date().addingTimeInterval(300))
        XCTAssertThrowsError(try target.restoreEncryptedBackup(archive, passphrase: passphrase))
        try target.clear()
        _ = try target.createSourceGrant(VaultSourceConfiguration(provider: .folder, sourceID: "synthetic", label: "Synthetic"))
        XCTAssertThrowsError(try target.restoreEncryptedBackup(archive, passphrase: passphrase))
        try target.clear()
        XCTAssertEqual(try target.restoreEncryptedBackup(archive, passphrase: passphrase).saved, 1)
    }
    func testMalformedContentCapacityAndHashIntegrityRejectWholeArchive() throws {
        let source = try vault("source"), target = try vault("target")
        _ = try source.stageManual(mediaInput()); let archive = try source.exportEncryptedBackup(passphrase: passphrase)
        let badHash = try mutate(archive) { root in
            var entries = root["entries"] as! [[String: Any]], media = entries[0]["media"] as! [String: Any]
            media["sha256"] = String(repeating: "0", count: 64); entries[0]["media"] = media; root["entries"] = entries
        }
        XCTAssertThrowsError(try target.restoreEncryptedBackup(badHash, passphrase: passphrase))
        let extraGrant = try mutate(archive) { $0["sourceGrants"] = [] }
        XCTAssertThrowsError(try target.restoreEncryptedBackup(extraGrant, passphrase: passphrase))
        let overCapacity = try mutate(archive) { root in
            let original = (root["entries"] as! [[String: Any]])[0]
            root["entries"] = (0..<101).map { _ -> [String: Any] in
                var entry = original, r = original["record"] as! [String: Any]
                r["id"] = UUID().uuidString; entry["record"] = r; return entry
            }
        }
        XCTAssertThrowsError(try target.restoreEncryptedBackup(overCapacity, passphrase: passphrase))
        let invalidCategory = try mutate(archive) { root in
            var entries = root["entries"] as! [[String: Any]], record = entries[0]["record"] as! [String: Any], fields = record["fields"] as! [String: Any]
            fields["category"] = "inferred-worth"; record["fields"] = fields; entries[0]["record"] = record; root["entries"] = entries
        }
        XCTAssertThrowsError(try target.restoreEncryptedBackup(invalidCategory, passphrase: passphrase))
        XCTAssertTrue(try target.list(state: .pending).isEmpty); XCTAssertTrue(try target.list(state: .saved).isEmpty)
    }
    func testStorageFailureMidRestoreRollsBackAllRows() throws {
        let source = try vault("source")
        _ = try source.saveManual(mediaInput()); _ = try source.stageManual(mediaInput(2))
        let archive = try source.exportEncryptedBackup(passphrase: passphrase)
        var target: ProofVault? = try vault("target"); target = nil
        var fault: VaultDatabase? = try VaultDatabase(directory: root.appendingPathComponent("target"))
        try fault!.run("CREATE TRIGGER synthetic_failure BEFORE INSERT ON records WHEN (SELECT COUNT(*) FROM records)>=1 BEGIN SELECT RAISE(ABORT,'synthetic'); END")
        fault = nil; target = try vault("target")
        XCTAssertThrowsError(try target!.restoreEncryptedBackup(archive, passphrase: passphrase))
        XCTAssertTrue(try target!.list(state: .pending).isEmpty); XCTAssertTrue(try target!.list(state: .saved).isEmpty)
    }
    func testUnknownDatabaseVersionRejectedWithoutMigration() throws {
        var target: ProofVault? = try vault("target"); target = nil
        var editor: VaultDatabase? = try VaultDatabase(directory: root.appendingPathComponent("target"))
        try editor!.run("UPDATE metadata SET value='2' WHERE key='version'"); editor = nil
        let before = try Data(contentsOf: root.appendingPathComponent("target/vault.sqlite"))
        XCTAssertThrowsError(try vault("target"))
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("target/vault.sqlite")), before)
        _ = target
    }
}
