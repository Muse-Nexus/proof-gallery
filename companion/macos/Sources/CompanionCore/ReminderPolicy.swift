import Foundation

public struct ReminderQuietHours: Codable, Equatable, Sendable {
    public var startMinute: Int
    public var endMinute: Int
    public init(startMinute: Int, endMinute: Int) {
        self.startMinute = startMinute; self.endMinute = endMinute
    }
}

public struct ReminderConsent: Codable, Equatable, Sendable {
    public var ownerID: String
    public var collectionID: String
    public var revision: Int
    public var enabled: Bool
    public var paused: Bool
    public var timeZone: String
    public var scheduledMinute: Int
    public var quietHours: ReminderQuietHours?
    public var cooldownMinutes: Int
    public init(ownerID: String, collectionID: String, revision: Int, enabled: Bool,
                paused: Bool, timeZone: String, scheduledMinute: Int,
                quietHours: ReminderQuietHours?, cooldownMinutes: Int) {
        self.ownerID = ownerID; self.collectionID = collectionID; self.revision = revision
        self.enabled = enabled; self.paused = paused; self.timeZone = timeZone
        self.scheduledMinute = scheduledMinute; self.quietHours = quietHours
        self.cooldownMinutes = cooldownMinutes
    }
}

public enum ReminderRecordState: String, Codable, Sendable { case saved, pending, deleted }
public struct ReminderRecord: Codable, Equatable, Sendable {
    public var id: String
    public var ownerID: String
    public var collectionID: String
    public var state: ReminderRecordState
    public var isOwnerPrivate: Bool
    public init(id: String, ownerID: String, collectionID: String, state: ReminderRecordState, isOwnerPrivate: Bool = true) {
        self.id = id; self.ownerID = ownerID; self.collectionID = collectionID
        self.state = state; self.isOwnerPrivate = isOwnerPrivate
    }
}

public struct ReminderLedger: Codable, Equatable, Sendable {
    public var claimedKeys: Set<String>
    public var lastClaimedAt: Date?
    public init(claimedKeys: Set<String>, lastClaimedAt: Date?) {
        self.claimedKeys = claimedKeys; self.lastClaimedAt = lastClaimedAt
    }
}
public enum ReminderNotificationPermission: String, Codable, Sendable { case granted, denied, unknown }
public struct ReminderSnapshot: Sendable {
    public var consent: ReminderConsent
    public var notificationPermission: ReminderNotificationPermission
    public var observedAt: Date
    /// Missing/corrupt durable state must be nil, never an invented empty ledger.
    public var ledger: ReminderLedger?
    public var records: [ReminderRecord]
    public init(consent: ReminderConsent, notificationPermission: ReminderNotificationPermission,
                observedAt: Date, ledger: ReminderLedger?, records: [ReminderRecord]) {
        self.consent = consent; self.notificationPermission = notificationPermission
        self.observedAt = observedAt; self.ledger = ledger; self.records = records
    }
}
public enum ReminderSkipReason: String, Equatable, Sendable {
    case invalidState, off, permission, stale, notDue, quietHours, empty, claimed, cooldown
}
public struct ReminderIntent: Equatable, Sendable {
    /// Internal private routing metadata: never pass the key as notification text.
    public let claimKey: String
    public let consentRevision: Int
    public let localDate: String
    public let title: String
    public let body: String
}
public enum ReminderDecision: Equatable, Sendable {
    case skip(ReminderSkipReason)
    case notify(ReminderIntent)
}

/// Pure policy. The durable authority owns atomic claims, consent and OS delivery.
public enum ReminderPolicy {
    public static let snapshotMaximumAge: TimeInterval = 30

    public static func evaluate(snapshot: ReminderSnapshot?, now: Date) -> ReminderDecision {
        guard let snapshot, let ledger = snapshot.ledger else { return .skip(.invalidState) }
        let c = snapshot.consent
        guard validDate(now), validDate(snapshot.observedAt), nonempty(c.ownerID), nonempty(c.collectionID),
              c.revision > 0, minute(c.scheduledMinute), (1...525_600).contains(c.cooldownMinutes),
              c.quietHours.map({ minute($0.startMinute) && minute($0.endMinute) }) ?? true,
              ledger.claimedKeys.allSatisfy(nonempty),
              ledger.lastClaimedAt.map(validDate) ?? ledger.claimedKeys.isEmpty,
              snapshot.records.allSatisfy({ nonempty($0.id) && nonempty($0.ownerID) && nonempty($0.collectionID) }),
              (TimeZone.knownTimeZoneIdentifiers.contains(c.timeZone) || c.timeZone == "UTC"),
              let zone = TimeZone(identifier: c.timeZone) else { return .skip(.invalidState) }
        if !c.enabled || c.paused { return .skip(.off) }
        if snapshot.notificationPermission != .granted { return .skip(.permission) }
        let age = now.timeIntervalSince(snapshot.observedAt)
        guard age >= 0, age <= snapshotMaximumAge,
              floor(now.timeIntervalSince1970 / 60) == floor(snapshot.observedAt.timeIntervalSince1970 / 60)
        else { return .skip(.stale) }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        let parts = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: now)
        guard let year = parts.year, let month = parts.month, let day = parts.day,
              let hour = parts.hour, let minutePart = parts.minute else { return .skip(.invalidState) }
        let currentMinute = hour * 60 + minutePart
        if currentMinute != c.scheduledMinute { return .skip(.notDue) }
        if let quiet = c.quietHours {
            let start = quiet.startMinute, end = quiet.endMinute
            // Equal endpoints mean quiet all day. Nil disables quiet hours.
            if start == end || (start < end ? currentMinute >= start && currentMinute < end : currentMinute >= start || currentMinute < end) {
                return .skip(.quietHours)
            }
        }
        guard snapshot.records.contains(where: { $0.state == .saved && $0.isOwnerPrivate && $0.ownerID == c.ownerID && $0.collectionID == c.collectionID })
        else { return .skip(.empty) }
        let localDate = String(format: "%04d-%02d-%02d", year, month, day)
        guard let keyData = try? JSONSerialization.data(withJSONObject: ["proof-reminder-v1", c.ownerID, c.collectionID, c.revision, localDate]),
              let key = String(data: keyData, encoding: .utf8) else { return .skip(.invalidState) }
        if ledger.claimedKeys.contains(key) { return .skip(.claimed) }
        if let lastClaim = ledger.lastClaimedAt, now.timeIntervalSince(lastClaim) < Double(c.cooldownMinutes) * 60 {
            return .skip(.cooldown)
        }
        return .notify(ReminderIntent(claimKey: key, consentRevision: c.revision, localDate: localDate,
                                      title: "Proof Gallery", body: "Open Proof Gallery when you choose."))
    }

    private static func minute(_ value: Int) -> Bool { (0..<1440).contains(value) }
    private static func nonempty(_ value: String) -> Bool { !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    private static func validDate(_ date: Date) -> Bool {
        date.timeIntervalSince1970.isFinite && (Date.distantPast...Date.distantFuture).contains(date)
    }
}
