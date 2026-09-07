# Local assistant access (in development)

The native companion, not the browser database or an assistant process, owns
the local vault. A separate owner-issued assistant grant permits saved-Proof
reads from that collection. It is not a Photos, pending-review, write, approval,
browser-gallery or source-management grant. Installation grants nothing.

The stdio helper has only `proof_search` and `proof_get`. Search returns up to
3–10 saved items with explicit matching mode and literal notes/date/source.
This first text interface does not fetch attachments. A separately authorized
media path must be implemented and verified before advertising media delivery.
The helper never opens the database or Photos and cannot mint or broaden grants.
It uses fixed IPv4 loopback endpoints with an explicit token, not arbitrary URLs.
Connection expiry/revocation is enforced by the running companion on every read.

The separate `/v2` vault bridge accepts only the production gallery's exact
Origin for gallery routes, and no browser Origin for assistant routes. Tokens
are revalidated for the correct client kind and scope before reads or writes;
mutations remain in the same authority lock as authorization. There are no
network routes to manage source grants, clients, reminders or clearing. Input,
connections, request rate, compute and response sizes are bounded. The legacy
five-minute `/v1` transfer is unchanged.

Semantic ranking reuses the companion's on-device English embedding path for
the newest 100 saved items after category/tag filtering. Responses explicitly
identify that search window and literal-text fallback when unavailable. Ranking
text is bounded internally; displayed notes and provenance remain whole. After
ranking, permissions and record revisions are rechecked. Pending records and
ordinary memories never enter assistant search. Full-collection non-search
browsing remains paginated; this is not full-history semantic indexing.

The protocol core supports MCP **2025-11-25** initialization and ready state,
newline-framed UTF-8 JSON-RPC, read-only tool schemas and bounded request/response
sizes. It negotiates its supported version instead of claiming future protocol
support. Notifications cannot trigger retrieval. Errors do not echo raw
transport errors, credentials, queries or filesystem paths. Original evidence
is returned as data, never evaluated as instructions or rewritten into meaning.

The `ProofMCP` executable takes only `PROOF_MCP_PORT` and `PROOF_MCP_TOKEN`
from its explicit launch environment. It does not edit assistant configuration
or store the token. Its ephemeral HTTP client refuses redirects, cookies,
proxies and caches, accepts only fixed loopback routes, bounds responses to
256 KiB, and limits each read to ten seconds. Standard output contains only
newline-framed MCP responses; generic setup errors go to standard error.

This helper alone is not an installed MCP integration, running vault,
signed helper or a working closed-app collector. The native grant UI, transport,
packaging, actual-client tests and explicit connection consent must all pass
before the product claims the connection is ready. Connecting a cloud-backed
assistant can disclose requested evidence to that assistant/provider; the owner
must see that distinction when granting access. No automatic assistant setup.

References: [MCP stdio transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports),
[lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle),
[tool results](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).
