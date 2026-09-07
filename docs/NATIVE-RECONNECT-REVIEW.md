# Explicit existing-storage reconnection

A crash after native database initialization but before the UserDefaults
collection pointer was persisted could leave a valid collection that setup
could not reopen. When storage is not ready, the native panel now offers
“Reconnect existing private storage…”. A confirmation warns that previously
approved sources, enabled reminders and client connections may resume. Cancel
leaves storage disconnected. No database is opened and no attachment callback
runs before confirmation; startup does not attempt this recovery.

The confirmed action opens only the app's known storage directory. The
existing-only database mode never creates a directory, lock file or database.
It reuses private-path, owner, permission, sidecar and lifetime-lock checks,
requires the eight native table names and their expected columns, and rejects
an empty store or unknown version. The factory validates the persisted UUID
and expected local owner using the same locked database connection returned to
the vault. It does not reset, migrate or replace a store. Recovery does not
change journal mode. The controller persists the recovered UUID only after
successful attachment. No new source, notification, login or client grant is
created by recovery. Already approved services may resume through ordinary
attachment after the explicit warning and confirmation.

Synthetic verification: 41 focused tests pass across VaultReconnectTests,
VaultInitializationTests, NativeVaultControllerTests, NativeLifecycleTests,
ProofVaultTests and VaultBackupTests. New tests cover absent directory/files,
corrupt/empty/unknown-version stores, malformed columns, invalid UUID, foreign
owner, retained synthetic content and exclusive locking. Rejected fixtures
retain their database bytes. Controller tests cover startup inactivity,
pre-confirmation inactivity, cancellation, successful UUID recovery, missing
storage and rejected attachment without preference persistence. Notification
clients are fakes. No real libraries, OS permission requests or service
registration were exercised. The SwiftUI control compiles; interactive dialog
presentation was not exercised in these unit tests.
