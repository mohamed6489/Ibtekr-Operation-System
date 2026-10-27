-- Tests for the re-run of 0014_vendor_sync on a database that already carries it: a store row "from before 0014"
-- (the phase-3.3 columns null, as the live rows are until the first `vendors` run fills them) stays untouched —
-- 0014 has no backfill, by decision: the values live on the site, not in raw — and the migration file applied again
-- with \ir, then once more, changes nothing (columns, grants, policies, constraints incl. oids, indexes, the guard
-- function, triggers, RLS, row counts, activity_log).
-- LOCAL ONLY (psql): \ir is a psql command, so this file does not run through the Supabase MCP's execute_sql; on the
-- live project 0014 is checked with the queries in tools/deploy.md §2.1. The behaviour of 0014 (the grants, the
-- policies, the widened guard, the two tables) is in rls_vendor_sync.sql (live-safe).
-- Runs in one transaction and rolls back; prints NOTICE 'migrate_0014: ok' only if every case passed.
-- As the runner (postgres, no auth.uid()): the trusted server and the migrations both write this way.
-- No statement here removes rows or objects.

begin;
-- the re-runs print "relation … already exists, skipping"
set local client_min_messages = warning;
set local request.jwt.claims = '';

-- ---------------------------------------------------------------- a store as the phase-3 sync left it (nothing of 3.3)

insert into public.vendors (id, woo_vendor_id, name, phone, status, raw, joined_at, address, instagram) values
  ('00000000-0000-4000-8000-0000000000e7', 9951, 'متجر قبل المزامنة', '01000009951', 'active',
   '{"id":9951,"store_name":"متجر قبل المزامنة","enabled":true}', '2025-04-01', 'عنوان قديم بالنص', 'old.handle');

insert into public.vendor_rates (vendor_id, rate, since, set_by) values ('00000000-0000-4000-8000-0000000000e7', 30, '2026-10-01', 'الفريق');

do $$ begin
  perform set_config('migrate_0014.activity', (select count(*)::text from public.activity_log), true);
  perform set_config('migrate_0014.fingerprint', concat_ws('|',
    (select string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '∅'), ',' order by table_name, ordinal_position)
     from information_schema.columns where table_schema = 'public' and table_name in ('vendors', 'vendor_rates', 'vendor_category_rates', 'woo_categories')),
    (select string_agg(tablename || '.' || policyname || ':' || cmd || ':' || array_to_string(roles, '|') || ':' || coalesce(qual, '∅') || ':' || coalesce(with_check, '∅'), ',' order by tablename, policyname)
     from pg_policies where schemaname = 'public' and tablename in ('vendors', 'vendor_rates', 'vendor_category_rates', 'woo_categories')),
    (select string_agg(table_name || '.' || column_name || ':' || grantee || ':' || privilege_type, ',' order by table_name, column_name, grantee, privilege_type)
     from information_schema.column_privileges where table_schema = 'public' and table_name in ('vendors', 'vendor_rates', 'vendor_category_rates', 'woo_categories')),
    (select string_agg(table_name || ':' || grantee || ':' || privilege_type, ',' order by table_name, grantee, privilege_type)
     from information_schema.role_table_grants where table_schema = 'public' and table_name in ('vendors', 'vendor_rates', 'vendor_category_rates', 'woo_categories')),
    (select string_agg(t.tgname || ':' || c.relname || ':' || t.tgenabled::text || ':' || t.tgtype::text || ':' || t.tgfoid::text, ',' order by t.tgname)
     from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and c.relname in ('vendors', 'vendor_rates', 'vendor_category_rates', 'woo_categories')),
    (select string_agg(proname || ':' || oid::text || ':' || md5(pg_get_functiondef(oid)) || ':' || prosecdef::text || ':' || coalesce(array_to_string(proacl, ';'), '∅') || ':' || coalesce(array_to_string(proconfig, ';'), '∅'), ',' order by proname)
     from pg_proc where pronamespace = 'public'::regnamespace and proname in ('vendors_guard_update', 'vendor_rates_apply')),
    (select string_agg(conname || ':' || oid::text || ':' || pg_get_constraintdef(oid), ',' order by conname)
     from pg_constraint where conrelid in ('public.vendors'::regclass, 'public.vendor_rates'::regclass, 'public.vendor_category_rates'::regclass, 'public.woo_categories'::regclass)),
    (select string_agg(indexname || ':' || indexdef, ',' order by indexname) from pg_indexes where schemaname = 'public' and tablename in ('vendors', 'vendor_rates', 'vendor_category_rates', 'woo_categories')),
    (select string_agg(relname || ':' || relrowsecurity::text, ',' order by relname) from pg_class where oid in ('public.vendors'::regclass, 'public.vendor_rates'::regclass, 'public.vendor_category_rates'::regclass, 'public.woo_categories'::regclass)),
    (select string_agg(s.sequencename || ':' || coalesce(s.last_value::text, '∅'), ',' order by s.sequencename) from pg_sequences s where s.schemaname = 'public' and s.sequencename in ('vendor_rates_id_seq', 'vendor_category_rates_id_seq')),
    (select count(*) from public.vendors), (select count(*) from public.vendor_rates), (select count(*) from public.vendor_category_rates), (select count(*) from public.woo_categories),
    (select string_agg(woo_vendor_id || '/' || updated_at::text || '/' || coalesce(address, '∅') || '/' || coalesce(contact_name, '∅') || '/' || coalesce(woo_snapshot::text, '∅'), ',' order by woo_vendor_id)
     from public.vendors where woo_vendor_id = 9951)), true);
end $$;

-- ---------------------------------------------------------------- 0014 again on that state

\ir ../migrations/0014_vendor_sync.sql

do $$ begin
  -- no backfill: the staged store keeps its text address and its nulls; its rate row keeps flat null; no activity
  if not ((select coalesce(contact_name, '∅') || '/' || coalesce(address_parts::text, '∅') || '/' || coalesce(social::text, '∅') || '/' || address || '/' || instagram
                  || '/' || coalesce(logo_url, '∅') || '/' || coalesce(woo_snapshot::text, '∅') || '/' || coalesce(push_pending::text, '∅') || '/' || coalesce(woo_synced_at::text, '∅')
           from public.vendors where woo_vendor_id = 9951)
          = '∅/∅/∅/عنوان قديم بالنص/old.handle/∅/∅/∅/∅'
          and (select flat is null from public.vendor_rates where vendor_id = '00000000-0000-4000-8000-0000000000e7')
          and (select count(*) from public.activity_log)::text = current_setting('migrate_0014.activity')) then
    raise exception 'case 0014 backfills nothing (the first vendors run fills the columns) and logs nothing failed';
  end if;
  -- the objects exist once
  if not (to_regclass('public.vendor_category_rates') is not null and to_regclass('public.woo_categories') is not null
          and (select count(*) from pg_policies where schemaname = 'public' and tablename in ('vendor_category_rates', 'woo_categories')) = 3
          and (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and c.relname = 'vendors' and t.tgname = 'vendors_guard_update') = 1
          and (select count(*) from pg_constraint where conrelid = 'public.vendor_rates'::regclass and conname = 'vendor_rates_flat_check') = 1) then
    raise exception 'case vendor_category_rates / woo_categories, their three policies, the one guard trigger and the flat check exist once failed';
  end if;
  if not (current_setting('migrate_0014.fingerprint') = concat_ws('|',
    (select string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '∅'), ',' order by table_name, ordinal_position)
     from information_schema.columns where table_schema = 'public' and table_name in ('vendors', 'vendor_rates', 'vendor_category_rates', 'woo_categories')),
    (select string_agg(tablename || '.' || policyname || ':' || cmd || ':' || array_to_string(roles, '|') || ':' || coalesce(qual, '∅') || ':' || coalesce(with_check, '∅'), ',' order by tablename, policyname)
     from pg_policies where schemaname = 'public' and tablename in ('vendors', 'vendor_rates', 'vendor_category_rates', 'woo_categories')),
    (select string_agg(table_name || '.' || column_name || ':' || grantee || ':' || privilege_type, ',' order by table_name, column_name, grantee, privilege_type)
     from information_schema.column_privileges where table_schema = 'public' and table_name in ('vendors', 'vendor_rates', 'vendor_category_rates', 'woo_categories')),
    (select string_agg(table_name || ':' || grantee || ':' || privilege_type, ',' order by table_name, grantee, privilege_type)
     from information_schema.role_table_grants where table_schema = 'public' and table_name in ('vendors', 'vendor_rates', 'vendor_category_rates', 'woo_categories')),
    (select string_agg(t.tgname || ':' || c.relname || ':' || t.tgenabled::text || ':' || t.tgtype::text || ':' || t.tgfoid::text, ',' order by t.tgname)
     from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and c.relname in ('vendors', 'vendor_rates', 'vendor_category_rates', 'woo_categories')),
    (select string_agg(proname || ':' || oid::text || ':' || md5(pg_get_functiondef(oid)) || ':' || prosecdef::text || ':' || coalesce(array_to_string(proacl, ';'), '∅') || ':' || coalesce(array_to_string(proconfig, ';'), '∅'), ',' order by proname)
     from pg_proc where pronamespace = 'public'::regnamespace and proname in ('vendors_guard_update', 'vendor_rates_apply')),
    (select string_agg(conname || ':' || oid::text || ':' || pg_get_constraintdef(oid), ',' order by conname)
     from pg_constraint where conrelid in ('public.vendors'::regclass, 'public.vendor_rates'::regclass, 'public.vendor_category_rates'::regclass, 'public.woo_categories'::regclass)),
    (select string_agg(indexname || ':' || indexdef, ',' order by indexname) from pg_indexes where schemaname = 'public' and tablename in ('vendors', 'vendor_rates', 'vendor_category_rates', 'woo_categories')),
    (select string_agg(relname || ':' || relrowsecurity::text, ',' order by relname) from pg_class where oid in ('public.vendors'::regclass, 'public.vendor_rates'::regclass, 'public.vendor_category_rates'::regclass, 'public.woo_categories'::regclass)),
    (select string_agg(s.sequencename || ':' || coalesce(s.last_value::text, '∅'), ',' order by s.sequencename) from pg_sequences s where s.schemaname = 'public' and s.sequencename in ('vendor_rates_id_seq', 'vendor_category_rates_id_seq')),
    (select count(*) from public.vendors), (select count(*) from public.vendor_rates), (select count(*) from public.vendor_category_rates), (select count(*) from public.woo_categories),
    (select string_agg(woo_vendor_id || '/' || updated_at::text || '/' || coalesce(address, '∅') || '/' || coalesce(contact_name, '∅') || '/' || coalesce(woo_snapshot::text, '∅'), ',' order by woo_vendor_id)
     from public.vendors where woo_vendor_id = 9951))) then
    raise exception 'case 0014 applied a second time changes nothing (columns, policies, grants, triggers, functions, constraints incl. oids, indexes, RLS, sequences, rows) failed';
  end if;
end $$;

-- ---------------------------------------------------------------- and a third time

\ir ../migrations/0014_vendor_sync.sql

do $$ begin
  if not ((select count(*) from pg_policies where schemaname = 'public' and tablename in ('vendor_category_rates', 'woo_categories')) = 3
          and (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and c.relname = 'vendors' and t.tgname = 'vendors_guard_update') = 1
          and (select count(*) from public.activity_log)::text = current_setting('migrate_0014.activity')
          and (select contact_name is null and woo_snapshot is null from public.vendors where woo_vendor_id = 9951)) then
    raise exception 'case the policies, the guard trigger, activity_log and the staged store are the same after three runs failed';
  end if;
end $$;

rollback;

do $$ begin raise notice 'migrate_0014: ok'; end $$;
