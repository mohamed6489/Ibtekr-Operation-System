-- 0098 — owner batch 2 decision 16 (docs/superpowers/plans/2026-11-14-owner-batch-2.md): the quick actions «إجراءات سريعة» get a
-- visibility and a state. A row is seen by:
-- * «كل الفريق» (scope all) — every active member; written by the admin only
-- * «دور معين» (scope role) — the members of that role (main or extra); written by the admin or the role's manager (roles.manager_id,
--   or a member of that main role at the level «مدير» — 0092 / 0096)
-- * «أنا بس» (scope me) — its owner; written by the owner (any active member)
-- and «مفعّل / موقوف» (active) hides a row from the header menu without deleting it.
-- Reads and writes go through the functions below (security definer, the same rules); the table itself is select-only for the members
-- (RLS on the same visibility) and never written directly. The settings row «quick» (phase 11) is copied once as «كل الفريق» rows and is
-- no longer read by the page. activity_log settings.quick.* — the id, the scope and the action only (never a name or a link).

create table if not exists public.quick_actions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  link text not null,
  icon text not null default 'link',
  scope text not null,
  role_id text references public.roles(id) on delete cascade,
  owner uuid references public.profiles(id) on delete cascade, -- a personal row goes with its member (member_delete: cascade = set-up)
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quick_actions_name_check check (char_length(btrim(name)) between 1 and 60 and name !~ '[<>[:cntrl:]]'),
  constraint quick_actions_link_check check (char_length(link) between 2 and 300 and link ~ '^#[a-z]' and link !~ '[<>"''[:space:][:cntrl:]]'),
  constraint quick_actions_icon_check check (icon ~ '^[a-z0-9-]{1,24}$'),
  constraint quick_actions_scope_check check (scope in ('all', 'role', 'me')),
  constraint quick_actions_scope_keys_check check ((scope = 'role') = (role_id is not null) and (scope = 'me') = (owner is not null))
);
create index if not exists quick_actions_role_idx on public.quick_actions (role_id) where role_id is not null;
create index if not exists quick_actions_owner_idx on public.quick_actions (owner) where owner is not null;

-- the roles of the signed-in active member (main + extras)
create or replace function public.quick_my_roles() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce((select array[p.role_id] || coalesce(p.extra_roles, '{}'::text[]) from public.profiles p where p.id = auth.uid() and p.status = 'active'), '{}'::text[])
$$;
-- the signed-in member manages a role's quick actions: the admin, the role's manager, or a «مدير» of that main role
create or replace function public.quick_role_manager(p_role text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_role is not null and (public.is_admin() or exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active'
      and (exists (select 1 from public.roles r where r.id = p_role and r.manager_id = p.id) or (p.role_id = p_role and p.level = 'manager'))))
$$;
create or replace function public.quick_can_see(p_scope text, p_role text, p_owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active')
     and (p_scope = 'all' or (p_scope = 'me' and p_owner = auth.uid()) or (p_scope = 'role' and (p_role = any (public.quick_my_roles()) or public.quick_role_manager(p_role))))
$$;
create or replace function public.quick_can_edit(p_scope text, p_role text, p_owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active')
     and case p_scope when 'all' then public.is_admin() when 'role' then public.quick_role_manager(p_role) when 'me' then p_owner = auth.uid() else false end
$$;
revoke execute on function public.quick_my_roles(), public.quick_role_manager(text), public.quick_can_see(text, text, uuid), public.quick_can_edit(text, text, uuid) from public, anon;
grant execute on function public.quick_my_roles(), public.quick_role_manager(text), public.quick_can_see(text, text, uuid), public.quick_can_edit(text, text, uuid) to authenticated, service_role;

alter table public.quick_actions enable row level security;
drop policy if exists quick_actions_select on public.quick_actions;
create policy quick_actions_select on public.quick_actions for select to authenticated
  using ((select public.quick_can_see(scope, role_id, owner)));
revoke all on public.quick_actions from anon, authenticated;
grant select on public.quick_actions to authenticated;
grant all on public.quick_actions to service_role;

-- ---------------------------------------------------------------- the reads and the writes
create or replace function public.quick_actions_list() returns table (id uuid, name text, link text, icon text, scope text, role_id text, active boolean, sort int, can_edit boolean)
language sql stable security definer set search_path = public as $$
  select q.id, q.name, q.link, q.icon, q.scope, q.role_id, q.active, q.sort, public.quick_can_edit(q.scope, q.role_id, q.owner)
    from public.quick_actions q
   where public.quick_can_see(q.scope, q.role_id, q.owner)
   order by q.sort, q.created_at
$$;

-- p = { id?, name, link, icon?, scope, role?, active? } → the row id. An edit needs the right on the row as it is and as it becomes.
create or replace function public.quick_action_save(p jsonb) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  v_id uuid; v_old public.quick_actions%rowtype; v_scope text := p ->> 'scope'; v_role text := nullif(p ->> 'role', '');
  v_owner uuid; v_name text := btrim(coalesce(p ->> 'name', '')); v_link text := btrim(coalesce(p ->> 'link', ''));
  v_icon text := coalesce(nullif(p ->> 'icon', ''), 'link'); v_active boolean := coalesce((p ->> 'active')::boolean, true);
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and status = 'active') then raise exception 'not allowed' using errcode = '42501'; end if;
  if jsonb_typeof(p) <> 'object' then raise exception 'invalid: input' using errcode = '22023'; end if;
  if v_scope is null or v_scope not in ('all', 'role', 'me') then raise exception 'invalid: scope' using errcode = '22023'; end if;
  if char_length(v_name) not between 1 and 60 or v_name ~ '[<>[:cntrl:]]' then raise exception 'invalid: name' using errcode = '22023'; end if;
  if char_length(v_link) not between 2 and 300 or v_link !~ '^#[a-z]' or v_link ~ '[<>"''[:space:][:cntrl:]]' then raise exception 'invalid: link' using errcode = '22023'; end if;
  if v_icon !~ '^[a-z0-9-]{1,24}$' then raise exception 'invalid: icon' using errcode = '22023'; end if;
  if v_scope = 'role' then
    if v_role is null or not exists (select 1 from public.roles r where r.id = v_role and not r.hidden and r.id <> 'admin') then raise exception 'invalid: role' using errcode = '22023'; end if;
  else v_role := null; end if;
  v_owner := case when v_scope = 'me' then auth.uid() else null end;
  if not public.quick_can_edit(v_scope, v_role, v_owner) then raise exception 'not allowed' using errcode = '42501'; end if;
  if nullif(p ->> 'id', '') is not null then
    begin v_id := (p ->> 'id')::uuid; exception when others then raise exception 'invalid: id' using errcode = '22023'; end;
    select * into v_old from public.quick_actions where id = v_id for update;
    if not found or not public.quick_can_edit(v_old.scope, v_old.role_id, v_old.owner) then raise exception 'not found' using errcode = 'P0002'; end if;
    update public.quick_actions set name = v_name, link = v_link, icon = v_icon, scope = v_scope, role_id = v_role, owner = v_owner, active = v_active, updated_at = now() where id = v_id;
    perform public.log_activity('settings.quick.save', 'quick_action', v_id::text, to_jsonb(v_old.scope), jsonb_build_object('scope', v_scope, 'active', v_active));
  else
    insert into public.quick_actions (name, link, icon, scope, role_id, owner, active, sort)
      values (v_name, v_link, v_icon, v_scope, v_role, v_owner, v_active, coalesce((select max(sort) + 1 from public.quick_actions), 0))
      returning id into v_id;
    perform public.log_activity('settings.quick.add', 'quick_action', v_id::text, null, jsonb_build_object('scope', v_scope, 'active', v_active));
  end if;
  return v_id;
end $$;

create or replace function public.quick_action_delete(p_id uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
declare v_old public.quick_actions%rowtype;
begin
  select * into v_old from public.quick_actions where id = p_id for update;
  if not found or not public.quick_can_edit(v_old.scope, v_old.role_id, v_old.owner) then raise exception 'not found' using errcode = 'P0002'; end if;
  delete from public.quick_actions where id = p_id;
  perform public.log_activity('settings.quick.delete', 'quick_action', p_id::text, to_jsonb(v_old.scope), null);
end $$;

-- the order the member dragged: each row they may edit takes its place (the others keep theirs)
create or replace function public.quick_action_order(p_ids uuid[]) returns void
language plpgsql volatile security definer set search_path = public as $$
declare i int;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and status = 'active') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_ids is null or array_length(p_ids, 1) is null or array_length(p_ids, 1) > 200 then raise exception 'invalid: ids' using errcode = '22023'; end if;
  for i in 1 .. array_length(p_ids, 1) loop
    update public.quick_actions q set sort = i - 1, updated_at = now() where q.id = p_ids[i] and public.quick_can_edit(q.scope, q.role_id, q.owner);
  end loop;
  perform public.log_activity('settings.quick.reorder', 'quick_action', null, null, to_jsonb(array_length(p_ids, 1)));
end $$;

revoke execute on function public.quick_actions_list(), public.quick_action_save(jsonb), public.quick_action_delete(uuid), public.quick_action_order(uuid[]) from public, anon;
grant execute on function public.quick_actions_list(), public.quick_action_save(jsonb), public.quick_action_delete(uuid), public.quick_action_order(uuid[]) to authenticated, service_role;

-- ---------------------------------------------------------------- the old list (settings «quick», phase 11) → «كل الفريق» rows, once
insert into public.quick_actions (name, link, icon, scope, sort)
select left(btrim(x ->> 'name'), 60), x ->> 'link', coalesce(nullif(x ->> 'icon', ''), 'link'), 'all', (o - 1)::int
  from public.settings s cross join lateral jsonb_array_elements(case when jsonb_typeof(s.data -> 'list') = 'array' then s.data -> 'list' else '[]'::jsonb end) with ordinality as e(x, o)
 where s.section = 'quick' and not exists (select 1 from public.quick_actions)
   and char_length(btrim(coalesce(x ->> 'name', ''))) between 1 and 60 and coalesce(x ->> 'name', '') !~ '[<>[:cntrl:]]'
   and coalesce(x ->> 'link', '') ~ '^#[a-z]' and char_length(x ->> 'link') <= 300 and (x ->> 'link') !~ '[<>"''[:space:][:cntrl:]]'
   and coalesce(nullif(x ->> 'icon', ''), 'link') ~ '^[a-z0-9-]{1,24}$';
