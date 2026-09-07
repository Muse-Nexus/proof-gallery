import XCTest
import CompanionCore
import CompanionVault
@testable import ProofPhotosCompanion

@MainActor private final class QuietTestNotifications: NativeNotificationClient {
    var reads = 0; var prompts = 0; var sends = 0; var removals = 0
    func permission() async -> ReminderNotificationPermission { reads += 1; return .denied }
    func requestPermission() async throws -> ReminderNotificationPermission { prompts += 1; return .denied }
    func submit(identifier: String, title: String, body: String) async throws { sends += 1 }
    func remove(identifier: String) { removals += 1 }
}

final class NativeVaultControllerTests: XCTestCase {
    @MainActor func testNoImplicitSetupAndMissingConfiguredVaultIsNotRecreated() throws {
        let root = URL(fileURLWithPath: "/private/tmp").appendingPathComponent("proof-setup-test-\(UUID())")
        let suite = "proof-setup-test-\(UUID())", prefs = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { prefs.removePersistentDomain(forName: suite) }
        let os = QuietTestNotifications(); var attached = 0
        let controller = NativeVaultController(preferences: prefs, directory: root, notificationClient: os,
            onReady: { _ in attached += 1; return true }, beforeClear: {})
        controller.restoreIfConfigured()
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.path)); XCTAssertFalse(controller.ready)
        XCTAssertEqual(attached, 0); XCTAssertEqual(os.prompts + os.reads + os.sends + os.removals, 0)
        prefs.set(UUID().uuidString, forKey: "proof.native.collection.v1")
        controller.restoreIfConfigured()
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.path)); XCTAssertFalse(controller.ready)
    }
    @MainActor func testExplicitSyntheticSetupCreatesNoSourcesClientsOrNotificationGrant() throws {
        let root = URL(fileURLWithPath: "/private/tmp").appendingPathComponent("proof-setup-test-\(UUID())")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        let suite = "proof-setup-test-\(UUID())", prefs = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { prefs.removePersistentDomain(forName: suite); try? FileManager.default.removeItem(at: root) }
        let os = QuietTestNotifications(); var attached = 0
        let controller = NativeVaultController(preferences: prefs, directory: root.appendingPathComponent("vault"), notificationClient: os,
            onReady: { _ in attached += 1; return true }, beforeClear: {})
        controller.setUpFromOwnerAction()
        XCTAssertTrue(controller.ready); XCTAssertEqual(attached, 1); XCTAssertEqual(controller.port, 0)
        let vault = try XCTUnwrap(controller.vault)
        XCTAssertTrue(try vault.sourceGrants().isEmpty); XCTAssertTrue(try vault.clientGrants().isEmpty)
        XCTAssertNil(try vault.reminderConsent()); XCTAssertEqual(os.prompts + os.reads + os.sends + os.removals, 0)
        controller.setUpFromOwnerAction(); XCTAssertEqual(attached, 1)
        controller.stopForTermination()
    }
    @MainActor func testExistingIdentityReconnectNeedsConfirmationAndDoesNotRunAtStartup() throws {
        let root = URL(fileURLWithPath: "/private/tmp").appendingPathComponent("proof-reconnect-\(UUID())")
        let suite = "proof-reconnect-\(UUID())", prefs = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { prefs.removePersistentDomain(forName: suite); try? FileManager.default.removeItem(at: root) }
        let id = UUID().uuidString
        var original: ProofVault? = try ProofVault(directory: root, collectionID: id)
        XCTAssertNotNil(original); original = nil
        let os = QuietTestNotifications(); var attached = 0
        let controller = NativeVaultController(preferences: prefs, directory: root, notificationClient: os,
            onReady: { _ in attached += 1; return true }, beforeClear: {})
        defer { controller.stopForTermination() }
        controller.restoreIfConfigured()
        controller.reconnectFromOwnerConfirmation()
        XCTAssertEqual(attached, 0); XCTAssertNil(prefs.string(forKey: "proof.native.collection.v1"))
        controller.requestReconnectFromOwnerAction()
        XCTAssertTrue(controller.reconnectConfirmation); XCTAssertEqual(attached, 0)
        XCTAssertFalse(controller.ready); XCTAssertNil(prefs.string(forKey: "proof.native.collection.v1"))
        controller.cancelReconnect(); controller.reconnectFromOwnerConfirmation()
        XCTAssertEqual(attached, 0)
        controller.requestReconnectFromOwnerAction()
        // SwiftUI can dismiss the dialog binding before invoking its button action.
        controller.reconnectConfirmation = false
        controller.reconnectFromOwnerConfirmation()
        XCTAssertEqual(attached, 1); XCTAssertTrue(controller.ready)
        XCTAssertEqual(controller.vault?.collectionID, id)
        XCTAssertEqual(prefs.string(forKey: "proof.native.collection.v1"), id)
        XCTAssertEqual(os.prompts + os.reads + os.sends + os.removals, 0)
    }
    @MainActor func testReconnectMissingStorageAndRejectedAttachmentDoNotPersistIdentity() throws {
        let root = URL(fileURLWithPath: "/private/tmp").appendingPathComponent("proof-reconnect-\(UUID())")
        let suite = "proof-reconnect-\(UUID())", prefs = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { prefs.removePersistentDomain(forName: suite); try? FileManager.default.removeItem(at: root) }
        let os = QuietTestNotifications(); var attached = 0
        let controller = NativeVaultController(preferences: prefs, directory: root, notificationClient: os,
            onReady: { _ in attached += 1; return false }, beforeClear: {})
        controller.requestReconnectFromOwnerAction(); controller.reconnectFromOwnerConfirmation()
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.path)); XCTAssertEqual(attached, 0)
        var original: ProofVault? = try ProofVault(directory: root, collectionID: UUID().uuidString)
        XCTAssertNotNil(original); original = nil
        controller.requestReconnectFromOwnerAction(); controller.reconnectFromOwnerConfirmation()
        XCTAssertEqual(attached, 1); XCTAssertFalse(controller.ready); XCTAssertNil(controller.vault)
        XCTAssertNil(prefs.string(forKey: "proof.native.collection.v1"))
        XCTAssertEqual(os.prompts + os.reads + os.sends + os.removals, 0)
    }

}
