\set ON_ERROR_STOP on

do $$
declare
  proof_policy_count integer;
  storage_policy_count integer;
  table_rls boolean;
  table_force_rls boolean;
  limit_rls boolean;
  limit_force_rls boolean;
begin
  select relrowsecurity, relforcerowsecurity
    into table_rls, table_force_rls
  from pg_class
  where oid = 'public.proof_items'::regclass;

  if table_rls is not true or table_force_rls is not true then
    raise exception 'proof_items must have enabled and forced RLS';
  end if;

  select relrowsecurity, relforcerowsecurity
    into limit_rls, limit_force_rls
  from pg_class
  where oid = 'public.proof_embedding_limits'::regclass;

  if limit_rls is not true or limit_force_rls is not true then
    raise exception 'proof_embedding_limits must have enabled and forced RLS';
  end if;

  select count(*) into proof_policy_count
  from pg_policies
  where schemaname = 'public' and tablename = 'proof_items';

  if proof_policy_count <> 4 then
    raise exception 'expected exactly four proof_items policies, got %',
      proof_policy_count;
  end if;

  select count(*) into storage_policy_count
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and policyname like 'proof_images_%_own';

  if storage_policy_count <> 4 then
    raise exception 'expected exactly four Proof image policies, got %',
      storage_policy_count;
  end if;

  if not has_table_privilege('authenticated', 'public.proof_items', 'SELECT')
    or not has_table_privilege('authenticated', 'public.proof_items', 'INSERT')
    or not has_table_privilege('authenticated', 'public.proof_items', 'UPDATE')
    or not has_table_privilege('authenticated', 'public.proof_items', 'DELETE')
  then
    raise exception 'authenticated must have Proof CRUD grants';
  end if;

  if has_table_privilege('authenticated', 'public.proof_items', 'TRUNCATE')
    or has_table_privilege('authenticated', 'public.proof_items', 'TRIGGER')
    or has_table_privilege('authenticated', 'public.proof_items', 'REFERENCES')
    or has_table_privilege('anon', 'public.proof_items', 'SELECT')
    or has_table_privilege(
      'authenticated',
      'public.proof_embedding_limits',
      'SELECT'
    )
  then
    raise exception 'Proof grants are broader than the documented contract';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.search_proof_items(text,integer,text,text[])',
    'EXECUTE'
  ) or has_function_privilege(
    'anon',
    'public.search_proof_items(text,integer,text,text[])',
    'EXECUTE'
  ) then
    raise exception 'lexical search execute grants are incorrect';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.match_proof_items(extensions.vector,text,integer,double precision,integer,text,text[])',
    'EXECUTE'
  ) or has_function_privilege(
    'anon',
    'public.match_proof_items(extensions.vector,text,integer,double precision,integer,text,text[])',
    'EXECUTE'
  ) then
    raise exception 'semantic search execute grants are incorrect';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.claim_proof_embedding_slot()',
    'EXECUTE'
  ) or has_function_privilege(
    'anon',
    'public.claim_proof_embedding_slot()',
    'EXECUTE'
  ) then
    raise exception 'embedding budget execute grants are incorrect';
  end if;

  if not exists (
    select 1
    from storage.buckets
    where id = 'proof-images'
      and public is false
      and file_size_limit = 10485760
      and allowed_mime_types =
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  ) then
    raise exception 'proof-images bucket contract is incorrect';
  end if;
end
$$;
