import XCTest
import Foundation
import CompanionCore
import CompanionVault
@testable import ProofPhotosCompanion

/// Entirely synthetic. No NSApplication/window, Photos authorization, source
/// bookmark, real notification client, or OS service registration is constructed.
@MainActor private final class LifecycleNotifications: NativeNotificationClient {
    var reads = 0
    var prompts = 0
    var submissions = 0
    var removals = 0
    func permission() async -> ReminderNotificationPermission { reads += 1; return .denied }
    func requestPermission() async throws -> ReminderNotificationPermission { prompts += 1; return .denied }
    func submit(identifier: String, title: String, body: String) async throws { submissions += 1 }
    func remove(identifier: String) { removals += 1 }
}

final class NativeLifecycleTests: XCTestCase {
    private var root: URL!
    private var preferenceSuite: String!
    private var preferences: UserDefaults!
    private let collectionID = "66666666-6666-4666-8666-666666666666"

    override func setUpWithError() throws {
        root = URL(fileURLWithPath: "/private/tmp").appendingPathComponent("proof-lifecycle-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        preferenceSuite = "proof-lifecycle-\(UUID().uuidString)"
        preferences = try XCTUnwrap(UserDefaults(suiteName: preferenceSuite))
    }
    override func tearDownWithError() throws {
        preferences.removePersistentDomain(forName: preferenceSuite)
        try FileManager.default.removeItem(at: root)
    }
    private func authority(_ name: String = "vault") throws -> ProofVault {
        try ProofVault(directory: root.appendingPathComponent(name), collectionID: collectionID)
    }
    private func preparedPhoto() throws -> ReviewPhoto {
        let png = Data([137,80,78,71,13,10,26,10])
        return try ReviewPhoto.make(original: png, media: png, filename: "synthetic.png", originalFilename: "synthetic.png",
            mimeType: "image/png", assetIdentifier: "synthetic-legacy-item", creationDate: nil,
            timeZone: .gmt, scope: "Synthetic prepared batch", isPreview: false)
    }

    @MainActor func testAcknowledgedAttachStopsLegacyStateWithoutDiscardingPreparedEvidence() throws {
        let model = PhotosModel(), vault = try authority(), photo = try preparedPhoto()
        model.photos = [photo]; model.exported = false
        // Flags represent an in-flight legacy batch; no Photos read is started.
        model.active = true; model.scanning = true; model.allowICloudDownloads = true
        model.pairingCode = "synthetic-stale-code"
        XCTAssertTrue(model.attachVault(vault))
        XCTAssertTrue(model.hasVault); XCTAssertTrue(model.localVault === vault)
        XCTAssertFalse(model.active); XCTAssertFalse(model.scanning); XCTAssertFalse(model.allowICloudDownloads)
        XCTAssertEqual(model.pairingCode, "")
        XCTAssertEqual(model.photos, [photo]); XCTAssertFalse(model.exported)
        XCTAssertTrue(try vault.list(state: .saved).isEmpty)
        XCTAssertTrue(try vault.list(state: .pending).isEmpty)
        XCTAssertTrue(try vault.sourceGrants().isEmpty)
        XCTAssertTrue(model.attachVault(vault)) // Idempotent acknowledgement, no source grant.
        let other = try authority("other")
        XCTAssertFalse(model.attachVault(other)); XCTAssertTrue(model.localVault === vault)
        XCTAssertEqual(model.photos, [photo])
        model.stopForTermination()
    }

    @MainActor func testReadyRequiresSuccessfulAttachmentAndCanRetryConfiguredStore() throws {
        let notifications = LifecycleNotifications()
        var accepts = false, attempts = 0
        let controller = NativeVaultController(preferences: preferences, directory: root.appendingPathComponent("vault"),
            notificationClient: notifications, onReady: { _ in attempts += 1; return accepts }, beforeClear: {})
        defer { controller.stopForTermination() }
        controller.setUpFromOwnerAction()
        XCTAssertEqual(attempts, 1)
        XCTAssertFalse(controller.ready); XCTAssertNil(controller.vault)
        XCTAssertEqual(controller.port, 0); XCTAssertFalse(controller.remindersOn)
        XCTAssertTrue(controller.clients.isEmpty); XCTAssertFalse(controller.keepsServicesRunningAfterWindowClose)
        XCTAssertEqual(notifications.reads + notifications.prompts + notifications.submissions + notifications.removals, 0)
        let selectedID = try XCTUnwrap(preferences.string(forKey: "proof.native.collection.v1"))
        accepts = true
        controller.restoreIfConfigured()
        XCTAssertTrue(controller.ready); XCTAssertEqual(attempts, 2)
        XCTAssertEqual(controller.vault?.collectionID, selectedID)
        XCTAssertTrue(try XCTUnwrap(controller.vault).sourceGrants().isEmpty)
        XCTAssertEqual(notifications.reads + notifications.prompts + notifications.submissions, 0)
    }

    @MainActor func testControllerAcknowledgesActualModelAttachmentBeforeReady() throws {
        let model = PhotosModel(), photo = try preparedPhoto(), notifications = LifecycleNotifications()
        model.photos = [photo]; model.active = true; model.scanning = true
        let controller = NativeVaultController(preferences: preferences, directory: root.appendingPathComponent("vault"),
            notificationClient: notifications, onReady: { model.attachVault($0) }, beforeClear: {})
        defer { model.stopForTermination(); controller.stopForTermination() }
        controller.setUpFromOwnerAction()
        XCTAssertTrue(controller.ready); XCTAssertTrue(model.hasVault)
        XCTAssertTrue(model.localVault === controller.vault)
        XCTAssertFalse(model.active); XCTAssertFalse(model.scanning)
        XCTAssertEqual(model.photos, [photo])
        XCTAssertFalse(model.backgroundEnabled); XCTAssertFalse(controller.keepsServicesRunningAfterWindowClose)
        XCTAssertEqual(notifications.reads + notifications.prompts + notifications.submissions, 0)
    }

    @MainActor func testAttachPreservesPausedSourceConsentAndPreparedBatchWithoutStartingReads() throws {
        let vault = try authority(), model = PhotosModel(), photo = try preparedPhoto()
        let created = try vault.createSourceGrant(VaultSourceConfiguration(provider: .folder,
            sourceID: "synthetic-paused-source", label: "Synthetic paused source", mode: .trusted,
            category: "creativity", tags: ["owner-choice"], backgroundEnabled: true))
        let paused = try vault.pauseSource(id: created.id, revision: created.revision)
        model.photos = [photo]; model.active = true; model.scanning = true
        XCTAssertTrue(model.attachVault(vault))
        XCTAssertTrue(model.backgroundEnabled); XCTAssertTrue(model.trustedFolder)
        XCTAssertFalse(model.active); XCTAssertFalse(model.scanning)
        XCTAssertEqual(model.photos, [photo])
        XCTAssertEqual(try vault.sourceGrants(), [paused])
        XCTAssertTrue(try vault.list(state: .saved).isEmpty); XCTAssertTrue(try vault.list(state: .pending).isEmpty)
        // No folder bookmark exists in this synthetic paused grant, so any accidental
        // auto-start would fail and rotate/pause its revision instead of passing above.
        model.stopForTermination()
        XCTAssertEqual(try vault.sourceGrants(), [paused])
    }

    @MainActor func testReminderWindowCloseIntentDoesNotGrantSourceBackgroundAccess() throws {
        var initial: ProofVault? = try authority()
        _ = try initial!.setReminderConsent(ReminderConsent(ownerID: initial!.ownerID, collectionID: collectionID,
            revision: 1, enabled: true, paused: false, timeZone: "UTC", scheduledMinute: 720,
            quietHours: nil, cooldownMinutes: 1200), expectedRevision: nil)
        initial = nil
        preferences.set(collectionID, forKey: "proof.native.collection.v1")
        let notifications = LifecycleNotifications(), model = PhotosModel()
        let controller = NativeVaultController(preferences: preferences, directory: root.appendingPathComponent("vault"),
            notificationClient: notifications, onReady: { model.attachVault($0) }, beforeClear: {})
        defer { model.stopForTermination(); controller.stopForTermination() }
        controller.restoreIfConfigured()
        XCTAssertTrue(controller.ready); XCTAssertTrue(controller.remindersOn)
        XCTAssertTrue(controller.keepsServicesRunningAfterWindowClose)
        XCTAssertFalse(model.backgroundEnabled); XCTAssertFalse(model.active); XCTAssertEqual(controller.port, 0)
        XCTAssertTrue(try XCTUnwrap(controller.vault).sourceGrants().isEmpty)
        XCTAssertEqual(notifications.reads + notifications.prompts + notifications.submissions, 0)
        controller.turnRemindersOff()
        XCTAssertFalse(controller.keepsServicesRunningAfterWindowClose)
        XCTAssertFalse(model.backgroundEnabled); XCTAssertFalse(model.active)
        XCTAssertEqual(notifications.prompts + notifications.submissions, 0)
    }

    @MainActor func testAssistantWindowCloseIntentDoesNotRequireASourceGrant() async throws {
        var initial: ProofVault? = try authority()
        let issued = try initial!.issueClient(kind: .assistant, scopes: [.savedText], expiresAt: Date().addingTimeInterval(300))
        initial = nil
        preferences.set(collectionID, forKey: "proof.native.collection.v1")
        let notifications = LifecycleNotifications(), model = PhotosModel()
        let controller = NativeVaultController(preferences: preferences, directory: root.appendingPathComponent("vault"),
            notificationClient: notifications, onReady: { model.attachVault($0) }, beforeClear: {})
        defer { model.stopForTermination(); controller.stopForTermination() }
        controller.restoreIfConfigured()
        // This starts only the synthetic grant's IPv4 loopback listener; no request or media is sent.
        let deadline = ContinuousClock.now.advanced(by: .seconds(3))
        while controller.port == 0 && ContinuousClock.now < deadline { try await Task.sleep(for: .milliseconds(10)) }
        XCTAssertGreaterThanOrEqual(controller.port, 1024)
        XCTAssertTrue(controller.keepsServicesRunningAfterWindowClose)
        XCTAssertFalse(controller.remindersOn); XCTAssertFalse(model.backgroundEnabled); XCTAssertFalse(model.active)
        XCTAssertTrue(try XCTUnwrap(controller.vault).sourceGrants().isEmpty)
        XCTAssertEqual(notifications.reads + notifications.prompts + notifications.submissions, 0)
        controller.revokeClient(issued.grant.id)
        XCTAssertFalse(controller.keepsServicesRunningAfterWindowClose)
        XCTAssertTrue(controller.clients.isEmpty)
    }
}
