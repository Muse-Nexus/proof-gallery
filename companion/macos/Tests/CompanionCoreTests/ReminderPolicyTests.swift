import XCTest
@testable import CompanionCore

final class ReminderPolicyTests: XCTestCase {
    private func date(_ value: String = "2026-09-07T15:00:10Z") -> Date { ISO8601DateFormatter().date(from: value)! }
    private func fixture(_ now: Date? = nil) -> ReminderSnapshot {
        ReminderSnapshot(consent: ReminderConsent(ownerID: "owner-a", collectionID: "collection-a", revision: 1,
            enabled: true, paused: false, timeZone: "America/Chicago", scheduledMinute: 600, quietHours: nil, cooldownMinutes: 1200),
            notificationPermission: .granted, observedAt: now ?? date(), ledger: ReminderLedger(claimedKeys: [], lastClaimedAt: nil),
            records: [ReminderRecord(id: "saved-a", ownerID: "owner-a", collectionID: "collection-a", state: .saved)])
    }
    private func intent(_ snapshot: ReminderSnapshot, _ now: Date) throws -> ReminderIntent {
        guard case .notify(let value) = ReminderPolicy.evaluate(snapshot: snapshot, now: now) else {
            throw NSError(domain: "Expected notify", code: 1)
        }
        return value
    }

    func testGenericContentAndScopedKey() throws {
        let result = try intent(fixture(), date())
        XCTAssertEqual(result.title, "Proof Gallery")
        XCTAssertEqual(result.body, "Open Proof Gallery when you choose.")
        XCTAssertEqual(result.localDate, "2026-09-07")
        XCTAssertEqual(result.consentRevision, 1)
        XCTAssertEqual(try JSONSerialization.jsonObject(with: Data(result.claimKey.utf8)) as? NSArray,
                       ["proof-reminder-v1", "owner-a", "collection-a", 1, "2026-09-07"] as NSArray)
        XCTAssertFalse(result.claimKey.contains("saved-a"))
        var other = fixture(); other.consent.ownerID = "owner-b"; other.records[0].ownerID = "owner-b"
        XCTAssertNotEqual(try intent(other, date()).claimKey, result.claimKey)
    }
    func testIndependentConsentAndPermission() {
        var input = fixture(); input.consent.enabled = false
        XCTAssertEqual(ReminderPolicy.evaluate(snapshot: input, now: date()), .skip(.off))
        input.consent.enabled = true; input.consent.paused = true
        XCTAssertEqual(ReminderPolicy.evaluate(snapshot: input, now: date()), .skip(.off))
        input.consent.paused = false
        for permission in [ReminderNotificationPermission.denied, .unknown] {
            input.notificationPermission = permission
            XCTAssertEqual(ReminderPolicy.evaluate(snapshot: input, now: date()), .skip(.permission))
        }
        XCTAssertEqual(ReminderPolicy.evaluate(snapshot: nil, now: date()), .skip(.invalidState))
    }
    func testMalformedConsentAndLedgerFailClosed() {
        let mutations: [(inout ReminderSnapshot) -> Void] = [
            { $0.ledger = nil }, { $0.ledger = ReminderLedger(claimedKeys: ["old"], lastClaimedAt: nil) },
            { $0.consent.revision = 0 }, { $0.consent.ownerID = " " }, { $0.consent.collectionID = "" },
            { $0.consent.timeZone = "Mars/Olympus" }, { $0.consent.timeZone = "+01:00" },
            { $0.consent.scheduledMinute = 1440 }, { $0.consent.scheduledMinute = -1 },
            { $0.consent.cooldownMinutes = 0 }, { $0.consent.cooldownMinutes = Int.max },
            { $0.consent.quietHours = ReminderQuietHours(startMinute: -1, endMinute: 600) },
            { $0.observedAt = Date(timeIntervalSince1970: .nan) },
            { $0.records[0].id = "" },
        ]
        for mutate in mutations {
            var input = fixture(); mutate(&input)
            XCTAssertEqual(ReminderPolicy.evaluate(snapshot: input, now: date()), .skip(.invalidState))
        }
        XCTAssertEqual(ReminderPolicy.evaluate(snapshot: fixture(), now: Date(timeIntervalSince1970: .infinity)), .skip(.invalidState))
    }
    func testSnapshotFreshnessAndPreviousMinute() {
        for offset: TimeInterval in [-31, 1, -11] {
            var input = fixture(); input.observedAt = date().addingTimeInterval(offset)
            XCTAssertEqual(ReminderPolicy.evaluate(snapshot: input, now: date()), .skip(.stale))
        }
    }
    func testNoBacklogAfterSleepRestartOrPause() {
        let later = date().addingTimeInterval(60)
        XCTAssertEqual(ReminderPolicy.evaluate(snapshot: fixture(later), now: later), .skip(.notDue))
        let tomorrow = date().addingTimeInterval(86400)
        guard case .notify = ReminderPolicy.evaluate(snapshot: fixture(tomorrow), now: tomorrow) else { return XCTFail("Next current day should qualify") }
    }
    func testOnlyCurrentPrivateSavedOwnerCollectionQualifies() {
        let mutations: [(inout ReminderSnapshot) -> Void] = [
            { $0.records = [] }, { $0.records[0].state = .pending }, { $0.records[0].state = .deleted },
            { $0.records[0].ownerID = "other" }, { $0.records[0].collectionID = "other" },
            { $0.records[0].isOwnerPrivate = false },
        ]
        for mutate in mutations {
            var input = fixture(); mutate(&input)
            XCTAssertEqual(ReminderPolicy.evaluate(snapshot: input, now: date()), .skip(.empty))
        }
    }
    func testPersistedClaimSuppressesRestartAndUncertainDelivery() throws {
        var input = fixture(); let first = try intent(input, date())
        let ledger = ReminderLedger(claimedKeys: [first.claimKey], lastClaimedAt: date())
        input.ledger = try JSONDecoder().decode(ReminderLedger.self, from: JSONEncoder().encode(ledger))
        XCTAssertEqual(ReminderPolicy.evaluate(snapshot: input, now: date()), .skip(.claimed))
    }
    func testCooldownSurvivesRevisionAndClockRollback() throws {
        var input = fixture(); input.consent.revision = 2
        for offset: TimeInterval in [-1, 60] {
            input.ledger = ReminderLedger(claimedKeys: ["prior"], lastClaimedAt: date().addingTimeInterval(offset))
            XCTAssertEqual(ReminderPolicy.evaluate(snapshot: input, now: date()), .skip(.cooldown))
        }
        input.ledger?.lastClaimedAt = date().addingTimeInterval(-1200 * 60)
        XCTAssertEqual(try intent(input, date()).consentRevision, 2)
    }
    func testQuietHourBoundariesMidnightAndEqualEndpoints() {
        let cases: [(Int, Int, Int, Bool)] = [(1320, 420, 1320, true), (1320, 420, 0, true),
            (1320, 420, 419, true), (1320, 420, 420, false), (600, 660, 600, true),
            (600, 660, 660, false), (0, 0, 600, true)]
        for (start, end, minute, quiet) in cases {
            let now = date("2026-09-07T00:00:10Z").addingTimeInterval(Double(minute) * 60)
            var input = fixture(now); input.consent.timeZone = "UTC"; input.consent.scheduledMinute = minute
            input.consent.quietHours = ReminderQuietHours(startMinute: start, endMinute: end)
            let result = ReminderPolicy.evaluate(snapshot: input, now: now)
            if quiet { XCTAssertEqual(result, .skip(.quietHours)) }
            else if case .notify = result {} else { XCTFail("End boundary should permit delivery") }
        }
    }
    func testSpringGapHasNoShiftOrReplay() {
        for value in ["2026-03-08T07:59:10Z", "2026-03-08T08:00:10Z", "2026-03-08T08:30:10Z"] {
            let now = date(value); var input = fixture(now); input.consent.scheduledMinute = 150
            XCTAssertEqual(ReminderPolicy.evaluate(snapshot: input, now: now), .skip(.notDue))
        }
    }
    func testFallRepeatedMinuteSharesDateClaim() throws {
        let firstTime = date("2026-11-01T06:30:10Z"), secondTime = date("2026-11-01T07:30:10Z")
        var input = fixture(firstTime); input.consent.scheduledMinute = 90; input.consent.cooldownMinutes = 1
        let first = try intent(input, firstTime)
        input.observedAt = secondTime
        XCTAssertEqual(try intent(input, secondTime).claimKey, first.claimKey)
        input.ledger = ReminderLedger(claimedKeys: [first.claimKey], lastClaimedAt: firstTime)
        XCTAssertEqual(ReminderPolicy.evaluate(snapshot: input, now: secondTime), .skip(.claimed))
    }
    func testLocalDateCanDifferFromUTCDate() throws {
        let now = date("2026-09-08T01:00:10Z"); var input = fixture(now); input.consent.scheduledMinute = 1200
        XCTAssertEqual(try intent(input, now).localDate, "2026-09-07")
    }
}
