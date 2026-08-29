# Security policy

Please do not report a vulnerability in a public issue or discussion.

Use **Security → Report a vulnerability** in this GitHub repository. Include a
minimal synthetic reproduction, affected commit, impact, and suggested fix when
known. Never include real evidence, images, credentials, JWTs, signed URLs,
project identifiers, or production database output.

Security-sensitive areas include authentication, RLS, grants, private Storage,
signed URLs, attachment deletion, Edge Function JWT handling, embedding-provider
boundaries, and Proof-only retrieval.

Supported version: the latest commit on `main`. Maintainers will acknowledge a
private report before discussing disclosure timing.
