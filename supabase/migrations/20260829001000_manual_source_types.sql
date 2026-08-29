-- Manual provenance source types remain metadata, but are constrained so
-- indexing, display, and deterministic search share one vocabulary.

alter table public.proof_items
  add constraint proof_items_source_type_valid check (
    not (provenance ? 'source_type')
    or (
      jsonb_typeof(provenance -> 'source_type') = 'string'
      and provenance ->> 'source_type' in (
        'email',
        'message',
        'photo',
        'receipt',
        'award',
        'work',
        'memory',
        'conversation',
        'document',
        'web',
        'other'
      )
    )
  );

create or replace function public.proof_items_invalidate_embedding()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if row(
    new.title,
    new.evidence_text,
    new.category,
    new.source,
    new.tags,
    new.person,
    new.project,
    new.provenance ->> 'source_type'
  ) is distinct from row(
    old.title,
    old.evidence_text,
    old.category,
    old.source,
    old.tags,
    old.person,
    old.project,
    old.provenance ->> 'source_type'
  ) then
    new.embedding := null;
    new.embedding_model := null;
    new.embedding_dimensions := null;
  end if;
  return new;
end;
$$;

revoke all on function public.proof_items_invalidate_embedding()
  from public, anon, authenticated;

create or replace function public.search_proof_items(
  p_query text,
  p_limit integer default 6,
  p_category text default null,
  p_tags text[] default null
)
returns table (
  id uuid,
  user_id uuid,
  title text,
  evidence_text text,
  occurred_on date,
  category text,
  source text,
  provenance jsonb,
  tags text[],
  person text,
  project text,
  image_path text,
  visibility text,
  created_at timestamptz,
  updated_at timestamptz,
  relevance double precision
)
language plpgsql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  query_tokens tsquery;
begin
  if p_query is null or length(btrim(p_query)) < 3 or length(p_query) > 2000 then
    raise exception 'proof search query must be 3-2000 characters'
      using errcode = '22023';
  end if;

  query_tokens := websearch_to_tsquery('english', p_query);

  return query
  with candidates as (
    select
      item.*,
      concat_ws(
        ' ',
        item.title,
        item.evidence_text,
        item.category,
        item.source,
        item.provenance ->> 'source_type',
        array_to_string(item.tags, ' '),
        item.person,
        item.project
      ) as search_text
    from public.proof_items as item
    where auth.uid() is not null
      and item.user_id = auth.uid()
      and item.visibility = 'personal'
      and (p_category is null or item.category = p_category)
      and (
        p_tags is null
        or cardinality(p_tags) = 0
        or item.tags @> p_tags
      )
  ), ranked as (
    select
      candidate.*,
      greatest(
        ts_rank(
          to_tsvector('english', candidate.search_text),
          query_tokens
        )::double precision,
        extensions.similarity(candidate.search_text, p_query)::double precision
      ) as score
    from candidates as candidate
    where to_tsvector('english', candidate.search_text) @@ query_tokens
       or extensions.similarity(candidate.search_text, p_query) > 0.08
  )
  select
    ranked.id,
    ranked.user_id,
    ranked.title,
    ranked.evidence_text,
    ranked.occurred_on,
    ranked.category,
    ranked.source,
    ranked.provenance,
    ranked.tags,
    ranked.person,
    ranked.project,
    ranked.image_path,
    ranked.visibility,
    ranked.created_at,
    ranked.updated_at,
    ranked.score
  from ranked
  order by ranked.score desc, ranked.occurred_on desc nulls last,
    ranked.created_at desc
  limit least(greatest(p_limit, 3), 10);
end;
$$;

revoke all on function public.search_proof_items(
  text, integer, text, text[]
) from public, anon;
grant execute on function public.search_proof_items(
  text, integer, text, text[]
) to authenticated;
