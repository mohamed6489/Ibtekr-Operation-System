-- RLS / permission tests for 0066_member_delete (phase 13 decision 15: a team member deleted for good from team-admin only —
-- member_delete is service_role only; a member with any trace in a non-cascading table is refused with the table named; the last
-- active admin and one's own account are refused; a traceless member goes from auth.users with the cascade and one activity_log row).
-- Depends on 0001 … 0066. One transaction rolled back; prints NOTICE 'rls_member_delete: ok' only if every case passed. Live-safe
-- (its own rows only; every count scoped to them).

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000066a1', 'md-adm.dev@ibtekr.local', '01000066a01'),
  ('00000000-0000-4000-8000-0000000066a2', 'md-clean.dev@ibtekr.local', '01000066a02'),
  ('00000000-0000-4000-8000-0000000066a3', 'md-traced.dev@ibtekr.local', '01000066a03'),
  ('00000000-0000-4000-8000-0000000066a4', 'md-mgr.dev@ibtekr.local', '01000066a04'),
  ('00000000-0000-4000-8000-0000000066a5', 'md-staff.dev@ibtekr.local', '01000066a05');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u where u.email like 'md-%.dev@ibtekr.local';
insert into public.profiles (id, name, email, phone, role_id, status) values
  ('00000000-0000-4000-8000-0000000066a1', 'أدمن الحذف', 'md-adm.dev@ibtekr.local', '01000066a01', 'admin', 'active'),
  ('00000000-0000-4000-8000-0000000066a2', 'عضو من غير أثر', 'md-clean.dev@ibtekr.local', '01000066a02', 'cs', 'active'),
  ('00000000-0000-4000-8000-0000000066a3', 'عضو له أثر', 'md-traced.dev@ibtekr.local', '01000066a03', 'ops', 'active'),
  ('00000000-0000-4000-8000-0000000066a4', 'مدير', 'md-mgr.dev@ibtekr.local', '01000066a04', 'ops', 'active'),
  ('00000000-0000-4000-8000-0000000066a5', 'موظف تحت المدير', 'md-staff.dev@ibtekr.local', '01000066a05', 'viewer', 'active');
update public.profiles set manager_id = '00000000-0000-4000-8000-0000000066a4' where id = '00000000-0000-4000-8000-0000000066a5';
-- the clean member's own rows (they cascade); the traced member's trace (activity_log.actor does not cascade)
insert into public.hr_members (member_id, shift_start, shift_end) values ('00000000-0000-4000-8000-0000000066a2', '09:00', '17:00');
insert into public.hr_pay (member_id, salary, holdback, allowances) values ('00000000-0000-4000-8000-0000000066a2', 8000, 0, 0);
insert into public.user_prefs (user_id, key, data) values ('00000000-0000-4000-8000-0000000066a2', 'table.cols', '{}'::jsonb);
insert into public.activity_log (at, actor, action, entity, entity_id, new_value) values (now(), '00000000-0000-4000-8000-0000000066a3', 'auth.login', 'profile', '00000000-0000-4000-8000-0000000066a3', null);
update public.activity_log set actor = '00000000-0000-4000-8000-0000000066a3' where entity_id = '00000000-0000-4000-8000-0000000066a3' and action = 'auth.login';

-- ================================================================ the schema
do $$ begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'member_delete' and p.prosecdef) <> 1 then raise exception 'case member_delete is security definer failed'; end if;
  if has_function_privilege('anon', 'public.member_delete(uuid, uuid)', 'execute') or has_function_privilege('authenticated', 'public.member_delete(uuid, uuid)', 'execute') then raise exception 'case member_delete closed to anon / authenticated failed'; end if;
  if not has_function_privilege('service_role', 'public.member_delete(uuid, uuid)', 'execute') then raise exception 'case member_delete open to service_role failed'; end if;
end $$;

-- ================================================================ a member (the admin): no door
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000066a1","role":"authenticated"}', true);
do $$ begin
  begin perform public.member_delete('00000000-0000-4000-8000-0000000066a2', '00000000-0000-4000-8000-0000000066a1'); raise exception 'case the admin cannot call member_delete directly failed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ================================================================ the server
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$
declare r jsonb; v_hint text;
begin
  -- unknown
  begin perform public.member_delete('00000000-0000-4000-8000-0000000066ff', '00000000-0000-4000-8000-0000000066a1'); raise exception 'case an unknown member failed';
  exception when no_data_found then null; end;
  -- one's own account
  begin perform public.member_delete('00000000-0000-4000-8000-0000000066a1', '00000000-0000-4000-8000-0000000066a1'); raise exception 'case one''s own account failed';
  exception when invalid_parameter_value then if sqlerrm <> 'own account' then raise exception 'case one''s own account (message) failed: %', sqlerrm; end if; end;
  -- a trace (activity_log.actor) → 23503 with the table in the hint
  begin perform public.member_delete('00000000-0000-4000-8000-0000000066a3', '00000000-0000-4000-8000-0000000066a1'); raise exception 'case a traced member failed';
  exception when foreign_key_violation then get stacked diagnostics v_hint = pg_exception_hint; if sqlerrm <> 'has_records' or v_hint <> 'activity_log' then raise exception 'case a traced member (hint) failed: % / %', sqlerrm, v_hint; end if; end;
  -- the people a member manages are a trace too (profiles.manager_id)
  begin perform public.member_delete('00000000-0000-4000-8000-0000000066a4', '00000000-0000-4000-8000-0000000066a1'); raise exception 'case a manager with staff failed';
  exception when foreign_key_violation then get stacked diagnostics v_hint = pg_exception_hint; if v_hint <> 'profiles' then raise exception 'case a manager with staff (hint) failed: %', v_hint; end if; end;
  if (select count(*) from public.profiles where id in ('00000000-0000-4000-8000-0000000066a3', '00000000-0000-4000-8000-0000000066a4')) <> 2 then raise exception 'case a refused delete removed nothing failed'; end if;
  -- the clean member goes: auth.users, profiles and the own rows by cascade; one activity_log row with the name only
  r := public.member_delete('00000000-0000-4000-8000-0000000066a2', '00000000-0000-4000-8000-0000000066a1');
  if r ->> 'ok' <> 'true' or r ->> 'name' <> 'عضو من غير أثر' then raise exception 'case the clean member deleted (answer) failed: %', r; end if;
  if exists (select 1 from public.profiles where id = '00000000-0000-4000-8000-0000000066a2')
     or exists (select 1 from public.hr_members where member_id = '00000000-0000-4000-8000-0000000066a2') or exists (select 1 from public.hr_pay where member_id = '00000000-0000-4000-8000-0000000066a2')
     or exists (select 1 from public.user_prefs where user_id = '00000000-0000-4000-8000-0000000066a2') then raise exception 'case the clean member deleted (cascade) failed'; end if;
  if (select count(*) from public.activity_log where action = 'hr.member.delete' and entity_id = '00000000-0000-4000-8000-0000000066a2' and new_value = to_jsonb('عضو من غير أثر'::text)) <> 1 then raise exception 'case the delete logged with the name failed'; end if;
  if exists (select 1 from public.activity_log where entity_id = '00000000-0000-4000-8000-0000000066a2' and (new_value::text like '%md-clean%' or old_value::text like '%md-clean%')) then raise exception 'case no email in the log failed'; end if;
  -- the last active admin (this file's admin is not the only one on a seeded database, so the rule is checked on a second admin left alone)
  update public.profiles set status = 'suspended' where role_id = 'admin' and id <> '00000000-0000-4000-8000-0000000066a1';
  begin perform public.member_delete('00000000-0000-4000-8000-0000000066a1', null); raise exception 'case the last admin failed';
  exception when invalid_parameter_value then if sqlerrm <> 'last_admin' then raise exception 'case the last admin (message) failed: %', sqlerrm; end if; end;
end $$;

reset role;
do $$ begin
  if exists (select 1 from auth.users where id = '00000000-0000-4000-8000-0000000066a2') then raise exception 'case the clean member deleted from auth.users failed'; end if;
  if (select count(*) from auth.users where email like 'md-%.dev@ibtekr.local') <> 4 then raise exception 'case the other test users untouched failed'; end if;
end $$;
do $$ begin raise notice 'rls_member_delete: ok'; end $$;
rollback;
