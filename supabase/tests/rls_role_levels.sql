-- Tests for 0096_role_levels (owner batch 2 decisions 2 and 4): a role's three permission groups and a member's level. One
-- transaction, rolled back; NOTICE 'rls_role_levels: ok' only if every case passed. Live-safe: made-up members; the role's
-- level_perms change is rolled back.
-- * an «employee» reads roles.permissions; a «manager» / «viewer» reads level_perms (else the employee group); extra roles = employee
-- * custom_perms still win; the admin is F
-- * role_level_perms_set / member_level_set: the admin only; a bad level 22023; the admin role 22023; a member never writes his level

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000096a1', 'lv-adm.dev@ibtekr.local', '010000096a1'),
  ('00000000-0000-4000-8000-0000000096a2', 'lv-ops.dev@ibtekr.local', '010000096a2'),
  ('00000000-0000-4000-8000-0000000096a3', 'lv-ext.dev@ibtekr.local', '010000096a3');
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-0000000096a1', 'أدمن المستويات', 'lv-adm.dev@ibtekr.local', '010000096a1', 'admin', 'active', '{}'),
  ('00000000-0000-4000-8000-0000000096a2', 'عمليات المستويات', 'lv-ops.dev@ibtekr.local', '010000096a2', 'ops', 'active', '{}'),
  ('00000000-0000-4000-8000-0000000096a3', 'مشاهد بدور إضافي', 'lv-ext.dev@ibtekr.local', '010000096a3', 'viewer', 'active', '{}');

create or replace function pg_temp.as_member(p_uid text) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', 'aal2')::text, true);
end $$;

do $$ begin
  if (select level from public.profiles where id = '00000000-0000-4000-8000-0000000096a2') <> 'employee' then raise exception 'case the default level is employee failed'; end if;
  if has_function_privilege('anon', 'public.member_level_set(uuid, text)', 'EXECUTE') or has_function_privilege('anon', 'public.role_level_perms_set(text, text, jsonb)', 'EXECUTE') then raise exception 'case the writes are closed to anon failed'; end if;
end $$;

-- the admin sets the manager and viewer groups of «ops»
select pg_temp.as_member('00000000-0000-4000-8000-0000000096a1');
do $$ declare v jsonb; begin
  select permissions into v from public.roles where id = 'ops';
  perform public.role_level_perms_set('ops', 'manager', v || '{"settings.view":"F","hr.approve":"F"}');
  perform public.role_level_perms_set('ops', 'viewer', '{"orders.view":"P"}');
  begin perform public.role_level_perms_set('ops', 'boss', '{}'); raise exception 'case a bad level is refused failed'; exception when invalid_parameter_value then null; end;
  begin perform public.role_level_perms_set('admin', 'manager', '{}'); raise exception 'case the admin role is refused failed'; exception when invalid_parameter_value then null; end;
  begin perform public.member_level_set('00000000-0000-4000-8000-0000000096a1', 'viewer'); raise exception 'case the admin has no level failed'; exception when invalid_parameter_value then null; end;
end $$;
reset role;

-- the employee: roles.permissions
select pg_temp.as_member('00000000-0000-4000-8000-0000000096a2');
do $$ begin
  if public.has_perm('settings.view') = 'F' then raise exception 'case an employee does not get the manager group failed'; end if;
  if public.has_perm('orders.view') <> (select coalesce(permissions ->> 'orders.view', 'N') from public.roles where id = 'ops') then raise exception 'case an employee reads permissions failed'; end if;
  -- a member never sets his own level
  begin perform public.member_level_set('00000000-0000-4000-8000-0000000096a2', 'manager'); raise exception 'case only the admin sets a level failed'; exception when insufficient_privilege then null; end;
  begin update public.profiles set level = 'manager' where id = '00000000-0000-4000-8000-0000000096a2'; raise exception 'case a member never writes his level failed'; exception when insufficient_privilege then null; end;
end $$;
reset role;

-- the manager: level_perms.manager
select pg_temp.as_member('00000000-0000-4000-8000-0000000096a1');
do $$ begin perform public.member_level_set('00000000-0000-4000-8000-0000000096a2', 'manager'); end $$;
reset role;
select pg_temp.as_member('00000000-0000-4000-8000-0000000096a2');
do $$ begin
  if public.has_perm('settings.view') <> 'F' or public.has_perm('hr.approve') <> 'F' then raise exception 'case a manager gets the manager group failed'; end if;
end $$;
reset role;

-- security review: member_perm (another member's permission, for the server's alert recipients) reads the level too, and is server only
do $$ begin
  if public.member_perm('00000000-0000-4000-8000-0000000096a2', 'settings.view') <> 'F' then raise exception 'case member_perm reads the level failed'; end if;
  if has_function_privilege('authenticated', 'public.member_perm(uuid, text)', 'EXECUTE') or has_function_privilege('anon', 'public.member_perm(uuid, text)', 'EXECUTE') then raise exception 'case member_perm is server only failed'; end if;
  if position('member_perm' in pg_get_functiondef('public.hr_overtime_request(date, text, text, text)'::regprocedure)) = 0 then raise exception 'case hr_overtime_request picks approvers by member_perm failed'; end if;
end $$;

-- security review: a new main role starts at «موظف» (the level does not carry over to another role)
update public.profiles set role_id = 'cs' where id = '00000000-0000-4000-8000-0000000096a2';
do $$ begin
  if (select level from public.profiles where id = '00000000-0000-4000-8000-0000000096a2') <> 'employee' then raise exception 'case a new main role resets the level failed'; end if;
end $$;
update public.profiles set role_id = 'ops', level = 'manager' where id = '00000000-0000-4000-8000-0000000096a2';
do $$ begin
  if (select level from public.profiles where id = '00000000-0000-4000-8000-0000000096a2') <> 'manager' then raise exception 'case a level set with the role stays failed'; end if;
end $$;

-- the viewer: level_perms.viewer only
select pg_temp.as_member('00000000-0000-4000-8000-0000000096a1');
do $$ begin perform public.member_level_set('00000000-0000-4000-8000-0000000096a2', 'viewer'); end $$;
reset role;
select pg_temp.as_member('00000000-0000-4000-8000-0000000096a2');
do $$ begin
  if public.has_perm('orders.view') <> 'P' or public.has_perm('orders.status') <> 'N' then raise exception 'case a viewer gets the viewer group failed'; end if;
end $$;
reset role;

-- an extra role counts with its «employee» group, never its manager group; custom_perms still win
update public.profiles set extra_roles = '{ops}' where id = '00000000-0000-4000-8000-0000000096a3';
select pg_temp.as_member('00000000-0000-4000-8000-0000000096a3');
do $$ begin
  if public.has_perm('settings.view') = 'F' then raise exception 'case an extra role counts as employee failed'; end if;
end $$;
reset role;
update public.profiles set custom_perms = '{"settings.view":"N"}', level = 'manager', role_id = 'ops', extra_roles = '{}' where id = '00000000-0000-4000-8000-0000000096a3';
select pg_temp.as_member('00000000-0000-4000-8000-0000000096a3');
do $$ begin
  if public.has_perm('settings.view') <> 'N' then raise exception 'case custom_perms win over the level failed'; end if;
end $$;
reset role;

do $$ begin raise notice 'rls_role_levels: ok'; end $$;
rollback;
