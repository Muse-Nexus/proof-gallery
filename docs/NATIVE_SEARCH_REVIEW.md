# Native search review corrections

The native gallery/assistant ranker uses owner-visible title, literal note,
person, project, source label and chosen tags. Original media filenames are
provenance only: they are excluded from both the semantic ranking input and its
literal fallback. The full original filename, media digest and provider receipt
remain unchanged in the returned record. Search does not infer meaning from them.

The native service passes its validated requested result limit to the on-device
ranker, including requests for seven through ten results. The internal ranker
argument accepts 1–10 and defaults to six for existing callers. Native public
search still validates its existing 3–10 bounds. This does not add a field to the
legacy v1 EvidenceRequest or EvidenceResponse schema, change source scope, or
expand the newest-100 native search window. Unavailable embeddings still use the
existing explicitly labeled literal fallback.

`VaultSearchReviewTests` covers filename exclusion with receipt retention,
deterministic invalid-limit rejection, and six/default versus seven/ten results
when the local English embedding is available, including the native assistant
service path. It uses only synthetic text/media;
the semantic count check skips when that on-device embedding is unavailable.
