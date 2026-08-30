# Proof Gallery — product and agent contract

Proof restores access to concrete evidence of love, care, belonging, being
valued or chosen, capability, creativity, parenting, recovery, and accomplishment.
It is not primarily a productivity archive, a gratitude assignment, or a score
of whether someone is good. Receipts and finished work are examples, not the mission.

The direction is low-effort, permissioned discovery. Do not turn the temporary
manual MVP boundary into the permanent product purpose. Equally, do not claim a
connector, background collector, native companion, or AI interpretation exists
until it actually works. The web intake is selected local media and explicit
companion review files. The Mac companion reads Recent Photos, Favorites, or a
chosen album/date range while open, with a separate owner-triggered Photos permission flow.
It exports private candidate files or explicitly transfers one prepared batch
over a five-minute same-Mac pairing. Neither route approves Proof or syncs accounts.

- Keep source selection, pending review, approved Proof, and retrieval distinct.
- Never feed companion output into Restore: that writes saved Proof. Use the
  dedicated companion importer, which only stages pending review.
- Native HEIC JPEG previews must retain their derivative label and original
  digest/source receipt through review, edits, and backups. Originals stay in
  Photos; import time must never replace missing Photos capture metadata.
- No PhotoKit mutation APIs, network-client entitlement, or cloud AI. The only
  server entitlement supports an explicitly started IPv4-loopback listener with
  exact Origin/Host checks, a random bearer token, bounded requests, and expiry.
  Never widen it to LAN interfaces, arbitrary origins, file access, or Photos commands.
  Request Photos authorization only after Connect; read media only after the
  user chooses a bounded source and starts it. Pause/Disconnect must cancel
  active reads and observers. Closing/quitting must guard unexported candidates.
- iCloud downloads require the separate off-by-default option and explicit Start.
  Permit only one bounded scan, never an observer-triggered download watch;
  reset the option on Pause/completion. Photos may cache more bytes than the
  retained-media limit. Never infer cloud AI/upload consent from download consent.
- Optional Vision OCR is on-device, off the UI thread, bounded, cancellable, and
  unverified. Keep it and metadata cues in native memory only; the v1 export
  must not gain machine-read quotes, inferred categories, identity, or meaning.
  No OCR result is not negative evidence. Public PhotoKit captions/People labels
  are unavailable here; never invent them or read the Photos database privately.
- Keep candidates private and out of search until explicit review. Never bypass
  approval, even if another agent or mode is autonomous.
- Preserve original media, literal words, sources, and known dates. Do not infer
  love, relationships, identity, goodness, or event dates from an image or filename.
- Keep photo review note-first. Optional word-based organization must remain
  visible and respect manual fields, removals, negation, and ambiguity; never
  silently treat it as an AI assessment or as approval. A short note is not a
  grant to scan other sources. Related lookup uses saved Proof in the current
  owner/collection only, explains shared words, and runs only on request.
- The story feature is a derived reading view of explicitly chosen saved
  notes/photos, not generated autobiography or a new evidence item. Optional
  on-device Apple generation selects source IDs only; deterministic code must
  display full original notes, never a substring that drops negation/context.
  Meaning matching uses only owner-filtered saved Proof text, on request, and
  preserves relevance order. Keep lexical fallback explicit; no cloud fallback.
  Cancel requests on disconnect, deletion, source edits, and navigation. Preserve exact
  words, dates, source labels, and attachment receipts; separate unknown dates.
  Never invent transitions, causal links, feelings, identities, or life lessons.
- Use unknown/blank fields rather than invented meaning. Import time and file
  modification time are not occurred dates. Decorative AI/stock art is not Proof.
- No library/account scanning without a bounded user-selected source. Never
  open unrelated personal content merely to find examples for development.
- Never use proof to invalidate pain, create guilt, demand optimism, argue that
  the user should feel better, rank worth, or imply suffering is not real.
- Retrieval is user-initiated; do not surface Proof in response to acute distress.
- Real evidence belongs only in the owner's selected storage. Never seed,
  snapshot, log, commit, publish, or send it to team memory, instructions, lessons,
  fixtures, analytics, or a public deployment bundle.
- Browser-local is unencrypted and profile-local, not account-isolated or synced.
  The default downloaded backup is encrypted (AES-256-GCM/PBKDF2); it does not
  encrypt active browser storage. Include pending media and saved draft notes.
  Restore validates first, then writes both stores atomically; conflicts abort,
  exact duplicates skip, pending stays pending. Never persist passphrases/tokens.
  A copy from ChorOS is a separate copy, not a migration or live integration.
- Use deterministic validation, storage, approval, filtering, and deletion. Use
  one model only if needed; no mandatory orchestration or automatic vision calls.

Use a clean branch, synthetic tests, and update the relevant docs. Run `bun run
check` and the existing frozen Deno checks. For media changes verify pending
isolation, atomic approval, MIME limits, SHA integrity, stale tabs, legacy backups,
and the absence of unrequested/external evidence network calls. Pairing tests use
synthetic data only. Public native release needs Developer ID, hardened runtime,
notarization, and stapling; ad-hoc builds are local development, not public readiness.
Production deployment needs explicit approval.
