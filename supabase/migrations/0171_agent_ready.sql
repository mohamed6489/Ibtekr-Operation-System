-- 0171 — «طلبات جاهزة» و«تقارير جاهزة» in an assistant's chat (Safwat 25 Nov — «القايمتين حطهم بدل تقديم طلب يبقا فيه طلبات جاهزة و
-- تقارير جاهزة»; docs/superpowers/plans/2026-11-25-agent-chat-flows.md, phase 3). The chat's «تقديم طلب» button becomes a menu: the
-- old «تقديم طلب» first, then the ready requests (the «طلب جديد» popup filled with the item's name and its elements) and the ready
-- reports (a table popup of the member's own rows, with «مشاركة»). The admin adds them («+ طلب جاهز» / «+ تقرير جاهز»): a name and
-- element › data type › state rows from the notifications' catalog (IBNotifCatalog) — no time, repeat, visibility, channels or level —
-- and the role that sees it (none = everyone who opens the assistant; his own answer, 25 Nov: «الأدمن بس»).
-- A row is seen by a member who sees the assistant (ai_agent_can) and holds its role (main or extra — quick_my_roles, 0098), the admin
-- all. Reads and writes go through the functions below (security definer); the table is select-only for the members. Nothing runs by
-- itself: a ready request opens the popup and the member presses «ابعت»; a ready report reads his own pages under his own rights.
-- activity_log ai.ready.* — the id, the assistant and the kind only (never a name).

create table if not exists public.ai_agent_ready (
  id uuid primary key default gen_random_uuid(),
  agent text not null references public.ai_agents(id) on delete cascade,
  kind text not null,
  name text not null,
  role_id text references public.roles(id) on delete cascade,
  parts jsonb not null,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_agent_ready_kind_check check (kind in ('request', 'report')),
  constraint ai_agent_ready_name_check check (char_length(btrim(name)) between 1 and 60 and name !~ '[<>[:cntrl:]]'),
  constraint ai_agent_ready_parts_check check (jsonb_typeof(parts) = 'array' and jsonb_array_length(parts) between 1 and 6)
);
create index if not exists ai_agent_ready_agent_idx on public.ai_agent_ready (agent, sort);

-- who sees a row: the admin all; a member who sees the assistant and holds the row's role (or the row has none)
create or replace function public.ai_agent_ready_can(p_agent text, p_role text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or (public.ai_agent_can(p_agent) and (p_role is null or p_role = any (public.quick_my_roles())))
$$;
revoke execute on function public.ai_agent_ready_can(text, text) from public, anon;
grant execute on function public.ai_agent_ready_can(text, text) to authenticated, service_role;

alter table public.ai_agent_ready enable row level security;
drop policy if exists ai_agent_ready_select on public.ai_agent_ready;
create policy ai_agent_ready_select on public.ai_agent_ready for select to authenticated
  using ((select public.ai_agent_ready_can(agent, role_id)));
revoke all on public.ai_agent_ready from anon, authenticated;
grant select on public.ai_agent_ready to authenticated;
grant all on public.ai_agent_ready to service_role;

-- the rows of one assistant the member sees, in order
create or replace function public.ai_agent_ready_list(p_agent text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'agent', r.agent, 'kind', r.kind, 'name', r.name, 'role', r.role_id, 'parts', r.parts, 'sort', r.sort)
    order by r.sort, r.created_at), '[]'::jsonb)
  from public.ai_agent_ready r
  where r.agent = p_agent and public.ai_agent_ready_can(r.agent, r.role_id)
$$;

-- p = { id?, agent, kind, name, role?, parts: [{ element, type, state }] } → the row id. The admin only.
create or replace function public.ai_agent_ready_save(p jsonb) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  v_id uuid; v_agent text := p ->> 'agent'; v_kind text := p ->> 'kind'; v_name text := btrim(coalesce(p ->> 'name', ''));
  v_role text := nullif(p ->> 'role', ''); v_parts jsonb := p -> 'parts'; v_clean jsonb := '[]'::jsonb; x jsonb; k text;
begin
  if not public.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if jsonb_typeof(p) <> 'object' then raise exception 'invalid: input' using errcode = '22023'; end if;
  if v_agent is null or not exists (select 1 from public.ai_agents a where a.id = v_agent) then raise exception 'invalid: agent' using errcode = '22023'; end if;
  if v_kind is null or v_kind not in ('request', 'report') then raise exception 'invalid: kind' using errcode = '22023'; end if;
  if char_length(v_name) not between 1 and 60 or v_name ~ '[<>[:cntrl:]]' then raise exception 'invalid: name' using errcode = '22023'; end if;
  if v_role is not null and not exists (select 1 from public.roles r where r.id = v_role and not r.hidden) then raise exception 'invalid: role' using errcode = '22023'; end if;
  if jsonb_typeof(v_parts) is distinct from 'array' or jsonb_array_length(v_parts) not between 1 and 6 then raise exception 'invalid: parts' using errcode = '22023'; end if;
  for x in select e from jsonb_array_elements(v_parts) e loop
    if jsonb_typeof(x) <> 'object' then raise exception 'invalid: parts' using errcode = '22023'; end if;
    foreach k in array array['element', 'type', 'state'] loop
      if jsonb_typeof(x -> k) is distinct from 'string' or char_length(btrim(x ->> k)) not between 1 and 60 or (x ->> k) ~ '[<>[:cntrl:]]' then
        raise exception 'invalid: parts' using errcode = '22023'; end if;
    end loop;
    v_clean := v_clean || jsonb_build_array(jsonb_build_object('element', btrim(x ->> 'element'), 'type', btrim(x ->> 'type'), 'state', btrim(x ->> 'state')));
  end loop;
  if nullif(p ->> 'id', '') is not null then
    begin v_id := (p ->> 'id')::uuid; exception when others then raise exception 'invalid: id' using errcode = '22023'; end;
    update public.ai_agent_ready set kind = v_kind, name = v_name, role_id = v_role, parts = v_clean, updated_at = now() where id = v_id and agent = v_agent;
    if not found then raise exception 'not found' using errcode = 'P0002'; end if;
    perform public.log_activity('ai.ready.save', 'ai_agent_ready', v_id::text, null, jsonb_build_object('agent', v_agent, 'kind', v_kind));
  else
    insert into public.ai_agent_ready (agent, kind, name, role_id, parts, sort)
      values (v_agent, v_kind, v_name, v_role, v_clean, coalesce((select max(sort) + 1 from public.ai_agent_ready where agent = v_agent), 0))
      returning id into v_id;
    perform public.log_activity('ai.ready.add', 'ai_agent_ready', v_id::text, null, jsonb_build_object('agent', v_agent, 'kind', v_kind));
  end if;
  return v_id;
end $$;

create or replace function public.ai_agent_ready_delete(p_id uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
declare v_old public.ai_agent_ready%rowtype;
begin
  if not public.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_old from public.ai_agent_ready where id = p_id for update;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  delete from public.ai_agent_ready where id = p_id;
  perform public.log_activity('ai.ready.delete', 'ai_agent_ready', p_id::text, jsonb_build_object('agent', v_old.agent, 'kind', v_old.kind), null);
end $$;

revoke execute on function public.ai_agent_ready_list(text), public.ai_agent_ready_save(jsonb), public.ai_agent_ready_delete(uuid) from public, anon;
grant execute on function public.ai_agent_ready_list(text), public.ai_agent_ready_save(jsonb), public.ai_agent_ready_delete(uuid) to authenticated, service_role;
