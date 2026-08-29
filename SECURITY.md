# Security policy

Please do not report a vulnerability in a public issue or discussion.

Use **Security → Report a vulnerability** in this GitHub repository. Include a
minimal synthetic reproduction, affected commit, impact, and suggested fix when
known. Never include real evidence, images, credentials, JWTs, signed URLs,
project identifiers, or production database output.

Security-sensitive areas include local IndexedDB access, backup import/export
validation, image/blob URL lifetimes, local-data clearing, origin isolation,
authentication, RLS, grants, private Storage, signed URLs, attachment deletion,
Edge Function JWT handling, embedding-provider boundaries, and Proof-only
retrieval.

Browser-local mode is deliberately unauthenticated and is not encrypted by
Proof Gallery. Its trust boundary is the browser profile, device, and exact web
origin—not an owner account or URL path. Exported versioned JSON backups are
plaintext. Clearing the local database cannot remove downloaded backups or
original source files and is not a secure-erasure guarantee.

Use a dedicated hostname for local evidence. GitHub Pages project paths under
the same `*.github.io` site share an origin and therefore share browser-storage
access. Do not add analytics, third-party scripts, background collection, Drive
or Dropbox connectors, or silent synchronization without a separate privacy and
security design review.

Supported version: the latest commit on `main`. Maintainers will acknowledge a
private report before discussing disclosure timing.
