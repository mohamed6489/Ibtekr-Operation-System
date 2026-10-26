-- RLS / permission / trigger / function tests for 0012_vendor_logins (the status `leave` on vendors, the table
-- vendor_logins with its column-list grants, its three policies and the column guard vendor_logins_guard, the two
-- Vault RPCs vendor_login_set_password / vendor_login_reveal and the activity_log rows they write).
-- Depends on 0001_identity … 0012_vendor_logins.
-- Runs in one transaction and rolls back; prints NOTICE 'rls_vendor_logins: ok' only if every case passed.
-- Each case switches role explicitly: the runner (postgres) owns the tables, bypasses RLS and plays the trusted server
-- (service_role) — the guard applies to anon / authenticated only.
-- With Vault (the live project) the two functions are exercised end to end (set, reveal, replace, the activity rows,
-- the secret row); without it (a plain local Postgres, CI) both must raise 0A000 after the permission / password / row
-- checks, which are tested everywhere. The secret and every row written here roll back with the transaction.
-- No statement here removes rows or objects (the one delete below is expected to be refused and is run as text, like
-- rls_vendors.sql), so it runs live through the Supabase MCP's execute_sql unchanged. Every e-mail, phone and name is
-- made up; the only password is the fixed test value Test1234 / Test5678.

begin;

-- Test users (fixed UUIDs …51–…56): admin, vendors follow-up (vendors.edit F / toggle N), ops (vendors.edit P), accounts
-- (vendors.view F / edit N), suspended viewer, cs (vendors.view P / edit N). Every value comes from the built-in matrix
-- of 0003_seed_roles.
insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-000000000051', 'vl-admin.dev@ibtekr.local',    '01000000051'),
  ('00000000-0000-4000-8000-000000000052', 'vl-vf.dev@ibtekr.local',       '01000000052'),
  ('00000000-0000-4000-8000-000000000053', 'vl-ops.dev@ibtekr.local',      '01000000053'),
  ('00000000-0000-4000-8000-000000000054', 'vl-accounts.dev@ibtekr.local', '01000000054'),
  ('00000000-0000-4000-8000-000000000055', 'vl-susp.dev@ibtekr.local',     '01000000055'),
  ('00000000-0000-4000-8000-000000000056', 'vl-cs.dev@ibtekr.local',       '01000000056');

insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email)
from auth.users u
where u.id in ('00000000-0000-4000-8000-000000000051',
               '00000000-0000-4000-8000-000000000052',
               '00000000-0000-4000-8000-000000000053',
               '00000000-0000-4000-8000-000000000054',
               '00000000-0000-4000-8000-000000000055',
               '00000000-0000-4000-8000-000000000056');

insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-000000000051', 'أدمن الدخول',        'vl-admin.dev@ibtekr.local',    '01000000051', 'admin',            'active',    '{}'),
  ('00000000-0000-4000-8000-000000000052', 'متابعة الدخول',      'vl-vf.dev@ibtekr.local',       '01000000052', 'vendors_followup', 'active',    '{}'),
  ('00000000-0000-4000-8000-000000000053', 'عمليات الدخول',      'vl-ops.dev@ibtekr.local',      '01000000053', 'ops',              'active',    '{}'),
  ('00000000-0000-4000-8000-000000000054', 'حسابات الدخول',      'vl-accounts.dev@ibtekr.local', '01000000054', 'accounts',         'active',    '{}'),
  ('00000000-0000-4000-8000-000000000055', 'مشاهد موقوف الدخول', 'vl-susp.dev@ibtekr.local',     '01000000055', 'viewer',           'suspended', '{}'),
  ('00000000-0000-4000-8000-000000000056', 'خدمة عملاء الدخول',  'vl-cs.dev@ibtekr.local',       '01000000056', 'cs',               'active',    '{}');

-- Three makers without a store, as the popup adds them (no woo_vendor_id: nothing to collide with on the live
-- registry). Written by the runner.
insert into public.vendors (id, name, category, status, lead_days, joined_at) values
  ('00000000-0000-4000-8000-0000000000d1', 'ورشة الدخول',  'هدايا', 'active', 7, '2026-10-26'),
  ('00000000-0000-4000-8000-0000000000d2', 'ورشة الإجازة', 'هدايا', 'active', 7, '2026-10-26'),
  ('00000000-0000-4000-8000-0000000000d3', 'ورشة التكرار', 'هدايا', 'active', 7, '2026-10-26');

-- Vault present? Decided here as the runner: to_regclass('vault.…') checks USAGE on the schema and raises 42501 for a
-- role without it (authenticated has none on the live project), so the member blocks read this setting instead.
-- Inside the two RPCs the same call runs as their owner, which is the point.
do $$ begin
  perform set_config('rls_vendor_logins.has_vault', (to_regclass('vault.decrypted_secrets') is not null)::text, true);
end $$;

-- ================================================================ runner: schema, keys, index, policies, grants, triggers, functions

do $$ begin
  -- vendors.status: one check, named as 0007 left it, listing the three values of decision 6
  if not ((select pg_get_constraintdef(c.oid) from pg_constraint c
           where c.conrelid = 'public.vendors'::regclass and c.conname = 'vendors_status_check' and c.contype = 'c')
            like '%''active''%''leave''%''inactive''%'
          and (select count(*) from pg_constraint c
               where c.conrelid = 'public.vendors'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%status%') = 1) then
    raise exception 'case vendors_status_check is the one status check and lists active / leave / inactive failed: %',
      coalesce((select pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid = 'public.vendors'::regclass and c.conname = 'vendors_status_check'), '<missing>');
  end if;
  -- vendor_logins: the 12 columns of decision 3 with their types, nullability and defaults
  if not ((select string_agg(column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '∅'), ',' order by ordinal_position)
           from information_schema.columns where table_schema = 'public' and table_name = 'vendor_logins')
          = 'vendor_id:uuid:NO:∅,username:text:NO:∅,email:text:NO:∅,pw_mode:text:NO:''link''::text,status:text:NO:''invited''::text,'
            || 'must_change:boolean:NO:true,invite_sent_at:timestamp with time zone:YES:∅,password_set_at:timestamp with time zone:YES:∅,'
            || 'secret_id:uuid:YES:∅,created_by:text:YES:∅,created_at:timestamp with time zone:NO:now(),updated_at:timestamp with time zone:NO:now()') then
    raise exception 'case vendor_logins has the 12 columns of decision 3 (types, nullability, defaults) failed: %',
      (select string_agg(column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '∅'), ',' order by ordinal_position)
       from information_schema.columns where table_schema = 'public' and table_name = 'vendor_logins');
  end if;
  -- keys: pk vendor_id, fk vendors on delete cascade ('c'), the four checks (username / email / pw_mode / status)
  if not ((select string_agg(c.conname || ':' || c.contype::text || ':' || coalesce((select relname::text from pg_class where oid = c.confrelid), '∅')
                             || ':' || coalesce(nullif(c.confdeltype::text, ' '), '∅'), ',' order by c.conname)
           from pg_constraint c where c.conrelid = 'public.vendor_logins'::regclass)
          = 'vendor_logins_email_check:c:∅:∅,vendor_logins_pkey:p:∅:∅,vendor_logins_pw_mode_check:c:∅:∅,vendor_logins_status_check:c:∅:∅,'
            || 'vendor_logins_username_check:c:∅:∅,vendor_logins_vendor_id_fkey:f:vendors:c') then
    raise exception 'case vendor_logins keys (pk vendor_id, fk vendors on delete cascade, the four checks) failed: %',
      (select string_agg(c.conname || ':' || c.contype::text || ':' || coalesce(nullif(c.confdeltype::text, ' '), '∅'), ',' order by c.conname)
       from pg_constraint c where c.conrelid = 'public.vendor_logins'::regclass);
  end if;
  -- the unique index on lower(username)
  if not exists (select 1 from pg_indexes
                 where schemaname = 'public' and tablename = 'vendor_logins' and indexname = 'vendor_logins_username_key'
                   and indexdef like 'CREATE UNIQUE INDEX%(lower(username))') then
    raise exception 'case vendor_logins has a unique index on lower(username) failed';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.vendor_logins'::regclass) then
    raise exception 'case vendor_logins has RLS enabled failed';
  end if;

  -- policies: select (vendors.view <> N), insert (is_admin / vendors.edit = F), update (using vendors.view, with check
  -- is_admin / vendors.edit = F) — all to authenticated; no delete policy.
  if not ((select string_agg(policyname || ':' || cmd || ':' || array_to_string(roles, '|'), ',' order by policyname)
           from pg_policies where schemaname = 'public' and tablename = 'vendor_logins')
          = 'vendor_logins_insert:INSERT:authenticated,vendor_logins_select:SELECT:authenticated,vendor_logins_update:UPDATE:authenticated') then
    raise exception 'case vendor_logins has exactly select / insert / update policies to authenticated failed';
  end if;
  if not ((select qual from pg_policies where schemaname = 'public' and tablename = 'vendor_logins' and policyname = 'vendor_logins_select')
            like '%vendors.view%'
          and (select with_check from pg_policies where schemaname = 'public' and tablename = 'vendor_logins' and policyname = 'vendor_logins_insert')
            like '%is_admin%vendors.edit%''F''%'
          and (select qual from pg_policies where schemaname = 'public' and tablename = 'vendor_logins' and policyname = 'vendor_logins_update')
            like '%vendors.view%'
          and (select with_check from pg_policies where schemaname = 'public' and tablename = 'vendor_logins' and policyname = 'vendor_logins_update')
            like '%is_admin%vendors.edit%''F''%') then
    raise exception 'case vendor_logins policies: select / update-using on vendors.view, insert / update-check on is_admin or vendors.edit = F failed';
  end if;

  -- grants for authenticated: select by column list, never secret_id (and never the table); insert on the five
  -- columns of the popup; update on the four client columns; no delete; no truncate.
  if not (has_column_privilege('authenticated', 'public.vendor_logins', 'vendor_id', 'SELECT')
          and has_column_privilege('authenticated', 'public.vendor_logins', 'username', 'SELECT')
          and has_column_privilege('authenticated', 'public.vendor_logins', 'email', 'SELECT')
          and has_column_privilege('authenticated', 'public.vendor_logins', 'pw_mode', 'SELECT')
          and has_column_privilege('authenticated', 'public.vendor_logins', 'status', 'SELECT')
          and has_column_privilege('authenticated', 'public.vendor_logins', 'must_change', 'SELECT')
          and has_column_privilege('authenticated', 'public.vendor_logins', 'invite_sent_at', 'SELECT')
          and has_column_privilege('authenticated', 'public.vendor_logins', 'password_set_at', 'SELECT')
          and has_column_privilege('authenticated', 'public.vendor_logins', 'created_by', 'SELECT')
          and has_column_privilege('authenticated', 'public.vendor_logins', 'created_at', 'SELECT')
          and has_column_privilege('authenticated', 'public.vendor_logins', 'updated_at', 'SELECT')
          and not has_column_privilege('authenticated', 'public.vendor_logins', 'secret_id', 'SELECT')
          and not has_table_privilege('authenticated', 'public.vendor_logins', 'SELECT')) then
    raise exception 'case authenticated selects vendor_logins by column list, never secret_id failed';
  end if;
  if not ((select count(*) from information_schema.column_privileges
           where grantee = 'authenticated' and table_schema = 'public' and table_name = 'vendor_logins' and privilege_type = 'SELECT') = 11) then
    raise exception 'case authenticated selects exactly 11 vendor_logins columns failed';
  end if;
  if not ((select string_agg(column_name, ',' order by column_name) from information_schema.column_privileges
           where grantee = 'authenticated' and table_schema = 'public' and table_name = 'vendor_logins' and privilege_type = 'INSERT')
          = 'created_by,email,pw_mode,username,vendor_id') then
    raise exception 'case authenticated inserts vendor_id / username / email / pw_mode / created_by only failed';
  end if;
  if not ((select string_agg(column_name, ',' order by column_name) from information_schema.column_privileges
           where grantee = 'authenticated' and table_schema = 'public' and table_name = 'vendor_logins' and privilege_type = 'UPDATE')
          = 'email,pw_mode,status,username') then
    raise exception 'case authenticated updates username / email / pw_mode / status only failed';
  end if;
  if not (not has_table_privilege('authenticated', 'public.vendor_logins', 'DELETE')
          and not has_table_privilege('authenticated', 'public.vendor_logins', 'TRUNCATE')
          and not has_table_privilege('authenticated', 'public.vendor_logins', 'REFERENCES')
          and not has_table_privilege('authenticated', 'public.vendor_logins', 'TRIGGER')
          and has_table_privilege('service_role', 'public.vendor_logins', 'SELECT')
          and has_column_privilege('service_role', 'public.vendor_logins', 'secret_id', 'SELECT')
          and has_table_privilege('service_role', 'public.vendor_logins', 'INSERT')
          and has_table_privilege('service_role', 'public.vendor_logins', 'UPDATE')
          and has_table_privilege('service_role', 'public.vendor_logins', 'DELETE')
          and not has_table_privilege('service_role', 'public.vendor_logins', 'TRUNCATE')
          and not has_table_privilege('service_role', 'public.vendor_logins', 'REFERENCES')
          and not has_table_privilege('service_role', 'public.vendor_logins', 'TRIGGER')
          and not has_column_privilege('anon', 'public.vendor_logins', 'username', 'SELECT')
          and not has_table_privilege('anon', 'public.vendor_logins', 'SELECT')) then
    raise exception 'case vendor_logins grants (no delete / truncate for members, service_role all incl. secret_id, anon none) failed';
  end if;

  -- the guard: before update, invoker, owned by postgres, not executable by the API roles
  if not ((select string_agg(t.tgname || ':' || c.relname || ':' || p.proname || ':' || p.prosecdef::text || ':' || r.rolname || ':' || t.tgtype::text, ',' order by t.tgname)
           from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid join pg_roles r on r.oid = p.proowner
           where not t.tgisinternal and c.relname = 'vendor_logins')
          = 'vendor_logins_guard:vendor_logins:vendor_logins_guard:false:postgres:19') then -- 19 = row + before + update
    raise exception 'case trigger vendor_logins_guard (before update, row, invoker, owner postgres) failed: %',
      coalesce((select string_agg(t.tgname || ':' || p.proname || ':' || p.prosecdef::text || ':' || t.tgtype::text, ',')
                from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid
                where not t.tgisinternal and c.relname = 'vendor_logins'), '<none>');
  end if;
  if not (not has_function_privilege('authenticated', 'public.vendor_logins_guard()', 'EXECUTE')
          and not has_function_privilege('anon', 'public.vendor_logins_guard()', 'EXECUTE')) then
    raise exception 'case the API roles cannot execute vendor_logins_guard failed';
  end if;
  -- the two RPCs: definer, owned by postgres, volatile, search_path pinned, executable by authenticated and
  -- service_role, not by anon / public
  if not ((select string_agg(p.proname || ':' || p.prosecdef::text || ':' || r.rolname || ':' || p.provolatile::text || ':' || coalesce(array_to_string(p.proconfig, ';'), '∅'), ',' order by p.proname)
           from pg_proc p join pg_roles r on r.oid = p.proowner
           where p.oid in ('public.vendor_login_set_password(uuid, text)'::regprocedure, 'public.vendor_login_reveal(uuid)'::regprocedure))
          = 'vendor_login_reveal:true:postgres:v:search_path=public,vendor_login_set_password:true:postgres:v:search_path=public') then
    raise exception 'case vendor_login_set_password / vendor_login_reveal are definer, owned by postgres, volatile, search_path = public failed: %',
      (select string_agg(p.proname || ':' || p.prosecdef::text || ':' || r.rolname || ':' || p.provolatile::text || ':' || coalesce(array_to_string(p.proconfig, ';'), '∅'), ',' order by p.proname)
       from pg_proc p join pg_roles r on r.oid = p.proowner where p.proname in ('vendor_login_set_password', 'vendor_login_reveal'));
  end if;
  if not (has_function_privilege('authenticated', 'public.vendor_login_set_password(uuid, text)', 'EXECUTE')
          and has_function_privilege('service_role', 'public.vendor_login_set_password(uuid, text)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.vendor_login_set_password(uuid, text)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.vendor_login_reveal(uuid)', 'EXECUTE')
          and has_function_privilege('service_role', 'public.vendor_login_reveal(uuid)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.vendor_login_reveal(uuid)', 'EXECUTE')
          and (select proacl from pg_proc where oid = 'public.vendor_login_reveal(uuid)'::regprocedure) is not null
          and (select proacl from pg_proc where oid = 'public.vendor_login_set_password(uuid, text)'::regprocedure) is not null) then
    raise exception 'case the two RPCs run for authenticated / service_role only (no public, no anon) failed';
  end if;
end $$;

-- check constraints, the foreign key, the status list (runner, bypassing RLS)
do $$
declare stmt text; code text;
begin
  for stmt, code in select * from (values
    ('insert into public.vendor_logins (vendor_id, username, email) values (''00000000-0000-4000-8000-0000000000d1'', ''Nour.Login'', ''nour-login.dev@ibtekr.local'')', '23514'),
    ('insert into public.vendor_logins (vendor_id, username, email) values (''00000000-0000-4000-8000-0000000000d1'', ''ab'', ''nour-login.dev@ibtekr.local'')', '23514'),
    ('insert into public.vendor_logins (vendor_id, username, email) values (''00000000-0000-4000-8000-0000000000d1'', ''.nour'', ''nour-login.dev@ibtekr.local'')', '23514'),
    ('insert into public.vendor_logins (vendor_id, username, email) values (''00000000-0000-4000-8000-0000000000d1'', ''nour.login'', ''not-an-email'')', '23514'),
    ('insert into public.vendor_logins (vendor_id, username, email) values (''00000000-0000-4000-8000-0000000000d1'', ''nour.login'', ''nour login@ibtekr.local'')', '23514'),
    ('insert into public.vendor_logins (vendor_id, username, email, pw_mode) values (''00000000-0000-4000-8000-0000000000d1'', ''nour.login'', ''nour-login.dev@ibtekr.local'', ''sms'')', '23514'),
    ('insert into public.vendor_logins (vendor_id, username, email, status) values (''00000000-0000-4000-8000-0000000000d1'', ''nour.login'', ''nour-login.dev@ibtekr.local'', ''pending'')', '23514'),
    ('insert into public.vendor_logins (vendor_id, username, email) values (''00000000-0000-4000-8000-000000000051'', ''nour.login'', ''nour-login.dev@ibtekr.local'')', '23503'),
    ('update public.vendors set status = ''vacation'' where id = ''00000000-0000-4000-8000-0000000000d2''', '23514')
  ) as v (stmt, code) loop
    begin
      execute stmt;
      raise exception 'case constraint must error failed: %', stmt;
    exception when others then
      if sqlstate <> code then
        raise exception 'case constraint: expected %, got % (%) for %', code, sqlstate, sqlerrm, stmt;
      end if;
    end;
  end loop;
end $$;

-- `leave` is a vendor status now (decision 6); the server writes a login row with an old updated_at (the bump below)
do $$ declare n int; begin
  update public.vendors set status = 'leave' where id = '00000000-0000-4000-8000-0000000000d2';
  get diagnostics n = row_count;
  if not (n = 1 and (select status from public.vendors where id = '00000000-0000-4000-8000-0000000000d2') = 'leave') then
    raise exception 'case vendors.status accepts leave failed';
  end if;
  insert into public.vendor_logins (vendor_id, username, email, created_by, updated_at)
  values ('00000000-0000-4000-8000-0000000000d2', 'qamar.login', 'qamar-login.dev@ibtekr.local', 'السيرفر', '2020-01-01T00:00:00Z');
end $$;

-- ================================================================ admin: insert, the client columns, the guard, the RPCs

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000051","role":"authenticated"}';
do $$ declare n int; begin
  -- the popup: a login row with the link choice (status / must_change from their defaults)
  insert into public.vendor_logins (vendor_id, username, email, pw_mode, created_by)
  values ('00000000-0000-4000-8000-0000000000d1', 'nour.login', 'nour-login.dev@ibtekr.local', 'link', 'أدمن الدخول');
  -- read by column list (what the adapter selects): the two rows, nothing hidden but secret_id
  if not ((select count(*) from (select vendor_id, username, email, pw_mode, status, must_change, invite_sent_at, password_set_at,
                                        created_by, created_at, updated_at from public.vendor_logins) l) = 2
          and (select username || '/' || email || '/' || pw_mode || '/' || status || '/' || must_change::text || '/'
                      || coalesce(invite_sent_at::text, '∅') || '/' || coalesce(password_set_at::text, '∅') || '/' || created_by
               from public.vendor_logins where vendor_id = '00000000-0000-4000-8000-0000000000d1')
              = 'nour.login/nour-login.dev@ibtekr.local/link/invited/true/∅/∅/أدمن الدخول') then
    raise exception 'case admin inserts a login row (defaults invited / must_change / link) and reads the list by column list failed';
  end if;
  -- the client columns
  update public.vendor_logins set username = 'nour.store', email = 'nour-store.dev@ibtekr.local', pw_mode = 'temp'
  where vendor_id = '00000000-0000-4000-8000-0000000000d1';
  get diagnostics n = row_count;
  if not (n = 1) then raise exception 'case admin changes username / email / pw_mode failed'; end if;
  update public.vendor_logins set status = 'disabled' where vendor_id = '00000000-0000-4000-8000-0000000000d1';
  get diagnostics n = row_count;
  if not (n = 1 and (select status from public.vendor_logins where vendor_id = '00000000-0000-4000-8000-0000000000d1') = 'disabled') then
    raise exception 'case admin sets a login status to disabled failed';
  end if;
  update public.vendor_logins set status = 'invited', pw_mode = 'link' where vendor_id = '00000000-0000-4000-8000-0000000000d1';
  get diagnostics n = row_count;
  if not (n = 1) then raise exception 'case admin sets a login status back to invited failed'; end if;
  -- `leave` from the screen (vendors.toggle = F)
  update public.vendors set status = 'leave' where id = '00000000-0000-4000-8000-0000000000d1';
  get diagnostics n = row_count;
  if not (n = 1) then raise exception 'case admin (vendors.toggle F) puts a maker on leave failed'; end if;
end $$;

-- The guard and the column grants: status = active, the server columns (update and insert), secret_id and `*` on
-- read, delete — 42501 each, admin included.
do $$
declare stmt text; needle text;
begin
  for stmt, needle in select * from (values
    ('update public.vendor_logins set status = ''active'' where vendor_id = ''00000000-0000-4000-8000-0000000000d1''', 'portal'),
    ('update public.vendor_logins set must_change = false where vendor_id = ''00000000-0000-4000-8000-0000000000d1''', 'permission denied'),
    ('update public.vendor_logins set secret_id = gen_random_uuid() where vendor_id = ''00000000-0000-4000-8000-0000000000d1''', 'permission denied'),
    ('update public.vendor_logins set password_set_at = now() where vendor_id = ''00000000-0000-4000-8000-0000000000d1''', 'permission denied'),
    ('update public.vendor_logins set invite_sent_at = now() where vendor_id = ''00000000-0000-4000-8000-0000000000d1''', 'permission denied'),
    ('update public.vendor_logins set created_by = ''x'' where vendor_id = ''00000000-0000-4000-8000-0000000000d1''', 'permission denied'),
    ('update public.vendor_logins set vendor_id = ''00000000-0000-4000-8000-0000000000d3'' where vendor_id = ''00000000-0000-4000-8000-0000000000d1''', 'permission denied'),
    ('update public.vendor_logins set updated_at = now() where vendor_id = ''00000000-0000-4000-8000-0000000000d1''', 'permission denied'),
    ('insert into public.vendor_logins (vendor_id, username, email, status) values (''00000000-0000-4000-8000-0000000000d3'', ''planted'', ''planted.dev@ibtekr.local'', ''active'')', 'permission denied'),
    ('insert into public.vendor_logins (vendor_id, username, email, must_change) values (''00000000-0000-4000-8000-0000000000d3'', ''planted'', ''planted.dev@ibtekr.local'', false)', 'permission denied'),
    ('insert into public.vendor_logins (vendor_id, username, email, secret_id) values (''00000000-0000-4000-8000-0000000000d3'', ''planted'', ''planted.dev@ibtekr.local'', gen_random_uuid())', 'permission denied'),
    ('insert into public.vendor_logins (vendor_id, username, email, password_set_at) values (''00000000-0000-4000-8000-0000000000d3'', ''planted'', ''planted.dev@ibtekr.local'', now())', 'permission denied'),
    ('select secret_id from public.vendor_logins where vendor_id = ''00000000-0000-4000-8000-0000000000d1''', 'permission denied'),
    ('select * from public.vendor_logins', 'permission denied'),
    ('delete from public.vendor_logins where vendor_id = ''00000000-0000-4000-8000-0000000000d1''', 'permission denied')
  ) as v (stmt, needle) loop
    begin
      execute stmt;
      raise exception 'case admin on a server column must error failed: %', stmt;
    exception when others then
      if sqlstate <> '42501' or sqlerrm not like '%' || needle || '%' then -- expected: the guard's rule or the column grant
        raise exception 'case admin on a server column: expected 42501 mentioning %, got % (%) for %', needle, sqlstate, sqlerrm, stmt;
      end if;
    end;
  end loop;
end $$;

-- The password rules on the server (22023), a maker without a login row (P0002) — before Vault is looked at, so these
-- hold with and without it. A refused call writes nothing (checked below as the runner).
do $$
declare stmt text; code text;
begin
  for stmt, code in select * from (values
    ('select public.vendor_login_set_password(''00000000-0000-4000-8000-0000000000d1'', ''short1'')', '22023'),
    ('select public.vendor_login_set_password(''00000000-0000-4000-8000-0000000000d1'', ''abcdefgh'')', '22023'),
    ('select public.vendor_login_set_password(''00000000-0000-4000-8000-0000000000d1'', ''12345678'')', '22023'),
    ('select public.vendor_login_set_password(''00000000-0000-4000-8000-0000000000d1'', ''Test 1234'')', '22023'),
    ('select public.vendor_login_set_password(''00000000-0000-4000-8000-0000000000d1'', E''Test\t1234'')', '22023'),
    ('select public.vendor_login_set_password(''00000000-0000-4000-8000-0000000000d1'', null)', '22023'),
    ('select public.vendor_login_set_password(''00000000-0000-4000-8000-0000000000d1'', repeat(''Test1234'', 17))', '22023'),
    ('select public.vendor_login_set_password(''00000000-0000-4000-8000-0000000000d3'', ''Test1234'')', 'P0002'),
    ('select public.vendor_login_set_password(null, ''Test1234'')', 'P0002')
  ) as v (stmt, code) loop
    begin
      execute stmt;
      raise exception 'case set_password must error failed: %', stmt;
    exception when others then
      if sqlstate <> code then
        raise exception 'case set_password: expected %, got % (%) for %', code, sqlstate, sqlerrm, stmt;
      end if;
    end;
  end loop;
end $$;

-- With Vault: set, reveal the same value, replace it (the same secret), a maker without a password reveals null.
-- Without Vault: 0A000 'vault is not available' from both.
do $$ declare t timestamptz; stmt text; begin
  if current_setting('rls_vendor_logins.has_vault') = 'true' then
    t := public.vendor_login_set_password('00000000-0000-4000-8000-0000000000d1', 'Test1234');
    if t is null
       or (select pw_mode || '/' || must_change::text || '/' || (password_set_at = t)::text || '/' || status
           from public.vendor_logins where vendor_id = '00000000-0000-4000-8000-0000000000d1') <> 'temp/true/true/invited' then
      raise exception 'case admin sets a temporary password: pw_mode temp, must_change, password_set_at = the returned time, status untouched failed';
    end if;
    if public.vendor_login_reveal('00000000-0000-4000-8000-0000000000d1') is distinct from 'Test1234' then
      raise exception 'case reveal returns the password that was set failed';
    end if;
    perform public.vendor_login_set_password('00000000-0000-4000-8000-0000000000d1', 'Test5678');
    if public.vendor_login_reveal('00000000-0000-4000-8000-0000000000d1') is distinct from 'Test5678' then
      raise exception 'case a second set_password replaces the password failed';
    end if;
    if public.vendor_login_reveal('00000000-0000-4000-8000-0000000000d2') is not null then
      raise exception 'case reveal on a maker without a password returns null failed';
    end if;
  else
    foreach stmt in array array[
      'select public.vendor_login_set_password(''00000000-0000-4000-8000-0000000000d1'', ''Test1234'')',
      'select public.vendor_login_reveal(''00000000-0000-4000-8000-0000000000d1'')'] loop
      begin
        execute stmt;
        raise exception 'case without Vault must error failed: %', stmt;
      exception when others then
        if sqlstate <> '0A000' or sqlerrm not like '%vault is not available%' then
          raise exception 'case without Vault: expected 0A000 vault is not available, got % (%) for %', sqlstate, sqlerrm, stmt;
        end if;
      end;
    end loop;
  end if;
end $$;

-- ================================================================ runner: what the RPCs wrote (and did not write)

reset role;
set local request.jwt.claims = '';
do $$ declare has_vault boolean := current_setting('rls_vendor_logins.has_vault') = 'true'; begin
  -- the password is nowhere in activity_log, whatever happened
  if exists (select 1 from public.activity_log
             where entity_id in ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000d3')
               and coalesce(old_value::text, '') || coalesce(new_value::text, '') || coalesce(action, '')
                   like any (array['%Test1234%', '%Test5678%'])) then
    raise exception 'case the password never reaches activity_log failed';
  end if;
  if has_vault then
    -- two password rows and three reveal rows (d1 twice, d2 once), actor = the admin, entity vendor, values null
    if not ((select count(*) from public.activity_log
             where action = 'vendor.login.password' and entity = 'vendor' and entity_id = '00000000-0000-4000-8000-0000000000d1'
               and actor = '00000000-0000-4000-8000-000000000051' and old_value is null and new_value is null) = 2
            and (select count(*) from public.activity_log
                 where action = 'vendor.login.reveal' and entity = 'vendor' and entity_id = '00000000-0000-4000-8000-0000000000d1'
                   and actor = '00000000-0000-4000-8000-000000000051' and old_value is null and new_value is null) = 2
            and (select count(*) from public.activity_log
                 where action = 'vendor.login.reveal' and entity = 'vendor' and entity_id = '00000000-0000-4000-8000-0000000000d2'
                   and actor = '00000000-0000-4000-8000-000000000051') = 1
            and (select count(*) from public.activity_log where action like 'vendor.login.%' and entity_id in ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000d3')) = 5) then
      raise exception 'case the RPCs write one activity_log row per call (2 password + 3 reveal, actor = the caller, new_value null) failed: %',
        coalesce((select string_agg(action || ':' || coalesce(entity_id, '∅') || ':' || coalesce(actor::text, '∅') || ':' || coalesce(new_value::text, '∅'), ',' order by id)
                  from public.activity_log where action like 'vendor.login.%' and entity_id in ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000d3')), '<none>');
    end if;
    -- one Vault secret for the maker, named by their uuid, the same row after the replacement; the login row points at it
    if not ((select count(*) from vault.secrets where name = 'vendor-login:00000000-0000-4000-8000-0000000000d1') = 1
            and (select secret_id from public.vendor_logins where vendor_id = '00000000-0000-4000-8000-0000000000d1')
                = (select id from vault.secrets where name = 'vendor-login:00000000-0000-4000-8000-0000000000d1')
            and (select password_set_at is not null and must_change and pw_mode = 'temp'
                 from public.vendor_logins where vendor_id = '00000000-0000-4000-8000-0000000000d1')
            and (select secret_id is null and password_set_at is null from public.vendor_logins where vendor_id = '00000000-0000-4000-8000-0000000000d2')) then
      raise exception 'case one Vault secret per maker (vendor-login:<uuid>), secret_id points at it, the maker without a password has none failed';
    end if;
  else
    -- nothing was written by the refused calls
    if not ((select count(*) from public.activity_log where action like 'vendor.login.%' and entity_id in ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000d3')) = 0
            and (select secret_id is null and password_set_at is null and must_change and pw_mode = 'link'
                 from public.vendor_logins where vendor_id = '00000000-0000-4000-8000-0000000000d1')) then
      raise exception 'case refused RPC calls (22023 / P0002 / 0A000) write nothing failed';
    end if;
  end if;
end $$;

-- ================================================================ vendors follow-up: edit F — insert, the duplicate username, the bump, the RPCs; toggle N

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000052","role":"authenticated"}';
do $$ declare n int; begin
  if not ((select count(*) from public.vendor_logins) = 2) then
    raise exception 'case vendors follow-up (vendors.view F) reads the two login rows failed';
  end if;
  -- the username of another maker (23505, the row stays)
  begin
    insert into public.vendor_logins (vendor_id, username, email, created_by)
    values ('00000000-0000-4000-8000-0000000000d3', 'nour.store', 'tikrar.dev@ibtekr.local', 'متابعة الدخول');
    raise exception 'case a duplicate username must error failed';
  exception when others then
    if sqlstate <> '23505' then
      raise exception 'case a duplicate username: expected 23505, got % (%)', sqlstate, sqlerrm;
    end if;
  end;
  if not ((select count(*) from public.vendor_logins) = 2
          and (select vendor_id from public.vendor_logins where username = 'nour.store') = '00000000-0000-4000-8000-0000000000d1') then
    raise exception 'case the duplicate left the existing row as it was failed';
  end if;
  insert into public.vendor_logins (vendor_id, username, email, created_by)
  values ('00000000-0000-4000-8000-0000000000d3', 'tikrar.store', 'tikrar.dev@ibtekr.local', 'متابعة الدخول');
  get diagnostics n = row_count;
  if not (n = 1 and (select count(*) from public.vendor_logins) = 3) then
    raise exception 'case vendors follow-up (vendors.edit F) inserts a login row failed';
  end if;
  -- a change by the client bumps updated_at (the server wrote the row with 2020-01-01)
  update public.vendor_logins set username = 'qamar.store' where vendor_id = '00000000-0000-4000-8000-0000000000d2';
  get diagnostics n = row_count;
  if not (n = 1 and (select updated_at = now() and updated_at > '2021-01-01' from public.vendor_logins where vendor_id = '00000000-0000-4000-8000-0000000000d2')) then
    raise exception 'case vendors follow-up changes a username and the guard bumps updated_at failed';
  end if;
  update public.vendor_logins set status = 'disabled' where vendor_id = '00000000-0000-4000-8000-0000000000d2';
  get diagnostics n = row_count;
  if not (n = 1) then raise exception 'case vendors follow-up stops a login (disabled) failed'; end if;
end $$;

do $$
declare stmt text; needle text;
begin
  for stmt, needle in select * from (values
    ('update public.vendor_logins set status = ''active'' where vendor_id = ''00000000-0000-4000-8000-0000000000d2''', 'portal'),
    ('update public.vendor_logins set must_change = false where vendor_id = ''00000000-0000-4000-8000-0000000000d2''', 'permission denied'),
    ('select secret_id from public.vendor_logins where vendor_id = ''00000000-0000-4000-8000-0000000000d2''', 'permission denied'),
    ('update public.vendors set status = ''active'' where id = ''00000000-0000-4000-8000-0000000000d2''', 'vendors.toggle'),
    ('update public.vendors set status = ''leave'' where id = ''00000000-0000-4000-8000-0000000000d3''', 'vendors.toggle')
  ) as v (stmt, needle) loop
    begin
      execute stmt;
      raise exception 'case vendors follow-up must error failed: %', stmt;
    exception when others then
      if sqlstate <> '42501' or sqlerrm not like '%' || needle || '%' then -- expected: the named rule
        raise exception 'case vendors follow-up: expected 42501 mentioning %, got % (%) for %', needle, sqlstate, sqlerrm, stmt;
      end if;
    end;
  end loop;
end $$;

-- the RPCs pass the permission check for vendors.edit = F: with Vault they work, without it 0A000
do $$ declare stmt text; begin
  if current_setting('rls_vendor_logins.has_vault') = 'true' then
    perform public.vendor_login_set_password('00000000-0000-4000-8000-0000000000d3', 'Test1234');
    if public.vendor_login_reveal('00000000-0000-4000-8000-0000000000d3') is distinct from 'Test1234' then
      raise exception 'case vendors follow-up (vendors.edit F) sets and reveals a password failed';
    end if;
  else
    foreach stmt in array array[
      'select public.vendor_login_set_password(''00000000-0000-4000-8000-0000000000d3'', ''Test1234'')',
      'select public.vendor_login_reveal(''00000000-0000-4000-8000-0000000000d3'')'] loop
      begin
        execute stmt;
        raise exception 'case vendors follow-up without Vault must error failed: %', stmt;
      exception when others then
        if sqlstate <> '0A000' then
          raise exception 'case vendors follow-up without Vault: expected 0A000, got % (%) for %', sqlstate, sqlerrm, stmt;
        end if;
      end;
    end loop;
  end if;
end $$;

-- ================================================================ ops: edit P — reads the list, writes nothing, the RPCs refuse

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000053","role":"authenticated"}';
do $$ begin
  if not ((select count(*) from public.vendor_logins) = 3
          and (select username || '/' || status from public.vendor_logins where vendor_id = '00000000-0000-4000-8000-0000000000d1') = 'nour.store/invited') then
    raise exception 'case ops (vendors.view F) reads the login rows failed';
  end if;
end $$;

do $$
declare stmt text; needle text;
begin
  for stmt, needle in select * from (values
    ('insert into public.vendor_logins (vendor_id, username, email) values (''00000000-0000-4000-8000-0000000000d1'', ''ops.login'', ''ops-login.dev@ibtekr.local'')', 'policy'),
    ('update public.vendor_logins set username = ''ops.store'' where vendor_id = ''00000000-0000-4000-8000-0000000000d1''', 'policy'),
    ('update public.vendor_logins set status = ''disabled'' where vendor_id = ''00000000-0000-4000-8000-0000000000d1''', 'policy'),
    ('select secret_id from public.vendor_logins', 'permission denied'),
    ('select public.vendor_login_set_password(''00000000-0000-4000-8000-0000000000d1'', ''Test1234'')', 'vendors.edit'),
    ('select public.vendor_login_reveal(''00000000-0000-4000-8000-0000000000d1'')', 'vendors.edit'),
    ('update public.vendors set status = ''leave'' where id = ''00000000-0000-4000-8000-0000000000d3''', 'vendors.toggle')
  ) as v (stmt, needle) loop
    begin
      execute stmt;
      raise exception 'case ops must error failed: %', stmt;
    exception when others then
      if sqlstate <> '42501' or sqlerrm not like '%' || needle || '%' then -- expected: the policy / the grant / the RPC's own check
        raise exception 'case ops: expected 42501 mentioning %, got % (%) for %', needle, sqlstate, sqlerrm, stmt;
      end if;
    end;
  end loop;
end $$;

-- ================================================================ accounts: view F, edit N — reads, writes nothing, the RPCs refuse

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000054","role":"authenticated"}';
do $$
declare stmt text; needle text;
begin
  if not ((select count(*) from public.vendor_logins) = 3) then
    raise exception 'case accounts (vendors.view F) reads the login rows failed';
  end if;
  for stmt, needle in select * from (values
    ('insert into public.vendor_logins (vendor_id, username, email) values (''00000000-0000-4000-8000-0000000000d1'', ''acc.login'', ''acc-login.dev@ibtekr.local'')', 'policy'),
    ('update public.vendor_logins set email = ''acc.dev@ibtekr.local'' where vendor_id = ''00000000-0000-4000-8000-0000000000d1''', 'policy'),
    ('select public.vendor_login_set_password(''00000000-0000-4000-8000-0000000000d1'', ''Test1234'')', 'vendors.edit'),
    ('select public.vendor_login_reveal(''00000000-0000-4000-8000-0000000000d1'')', 'vendors.edit')
  ) as v (stmt, needle) loop
    begin
      execute stmt;
      raise exception 'case accounts must error failed: %', stmt;
    exception when others then
      if sqlstate <> '42501' or sqlerrm not like '%' || needle || '%' then
        raise exception 'case accounts: expected 42501 mentioning %, got % (%) for %', needle, sqlstate, sqlerrm, stmt;
      end if;
    end;
  end loop;
end $$;

-- ================================================================ cs: vendors.view P — the list only; nothing written, the RPCs refuse

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000056","role":"authenticated"}';
do $$
declare stmt text;
begin
  if not ((select count(*) from public.vendor_logins) = 3
          and (select username from public.vendor_logins where vendor_id = '00000000-0000-4000-8000-0000000000d3') = 'tikrar.store') then
    raise exception 'case cs (vendors.view P) reads the login rows failed';
  end if;
  foreach stmt in array array[
    'insert into public.vendor_logins (vendor_id, username, email) values (''00000000-0000-4000-8000-0000000000d1'', ''cs.login'', ''cs-login.dev@ibtekr.local'')',
    'update public.vendor_logins set username = ''cs.store'' where vendor_id = ''00000000-0000-4000-8000-0000000000d1''',
    'select public.vendor_login_set_password(''00000000-0000-4000-8000-0000000000d1'', ''Test1234'')',
    'select public.vendor_login_reveal(''00000000-0000-4000-8000-0000000000d1'')'] loop
    begin
      execute stmt;
      raise exception 'case cs writes must error failed: %', stmt;
    exception when others then
      if sqlstate <> '42501' then -- expected: the policy or the RPC's own check
        raise exception 'case cs writes: expected 42501, got % (%) for %', sqlstate, sqlerrm, stmt;
      end if;
    end;
  end loop;
end $$;

-- ================================================================ suspended viewer: nothing

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000055","role":"authenticated"}';
do $$ declare n int; stmt text; begin
  if not ((select count(*) from public.vendor_logins) = 0) then
    raise exception 'case suspended viewer reads zero login rows failed';
  end if;
  update public.vendor_logins set username = 'susp.store' where vendor_id = '00000000-0000-4000-8000-0000000000d1';
  get diagnostics n = row_count;
  if not (n = 0) then raise exception 'case suspended viewer updates zero login rows failed'; end if;
  foreach stmt in array array[
    'insert into public.vendor_logins (vendor_id, username, email) values (''00000000-0000-4000-8000-0000000000d1'', ''susp.login'', ''susp-login.dev@ibtekr.local'')',
    'select public.vendor_login_set_password(''00000000-0000-4000-8000-0000000000d1'', ''Test1234'')',
    'select public.vendor_login_reveal(''00000000-0000-4000-8000-0000000000d1'')'] loop
    begin
      execute stmt;
      raise exception 'case suspended viewer must error failed: %', stmt;
    exception when others then
      if sqlstate <> '42501' then -- expected: not admin, vendors.edit N (has_perm answers N for a suspended member)
        raise exception 'case suspended viewer: expected 42501, got % (%) for %', sqlstate, sqlerrm, stmt;
      end if;
    end;
  end loop;
end $$;

-- ================================================================ anon: zero rows or permission denied; no execute on the RPCs

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
declare n bigint; stmt text;
begin
  begin
    select count(*) into strict n from public.vendor_logins;
    if n <> 0 then raise exception 'case anon reads zero login rows failed'; end if;
  exception when insufficient_privilege then
    if sqlerrm ilike '%function%' then
      raise exception 'case anon on vendor_logins hit a policy function: %', sqlerrm;
    end if; -- else: table-level permission denied is acceptable
  end;
  foreach stmt in array array[
    'select public.vendor_login_set_password(''00000000-0000-4000-8000-0000000000d1'', ''Test1234'')',
    'select public.vendor_login_reveal(''00000000-0000-4000-8000-0000000000d1'')'] loop
    begin
      execute stmt;
      raise exception 'case anon on an RPC must error failed: %', stmt;
    exception when others then
      if sqlstate <> '42501' or sqlerrm not ilike '%permission denied for function%' then -- expected: no execute
        raise exception 'case anon on an RPC: expected 42501 permission denied for function, got % (%) for %', sqlstate, sqlerrm, stmt;
      end if;
    end;
  end loop;
end $$;

-- ================================================================ runner: nothing was deleted, the refused writes changed nothing

reset role;
set local request.jwt.claims = '';
do $$ declare has_vault boolean := current_setting('rls_vendor_logins.has_vault') = 'true'; begin
  if not ((select count(*) from public.vendors where id in ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000d3')) = 3
          and (select count(*) from public.vendor_logins) = 3) then
    raise exception 'case the refused delete removed nothing failed';
  end if;
  if not ((select string_agg(l.vendor_id::text || '=' || l.username || '/' || l.status || '/' || l.pw_mode || '/' || coalesce(l.created_by, '∅') || '/' || v.status, ',' order by l.vendor_id)
           from public.vendor_logins l join public.vendors v on v.id = l.vendor_id)
          = '00000000-0000-4000-8000-0000000000d1=nour.store/invited/' || case when has_vault then 'temp' else 'link' end || '/أدمن الدخول/leave,'
            || '00000000-0000-4000-8000-0000000000d2=qamar.store/disabled/link/السيرفر/leave,'
            || '00000000-0000-4000-8000-0000000000d3=tikrar.store/invited/' || case when has_vault then 'temp' else 'link' end || '/متابعة الدخول/active') then
    raise exception 'case the final rows match the accepted writes only failed: %',
      (select string_agg(l.vendor_id::text || '=' || l.username || '/' || l.status || '/' || l.pw_mode || '/' || coalesce(l.created_by, '∅') || '/' || v.status, ',' order by l.vendor_id)
       from public.vendor_logins l join public.vendors v on v.id = l.vendor_id);
  end if;
  -- the activity rows of this file (scoped to its makers: a live re-run finds real vendor.login.* rows of other makers):
  -- with Vault 2 + 3 by the admin and 1 + 1 by vendors follow-up, else none
  if not ((select count(*) from public.activity_log where action like 'vendor.login.%' and entity_id in ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000d3')) = case when has_vault then 7 else 0 end
          and (select count(*) from public.activity_log where action like 'vendor.login.%' and entity_id in ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000d3') and actor = '00000000-0000-4000-8000-000000000052')
              = case when has_vault then 2 else 0 end) then
    raise exception 'case every accepted RPC call and no refused one left an activity_log row failed';
  end if;
end $$;

rollback;

do $$ begin raise notice 'rls_vendor_logins: ok'; end $$;
