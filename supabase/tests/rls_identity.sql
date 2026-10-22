-- RLS / permission tests for 0001_identity + 0003_seed_roles.
-- Runs in one transaction and rolls back; prints NOTICE 'rls_identity: ok' only if every case passed.
-- Each case switches role explicitly: the runner (postgres) owns the tables and bypasses RLS.

begin;

-- Test users (fixed UUIDs): admin, ops with an override, suspended viewer.
insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-000000000001', 'admin.dev@ibtekr.local',  '01000000001'),
  ('00000000-0000-4000-8000-000000000002', 'ops.dev@ibtekr.local',    '01000000002'),
  ('00000000-0000-4000-8000-000000000003', 'viewer.dev@ibtekr.local', '01000000003');

insert into auth.identities (user_id, provider, provider_id, identity_data) values
  ('00000000-0000-4000-8000-000000000001', 'email', '00000000-0000-4000-8000-000000000001', '{"email":"admin.dev@ibtekr.local"}'),
  ('00000000-0000-4000-8000-000000000002', 'email', '00000000-0000-4000-8000-000000000002', '{"email":"ops.dev@ibtekr.local"}'),
  ('00000000-0000-4000-8000-000000000003', 'email', '00000000-0000-4000-8000-000000000003', '{"email":"viewer.dev@ibtekr.local"}');

insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-000000000001', 'أدمن تجريبي',   'admin.dev@ibtekr.local',  '01000000001', 'admin',  'active',    '{}'),
  ('00000000-0000-4000-8000-000000000002', 'عمليات تجريبي', 'ops.dev@ibtekr.local',    '01000000002', 'ops',    'active',    '{"orders.edit":"F"}'),
  ('00000000-0000-4000-8000-000000000003', 'مشاهد موقوف',   'viewer.dev@ibtekr.local', '01000000003', 'viewer', 'suspended', '{}');

-- ---- admin ----
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$ begin
  if not (public.has_perm('orders.edit') = 'F') then raise exception 'case admin orders.edit = F failed'; end if;
end $$;

-- ---- ops (override orders.edit = F) ----
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}';
do $$ begin
  if not (public.has_perm('orders.edit') = 'F') then raise exception 'case ops orders.edit = F (override) failed'; end if;
  if not (public.has_perm('sensitive.commission') = 'N') then raise exception 'case ops sensitive.commission = N failed'; end if;
end $$;

do $$ begin
  begin
    update public.profiles set role_id = 'admin' where id = auth.uid();
  exception when others then
    return; -- expected: non-admin cannot change role_id
  end;
  raise exception 'case ops update own role_id must error failed';
end $$;

do $$ declare n int; begin
  update public.profiles set name = 'عمليات معدّل' where id = auth.uid();
  get diagnostics n = row_count;
  if not (n = 1) then raise exception 'case ops update own name failed'; end if;
end $$;

-- ---- suspended viewer ----
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated"}';
do $$ begin
  if not (public.has_perm('orders.edit') = 'N') then raise exception 'case viewer orders.edit = N failed'; end if;
  if not ((select count(*) from public.profiles) = 1) then raise exception 'case viewer reads only own profile failed'; end if;
end $$;

-- ---- anon (login screen) ----
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$ begin
  if not exists (select 1 from public.email_for_identifier('01000000002')
                 where email = 'ops.dev@ibtekr.local' and status = 'active') then
    raise exception 'case email_for_identifier(ops phone) = active failed';
  end if;
  if not exists (select 1 from public.email_for_identifier('viewer.dev@ibtekr.local')
                 where email = 'viewer.dev@ibtekr.local' and status = 'suspended') then
    raise exception 'case email_for_identifier(suspended viewer) = suspended failed';
  end if;
  if not ((select count(*) from public.email_for_identifier('01099999999')) = 0) then
    raise exception 'case email_for_identifier(unknown number) = 0 rows failed';
  end if;
  if not ((select count(*) from public.profiles) = 0) then raise exception 'case anon reads no profiles failed'; end if;
end $$;

reset role;
rollback;

do $$ begin raise notice 'rls_identity: ok'; end $$;
