# Native-first Proof Gallery implementation receipt

2026-09-07. Ready for code review; **not deployed, installed or publicly
notarized**. The Windows/Android native product is not complete.

Base: standalone main `2bdd75d0da1ebaf779a43b9e3553b82b1c053722` (PR20).
Integration branch: `codex/proof-full-integration`.
Tested native implementation head: `90b2901`; final browser-harness head: `2e669e8`.
PR: <https://github.com/Muse-Nexus/proof-gallery/pull/21>.
Use the current PR head and hosted checks for the final integrated revision;
the result boundaries and local artifacts are recorded below.

## Built

- One durable private Mac collection shared by the companion, an explicitly
  connected gallery, and read-only saved-Proof MCP access.
- Bounded selected Photos/folder intake; pending review by default, separately
  confirmed exact-source auto-save and background operation, persistent Pause,
  deduplication and deletion suppression. No general account mining.
- Manual image/note/quote capture, exact source/date display, review, edit,
  delete, category/tag filtering, newest browsing and scoped on-device search.
  Lighter responsive styling puts an explicitly opened image first.
- Separate generic reminder consent, quiet hours, cooldown and durable claims;
  separate login choice. Neither one grants evidence retrieval or source access.
- Expiring per-client permissions, immediate live revocation, and current
  record/scope checks before each response chunk. Hidden pages redact evidence
  and retain unsaved drafts only in memory pending permission and explicit resume.
- Encrypted native content backup/atomic empty-store restore; no active source,
  client, bookmark or reminder permissions imported. Browser/hosted collections
  remain distinct, with no silent migration or co-search.
- Crash-atomic schema and identity setup, plus explicit owner-confirmed recovery
  of an existing collection when app settings are lost. No silent replacement or
  reconnection. Search excludes filenames from meaning matching and honors
  requested seven-to-ten result limits without changing legacy callers.
- Bundled independently sandboxed MCP helper, private assistant setup examples,
  major AGENTS/Claude instructions and repeatable browser/native CI checks.

## Main changed files

| Area | Files |
| --- | --- |
| Durable store | `companion/macos/Sources/CompanionVault/{ProofVault,VaultTypes,VaultValidation,VaultDatabase,VaultBackup}.swift`, system `CSQLite` shim/module |
| Source/runtime | `PhotosModel.swift`, `FolderCollector.swift`, `LoginItemController.swift`, `ProofCompanionApp.swift` under `Sources/ProofPhotosCompanion` |
| Native setup/reminders | `NativeVaultController.swift`, `NativeVaultView.swift`, `NativeReminderAdapter.swift`; `CompanionCore/ReminderPolicy.swift` |
| Scoped transport | `VaultBridge.swift`, `VaultService.swift`, `CompanionCore/{VaultBridgeRequest,ProofMCPProtocol}.swift`, `Sources/ProofMCP/main.swift` |
| Web | `src/App.tsx`, `src/components/NativeVaultGallery.{tsx,css,test.tsx}`, `src/lib/native-vault.{ts,test.ts}`, `src/companion-security.test.ts` |
| Packaging/verification | `companion/macos/Package.swift`, helper plist/entitlements, app entitlements, `build-app.sh`, `test-build-safety.sh`, `test-release-safety.sh`, native test suites, `scripts/e2e-native.mjs`, `.github/workflows/ci.yml` |
| Instructions/contracts | `AGENTS.md`, `CLAUDE.md`, `README.md`, `docs/FULL_VERSION_PLAN.md`, native/vault/MCP/reminder/backup/setup/privacy/installation and test-receipt docs |

Full inventory: `git diff --name-only 2bdd75d0da1ebaf779a43b9e3553b82b1c053722 HEAD`.

## Database and privacy

No Supabase migration, deployed database, ordinary ChorOS recall path, dependency
lockfile or production credential changed. Explicit native setup creates SQLite
schema version 1: `metadata`, `records`, `sources`, `handled`, `tombstones`,
`clients`, `reminder`, `deliveries`. Unknown schema versions fail closed.

The native store uses 0700/0600 OS permissions and a single-process file lock;
active storage is **not app-encrypted**. Backups are passphrase encrypted.
Same-user software, device administrators and copies already disclosed remain
outside that protection. There is no team/public gallery lane. MCP is saved text
only, cannot manage sources or write evidence, and may disclose requested text
to the owner's chosen cloud assistant. All verification used synthetic evidence.
No real Photos, email, messages or personal memories were scanned for fixtures.

## Verification receipts

| Check | Local result |
| --- | --- |
| `bun run check` | Both TypeScript configurations, 344 tests in 33 files, production build passed |
| `swift test --package-path companion/macos` | 110 tests: 108 passed, 2 explicitly gated probes skipped, zero failures |
| Actual packaged `ProofMCPProcessTests` | Both passed against the ad-hoc sandboxed helper and real synthetic loopback store |
| `bun scripts/e2e-native.mjs --dist /absolute/built/dist` | All 5 real browser-to-Swift/SQLite flow assertions passed; 390px overflow/quote checks and screenshots; no uncaught browser exceptions |
| `bun run test:e2e` | All 8 grouped browser workflows passed: CRUD, exact evidence, review, trusted-folder controls, recovery and deletion suppression |
| `bun run test:e2e:pwa` | All 4 offline/install/update lifecycle groups passed |
| Release safety scripts | Synthetic approval/notary/signing gates and helper packaging checks passed |
| Native release build | Local arm64 ad-hoc build, nested signature and exact helper-entitlement verification passed; not Developer ID/notarization |
| Edge checks | Format check of 7 files and both existing Edge Function type checks passed |
| Diff/private configuration | Diff whitespace, shell/plist validation, tracked-secret/config checks passed |

The full-suite skips are the separately invoked browser fixture and optional
real on-device story-model probe. On-device semantic matching itself passed.
The browser fixture passed when explicitly invoked by its harness. The build
still reports a nonfatal JavaScript chunk-size warning (~537 kB minified).
Hosted GitHub checks are a separate PR gate, not implied by these local results.
All seven checks passed on `bac3251` before the final review corrections; the
final current-head status is reported in the PR checks, not inferred from that
earlier run.

Review correction receipts: [search](NATIVE_SEARCH_REVIEW.md),
[atomic initialization](VAULT-INITIALIZATION-REVIEW.md), and
[explicit reconnection](NATIVE-RECONNECT-REVIEW.md). The latest native suite ran
the on-device seven/ten-result checks, not just their literal fallback.

Latest combined native/browser artifacts: `/private/tmp/proof-native-e2e-x3TLGc/receipt.json`
and adjacent desktop/narrow screenshots. Browser regression artifacts:
`proof-gallery-e2e-synthetic-iVoGti`; PWA artifacts: `proof-pwa-synthetic-jnHZan`.
These temporary local receipts contain synthetic data, not shipped example data.
The browser harness deletes its token file and temporary browser profile.
The final harness waits for fresh controls and smooth scrolling to settle before
a single click. It never retries a mutation; see [browser timing receipts](BROWSER-NATIVE-E2E.md).

## Remaining release and product gates

1. Review this branch and pass hosted required checks. No merge/deploy was done.
2. With fresh approval, select release version/build and reviewed SHA, prepare
   Developer ID signed artifacts, submit for notarization, inspect the Apple
   log, staple, verify Gatekeeper and test on a clean Mac. Ad-hoc is not install-ready.
3. With the owner present, verify first-run setup, actual selected-source
   permission, pause/restart/wake, optional login registration, notification
   delivery, browser loopback permission and the chosen assistant's real client.
   Installation/source/auto-save/reminder/client choices remain separate actions.
4. Approve a reviewed web production release separately. The public site still
   serves the previous release. ChorOS backend PR1045 remains a separate lane.

Known product limits: native background service is Mac-only; PC/Android currently
use browser/media intake, not closed-app native collection. Search considers
the newest 100 saved items after filtering, not a full-history embedding index.
Native capacity is bounded (10,000 saved / 100 pending, 48 MiB media and 16 MiB
metadata per state); capacity errors do not delete existing evidence. Initial MCP
does not deliver media. Native/browser backup inner formats are distinct. No
new Gmail/social/message/Drive/Dropbox account connector was added; an explicitly
selected locally available folder is not an account-wide connector.

No permissions, installation, assistant configuration, source activation,
notification delivery, Developer ID signing, notary upload, production merge,
deployment or public release was performed as part of this implementation.
