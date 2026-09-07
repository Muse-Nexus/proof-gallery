# Atomic native vault initialization

PR 21 review identified that autocommitted table creation could precede the
owner/collection/version transaction. An interruption could leave a nonempty,
versionless database that subsequent opens correctly rejected.

`VaultDatabase` now opens and checks the store without creating tables.
`ProofVault` calls `initializeSchema()` inside its existing `BEGIN IMMEDIATE`
transaction, before inserting identity metadata. All eight tables and all three
metadata entries commit together. The schema helper rejects autocommit use.
Errors roll back the transaction; closing an uncommitted SQLite connection also
rolls back. Existing partial/unknown-version stores remain rejected, without
reset, migration, or destructive recovery. Path, file permission and lifetime
lock checks are unchanged.

Synthetic verification: `swift test --filter
'VaultInitializationTests|ProofVaultTests|VaultBackupTests'` passes 24 tests.
Four initialization tests cover complete fresh identity and reopening, a
metadata conflict after table creation that rolls back all new tables while
preserving the unknown object, an abandoned real transaction with partial
identity, and byte-preserving rejection of a previously committed partial
schema. The interruption test closes an uncommitted connection; it does not
claim process-kill or physical power-loss testing. No production fault hooks
or real source libraries are used.

The separate crash window between database commit and the controller's
UserDefaults collection pointer is outside this change. Recovering that pointer
requires a coordinated, explicit owner action and validated existing identity;
it must not reset storage or implicitly attach an unexpected collection.
