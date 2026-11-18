-- Tests for 0134 team_wipe: the admin only (aal2); the dry run counts; the real run needs the phrase; every member goes but the admin
-- running it and the owner M01; what points at a leaving member is emptied (or its row goes); the added roles go, the fixed teams stay;
-- the settings stay; one activity_log row. wipe_files_plan is service_role only.
begin;
insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-000000134a01', 'tw-admin.dev@ibtekr.local', '0100000134a1'),
  ('00000000-0000-4000-8000-000000134a02', 'tw-ops.dev@ibtekr.local', '0100000134a2'),
  ('00000000-0000-4000-8000-000000134a03', 'tw-owner.dev@ibtekr.local', '0100000134a3');
insert into public.roles (id, name, is_system, permissions, sort) values ('tw_custom', 'فريق مضاف للمسح', false, '{}', 99);
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms, extra_roles) values
  ('00000000-0000-4000-8000-000000134a01', 'أدمن المسح', 'tw-admin.dev@ibtekr.local', '0100000134a1', 'admin', 'active', '{}', '{}'),
  ('00000000-0000-4000-8000-000000134a03', 'الأونر', 'tw-owner.dev@ibtekr.local', '0100000134a3', 'admin', 'active', '{}', '{tw_custom}');
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms, extra_roles, manager_id) values
  ('00000000-0000-4000-8000-000000134a02', 'عمليات المسح', 'tw-ops.dev@ibtekr.local', '0100000134a2', 'tw_custom', 'active', '{}', '{}', '00000000-0000-4000-8000-000000134a01');
update public.profiles set member_code = null where member_code = 'M01';
update public.profiles set member_code = 'M01' where id = '00000000-0000-4000-8000-000000134a03';
update public.profiles set manager_id = '00000000-0000-4000-8000-000000134a02' where id = '00000000-0000-4000-8000-000000134a01';
insert into public.activity_log (actor, action, entity) values ('00000000-0000-4000-8000-000000134a02', 'tw.test', 'test');
set local role authenticated;
-- the ops member: refused
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000134a02', 'role', 'authenticated', 'aal', 'aal2')::text, true);
do $$ begin perform public.team_wipe(null, true); raise exception 'case ops refused failed'; exception when insufficient_privilege then null; end $$;
do $$ begin perform public.wipe_files_plan(10); raise exception 'case files plan refused failed'; exception when insufficient_privilege then null; end $$;
-- the admin: the dry run, then the wrong phrase
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000134a01', 'role', 'authenticated', 'aal', 'aal2')::text, true);
do $$ declare r jsonb; begin
  r := public.team_wipe(null, true);
  if (r ->> 'dry')::boolean is not true or (r ->> 'members')::int < 1 or (r ->> 'roles')::int < 1 or (r ->> 'kept')::int <> 2 then raise exception 'case dry run failed: %', r; end if;
  if not exists (select 1 from public.roles where id = 'tw_custom') then raise exception 'case dry run kept failed'; end if;
end $$;
do $$ begin perform public.team_wipe('امسح', false); raise exception 'case phrase failed'; exception when invalid_parameter_value then null; end $$;
-- the real run
do $$ declare r jsonb; begin
  r := public.team_wipe('حذف الداتا من السيستم بشكل نهائي', false);
  if (r ->> 'dry')::boolean is not false then raise exception 'case run failed: %', r; end if;
end $$;
reset role;
do $$ begin
  if exists (select 1 from auth.users where id = '00000000-0000-4000-8000-000000134a02') then raise exception 'case member gone failed'; end if;
  if (select count(*) from public.profiles where id in ('00000000-0000-4000-8000-000000134a01', '00000000-0000-4000-8000-000000134a03')) <> 2 then raise exception 'case kept failed'; end if;
  if (select count(*) from public.profiles where id not in ('00000000-0000-4000-8000-000000134a01', '00000000-0000-4000-8000-000000134a03')) <> 0 then raise exception 'case all others gone failed'; end if;
  if (select manager_id from public.profiles where id = '00000000-0000-4000-8000-000000134a01') is not null then raise exception 'case manager emptied failed'; end if;
  if exists (select 1 from public.activity_log where action = 'tw.test' and actor is not null) then raise exception 'case actor emptied failed'; end if;
  if exists (select 1 from public.roles where id = 'tw_custom') then raise exception 'case added role gone failed'; end if;
  if (select extra_roles from public.profiles where id = '00000000-0000-4000-8000-000000134a03') <> '{}' then raise exception 'case extra roles failed'; end if;
  if not exists (select 1 from public.roles where id = 'admin') or not exists (select 1 from public.roles where id = 'ops') then raise exception 'case fixed teams kept failed'; end if;
  if not exists (select 1 from public.activity_log where action = 'settings.team.wipe') then raise exception 'case logged failed'; end if;
end $$;
rollback;
