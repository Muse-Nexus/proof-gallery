# Synthetic browser end-to-end checks

## Installable app and offline lifecycle

The additional built-preview suite runs with the same pinned CLI and isolation:

```sh
bun run build
bun run test:e2e:pwa
```

It starts its own loopback-only server for already-built public files, refuses
private dotenv files, and uses a fresh ephemeral browser/config without inherited
credential variables. It checks the real install offer when provided by Chromium,
decoded 192/512 icons, offline saved-attachment rendering, pending isolation,
mobile layout, and the exact public-only cache allowlist. A synthetic version
bump of the generated worker verifies that an update waits through an unsaved
editor, activates after its old client closes, and preserves unrelated caches
and the local gallery. No operating-system app is installed by the test.
Screenshots and a synthetic-only receipt remain in its printed temporary path.
The browser CI job runs both suites. OS installation on Android/iOS/Mac/Windows
still needs per-device checks; there is deliberately no OS share target.

## Core gallery workflows

Run from a clean checkout with Bun installed:

```sh
bun install --frozen-lockfile
bunx agent-browser@0.36.0 install
bun run test:e2e
```

The runner starts its own Vite server on an available loopback port. To use an
already-running local checkout:

```sh
bun run test:e2e --url http://127.0.0.1:5190/
```

Default startup refuses a checkout containing any real `.env` or `.env.*` file
(`.env.example` is permitted), preventing Bun/Vite from loading private local
configuration. Use a separate clean worktree; the runner never removes files.
With `--url`, you are responsible for starting that local development server
without private configuration. Browser network access remains loopback-only.

Only a bare HTTP loopback origin is accepted. Remote URLs, credentials, paths,
query strings, existing browser profiles, restore state, and user-selected
sessions are not accepted. The pinned browser CLI receives a fresh temporary
configuration, unique session/namespace, and loopback network allowlist.
Only an explicit runtime environment allowlist is inherited; provider credentials,
`AGENT_BROWSER_*`, proxy, and AI Gateway overrides are not passed through.
The runner closes only its own browser and development server in `finally`.
The separate `browser-e2e` CI job installs the pinned runtime on `macos-15` and
runs this same command against an isolated loopback development server. This
keeps Chrome's sandbox enabled; the downloaded test browser cannot start under
the default Ubuntu 24 AppArmor user-namespace policy. The required `verify` job
depends on successful browser and native checks, so a failed or skipped E2E job
cannot pass the release gate. No `--no-sandbox` or system-policy changes are used.

All evidence is synthetic. Application writes use the rendered UI and actual
browser storage, not mocked IndexedDB or imported application-store functions.
The runner retains a synthetic-only temporary directory containing screenshots,
its downloaded encrypted backup, and a machine-readable receipt. On failure it
also saves the visible page text and accessibility snapshot. The path is printed
to the terminal. Never run this script against a real gallery or substitute
personal media into its fixtures.

## Covered workflow

- Add an actual PNG attachment, exact quote, source, date, category, and tags.
- Reload and check persisted fields and a decoded blob-image preview.
  The card is brought into view and decoding is awaited, including lazy media.
- Edit, filter by category/tag, run lexical search, and open a source-faithful
  story reading.
- Save a pending-media note without making it searchable as saved Proof.
- Download the real encrypted backup file; reject a wrong passphrase without
  changing either saved or pending items.
- Clear saved Proof and pending review through their confirmation dialogs;
  restore the downloaded file and preserve the pending note's review state.
- Explicitly approve that pending item and then find it through saved search.
- Choose and explicitly trust a synthetic folder, persist the actual directory
  handle, save media, and verify deleted bytes do not reappear after reload.
- Persist Pause across reload, resume when asked, and Forget without deleting
  evidence already saved.
- Paste a literal synthetic note and drop an image into the focused capture
  area; find the undated saved item with Recently added, without invented dates.
- Download an encrypted recovery part and restore its identical entries without
  changing existing saved evidence.

## Honest boundaries

Agent-browser 0.36.0 does not reliably fill Chromium's segmented date widget.
The runner sets that native input through its standard DOM value setter and
dispatches `input`/`change` events; it then verifies the actual saved date after
reload. It does not call application setters or write storage. The operating
system date-picker interaction remains a separate manual check.

Clipboard and drop coverage dispatches standard synthetic DOM events through
the focused intake area. It never reads or replaces the system clipboard and
does not establish native OS share-sheet support. Component tests separately
cover validation races, oversized transfers, and cancellation.
Synthetic strings embedded in browser evaluation also escape HTML delimiters
and JavaScript line separators; runner assertions check exact round trips for
quotes, backslashes, control characters, and script-closing text.

The folder picker is replaced only inside the ephemeral test page with a function
returning a genuine browser-owned Origin Private File System directory handle.
Synthetic PNGs are written into that directory, then the normal source-consent
UI, scanner, validation, IndexedDB handle cloning, grant checks, and deletion
ledger run unchanged. No grant or gallery store is fabricated. This verifies
browser lifecycle behavior, not native OS directory selection or permission
dialogs. Real folder-picker consent/revocation still needs a manual device check.

This local suite does not establish real Photos permission, native companion
pairing, notarization/Gatekeeper, account-scoped Supabase integration, or semantic
model availability. Native synthetic tests and hosted two-owner tests remain
separate. See [companion boundaries](COMPANION.md) and
[backup and recovery verification](PRIVATE_COMPLETION.md).
