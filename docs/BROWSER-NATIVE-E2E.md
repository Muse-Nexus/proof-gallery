# Browser to native vault synthetic receipt

`scripts/e2e-native.mjs` exercises the rendered web app against the actual Swift
`VaultBridge` and SQLite authority. It is not a mocked fetch/jsdom test.

```sh
bun scripts/e2e-native.mjs --dist /absolute/path/to/already-built/dist
```

Prerequisites are macOS, Swift, Bun 1.2.23 (or Node with built-in WebSocket), the
already-built public `dist`, and an installed cached agent-browser 0.36.0 browser
runtime. The existing CI `bunx agent-browser@0.36.0 install` step supplies that
runtime before this test; the harness itself never installs dependencies.

Optional `--chromium` and `--agent-browser` paths select existing cached binaries.
Without overrides the harness discovers the pinned native agent executable in
installed Bunx/Bun/npm caches, with no username or npm-cache hash hardcoded. It
selects the newest executable Chrome from `~/.agent-browser/browsers/chrome-<version>`
first, then falls back to cached Playwright Chromium. Each automatic choice must
contain the host architecture according to `lipo`: arm64 or x86_64. Bun/npm cache environment overrides and an absolute
`PLAYWRIGHT_BROWSERS_PATH` are respected. Missing/nonexecutable runtimes fail with
an explicit prerequisite message; raw package-cache files are never chmodded or
installed. The selected paths and host architecture appear in the private receipt.

The native XCTest fixture is
enabled only by the harness's explicit private `/private/tmp/proof-native-e2e-*`
directory; normal test runs skip it. Its listener lifetime is bounded to 180
seconds, with fresh synthetic pending evidence and gallery/assistant grants.

The browser has a new disposable profile. CDP fulfills only locally built public
assets under the unchanged official `https://proof-gallery-9jn.pages.dev` Origin,
using the built public CSP. Only the exact synthetic IPv4-loopback vault port may
continue to the network. Other page/worker requests are aborted; a dead loopback
proxy and DNS exclusion also block browser background internet access. No browser
security check, production Origin rule, or native authorization route is weakened.
Chromium's `loopback-network` permission is granted only in this isolated fixture
profile, not in a user browser or macOS privacy settings.

Agent-browser performs navigation, accessibility snapshots, visible form actions
and screenshots. The successful run covered:

- App loads with real rendered controls at the official Origin, from local bytes.
- Connect performs actual CORS OPTIONS/POST requests without surfacing pending
  evidence. Assistant access cannot read the pending item.
- Browser review/approval changes the same native record subsequently returned to
  assistant get, preserving its complete literal note and occurred date.
- Native media passes the web client's digest/format validation and decodes in
  the browser; a browser edit is returned exactly by the native assistant route.
- Native grant revocation causes the browser to disconnect and clear displayed
  evidence. No uncaught browser exception occurred.

Successful local receipt: `/private/tmp/proof-native-e2e-Agxgc2/receipt.json`.
Screenshots include `landing.png`, `native-saved.png`, `native-saved-narrow.png`, and `native-revoked.png` in
that same temporary receipt directory. The connection-token file and browser
profile were removed after the run. Receipts list public asset paths and native
route names, never bearer tokens. The tested web build was worker commit
`d9594b7`, assets `index-BHtFHQcy.js` and `index-gQeUiRo8.css`; its index SHA-256 was
`d4fe5beb0935783dccb026eb6be50945bf11223c462c63667a30812f3ab24d60`.
Native transport was the `5f86d3b` interface, with vault through `11ef2b5`.

The `browser-e2e` CI job runs the native browser flow after its existing application
build and PWA checks, using the same installed runtime and public dist. Existing
debug-helper, packaged-helper and release-safety gates in `mac-companion` remain
unchanged. The local cache-discovery path passed under Bun on arm64; actual x64
execution remains a runner verification gate, not a local-host claim. Current
runs take a 1200px saved-view screenshot and a 390px screenshot with a horizontal
overflow check; neither viewport may truncate the exact note.

This test caught a real browser-only bug: calling a stored native `fetch` as an
object method supplied an invalid receiver before any request. The web worker
fixed it in `1cda2e4` and added a receiver-aware unit test. Earlier interrupted
runs also exposed fixture-only CDP target-detach handling, selector quoting and
the Pages `/offline` clean-route mapping; those are fixed in this harness.

Hosted PR21 run `34092978507` at `68e3de43` passed the native companion job and
the earlier browser/PWA steps, but failed native browser discovery because its
installer used `/Users/runner/.agent-browser/browsers/chrome-152.0.7977.82`, not a
Playwright cache. The fix adds that cache layout without changing installation,
authorization or CI gates. Synthetic temporary cache validation passed numeric
version ordering, agent-cache preference, skipping nonexecutable entries, actual
`lipo` architecture validation, and fallback after removing the agent-cache links.
The unchanged full local fallback flow then passed at
`/private/tmp/proof-native-e2e-gizoLo/receipt.json`; hosted rerun is still required.

The next hosted run `34093385975` at `e9d161ab` exposed a second layout detail:
agent-browser 0.36.0 strips `chrome-<platform>/` while extracting the archive.
Its pinned [installer source](https://github.com/vercel-labs/agent-browser/blob/v0.36.0/cli/src/install.rs)
checks `Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
directly under `chrome-<version>`. Discovery now includes that exact relative
path while retaining nested layouts and all executable/architecture checks.
Synthetic validation now uses this stripped layout for the newest version and
a nested older version, checking both plus fallback. The earlier synthetic test
only modeled the nested layout, so it did not detect this installer mismatch.
No Origin, CSP, sandbox or actual-flow requirement was changed; hosted execution
of the corrected layout remains the outstanding gate.

This receipt does not prove real Photos collection, installed/sandboxed helper
execution, signed distribution, Windows/Android native support, or permissions in
the user's browser. Packaged helper runtime verification is a separate
lead-owned receipt. Browser deletion, hidden-draft recovery and every
cross-platform browser variant are outside this bounded flow's claims.
