# Native setup (development, not installed or released)

The native setup creates one private `ProofGalleryVault` under the application's
Application Support directory only after the owner presses **Set up private
storage**. Startup opens an already configured store; a missing store fails
closed rather than silently creating a replacement. No source access, login
registration, notification prompt or network listener occurs at object creation.

If app settings are lost but the collection remains, **Reconnect existing private
storage…** offers an explicit confirmation before opening the known local store.
The warning explains that previously approved sources, reminders and clients may
resume. Cancel does nothing. Reconnection validates the existing identity/schema
and never creates or replaces storage; see [recovery checks](NATIVE-RECONNECT-REVIEW.md).
Initial schema and collection identity are committed in one transaction.

Separate owner actions choose a source, background collection, trusted-source
automatic saving, login startup, gallery access, assistant access and reminders.
Trusted Photos confirmation includes the exact source ID/date floor and chosen
category/tags; trusted folder confirmation includes the resolved folder path.
Both leave existing pending items pending, stay paused until Start and preserve
their explicit approval time across unchanged restarts.
Source selection does not imply any of the others. Browser and hosted collections
remain separate. Active SQLite storage is not app-encrypted; 0700/0600 permissions
protect from other OS accounts, not software running as this user. FileVault is
an independent operating-system choice.

Gallery grants last 24 hours and cover media, pending review and CRUD. Assistant
grants last 30 days, cover saved text only, and display the cloud-provider data
disclosure before creation. Raw tokens are shown/copied only on explicit action
and held in memory; only hashes persist in the vault. Clipboard/configuration
copies are secrets controlled by the owner, not automatically erased or published.
The loopback port is remembered so an explicitly granted assistant connection can
resume after native restart. Port conflicts fail closed without an alternate host.

Reminders have separate OS permission and persisted consent, owner-chosen local
time/timezone/quiet hours, a 20-hour cooldown and no missed-time catch-up. The OS
receives only a generic invitation, not an evidence ID, quote or image. Turning
reminders off cancels in-flight/queued delivery without changing source access.
Quit cancels current work but preserves prior source and reminder consent; explicit
Pause/Off persist. Granted connection/reminder services keep the process in the
menu bar on window close independently of source permission; foreground-only
collection pauses in that case. Closing the window keeps collecting only if the source's
background choice is enabled. No process runs while the Mac is shut down/asleep.
Hide/minimize pauses foreground-only collection and any one-shot iCloud download;
it does not broaden background permission. Failed durable client revocation also
stops the live listener, with a clear retry-before-restart warning.

Owner-selected encrypted backup exports exact saved and pending evidence without
source/client/reminder authority. Restore accepts only an empty unconnected native
collection and validates the complete archive atomically; browser backups remain
a different inner format. Passwords stay in memory and are cleared from the field
after starting an operation. No backup is uploaded automatically. Keep a recovery
copy and its passphrase separately; losing both loses access to this evidence.

Public signed helper packaging is a separate completion gate. Do not advertise
this source build as ready to install.
Actual native first-run, OS permissions, restart, notifications, Gatekeeper and
Windows/Android behavior require separate device receipts and owner authorization.
