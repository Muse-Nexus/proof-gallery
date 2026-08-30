# Contributing

Thank you for helping make Proof Gallery safer and more useful.

## Before opening a pull request

1. Use a branch and keep the change narrow.
2. Use only clearly synthetic evidence, names, dates, images, UUIDs, and URLs.
3. Run `bun run check` plus both frozen-lock Deno checks from the README.
4. For database changes, run a local Supabase stack and prove signed-out denial,
   two-owner isolation, owner CRUD, private images, and Proof-only retrieval.
5. For local storage or backup changes, use only synthetic versioned archives;
   prove unsupported or malformed input fails closed and that no local evidence
   is sent to a network provider.
6. For Mac companion changes, run `swift test` and `bash build-app.sh` in
   `companion/macos`. Use synthetic inputs; real Photos verification requires
   the owner's permission and source selection. Never publish the local
   ad-hoc-signed bundle as a notarized release.
7. Update the smallest relevant documentation.

Never commit or paste real evidence, photos, credentials, `.env` files, signed
URLs, provider responses, production identifiers, or database dumps.

Read AGENTS.md for the purpose and evidence-handling contract. Permissioned
discovery is the product direction. Implemented source paths are local
selected-media review and the optional Mac companion's bounded, active-session
Photos source. The companion exports candidates for explicit review, not
saved-Proof backups or automatic sync. General account/library mining, public
sharing, distress-triggered surfacing, diagnosis, worth scoring, invented
meaning, and mandatory model orchestration are outside the implemented scope.

Do not attach a real exported backup to an issue or pull request. Local backups
are plaintext and may contain original image bytes and EXIF metadata.

## Synthetic fixture style

Use explicit labels such as “Synthetic reviewer,” “Example Project,” and
“Synthetic test fixture.” Do not borrow a real person's name, pet, employer,
receipt, award, or message even if it seems harmless.

## Review priorities

Privacy and source fidelity outrank convenience. RLS, grants, Storage policies,
auth, search scope, and deletion changes require focused tests and owner-boundary
review.
