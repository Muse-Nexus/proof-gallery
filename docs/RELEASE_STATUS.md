# Current release status

Last verified: 2026-09-08. This page describes what someone can use now. Older
implementation receipts remain historical snapshots and may describe gates that
were open at their date.

## What is available

| Surface | Current status | What it means |
| --- | --- | --- |
| Browser on Mac, Windows, iPhone/iPad, or Android | **Public now** at [proof-gallery-9jn.pages.dev](https://proof-gallery-9jn.pages.dev/) | Add notes and explicitly selected media, review, search, and make encrypted backups. Data stays in that browser profile unless you intentionally export or use a separately configured hosted mode. |
| Installable browser app | **Available where the browser supports installation** | Adds an icon and caches public app-shell files for offline opening. It does not add sync, account isolation, Photos/library access, a share target, or closed-app collection. |
| Browser folder source | **Available on supporting desktop browsers** | Reads only the chosen folder's immediate supported files while Proof is open and visible. Review is the default; automatic saving requires separate confirmation for that exact folder. Nothing runs with the browser closed. |
| Mac native companion source | **Public source preview** | macOS 14+ source includes a private native vault, bounded Photos/folder intake, per-source background choice, a gallery connection, read-only saved-text assistant access, and generic reminders. The v0.2.0 target is Apple-silicon-only. |
| Mac native binary | **Experimental public prerelease** | The owner approved an explicit experimental exception for v0.2.0 build 4 on Apple-silicon Macs running macOS 14+. [Download the exact DMG](https://github.com/Muse-Nexus/proof-gallery/releases/download/native-v0.2.0-preview.1/Proof-Photos-Companion-0.2.0.dmg). It is not GA or a general install recommendation; the device gates below remain unfinished. |
| Windows/Android native background collection | **Not built** | Windows, Android, and other mobile users can use browser note and selected-media intake. They do not have a native closed-app source collector. |

The browser release is commit
[`ad2b8ad`](https://github.com/Muse-Nexus/proof-gallery/commit/ad2b8adb5af8f9903e7457abeb6e50367403bb72),
reviewed in [PR 23](https://github.com/Muse-Nexus/proof-gallery/pull/23).
Its immutable deployment is
[`d7c8ced1`](https://d7c8ced1.proof-gallery-9jn.pages.dev/). Hosted
[CI](https://github.com/Muse-Nexus/proof-gallery/actions/runs/34244517043) and
[CodeQL](https://github.com/Muse-Nexus/proof-gallery/actions/runs/34244517022)
passed. These receipts verify the public web build, not native device behavior.

The experimental native asset is `Proof-Photos-Companion-0.2.0.dmg`, 1,299,679
bytes, from full source commit
[`2749170b6ea6691cea915d52033bf437820b73f4`](https://github.com/Muse-Nexus/proof-gallery/commit/2749170b6ea6691cea915d52033bf437820b73f4).
Its final SHA-256 is
`2ae432dd57f2e67f533f64e94ca8d8f3589e4b2380ff86d24cbdaf26dd96e6fa`.
An anonymous download matched that exact size and digest; DMG integrity, installer
stapling and DMG Gatekeeper checks passed, and the downloaded app/helper strict
signatures passed. The downloaded app also passed Gatekeeper as a notarized
Developer ID app; its Info.plist reports version 0.2.0, build 4, and macOS 14.0,
and its executable is arm64. The contained app is not claimed to be independently
stapled.

On 2026-09-08, the installed build 4 read-only assistant helper also passed five
[synthetic installed-path checks](HELPER-PACKAGING.md#check-an-already-installed-helper-without-opening-photos),
including exact saved-text reads/search, pending exclusion, revoked-access
denial, and executable-selection validation. During that helper-only test the
Photos app was not launched; this is not a clean-account GUI or
chosen-assistant-host acceptance receipt.

The exact installed app later launched normally in an existing OS account and
showed an empty, unconfigured state: no vault, zero prepared photos, Photos
disconnected, and login startup off. No source, vault, or client grant was
created. This remains an existing-account launch receipt, not clean-account,
real-source, permission, background, or full device acceptance.

## Permissions stay separate

No installation or single permission enables everything:

| Choice | What it permits | What it does not permit |
| --- | --- | --- |
| Select/paste/drop in the browser | Use only the items selected in that action | Library, account, or background scanning |
| Start a browser folder source | Read the chosen folder's top-level supported media while the page is open and visible | Recursive scanning, writes to originals, or closed-browser collection |
| Trust that browser folder | Save new validated media from that exact folder with the chosen category/tags | Trust for another folder, old pending-item approval, or model interpretation |
| Allow macOS Photos | Lets the Mac app request PhotoKit reads | Starting a source, choosing its scope, automatic saving, background work, or cloud AI |
| Choose and start a native source | Reads the selected Photos scope or folder | Trusted automatic saving or background collection unless each is separately enabled |
| Enable source background work | Lets that approved source continue when its window closes | Login startup, reminders, assistant access, or work while the Mac is asleep or off |
| Enable login startup | Registers app startup | Source access or automatic saving |
| Connect the browser gallery | Time-limited native gallery media, review, and edit access | Assistant access or source/reminder management |
| Grant a chosen assistant | Time-limited reads of saved text only | Photos, pending items, attachments, writes, approvals, or source management |
| Enable reminders | App reminder consent plus separate OS notification permission | Evidence in notification text or automatic retrieval |

A cloud-backed assistant may send the saved text you explicitly request to its
provider. No cloud model is mandatory: browser search is local text matching,
and supported native meaning matching is on-device with a visible literal-text
fallback. Never paste assistant tokens, backup passphrases, private evidence, or
generated connection configuration into a chat or repository.

## Backup and restore

- Browser and native backups are passphrase encrypted, but active browser and
  native storage are not app-encrypted.
- Keep the backup and its passphrase separately. Proof cannot recover a lost
  passphrase, and no backup is uploaded automatically.
- Test recovery in a separate browser profile or empty, unconnected native
  collection before depending on it.
- Restore brings back content only. It does not restore folder/Photos consent,
  automatic-save or background grants, login startup, gallery/assistant tokens,
  reminder consent, or OS notification permission.
- Browser and native backup formats are separate; do not treat one as the
  other's restore file.

## Gates before promotion beyond experimental

The owner-approved experimental publication exception does not complete a genuine
clean-account or clean-device install and first-run pass. GUI setup, a chosen real
source, OS permission and revocation, pause/restart/wake behavior, optional login
startup, notification delivery, browser connection, and a chosen assistant's real
client remain unverified. Complete them before any GA claim, general install
recommendation, or promotion beyond experimental.
Use the [native release checklist](NATIVE_RELEASE_CHECKLIST.md) to record those
gates and verify published bytes without repeating already completed artifact work.
