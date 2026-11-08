-- RLS / permission tests for 0056_settings (phase 11): the Vault door for the platform keys is the server's only; settings_public
-- gives every active member the brand / quick / display / security / bell slice and nothing else; the team RPCs are the admin's
-- (the admin role untouchable, never the last admin, a role deleted only after its members moved, a system role hidden);
-- company_docs and alert_state are closed to members. Depends on 0001 … 0056. One transaction rolled back; prints NOTICE
-- 'rls_settings: ok' only if every case passed. Live-safe: its members, roles and rows are rolled back.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000056a1', 'st-adm.dev@ibtekr.local', '01000056a01'),
  ('00000000-0000-4000-8000-0000000056a2', 'st-ops.dev@ibtekr.local', '01000056a02'),
  ('00000000-0000-4000-8000-0000000056a3', 'st-cs.dev@ibtekr.local', '01000056a03'),
  ('00000000-0000-4000-8000-0000000056a4', 'st-off.dev@ibtekr.local', '01000056a04');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u where u.email like 'st-%.dev@ibtekr.local';
insert into public.profiles (id, name, email, phone, role_id, status) values
  ('00000000-0000-4000-8000-0000000056a1', 'أدمن الإعدادات', 'st-adm.dev@ibtekr.local', '01000056a01', 'admin', 'active'),
  ('00000000-0000-4000-8000-0000000056a2', 'عمليات الإعدادات', 'st-ops.dev@ibtekr.local', '01000056a02', 'ops', 'active'),
  ('00000000-0000-4000-8000-0000000056a3', 'خدمة عملاء', 'st-cs.dev@ibtekr.local', '01000056a03', 'cs', 'active'),
  ('00000000-0000-4000-8000-0000000056a4', 'موقوف', 'st-off.dev@ibtekr.local', '01000056a04', 'ops', 'suspended');
insert into auth.sessions (id, user_id, created_at, refreshed_at, user_agent, aal) values
  ('00000000-0000-4000-8000-00000000560a', '00000000-0000-4000-8000-0000000056a1', now() - interval '2 days', now() - interval '1 hour', 'Mozilla/5.0 (Macintosh) Chrome/130', 'aal1'),
  ('00000000-0000-4000-8000-00000000560b', '00000000-0000-4000-8000-0000000056a1', now() - interval '9 days', now() - interval '5 days', 'Mozilla/5.0 (iPhone) Safari', 'aal1'),
  ('00000000-0000-4000-8000-00000000560c', '00000000-0000-4000-8000-0000000056a2', now(), now(), 'x', 'aal1');
update public.settings set data = '{"company":"إبتكر كلوب","email":"hello@ibtekr.club","compact":true,"hidePhones":true}'::jsonb where section = 'general';
update public.settings set data = '{"colors":{"--color-brand-default":"#005642"},"fonts":{"body":"Cairo","head":"Cairo"}}'::jsonb where section = 'brand';
update public.settings set data = '{"alertRoles":{"customers.late":"RRRNSN"},"alertOverrides":{"00000000-0000-4000-8000-0000000056a2":{"customers.late":"S"},"00000000-0000-4000-8000-0000000056a3":{"customers.late":"N"}},"digests":[{"name":"x"}]}'::jsonb where section = 'notif';
update public.settings set data = '{"force2fa":false,"idleDesktop":"8 ساعات","ipOnly":true}'::jsonb where section = 'security';

-- the name list of the Vault door
do $$ begin
  if not public.app_secret_name_ok('woo') or not public.app_secret_name_ok('mcp_higgsfield') or not public.app_secret_name_ok('custom_runway_2') then raise exception 'case known names pass failed'; end if;
  if public.app_secret_name_ok('sync_secret') or public.app_secret_name_ok('mcp_') or public.app_secret_name_ok('Woo') or public.app_secret_name_ok('cs_meta_wa') then raise exception 'case unknown names fail failed'; end if;
end $$;

set local role authenticated;
-- ops: the public slice only; the Vault door, the team RPCs, the docs and the engine's memory are shut
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000056a2","role":"authenticated"}', true);
do $$
declare p jsonb;
begin
  p := public.settings_public();
  if p -> 'brand' -> 'colors' ->> '--color-brand-default' <> '#005642' then raise exception 'case the brand is public failed'; end if;
  if (p -> 'general' ->> 'company') <> 'إبتكر كلوب' or p -> 'general' ? 'email' then raise exception 'case the display prefs without the contact data failed: %', p -> 'general'; end if;
  if (p -> 'security' ->> 'idleDesktop') <> '8 ساعات' or p -> 'security' ? 'ipOnly' then raise exception 'case the security slice failed'; end if;
  if (p -> 'notif' -> 'alertRoles' ->> 'customers.late') <> 'RRRNSN' or (p -> 'notif' -> 'myOverride' ->> 'customers.late') <> 'S' or p -> 'notif' ? 'digests' or p -> 'notif' -> 'myOverride' ? 'x' then
    raise exception 'case the bell matrix with my override only failed: %', p -> 'notif';
  end if;
  begin perform public.app_secret_get('woo'); raise exception 'case a member reads a key failed';
  exception when insufficient_privilege then null; end;
  begin perform public.app_secret_set('openai', '{"key":"x"}'); raise exception 'case a member writes a key failed';
  exception when insufficient_privilege then null; end;
  begin perform public.app_secret_env(); raise exception 'case a member reads the env failed';
  exception when insufficient_privilege then null; end;
  begin perform public.role_perms_set('cs', '{"orders.view":"F"}'); raise exception 'case a member sets role perms failed';
  exception when insufficient_privilege then null; end;
  begin perform public.role_create('x_role', 'دور', null, 'ops'); raise exception 'case a member creates a role failed';
  exception when insufficient_privilege then null; end;
  begin perform public.member_role_set('00000000-0000-4000-8000-0000000056a3', 'ops'); raise exception 'case a member moves a member failed';
  exception when insufficient_privilege then null; end;
  begin perform public.member_perms_set('00000000-0000-4000-8000-0000000056a3', '{}'); raise exception 'case a member sets member perms failed';
  exception when insufficient_privilege then null; end;
  begin perform public.member_status_set('00000000-0000-4000-8000-0000000056a3', 'suspended', 'x'); raise exception 'case a member suspends a member failed';
  exception when insufficient_privilege then null; end;
  if (select count(*) from public.company_docs) <> 0 then raise exception 'case a member reads no docs failed'; end if;
  begin insert into public.company_docs (name, type, path) values ('x', 'رخصة', 'docs/x.pdf'); raise exception 'case a member adds a doc failed';
  exception when insufficient_privilege then null; end;
  begin perform count(*) from public.alert_state; raise exception 'case a member reads the engine memory failed';
  exception when insufficient_privilege then null; end;
end $$;

-- a suspended member: nothing
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000056a4","role":"authenticated"}', true);
do $$ begin
  begin perform public.settings_public(); raise exception 'case a suspended member reads the public slice failed';
  exception when insufficient_privilege then null; end;
end $$;

-- the admin: the team RPCs with their guards, the docs
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000056a1","role":"authenticated"}', true);
do $$
declare v text; n int;
begin
  -- role perms: the admin role refused, a bad value refused, a change logged and alerted
  begin perform public.role_perms_set('admin', '{"orders.view":"N"}'); raise exception 'case the admin role is untouchable failed';
  exception when sqlstate '22023' then null; end;
  begin perform public.role_perms_set('cs', '{"orders.view":"X"}'); raise exception 'case a bad perm value failed';
  exception when sqlstate '22023' then null; end;
  begin perform public.role_perms_set('cs', '{"orders view":"F"}'); raise exception 'case a bad perm key failed';
  exception when sqlstate '22023' then null; end;
  perform public.role_perms_set('cs', (select permissions || '{"reports.export":"F"}'::jsonb from public.roles where id = 'cs'));
  if (select permissions ->> 'reports.export' from public.roles where id = 'cs') <> 'F' then raise exception 'case role perms set failed'; end if;
  if not exists (select 1 from public.activity_log where action = 'settings.role.perms' and entity_id = 'cs' and old_value = '["reports.export"]'::jsonb) then raise exception 'case the perm change is logged with the keys failed'; end if;
  if not exists (select 1 from public.alerts where kind = 'settings.perm' and role_id = 'admin' and entity_id = 'cs') then raise exception 'case the perm change alerts the admins failed'; end if;
  -- a custom role from a base, renamed, then deleted with its member moved
  v := public.role_create('photo', 'التصوير', 'الصور والاستوديو', 'ops');
  if (select permissions ->> 'orders.view' from public.roles where id = 'photo') <> 'F' or (select is_system from public.roles where id = 'photo') then raise exception 'case role create copies the base failed'; end if;
  begin perform public.role_create('photo', 'تاني', null, 'ops'); raise exception 'case a taken role id failed';
  exception when unique_violation then null; end;
  begin perform public.role_create('photo2', 'التصوير', null, 'ops'); raise exception 'case a taken role name failed';
  exception when unique_violation then null; end;
  begin perform public.role_create('Photo-3', 'x', null, 'ops'); raise exception 'case a bad role id failed';
  exception when sqlstate '22023' then null; end;
  perform public.role_update('photo', 'التصوير والفيديو', 'وصف');
  if (select name || '|' || description from public.roles where id = 'photo') <> 'التصوير والفيديو|وصف' then raise exception 'case role update failed'; end if;
  begin perform public.role_update('cs', 'اسم تاني', null); raise exception 'case a system role keeps its name failed';
  exception when sqlstate '22023' then null; end;
  perform public.member_role_set('00000000-0000-4000-8000-0000000056a3', 'photo');
  if (select role_id from public.profiles where id = '00000000-0000-4000-8000-0000000056a3') <> 'photo' then raise exception 'case member role set failed'; end if;
  begin perform public.role_delete('photo', '{}'); raise exception 'case a role with members needs the moves failed';
  exception when sqlstate '22023' then null; end;
  begin perform public.role_delete('photo', '{"*":"photo"}'); raise exception 'case moving to the deleted role failed';
  exception when sqlstate '22023' then null; end;
  perform public.role_delete('photo', jsonb_build_object('00000000-0000-4000-8000-0000000056a3', 'cs'));
  if exists (select 1 from public.roles where id = 'photo') or (select role_id from public.profiles where id = '00000000-0000-4000-8000-0000000056a3') <> 'cs' then raise exception 'case role delete moves and deletes failed'; end if;
  -- a system role is hidden, not deleted; the admin role never
  perform public.role_delete('viewer', '{"*":"cs"}');
  if not (select hidden from public.roles where id = 'viewer') then raise exception 'case a system role is hidden failed'; end if;
  begin perform public.member_role_set('00000000-0000-4000-8000-0000000056a2', 'viewer'); raise exception 'case a hidden role takes no member failed';
  exception when sqlstate '22023' then null; end;
  begin perform public.role_delete('admin', '{"*":"ops"}'); raise exception 'case the admin role is never deleted failed';
  exception when sqlstate '22023' then null; end;
  -- never the last admin: every other admin on the live project is unknown here, so make this one the only active admin
  update public.profiles set status = 'suspended' where role_id = 'admin' and id <> '00000000-0000-4000-8000-0000000056a1';
  begin perform public.member_role_set('00000000-0000-4000-8000-0000000056a1', 'ops'); raise exception 'case the last admin stays failed';
  exception when sqlstate '22023' then null; end;
  -- member overrides: not for an admin, logged by keys only
  begin perform public.member_perms_set('00000000-0000-4000-8000-0000000056a1', '{"orders.view":"N"}'); raise exception 'case no overrides on an admin failed';
  exception when sqlstate '22023' then null; end;
  perform public.member_perms_set('00000000-0000-4000-8000-0000000056a2', '{"accounts.view":"F","sensitive.commission":"F"}');
  if (select custom_perms ->> 'accounts.view' from public.profiles where id = '00000000-0000-4000-8000-0000000056a2') <> 'F' then raise exception 'case member perms set failed'; end if;
  if not exists (select 1 from public.activity_log where action = 'settings.member.perms' and new_value = '["accounts.view","sensitive.commission"]'::jsonb) then raise exception 'case member perms logged by keys failed'; end if;
    -- sessions: mine only, the current one marked and never revoked; a member suspended loses their sessions, never oneself / the last admin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000056a1","role":"authenticated","session_id":"00000000-0000-4000-8000-00000000560a"}', true);
  if (select count(*) from public.my_sessions()) <> 2 or not (select current from public.my_sessions() where id = '00000000-0000-4000-8000-00000000560a') then raise exception 'case my sessions failed'; end if;
  begin perform public.my_session_revoke('00000000-0000-4000-8000-00000000560a'); raise exception 'case the current session is not revoked here failed';
  exception when sqlstate '22023' then null; end;
  if public.my_session_revoke('00000000-0000-4000-8000-00000000560c') then raise exception 'case another member''s session is not mine failed'; end if;
  if not public.my_session_revoke('00000000-0000-4000-8000-00000000560b') then raise exception 'case revoke mine failed'; end if;
  if (select count(*) from public.my_sessions()) <> 1 then raise exception 'case revoke mine leaves one failed'; end if; -- a statement of its own: a stable function sees its statement's snapshot
  begin perform public.member_status_set('00000000-0000-4000-8000-0000000056a1', 'suspended', 'x'); raise exception 'case never oneself failed';
  exception when sqlstate '22023' then null; end;
  begin perform public.member_status_set('00000000-0000-4000-8000-0000000056a2', 'suspended', ''); raise exception 'case a suspension needs a reason failed';
  exception when sqlstate '22023' then null; end;
  perform public.member_status_set('00000000-0000-4000-8000-0000000056a2', 'suspended', 'تأخير متكرر');
  if (select status from public.profiles where id = '00000000-0000-4000-8000-0000000056a2') <> 'suspended' then raise exception 'case suspend failed'; end if;
  perform public.member_status_set('00000000-0000-4000-8000-0000000056a2', 'active', null);
  if (select status from public.profiles where id = '00000000-0000-4000-8000-0000000056a2') <> 'active' then raise exception 'case reactivate failed'; end if;
  if not exists (select 1 from public.activity_log where action = 'settings.member.suspend' and new_value ->> 'reason' = 'تأخير متكرر') then raise exception 'case the suspension is logged failed'; end if;
-- the docs: the admin's rows, stamped by the server
  insert into public.company_docs (name, type, doc_no, issued, expires, path, size, mime) values ('السجل التجاري', 'السجل التجاري', '123456', '2024-03-14', '2027-03-14', 'docs/cr-2024.pdf', 1200000, 'application/pdf');
  if (select created_by from public.company_docs where path = 'docs/cr-2024.pdf') <> '00000000-0000-4000-8000-0000000056a1' then raise exception 'case the doc is stamped failed'; end if;
  begin insert into public.company_docs (name, type, path, issued, expires) values ('x', 'رخصة', 'docs/x.pdf', '2026-01-01', '2025-01-01'); raise exception 'case expires before issued failed';
  exception when check_violation then null; end;
  begin insert into public.company_docs (name, type, path) values ('x', 'رخصة', '../x.pdf'); raise exception 'case a path outside docs/ failed';
  exception when check_violation then null; end;
  -- the Vault door stays the server's even for the admin
  begin perform public.app_secret_get('woo'); raise exception 'case the admin reads a key failed';
  exception when insufficient_privilege then null; end;
  begin perform count(*) from public.alert_state; raise exception 'case the admin reads the engine memory failed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin if exists (select 1 from auth.sessions where user_id = '00000000-0000-4000-8000-0000000056a2') then raise exception 'case suspend ends the sessions failed'; end if; end $$;

-- the server: the Vault door answers (or says Vault is missing on the local stub); the engine's memory is its
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$
declare e jsonb;
begin
  begin
    perform public.app_secret_set('openai', '{"key":"sk-test-0000"}');
    perform public.app_secret_set('woo', '{"url":"https://stage.ibtekr.club","ck":"ck_1","cs":"cs_1","push":true}');
    e := public.app_secret_env();
    if e ->> 'OPENAI_API_KEY' <> 'sk-test-0000' or e ->> 'WOO_URL' <> 'https://stage.ibtekr.club' or e ->> 'WOO_PUSH_ENABLED' <> '1' or e ? 'WOO_WP_USER' then
      raise exception 'case the env map failed: %', e;
    end if;
    perform public.app_secret_set('openai', null);
    if public.app_secret_get('openai') is not null then raise exception 'case a key removed failed'; end if;
    perform public.app_secret_set('woo', null);
  exception when sqlstate '0A000' then null; -- no Vault on the local stub
  end;
  begin perform public.app_secret_set('sync_secret', 'x'); raise exception 'case an unknown name is refused failed';
  exception when sqlstate '22023' then null; when sqlstate '0A000' then null; end;
  insert into public.alert_state (source_key, entity_id, target) values ('customers.late', '1', 'cs');
  if (select sent_count from public.alert_state where source_key = 'customers.late' and entity_id = '1' and target = 'cs') <> 0 then raise exception 'case engine memory failed'; end if; -- the test's own row: live already holds the engine's rows
end $$;

-- forced 2FA on the server: with «security».force2fa = true an aal1 session has no permission and is no admin (enrolled or not);
-- the same session at aal2 is itself again; the member keeps their own profile row and settings_public() on aal1 (what enrolling needs)
update public.settings set data = data || '{"force2fa":true}'::jsonb where section = 'security';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000056a1","role":"authenticated","aal":"aal1"}', true);
do $$ begin
  if public.is_admin() then raise exception 'case forced 2FA: admin on aal1 is still admin failed'; end if;
  if public.has_perm('orders.view') <> 'N' then raise exception 'case forced 2FA: admin on aal1 has permissions failed'; end if;
  if (select count(*) from public.profiles) <> 1 then raise exception 'case forced 2FA: own profile row only failed'; end if;
  if public.settings_public() -> 'security' -> 'force2fa' is distinct from 'true'::jsonb then raise exception 'case forced 2FA: the public slice still tells the client failed'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000056a2","role":"authenticated","aal":"aal1"}', true);
do $$ begin
  if public.has_perm('orders.view') <> 'N' then raise exception 'case forced 2FA: a member on aal1 has permissions failed'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000056a1","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  if not public.is_admin() then raise exception 'case forced 2FA: admin on aal2 failed'; end if;
  if public.has_perm('orders.view') <> 'F' then raise exception 'case forced 2FA: admin on aal2 permissions failed'; end if;
end $$;
reset role;
update public.settings set data = data - 'force2fa' where section = 'security';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000056a2","role":"authenticated","aal":"aal1"}', true);
do $$ begin
  if public.has_perm('orders.view') = 'N' then raise exception 'case forced 2FA off: a member on aal1 is normal again failed'; end if;
end $$;
reset role;

-- anon: nothing
set local role anon;
do $$ begin
  begin perform public.settings_public(); raise exception 'case anon reads the public slice failed';
  exception when insufficient_privilege then null; end;
  begin perform public.app_secret_name_ok('woo'); raise exception 'case anon has no name check failed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

do $$ begin raise notice 'rls_settings: ok'; end $$;
rollback;
