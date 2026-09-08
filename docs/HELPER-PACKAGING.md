# Bundled assistant helper packaging

`build-app.sh` builds both `ProofPhotosCompanion` and `ProofMCP`, checks matching
architectures and copies the helper into `Contents/Helpers/ProofMCP`. Missing or
nonexecutable products fail before bundle signing. Only compiled public code and
Info.plist enter the bundle; vaults, source bookmarks and tokens do not.

The helper is signed first under identifier `nexus.muse.proof.mcp`, then the root
app. `ProofMCP.entitlements` contains exactly app sandbox plus network client.
It does not inherit the root app's Photos, selected-file, bookmark or server
permissions. Its code pins requests to the configured IPv4 loopback bridge; the
network-client entitlement itself is not a loopback-only firewall.

The release helper embeds its own `ProofMCP-Info.plist` in Mach-O
`__TEXT,__info_plist`, matching its signing identifier. This is the command-line
equivalent of Xcode's [Create Info.plist Section in Binary](https://developer.apple.com/documentation/xcode/build-settings-reference)
setting. It establishes an independent sandbox identity; do not substitute
`com.apple.security.inherit` or remove the sandbox to make startup succeed.

Both signatures are verified. The signed helper entitlement dictionary must
contain exactly those two enabled keys, including for an ad-hoc build. A Developer
ID build additionally checks each executable's exact approved identity, expected
team, identifier, hardened runtime and secure timestamp. The root app still rejects
debug task access. A direct Developer ID build requires the same explicit
`PROOF_PREPARE_SIGNING=approved` action gate as release preparation.

Ad-hoc builds print an explicit local-development-only notice. Packaging code and
mock checks do not prove that the signed helper runs from an installed bundle,
receives stdin/stdout correctly under App Sandbox, or reaches the local bridge on
a clean Mac. Those are separate owner-approved native acceptance gates. Existing
DMG hash, clean source, notarization/upload approval, Apple log review, stapling
and Gatekeeper checks remain in `package-release.sh`.

`test-build-safety.sh` substitutes Swift, lipo and codesign with local synthetic
stubs. It checks missing approval before build/sign, missing helper, architecture
mismatch, helper verification failure, excess helper entitlements, wrong app or
helper team, wrong helper identifier/identity, missing hardened runtime/timestamp,
helper-before-app signing order and the ad-hoc notice. It uses the real property
list parser only on synthetic entitlement files. `test-release-safety.sh` includes
this suite after its existing synthetic notarization-gate tests.

Those stub checks do not perform real signing, helper launch or OS requests.

## Local packaged-process receipt (2026-09-07)

An ad-hoc arm64 development bundle was separately built and its two signatures
and exact helper entitlements verified. The first packaged-process probe trapped
inside sandbox initialization before main. Embedding the helper's own identity
fixed that startup boundary without changing entitlements. Running
`PROOF_TEST_PACKAGED_HELPER=1 swift test --package-path companion/macos --filter ProofMCPProcessTests`
then passed both actual-process tests: initialization/read-only tool list, exact
saved evidence across the real loopback bridge, rejection of mutation tools,
pending exclusion and revoked access. All records/tokens were synthetic.

This is a local ad-hoc process receipt, not Developer ID signing, notarization,
installation, clean-device acceptance or proof of every assistant host's launch
policy. An assistant that imposes its own incompatible child-process sandbox may
require a different supported integration; do not disable either sandbox.

CI explicitly builds the debug helper before its process tests, then runs the
same process suite again against the ad-hoc packaged helper after bundle signing
for the runner's native architecture (not an unexecutable cross-build).
Missing packaged binaries fail rather than skip. Neither check uses release
credentials or submits an artifact to Apple.

## Check an already-installed helper without opening Photos

After separately authorized installation, the same synthetic process suite can
target the helper inside that exact app. Verify its signature and provenance
first. From a clean source checkout on the Mac:

```sh
PROOF_TEST_INSTALLED_APP='/Applications/Proof Photos Companion.app' \
  swift test --package-path companion/macos --filter 'ProofMCP(ExecutableSelection|Process)Tests'
```

This executes only `Contents/Helpers/ProofMCP` with a fresh temporary synthetic
vault/loopback server and synthetic token. It does not launch the Photos app,
read its UserDefaults or private collection, grant source/client permissions,
configure an assistant, or contact a cloud provider. Only the test port/token
and a fixed system PATH are passed into the child process. No real credential
is needed. An invalid or missing installed selection fails; it never falls back
to the debug helper. Do not combine it with `PROOF_TEST_PACKAGED_HELPER=1`.

An installed-helper pass proves the selected executable's stdio and synthetic
bridge behavior on that host/profile. It is not clean-profile app first launch,
Photos/notification permission, restart/wake, or a real assistant-host receipt.
Leave those gates explicitly unverified until observed; no password or security
override can turn a process test into a GUI acceptance test.

The Developer ID signed build 4 helper passed this installed-path suite on
2026-09-08: three executable-selection checks and two real stdio process tests,
all with synthetic evidence. This receipt does not change the remaining
[native release gates](NATIVE_RELEASE_CHECKLIST.md).
