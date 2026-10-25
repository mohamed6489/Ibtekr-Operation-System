-- RLS / permission tests for 0008_mfa_cron (aal2 inside has_perm / is_admin, mark_twofa_enrolled / mark_twofa_disabled,
-- sync_secret_matches). Depends on 0001_identity + 0002_system + 0003_seed_roles + 0004_grants + 0007_orders + 0008_mfa_cron.
-- Runs in one transaction and rolls back; prints NOTICE 'rls_mfa: ok' only if every case passed.
-- Each case switches role explicitly: the runner (postgres) owns the tables and bypasses RLS.
-- The assurance level comes from the JWT claims ("aal"), as auth.jwt() reads them; a claim without "aal" counts as aal1.
-- auth.mfa_factors rows are written by the runner with every NOT NULL column of the live table, so the script runs live
-- through the Supabase MCP's execute_sql unchanged (no statement here removes rows or objects).

begin;

-- Test users (fixed UUIDs): ops and admin enrolled in 2FA (twofa = true), ops and admin without it, an ops user who
-- enrols during the test.
insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-000000000051', 'ops-2fa.dev@ibtekr.local',   '01000000051'),
  ('00000000-0000-4000-8000-000000000052', 'admin-2fa.dev@ibtekr.local', '01000000052'),
  ('00000000-0000-4000-8000-000000000053', 'ops-plain.dev@ibtekr.local', '01000000053'),
  ('00000000-0000-4000-8000-000000000054', 'admin-plain.dev@ibtekr.local', '01000000054'),
  ('00000000-0000-4000-8000-000000000055', 'ops-enrol.dev@ibtekr.local', '01000000055');

insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email)
from auth.users u
where u.id::text like '00000000-0000-4000-8000-00000000005_';

insert into public.profiles (id, name, email, phone, role_id, status, twofa) values
  ('00000000-0000-4000-8000-000000000051', 'عمليات بتحقق',  'ops-2fa.dev@ibtekr.local',     '01000000051', 'ops',   'active', true),
  ('00000000-0000-4000-8000-000000000052', 'أدمن بتحقق',    'admin-2fa.dev@ibtekr.local',   '01000000052', 'admin', 'active', true),
  ('00000000-0000-4000-8000-000000000053', 'عمليات عادي',   'ops-plain.dev@ibtekr.local',   '01000000053', 'ops',   'active', false),
  ('00000000-0000-4000-8000-000000000054', 'أدمن عادي',     'admin-plain.dev@ibtekr.local', '01000000054', 'admin', 'active', false),
  ('00000000-0000-4000-8000-000000000055', 'عمليات بيفعّل', 'ops-enrol.dev@ibtekr.local',   '01000000055', 'ops',   'active', false);

-- ================================================================ has_perm / is_admin

-- ---- ops with twofa: aal1 → nothing ----
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000051","role":"authenticated","aal":"aal1"}';
do $$ begin
  if not (public.has_perm('orders.view') = 'N') then raise exception 'case twofa ops at aal1: has_perm(orders.view) = N failed'; end if;
  if not (public.has_perm('settings.view') = 'N') then raise exception 'case twofa ops at aal1: has_perm(settings.view) = N failed'; end if;
  if public.is_admin() then raise exception 'case twofa ops at aal1: is_admin() = false failed'; end if;
  -- the gate reaches every policy through has_perm: own profile row only (settings.view is N now), no orders
  if not ((select count(*) from public.profiles) = 1) then raise exception 'case twofa ops at aal1 reads only its own profile row failed'; end if;
end $$;

-- ---- same user, claims without "aal" → treated as aal1 ----
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000051","role":"authenticated"}';
do $$ begin
  if not (public.has_perm('orders.view') = 'N') then raise exception 'case twofa ops without an aal claim: has_perm(orders.view) = N failed'; end if;
end $$;

-- ---- same user at aal2 → the role's matrix again ----
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000051","role":"authenticated","aal":"aal2"}';
do $$ begin
  if not (public.has_perm('orders.view') = 'F') then raise exception 'case twofa ops at aal2: has_perm(orders.view) = F failed'; end if;
  if not (public.has_perm('settings.view') = 'P') then raise exception 'case twofa ops at aal2: has_perm(settings.view) = P failed'; end if;
  if public.is_admin() then raise exception 'case twofa ops at aal2: is_admin() = false (not an admin) failed'; end if;
  if not ((select count(*) from public.profiles) >= 5) then raise exception 'case twofa ops at aal2 reads every profile (settings.view P) failed'; end if;
end $$;

-- ---- admin with twofa: aal1 → not an admin, nothing; aal2 → admin ----
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000052","role":"authenticated","aal":"aal1"}';
do $$ begin
  if public.is_admin() then raise exception 'case twofa admin at aal1: is_admin() = false failed'; end if;
  if not (public.has_perm('orders.view') = 'N') then raise exception 'case twofa admin at aal1: has_perm(orders.view) = N failed'; end if;
end $$;

-- an aal1 session cannot switch the rule off: twofa is admin-only (profiles_guard_update) and is_admin() is false here
do $$ begin
  begin
    update public.profiles set twofa = false where id = auth.uid();
  exception when others then
    if sqlstate = '42501' then return; end if; -- expected
    raise exception 'case twofa admin at aal1 clears own twofa: expected 42501, got % (%)', sqlstate, sqlerrm;
  end;
  raise exception 'case twofa admin at aal1 clears own twofa must error failed';
end $$;

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000052","role":"authenticated","aal":"aal2"}';
do $$ begin
  if not public.is_admin() then raise exception 'case twofa admin at aal2: is_admin() = true failed'; end if;
  if not (public.has_perm('orders.view') = 'F') then raise exception 'case twofa admin at aal2: has_perm(orders.view) = F failed'; end if;
end $$;

-- ---- without twofa, aal1 is enough (nothing changes for them) ----
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000053","role":"authenticated","aal":"aal1"}';
do $$ begin
  if not (public.has_perm('orders.view') = 'F') then raise exception 'case plain ops at aal1: has_perm(orders.view) = F failed'; end if;
  if not (public.has_perm('sensitive.commission') = 'N') then raise exception 'case plain ops at aal1: has_perm(sensitive.commission) = N failed'; end if;
end $$;

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000054","role":"authenticated","aal":"aal1"}';
do $$ begin
  if not public.is_admin() then raise exception 'case plain admin at aal1: is_admin() = true failed'; end if;
  if not (public.has_perm('orders.view') = 'F') then raise exception 'case plain admin at aal1: has_perm(orders.view) = F failed'; end if;
end $$;

-- ================================================================ mark_twofa_enrolled / mark_twofa_disabled

-- ---- enrolling user: aal1 → 42501 aal2_required ----
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000055","role":"authenticated","aal":"aal1"}';
do $$ begin
  begin
    perform public.mark_twofa_enrolled();
  exception when others then
    if sqlstate = '42501' and sqlerrm = 'aal2_required' then return; end if; -- expected
    raise exception 'case mark_twofa_enrolled at aal1: expected 42501 aal2_required, got % (%)', sqlstate, sqlerrm;
  end;
  raise exception 'case mark_twofa_enrolled at aal1 must error failed';
end $$;

-- ---- aal2 but no factor at all → 42501 ----
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000055","role":"authenticated","aal":"aal2"}';
do $$ begin
  begin
    perform public.mark_twofa_enrolled();
  exception when others then
    if sqlstate = '42501' and sqlerrm = 'aal2_required' then return; end if; -- expected
    raise exception 'case mark_twofa_enrolled at aal2 without a factor: expected 42501 aal2_required, got % (%)', sqlstate, sqlerrm;
  end;
  raise exception 'case mark_twofa_enrolled at aal2 without a factor must error failed';
end $$;

-- ---- aal2 with an unverified factor only (enrolment not finished) → 42501 ----
reset role;
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at) values
  ('00000000-0000-4000-8000-0000000005f1', '00000000-0000-4000-8000-000000000055', 'Authenticator', 'totp', 'unverified', now(), now());
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000055","role":"authenticated","aal":"aal2"}';
do $$ begin
  begin
    perform public.mark_twofa_enrolled();
  exception when others then
    if sqlstate = '42501' and sqlerrm = 'aal2_required' then return; end if; -- expected
    raise exception 'case mark_twofa_enrolled with an unverified factor: expected 42501 aal2_required, got % (%)', sqlstate, sqlerrm;
  end;
  raise exception 'case mark_twofa_enrolled with an unverified factor must error failed';
end $$;

-- ---- another user's verified factor does not count ----
reset role;
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at) values
  ('00000000-0000-4000-8000-0000000005f2', '00000000-0000-4000-8000-000000000053', 'Authenticator', 'totp', 'verified', now(), now());
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000055","role":"authenticated","aal":"aal2"}';
do $$ begin
  begin
    perform public.mark_twofa_enrolled();
  exception when others then
    if sqlstate = '42501' then return; end if; -- expected
    raise exception 'case mark_twofa_enrolled with someone else''s verified factor: expected 42501, got % (%)', sqlstate, sqlerrm;
  end;
  raise exception 'case mark_twofa_enrolled with someone else''s verified factor must error failed';
end $$;
reset role;
do $$ begin
  if (select twofa from public.profiles where id = '00000000-0000-4000-8000-000000000055') then
    raise exception 'case refused mark_twofa_enrolled leaves twofa false failed';
  end if;
end $$;

-- ---- aal2 with its own verified factor → twofa = true, own row only ----
update auth.mfa_factors set status = 'verified', updated_at = now() where id = '00000000-0000-4000-8000-0000000005f1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000055","role":"authenticated","aal":"aal2"}';
do $$ begin
  perform public.mark_twofa_enrolled();
end $$;
reset role;
do $$ begin
  if not (select twofa from public.profiles where id = '00000000-0000-4000-8000-000000000055') then
    raise exception 'case mark_twofa_enrolled at aal2 with a verified factor sets twofa = true failed';
  end if;
  if (select twofa from public.profiles where id = '00000000-0000-4000-8000-000000000053') then
    raise exception 'case mark_twofa_enrolled changes only the caller''s profile failed';
  end if;
end $$;

-- ---- now enrolled: aal1 loses everything, mark_twofa_disabled at aal1 → 42501 ----
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000055","role":"authenticated","aal":"aal1"}';
do $$ begin
  if not (public.has_perm('orders.view') = 'N') then raise exception 'case freshly enrolled ops at aal1: has_perm(orders.view) = N failed'; end if;
  begin
    perform public.mark_twofa_disabled();
  exception when others then
    if sqlstate = '42501' and sqlerrm = 'aal2_required' then return; end if; -- expected
    raise exception 'case mark_twofa_disabled at aal1: expected 42501 aal2_required, got % (%)', sqlstate, sqlerrm;
  end;
  raise exception 'case mark_twofa_disabled at aal1 must error failed';
end $$;
reset role;
do $$ begin
  if not (select twofa from public.profiles where id = '00000000-0000-4000-8000-000000000055') then
    raise exception 'case refused mark_twofa_disabled leaves twofa true failed';
  end if;
end $$;

-- ---- mark_twofa_disabled at aal2 → twofa = false ----
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000055","role":"authenticated","aal":"aal2"}';
do $$ begin
  perform public.mark_twofa_disabled();
end $$;
reset role;
do $$ begin
  if (select twofa from public.profiles where id = '00000000-0000-4000-8000-000000000055') then
    raise exception 'case mark_twofa_disabled at aal2 sets twofa = false failed';
  end if;
end $$;

-- ---- anon: no execute on the 2FA RPCs ----
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$ begin
  begin
    perform public.mark_twofa_enrolled();
  exception when others then
    if sqlstate = '42501' then return; end if; -- expected: permission denied for function
    raise exception 'case anon mark_twofa_enrolled: expected 42501, got % (%)', sqlstate, sqlerrm;
  end;
  raise exception 'case anon mark_twofa_enrolled must error failed';
end $$;

-- ================================================================ sync_secret_matches

-- ---- authenticated: no execute (42501) ----
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000054","role":"authenticated","aal":"aal2"}';
do $$ begin
  begin
    perform public.sync_secret_matches('anything');
  exception when others then
    if sqlstate = '42501' then return; end if; -- expected: permission denied for function
    raise exception 'case authenticated sync_secret_matches: expected 42501, got % (%)', sqlstate, sqlerrm;
  end;
  raise exception 'case authenticated sync_secret_matches must error failed';
end $$;

-- ---- service_role: a wrong, empty or null candidate is false (without Vault, every candidate is) ----
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
do $$ begin
  if public.sync_secret_matches('not-the-secret') is distinct from false then raise exception 'case service_role sync_secret_matches(wrong) = false failed'; end if;
  if public.sync_secret_matches('') is distinct from false then raise exception 'case service_role sync_secret_matches(empty) = false failed'; end if;
  if public.sync_secret_matches(null) is distinct from false then raise exception 'case service_role sync_secret_matches(null) = false failed'; end if;
end $$;

-- ================================================================ grants and function attributes

reset role;
do $$
declare f text;
begin
  -- has_perm / is_admin: grants exactly as in 0001
  if has_function_privilege('anon', 'public.has_perm(text)', 'execute') then raise exception 'case anon has no execute on has_perm failed'; end if;
  if has_function_privilege('anon', 'public.is_admin()', 'execute') then raise exception 'case anon has no execute on is_admin failed'; end if;
  if not has_function_privilege('authenticated', 'public.has_perm(text)', 'execute') then raise exception 'case authenticated executes has_perm failed'; end if;
  if not has_function_privilege('service_role', 'public.is_admin()', 'execute') then raise exception 'case service_role executes is_admin failed'; end if;
  -- the 2FA RPCs: authenticated only
  foreach f in array array['public.mark_twofa_enrolled()', 'public.mark_twofa_disabled()'] loop
    if not has_function_privilege('authenticated', f, 'execute') then raise exception 'case authenticated executes % failed', f; end if;
    if has_function_privilege('anon', f, 'execute') then raise exception 'case anon has no execute on % failed', f; end if;
    if has_function_privilege('service_role', f, 'execute') then raise exception 'case service_role has no execute on % failed', f; end if;
  end loop;
  -- sync_secret_matches: service_role only
  if not has_function_privilege('service_role', 'public.sync_secret_matches(text)', 'execute') then raise exception 'case service_role executes sync_secret_matches failed'; end if;
  if has_function_privilege('anon', 'public.sync_secret_matches(text)', 'execute') then raise exception 'case anon has no execute on sync_secret_matches failed'; end if;
  if has_function_privilege('authenticated', 'public.sync_secret_matches(text)', 'execute') then raise exception 'case authenticated has no execute on sync_secret_matches failed'; end if;
  -- every function of 0008 (and the two redefined ones) is security definer with a fixed search_path
  foreach f in array array['public.has_perm(text)', 'public.is_admin()', 'public.mark_twofa_enrolled()', 'public.mark_twofa_disabled()', 'public.sync_secret_matches(text)'] loop
    if not exists (select 1 from pg_proc where oid = f::regprocedure and prosecdef and proconfig @> array['search_path=public']) then
      raise exception 'case % is security definer with search_path=public failed', f;
    end if;
  end loop;
  -- signatures and volatility unchanged
  if not exists (select 1 from pg_proc where oid = 'public.has_perm(text)'::regprocedure and prorettype = 'text'::regtype and provolatile = 's') then
    raise exception 'case has_perm(text) returns text, stable failed';
  end if;
  if not exists (select 1 from pg_proc where oid = 'public.is_admin()'::regprocedure and prorettype = 'boolean'::regtype and provolatile = 's') then
    raise exception 'case is_admin() returns boolean, stable failed';
  end if;
end $$;

reset role;
rollback;

do $$ begin raise notice 'rls_mfa: ok'; end $$;
