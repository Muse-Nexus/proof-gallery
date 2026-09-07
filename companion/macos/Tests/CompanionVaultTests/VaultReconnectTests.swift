import XCTest
import Foundation
@testable import CompanionVault

final class VaultReconnectTests: XCTestCase {
    private var root: URL!
    private let collection = "11111111-1111-4111-8111-111111111111"
    override func setUpWithError() throws {
        root = URL(fileURLWithPath: "/private/tmp").appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    }
    override func tearDownWithError() throws { try FileManager.default.removeItem(at: root) }
    func testMissingStorageNeverCreatesDirectoryLockOrDatabase() throws {
        XCTAssertThrowsError(try ProofVault.reconnectExisting(directory: root.appendingPathComponent("missing")))
        XCTAssertThrowsError(try ProofVault.reconnectExisting(directory: root))
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: root.path), [])
    }
    func testExistingIdentityReusesLockedConnectionAndRetainsContent() throws {
        var original: ProofVault? = try ProofVault(directory: root, collectionID: collection)
        _ = try original?.saveManual(VaultInput(fields: VaultFields(title: "Synthetic recovery note", evidenceText: "Synthetic literal evidence", category: "creativity", sourceType: "memory")))
        XCTAssertThrowsError(try ProofVault.reconnectExisting(directory: root))
        original = nil
        let recovered = try ProofVault.reconnectExisting(directory: root)
        XCTAssertEqual(recovered.collectionID, collection)
        XCTAssertEqual(try recovered.list(state: .saved).first?.fields.title, "Synthetic recovery note")
        XCTAssertThrowsError(try ProofVault.reconnectExisting(directory: root))
    }
    func testForeignOwnerAndInvalidIdentityRemainUnchanged() throws {
        var original: ProofVault? = try ProofVault(directory: root, collectionID: collection, ownerID: "synthetic-foreign")
        XCTAssertNotNil(original); original = nil
        let file = root.appendingPathComponent("vault.sqlite"), before = try Data(contentsOf: root.appendingPathComponent("vault.sqlite"))
        XCTAssertThrowsError(try ProofVault.reconnectExisting(directory: root))
        XCTAssertEqual(try Data(contentsOf: file), before)
        var db: VaultDatabase? = try VaultDatabase(directory: root)
        try db?.run("UPDATE metadata SET value='invalid-uuid' WHERE key='collection'")
        db = nil
        let invalid = try Data(contentsOf: file)
        XCTAssertThrowsError(try ProofVault.reconnectExisting(directory: root, ownerID: "synthetic-foreign"))
        XCTAssertEqual(try Data(contentsOf: file), invalid)
    }
    func testMalformedSchemaIsRejectedWithoutRepair() throws {
        var original: ProofVault? = try ProofVault(directory: root, collectionID: collection)
        XCTAssertNotNil(original); original = nil
        var db: VaultDatabase? = try VaultDatabase(directory: root)
        try db?.run("DROP TABLE records")
        try db?.run("CREATE TABLE records (unexpected TEXT)")
        db = nil
        let file = root.appendingPathComponent("vault.sqlite"), before = try Data(contentsOf: root.appendingPathComponent("vault.sqlite"))
        XCTAssertThrowsError(try ProofVault.reconnectExisting(directory: root))
        XCTAssertEqual(try Data(contentsOf: file), before)
    }
    func testCorruptEmptyAndUnknownVersionRemainUnchanged() throws {
        var original: ProofVault? = try ProofVault(directory: root, collectionID: collection)
        XCTAssertNotNil(original); original = nil
        let file = root.appendingPathComponent("vault.sqlite")
        var db: VaultDatabase? = try VaultDatabase(directory: root)
        try db?.run("UPDATE metadata SET value='999' WHERE key='version'"); db = nil
        let unknown = try Data(contentsOf: file)
        XCTAssertThrowsError(try ProofVault.reconnectExisting(directory: root))
        XCTAssertEqual(try Data(contentsOf: file), unknown)
        for bytes in [Data("synthetic corrupt database".utf8), Data()] {
            try bytes.write(to: file)
            XCTAssertThrowsError(try ProofVault.reconnectExisting(directory: root))
            XCTAssertEqual(try Data(contentsOf: file), bytes)
        }
    }
}
