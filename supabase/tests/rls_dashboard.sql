-- RLS / permission tests for 0006_dashboard (user_prefs, alert_reads, own rows in activity_log).
-- Depends on 0001_identity + 0002_system + 0003_seed_roles + 0004_grants + 0005_advisors + 0006_dashboard.
-- Runs in one transaction and rolls back; prints NOTICE 'rls_dashboard: ok' only if every case passed.
-- Each case switches role explicitly: the runner (postgres) owns the tables and bypasses RLS.
-- Besides the policies it runs the statements the app sends through PostgREST: the prefs save (insert … on conflict
-- (user_id, key) do update), the read mark (plain insert; a duplicate is 23505) and mark-all (insert … on conflict do nothing).
-- No statement here removes rows or objects, so it runs live through the Supabase MCP's execute_sql unchanged.

begin;

-- Test users (fixed UUIDs, same values as rls_identity.sql): admin, ops, suspended viewer, cs.
insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-000000000001', 'admin-one.dev@ibtekr-local.test', '01000000001'),
  ('00000000-0000-4000-8000-000000000002', 'ops.dev@ibtekr.local',            '01000000002'),
  ('00000000-0000-4000-8000-000000000003', 'viewer.dev@ibtekr.local',         '01000000003'),
  ('00000000-0000-4000-8000-000000000004', 'cs.dev@ibtekr.local',             '01000000004');

insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email)
from auth.users u
where u.id in ('00000000-0000-4000-8000-000000000001',
               '00000000-0000-4000-8000-000000000002',
               '00000000-0000-4000-8000-000000000003',
               '00000000-0000-4000-8000-000000000004');

insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-000000000001', 'أدمن تجريبي',   'admin-one.dev@ibtekr-local.test', '01000000001', 'admin',  'active',    '{"orders.edit":"N"}'),
  ('00000000-0000-4000-8000-000000000002', 'عمليات تجريبي', 'ops.dev@ibtekr.local',            '01000000002', 'ops',    'active',    '{"orders.edit":"F","orders.status":"N"}'),
  ('00000000-0000-4000-8000-000000000003', 'مشاهد موقوف',   'viewer.dev@ibtekr.local',         '01000000003', 'viewer', 'suspended', '{}'),
  ('00000000-0000-4000-8000-000000000004', 'خدمة عملاء',    'cs.dev@ibtekr.local',             '01000000004', 'cs',     'active',    '{}');

-- Prefs rows written by the trusted runner: the admin's (ops must not see it) and the suspended
-- viewer's (so "sees zero" is meaningful).
insert into public.user_prefs (user_id, key, data) values
  ('00000000-0000-4000-8000-000000000001', 'dashboard', '{}'),
  ('00000000-0000-4000-8000-000000000003', 'dashboard', '{}');

-- Alerts: one for the ops role, one for the cs role, one addressed to the admin, one addressed to the ops user.
insert into public.alerts (kind, title, role_id) values
  ('stock.cons.late', 'تجميع متأخر',             'ops'),
  ('woo.sync.failed', 'فشل مزامنة WooCommerce', 'cs');
insert into public.alerts (kind, title, user_id) values
  ('system.backup.off', 'النسخ الاحتياطي مقفول', '00000000-0000-4000-8000-000000000001'),
  ('vendor.late',       'مورد متأخر',             '00000000-0000-4000-8000-000000000002');

-- Their ids, read back by every role below (a user cannot look up an alert they cannot see).
do $$ begin
  perform set_config('t.a_ops',   (select id from public.alerts where title = 'تجميع متأخر')::text, true);
  perform set_config('t.a_cs',    (select id from public.alerts where title = 'فشل مزامنة WooCommerce')::text, true);
  perform set_config('t.a_admin', (select id from public.alerts where title = 'النسخ الاحتياطي مقفول')::text, true);
  perform set_config('t.a_ops_user', (select id from public.alerts where title = 'مورد متأخر')::text, true);
end $$;

-- ================================================================ user_prefs

-- ---- ops: own row only ----
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}';
do $$ declare n int; begin
  insert into public.user_prefs (user_id, key, data)
    values ('00000000-0000-4000-8000-000000000002', 'dashboard', '{"hidden":["team"]}');
  get diagnostics n = row_count;
  if not (n = 1) then raise exception 'case ops inserts own user_prefs row failed'; end if;

  if not ((select count(*) from public.user_prefs) = 1) then
    raise exception 'case ops reads only own user_prefs (admin row hidden) failed';
  end if;

  -- updated_at is stamped by the trigger, whatever was passed.
  update public.user_prefs set data = '{"hidden":[]}', updated_at = '2000-01-01'
    where user_id = auth.uid() and key = 'dashboard';
  get diagnostics n = row_count;
  if not (n = 1) then raise exception 'case ops updates own user_prefs row failed'; end if;
  if not exists (select 1 from public.user_prefs
                 where user_id = auth.uid() and key = 'dashboard'
                   and data = '{"hidden":[]}'::jsonb and updated_at >= now()) then
    raise exception 'case user_prefs updated_at stamped by the trigger (>= now()) failed';
  end if;
end $$;

-- The app's save (IBPrefs.set: PostgREST upsert on (user_id, key)), run twice on a fresh key: the first inserts, the
-- second updates, and one row is left with the newer data.
do $$ declare n int; begin
  insert into public.user_prefs (user_id, key, data)
    values ('00000000-0000-4000-8000-000000000002', 'dash.upsert', '{"hidden":["team"]}')
    on conflict (user_id, key) do update set data = excluded.data;
  get diagnostics n = row_count;
  if not (n = 1) then raise exception 'case ops prefs upsert, first run inserts failed'; end if;

  insert into public.user_prefs (user_id, key, data)
    values ('00000000-0000-4000-8000-000000000002', 'dash.upsert', '{"hidden":[],"order":["kpis"]}')
    on conflict (user_id, key) do update set data = excluded.data;
  get diagnostics n = row_count;
  if not (n = 1) then raise exception 'case ops prefs upsert, second run updates failed'; end if;

  if not ((select count(*) from public.user_prefs where user_id = auth.uid() and key = 'dash.upsert') = 1
          and (select data from public.user_prefs where user_id = auth.uid() and key = 'dash.upsert')
              = '{"hidden":[],"order":["kpis"]}'::jsonb) then
    raise exception 'case ops prefs upsert twice leaves one row with the new data failed';
  end if;
end $$;

-- updated_at is stamped on INSERT too, whatever was passed.
do $$ begin
  insert into public.user_prefs (user_id, key, data, updated_at)
    values ('00000000-0000-4000-8000-000000000002', 'dash.forged', '{}', '2000-01-01');
  if not exists (select 1 from public.user_prefs
                 where user_id = auth.uid() and key = 'dash.forged' and updated_at >= now()) then
    raise exception 'case user_prefs forged updated_at on insert stamped by the trigger (>= now()) failed';
  end if;
end $$;

do $$ begin
  begin
    insert into public.user_prefs (user_id, key, data)
      values ('00000000-0000-4000-8000-000000000001', 'dashboard', '{"hidden":["need"]}');
  exception when others then
    if sqlstate = '42501' then return; end if; -- expected: RLS with check, owner only
    raise exception 'case ops inserts user_prefs for the admin: expected 42501, got % (%)', sqlstate, sqlerrm;
  end;
  raise exception 'case ops inserts user_prefs for the admin must error failed';
end $$;

do $$ begin
  begin
    insert into public.user_prefs (user_id, key, data)
      values ('00000000-0000-4000-8000-000000000002', 'Dash board', '{}');
  exception when others then
    if sqlstate = '23514' then return; end if; -- expected: key format check
    raise exception 'case user_prefs key format check: expected 23514, got % (%)', sqlstate, sqlerrm;
  end;
  raise exception 'case user_prefs key format check must error failed';
end $$;

-- ---- suspended viewer: blocked ----
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated"}';
do $$ begin
  begin
    insert into public.user_prefs (user_id, key, data)
      values ('00000000-0000-4000-8000-000000000003', 'notes', '{}');
  exception when others then
    if sqlstate = '42501' then return; end if; -- expected: RLS with check requires an active profile
    raise exception 'case suspended viewer inserts own user_prefs: expected 42501, got % (%)', sqlstate, sqlerrm;
  end;
  raise exception 'case suspended viewer inserts own user_prefs must error failed';
end $$;

do $$ begin
  if not ((select count(*) from public.user_prefs) = 0) then
    raise exception 'case suspended viewer reads zero user_prefs (own row exists) failed';
  end if;
end $$;

-- ================================================================ alert_reads

-- ---- ops: marks read only an alert it can see, for itself ----
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}';
do $$ declare n int; begin
  if not ((select count(*) from public.alerts) = 2
          and exists (select 1 from public.alerts where id = current_setting('t.a_ops')::bigint)
          and exists (select 1 from public.alerts where id = current_setting('t.a_ops_user')::bigint)) then
    raise exception 'case ops sees only the ops role alert and the alert addressed to ops failed';
  end if;

  insert into public.alert_reads (alert_id, user_id)
    values (current_setting('t.a_ops')::bigint, '00000000-0000-4000-8000-000000000002');
  get diagnostics n = row_count;
  if not (n = 1) then raise exception 'case ops marks the ops alert read failed'; end if;
end $$;

-- The same plain insert again (markRead, already read on another device): 23505, which the app counts as done.
do $$ begin
  begin
    insert into public.alert_reads (alert_id, user_id)
      values (current_setting('t.a_ops')::bigint, '00000000-0000-4000-8000-000000000002');
  exception when others then
    if sqlstate = '23505' then return; end if; -- expected: primary key (alert_id, user_id)
    raise exception 'case ops duplicate read mark: expected 23505, got % (%)', sqlstate, sqlerrm;
  end;
  raise exception 'case ops duplicate read mark must error failed';
end $$;

-- markAllRead (PostgREST upsert with ignoreDuplicates), run twice: one row; the second run inserts nothing.
do $$ declare n int; begin
  insert into public.alert_reads (alert_id, user_id)
    values (current_setting('t.a_ops_user')::bigint, '00000000-0000-4000-8000-000000000002')
    on conflict (alert_id, user_id) do nothing;
  get diagnostics n = row_count;
  if not (n = 1) then raise exception 'case ops mark-all on conflict do nothing, first run inserts failed'; end if;

  insert into public.alert_reads (alert_id, user_id)
    values (current_setting('t.a_ops_user')::bigint, '00000000-0000-4000-8000-000000000002')
    on conflict (alert_id, user_id) do nothing;
  get diagnostics n = row_count;
  if not (n = 0) then raise exception 'case ops mark-all on conflict do nothing, second run row_count 0 failed'; end if;

  if not ((select count(*) from public.alert_reads
           where alert_id = current_setting('t.a_ops_user')::bigint and user_id = auth.uid()) = 1) then
    raise exception 'case ops mark-all twice leaves one row failed';
  end if;
end $$;

do $$ begin
  begin
    insert into public.alert_reads (alert_id, user_id)
      values (current_setting('t.a_cs')::bigint, '00000000-0000-4000-8000-000000000002');
  exception when others then
    if sqlstate = '42501' then return; end if; -- expected: the cs alert is not visible to ops
    raise exception 'case ops marks the cs alert read: expected 42501, got % (%)', sqlstate, sqlerrm;
  end;
  raise exception 'case ops marks the cs alert read must error failed';
end $$;

do $$ begin
  begin
    insert into public.alert_reads (alert_id, user_id)
      values (current_setting('t.a_ops')::bigint, '00000000-0000-4000-8000-000000000001');
  exception when others then
    if sqlstate = '42501' then return; end if; -- expected: a read mark is for the caller only
    raise exception 'case ops marks the ops alert read for the admin: expected 42501, got % (%)', sqlstate, sqlerrm;
  end;
  raise exception 'case ops marks the ops alert read for the admin must error failed';
end $$;

do $$ begin
  begin
    update public.alert_reads set read_at = now() where alert_id is not null;
  exception when others then
    if sqlstate = '42501' then return; end if; -- expected: no update grant (select and insert only)
    raise exception 'case ops updates alert_reads: expected 42501, got % (%)', sqlstate, sqlerrm;
  end;
  raise exception 'case ops updates alert_reads must error failed';
end $$;

do $$ begin
  if not ((select count(*) from public.alert_reads) = 2) then
    raise exception 'case ops reads own alert_reads (2 rows) failed';
  end if;
end $$;

-- ---- admin: other users' read marks are not visible ----
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$ begin
  if not ((select count(*) from public.alert_reads) = 0) then
    raise exception 'case admin reads zero alert_reads (ops row hidden) failed';
  end if;
end $$;

-- ---- suspended viewer: cannot mark any alert read ----
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated"}';
do $$ declare a bigint; refused boolean; begin
  foreach a in array array[current_setting('t.a_ops')::bigint,
                           current_setting('t.a_cs')::bigint,
                           current_setting('t.a_admin')::bigint,
                           current_setting('t.a_ops_user')::bigint] loop
    refused := false;
    begin
      insert into public.alert_reads (alert_id, user_id)
        values (a, '00000000-0000-4000-8000-000000000003');
    exception when others then
      if sqlstate <> '42501' then
        raise exception 'case suspended viewer marks alert % read: expected 42501, got % (%)', a, sqlstate, sqlerrm;
      end if;
      refused := true; -- expected: no alert is visible to a suspended user
    end;
    if not refused then raise exception 'case suspended viewer marks alert % read must error failed', a; end if;
  end loop;
end $$;

-- ================================================================ activity_log

-- ---- cs (settings.view = N) logs twice, ops once ----
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}';
do $$ begin
  perform public.log_activity('dashboard.customize', null, null, null, '"7 كارت"');
  perform public.log_activity('dashboard.customize', null, null, null, '"7 كارت"');
end $$;

-- ---- ops (settings.view = P): reads every row ----
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}';
do $$ begin
  perform public.log_activity('dashboard.customize', null, null, null, '"7 كارت"');
  if not ((select count(*) from public.activity_log) >= 3) then
    raise exception 'case ops (settings.view P) reads all activity_log rows failed';
  end if;
end $$;

-- ---- cs: own rows only ----
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}';
do $$ begin
  if not ((select count(*) from public.activity_log) = 2) then
    raise exception 'case cs (settings.view N) reads own activity_log rows (2) failed';
  end if;
  if exists (select 1 from public.activity_log where actor is distinct from '00000000-0000-4000-8000-000000000004') then
    raise exception 'case cs reads only rows with actor = cs failed';
  end if;
end $$;

-- ---- admin: reads every row ----
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$ begin
  if not ((select count(*) from public.activity_log) >= 3) then
    raise exception 'case admin reads all activity_log rows failed';
  end if;
end $$;

-- ---- cs suspended: loses its own rows, and its role alert can no longer be marked read ----
reset role;
update public.profiles set status = 'suspended' where id = '00000000-0000-4000-8000-000000000004';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}';
do $$ begin
  if not ((select count(*) from public.activity_log) = 0) then
    raise exception 'case suspended cs reads zero activity_log rows failed';
  end if;
end $$;

do $$ begin
  begin
    insert into public.alert_reads (alert_id, user_id)
      values (current_setting('t.a_cs')::bigint, '00000000-0000-4000-8000-000000000004');
  exception when others then
    if sqlstate = '42501' then return; end if; -- expected: alerts_select requires an active profile
    raise exception 'case suspended cs marks its role alert read: expected 42501, got % (%)', sqlstate, sqlerrm;
  end;
  raise exception 'case suspended cs marks its role alert read must error failed';
end $$;

reset role;
rollback;

do $$ begin raise notice 'rls_dashboard: ok'; end $$;
