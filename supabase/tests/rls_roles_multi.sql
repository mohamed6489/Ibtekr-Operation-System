-- Tests for 0081_roles_multi (the owner, 12 Nov — designer / media buyer / developer roles, a main role + extra roles, the team
-- requests to any role). Depends on 0001_identity … 0081. Runs in one transaction and rolls back; prints NOTICE 'rls_roles_multi: ok'
-- only if every case passed. Live-safe: its made-up members, roles and requests are rolled back.
-- * the three system roles exist with marketing and the team requests
-- * has_perm = the highest of the main and the extra roles; custom_perms still win; a hidden role gives nothing as an extra
-- * member_roles_set: the admin only; existing, not hidden, never «أدمن», never the main role, 6 at most, unknown member P0002;
--   a member never writes extra_roles directly (the profiles guard)
-- * a team request goes to any role (its name), an unknown one → 22023; the role's member (main or extra) sees and works it
-- * member_role_set drops the new main role from the extras; role_update renames the role's requests; role_delete drops the role from
--   the extras and sends its open requests to «مدير النظام»; ticket_roles() lists the six old labels and the new names, closed to anon

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000081a1', 'rm-adm.dev@ibtekr.local', '010000081a1'),
  ('00000000-0000-4000-8000-0000000081a2', 'rm-ops.dev@ibtekr.local', '010000081a2'),
  ('00000000-0000-4000-8000-0000000081a3', 'rm-vw.dev@ibtekr.local',  '010000081a3'),
  ('00000000-0000-4000-8000-0000000081a4', 'rm-cs.dev@ibtekr.local',  '010000081a4');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u where u.email like 'rm-%.dev@ibtekr.local';
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-0000000081a1', 'أدمن الأدوار',   'rm-adm.dev@ibtekr.local', '010000081a1', 'admin',  'active', '{}'),
  ('00000000-0000-4000-8000-0000000081a2', 'عمليات الأدوار', 'rm-ops.dev@ibtekr.local', '010000081a2', 'ops',    'active', '{}'),
  ('00000000-0000-4000-8000-0000000081a3', 'مشاهد مصمم',     'rm-vw.dev@ibtekr.local',  '010000081a3', 'viewer', 'active', '{}'),
  ('00000000-0000-4000-8000-0000000081a4', 'حسابات الأدوار', 'rm-cs.dev@ibtekr.local',  '010000081a4', 'accounts', 'active', '{}');

create or replace function pg_temp.as_member(p_uid text) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;

-- ================================================================ the roles and the closed functions (runner)

do $$ begin
  if (select count(*) from public.roles where id in ('designer', 'media_buyer', 'developer') and is_system) <> 3 then raise exception 'case the three system roles exist failed'; end if;
  if (select permissions ->> 'marketing.create' from public.roles where id = 'designer') <> 'F'
     or (select permissions ->> 'marketing.publish' from public.roles where id = 'media_buyer') <> 'F'
     or (select permissions ->> 'tickets.manage' from public.roles where id = 'developer') <> 'F' then
    raise exception 'case the new roles carry marketing and the team requests failed';
  end if;
  if has_function_privilege('anon', 'public.member_roles_set(uuid, text[])', 'execute') or has_function_privilege('anon', 'public.ticket_roles()', 'execute')
     or not has_function_privilege('authenticated', 'public.member_roles_set(uuid, text[])', 'execute') or not has_function_privilege('authenticated', 'public.ticket_roles()', 'execute') then
    raise exception 'case member_roles_set / ticket_roles: closed to anon, open to the members failed';
  end if;
  if (select count(*) from public.ticket_roles() t where t.label in ('مدير النظام', 'خدمة العملاء', 'متابعة المبتكرين', 'الحسابات', 'اللوجستيك والشحن', 'المحتوى والتصوير', 'ديزاينر', 'ميديا باير', 'مبرمج')) <> 9 then
    raise exception 'case ticket_roles lists the six old labels and the three new names failed';
  end if;
end $$;

-- ================================================================ a viewer: nothing from marketing; never writes the extras

select pg_temp.as_member('00000000-0000-4000-8000-0000000081a3');
do $$ begin
  if public.has_perm('marketing.create') <> 'N' or public.has_perm('tickets.manage') <> 'N' then raise exception 'case the viewer alone has no marketing failed'; end if;
  begin perform public.member_roles_set('00000000-0000-4000-8000-0000000081a3', array['designer']); raise exception 'case a member never sets roles failed';
  exception when insufficient_privilege then null; end;
  begin update public.profiles set extra_roles = array['designer'] where id = '00000000-0000-4000-8000-0000000081a3'; raise exception 'case a member never writes extra_roles failed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ================================================================ the admin: the extras and their checks

select pg_temp.as_member('00000000-0000-4000-8000-0000000081a1');
do $$ begin
  begin perform public.member_roles_set('00000000-0000-4000-8000-0000000081a3', array['nope']); raise exception 'case an unknown role failed';
  exception when invalid_parameter_value then null; end;
  begin perform public.member_roles_set('00000000-0000-4000-8000-0000000081a3', array['admin']); raise exception 'case «أدمن» is never an extra failed';
  exception when invalid_parameter_value then null; end;
  begin perform public.member_roles_set('00000000-0000-4000-8000-0000000081a3', array['viewer']); raise exception 'case the main role is never an extra failed';
  exception when invalid_parameter_value then null; end;
  begin perform public.member_roles_set('00000000-0000-4000-8000-0000000081a3', array['designer', 'developer', 'media_buyer', 'cs', 'accounts', 'ops', 'vendors_followup']); raise exception 'case 6 extras at most failed';
  exception when invalid_parameter_value then null; end;
  begin perform public.member_roles_set('00000000-0000-4000-8000-0000000081ff', array['designer']); raise exception 'case an unknown member failed';
  exception when no_data_found then null; end;
  begin perform public.member_roles_set('00000000-0000-4000-8000-0000000081a1', array['designer']); raise exception 'case an admin has no extras failed';
  exception when invalid_parameter_value then null; end;
  perform public.member_roles_set('00000000-0000-4000-8000-0000000081a3', array['designer', 'designer', 'developer']);
  if (select extra_roles from public.profiles where id = '00000000-0000-4000-8000-0000000081a3') <> array['designer', 'developer'] then
    raise exception 'case the extras are kept once, in order failed';
  end if;
end $$;
reset role;

-- ================================================================ the viewer + designer: the highest permission; custom_perms still win

select pg_temp.as_member('00000000-0000-4000-8000-0000000081a3');
do $$ begin
  if public.has_perm('marketing.create') <> 'F' or public.has_perm('tickets.manage') <> 'F' or public.has_perm('tickets.view') <> 'P' then
    raise exception 'case the extra roles add their permissions failed';
  end if;
  if public.has_perm('accounts.add') <> coalesce((select permissions ->> 'accounts.add' from public.roles where id = 'viewer'), 'N') then
    raise exception 'case a key no role gives stays as the main role failed';
  end if;
  if not ('ديزاينر' = any (public.ticket_my_roles()) and 'مبرمج' = any (public.ticket_my_roles())) then raise exception 'case my ticket roles = main + extras failed'; end if;
end $$;
reset role;
update public.profiles set custom_perms = '{"marketing.create":"N"}' where id = '00000000-0000-4000-8000-0000000081a3';
select pg_temp.as_member('00000000-0000-4000-8000-0000000081a3');
do $$ begin
  if public.has_perm('marketing.create') <> 'N' then raise exception 'case custom_perms win over the extras failed'; end if;
end $$;
reset role;
update public.profiles set custom_perms = '{}' where id = '00000000-0000-4000-8000-0000000081a3';

-- ================================================================ a team request to the designer: made by ops, worked by the extra role

select pg_temp.as_member('00000000-0000-4000-8000-0000000081a2');
do $$
declare
  t1 bigint;
begin
  begin perform public.ticket_create('{"type":"internal","title":"بوست","description":"بوست العروض","priority":"normal","assigneeRole":"فلان"}'); raise exception 'case an unknown role is refused failed';
  exception when invalid_parameter_value then null; end;
  t1 := public.ticket_create('{"type":"internal","title":"بوست العروض","description":"3 بوستات 1080×1350","priority":"normal","assigneeRole":"ديزاينر"}');
  perform set_config('rm.t1', t1::text, true);
  if (select assignee_role from public.tickets where id = t1) <> 'ديزاينر' then raise exception 'case a request goes to the designer failed'; end if;
end $$;
reset role;

select pg_temp.as_member('00000000-0000-4000-8000-0000000081a4');
do $$ begin
  -- the accounts (tickets.view P) never see another role's request
  if exists (select 1 from public.tickets where id = current_setting('rm.t1')::bigint) then raise exception 'case another role never sees it failed'; end if;
end $$;
reset role;

select pg_temp.as_member('00000000-0000-4000-8000-0000000081a3');
do $$ begin
  if not exists (select 1 from public.tickets where id = current_setting('rm.t1')::bigint) then raise exception 'case the extra role sees its request failed'; end if;
  perform public.ticket_act(current_setting('rm.t1')::bigint, 'set_status', '{"status":"in_progress"}');
  if (select status from public.tickets where id = current_setting('rm.t1')::bigint) <> 'in_progress' then raise exception 'case the extra role works its request failed'; end if;
  begin perform public.ticket_act(current_setting('rm.t1')::bigint, 'update', '{"assigneeRole":"فلان"}'); raise exception 'case act refuses an unknown role failed';
  exception when invalid_parameter_value then null; end;
end $$;
reset role;

-- a direct write is held by the guard too
do $$ begin
  begin update public.tickets set assignee_role = 'فلان' where id = current_setting('rm.t1')::bigint; raise exception 'case the guard trigger holds the role failed';
  exception when invalid_parameter_value then null; end;
end $$;

-- ================================================================ the role RPCs keep the extras and the requests in step

select pg_temp.as_member('00000000-0000-4000-8000-0000000081a1');
do $$
declare
  t2 bigint;
begin
  perform public.member_role_set('00000000-0000-4000-8000-0000000081a3', 'designer');
  if (select extra_roles from public.profiles where id = '00000000-0000-4000-8000-0000000081a3') <> array['developer'] then
    raise exception 'case the new main role leaves the extras failed';
  end if;
  perform public.role_create('photo_team', 'فريق التصوير', 'تجربة', 'viewer');
  perform public.member_roles_set('00000000-0000-4000-8000-0000000081a3', array['developer', 'photo_team']);
  t2 := public.ticket_create('{"type":"internal","title":"تصوير","description":"تصوير المنتجات","priority":"normal","assigneeRole":"فريق التصوير"}');
  perform public.role_update('photo_team', 'التصوير', 'تجربة');
  if (select assignee_role from public.tickets where id = t2) <> 'التصوير' then raise exception 'case a renamed role keeps its requests failed'; end if;
  perform public.role_delete('photo_team', '{"*":"viewer"}');
  if exists (select 1 from public.profiles where id = '00000000-0000-4000-8000-0000000081a3' and 'photo_team' = any (extra_roles)) then
    raise exception 'case a deleted role leaves the extras failed';
  end if;
  if (select assignee_role from public.tickets where id = t2) <> 'مدير النظام' then raise exception 'case a deleted role''s open requests go to the manager failed'; end if;
  raise notice 'rls_roles_multi: ok';
end $$;
reset role;

rollback;
