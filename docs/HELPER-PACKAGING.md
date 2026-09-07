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

No actual signing, notarization submission, installation, helper launch or OS
permission request was performed to produce this packaging test receipt.
