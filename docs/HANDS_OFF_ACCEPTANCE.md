# Hands-off collection and reminder acceptance

This is a release acceptance contract, not a claim that every runtime or platform
has passed. Use synthetic fixtures and record the tested commit, platform/version,
command or device steps, result, and remaining limits. Installation, source reads,
auto-save, assistant retrieval, and reminders each need their own authorization.

## Privacy and presentation matrix

| Case | Required result | Evidence needed |
| --- | --- | --- |
| Fresh install / upgrade / restore | Sources and reminders do not become enabled by installation or restored data. | Fresh-profile and restart fixtures; per-device install check. |
| Source read consent only | New candidates stay pending and out of saved search. | Pending-isolation fixture. |
| Exact-source auto-save approval | Only that active source may save new eligible items; old pending items stay pending. No notification or assistant permission follows. | Atomic consent/revision and ledger tests. |
| No saved data / only pending | No scheduled evidence notification; explicit lookup reports no matching saved evidence without emotional conclusions. | Empty/pending fixtures. |
| Saved negated or ambiguous text | Full literal text remains intact; no positive clause extraction or inferred feelings, identity, worth, diagnosis, or relationship. | Full quote, source, date and provenance assertions. |
| Unknown event date | Unknown remains unknown; import/modified time is not substituted. | Undated fixture and reading-view check. |
| Cross-owner or collection | Exclude other owners/collections before matching, selection, or presentation. | Two-owner/two-collection fixtures. |
| Deleted / revoked / edited during work | Revalidate current authorization and current saved record at delivery/open; stale content is not presented. | Race/cancellation fixtures. |
| Owner opens a generic reminder | Open a neutral app destination; opening is not automatic consent to select or expose an evidence item. Retrieval requires a clear owner action. | Navigation/device check. |
| Reminder details not separately consented | Lock-screen content contains only generic app text, with no evidence quote, person, category, date, source, attachment, count, or selected item ID. | Serialized payload assertion and lock-screen device check. |
| Distress / mood input | Never trigger retrieval or reminders from distress, diagnosis, sentiment, or inferred need. | No such trigger/input in scheduling contract; source review. |

## Scheduling and lifecycle matrix

| Case | Required result | Evidence needed |
| --- | --- | --- |
| Reminder opt-in absent / revoked / paused | No delivery, including queued work; OS permission alone is insufficient. | Consent/version and dispatch recheck fixtures. |
| Timezone invalid / malformed settings or ledger | Fail closed; never silently switch timezone or reset deduplication. | Invalid-input fixtures. |
| Daily time outside quiet hours | At most one generic intent for the current local date, subject to cooldown and current saved eligibility. | Deterministic policy tests. |
| Quiet hours span midnight | Suppress inside interval; start inclusive, end exclusive. No deferred catch-up. | Boundary tests. |
| DST spring gap | Nonexistent scheduled local minute is skipped, without replay. | IANA-zone spring transition fixture. |
| DST repeated hour | The repeated local minute cannot deliver twice for one local date. | Fall transition and persistent claim fixtures. |
| Sleep / offline / restart after scheduled minute | Skip missed schedules; no queued historical reminders. | Restart-time fixtures and device wake check. |
| Crash after reservation / before dispatch | Prefer a missed reminder to a duplicate; persist claim before OS submission. | Atomic reservation/crash tests in runtime. |
| Pause / disconnect / revocation during dispatch | Cancel queued notification where platform allows and recheck before submission. Keep dedup state; resume does not replay missed reminders. | Runtime race and OS cancellation receipts. |
| Clock rollback / timezone change | Preserve ledger, enforce cooldown, and invalidate stale scheduled work through consent revision. | Clock/settings-change fixtures. |

## Cross-platform installation and release receipts

| Surface | What may be claimed after checks | Separate check still required |
| --- | --- | --- |
| Browser tab / installed web app | Public shell offline access and profile-local saved data when verified. | Install menu behavior, browser eviction, update lifecycle, notification permission and delivery on each actual browser/device. A policy unit test proves none of these. |
| Mac native companion/runtime | Only capabilities exercised by the built runtime under explicit fixture-source consent. | Signed identity, hardened runtime, notarization and stapling for public distribution; actual OS background/wake/restart and generic notification checks. |
| Windows / Linux | Browser access where tested. | Native collector/assistant/reminder implementation, packaging and device receipts before advertising closed-app operation. |
| iPhone / iPad / Android | Browser or home-screen access where tested. | Platform-specific background and notification capability; a desktop service does not establish mobile support. |
| Local assistant | Explicitly granted owner-scoped local operations verified with synthetic data. | Authentication, revocation, owner isolation, transport boundaries and model/cloud disclosure. A connected assistant is not consent to retrieve automatically. |

Do not activate a real source, notification permission, login item, OS install,
credential, release upload, signing, notarization, or production change merely to
complete these checks. The owner must approve those actions when they are ready.
No personal evidence belongs in screenshots, fixtures, logs or release bundles.
