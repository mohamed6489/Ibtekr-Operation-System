-- Tests for 0102_login_lock (owner batch 2 decision 27): the login lock counter on the server. One transaction, rolled back;
-- NOTICE 'rls_login_lock: ok' only if every case passed. Live-safe: made-up members, the settings row and the counters roll back.
-- * the policy from settings «security» (3 attempts, 5 minutes here); a member's phone shares his email's counter
-- * login_gate / login_failed for anon; the lock after N failures; login_cleared for the member himself
-- * login_locks / login_unlock for the admin only; the table is closed to everyone but the server

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000102a1', 'll-adm.dev@ibtekr.local', '01000102a01'),
  ('00000000-0000-4000-8000-0000000102a2', 'll-mem.dev@ibtekr.local', '01000102a02');
insert into public.profiles (id, name, email, phone, role_id, status) values
  ('00000000-0000-4000-8000-0000000102a1', 'أدمن القفل', 'll-adm.dev@ibtekr.local', '01000102101', 'admin', 'active'),
  ('00000000-0000-4000-8000-0000000102a2', 'عضو القفل', 'll-mem.dev@ibtekr.local', '01000102102', 'cs', 'active');
delete from public.settings where section = 'security';
insert into public.settings (section, data) values ('security', '{"lockAttempts": 3, "lockMinutes": 5}');
delete from public.login_lookups;

do $$ begin
  if has_table_privilege('anon', 'public.login_failures', 'SELECT') or has_table_privilege('authenticated', 'public.login_failures', 'SELECT') then
    raise exception 'case the counters are closed to the members failed'; end if;
  if has_function_privilege('anon', 'public.login_unlock(uuid)', 'EXECUTE') or has_function_privilege('authenticated', 'public.login_key(text)', 'EXECUTE') then
    raise exception 'case the admin and helper functions are not anon failed'; end if;
end $$;

-- anon: two wrong passwords, the third locks (by email, then by the phone of the same member)
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$ declare r jsonb; begin
  r := public.login_failed('LL-MEM.dev@ibtekr.local ');
  if (r ->> 'locked')::boolean or (r ->> 'left')::int <> 2 then raise exception 'case the first failure leaves 2 failed (%)', r; end if;
  r := public.login_failed('01000102102'); -- his phone counts on his email
  if (r ->> 'left')::int <> 1 then raise exception 'case the phone shares the email counter failed (%)', r; end if;
  if (public.login_gate('ll-mem.dev@ibtekr.local') ->> 'locked')::boolean then raise exception 'case not locked yet failed'; end if;
  r := public.login_failed('ll-mem.dev@ibtekr.local');
  if not (r ->> 'locked')::boolean or (r ->> 'minutes')::int <> 5 then raise exception 'case the third failure locks for 5 minutes failed (%)', r; end if;
  r := public.login_gate('01000102102');
  if not (r ->> 'locked')::boolean or (r ->> 'minutes')::int not between 1 and 5 then raise exception 'case the gate says locked by the phone too failed (%)', r; end if;
  -- an unknown identifier counts as itself (the same answers — no account oracle)
  r := public.login_failed('nobody.dev@ibtekr.local');
  if (r ->> 'left')::int <> 2 then raise exception 'case an unknown identifier counts too failed (%)', r; end if;
end $$;
reset role;

-- the member: login_cleared clears his own counter only; the admin functions refuse him
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000102a2', 'role', 'authenticated', 'aal', 'aal2')::text, true);
set local role authenticated;
do $$ begin
  begin perform public.login_locks(); raise exception 'case a member cannot list the locks failed'; exception when insufficient_privilege then null; end;
  begin perform public.login_unlock('00000000-0000-4000-8000-0000000102a2'); raise exception 'case a member cannot unlock failed'; exception when insufficient_privilege then null; end;
end $$;
reset role;

-- the admin: sees the locked member and unlocks him (logged)
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000102a1', 'role', 'authenticated', 'aal', 'aal2')::text, true);
set local role authenticated;
do $$ begin
  if not exists (select 1 from public.login_locks() where member_id = '00000000-0000-4000-8000-0000000102a2') then raise exception 'case the admin sees the lock failed'; end if;
  if not public.login_unlock('00000000-0000-4000-8000-0000000102a2') then raise exception 'case the unlock removes the counter failed'; end if;
  if exists (select 1 from public.login_locks()) then raise exception 'case nothing locked after the unlock failed'; end if;
end $$;
reset role;
do $$ begin
  if not exists (select 1 from public.activity_log where action = 'settings.login.unlock' and entity_id = '00000000-0000-4000-8000-0000000102a2') then raise exception 'case the unlock is logged failed'; end if;
  if (public.login_gate('ll-mem.dev@ibtekr.local') ->> 'locked')::boolean then raise exception 'case unlocked at the gate failed'; end if;
end $$;

-- a failure then a sign-in: login_cleared resets the member's own counter
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$ begin perform public.login_failed('ll-mem.dev@ibtekr.local'); end $$;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000102a2', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin perform public.login_cleared(); end $$;
reset role;
do $$ begin
  if exists (select 1 from public.login_failures where key = encode(sha256(convert_to('ll-mem.dev@ibtekr.local', 'UTF8')), 'hex')) then raise exception 'case login_cleared resets the counter failed'; end if;
end $$;

do $$ begin raise notice 'rls_login_lock: ok'; end $$;
rollback;
