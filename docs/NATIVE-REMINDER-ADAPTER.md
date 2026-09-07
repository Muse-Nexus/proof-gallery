# Native reminder integration

`NativeReminderAdapter` does not persist a second schedule or ledger. Construct it
with the same `ProofVault` used by collection/gallery and an injected
`SystemNativeNotificationClient`. Construction has no OS side effects.

Native UI integration calls:

1. On explicit reminder permission intent only, await
   `requestPermissionFromOwnerAction()`. It requests alert permission only; it
   does not enable reminders or alter source/background/login grants.
2. Persist owner-selected `ReminderConsent` through
   `vault.setReminderConsent(_:expectedRevision:)`. Never infer consent from
   notification permission. Use current revision for changes.
3. After opening the configured vault, `startPolling()` may check every 15
   seconds while this native process runs. Each tick reads permission without
   prompting. The vault evaluates live consent, saved items and durable ledger
   and claims the current eligible slot atomically before OS submission.
4. On Pause/Off/clear/disconnect call `stop()` immediately to fence in-flight
   work, then persist the corresponding vault change. A failed persistence call
   must remain visible; do not claim durable Off. After changing an enabled
   schedule, restart polling only under the current saved consent.

The adapter rechecks the claim immediately before submission and after the OS
callback, removes its notification when invalidated, and never refunds a claim
after uncertain submission. The vault rejects old-minute/expired claims. There
are no future notification triggers, backlog queues, sounds, badges, attachments
or evidence text. The generic alert says “Proof Gallery” / “Open Proof Gallery
when you choose.” The OS identifier is a collection digest, not a raw private
ID, claim key or evidence source.

`submitted` means the notification API accepted the request; it does not prove
visible delivery. Focus settings, permission changes and OS presentation policy
remain device acceptance gates. Cancellation removes pending and still-visible
notifications; it cannot retract text a person already saw. A stopped native
process cannot poll; login startup is a separate explicit setting. Clicking an
alert still needs lead-owned navigation wiring and native-device verification.

Synthetic injected-client tests cover no startup prompt, denied permission,
generic-only submission, Stop during permission/submission, stale/revoked claims,
and consumed claims after uncertain failure. A temporary synthetic SQLite vault
test verifies the claim exists before the fake OS call and prevents retry after
that call fails. Tests do not request actual permission or show notifications.

Apple references: [authorization](https://developer.apple.com/documentation/usernotifications/unusernotificationcenter/requestauthorization(options:completionhandler:)),
[notification center submission and removal](https://developer.apple.com/documentation/usernotifications/unusernotificationcenter).
