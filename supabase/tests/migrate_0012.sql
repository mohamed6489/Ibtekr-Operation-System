-- Tests for 0012_vendor_logins on rows that predate it and for its re-run. Makers with the two statuses of 0007
-- (active / inactive) and a login row written before the re-run are inserted, the migration file itself is applied
-- again with \ir, then once more to prove that a re-run changes nothing (the constraint keeps its oid: no drop).
-- LOCAL ONLY (psql): \ir is a psql command, so this file does not run through the Supabase MCP's execute_sql; on the
-- live project 0012 is checked with the queries in tools/deploy.md §2.1. The behaviour of 0012 (the grants, the
-- policies, the guard, the two RPCs) is in rls_vendor_logins.sql (live-safe).
-- The first application of 0012 — the one that drops the 0007 check and adds the new one — is the migration step of
-- tools/db-test.sh itself; this file checks what it left behind and that the re-run takes the "nothing to do" path.
-- Runs in one transaction and rolls back; prints NOTICE 'migrate_0012: ok' only if every case passed.
-- As the runner (postgres, no auth.uid()): the trusted server and the migrations both write this way.
-- No statement here removes rows or objects.

begin;
-- the re-runs print "relation … already exists, skipping"
set local client_min_messages = warning;
set local request.jwt.claims = '';

-- ---------------------------------------------------------------- the state before the re-run

-- Stores as the sync wrote them, with the two statuses 0007 allowed; a login row the popup wrote.
insert into public.vendors (id, woo_vendor_id, name, status, raw) values
  ('00000000-0000-4000-8000-0000000000e1', 9911, 'متجر إجازة 1', 'active',   '{"id":9911,"store_name":"متجر إجازة 1"}'),
  ('00000000-0000-4000-8000-0000000000e2', 9912, 'متجر إجازة 2', 'inactive', '{"id":9912,"store_name":"متجر إجازة 2"}');

insert into public.vendor_logins (vendor_id, username, email, created_by)
values ('00000000-0000-4000-8000-0000000000e1', 'ejaza.one', 'ejaza-one.dev@ibtekr.local', 'الاختبار');

do $$ begin
  perform set_config('migrate_0012.status_check_oid',
    (select oid::text from pg_constraint where conrelid = 'public.vendors'::regclass and conname = 'vendors_status_check'), true);
  perform set_config('migrate_0012.activity', (select count(*)::text from public.activity_log), true);
end $$;

-- ---------------------------------------------------------------- 0012 on that state

\ir ../migrations/0012_vendor_logins.sql

do $$ declare n int; begin
  -- the stored active / inactive rows are still valid, and `leave` is accepted (update and insert)
  update public.vendors set status = 'leave' where woo_vendor_id = 9911;
  get diagnostics n = row_count;
  if not (n = 1) then raise exception 'case a stored maker goes on leave failed'; end if;
  insert into public.vendors (woo_vendor_id, name, status) values (9913, 'متجر إجازة 3', 'leave');
  if not ((select string_agg(woo_vendor_id || '=' || status, ',' order by woo_vendor_id) from public.vendors where woo_vendor_id between 9911 and 9913)
          = '9911=leave,9912=inactive,9913=leave') then
    raise exception 'case vendors.status accepts leave next to active / inactive failed';
  end if;
  -- the old check is gone: one status check on vendors, under the 0007 name, listing the three values
  if not ((select count(*) from pg_constraint where conrelid = 'public.vendors'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%status%') = 1
          and (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.vendors'::regclass and conname = 'vendors_status_check')
              like '%''active''%''leave''%''inactive''%') then
    raise exception 'case the 0007 status check was replaced by the one of decision 6 failed';
  end if;
  -- a fourth value is still refused
  begin
    update public.vendors set status = 'vacation' where woo_vendor_id = 9912;
    raise exception 'case a status outside active / leave / inactive must error failed';
  exception when check_violation then
    null; -- expected
  end;
  -- the table, its guard and the two RPCs exist
  if not (to_regclass('public.vendor_logins') is not null
          and (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
               where not t.tgisinternal and c.relname = 'vendor_logins' and t.tgname = 'vendor_logins_guard') = 1
          and to_regprocedure('public.vendor_login_set_password(uuid, text)') is not null
          and to_regprocedure('public.vendor_login_reveal(uuid)') is not null
          and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'vendor_logins') = 3) then
    raise exception 'case vendor_logins, vendor_logins_guard, vendor_login_set_password, vendor_login_reveal and the three policies exist failed';
  end if;
  -- the login row written before the re-run is untouched; the re-run wrote no activity
  if not ((select username || '/' || status || '/' || must_change::text || '/' || pw_mode || '/' || created_by
           from public.vendor_logins where vendor_id = '00000000-0000-4000-8000-0000000000e1') = 'ejaza.one/invited/true/link/الاختبار'
          and (select count(*) from public.activity_log)::text = current_setting('migrate_0012.activity')) then
    raise exception 'case the re-run leaves the login rows and activity_log as they were failed';
  end if;
  -- the constraint already listed `leave`, so the re-run did not drop / re-add it (same oid)
  if not ((select oid::text from pg_constraint where conrelid = 'public.vendors'::regclass and conname = 'vendors_status_check')
          = current_setting('migrate_0012.status_check_oid')) then
    raise exception 'case a re-run leaves vendors_status_check in place (no drop once it lists leave) failed';
  end if;
end $$;

-- ---------------------------------------------------------------- a re-run changes nothing

do $$ begin
  perform set_config('migrate_0012.before', concat_ws('|',
    (select string_agg(woo_vendor_id || status, ',' order by woo_vendor_id) from public.vendors where woo_vendor_id between 9911 and 9913),
    (select string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '∅'), ',' order by table_name, ordinal_position)
     from information_schema.columns where table_schema = 'public' and table_name in ('vendors', 'vendor_logins')),
    (select string_agg(tablename || '.' || policyname || ':' || cmd || ':' || array_to_string(roles, '|') || ':' || coalesce(qual, '∅') || ':' || coalesce(with_check, '∅'), ',' order by tablename, policyname)
     from pg_policies where schemaname = 'public' and tablename in ('vendors', 'vendor_logins')),
    (select string_agg(table_name || '.' || column_name || ':' || grantee || ':' || privilege_type, ',' order by table_name, column_name, grantee, privilege_type)
     from information_schema.column_privileges where table_schema = 'public' and table_name in ('vendors', 'vendor_logins')),
    (select string_agg(table_name || ':' || grantee || ':' || privilege_type, ',' order by table_name, grantee, privilege_type)
     from information_schema.role_table_grants where table_schema = 'public' and table_name in ('vendors', 'vendor_logins')),
    (select string_agg(t.tgname || ':' || c.relname || ':' || t.tgenabled::text || ':' || t.tgtype::text, ',' order by t.tgname)
     from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and c.relname in ('vendors', 'vendor_logins')),
    (select string_agg(proname || ':' || md5(pg_get_functiondef(oid)) || ':' || prosecdef::text || ':' || coalesce(array_to_string(proacl, ';'), '∅') || ':' || coalesce(array_to_string(proconfig, ';'), '∅'), ',' order by proname)
     from pg_proc where proname in ('vendors_guard_update', 'vendor_logins_guard', 'vendor_login_set_password', 'vendor_login_reveal')),
    (select string_agg(conname || ':' || oid::text || ':' || pg_get_constraintdef(oid), ',' order by conname)
     from pg_constraint where conrelid in ('public.vendors'::regclass, 'public.vendor_logins'::regclass)),
    (select string_agg(indexname || ':' || indexdef, ',' order by indexname) from pg_indexes where schemaname = 'public' and tablename = 'vendor_logins'),
    (select relrowsecurity::text from pg_class where oid = 'public.vendor_logins'::regclass),
    (select count(*) from public.activity_log),
    (select count(*) from public.vendors), (select count(*) from public.vendor_logins)), true);
end $$;

\ir ../migrations/0012_vendor_logins.sql

do $$ begin
  if not (current_setting('migrate_0012.before')
          = concat_ws('|',
              (select string_agg(woo_vendor_id || status, ',' order by woo_vendor_id) from public.vendors where woo_vendor_id between 9911 and 9913),
              (select string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '∅'), ',' order by table_name, ordinal_position)
               from information_schema.columns where table_schema = 'public' and table_name in ('vendors', 'vendor_logins')),
              (select string_agg(tablename || '.' || policyname || ':' || cmd || ':' || array_to_string(roles, '|') || ':' || coalesce(qual, '∅') || ':' || coalesce(with_check, '∅'), ',' order by tablename, policyname)
               from pg_policies where schemaname = 'public' and tablename in ('vendors', 'vendor_logins')),
              (select string_agg(table_name || '.' || column_name || ':' || grantee || ':' || privilege_type, ',' order by table_name, column_name, grantee, privilege_type)
               from information_schema.column_privileges where table_schema = 'public' and table_name in ('vendors', 'vendor_logins')),
              (select string_agg(table_name || ':' || grantee || ':' || privilege_type, ',' order by table_name, grantee, privilege_type)
               from information_schema.role_table_grants where table_schema = 'public' and table_name in ('vendors', 'vendor_logins')),
              (select string_agg(t.tgname || ':' || c.relname || ':' || t.tgenabled::text || ':' || t.tgtype::text, ',' order by t.tgname)
               from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and c.relname in ('vendors', 'vendor_logins')),
              (select string_agg(proname || ':' || md5(pg_get_functiondef(oid)) || ':' || prosecdef::text || ':' || coalesce(array_to_string(proacl, ';'), '∅') || ':' || coalesce(array_to_string(proconfig, ';'), '∅'), ',' order by proname)
               from pg_proc where proname in ('vendors_guard_update', 'vendor_logins_guard', 'vendor_login_set_password', 'vendor_login_reveal')),
              (select string_agg(conname || ':' || oid::text || ':' || pg_get_constraintdef(oid), ',' order by conname)
               from pg_constraint where conrelid in ('public.vendors'::regclass, 'public.vendor_logins'::regclass)),
              (select string_agg(indexname || ':' || indexdef, ',' order by indexname) from pg_indexes where schemaname = 'public' and tablename = 'vendor_logins'),
              (select relrowsecurity::text from pg_class where oid = 'public.vendor_logins'::regclass),
              (select count(*) from public.activity_log),
              (select count(*) from public.vendors), (select count(*) from public.vendor_logins))) then
    raise exception 'case 0012 applied a second time changes nothing (rows, columns, policies, grants, triggers, functions, constraints incl. oids, index, activity_log) failed';
  end if;
  if not ((select count(*) from pg_policies where schemaname = 'public' and tablename = 'vendor_logins') = 3
          and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'vendors') = 4
          and (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
               where not t.tgisinternal and c.relname = 'vendor_logins' and t.tgname = 'vendor_logins_guard') = 1
          and (select count(*) from pg_constraint where conrelid = 'public.vendors'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%status%') = 1
          and (select count(*) from pg_indexes where schemaname = 'public' and tablename = 'vendor_logins' and indexname = 'vendor_logins_username_key') = 1) then
    raise exception 'case the policies, the trigger, the status check and the index of 0012 exist once after three runs failed';
  end if;
end $$;

rollback;

do $$ begin raise notice 'migrate_0012: ok'; end $$;
