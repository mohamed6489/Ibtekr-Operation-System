-- 0056_settings — phase 11: the settings page on real data (docs/superpowers/plans/2026-11-07-phase-11-settings.md,
-- decisions 9–26).
-- * app_secret_get / app_secret_set / app_secret_env — one Vault door for every platform key the admin writes from
--   «الإعدادات › الربط بالمنصات» (the site's WooCommerce keys, the AI providers, Resend, the platforms without a use yet, an
--   MCP server or custom tool): security definer, service_role only, a fixed list of names; app_secret_env maps the stored
--   JSON onto the env names the functions already read, so Vault wins over a Supabase secret (decision 9).
-- * settings: the new sections (ai_rules, brand, quick, notif) and settings_public() — what every active member needs
--   (the brand, the quick actions, the display prefs, the security policy, the bell matrix with their own override).
-- * roles.hidden + the team RPCs (role_perms_set / role_create / role_update / role_delete / member_role_set /
--   member_perms_set / member_status_set) and the caller's own sessions (my_sessions / my_session_revoke): admin only, the admin role untouchable, never the last admin, a role deleted only after its
--   members moved (a system role is hidden, not deleted); every change logged, a permission change alerts the admins.
-- * company_docs + bucket company-docs (admin only) and bucket settings (the logos / the pattern / the brand references:
--   the admin writes, members read).
-- * alert_state (the notifications engine's memory: repeat, escalation, resolution per alert × entity × target) and
--   alerts.expires_at; cron notify-tick every 15 minutes → the notify function with the sync secret.
-- Re-runnable; no drop / delete / truncate of data.

-- ---------------------------------------------------------------- the platform keys in Vault (decision 9)

create or replace function public.app_secret_name_ok(p_name text) returns boolean
language sql immutable as $$
  select p_name in ('woo', 'anthropic', 'openai', 'gemini', 'elevenlabs', 'higgsfield', 'magnific_api', 'resend',
                    'airtable', 'sheets', 'paymob', 'bosta', 'n8n', 'github', 'figma')
      or p_name ~ '^(mcp|custom)_[a-z0-9][a-z0-9_]{0,39}$'
$$;

create or replace function public.app_secret_get(p_name text) returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  v_value text;
begin
  if coalesce(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' is distinct from 'service_role' then
    raise exception 'service_role only' using errcode = '42501';
  end if;
  if not public.app_secret_name_ok(p_name) then raise exception 'unknown secret' using errcode = '22023'; end if;
  if to_regclass('vault.decrypted_secrets') is null then raise exception 'vault is not available' using errcode = '0A000'; end if;
  select s.decrypted_secret into v_value from vault.decrypted_secrets s where s.name = 'app_' || p_name;
  return v_value;
end
$$;

-- p_value null = the key is removed
create or replace function public.app_secret_set(p_name text, p_value text) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if coalesce(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' is distinct from 'service_role' then
    raise exception 'service_role only' using errcode = '42501';
  end if;
  if not public.app_secret_name_ok(p_name) then raise exception 'unknown secret' using errcode = '22023'; end if;
  if to_regclass('vault.decrypted_secrets') is null then raise exception 'vault is not available' using errcode = '0A000'; end if;
  select s.id into v_id from vault.secrets s where s.name = 'app_' || p_name;
  if p_value is null then
    if v_id is not null then delete from vault.secrets where id = v_id; end if;
    return;
  end if;
  if v_id is null then
    perform vault.create_secret(p_value, 'app_' || p_name, 'platform key written from the settings page (0056_settings)');
  else
    perform vault.update_secret(v_id, p_value);
  end if;
end
$$;

-- The stored JSON of the keys the functions read, as env names (Vault over a Supabase secret). Only the names a function
-- reads today; an unknown or unparsable value is skipped. service_role only.
create or replace function public.app_secret_env() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_out jsonb := '{}'::jsonb;
  r record;
  v jsonb;
begin
  if coalesce(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' is distinct from 'service_role' then
    raise exception 'service_role only' using errcode = '42501';
  end if;
  if to_regclass('vault.decrypted_secrets') is null then return v_out; end if;
  for r in select s.name, s.decrypted_secret from vault.decrypted_secrets s where s.name like 'app\_%' loop
    begin v := r.decrypted_secret::jsonb; exception when others then v := null; end;
    if v is null or jsonb_typeof(v) <> 'object' then continue; end if;
    case r.name
      when 'app_woo' then
        v_out := v_out || jsonb_strip_nulls(jsonb_build_object('WOO_URL', v ->> 'url', 'WOO_CK', v ->> 'ck', 'WOO_CS', v ->> 'cs',
                   'WOO_WP_USER', v ->> 'wp_user', 'WOO_WP_APP_PASSWORD', v ->> 'wp_app_password',
                   'WOO_PUSH_ENABLED', case when v ? 'push' then case when (v ->> 'push') in ('1', 'true') then '1' else '0' end end));
      when 'app_anthropic' then v_out := v_out || jsonb_strip_nulls(jsonb_build_object('ANTHROPIC_API_KEY', v ->> 'key'));
      when 'app_openai' then v_out := v_out || jsonb_strip_nulls(jsonb_build_object('OPENAI_API_KEY', v ->> 'key'));
      when 'app_gemini' then v_out := v_out || jsonb_strip_nulls(jsonb_build_object('GEMINI_API_KEY', v ->> 'key'));
      when 'app_elevenlabs' then v_out := v_out || jsonb_strip_nulls(jsonb_build_object('ELEVENLABS_API_KEY', v ->> 'key'));
      when 'app_higgsfield' then v_out := v_out || jsonb_strip_nulls(jsonb_build_object('HIGGSFIELD_API_KEY', v ->> 'key', 'HIGGSFIELD_API_SECRET', v ->> 'secret'));
      when 'app_magnific_api' then v_out := v_out || jsonb_strip_nulls(jsonb_build_object('MAGNIFIC_API_KEY', v ->> 'key'));
      when 'app_resend' then v_out := v_out || jsonb_strip_nulls(jsonb_build_object('RESEND_API_KEY', v ->> 'key', 'RESEND_FROM', v ->> 'from'));
      else null;
    end case;
  end loop;
  return v_out;
end
$$;

revoke execute on function public.app_secret_name_ok(text) from public, anon;
grant execute on function public.app_secret_name_ok(text) to authenticated, service_role;
revoke execute on function public.app_secret_get(text) from public, anon, authenticated;
revoke execute on function public.app_secret_set(text, text) from public, anon, authenticated;
revoke execute on function public.app_secret_env() from public, anon, authenticated;
grant execute on function public.app_secret_get(text) to service_role;
grant execute on function public.app_secret_set(text, text) to service_role;
grant execute on function public.app_secret_env() to service_role;

-- ---------------------------------------------------------------- settings: the new sections + what every member reads

insert into public.settings (section, data) values ('ai_rules', '{}'), ('brand', '{}'), ('quick', '{}'), ('notif', '{}')
on conflict (section) do nothing;

-- The slice of the settings every active member needs at sign-in (the page itself stays admin-only): the brand, the quick
-- actions, the display prefs of «عام», the security policy, the bell matrix and the caller's own override.
create or replace function public.settings_public() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_general jsonb; v_security jsonb; v_notif jsonb;
begin
  if v_uid is null or not exists (select 1 from public.profiles p where p.id = v_uid and p.status = 'active') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select data into v_general from public.settings where section = 'general';
  select data into v_security from public.settings where section = 'security';
  select data into v_notif from public.settings where section = 'notif';
  return jsonb_build_object(
    'brand', coalesce((select data from public.settings where section = 'brand'), '{}'::jsonb),
    'quick', coalesce((select data from public.settings where section = 'quick'), '{}'::jsonb),
    'general', jsonb_strip_nulls(jsonb_build_object('company', v_general ->> 'company', 'site', v_general ->> 'site', 'tz', v_general ->> 'tz',
                 'week', v_general ->> 'week', 'compact', v_general -> 'compact', 'thumbs', v_general -> 'thumbs',
                 'rememberFilters', v_general -> 'rememberFilters', 'hidePhones', v_general -> 'hidePhones')),
    'security', jsonb_strip_nulls(jsonb_build_object('force2fa', v_security -> 'force2fa', 'idle', v_security -> 'idle',
                 'idleDesktop', v_security ->> 'idleDesktop', 'idleMobile', v_security ->> 'idleMobile', 'pwMin', v_security ->> 'pwMin')),
    'notif', jsonb_strip_nulls(jsonb_build_object('alertRoles', coalesce(v_notif -> 'alertRoles', '{}'::jsonb),
                 'myOverride', coalesce(v_notif -> 'alertOverrides' -> v_uid::text, '{}'::jsonb),
                 'whatsappTemplate', v_notif ->> 'whatsappTemplate')));
end
$$;
revoke execute on function public.settings_public() from public, anon;
grant execute on function public.settings_public() to authenticated, service_role;

-- ---------------------------------------------------------------- the team: roles and members (decision 12)

alter table public.roles add column if not exists hidden boolean not null default false;

create or replace function public.perms_ok(p_perms jsonb) returns boolean
language sql immutable as $$
  select p_perms is not null and jsonb_typeof(p_perms) = 'object'
     and not exists (select 1 from jsonb_each_text(p_perms) e where e.key !~ '^[a-z_]+\.[a-z_0-9]+$' or e.value not in ('F', 'P', 'N'))
$$;
revoke execute on function public.perms_ok(jsonb) from public, anon;
grant execute on function public.perms_ok(jsonb) to authenticated, service_role;

-- an alert for the admins when a permission or a role changes (settings «activity» permAlert, default on)
create or replace function public.perm_change_alert(p_title text, p_entity text) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if coalesce((select (data ->> 'permAlert')::boolean from public.settings where section = 'activity'), true) then
    insert into public.alerts (kind, title, role_id, entity, entity_id) values ('settings.perm', p_title, 'admin', 'settings-team', p_entity);
  end if;
end
$$;
revoke execute on function public.perm_change_alert(text, text) from public, anon, authenticated;

-- the whole permission map of a role (the admin's row never changes: it is F everywhere by has_perm)
create or replace function public.role_perms_set(p_role text, p_perms jsonb) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  v_old jsonb; v_changed text[];
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_role = 'admin' then raise exception 'the admin role has every permission' using errcode = '22023'; end if;
  if not public.perms_ok(p_perms) then raise exception 'invalid: perms' using errcode = '22023'; end if;
  select permissions into v_old from public.roles where id = p_role for update;
  if v_old is null then raise exception 'no such role' using errcode = 'P0002'; end if;
  select coalesce(array_agg(k order by k), '{}') into v_changed
    from (select e.key as k from jsonb_each_text(p_perms) e where coalesce(v_old ->> e.key, 'N') is distinct from e.value
          union select e.key from jsonb_each_text(v_old) e where not (p_perms ? e.key) and e.value <> 'N') c;
  update public.roles set permissions = p_perms where id = p_role;
  perform public.log_activity('settings.role.perms', 'role', p_role, to_jsonb(v_changed), p_perms);
  if coalesce(array_length(v_changed, 1), 0) > 0 then
    perform public.perm_change_alert('اتغيّرت صلاحيات دور «' || (select name from public.roles where id = p_role) || '» (' || array_length(v_changed, 1) || ')', p_role);
  end if;
end
$$;

-- a custom role: a copy of the base role's permissions, the name and description from the admin
create or replace function public.role_create(p_id text, p_name text, p_desc text, p_base text) returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  v_perms jsonb;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_id !~ '^[a-z][a-z0-9_]{1,30}$' then raise exception 'invalid: id' using errcode = '22023'; end if;
  if coalesce(btrim(p_name), '') = '' or length(btrim(p_name)) > 40 then raise exception 'invalid: name' using errcode = '22023'; end if;
  if exists (select 1 from public.roles where id = p_id or lower(btrim(name)) = lower(btrim(p_name))) then raise exception 'exists' using errcode = '23505'; end if;
  select case when id = 'admin' then '{}'::jsonb else permissions end into v_perms from public.roles where id = p_base and not hidden;
  if v_perms is null then raise exception 'invalid: base' using errcode = '22023'; end if;
  insert into public.roles (id, name, description, is_system, permissions, sort)
  values (p_id, btrim(p_name), nullif(btrim(coalesce(p_desc, '')), ''), false, v_perms, coalesce((select max(sort) from public.roles), 0) + 1);
  perform public.log_activity('settings.role.create', 'role', p_id, null, jsonb_build_object('name', btrim(p_name), 'base', p_base));
  perform public.perm_change_alert('اتعمل دور جديد «' || btrim(p_name) || '»', p_id);
  return p_id;
end
$$;

-- the name (a custom role only) and the description
create or replace function public.role_update(p_role text, p_name text, p_desc text) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  r record;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select * into r from public.roles where id = p_role for update;
  if r.id is null then raise exception 'no such role' using errcode = 'P0002'; end if;
  if p_name is not null and btrim(p_name) <> r.name then
    if r.is_system then raise exception 'invalid: name' using errcode = '22023'; end if;
    if coalesce(btrim(p_name), '') = '' or length(btrim(p_name)) > 40 then raise exception 'invalid: name' using errcode = '22023'; end if;
    if exists (select 1 from public.roles where id <> p_role and lower(btrim(name)) = lower(btrim(p_name))) then raise exception 'exists' using errcode = '23505'; end if;
    update public.roles set name = btrim(p_name) where id = p_role;
  end if;
  update public.roles set description = nullif(btrim(coalesce(p_desc, '')), '') where id = p_role;
  perform public.log_activity('settings.role.update', 'role', p_role, null, jsonb_build_object('name', coalesce(btrim(p_name), r.name)));
end
$$;

-- delete a role: every member on it moves first (p_moves: { "<member uuid>": "<role>", "*": "<default role>" }); a system
-- role is hidden instead of deleted (its id is referenced by history)
create or replace function public.role_delete(p_role text, p_moves jsonb) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  r record; m record; v_to text; v_moved jsonb := '[]'::jsonb;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_role = 'admin' then raise exception 'the admin role cannot be deleted' using errcode = '22023'; end if;
  select * into r from public.roles where id = p_role for update;
  if r.id is null then raise exception 'no such role' using errcode = 'P0002'; end if;
  for m in select p.id, p.name from public.profiles p where p.role_id = p_role loop
    v_to := coalesce(p_moves ->> m.id::text, p_moves ->> '*');
    if v_to is null or v_to = p_role or not exists (select 1 from public.roles x where x.id = v_to and not x.hidden) then
      raise exception 'invalid: moves' using errcode = '22023';
    end if;
    update public.profiles set role_id = v_to where id = m.id;
    v_moved := v_moved || jsonb_build_object('member', m.id, 'to', v_to);
  end loop;
  if r.is_system then update public.roles set hidden = true where id = p_role;
  else delete from public.roles where id = p_role; end if;
  perform public.log_activity('settings.role.delete', 'role', p_role, jsonb_build_object('name', r.name), v_moved);
  perform public.perm_change_alert('اتحذف دور «' || r.name || '»', p_role);
end
$$;

-- a member's role; never the last active admin out of the admin role
create or replace function public.member_role_set(p_member uuid, p_role text) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  v_old text;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if not exists (select 1 from public.roles where id = p_role and not hidden) then raise exception 'invalid: role' using errcode = '22023'; end if;
  select role_id into v_old from public.profiles where id = p_member for update;
  if v_old is null then raise exception 'no such member' using errcode = 'P0002'; end if;
  if v_old = p_role then return; end if;
  if v_old = 'admin' and (select count(*) from public.profiles where role_id = 'admin' and status = 'active' and id <> p_member) = 0 then
    raise exception 'last admin' using errcode = '22023';
  end if;
  update public.profiles set role_id = p_role where id = p_member;
  perform public.log_activity('settings.member.role', 'profile', p_member::text, to_jsonb(v_old), to_jsonb(p_role));
  perform public.perm_change_alert('اتغيّر دور عضو: ' || v_old || ' ← ' || p_role, p_member::text);
end
$$;

-- a member's own overrides on top of the role (profiles.custom_perms); an admin has no overrides
create or replace function public.member_perms_set(p_member uuid, p_perms jsonb) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  v_role text;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if not public.perms_ok(p_perms) then raise exception 'invalid: perms' using errcode = '22023'; end if;
  select role_id into v_role from public.profiles where id = p_member for update;
  if v_role is null then raise exception 'no such member' using errcode = 'P0002'; end if;
  if v_role = 'admin' then raise exception 'invalid: admin' using errcode = '22023'; end if;
  update public.profiles set custom_perms = p_perms where id = p_member;
  perform public.log_activity('settings.member.perms', 'profile', p_member::text, null, to_jsonb((select coalesce(array_agg(k order by k), '{}') from jsonb_object_keys(p_perms) k)));
  perform public.perm_change_alert('اتغيّرت الصلاحيات المخصصة لعضو (' || (select count(*) from jsonb_object_keys(p_perms)) || ')', p_member::text);
end
$$;

revoke execute on function public.role_perms_set(text, jsonb) from public, anon;
revoke execute on function public.role_create(text, text, text, text) from public, anon;
revoke execute on function public.role_update(text, text, text) from public, anon;
revoke execute on function public.role_delete(text, jsonb) from public, anon;
revoke execute on function public.member_role_set(uuid, text) from public, anon;
revoke execute on function public.member_perms_set(uuid, jsonb) from public, anon;
grant execute on function public.role_perms_set(text, jsonb) to authenticated, service_role;
grant execute on function public.role_create(text, text, text, text) to authenticated, service_role;
grant execute on function public.role_update(text, text, text) to authenticated, service_role;
grant execute on function public.role_delete(text, jsonb) to authenticated, service_role;
grant execute on function public.member_role_set(uuid, text) to authenticated, service_role;
grant execute on function public.member_perms_set(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------- the sessions and a member's status (decision 19 / 12)

-- the caller's own sessions (auth.sessions is not exposed to PostgREST; the definer reads it for auth.uid() only)
create or replace function public.my_sessions()
returns table (id uuid, created_at timestamptz, refreshed_at timestamptz, user_agent text, ip text, aal text, current boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_sid text := coalesce(current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id';
begin
  if v_uid is null then raise exception 'not allowed' using errcode = '42501'; end if;
  return query select s.id, s.created_at, s.refreshed_at, left(coalesce(s.user_agent, ''), 200), host(s.ip), s.aal::text, (s.id::text = v_sid)
    from auth.sessions s where s.user_id = v_uid order by s.refreshed_at desc nulls last, s.created_at desc;
end
$$;

-- end one of the caller's own sessions (not the current one — «تسجيل الخروج» does that)
create or replace function public.my_session_revoke(p_id uuid) returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_sid text := coalesce(current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id';
  n int;
begin
  if v_uid is null then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_id::text = v_sid then raise exception 'invalid: current' using errcode = '22023'; end if;
  delete from auth.sessions s where s.id = p_id and s.user_id = v_uid;
  get diagnostics n = row_count;
  if n > 0 then perform public.log_activity('settings.session.revoke', 'profile', v_uid::text, null, null); end if;
  return n > 0;
end
$$;

-- suspend / reactivate a member (the admin; never oneself, never the last active admin); a suspension ends every session of
-- the member here — settings-admin bans the Auth user beside it. The reason is logged (an admin's note on a member, not PII).
create or replace function public.member_status_set(p_member uuid, p_status text, p_reason text) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  v_old record;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_status not in ('active', 'suspended') then raise exception 'invalid: status' using errcode = '22023'; end if;
  if p_member = auth.uid() then raise exception 'invalid: self' using errcode = '22023'; end if;
  select status, role_id, name into v_old from public.profiles where id = p_member for update;
  if v_old.status is null then raise exception 'no such member' using errcode = 'P0002'; end if;
  if v_old.status = p_status then return; end if;
  if p_status = 'suspended' and coalesce(btrim(p_reason), '') = '' then raise exception 'invalid: reason' using errcode = '22023'; end if;
  if p_status = 'suspended' and v_old.role_id = 'admin' and (select count(*) from public.profiles where role_id = 'admin' and status = 'active' and id <> p_member) = 0 then
    raise exception 'last admin' using errcode = '22023';
  end if;
  update public.profiles set status = p_status where id = p_member;
  if p_status = 'suspended' then delete from auth.sessions s where s.user_id = p_member; end if;
  perform public.log_activity('settings.member.' || case when p_status = 'suspended' then 'suspend' else 'reactivate' end, 'profile', p_member::text,
    to_jsonb(v_old.status), jsonb_strip_nulls(jsonb_build_object('status', p_status, 'reason', nullif(left(btrim(coalesce(p_reason, '')), 300), ''))));
end
$$;

revoke execute on function public.my_sessions() from public, anon;
revoke execute on function public.my_session_revoke(uuid) from public, anon;
revoke execute on function public.member_status_set(uuid, text, text) from public, anon;
grant execute on function public.my_sessions() to authenticated, service_role;
grant execute on function public.my_session_revoke(uuid) to authenticated, service_role;
grant execute on function public.member_status_set(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------- the company's official documents (decision 20)

create table if not exists public.company_docs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  type text not null check (length(type) between 1 and 40),
  doc_no text check (doc_no is null or length(doc_no) <= 60),
  issued date,
  expires date,
  path text not null check (path ~ '^docs/[A-Za-z0-9._-]{1,160}$'),
  size bigint check (size is null or size >= 0),
  mime text,
  notes text check (notes is null or length(notes) <= 1000),
  created_by uuid references public.profiles,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_docs_dates check (issued is null or expires is null or expires >= issued)
);
alter table public.company_docs enable row level security;
drop policy if exists company_docs_admin on public.company_docs;
create policy company_docs_admin on public.company_docs for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
grant select, insert, update, delete on public.company_docs to authenticated, service_role;
revoke truncate, references, trigger on public.company_docs from authenticated;

create or replace function public.company_docs_stamp() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then new.created_by := auth.uid(); new.created_at := now(); else new.created_by := old.created_by; new.created_at := old.created_at; end if;
  return new;
end
$$;
revoke execute on function public.company_docs_stamp() from public, anon, authenticated;
drop trigger if exists company_docs_stamp on public.company_docs;
create trigger company_docs_stamp before insert or update on public.company_docs for each row execute function public.company_docs_stamp();

do $storage$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') and to_regclass('storage.buckets') is not null then
    -- the official documents: the admin alone, PDF or an image, 20 MB
    execute $s$insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
               values ('company-docs', 'company-docs', false, 20971520, '{application/pdf,image/png,image/jpeg,image/webp}')
               on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types$s$;
    execute $s$drop policy if exists company_docs_files_admin on storage.objects$s$;
    execute $s$create policy company_docs_files_admin on storage.objects for all to authenticated
               using (bucket_id = 'company-docs' and (select public.is_admin())) with check (bucket_id = 'company-docs' and (select public.is_admin()))$s$;
    -- the brand files (logos, the pattern, the brand references): the admin writes, every member reads
    execute $s$insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
               values ('settings', 'settings', false, 2097152, '{image/png,image/svg+xml,image/webp,image/jpeg}')
               on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types$s$;
    execute $s$drop policy if exists settings_files_select on storage.objects$s$;
    execute $s$create policy settings_files_select on storage.objects for select to authenticated
               using (bucket_id = 'settings' and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'active'))$s$;
    execute $s$drop policy if exists settings_files_write on storage.objects$s$;
    execute $s$create policy settings_files_write on storage.objects for insert to authenticated
               with check (bucket_id = 'settings' and (select public.is_admin()))$s$;
    execute $s$drop policy if exists settings_files_update on storage.objects$s$;
    execute $s$create policy settings_files_update on storage.objects for update to authenticated
               using (bucket_id = 'settings' and (select public.is_admin())) with check (bucket_id = 'settings' and (select public.is_admin()))$s$;
    execute $s$drop policy if exists settings_files_delete on storage.objects$s$;
    execute $s$create policy settings_files_delete on storage.objects for delete to authenticated
               using (bucket_id = 'settings' and (select public.is_admin()))$s$;
  end if;
end $storage$;

-- ---------------------------------------------------------------- the notifications engine's memory (decision 16)

alter table public.alerts add column if not exists expires_at timestamptz;
alter table public.alerts add column if not exists source_key text;
create index if not exists alerts_source_key_idx on public.alerts (source_key, entity_id);

create table if not exists public.alert_state (
  source_key text not null,
  entity_id text not null,
  target text not null, -- a role id or a member uuid as text
  first_at timestamptz not null default now(),
  last_sent_at timestamptz,
  sent_count int not null default 0,
  escalated_at timestamptz,
  resolved_at timestamptz,
  channel_log jsonb not null default '[]',
  primary key (source_key, entity_id, target)
);
alter table public.alert_state enable row level security;
revoke all on public.alert_state from public, anon, authenticated;
grant select, insert, update, delete on public.alert_state to service_role;

-- notify-tick: every 15 minutes → the notify function (the engine), with the sync secret of 0008
do $$
begin
  if to_regnamespace('cron') is null or to_regnamespace('net') is null or to_regclass('vault.decrypted_secrets') is null then
    raise notice '0056: pg_cron / pg_net / Vault not here — notify-tick is not scheduled';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'notify-tick') then perform cron.unschedule('notify-tick'); end if;
  perform cron.schedule('notify-tick', '*/15 * * * *', $cron$
    select net.http_post(
      url := 'https://fsynculhaupcktzkfkdd.supabase.co/functions/v1/notify',
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'X-Sync-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_secret')),
      body := '{"action":"tick"}'::jsonb,
      timeout_milliseconds := 120000
    )
  $cron$);
end $$;

-- ---------------------------------------------------------------- forced 2FA on the server (security review, 7 Nov)

-- True while the admin's security policy says every member must use 2FA (settings «security».force2fa). While it is on,
-- has_perm / is_admin give nothing to a session that is not aal2 — enrolled or not — so the client's redirect to
-- «ملفي › الحساب والأمان» is for the experience only. What a member still has on aal1: their own profile row (the
-- profiles policy's id = auth.uid()), settings_public() (it needs an active profile, not a permission) and the Auth MFA
-- endpoints + mark_twofa_enrolled() (aal2 by then) — exactly what enrolling needs.
create or replace function public.force2fa_on() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (s.data -> 'force2fa') = 'true'::jsonb from public.settings s where s.section = 'security'), false)
$$;
revoke execute on function public.force2fa_on() from public, anon;
grant execute on function public.force2fa_on() to authenticated, service_role;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role_id = 'admin' and status = 'active'
      and not ((coalesce(twofa, false) or public.force2fa_on()) and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2')
  )
$$;

create or replace function public.has_perm(key text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when p.status <> 'active' then 'N'
      when (coalesce(p.twofa, false) or public.force2fa_on()) and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then 'N'
      when p.role_id = 'admin' then 'F'
      when p.custom_perms ? key then p.custom_perms ->> key
      else r.permissions ->> key
    end
    from public.profiles p
    left join public.roles r on r.id = p.role_id
    where p.id = auth.uid()
  ), 'N')
$$;
