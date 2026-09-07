# Browser to native vault synthetic receipt

`scripts/e2e-native.mjs` exercises the rendered web app against the actual Swift
`VaultBridge` and SQLite authority. It is not a mocked fetch/jsdom test.

```sh
node scripts/e2e-native.mjs --dist /absolute/path/to/already-built/dist
```

Optional `--chromium` and `--agent-browser` paths select existing cached binaries.
The defaults use this development Mac's cached Chromium 151 and agent-browser
0.36.0. No dependency installation is performed. The native XCTest fixture is
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

Successful local receipt: `/private/tmp/proof-native-e2e-b4erjs/receipt.json`.
Screenshots include `landing.png`, `native-saved.png`, and `native-revoked.png` in
that same temporary receipt directory. The connection-token file and browser
profile were removed after the run. Receipts list public asset paths and native
route names, never bearer tokens. The tested web build was worker commit
`1cda2e4`, asset `index-CxKxRnsP.js`; its index SHA-256 was
`7518a77dfe6104415529e71113c704651f4a4da1e283c48644c596cb1fa85757`.
Native transport was the `5f86d3b` interface, with vault through `11ef2b5`.

This test caught a real browser-only bug: calling a stored native `fetch` as an
object method supplied an invalid receiver before any request. The web worker
fixed it in `1cda2e4` and added a receiver-aware unit test. Earlier interrupted
runs also exposed fixture-only CDP target-detach handling, selector quoting and
the Pages `/offline` clean-route mapping; those are fixed in this harness.

This receipt does not prove real Photos collection, installed/sandboxed helper
execution, signed distribution, Windows/Android native support, or permissions in
the user's browser. Packaged helper runtime verification is a separate
lead-owned receipt. Browser deletion, hidden-draft recovery and every
cross-platform browser variant are outside this bounded flow's claims.
