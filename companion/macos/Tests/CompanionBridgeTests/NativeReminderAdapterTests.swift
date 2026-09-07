import XCTest
import CompanionCore
import CompanionVault
@testable import ProofPhotosCompanion

@MainActor private final class FakeNotificationClient: NativeNotificationClient {
    var permissionValue = ReminderNotificationPermission.granted
    var permissionRequests = 0
    var permissionReads = 0
    var sent: [(String, String, String)] = []
    var removed: [String] = []
    var failSubmit = false
    var duringPermission: (() -> Void)?
    var duringSubmit: (() -> Void)?
    func permission() async -> ReminderNotificationPermission {
        permissionReads += 1; duringPermission?(); return permissionValue
    }
    func requestPermission() async throws -> ReminderNotificationPermission {
        permissionRequests += 1; return permissionValue
    }
    func submit(identifier: String, title: String, body: String) async throws {
        sent.append((identifier, title, body)); duringSubmit?()
        if failSubmit { throw NSError(domain: "synthetic", code: 1) }
    }
    func remove(identifier: String) { removed.append(identifier) }
}

final class NativeReminderAdapterTests: XCTestCase {
    private let now = ISO8601DateFormatter().date(from: "2026-09-07T12:00:00Z")!
    private func due() -> ReminderDecision {
        ReminderPolicy.evaluate(snapshot: ReminderSnapshot(
            consent: ReminderConsent(ownerID: "owner", collectionID: "collection", revision: 1,
                enabled: true, paused: false, timeZone: "UTC", scheduledMinute: 720,
                quietHours: nil, cooldownMinutes: 60),
            notificationPermission: .granted, observedAt: now,
            ledger: ReminderLedger(claimedKeys: [], lastClaimedAt: nil),
            records: [ReminderRecord(id: "saved", ownerID: "owner", collectionID: "collection", state: .saved)]), now: now)
    }

    @MainActor func testConstructionAndDeniedTickNeverRequestPermissionOrClaim() async {
        let client = FakeNotificationClient(); client.permissionValue = .denied
        var claims = 0
        let adapter = NativeReminderAdapter(collectionID: "private-collection", client: client,
            claim: { _, _ in claims += 1; return self.due() }, isCurrent: { _ in true })
        XCTAssertEqual(client.permissionReads, 0)
        let outcome = await adapter.tick()
        XCTAssertEqual(outcome, .skipped(.permission))
        XCTAssertEqual(claims, 0); XCTAssertEqual(client.permissionRequests, 0)
        XCTAssertTrue(client.sent.isEmpty)
    }

    @MainActor func testSuccessfulSubmissionContainsOnlyGenericTextAndOpaqueIdentifier() async {
        let client = FakeNotificationClient()
        let adapter = NativeReminderAdapter(collectionID: "private-collection", client: client,
            claim: { _, _ in self.due() }, isCurrent: { _ in true })
        let outcome = await adapter.tick()
        XCTAssertEqual(outcome, .submitted)
        XCTAssertEqual(client.sent.first?.1, "Proof Gallery")
        XCTAssertEqual(client.sent.first?.2, "Open Proof Gallery when you choose.")
        XCTAssertFalse(client.sent.first?.0.contains("private-collection") ?? true)
        XCTAssertEqual(client.permissionRequests, 0)
    }

    @MainActor func testStopWhilePermissionPendingPreventsClaim() async {
        let client = FakeNotificationClient()
        var claims = 0
        let adapter = NativeReminderAdapter(collectionID: "c", client: client,
            claim: { _, _ in claims += 1; return self.due() }, isCurrent: { _ in true })
        client.duringPermission = { adapter.stop() }
        let outcome = await adapter.tick()
        XCTAssertEqual(outcome, .cancelled); XCTAssertEqual(claims, 0)
        XCTAssertTrue(client.sent.isEmpty)
    }

    @MainActor func testStopDuringSubmissionRemovesAgainAfterCallback() async {
        let client = FakeNotificationClient()
        let adapter = NativeReminderAdapter(collectionID: "c", client: client,
            claim: { _, _ in self.due() }, isCurrent: { _ in true })
        client.duringSubmit = { adapter.stop() }
        let outcome = await adapter.tick()
        XCTAssertEqual(outcome, .cancelled)
        XCTAssertEqual(client.removed.count, 2)
    }

    @MainActor func testRevokedClaimCannotSubmitAndUnknownOutcomeDoesNotRetry() async {
        let client = FakeNotificationClient()
        let stale = NativeReminderAdapter(collectionID: "c", client: client,
            claim: { _, _ in self.due() }, isCurrent: { _ in false })
        let cancelled = await stale.tick()
        XCTAssertEqual(cancelled, .cancelled); XCTAssertTrue(client.sent.isEmpty)
        var consumed = false
        client.failSubmit = true
        let adapter = NativeReminderAdapter(collectionID: "c", client: client,
            claim: { _, _ in
                if consumed { return .skip(.claimed) }
                consumed = true; return self.due()
            }, isCurrent: { _ in true })
        let failed = await adapter.tick()
        let repeated = await adapter.tick()
        XCTAssertEqual(failed, .failed)
        XCTAssertEqual(repeated, .skipped(.claimed))
        XCTAssertEqual(client.sent.count, 1)
    }

    @MainActor func testRealSyntheticVaultClaimsBeforeFakeOSFailureAndKeepsClaim() async throws {
        let root = URL(fileURLWithPath: "/private/tmp").appendingPathComponent("proof-reminder-synthetic-\(UUID())")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(at: root) }
        let vault = try ProofVault(directory: root.appendingPathComponent("vault"),
            collectionID: "11111111-1111-4111-8111-111111111111", now: { self.now })
        _ = try vault.saveManual(VaultInput(fields: VaultFields(evidenceText: "Synthetic exact note.", category: "creativity", sourceType: "other")))
        _ = try vault.setReminderConsent(ReminderConsent(ownerID: vault.ownerID, collectionID: vault.collectionID,
            revision: 1, enabled: true, paused: false, timeZone: "UTC", scheduledMinute: 720,
            quietHours: nil, cooldownMinutes: 60), expectedRevision: nil)
        let client = FakeNotificationClient(); client.failSubmit = true
        var claimExistedBeforeSubmission = false
        client.duringSubmit = { claimExistedBeforeSubmission = (try? vault.reminderLedger().claimedKeys.count) == 1 }
        let adapter = NativeReminderAdapter(vault: vault, client: client, now: { self.now })
        let first = await adapter.tick()
        let second = await adapter.tick()
        XCTAssertTrue(claimExistedBeforeSubmission)
        XCTAssertEqual(first, .failed); XCTAssertEqual(second, .skipped(.claimed))
        XCTAssertEqual(client.sent.count, 1)
    }
}
