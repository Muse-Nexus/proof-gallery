# Reminder policy and delivery contract

`companion/macos/Sources/CompanionCore/ReminderPolicy.swift` implements a pure scheduling decision. It does not
schedule a timer, persist permission, register a login item, retrieve evidence,
or submit an OS notification. It needs no model and makes no network calls.
The chosen durable companion authority owns those runtime responsibilities.
Policy tests alone do not establish closed-app delivery on any platform.

## Independent permission

Reminders are off unless the owner separately enables them for one owner and
collection. Source reading, exact-source auto-saving, installation, assistant
access, and OS notification permission do not imply reminder consent. Both the
current reminder grant and OS permission must allow delivery. Pause/off and
revocation suppress new work and require cancellation of queued OS requests.
Changing the schedule, zone or grant must advance the consent revision.

The snapshot includes explicit local scheduled minute (0–1439), a named timezone
validated by Foundation against named timezone identifiers, quiet hours, positive cooldown in minutes, current permission,
record eligibility metadata, and a required durable claim ledger. Unknown or
malformed inputs fail closed. Time is injected as epoch milliseconds. Snapshots
must be at most 30 seconds old, not from the future, and from the same absolute
minute as evaluation. This is a bound on adapter work, not permission to reuse
stale consent for 30 seconds: the runtime must recheck at atomic claim and delivery.

## Calendar semantics

Only the current scheduled local minute may produce an intent. There is no
historical schedule enumeration, catch-up, delayed quiet-hours delivery, or retry
burst after sleep, restart, offline time or pause. A spring DST gap skips that
day's nonexistent minute. A repeated autumn minute shares one local-date key.
Quiet hours include their start and exclude their end; a midnight-spanning range
wraps naturally. Equal endpoints mean quiet all day. Use `nil` to disable quiet
hours. Cooldown uses elapsed absolute time, survives setting revisions, and
suppresses delivery after clock rollback until the interval is satisfied.

## Durable adapter requirements

1. Read current consent, OS permission, current saved-record eligibility and the
   ledger from the same owner/collection authority. Pending, deleted and foreign
   records cannot qualify. No eligible saved record means no reminder.
2. Evaluate with fresh time. The internal claim key is a JSON tuple of policy
   version, owner ID, collection ID, consent revision and local calendar date.
   It contains private routing metadata: never use it as visible notification text.
3. Atomically verify the same active consent/revision and eligibility, then claim
   that key and update the last-claim timestamp before OS submission. Concurrency
   must produce at most one claim. The pure evaluator cannot guarantee this.
4. Recheck immediately before submission; cancel if authorization changed or the
   snapshot/time is no longer due. Only submit the returned generic `title` and `body`
   fields. Use a separate opaque platform identifier if one is needed.
5. Persist outcomes separately. A crash, timeout or uncertain OS receipt does not
   release the claim for automatic retry. A missed reminder is preferable to a
   duplicate. A successful submission is not proof the person saw it.
6. Keep claims durable over restart, pause/resume and settings revisions. Do not
   erase dedup state when toggling notifications. Preserve the last-claim timestamp
   across revisions; retain local-date claims for any date that may be revisited
   after a clock/timezone change. Missing/corrupt ledger is an error, not an empty
   ledger. Initial empty state is created only by the durable authority for a new
   collection. Restore must not implicitly re-enable any grant.

## Evidence presentation

The intent has no item IDs, quotes, dates, sources, categories, attachments, names,
or counts. Its default lock-screen text is “Proof Gallery” and “Open Proof Gallery
when you choose.” Even generic notifications reveal the app name. The opt-in UI
must preview that text. This policy does not implement detailed notifications;
those would require separately specific owner consent and a reviewed extension.

Opening a generic reminder goes to a neutral app destination. Explicit retrieval
then uses current owner-scoped saved records and the existing source-faithful
reading path. Revalidate after edits, deletion, disconnect and revocation. Keep
full original words, including negation, source labels, known dates and attachment
provenance. Missing dates remain missing. Never infer diagnosis, worth, feelings,
identity or meaning, and never trigger retrieval from distress or sentiment.

See [the acceptance matrix](HANDS_OFF_ACCEPTANCE.md) for adapter, installation,
platform and release checks. No reminder or real-source activation is authorized
merely by this implementation or its tests.

## Swift integration API

Call `ReminderPolicy.evaluate(snapshot:now:)` with `ReminderSnapshot?` and an
injected `Date`. The result is `.skip(ReminderSkipReason)` or
`.notify(ReminderIntent)`. `ReminderConsent`, `ReminderLedger`, and metadata-only
`ReminderRecord` are value types. No literal evidence is accepted by the scheduler.
A missing ledger is `nil`; decoding failures must fail closed, not create default
consent. `ReminderIntent.claimKey` is internal; only `title` and `body` are display
content. `consentRevision` and `localDate` support adapter revalidation.

Run focused fixtures from `companion/macos` with
`swift test --filter ReminderPolicyTests`. The fixtures cover consent, malformed
state, freshness, eligibility, persistent dedup, cooldown, quiet hours and DST.
Source-faithful reading remains the existing separate story/search path, covered
by its own tests and the acceptance matrix; the scheduler never interprets quotes.
