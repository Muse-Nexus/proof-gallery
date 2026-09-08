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
| Mac native binary | **Not publicly available** | A v0.2.0 build 4 candidate from source commit `2749170` was Developer ID signed, notarized, stapled, installed locally, and accepted by Gatekeeper. Clean-account GUI, source, OS-permission, and chosen-assistant tests were not completed, so the candidate is not a public release or general install recommendation. |
| Windows/Android native background collection | **Not built** | Windows, Android, and other mobile users can use browser note and selected-media intake. They do not have a native closed-app source collector. |

The browser release is commit
[`6bdd308`](https://github.com/Muse-Nexus/proof-gallery/commit/6bdd30882190ab8df17905c26dd6f7473215c858),
reviewed in [PR 22](https://github.com/Muse-Nexus/proof-gallery/pull/22).
Its immutable deployment is
[`c522f84a`](https://c522f84a.proof-gallery-9jn.pages.dev/). Hosted
[CI](https://github.com/Muse-Nexus/proof-gallery/actions/runs/34188355883) and
[CodeQL](https://github.com/Muse-Nexus/proof-gallery/actions/runs/34188355833)
passed. These receipts verify the public web build; they do not verify a native
first install, real personal sources, OS permissions, assistant setup, or a
public Mac download.

On 2026-09-08, the installed build 4 read-only assistant helper also passed five
[synthetic installed-path checks](HELPER-PACKAGING.md#check-an-already-installed-helper-without-opening-photos),
including exact saved-text reads/search, pending exclusion, revoked-access
denial, and executable-selection validation. The Photos app was not launched;
this is not a clean-account GUI or chosen-assistant-host acceptance receipt.

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

## Remaining native gates

Before publishing a Mac binary, complete a genuine clean-account or clean-device
install and first-run pass: GUI setup, chosen real source, OS permission and
revocation, pause/restart/wake behavior, optional login startup, notification
delivery, browser connection, and a chosen assistant's real client. Publishing
the binary remains a separate owner-approved action.
Use the [native release checklist](NATIVE_RELEASE_CHECKLIST.md) to record those
gates and verify published bytes without repeating already completed artifact work.
