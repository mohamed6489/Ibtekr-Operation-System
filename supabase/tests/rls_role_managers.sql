-- Tests for 0092_role_managers (owner batch 14 Nov decision 16 — the departments out, «مدير الدور» in). Depends on 0001 … 0092.
-- One transaction, rolled back; NOTICE 'rls_role_managers: ok' only if every case passed. Live-safe: a made-up role and made-up members;
-- the settings row «hr» is changed inside the transaction only.

begin;

insert into public.roles (id, name, permissions) values ('rm_test92', 'دور اختبار المديرين', '{"hr.view":"P"}');
insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000092b1', 'rm-adm.dev@ibtekr.local', '010000092b1'),
  ('00000000-0000-4000-8000-0000000092b2', 'rm-hr.dev@ibtekr.local', '010000092b2'),
  ('00000000-0000-4000-8000-0000000092b3', 'rm-mgr.dev@ibtekr.local', '010000092b3'),
  ('00000000-0000-4000-8000-0000000092b4', 'rm-x.dev@ibtekr.local', '010000092b4'),
  ('00000000-0000-4000-8000-0000000092b5', 'rm-y.dev@ibtekr.local', '010000092b5'),
  ('00000000-0000-4000-8000-0000000092b6', 'rm-z.dev@ibtekr.local', '010000092b6'),
  ('00000000-0000-4000-8000-0000000092b7', 'rm-new.dev@ibtekr.local', '010000092b7'),
  ('00000000-0000-4000-8000-0000000092b8', 'rm-new2.dev@ibtekr.local', '010000092b8');
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-0000000092b1', 'أدمن المديرين', 'rm-adm.dev@ibtekr.local', '010000092b1', 'admin', 'active', null),
  ('00000000-0000-4000-8000-0000000092b2', 'موارد بشرية المديرين', 'rm-hr.dev@ibtekr.local', '010000092b2', 'ops', 'active', '{"hr.view":"F","hr.edit":"F"}'),
  ('00000000-0000-4000-8000-0000000092b3', 'مدير الدور', 'rm-mgr.dev@ibtekr.local', '010000092b3', 'ops', 'active', null),
  ('00000000-0000-4000-8000-0000000092b4', 'عضو س', 'rm-x.dev@ibtekr.local', '010000092b4', 'rm_test92', 'active', null),
  ('00000000-0000-4000-8000-0000000092b5', 'عضو ص', 'rm-y.dev@ibtekr.local', '010000092b5', 'rm_test92', 'active', null),
  ('00000000-0000-4000-8000-0000000092b6', 'عضو ع', 'rm-z.dev@ibtekr.local', '010000092b6', 'rm_test92', 'active', null);

create or replace function pg_temp.as_member(p_uid text) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', 'aal2')::text, true);
end $$;
create or replace function pg_temp.mgr(p_uid text) returns uuid language sql as $$ select manager_id from public.profiles where id = p_uid::uuid $$;

-- the grants
do $$ begin
  if has_function_privilege('authenticated', 'public.profiles_role_manager()', 'EXECUTE') or has_function_privilege('authenticated', 'public.roles_manager_sync()', 'EXECUTE')
     or has_function_privilege('anon', 'public.role_manager_set(text, uuid)', 'EXECUTE') or has_function_privilege('anon', 'public.member_manager_set(uuid, uuid)', 'EXECUTE') then
    raise exception 'case the grants failed';
  end if;
  if not has_function_privilege('authenticated', 'public.role_manager_set(text, uuid)', 'EXECUTE') then raise exception 'case members may call the RPC failed'; end if;
end $$;

-- ================================================================ only the admin sets a role's manager
select pg_temp.as_member('00000000-0000-4000-8000-0000000092b2');
do $$ begin
  begin perform public.role_manager_set('rm_test92', '00000000-0000-4000-8000-0000000092b3'); raise exception 'case hr.edit cannot set a role manager failed'; exception when insufficient_privilege then null; end;
end $$;
select pg_temp.as_member('00000000-0000-4000-8000-0000000092b1');
do $$ declare r jsonb; begin
  begin perform public.role_manager_set('no_such_role92', null); raise exception 'case an unknown role failed'; exception when invalid_parameter_value then null; end;
  r := public.role_manager_set('rm_test92', '00000000-0000-4000-8000-0000000092b3');
  if (r ->> 'members')::int <> 3 then raise exception 'case three members under the manager failed (%)', r; end if;
end $$;
reset role;
do $$ begin
  if pg_temp.mgr('00000000-0000-4000-8000-0000000092b4') is distinct from '00000000-0000-4000-8000-0000000092b3'::uuid
     or pg_temp.mgr('00000000-0000-4000-8000-0000000092b6') is distinct from '00000000-0000-4000-8000-0000000092b3'::uuid then
    raise exception 'case the role''s members take its manager failed';
  end if;
  if not exists (select 1 from public.activity_log where action = 'hr.role.manager' and entity_id = 'rm_test92') then raise exception 'case the role manager logged failed'; end if;
end $$;
-- the manager sees his team in HR (hr.view P on his role «ops»? no — give him P to read)
update public.profiles set custom_perms = '{"hr.view":"P"}' where id = '00000000-0000-4000-8000-0000000092b3';
select pg_temp.as_member('00000000-0000-4000-8000-0000000092b3');
do $$ begin
  if not public.hr_is_manager_of('00000000-0000-4000-8000-0000000092b4') or not public.hr_can_see('00000000-0000-4000-8000-0000000092b5') then raise exception 'case the role manager is their direct manager failed'; end if;
end $$;
reset role;

-- ================================================================ a member's own manager (hr.edit F): kept when the role's manager changes
select pg_temp.as_member('00000000-0000-4000-8000-0000000092b2');
do $$ begin
  begin perform public.member_manager_set('00000000-0000-4000-8000-0000000092b4', '00000000-0000-4000-8000-0000000092b4'); raise exception 'case oneself failed'; exception when invalid_parameter_value then null; end;
  begin perform public.member_manager_set('00000000-0000-4000-8000-0000000092b3', '00000000-0000-4000-8000-0000000092b4'); raise exception 'case a loop failed'; exception when invalid_parameter_value then null; end;
  begin perform public.member_manager_set('00000000-0000-4000-8000-0000000092b2', '00000000-0000-4000-8000-0000000092b1'); raise exception 'case hr.edit on himself failed'; exception when insufficient_privilege then null; end;
  begin perform public.member_manager_set('00000000-0000-4000-8000-0000000092b5', '00000000-0000-4000-8000-0000000092b2'); raise exception 'case hr.edit naming himself failed'; exception when insufficient_privilege then null; end;
  begin perform public.member_manager_set('00000000-0000-4000-8000-0000000092b1', '00000000-0000-4000-8000-0000000092b3'); raise exception 'case hr.edit on an admin failed'; exception when insufficient_privilege then null; end;
  perform public.member_manager_set('00000000-0000-4000-8000-0000000092b4', '00000000-0000-4000-8000-0000000092b1');
end $$;
select pg_temp.as_member('00000000-0000-4000-8000-0000000092b6');
do $$ begin
  begin perform public.member_manager_set('00000000-0000-4000-8000-0000000092b6', null); raise exception 'case a member cannot change managers failed'; exception when insufficient_privilege then null; end;
end $$;
select pg_temp.as_member('00000000-0000-4000-8000-0000000092b1');
do $$ begin perform public.role_manager_set('rm_test92', '00000000-0000-4000-8000-0000000092b2'); end $$;
reset role;
do $$ begin
  if pg_temp.mgr('00000000-0000-4000-8000-0000000092b4') is distinct from '00000000-0000-4000-8000-0000000092b1'::uuid then raise exception 'case a member''s own manager kept failed'; end if;
  if pg_temp.mgr('00000000-0000-4000-8000-0000000092b5') is distinct from '00000000-0000-4000-8000-0000000092b2'::uuid then raise exception 'case the others follow the role''s new manager failed'; end if;
end $$;
-- back to the role's manager
select pg_temp.as_member('00000000-0000-4000-8000-0000000092b2');
do $$ begin perform public.member_manager_set('00000000-0000-4000-8000-0000000092b4', null); end $$;
reset role;
do $$ begin
  if pg_temp.mgr('00000000-0000-4000-8000-0000000092b4') is distinct from '00000000-0000-4000-8000-0000000092b2'::uuid
     or (select manager_fixed from public.profiles where id = '00000000-0000-4000-8000-0000000092b4') then raise exception 'case back to the role''s manager failed'; end if;
  if (select count(*) from public.activity_log where action = 'hr.member.manager' and entity_id = '00000000-0000-4000-8000-0000000092b4') < 2 then raise exception 'case the member manager logged failed'; end if;
end $$;

-- a loop further up the chain (the admin): b5 is under b2 (the role's manager); b2 under b5 would close it
select pg_temp.as_member('00000000-0000-4000-8000-0000000092b1');
do $$ begin
  perform public.member_manager_set('00000000-0000-4000-8000-0000000092b3', '00000000-0000-4000-8000-0000000092b5');
  begin perform public.member_manager_set('00000000-0000-4000-8000-0000000092b2', '00000000-0000-4000-8000-0000000092b3'); raise exception 'case a loop up the chain failed'; exception when invalid_parameter_value then null; end;
  perform public.member_manager_set('00000000-0000-4000-8000-0000000092b3', null);
end $$;
reset role;

-- ================================================================ the manager in his own role has none from it; a role change; a new member
select pg_temp.as_member('00000000-0000-4000-8000-0000000092b1');
do $$ begin perform public.role_manager_set('rm_test92', '00000000-0000-4000-8000-0000000092b5'); end $$;
reset role;
do $$ begin
  if pg_temp.mgr('00000000-0000-4000-8000-0000000092b5') is not null then raise exception 'case the manager has no manager from his role failed'; end if;
  if pg_temp.mgr('00000000-0000-4000-8000-0000000092b6') is distinct from '00000000-0000-4000-8000-0000000092b5'::uuid then raise exception 'case the role''s members under him failed'; end if;
  update public.profiles set role_id = 'viewer' where id = '00000000-0000-4000-8000-0000000092b6';
  if pg_temp.mgr('00000000-0000-4000-8000-0000000092b6') is distinct from (select manager_id from public.roles where id = 'viewer') then raise exception 'case a role change takes the new role''s manager failed'; end if;
  update public.profiles set role_id = 'rm_test92' where id = '00000000-0000-4000-8000-0000000092b6';
  if pg_temp.mgr('00000000-0000-4000-8000-0000000092b6') is distinct from '00000000-0000-4000-8000-0000000092b5'::uuid then raise exception 'case back in the role failed'; end if;
  insert into public.profiles (id, name, email, phone, role_id, status) values ('00000000-0000-4000-8000-0000000092b7', 'جديد', 'rm-new.dev@ibtekr.local', '010000092b7', 'rm_test92', 'active');
  if pg_temp.mgr('00000000-0000-4000-8000-0000000092b7') is distinct from '00000000-0000-4000-8000-0000000092b5'::uuid then raise exception 'case a new member takes the role''s manager failed'; end if;
  insert into public.profiles (id, name, email, phone, role_id, status, manager_id) values ('00000000-0000-4000-8000-0000000092b8', 'جديد ٢', 'rm-new2.dev@ibtekr.local', '010000092b8', 'rm_test92', 'active', '00000000-0000-4000-8000-0000000092b1');
  if not (select manager_fixed from public.profiles where id = '00000000-0000-4000-8000-0000000092b8') then raise exception 'case a new member with a manager is set by hand failed'; end if;
end $$;

-- ================================================================ «أوقات عمل مخصصة» by role
insert into public.settings (section, data) values ('hr', '{}') on conflict (section) do nothing;
update public.settings set data = jsonb_set(data, '{schedules}', coalesce(data -> 'schedules', '{}'::jsonb) || jsonb_build_object('role', coalesce(data -> 'schedules' -> 'role', '{}'::jsonb) || '{"rm_test92": {"from": "10:00", "to": "16:00"}}'::jsonb)) where section = 'hr';
do $$ begin
  if public.hr_day_minutes('00000000-0000-4000-8000-0000000092b4') <> 360 or (public.hr_schedule('00000000-0000-4000-8000-0000000092b4') ->> 'kind') <> 'role' then raise exception 'case the role''s custom time failed'; end if;
  if (public.hr_schedule('00000000-0000-4000-8000-0000000092b3') ->> 'kind') = 'role' and not (select data -> 'schedules' -> 'role' ? 'ops' from public.settings where section = 'hr') then raise exception 'case another role keeps the official hours failed'; end if;
end $$;

do $$ begin raise notice 'rls_role_managers: ok'; end $$;
rollback;
