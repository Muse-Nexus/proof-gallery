import XCTest
import Foundation
@testable import CompanionVault

final class VaultInitializationTests: XCTestCase {
    private var root: URL!
    private let collection = "11111111-1111-4111-8111-111111111111"
    override func setUpWithError() throws {
        root = URL(fileURLWithPath: "/private/tmp").appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false,
                                                attributes: [.posixPermissions: 0o700])
    }
    override func tearDownWithError() throws { try FileManager.default.removeItem(at: root) }

    func testFreshInitializationCommitsAllTablesAndIdentityTogether() throws {
        var vault: ProofVault? = try ProofVault(directory: root, collectionID: collection, ownerID: "synthetic-owner")
        XCTAssertEqual(vault?.ownerID, "synthetic-owner")
        vault = nil
        var db: VaultDatabase? = try VaultDatabase(directory: root)
        XCTAssertEqual(try db?.rows("SELECT name FROM sqlite_master WHERE type='table'").count, 8)
        XCTAssertEqual(try db?.rows("SELECT key FROM metadata").count, 3)
        XCTAssertEqual(try db?.rows("SELECT value FROM metadata WHERE key='version'").first?.first, Data("1".utf8))
        db = nil
        XCTAssertNoThrow(try ProofVault(directory: root, collectionID: collection, ownerID: "synthetic-owner"))
        XCTAssertThrowsError(try ProofVault(directory: root, collectionID: collection, ownerID: "different-owner"))
    }

    func testIdentityFailureRollsBackTablesWithoutRemovingUnknownObject() throws {
        // A synthetic metadata view forces an identity failure AFTER the table DDL.
        var db: VaultDatabase? = try VaultDatabase(directory: root)
        try db?.run("CREATE VIEW metadata AS SELECT 'collection' AS key, 'conflicting-identity' AS value")
        db = nil
        XCTAssertThrowsError(try ProofVault(directory: root, collectionID: collection))
        db = try VaultDatabase(directory: root)
        XCTAssertEqual(try db?.rows("SELECT name FROM sqlite_master WHERE type='table'").count, 0)
        XCTAssertEqual(try db?.rows("SELECT name FROM sqlite_master WHERE type='view'").count, 1)
        // Only this test removes its own obstruction; production never recovers destructively.
        try db?.run("DROP VIEW metadata")
        db = nil
        XCTAssertNoThrow(try ProofVault(directory: root, collectionID: collection))
    }

    func testAbandonedTransactionRollsBackSchemaAndPartialIdentity() throws {
        var db: VaultDatabase? = try VaultDatabase(directory: root)
        XCTAssertThrowsError(try db?.initializeSchema())
        try db?.run("BEGIN IMMEDIATE")
        try db?.initializeSchema()
        try db?.run("INSERT INTO metadata VALUES ('collection', ?)", [.text(collection)])
        XCTAssertEqual(try db?.rows("SELECT name FROM sqlite_master WHERE type='table'").count, 8)
        // Deterministically abandon the real transaction, without claiming a process kill.
        db = nil
        db = try VaultDatabase(directory: root)
        XCTAssertEqual(try db?.rows("SELECT name FROM sqlite_master WHERE type='table'").count, 0)
        db = nil
        XCTAssertNoThrow(try ProofVault(directory: root, collectionID: collection))
    }

    func testPreviouslyCommittedPartialSchemaRemainsUntouchedAndRejected() throws {
        var db: VaultDatabase? = try VaultDatabase(directory: root)
        try db?.run("CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        db = nil
        let file = root.appendingPathComponent("vault.sqlite")
        let before = try Data(contentsOf: file)
        XCTAssertThrowsError(try ProofVault(directory: root, collectionID: collection))
        XCTAssertEqual(try Data(contentsOf: file), before)
    }
}
