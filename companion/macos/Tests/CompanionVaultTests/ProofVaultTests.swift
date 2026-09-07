import XCTest
import Foundation
import CompanionCore
@testable import CompanionVault

final class ProofVaultTests: XCTestCase {
    private var root: URL!
    private let collection = "11111111-1111-4111-8111-111111111111"
    override func setUpWithError() throws {
        // Foundation normalizes /private/var back to the /var symlink on macOS.
        // Test the authority with a literal symlink-free synthetic directory.
        root = URL(fileURLWithPath: "/private/tmp").appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    }
    override func tearDownWithError() throws { try FileManager.default.removeItem(at: root) }
    private func vault(_ name: String = "vault", now: @escaping () -> Date = Date.init) throws -> ProofVault {
        try ProofVault(directory: root.appendingPathComponent(name), collectionID: collection, now: now)
    }
    private func input(_ value: UInt8 = 1, provider: VaultProvider = .folder) -> VaultInput {
        let bytes = Data([137,80,78,71,13,10,26,10,value])
        return VaultInput(fields: VaultFields(title: "Synthetic", evidenceText: "I did not promise a result.", source: "Exact synthetic source"),
            media: VaultMedia(filename: "synthetic.png", mimeType: "image/png", sha256: digest(bytes), bytes: bytes),
            receipt: VaultProviderReceipt(provider: provider, sourceID: "synthetic-source", originalFilename: "synthetic.png", originalSha256: digest(bytes), scope: "Chosen synthetic folder"),
            provenance: ["literal": .string("No inferred meaning"), "unknown": .null])
    }
    private func source(_ v: ProofVault, trusted: Bool = false, background: Bool = false) throws -> VaultSourceGrant {
        try v.createSourceGrant(VaultSourceConfiguration(provider: .folder, sourceID: "synthetic-source", label: "Synthetic source", mode: trusted ? .trusted : .review, category: trusted ? "creativity" : nil, tags: trusted ? ["owner-tag"] : [], backgroundEnabled: background))
    }
    private func token(_ v: ProofVault, media: Bool = false) throws -> String {
        try v.issueClient(kind: .assistant, scopes: media ? [.savedText, .savedMedia] : [.savedText], expiresAt: Date().addingTimeInterval(300)).token
    }
    func testPendingIsolationLiteralApprovalAndRevisionFence() throws {
        let v = try vault(), s = try source(v), t = try token(v)
        XCTAssertEqual(try v.ingest(sourceGrantID: s.id, revision: s.revision, inputs: [input()]).pending, 1)
        XCTAssertTrue(try v.search(token: t, collectionID: collection, query: VaultQuery(text: "promise")).items.isEmpty)
        let pending = try XCTUnwrap(v.list(state: .pending).first)
        XCTAssertNil(pending.approval); XCTAssertNil(pending.fields.occurredOn)
        XCTAssertThrowsError(try v.get(token: t, collectionID: collection, id: pending.id))
        var fields = pending.fields; fields.category = "creativity"
        let saved = try v.approve(id: pending.id, revision: pending.revision, fields: fields)
        XCTAssertEqual(saved.fields.evidenceText, "I did not promise a result.")
        XCTAssertEqual(saved.receipt, pending.receipt); XCTAssertEqual(saved.provenance, pending.provenance)
        XCTAssertThrowsError(try v.approve(id: pending.id, revision: pending.revision, fields: fields))
        XCTAssertEqual(try v.search(token: t, collectionID: collection, query: VaultQuery(text: "promise")).items, [saved])
        XCTAssertThrowsError(try v.readMedia(token: t, collectionID: collection, id: saved.id, revision: saved.revision))
        let mt = try token(v, media: true)
        XCTAssertEqual(try v.readMedia(token: mt, collectionID: collection, id: saved.id, revision: saved.revision).bytes, input().media?.bytes)
    }
    func testTrustedUsesOnlyOwnerFieldsAndNeverPromotesPending() throws {
        let v = try vault(), s = try source(v)
        _ = try v.ingest(sourceGrantID: s.id, revision: s.revision, inputs: [input()])
        var config = s.configuration; config.mode = .trusted; config.category = "creativity"; config.tags = ["owner-tag"]
        let updated = try v.updateSourceGrant(id: s.id, revision: s.revision, configuration: config, paused: false)
        let result = try v.ingest(sourceGrantID: s.id, revision: updated.revision, inputs: [input(), input(2)])
        XCTAssertEqual(result.duplicates, 1); XCTAssertEqual(result.saved, 1)
        XCTAssertEqual(try v.list(state: .pending).count, 1)
        let saved = try XCTUnwrap(v.list(state: .saved).first)
        XCTAssertEqual(saved.fields.evidenceText, ""); XCTAssertEqual(saved.fields.title, "")
        XCTAssertEqual(saved.fields.tags, ["owner-tag"]); XCTAssertEqual(saved.approval?.sourceGrantRevision, updated.revision)
    }
    func testPauseRevokeBackgroundAndCancellationFailClosed() throws {
        let v = try vault(), s = try source(v)
        XCTAssertThrowsError(try v.ingest(sourceGrantID: s.id, revision: s.revision, inputs: [input()], background: true))
        var calls = 0
        XCTAssertThrowsError(try v.ingest(sourceGrantID: s.id, revision: s.revision, inputs: [input()], isCancelled: { calls += 1; return calls == 2 }))
        XCTAssertTrue(try v.list(state: .pending).isEmpty)
        XCTAssertFalse(try v.hasHandled(sourceGrantID: s.id, sha256: input().media!.sha256))
        let paused = try v.pauseSource(id: s.id, revision: s.revision)
        XCTAssertThrowsError(try v.ingest(sourceGrantID: s.id, revision: s.revision, inputs: [input()]))
        XCTAssertThrowsError(try v.ingest(sourceGrantID: s.id, revision: paused.revision, inputs: [input()]))
        try v.revokeSource(id: s.id, revision: paused.revision)
        XCTAssertTrue(try v.sourceGrants()[0].revoked)
        XCTAssertTrue(try v.sourceGrants()[0].configuration.selection.isEmpty)
    }
    func testDeleteClearAndRestartDoNotResurrect() throws {
        var v: ProofVault? = try vault()
        let s = try source(v!, trusted: true, background: true)
        _ = try v!.ingest(sourceGrantID: s.id, revision: s.revision, inputs: [input()], background: true)
        let saved = try XCTUnwrap(v!.list(state: .saved).first), t = try token(v!)
        try v!.delete(id: saved.id, revision: saved.revision)
        XCTAssertThrowsError(try v!.get(token: t, collectionID: collection, id: saved.id))
        v = nil; v = try vault()
        XCTAssertEqual(try v!.ingest(sourceGrantID: s.id, revision: s.revision, inputs: [input()]).duplicates, 1)
        try v!.clear()
        XCTAssertThrowsError(try v!.search(token: t, collectionID: collection, query: VaultQuery(text: "promise")))
        let fresh = try source(v!, trusted: true)
        XCTAssertEqual(try v!.ingest(sourceGrantID: fresh.id, revision: fresh.revision, inputs: [input()]).duplicates, 1)
    }
    func testClientHashPersistenceExpiryRevocationAndOwnerIsolation() throws {
        var now = Date(); var v: ProofVault? = try vault(now: { now })
        let issued = try v!.issueClient(kind: .assistant, scopes: [.savedText], expiresAt: now.addingTimeInterval(60))
        let database = try Data(contentsOf: root.appendingPathComponent("vault/vault.sqlite"))
        XCTAssertNil(database.range(of: Data(issued.token.utf8)))
        let other = try vault("other")
        XCTAssertThrowsError(try other.validateClient(token: issued.token, kind: .assistant, scope: .savedText, collectionID: collection))
        XCTAssertThrowsError(try v!.validateClient(token: issued.token, kind: .gallery, scope: .savedText, collectionID: collection))
        XCTAssertThrowsError(try v!.validateClient(token: issued.token, kind: .assistant, scope: .savedText, collectionID: UUID().uuidString))
        v = nil; v = try vault(now: { now })
        XCTAssertEqual(try v!.clientGrants().count, 1)
        _ = try v!.validateClient(token: issued.token, kind: .assistant, scope: .savedText, collectionID: collection)
        now = now.addingTimeInterval(61)
        XCTAssertThrowsError(try v!.validateClient(token: issued.token, kind: .assistant, scope: .savedText, collectionID: collection))
        try v!.revokeClient(id: issued.grant.id); XCTAssertTrue(try v!.clientGrants().isEmpty)
    }
    func testMalformedMediaReceiptDateAndCapacityRollback() throws {
        let v = try vault(), s = try source(v)
        var bad = input(); bad.media = VaultMedia(filename: "bad.png", mimeType: "image/png", sha256: digest(Data([1])), bytes: Data([1]))
        XCTAssertThrowsError(try v.ingest(sourceGrantID: s.id, revision: s.revision, inputs: [bad]))
        XCTAssertThrowsError(try v.ingest(sourceGrantID: s.id, revision: s.revision, inputs: [input(provider: .photos)]))
        bad = input(); bad.fields.occurredOn = "2026-02-30"
        XCTAssertThrowsError(try v.ingest(sourceGrantID: s.id, revision: s.revision, inputs: [bad]))
        _ = try v.ingest(sourceGrantID: s.id, revision: s.revision, inputs: (0..<50).map { input(UInt8($0)) })
        _ = try v.ingest(sourceGrantID: s.id, revision: s.revision, inputs: (50..<100).map { input(UInt8($0)) })
        XCTAssertThrowsError(try v.ingest(sourceGrantID: s.id, revision: s.revision, inputs: [input(100)]))
        XCTAssertFalse(try v.hasHandled(sourceGrantID: s.id, sha256: input(100).media!.sha256))
    }
    func testPermissionsSymlinksAndSingleProcessAuthority() throws {
        let v = try vault(); _ = v
        XCTAssertThrowsError(try vault())
        let attrs = try FileManager.default.attributesOfItem(atPath: root.appendingPathComponent("vault/vault.sqlite").path)
        XCTAssertEqual((attrs[.posixPermissions] as? NSNumber)?.intValue, 0o600)
        let link = root.appendingPathComponent("link")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: root.appendingPathComponent("vault"))
        XCTAssertThrowsError(try ProofVault(directory: link, collectionID: collection))
        let weak = root.appendingPathComponent("weak")
        try FileManager.default.createDirectory(at: weak, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o755])
        XCTAssertThrowsError(try ProofVault(directory: weak, collectionID: collection))
    }
    func testQueryBoundsAndStaleMedia() throws {
        let v = try vault(); var i = input(); i.fields.category = "creativity"
        let saved = try v.saveManual(i), t = try token(v, media: true)
        XCTAssertThrowsError(try v.search(token: t, collectionID: collection, query: VaultQuery(text: "", limit: 3)))
        XCTAssertThrowsError(try v.search(token: t, collectionID: collection, query: VaultQuery(text: "promise", limit: 11)))
        _ = try v.edit(id: saved.id, revision: saved.revision, fields: saved.fields)
        XCTAssertThrowsError(try v.readMedia(token: t, collectionID: collection, id: saved.id, revision: saved.revision))
    }
}
