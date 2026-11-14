-- 0096 — owner batch 2 decisions 2 and 4 (docs/superpowers/plans/2026-11-14-owner-batch-2.md): a role has three permission groups —
-- مدير / موظف / مشاهد — and a member has a role and a level.
-- * roles.permissions stays the «موظف» group (every existing rule, RPC and reader keeps working); roles.level_perms holds the
--   «manager» and «viewer» groups ({ manager: {...}, viewer: {...} }); a level with no group of its own = the «موظف» group (so a role
--   starts with the same permissions on its three levels — «أول تطبيق: صلاحيات كل دور الحالية بتتنسخ للتلات مستويات»).
-- * profiles.level: manager | employee (default) | viewer. Changed by the admin only (member_level_set) — it changes what a member
--   may do; profiles_guard_update (0001) already refuses any column but name / phone to a non-admin.
-- * has_perm: the main role with the member's level group, the extra roles with their «موظف» group (the owner's answer), custom_perms
--   over everything and the admin F, as before.
-- * The current role managers (roles.manager_id, 0092) are «مدير» on their role.

-- ---------------------------------------------------------------- the columns
alter table public.roles add column if not exists level_perms jsonb not null default '{}'::jsonb;
alter table public.roles drop constraint if exists roles_level_perms_check;
alter table public.roles add constraint roles_level_perms_check check (jsonb_typeof(level_perms) = 'object' and not (level_perms ? 'employee'));
alter table public.profiles add column if not exists level text not null default 'employee';
alter table public.profiles drop constraint if exists profiles_level_check;
alter table public.profiles add constraint profiles_level_check check (level in ('manager', 'employee', 'viewer'));

update public.profiles p set level = 'manager'
 where p.role_id <> 'admin' and p.level = 'employee'
   and exists (select 1 from public.roles r where r.manager_id = p.id and r.id = p.role_id);

-- the permission group of a role at a level (the «موظف» group when the level has none of its own)
create or replace function public.role_level_perms(p_role public.roles, p_level text) returns jsonb
language sql stable set search_path = public as $$
  select case when p_level in ('manager', 'viewer') and jsonb_typeof(p_role.level_perms -> p_level) = 'object'
              then p_role.level_perms -> p_level else p_role.permissions end
$$;
revoke execute on function public.role_level_perms(public.roles, text) from public, anon;
grant execute on function public.role_level_perms(public.roles, text) to authenticated, service_role;

-- ---------------------------------------------------------------- has_perm with the level
create or replace function public.has_perm(key text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when p.status <> 'active' then 'N'
      when (coalesce(p.twofa, false) or public.force2fa_on()) and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then 'N'
      when p.role_id = 'admin' then 'F'
      when p.custom_perms ? key then p.custom_perms ->> key
      else (select case max(case (case when r.id = p.role_id then public.role_level_perms(r, p.level) else r.permissions end) ->> key
                                 when 'F' then 2 when 'P' then 1 else 0 end) when 2 then 'F' when 1 then 'P' else 'N' end
              from public.roles r
             where r.id = p.role_id or (r.id = any (coalesce(p.extra_roles, '{}'::text[])) and not r.hidden and r.id <> 'admin'))
    end
    from public.profiles p
    where p.id = auth.uid()
  ), 'N')
$$;

-- ---------------------------------------------------------------- the writes (the admin only)
-- a role's permissions at a level — employee = roles.permissions (role_perms_set), manager / viewer = roles.level_perms
create or replace function public.role_level_perms_set(p_role text, p_level text, p_perms jsonb) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  v_old jsonb; v_changed text[]; v_name text;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_level = 'employee' then perform public.role_perms_set(p_role, p_perms); return; end if;
  if p_level is null or p_level not in ('manager', 'viewer') then raise exception 'invalid: level' using errcode = '22023'; end if;
  if p_role = 'admin' then raise exception 'the admin role has every permission' using errcode = '22023'; end if;
  if not public.perms_ok(p_perms) then raise exception 'invalid: perms' using errcode = '22023'; end if;
  select public.role_level_perms(r, p_level), r.name into v_old, v_name from public.roles r where r.id = p_role for update;
  if v_name is null then raise exception 'no such role' using errcode = 'P0002'; end if;
  select coalesce(array_agg(k order by k), '{}') into v_changed
    from (select e.key as k from jsonb_each_text(p_perms) e where coalesce(v_old ->> e.key, 'N') is distinct from e.value
          union select e.key from jsonb_each_text(v_old) e where not (p_perms ? e.key) and e.value <> 'N') c;
  update public.roles set level_perms = jsonb_set(level_perms, array[p_level], p_perms, true) where id = p_role;
  perform public.log_activity('settings.role.perms', 'role', p_role, to_jsonb(v_changed), jsonb_build_object('level', p_level));
  if coalesce(array_length(v_changed, 1), 0) > 0 then
    perform public.perm_change_alert('اتغيّرت صلاحيات «' || case p_level when 'manager' then 'المدير' else 'المشاهد' end || '» في دور «' || v_name || '» (' || array_length(v_changed, 1) || ')', p_role);
  end if;
end
$$;
revoke execute on function public.role_level_perms_set(text, text, jsonb) from public, anon;
grant execute on function public.role_level_perms_set(text, text, jsonb) to authenticated, service_role;

-- a member's level on his main role
create or replace function public.member_level_set(p_member uuid, p_level text) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  v_old text; v_role text;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_level is null or p_level not in ('manager', 'employee', 'viewer') then raise exception 'invalid: level' using errcode = '22023'; end if;
  select level, role_id into v_old, v_role from public.profiles where id = p_member for update;
  if v_role is null then raise exception 'no such member' using errcode = 'P0002'; end if;
  if v_role = 'admin' then raise exception 'invalid: admin' using errcode = '22023'; end if;
  if v_old = p_level then return; end if;
  update public.profiles set level = p_level where id = p_member;
  perform public.log_activity('settings.member.level', 'profile', p_member::text, to_jsonb(v_old), to_jsonb(p_level));
  perform public.perm_change_alert('اتغيّر مستوى عضو في دوره', p_member::text);
end
$$;
revoke execute on function public.member_level_set(uuid, text) from public, anon;
grant execute on function public.member_level_set(uuid, text) to authenticated, service_role;
