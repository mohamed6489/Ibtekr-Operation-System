-- 0092_role_managers.sql — owner batch 14 Nov decision 16 (docs/superpowers/plans/2026-11-14-owner-batch.md — the owner: «نلغي الاقسام دي
-- خالص من السيستم كله مدام فيه ادوار و صلاحيات … هبقي محتاج ادي حد صلاحية مدير القسم», then «شيلها + مدير الدور»). Re-runnable.
-- * The departments leave the system: «أوقات عمل مخصصة» key a role now (settings.hr.schedules.role — hr_schedule reads the member's
--   primary role instead of profiles.dept). profiles.dept and settings.hr.departments stay in the tables, read by nothing.
-- * «مدير الدور»: roles.manager_id. profiles.manager_id stays the one source every HR rule reads (hr_is_manager_of / hr_can_see / the
--   approvals): a member whose manager was not set by hand (profiles.manager_fixed = false) has his role's manager — kept by two
--   triggers: a role's new manager reaches its members (roles_manager_sync), a member who changes role or comes new without a manager
--   takes his role's (profiles_role_manager). The manager himself has no manager from his own role.
-- * role_manager_set(role, manager | null) — the admin; member_manager_set(member, manager | null) — the admin or hr.edit F (null = back
--   to the role's manager; never oneself nor anyone up one's chain; hr.edit F never on himself, on an admin, nor naming himself).
--   activity_log hr.role.manager / hr.member.manager (ids only).
-- * The managers set before this were set by hand: they stay (manager_fixed = true, once, when the column comes).

alter table public.roles add column if not exists manager_id uuid references public.profiles on delete set null;

do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'manager_fixed') then
    alter table public.profiles add column manager_fixed boolean not null default false;
    update public.profiles set manager_fixed = true where manager_id is not null;
  end if;
end $$;

-- a member who changes role, or comes new without a manager, takes his role's manager (unless his was set by hand)
create or replace function public.profiles_role_manager() returns trigger
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if tg_op = 'INSERT' then
    if new.manager_id is not null then new.manager_fixed := true; return new; end if;
  elsif not (new.role_id is distinct from old.role_id or (old.manager_fixed and not new.manager_fixed)) then
    return new;
  end if;
  if new.manager_fixed then return new; end if;
  select r.manager_id into v from public.roles r where r.id = new.role_id;
  new.manager_id := case when v = new.id then null else v end;
  return new;
end $$;
revoke execute on function public.profiles_role_manager() from public, anon, authenticated;
drop trigger if exists profiles_role_manager on public.profiles;
create trigger profiles_role_manager before insert or update of role_id, manager_fixed on public.profiles
  for each row execute function public.profiles_role_manager();

-- a role's new manager reaches its members whose manager was not set by hand
create or replace function public.roles_manager_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles p set manager_id = case when p.id = new.manager_id then null else new.manager_id end
  where p.role_id = new.id and not p.manager_fixed
    and p.manager_id is distinct from (case when p.id = new.manager_id then null else new.manager_id end);
  return null;
end $$;
revoke execute on function public.roles_manager_sync() from public, anon, authenticated;
drop trigger if exists roles_manager_sync on public.roles;
create trigger roles_manager_sync after update of manager_id on public.roles
  for each row when (new.manager_id is distinct from old.manager_id) execute function public.roles_manager_sync();

create or replace function public.role_manager_set(p_role text, p_manager uuid) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_old uuid;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select manager_id into v_old from public.roles where id = p_role and not hidden for update;
  if not found then raise exception 'invalid: role' using errcode = '22023'; end if;
  if p_manager is not null and not exists (select 1 from public.profiles where id = p_manager and status = 'active') then
    raise exception 'invalid: manager' using errcode = '22023';
  end if;
  if p_manager is not distinct from v_old then return jsonb_build_object('members', 0); end if;
  update public.roles set manager_id = p_manager where id = p_role;
  perform public.log_activity('hr.role.manager', 'role', p_role, to_jsonb(v_old::text), to_jsonb(p_manager::text));
  return jsonb_build_object('members', (select count(*) from public.profiles where role_id = p_role and not manager_fixed and status = 'active' and id is distinct from p_manager));
end $$;
revoke execute on function public.role_manager_set(text, uuid) from public, anon;
grant execute on function public.role_manager_set(text, uuid) to authenticated, service_role;

create or replace function public.member_manager_set(p_member uuid, p_manager uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
declare v_old uuid; v_role text; v_auto uuid; v_admin boolean := public.is_admin();
begin
  if not (v_admin or public.hr_editor()) then raise exception 'not allowed' using errcode = '42501'; end if;
  select manager_id, role_id into v_old, v_role from public.profiles where id = p_member for update;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  -- hr.edit F (not the admin): never on himself, never on an admin, and never naming himself the manager (the approvals follow it)
  if not v_admin and (p_member = auth.uid() or p_manager = auth.uid() or v_role = 'admin') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_manager is null then -- back to the role's manager
    select r.manager_id into v_auto from public.roles r where r.id = v_role;
    update public.profiles set manager_fixed = false, manager_id = case when v_auto = p_member then null else v_auto end where id = p_member;
  else
    if p_manager = p_member or not exists (select 1 from public.profiles where id = p_manager and status = 'active')
       or exists (with recursive up(id, d) as ( -- no loop anywhere up the new manager's chain
         select p_manager, 0
         union all select p.manager_id, up.d + 1 from public.profiles p join up on p.id = up.id where p.manager_id is not null and up.d < 50)
         select 1 from up where up.id = p_member) then
      raise exception 'invalid: manager' using errcode = '22023';
    end if;
    update public.profiles set manager_id = p_manager, manager_fixed = true where id = p_member;
  end if;
  perform public.log_activity('hr.member.manager', 'hr', p_member::text, to_jsonb(v_old::text), to_jsonb((select manager_id from public.profiles where id = p_member)::text));
end $$;
revoke execute on function public.member_manager_set(uuid, uuid) from public, anon;
grant execute on function public.member_manager_set(uuid, uuid) to authenticated, service_role;

-- «أوقات عمل مخصصة»: the member's own, else his role's, else the official hours (0087 read his department)
create or replace function public.hr_schedule(p_member uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with s as (select coalesce((select data from public.settings where section = 'hr'), '{}'::jsonb) as d),
  c as (
    select s.d -> 'schedules' -> 'member' -> (p_member::text) as m,
      s.d -> 'schedules' -> 'role' -> (select p.role_id from public.profiles p where p.id = p_member) as g,
      jsonb_build_object('from', s.d ->> 'workFrom', 'to', s.d ->> 'workTo') as o
    from s)
  select case
    when public.hr_span(c.m ->> 'from', c.m ->> 'to') is not null then jsonb_build_object('from', c.m ->> 'from', 'to', c.m ->> 'to', 'kind', 'member')
    when public.hr_span(c.g ->> 'from', c.g ->> 'to') is not null then jsonb_build_object('from', c.g ->> 'from', 'to', c.g ->> 'to', 'kind', 'role')
    when public.hr_span(c.o ->> 'from', c.o ->> 'to') is not null then jsonb_build_object('from', c.o ->> 'from', 'to', c.o ->> 'to', 'kind', 'general')
    else '{"from":"09:00","to":"17:00","kind":"general"}'::jsonb end
  from c
$$;
revoke execute on function public.hr_schedule(uuid) from public, anon, authenticated;
grant execute on function public.hr_schedule(uuid) to service_role;
