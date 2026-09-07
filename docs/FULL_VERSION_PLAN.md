# Full Proof Gallery: implementation and acceptance

Status: native-first implementation assembled and undergoing final acceptance.
Public release and real-device gates remain open; this is not a claim that the
entire Windows/Android product is complete.

Mark requested the complete low-effort product, with separate worker tasks and
one lead responsible for integration. Baseline: deployed standalone main
`2bdd75d0da1ebaf779a43b9e3553b82b1c053722` (PR20). That release is a working
browser-local gallery, not a closed-app collector or a local assistant bridge.

## Product contract

Proof restores access to actual evidence of care, being valued/chosen,
belonging, capability, creativity, parenting, recovery and accomplishment.
It is not a worth score, gratitude obligation or generalized life logger.

Never use proof to invalidate pain, create guilt, demand optimism, or argue
that the user should feel better. Use it only to restore evidence that
depression has hidden. Preserve literal words, media, dates and provenance.
Do not infer identity, love, relationships or emotional meaning from an image.
Unknown fields remain unknown. No acute-distress-triggered surfacing.

## Completion gates

1. **One explicit local authority.** A durable owner-private companion store can
   serve the same saved items to the gallery, collector and selected assistants.
   Browser-local and hosted collections remain distinct until the owner chooses
   a bounded copy/connection. No silent migration, co-search, upload or deletion.
   Exact evidence survives edits, restart, backup and restore; capacity and
   encryption-at-rest behavior are visible rather than implied.
2. **Background collection.** A user-selected Photos/folder source continues
   while the gallery is closed, only under explicit saved source and background
   consent. Default intake is pending review; an exact source may use confirmed
   automatic saving with owner-selected organization. Pause/revoke survive
   restart; deleted evidence cannot silently reappear. Collection is bounded,
   deduplicated and recoverable. Sleep/offline failures do not broaden scope.
3. **Assistant access.** Read-only Proof-specific MCP tools target 3–10 relevant
   saved items with exact notes/dates/sources, never pending or ordinary memory.
   Return fewer when fewer items match; never pad results or invent evidence.
   Each client connection is explicit and revocable; there is no ambient grant
   merely because an assistant or companion is installed. Media disclosure is
   separately bounded. Retrieval has a clear local/semantic/fallback label.
4. **Reminders.** Separate opt-in, quiet hours, timezone/DST behavior, cooldown,
   deduplication and immediate Pause/Off. Generic lock-screen copy by default;
   evidence details require opening/requesting or separately specific consent.
   No backlog burst, streak pressure, inferred feelings or fabricated compliment.
   Presentation quotes actual evidence with dates and sources and stays optional.
5. **Install and operate.** A nontechnical first run explains storage, sources,
   background behavior, client access and backups. Uninstall/revoke/export paths
   are documented. Mac, Windows and Android are reported separately: native,
   selected-folder/sync handoff, browser-only and unverified are not equivalents.
   Distribution claims require signed/notarized/device-tested artifacts where
   relevant, not just source builds or an installer script.
6. **Whole-path proof.** Synthetic end-to-end tests exercise source consent →
   background intake → pending/auto-save → same-store gallery/MCP retrieval →
   edit/delete/revoke/restart. Include two-owner/client isolation, malformed and
   oversized input, symlinks/path traversal, cancelled writes, stale revisions,
   missing/deleted sources, literal negation and absence of private network/log
   leakage. Real-device permission/delivery checks require owner participation.

No required model choreography. Deterministic code owns permissions, storage,
collection policy, provenance, scheduling and deletion. An optional model may
improve scoped retrieval or source-faithful presentation only under a clear
local/provider data boundary; no model may manufacture source approval.

## Work allocation

All branches start from the same baseline; workers do not edit one another's
checkout. Freeze the shared storage/transport contract before coupled changes.

| Lane | Task | Branch / ownership |
| --- | --- | --- |
| Lead | `01a033b7-19f5-7810-8429-3983b5bca928` | `codex/proof-full-integration`; contract, web integration, privacy review, acceptance and release |
| Vault / MCP | `01a07a3c-6886-76d1-88c4-9383a08dddc4` | `codex/proof-full-vault`; durable authority, grant/read transport and scoped retrieval |
| Collector | `01a07a3c-6af6-73f3-af68-8040441a0ed7` | `codex/proof-full-collector`; native source/lifecycle, persistent consent and packaging |
| Reminders / QA | `01a07a3c-704e-7130-9d56-075a65d6eb32` | `codex/proof-full-reminders`; deterministic policy/tests and platform acceptance docs |

Use compact source-based handoffs, explicit interface ownership and focused
checks before the full suite. Avoid duplicate dependency installations, broad
history scans and separate architectures for the same local authority. Model
overrides follow the owner's confirmed allocation; the lead retains review and
integration regardless of worker model.

## Release and authority

Implementation authorization does not activate personal sources, notification
permissions or login items; nor does it authorize credentials, purchases,
cloud/provider uploads, signing submissions or production deployment. Request
action-time confirmation for those external gates. Synthetic development must
not search personal Photos, mail, messages or memories merely for test fixtures.

ChorOS PR1045 is a separate backend lane, not an implicit connection to browser
IndexedDB. Its merge deploys production and must be coordinated separately with
the current proposal-routing release. Preserve dirty primary checkouts. A web
release, a backend release and a native distribution each need their own receipt.
