-- Proof Gallery: a standalone, owner-private evidence collection.
-- The table is intentionally separate from notes, memories, and chat history.

create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create function public.proof_tags_valid(values_to_check text[])
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select not exists (
    select 1
    from unnest(values_to_check) as tag
    where tag is null
       or length(tag) not between 1 and 80
       or tag <> lower(btrim(tag))
       or tag like '#%'
  );
$$;

revoke all on function public.proof_tags_valid(text[])
  from public, anon, authenticated;
grant execute on function public.proof_tags_valid(text[])
  to authenticated;

create table public.proof_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  evidence_text text not null,
  occurred_on date,
  category text not null check (category in (
    'belonging',
    'competence',
    'creativity',
    'parenting',
    'recovery',
    'money',
    'shipped',
    'awards',
    'kindness_received'
  )),
  source text,
  provenance jsonb not null default '{}'::jsonb,
  tags text[] not null default '{}'::text[],
  person text,
  project text,
  image_path text,
  visibility text not null default 'personal' check (visibility = 'personal'),
  embedding extensions.vector,
  embedding_model text,
  embedding_dimensions integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint proof_items_title_length
    check (length(btrim(title)) between 1 and 200),
  constraint proof_items_evidence_length
    check (length(btrim(evidence_text)) between 1 and 20000),
  constraint proof_items_source_length
    check (source is null or length(btrim(source)) between 1 and 500),
  constraint proof_items_person_length
    check (person is null or length(btrim(person)) between 1 and 200),
  constraint proof_items_project_length
    check (project is null or length(btrim(project)) between 1 and 200),
  constraint proof_items_provenance_object
    check (jsonb_typeof(provenance) = 'object'),
  constraint proof_items_tags_valid check (
    cardinality(tags) <= 30
    and (cardinality(tags) = 0 or array_ndims(tags) = 1)
    and public.proof_tags_valid(tags)
  ),
  constraint proof_items_image_owner_path check (
    image_path is null or split_part(image_path, '/', 1) = user_id::text
  ),
  constraint proof_items_embedding_receipt check (
    (embedding is null and embedding_model is null and embedding_dimensions is null)
    or (
      embedding is not null
      and embedding_model is not null
      and embedding_dimensions is not null
      and length(btrim(embedding_model)) between 1 and 200
      and embedding_dimensions between 1 and 4096
      and extensions.vector_dims(embedding) = embedding_dimensions
      and extensions.vector_norm(embedding) > 0.000001
    )
  )
);

create index proof_items_owner_newest_idx
  on public.proof_items (user_id, occurred_on desc nulls last, created_at desc);
create index proof_items_owner_category_idx
  on public.proof_items (user_id, category);
create index proof_items_tags_idx on public.proof_items using gin (tags);
create unique index proof_items_unique_image_path_idx
  on public.proof_items (image_path) where image_path is not null;

alter table public.proof_items enable row level security;
alter table public.proof_items force row level security;

create policy proof_items_select_own
  on public.proof_items for select to authenticated
  using (auth.uid() = user_id and visibility = 'personal');

create policy proof_items_insert_own
  on public.proof_items for insert to authenticated
  with check (auth.uid() = user_id and visibility = 'personal');

create policy proof_items_update_own
  on public.proof_items for update to authenticated
  using (auth.uid() = user_id and visibility = 'personal')
  with check (auth.uid() = user_id and visibility = 'personal');

create policy proof_items_delete_own
  on public.proof_items for delete to authenticated
  using (auth.uid() = user_id and visibility = 'personal');

revoke all on table public.proof_items from public, anon, authenticated;
grant select, insert, update, delete on table public.proof_items to authenticated;

create function public.proof_items_set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.proof_items_set_updated_at()
  from public, anon, authenticated;

create trigger proof_items_updated_at
  before update on public.proof_items
  for each row execute function public.proof_items_set_updated_at();

create function public.proof_items_invalidate_embedding()
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
    new.project
  ) is distinct from row(
    old.title,
    old.evidence_text,
    old.category,
    old.source,
    old.tags,
    old.person,
    old.project
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

create trigger proof_items_embedding_invalidation
  before update on public.proof_items
  for each row execute function public.proof_items_invalidate_embedding();

-- Proof-only semantic retrieval. RLS still applies because this is an invoker
-- function and the caller's JWT is used by the Edge Function.
create function public.match_proof_items(
  query_embedding extensions.vector,
  query_model text,
  query_dimensions integer,
  match_threshold double precision default 0.20,
  match_count integer default 6,
  match_category text default null,
  match_tags text[] default null
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
  similarity double precision
)
language sql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
  with candidates as materialized (
    select item.*
    from public.proof_items as item
    where auth.uid() is not null
      and item.user_id = auth.uid()
      and item.visibility = 'personal'
      and item.embedding is not null
      and item.embedding_model = query_model
      and item.embedding_dimensions = query_dimensions
      and extensions.vector_dims(item.embedding) = query_dimensions
      and extensions.vector_dims(query_embedding) = query_dimensions
      and extensions.vector_norm(item.embedding) > 0.000001
      and extensions.vector_norm(query_embedding) > 0.000001
      and (match_category is null or item.category = match_category)
      and (
        match_tags is null
        or cardinality(match_tags) = 0
        or item.tags @> match_tags
      )
  )
  select
    item.id,
    item.user_id,
    item.title,
    item.evidence_text,
    item.occurred_on,
    item.category,
    item.source,
    item.provenance,
    item.tags,
    item.person,
    item.project,
    item.image_path,
    item.visibility,
    item.created_at,
    item.updated_at,
    (1 - (item.embedding <=> query_embedding))::double precision
  from candidates as item
  where 1 - (item.embedding <=> query_embedding) >= match_threshold
  order by
    item.embedding <=> query_embedding,
    item.occurred_on desc nulls last,
    item.created_at desc
  limit least(greatest(match_count, 3), 10);
$$;

-- Deterministic full-text/trigram retrieval works with no external model key.
create function public.search_proof_items(
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

revoke all on function public.match_proof_items(
  extensions.vector, text, integer, double precision, integer, text, text[]
) from public, anon;
revoke all on function public.search_proof_items(
  text, integer, text, text[]
) from public, anon;

grant execute on function public.match_proof_items(
  extensions.vector, text, integer, double precision, integer, text, text[]
) to authenticated;
grant execute on function public.search_proof_items(
  text, integer, text, text[]
) to authenticated;

comment on table public.proof_items is
  'Owner-private evidence. Never part of ambient memory or automatic collection.';

-- Distributed owner-scoped budget guard for optional embedding calls. Lexical
-- retrieval remains available after the limit; no evidence text is stored here.
create table public.proof_embedding_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0)
);

alter table public.proof_embedding_limits enable row level security;
alter table public.proof_embedding_limits force row level security;
revoke all on table public.proof_embedding_limits
  from public, anon, authenticated;

create function public.claim_proof_embedding_slot()
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
  allowed boolean;
begin
  if caller_id is null then
    return false;
  end if;

  insert into public.proof_embedding_limits (
    user_id,
    window_started_at,
    request_count
  ) values (
    caller_id,
    now(),
    1
  )
  on conflict (user_id) do update set
    window_started_at = case
      when proof_embedding_limits.window_started_at <= now() - interval '1 minute'
        then now()
      else proof_embedding_limits.window_started_at
    end,
    request_count = case
      when proof_embedding_limits.window_started_at <= now() - interval '1 minute'
        then 1
      else proof_embedding_limits.request_count + 1
    end
  returning request_count <= 20 into allowed;

  return allowed;
end;
$$;

revoke all on function public.claim_proof_embedding_slot()
  from public, anon;
grant execute on function public.claim_proof_embedding_slot()
  to authenticated;

-- A dedicated private bucket keeps Proof images out of generic/public media.
do $$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
  ) then
    raise exception
      'Proof Gallery requires a dedicated Supabase project with no pre-existing Storage object policies';
  end if;
end;
$$;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
  'proof-images',
  'proof-images',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
);

create policy proof_images_select_own
  on storage.objects for select to authenticated
  using (
    bucket_id = 'proof-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy proof_images_insert_own
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'proof-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy proof_images_update_own
  on storage.objects for update to authenticated
  using (
    bucket_id = 'proof-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'proof-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy proof_images_delete_own
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'proof-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
