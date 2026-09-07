import Foundation
import UserNotifications
import CompanionCore
import CompanionVault

@MainActor protocol NativeNotificationClient {
    func permission() async -> ReminderNotificationPermission
    func requestPermission() async throws -> ReminderNotificationPermission
    func submit(identifier: String, title: String, body: String) async throws
    func remove(identifier: String)
}

@MainActor struct SystemNativeNotificationClient: NativeNotificationClient {
    func permission() async -> ReminderNotificationPermission {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional: return settings.alertSetting == .enabled ? .granted : .denied
        case .denied: return .denied
        default: return .unknown
        }
    }
    func requestPermission() async throws -> ReminderNotificationPermission {
        _ = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert])
        return await permission()
    }
    func submit(identifier: String, title: String, body: String) async throws {
        let content = UNMutableNotificationContent()
        content.title = title; content.body = body
        // Immediate generic alert only. No media, sound, badge, userInfo or future backlog.
        try await UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: identifier, content: content, trigger: nil))
    }
    func remove(identifier: String) {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [identifier])
        center.removeDeliveredNotifications(withIdentifiers: [identifier])
    }
}

enum NativeReminderOutcome: Equatable {
    case skipped(ReminderSkipReason), submitted, failed, cancelled
}

/// No persistence here: closures must call the one vault's atomic claim methods.
/// Constructing does nothing. Lead UI owns consent updates and explicit polling.
@MainActor final class NativeReminderAdapter {
    private let client: any NativeNotificationClient
    private let claim: (ReminderNotificationPermission, Date) throws -> ReminderDecision
    private let isCurrent: (ReminderIntent) throws -> Bool
    private let now: () -> Date
    private let identifier: String
    private var generation = 0
    private var ticking = false
    private var timer: Task<Void, Never>?

    init(collectionID: String, client: any NativeNotificationClient,
         now: @escaping () -> Date = Date.init,
         claim: @escaping (ReminderNotificationPermission, Date) throws -> ReminderDecision,
         isCurrent: @escaping (ReminderIntent) throws -> Bool) {
        self.client = client; self.claim = claim; self.isCurrent = isCurrent; self.now = now
        // Keep private IDs and claim keys out of OS notification metadata.
        identifier = "proof-reminder-" + digest(Data(collectionID.utf8))
    }

    convenience init(vault: ProofVault, client: any NativeNotificationClient,
                     now: @escaping () -> Date = Date.init) {
        self.init(collectionID: vault.collectionID, client: client, now: now,
            claim: { permission, observedAt in
                guard let consent = try vault.reminderConsent() else { return .skip(.off) }
                return try vault.claimReminder(permission: permission, observedAt: observedAt, expectedRevision: consent.revision)
            }, isCurrent: { try vault.isReminderClaimCurrent($0) })
    }

    func requestPermissionFromOwnerAction() async -> ReminderNotificationPermission {
        let currentGeneration = generation
        do {
            let permission = try await client.requestPermission()
            return currentGeneration == generation && !Task.isCancelled ? permission : .unknown
        }
        catch { return .unknown }
    }

    func startPolling() {
        guard timer == nil else { return }
        timer = Task { [weak self] in
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(15)) } catch { return }
                guard let self else { return }
                _ = await self.tick()
            }
        }
    }

    /// Call immediately on Pause/Off/clear/disconnect, alongside durable consent
    /// mutation. Any in-flight submission is removed again when its callback returns.
    func stop() {
        generation += 1; timer?.cancel(); timer = nil
        client.remove(identifier: identifier)
    }

    func tick() async -> NativeReminderOutcome {
        guard !ticking else { return .cancelled }
        ticking = true; defer { ticking = false }
        let currentGeneration = generation
        let permission = await client.permission()
        guard currentGeneration == generation, !Task.isCancelled else { return .cancelled }
        guard permission == .granted else { return .skipped(.permission) }
        do {
            // Atomic claim checks LIVE consent/revision/saved records and consumes
            // the slot before OS submission. Never refund an uncertain delivery.
            let decision = try claim(permission, now())
            guard case .notify(let intent) = decision else {
                if case .skip(let reason) = decision { return .skipped(reason) }
                return .failed
            }
            guard currentGeneration == generation, try isCurrent(intent), !Task.isCancelled else { return .cancelled }
            // Do not accept arbitrary evidence text from an adapter or a model.
            guard intent.title == "Proof Gallery", intent.body == "Open Proof Gallery when you choose." else { return .failed }
            try await client.submit(identifier: identifier, title: intent.title, body: intent.body)
            guard currentGeneration == generation, !Task.isCancelled, try isCurrent(intent) else {
                client.remove(identifier: identifier); return .cancelled
            }
            return .submitted // OS accepted, not proof of visible delivery.
        } catch {
            client.remove(identifier: identifier)
            return .failed
        }
    }
}
