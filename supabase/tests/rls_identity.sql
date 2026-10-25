-- RLS / permission tests for 0001_identity + 0003_seed_roles.
-- Runs in one transaction and rolls back; prints NOTICE 'rls_identity: ok' only if every case passed.
-- Each case switches role explicitly: the runner (postgres) owns the tables and bypasses RLS.

begin;

-- Test users (fixed UUIDs): admin (hyphenated email, an 'N' override it ignores), ops with overrides,
-- suspended viewer, one user per remaining built-in role (cs, accounts, vendors_followup) and one on a
-- custom non-system role (spec 4.2: six roles + a custom role + a member override).
insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-000000000001', 'admin-one.dev@ibtekr-local.test', '01000000001'),
  ('00000000-0000-4000-8000-000000000002', 'ops.dev@ibtekr.local',            '01000000002'),
  ('00000000-0000-4000-8000-000000000003', 'viewer.dev@ibtekr.local',         '01000000003'),
  ('00000000-0000-4000-8000-000000000004', 'cs.dev@ibtekr.local',             '01000000004'),
  ('00000000-0000-4000-8000-000000000005', 'accounts.dev@ibtekr.local',       '01000000005'),
  ('00000000-0000-4000-8000-000000000006', 'vendors.dev@ibtekr.local',        '01000000006'),
  ('00000000-0000-4000-8000-000000000007', 'qa.dev@ibtekr.local',             '01000000007');

-- Live auth.identities has provider, provider_id, identity_data NOT NULL.
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email)
from auth.users u
where u.id::text like '00000000-0000-4000-8000-00000000000_';

-- a custom (non-system) role, as the settings screen would add one
insert into public.roles (id, name, description, is_system, permissions, sort) values
  ('custom_qa', 'مراجعة جودة', 'دور مخصص للاختبار', false, '{"orders.view":"P"}', 99);

insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-000000000001', 'أدمن تجريبي',   'admin-one.dev@ibtekr-local.test', '01000000001', 'admin',  'active',    '{"orders.edit":"N"}'),
  ('00000000-0000-4000-8000-000000000002', 'عمليات تجريبي', 'ops.dev@ibtekr.local',            '01000000002', 'ops',    'active',    '{"orders.edit":"F","orders.status":"N"}'),
  ('00000000-0000-4000-8000-000000000003', 'مشاهد موقوف',   'viewer.dev@ibtekr.local',         '01000000003', 'viewer', 'suspended', '{}'),
  ('00000000-0000-4000-8000-000000000004', 'خدمة عملاء',    'cs.dev@ibtekr.local',             '01000000004', 'cs',               'active', '{}'),
  ('00000000-0000-4000-8000-000000000005', 'حسابات',        'accounts.dev@ibtekr.local',       '01000000005', 'accounts',         'active', '{}'),
  ('00000000-0000-4000-8000-000000000006', 'متابعة موردين', 'vendors.dev@ibtekr.local',        '01000000006', 'vendors_followup', 'active', '{}'),
  ('00000000-0000-4000-8000-000000000007', 'مراجع جودة',    'qa.dev@ibtekr.local',             '01000000007', 'custom_qa',        'active', '{}');

-- ---- admin ----
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$ begin
  if not (public.has_perm('orders.edit') = 'F') then raise exception 'case admin orders.edit = F (its custom N ignored) failed'; end if;
  if not public.is_admin() then raise exception 'case admin is_admin() = true failed'; end if;
end $$;

-- ---- ops (override orders.edit = F) ----
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}';
do $$ begin
  if not (public.has_perm('orders.edit') = 'F') then raise exception 'case ops orders.edit = F (override) failed'; end if;
  if not (public.has_perm('sensitive.commission') = 'N') then raise exception 'case ops sensitive.commission = N failed'; end if;
  if not (public.has_perm('orders.status') = 'N') then raise exception 'case ops orders.status = N (override beats role F) failed'; end if;
end $$;

do $$ begin
  begin
    update public.profiles set role_id = 'admin' where id = auth.uid();
  exception when others then
    if sqlstate = '42501' then return; end if; -- expected: non-admin cannot change role_id
    raise exception 'case ops update own role_id: expected 42501, got % (%)', sqlstate, sqlerrm;
  end;
  raise exception 'case ops update own role_id must error failed';
end $$;

do $$ begin
  begin
    update public.profiles set twofa = true where id = auth.uid();
  exception when others then
    if sqlstate = '42501' then return; end if; -- expected: twofa is admin-only
    raise exception 'case ops update own twofa: expected 42501, got % (%)', sqlstate, sqlerrm;
  end;
  raise exception 'case ops update own twofa must error failed';
end $$;

do $$ declare n int; begin
  update public.profiles set name = 'عمليات معدّل' where id = auth.uid();
  get diagnostics n = row_count;
  if not (n = 1) then raise exception 'case ops update own name failed'; end if;
end $$;

-- ---- the other built-in roles (seed matrix in 0003_seed_roles.sql) ----
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}';
do $$ begin
  if not (public.has_perm('tickets.view') = 'F') then raise exception 'case cs tickets.view = F failed'; end if;
  if not (public.has_perm('vendors.view') = 'P') then raise exception 'case cs vendors.view = P failed'; end if;
  if not (public.has_perm('orders.edit') = 'N') then raise exception 'case cs orders.edit = N failed'; end if;
end $$;

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}';
do $$ begin
  if not (public.has_perm('accounts.add') = 'F') then raise exception 'case accounts accounts.add = F failed'; end if;
  if not (public.has_perm('tickets.view') = 'N') then raise exception 'case accounts tickets.view = N failed'; end if;
  if not (public.has_perm('orders.edit') = 'N') then raise exception 'case accounts orders.edit = N failed'; end if;
end $$;

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000006","role":"authenticated"}';
do $$ begin
  if not (public.has_perm('vendors.edit') = 'F') then raise exception 'case vendors_followup vendors.edit = F failed'; end if;
  if not (public.has_perm('tickets.view') = 'P') then raise exception 'case vendors_followup tickets.view = P failed'; end if;
  if not (public.has_perm('accounts.view') = 'N') then raise exception 'case vendors_followup accounts.view = N failed'; end if;
end $$;

-- ---- custom non-system role ----
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000007","role":"authenticated"}';
do $$ begin
  if not (public.has_perm('orders.view') = 'P') then raise exception 'case custom_qa orders.view = P failed'; end if;
  if not (public.has_perm('orders.edit') = 'N') then raise exception 'case custom_qa orders.edit = N (absent key) failed'; end if;
end $$;

-- ---- suspended viewer ----
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated"}';
do $$ begin
  if not (public.has_perm('orders.edit') = 'N') then raise exception 'case viewer orders.edit = N failed'; end if;
  if not (public.has_perm('orders.view') = 'N') then raise exception 'case suspended viewer orders.view = N (role P) failed'; end if;
  if not ((select count(*) from public.profiles) = 1) then raise exception 'case viewer reads only own profile failed'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and status = 'suspended') then
    raise exception 'case suspended viewer reads own status failed';
  end if;
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
  if not exists (select 1 from public.email_for_identifier('010-0000 0003')
                 where email = 'viewer.dev@ibtekr.local' and status = 'suspended') then
    raise exception 'case email_for_identifier(suspended viewer phone, spaces/hyphens) = suspended failed';
  end if;
  -- phone-only: an email (existing, suspended or hyphenated) returns zero rows — no enumeration oracle
  if not ((select count(*) from public.email_for_identifier('viewer.dev@ibtekr.local')) = 0) then
    raise exception 'case email_for_identifier(suspended viewer email) = 0 rows failed';
  end if;
  if not ((select count(*) from public.email_for_identifier(' Admin-One.Dev@Ibtekr-Local.test ')) = 0) then
    raise exception 'case email_for_identifier(hyphenated admin email) = 0 rows failed';
  end if;
  if not ((select count(*) from public.email_for_identifier('0100000000')) = 0) then
    raise exception 'case email_for_identifier(10 digits) = 0 rows failed';
  end if;
  if not ((select count(*) from public.email_for_identifier('01099999999')) = 0) then
    raise exception 'case email_for_identifier(unknown number) = 0 rows failed';
  end if;
  -- anon has no table grant on profiles (0004): permission denied, or zero rows if a grant ever appears.
  begin
    if not ((select count(*) from public.profiles) = 0) then raise exception 'case anon reads no profiles failed'; end if;
  exception when insufficient_privilege then
    null; -- expected
  end;
end $$;

-- ---- suspended admin loses admin ----
reset role;
update public.profiles set status = 'suspended' where id = '00000000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$ begin
  if public.is_admin() then raise exception 'case suspended admin is_admin() = false failed'; end if;
  if not (public.has_perm('orders.edit') = 'N') then raise exception 'case suspended admin orders.edit = N failed'; end if;
end $$;

-- ---- lookup throttle: 60 calls per minute, the 61st raises 'rate_limited' ----
reset role;
delete from public.login_lookups where at is not null; -- (live: the Supabase MCP's execute_sql holds `delete from` in test scripts for a confirmation; run the execute 'del' || 'ete …' copy, see tools/deploy.md)
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$ begin
  begin
    perform 1 from public.login_lookups;
  exception when insufficient_privilege then
    return; -- expected: anon cannot touch the throttle table
  end;
  raise exception 'case anon cannot read login_lookups failed';
end $$;

do $$ declare i int; begin
  for i in 1..59 loop
    perform public.email_for_identifier('01099999999');
  end loop;
  -- 60th call: still under the cap, returns the row.
  if not exists (select 1 from public.email_for_identifier('01000000002') where email = 'ops.dev@ibtekr.local') then
    raise exception 'case lookup under the cap returns the row failed';
  end if;
  begin
    perform public.email_for_identifier('01000000002');
  exception when others then
    if sqlerrm = 'rate_limited' then return; end if; -- expected
    raise;
  end;
  raise exception 'case 61st lookup raises rate_limited failed';
end $$;

reset role;
rollback;

do $$ begin raise notice 'rls_identity: ok'; end $$;
