# Synthetic native bridge and MCP receipt

Reviewed lead transport commit `5f86d3b` with vault through `11ef2b5` and
the `ProofMCP` executable target from `aeed0ec`. Tests use a newly created,
owner-private directory under `/private/tmp`, a synthetic SQLite vault, fresh
synthetic client tokens and an ephemeral IPv4 loopback listener. No real library,
user preference, Photos authorization, notification or login item is involved.

Validation commands:

```sh
swift build --package-path companion/macos --product ProofMCP
swift test --package-path companion/macos --filter 'VaultBridgeTests|ProofMCPProcessTests'
```

Three `VaultBridgeTests` exercise the actual listener and service:

- Native staged candidate is invisible to assistant get; gallery lists and
  approves it; assistant get/search return the same saved record with its complete
  literal negation, original date and receipt.
- Gallery media returns exact synthetic bytes and digest, with `no-store`.
- Assistant and gallery grant kinds cannot substitute for each other; wrong or
  missing origin, missing media scope, revoked grant and assistant mutation paths
  are rejected. Failed requests leave the pending/saved states unchanged.
- Stale edit/delete/media revisions return 409 and cannot overwrite the new note.

Two `ProofMCPProcessTests` run the compiled helper as a real child process, feed
newline-delimited JSON-RPC over stdin and inspect stdout/stderr:

- Initialize/initialized handshake and tools/list expose only `proof_get` and
  `proof_search`; both read the same live vault through loopback. Returned evidence
  remains exactly equal to the stored record. An attempted `proof_delete` fails.
- Pending and revoked reads return generic errors without literal evidence,
  private vault paths or tokens. Successful stdout contains no token/path either.

The process harness has a 20-second termination bound and uses only synthetic
environment values. Build the executable first: process tests explicitly skip if
the real executable is absent, so a skipped test is not a process receipt.

These five tests passed on the local arm64 macOS host. They do not establish signed
distribution, installed assistant configuration, browser CORS acceptance on every
platform, native UI usability or real-source collection. Semantic ranking may use
the existing on-device engine; both its label and literal fallback are accepted,
while exact returned evidence is checked. No cloud-model request is added.

Read-only review caught missing midstream revalidation. The integration now
rechecks the connection grant before each 64 KiB body chunk and drops its
in-memory token on connection finish/stop. Bytes already transmitted cannot be
retracted; deterministic midstream cancellation remains an additional test gate.
The integration fixture includes explicit synthetic capture metadata, matching
the stricter source rule that an occurred date cannot be invented when its
provider receipt has no capture date.
