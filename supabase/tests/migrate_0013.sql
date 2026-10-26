-- Tests for the backfill of 0013_brands on makers that predate it and for its re-run. Makers are inserted with the
-- after-insert trigger of 0013 switched off for the transaction (the migrations ran before this file, so the trigger
-- exists already — switching it off is the only way to stage rows "from before 0013" without removing anything):
-- a store, a hand-added maker, a second store of the first one's name and a maker whose name is too long for a brand.
-- The migration file itself is applied again with \ir, then once more to prove that a re-run changes nothing.
-- LOCAL ONLY (psql): \ir is a psql command, so this file does not run through the Supabase MCP's execute_sql; on the
-- live project 0013 is checked with the queries in tools/deploy.md §2.1. The behaviour of 0013 (the grants, the
-- policies, the guards, the trigger, the two lookups) is in rls_brands.sql (live-safe).
-- Runs in one transaction and rolls back; prints NOTICE 'migrate_0013: ok' only if every case passed.
-- As the runner (postgres, no auth.uid()): the trusted server and the migrations both write this way.
-- No statement here removes rows or objects.

begin;
-- the re-runs print "relation … already exists, skipping"
set local client_min_messages = warning;
set local request.jwt.claims = '';

-- ---------------------------------------------------------------- the state before 0013

alter table public.vendors disable trigger vendors_brand_after_insert;

-- e3 / e5 stores as the sync wrote them (e5 named like e3, lower / btrim, inserted later), e4 a hand-added maker without
-- a joining date, e6 a maker whose name cannot be a brand name (81 characters).
insert into public.vendors (id, woo_vendor_id, name, aliases, created_at, joined_at, raw) values
  ('00000000-0000-4000-8000-0000000000e3', 9931, 'متجر قبل البراندات',  '{"قبل"}', '2026-10-20T12:00:00Z', '2025-07-01', '{"id":9931,"store_name":"متجر قبل البراندات"}'),
  ('00000000-0000-4000-8000-0000000000e4', null, 'Pre Brands Maker',    '{}',      '2026-10-21T12:00:00Z', null,         null),
  ('00000000-0000-4000-8000-0000000000e5', 9932, 'متجر قبل البراندات ', '{}',      '2026-10-22T12:00:00Z', '2025-08-01', '{"id":9932,"store_name":"متجر قبل البراندات"}'),
  ('00000000-0000-4000-8000-0000000000e6', null, repeat('x', 81),       '{}',      '2026-10-23T12:00:00Z', null,         null);

alter table public.vendors enable trigger vendors_brand_after_insert;

do $$ begin
  if exists (select 1 from public.brands where origin_vendor_id in ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000e4',
                                                                   '00000000-0000-4000-8000-0000000000e5', '00000000-0000-4000-8000-0000000000e6')) then
    raise exception 'case the staged makers have no brand before the re-run failed';
  end if;
  perform set_config('migrate_0013.activity', (select count(*)::text from public.activity_log), true);
end $$;

-- ---------------------------------------------------------------- 0013 on that state

\ir ../migrations/0013_brands.sql

do $$ begin
  -- the backfill: e3 (a store) → a brand tied to the store, code X, the maker's aliases, owner since joined_at;
  -- e4 (hand-added) → a brand without a store, code P, owner since today; e5 (taken name) and e6 (too long) → none
  if not ((select string_agg(b.origin_vendor_id::text || '=' || b.name || '/' || b.code || '/' || array_to_string(b.aliases, '|') || '/' || coalesce(b.store_vendor_id::text, '∅') || '/' || coalesce(b.created_by, '∅')
                             || '/' || o.vendor_id::text || '/' || case when o.since = current_date then 'today' else o.since::text end || '/' || coalesce(o.set_by, '∅'), ',' order by b.origin_vendor_id)
           from public.brands b join public.brand_owners o on o.brand_id = b.id
           where b.origin_vendor_id in ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000e4',
                                        '00000000-0000-4000-8000-0000000000e5', '00000000-0000-4000-8000-0000000000e6'))
          = '00000000-0000-4000-8000-0000000000e3=متجر قبل البراندات/X/قبل/00000000-0000-4000-8000-0000000000e3/system/00000000-0000-4000-8000-0000000000e3/2025-07-01/system,'
            || '00000000-0000-4000-8000-0000000000e4=Pre Brands Maker/P//∅/system/00000000-0000-4000-8000-0000000000e4/today/system') then
    raise exception 'case the backfill makes the brands of the staged makers (store tied, hand-added free, taken / long names skipped) failed: %',
      coalesce((select string_agg(b.origin_vendor_id::text || '=' || b.name || '/' || b.code || '/' || coalesce(b.store_vendor_id::text, '∅'), ',' order by b.origin_vendor_id)
                from public.brands b where b.origin_vendor_id in ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000e4',
                                                                   '00000000-0000-4000-8000-0000000000e5', '00000000-0000-4000-8000-0000000000e6')), '<none>');
  end if;
  if not ((select count(*) from public.brand_owners o join public.brands b on b.id = o.brand_id
           where b.origin_vendor_id in ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000e4')) = 2
          and public.store_owner_at('00000000-0000-4000-8000-0000000000e3', current_date) = '00000000-0000-4000-8000-0000000000e3'
          and public.store_owner_at('00000000-0000-4000-8000-0000000000e5', current_date) = '00000000-0000-4000-8000-0000000000e5') then
    raise exception 'case one owner row per backfilled brand; the untied store is its own owner failed';
  end if;
  -- the tables, the policies, the triggers, the functions exist
  if not (to_regclass('public.brands') is not null and to_regclass('public.brand_owners') is not null and to_regclass('public.brand_rates') is not null
          and (select count(*) from pg_policies where schemaname = 'public' and tablename in ('brands', 'brand_owners', 'brand_rates')) = 7
          and (select string_agg(t.tgname, ',' order by t.tgname) from pg_trigger t join pg_class c on c.oid = t.tgrelid
               where not t.tgisinternal and c.relname in ('vendors', 'brands', 'brand_owners') and t.tgname in ('brands_guard', 'brand_owners_guard', 'vendors_brand_after_insert', 'vendors_brands_guard_delete'))
              = 'brand_owners_guard,brands_guard,vendors_brand_after_insert,vendors_brands_guard_delete'
          and to_regprocedure('public.brand_owner_at(uuid, date)') is not null
          and to_regprocedure('public.store_owner_at(uuid, date)') is not null
          and to_regprocedure('public.vendor_brand_auto(uuid)') is not null) then
    raise exception 'case brands / brand_owners / brand_rates, the seven policies, the four triggers and the three functions exist failed';
  end if;
  -- the re-run wrote no activity (the migration logs nothing)
  if not ((select count(*) from public.activity_log)::text = current_setting('migrate_0013.activity')) then
    raise exception 'case the re-run leaves activity_log as it was failed';
  end if;
end $$;

-- ---------------------------------------------------------------- a re-run changes nothing

do $$ begin
  perform set_config('migrate_0013.before', concat_ws('|',
    (select string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '∅'), ',' order by table_name, ordinal_position)
     from information_schema.columns where table_schema = 'public' and table_name in ('brands', 'brand_owners', 'brand_rates')),
    (select string_agg(tablename || '.' || policyname || ':' || cmd || ':' || array_to_string(roles, '|') || ':' || coalesce(qual, '∅') || ':' || coalesce(with_check, '∅'), ',' order by tablename, policyname)
     from pg_policies where schemaname = 'public' and tablename in ('brands', 'brand_owners', 'brand_rates')),
    (select string_agg(table_name || '.' || column_name || ':' || grantee || ':' || privilege_type, ',' order by table_name, column_name, grantee, privilege_type)
     from information_schema.column_privileges where table_schema = 'public' and table_name in ('brands', 'brand_owners', 'brand_rates')),
    (select string_agg(table_name || ':' || grantee || ':' || privilege_type, ',' order by table_name, grantee, privilege_type)
     from information_schema.role_table_grants where table_schema = 'public' and table_name in ('brands', 'brand_owners', 'brand_rates')),
    (select string_agg(t.tgname || ':' || c.relname || ':' || t.tgenabled::text || ':' || t.tgtype::text, ',' order by t.tgname)
     from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and c.relname in ('vendors', 'brands', 'brand_owners', 'brand_rates')),
    (select string_agg(proname || ':' || md5(pg_get_functiondef(oid)) || ':' || prosecdef::text || ':' || coalesce(array_to_string(proacl, ';'), '∅') || ':' || coalesce(array_to_string(proconfig, ';'), '∅'), ',' order by proname)
     from pg_proc where pronamespace = 'public'::regnamespace
       and proname in ('brands_guard', 'brand_owners_guard', 'vendors_brand_after_insert', 'vendors_brands_guard_delete', 'vendor_brand_auto', 'brand_owner_at', 'store_owner_at')),
    (select string_agg(conname || ':' || oid::text || ':' || pg_get_constraintdef(oid), ',' order by conname)
     from pg_constraint where conrelid in ('public.brands'::regclass, 'public.brand_owners'::regclass, 'public.brand_rates'::regclass)),
    (select string_agg(indexname || ':' || indexdef, ',' order by indexname) from pg_indexes where schemaname = 'public' and tablename in ('brands', 'brand_owners', 'brand_rates')),
    (select string_agg(relname || ':' || relrowsecurity::text, ',' order by relname) from pg_class where oid in ('public.brands'::regclass, 'public.brand_owners'::regclass, 'public.brand_rates'::regclass)),
    (select count(*) from public.activity_log),
    (select count(*) from public.vendors), (select count(*) from public.brands), (select count(*) from public.brand_owners), (select count(*) from public.brand_rates),
    (select string_agg(id::text || '/' || updated_at::text, ',' order by id) from public.brands)), true);
end $$;

\ir ../migrations/0013_brands.sql

do $$ begin
  if not (current_setting('migrate_0013.before')
          = concat_ws('|',
              (select string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '∅'), ',' order by table_name, ordinal_position)
               from information_schema.columns where table_schema = 'public' and table_name in ('brands', 'brand_owners', 'brand_rates')),
              (select string_agg(tablename || '.' || policyname || ':' || cmd || ':' || array_to_string(roles, '|') || ':' || coalesce(qual, '∅') || ':' || coalesce(with_check, '∅'), ',' order by tablename, policyname)
               from pg_policies where schemaname = 'public' and tablename in ('brands', 'brand_owners', 'brand_rates')),
              (select string_agg(table_name || '.' || column_name || ':' || grantee || ':' || privilege_type, ',' order by table_name, column_name, grantee, privilege_type)
               from information_schema.column_privileges where table_schema = 'public' and table_name in ('brands', 'brand_owners', 'brand_rates')),
              (select string_agg(table_name || ':' || grantee || ':' || privilege_type, ',' order by table_name, grantee, privilege_type)
               from information_schema.role_table_grants where table_schema = 'public' and table_name in ('brands', 'brand_owners', 'brand_rates')),
              (select string_agg(t.tgname || ':' || c.relname || ':' || t.tgenabled::text || ':' || t.tgtype::text, ',' order by t.tgname)
               from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and c.relname in ('vendors', 'brands', 'brand_owners', 'brand_rates')),
              (select string_agg(proname || ':' || md5(pg_get_functiondef(oid)) || ':' || prosecdef::text || ':' || coalesce(array_to_string(proacl, ';'), '∅') || ':' || coalesce(array_to_string(proconfig, ';'), '∅'), ',' order by proname)
               from pg_proc where pronamespace = 'public'::regnamespace
                 and proname in ('brands_guard', 'brand_owners_guard', 'vendors_brand_after_insert', 'vendors_brands_guard_delete', 'vendor_brand_auto', 'brand_owner_at', 'store_owner_at')),
              (select string_agg(conname || ':' || oid::text || ':' || pg_get_constraintdef(oid), ',' order by conname)
               from pg_constraint where conrelid in ('public.brands'::regclass, 'public.brand_owners'::regclass, 'public.brand_rates'::regclass)),
              (select string_agg(indexname || ':' || indexdef, ',' order by indexname) from pg_indexes where schemaname = 'public' and tablename in ('brands', 'brand_owners', 'brand_rates')),
              (select string_agg(relname || ':' || relrowsecurity::text, ',' order by relname) from pg_class where oid in ('public.brands'::regclass, 'public.brand_owners'::regclass, 'public.brand_rates'::regclass)),
              (select count(*) from public.activity_log),
              (select count(*) from public.vendors), (select count(*) from public.brands), (select count(*) from public.brand_owners), (select count(*) from public.brand_rates),
              (select string_agg(id::text || '/' || updated_at::text, ',' order by id) from public.brands))) then
    raise exception 'case 0013 applied a second time changes nothing (rows, columns, policies, grants, triggers, functions, constraints incl. oids, indexes, RLS, activity_log) failed';
  end if;
  if not ((select count(*) from pg_policies where schemaname = 'public' and tablename in ('brands', 'brand_owners', 'brand_rates')) = 7
          and (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
               where not t.tgisinternal and t.tgname in ('brands_guard', 'brand_owners_guard', 'vendors_brand_after_insert', 'vendors_brands_guard_delete')) = 4
          and (select count(*) from pg_indexes where schemaname = 'public' and tablename = 'brands' and indexname = 'brands_name_key') = 1
          and (select count(*) from public.brands where origin_vendor_id in ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000e4',
                                                                           '00000000-0000-4000-8000-0000000000e5', '00000000-0000-4000-8000-0000000000e6')) = 2) then
    raise exception 'case the policies, the triggers, the index and the two backfilled brands of 0013 exist once after three runs failed';
  end if;
end $$;

rollback;

do $$ begin raise notice 'migrate_0013: ok'; end $$;
