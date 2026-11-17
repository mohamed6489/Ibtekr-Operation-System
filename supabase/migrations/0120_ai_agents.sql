-- 0120 — «الذكاء الاصطناعي»: every assistant in one registry (docs/superpowers/plans/2026-11-17-ai-page.md — the owner 17 Nov: «انقل مساعدين
-- الذكاء الاصطناعي من جوه التسويق… قسم رئيسي… ضيف المخزن الذكي و خدمة العملاء الذكية و خدمة المبتكرين الذكية… المحاسب الذكي و الموارد
-- البشرية الذكية… وانا بضيف القاعدة اقدر اختار المساعد… امكانية لاضافة مساعدين جدد»).
-- * ai_agents: the assistants — the eight the system ships (builtin) and the admin's own; who sees one = the page permission it carries
--   (ai_agent_can); read with ai_agents_list(), written by the admin through ai_agent_save / ai_agent_archive / ai_agent_order. The three
--   old ones take their intro / instructions / suggestions from settings.marketing.agents once.
-- * ai_agent_kb: the rules and skills in one list, each with the assistants it is for (empty = all of them); the admin replaces a kind
--   with ai_agent_kb_set and reads it with ai_agent_kb_list; the server reads it for the prompts. 0118's per-assistant sections move over
--   once. mkt_agent_settings* / mkt_agent_kb_set (0084 / 0118) stay as they were for an old page — nothing new reads them.
-- * mkt_agent_chats.agent = any assistant of the registry (FK), and the chats / turns / delete follow ai_agent_can instead of marketing.view.
-- * the team requests from an assistant: tickets.kind takes an assistant's id too (the old design / dev / media stay); its default role
--   is the assistant's (ai_agents.role) — ticket_kind_role.
-- Re-runnable.

create table if not exists public.ai_agents (
  id text primary key check (id ~ '^[a-z][a-z0-9_]{1,30}$'),
  name text not null check (char_length(name) between 2 and 40 and name !~ '[<>]'),
  icon text not null default 'sparkle' check (icon ~ '^[A-Za-z]{2,20}$'),
  perm text not null check (perm in ('marketing.view', 'inventory.view', 'cs.view', 'vendors.view', 'accounts.view', 'hr.view', 'orders.view', 'products.view', 'tickets.view', 'reports.view')),
  sees text[] not null default '{}' check (sees <@ array['orders', 'vendors', 'customers', 'tickets', 'tasks', 'expenses', 'sales', 'inventory', 'hr']::text[]),
  role text check (role is null or (char_length(role) between 2 and 60 and role !~ '[<>]')),
  about text not null default '' check (char_length(about) <= 300 and about !~ '[<>]'),
  intro text not null default '' check (char_length(intro) <= 600 and intro !~ '[<>]'),
  instructions text not null default '' check (char_length(instructions) <= 4000 and instructions !~ '[<>]'),
  suggestions jsonb not null default '[]'::jsonb check (jsonb_typeof(suggestions) = 'array' and jsonb_array_length(suggestions) <= 8),
  builtin boolean not null default false,
  sort int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
alter table public.ai_agents enable row level security;
revoke all on public.ai_agents from anon, authenticated;
grant all on public.ai_agents to service_role;

-- the eight the system ships (the owner's names); a re-run keeps what the admin changed
insert into public.ai_agents (id, name, icon, perm, sees, role, about, builtin, sort) values
  ('buyer', 'الميديا باير الذكي', 'chart', 'marketing.view', '{}', 'ميديا باير', 'بيقرا أرقام الإعلانات جنب أوردرات الموقع وبيقترح — وبيفتح ويقفل حملات ميتا بتأكيدك', true, 10),
  ('designer', 'الديزاينر الذكي', 'image', 'marketing.view', '{}', 'ديزاينر', 'أفكار وتصميمات بالبراند وكامبينات متملّية — وبيولّد صورة لما تطلب', true, 20),
  ('dev', 'المبرمج الذكي', 'code', 'marketing.view', '{}', 'مبرمج', 'أداء الموقع والتحديثات ومشاكل السيستم وطلبات التطوير', true, 30),
  ('stock', 'المخزن الذكي', 'tag', 'inventory.view', '{inventory,orders}', 'اللوجستيك والشحن', 'القطع اللي في المخزن والتجميع والمرتجعات والأوردرات اللي مستنية', true, 40),
  ('cs', 'خدمة العملاء الذكية', 'headset', 'cs.view', '{customers,orders,tickets}', 'خدمة العملاء', 'العملاء والأوردرات والطلبات المفتوحة — وبيكتبلك الردود', true, 50),
  ('makers', 'خدمة المبتكرين الذكية', 'users', 'vendors.view', '{vendors,orders,tickets}', 'متابعة المبتكرين', 'المبتكرين وأوردراتهم والمتأخر والطلبات المفتوحة', true, 60),
  ('accountant', 'المحاسب الذكي', 'wallet', 'accounts.view', '{expenses,sales}', 'الحسابات', 'المصروفات والمبيعات وحصة إبتكر — بأرقامك الحقيقية', true, 70),
  ('hr', 'الموارد البشرية الذكية', 'briefcase', 'hr.view', '{hr,tasks}', 'مدير النظام', 'الحضور والطلبات والمهام — من غير المرتبات', true, 80)
on conflict (id) do nothing;

-- the three old ones keep their admin's intro / instructions / suggestions (0084 — settings.marketing.agents), once
update public.ai_agents a set
  intro = left(coalesce(nullif(btrim(s.data -> 'agents' -> a.id ->> 'intro'), ''), a.intro), 600),
  instructions = left(coalesce(nullif(btrim(s.data -> 'agents' -> a.id ->> 'instructions'), ''), a.instructions), 4000),
  suggestions = case when jsonb_typeof(s.data -> 'agents' -> a.id -> 'suggestions') = 'array' and jsonb_array_length(s.data -> 'agents' -> a.id -> 'suggestions') <= 8
    then s.data -> 'agents' -> a.id -> 'suggestions' else a.suggestions end
from public.settings s
where s.section = 'marketing' and a.id in ('buyer', 'designer', 'dev') and a.intro = '' and a.instructions = '' and a.suggestions = '[]'::jsonb
  and jsonb_typeof(s.data -> 'agents' -> a.id) = 'object';

-- who sees an assistant: the admin, or a member whose permission of its page is not N (an archived one: nobody)
create or replace function public.ai_agent_can(p_agent text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.ai_agents a where a.id = p_agent and a.archived_at is null and (public.is_admin() or public.has_perm(a.perm) <> 'N'))
$$;
revoke execute on function public.ai_agent_can(text) from public, anon;
grant execute on function public.ai_agent_can(text) to authenticated, service_role;

-- the assistants the member sees, in order (the admin: the archived too, marked)
create or replace function public.ai_agents_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'icon', a.icon, 'perm', a.perm, 'sees', to_jsonb(a.sees), 'role', a.role, 'about', a.about,
    'intro', a.intro, 'instructions', case when public.is_admin() then a.instructions else '' end, 'suggestions', a.suggestions, 'builtin', a.builtin, 'sort', a.sort,
    'archived', a.archived_at is not null) order by a.sort, a.created_at), '[]'::jsonb)
  from public.ai_agents a
  where (a.archived_at is null and (public.is_admin() or public.has_perm(a.perm) <> 'N')) or (a.archived_at is not null and public.is_admin())
$$;
revoke execute on function public.ai_agents_list() from public, anon;
grant execute on function public.ai_agents_list() to authenticated, service_role;

-- p: { id? (null = a new one), name, icon, perm, sees, role, about, intro, instructions, suggestions } — the admin; a builtin keeps its id,
-- its permission and what it reads (the server's code reads for it); a new one gets an id «c_…». Returns the id.
create or replace function public.ai_agent_save(p jsonb) returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  v_id text; v_cur public.ai_agents; v_new boolean; v_name text; v_icon text; v_perm text; v_sees text[]; v_role text; v_about text; v_intro text; v_instr text;
  v_s jsonb := '[]'::jsonb; x jsonb; t text;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'invalid: body' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_object_keys(p) k where k not in ('id', 'name', 'icon', 'perm', 'sees', 'role', 'about', 'intro', 'instructions', 'suggestions')) then raise exception 'invalid: key' using errcode = '22023'; end if;
  v_id := nullif(btrim(coalesce(p ->> 'id', '')), '');
  v_new := v_id is null;
  if not v_new then
    select * into v_cur from public.ai_agents where id = v_id;
    if not found then raise exception 'agent not found' using errcode = 'P0002'; end if;
  end if;
  v_name := btrim(coalesce(p ->> 'name', v_cur.name, ''));
  if char_length(v_name) < 2 or char_length(v_name) > 40 or v_name ~ '[<>]' then raise exception 'invalid: name' using errcode = '22023'; end if;
  v_icon := coalesce(nullif(btrim(coalesce(p ->> 'icon', '')), ''), v_cur.icon, 'sparkle');
  if v_icon !~ '^[A-Za-z]{2,20}$' then raise exception 'invalid: icon' using errcode = '22023'; end if;
  if not v_new and v_cur.builtin then v_perm := v_cur.perm; v_sees := v_cur.sees;
  else
    v_perm := coalesce(nullif(p ->> 'perm', ''), v_cur.perm);
    if v_perm is null or v_perm not in ('marketing.view', 'inventory.view', 'cs.view', 'vendors.view', 'accounts.view', 'hr.view', 'orders.view', 'products.view', 'tickets.view', 'reports.view') then raise exception 'invalid: perm' using errcode = '22023'; end if;
    if p ? 'sees' then
      if jsonb_typeof(p -> 'sees') <> 'array' then raise exception 'invalid: sees' using errcode = '22023'; end if;
      select coalesce(array_agg(distinct v), '{}') into v_sees from jsonb_array_elements_text(p -> 'sees') v;
      if not (v_sees <@ array['orders', 'vendors', 'customers', 'tickets', 'tasks', 'expenses', 'sales', 'inventory', 'hr']::text[]) then raise exception 'invalid: sees' using errcode = '22023'; end if;
    else v_sees := coalesce(v_cur.sees, '{}'); end if;
  end if;
  v_role := case when p ? 'role' then nullif(btrim(coalesce(p ->> 'role', '')), '') else v_cur.role end;
  if v_role is not null and (char_length(v_role) < 2 or char_length(v_role) > 60 or v_role ~ '[<>]') then raise exception 'invalid: role' using errcode = '22023'; end if;
  v_about := btrim(coalesce(p ->> 'about', v_cur.about, ''));
  if char_length(v_about) > 300 or v_about ~ '[<>]' then raise exception 'invalid: about' using errcode = '22023'; end if;
  v_intro := btrim(coalesce(p ->> 'intro', v_cur.intro, ''));
  if char_length(v_intro) > 600 or v_intro ~ '[<>]' then raise exception 'invalid: intro' using errcode = '22023'; end if;
  v_instr := btrim(coalesce(p ->> 'instructions', v_cur.instructions, ''));
  if char_length(v_instr) > 4000 or v_instr ~ '[<>]' then raise exception 'invalid: instructions' using errcode = '22023'; end if;
  if p ? 'suggestions' then
    if jsonb_typeof(p -> 'suggestions') <> 'array' or jsonb_array_length(p -> 'suggestions') > 8 then raise exception 'invalid: suggestions' using errcode = '22023'; end if;
    for x in select * from jsonb_array_elements(p -> 'suggestions') loop
      t := btrim(coalesce(x #>> '{}', ''));
      if jsonb_typeof(x) <> 'string' or t = '' or char_length(t) > 80 or t ~ '[<>]' then raise exception 'invalid: suggestions' using errcode = '22023'; end if;
      v_s := v_s || to_jsonb(t);
    end loop;
  else v_s := coalesce(v_cur.suggestions, '[]'::jsonb); end if;
  if v_new then
    if (select count(*) from public.ai_agents where not builtin and archived_at is null) >= 30 then raise exception 'invalid: count' using errcode = '22023'; end if;
    v_id := 'c_' || substr(md5(random()::text || clock_timestamp()::text), 1, 10);
    insert into public.ai_agents (id, name, icon, perm, sees, role, about, intro, instructions, suggestions, builtin, sort)
      values (v_id, v_name, v_icon, v_perm, v_sees, v_role, v_about, v_intro, v_instr, v_s, false, coalesce((select max(sort) from public.ai_agents), 0) + 10);
  else
    update public.ai_agents set name = v_name, icon = v_icon, perm = v_perm, sees = v_sees, role = v_role, about = v_about, intro = v_intro,
      instructions = v_instr, suggestions = v_s, updated_at = now() where id = v_id;
  end if;
  insert into public.activity_log (actor, action, entity, entity_id, new_value)
    values (auth.uid(), case when v_new then 'ai.agent.add' else 'ai.agent.save' end, 'ai_agents', v_id, jsonb_build_object('keys', (select jsonb_agg(k order by k) from jsonb_object_keys(p) k where k <> 'id')));
  return v_id;
end
$$;
revoke execute on function public.ai_agent_save(jsonb) from public, anon;
grant execute on function public.ai_agent_save(jsonb) to authenticated, service_role;

-- an assistant of the admin's goes to the archive (its chats stay its member's history, closed); a builtin never; p_on false brings it back
create or replace function public.ai_agent_archive(p_id text, p_on boolean default true) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if exists (select 1 from public.ai_agents where id = p_id and builtin) then raise exception 'invalid: builtin' using errcode = '22023'; end if;
  update public.ai_agents set archived_at = case when coalesce(p_on, true) then coalesce(archived_at, now()) else null end, updated_at = now() where id = p_id;
  if not found then raise exception 'agent not found' using errcode = 'P0002'; end if;
  insert into public.activity_log (actor, action, entity, entity_id, new_value)
    values (auth.uid(), case when coalesce(p_on, true) then 'ai.agent.archive' else 'ai.agent.restore' end, 'ai_agents', p_id, null);
end
$$;
revoke execute on function public.ai_agent_archive(text, boolean) from public, anon;
grant execute on function public.ai_agent_archive(text, boolean) to authenticated, service_role;

-- the tabs' order: the ids in their new order (any id not sent keeps its place after them)
create or replace function public.ai_agent_order(p_ids text[]) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_ids is null or cardinality(p_ids) = 0 or cardinality(p_ids) > 100 then raise exception 'invalid: ids' using errcode = '22023'; end if;
  -- the sent ones first in their order, then the rest as they were — renumbered 10, 20, …
  update public.ai_agents a set sort = r.n * 10, updated_at = now()
  from (select a2.id, row_number() over (order by coalesce(x.o, 100000 + a2.sort), a2.created_at) as n
        from public.ai_agents a2 left join unnest(p_ids) with ordinality as x(id, o) on x.id = a2.id) r
  where a.id = r.id;
  insert into public.activity_log (actor, action, entity, entity_id, new_value) values (auth.uid(), 'ai.agent.order', 'ai_agents', null, jsonb_build_object('n', cardinality(p_ids)));
end
$$;
revoke execute on function public.ai_agent_order(text[]) from public, anon;
grant execute on function public.ai_agent_order(text[]) to authenticated, service_role;

-- ---------------------------------------------------------------- the rules and skills, one list with the assistants each is for

create table if not exists public.ai_agent_kb (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('rules', 'skills')),
  section text not null check (char_length(section) between 1 and 60 and section !~ '[<>]'),
  title text not null check (char_length(title) between 1 and 80 and title !~ '[<>]'),
  body text not null default '' check (char_length(body) <= 1500 and body !~ '[<>]'),
  agents text[] not null default '{}',
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists ai_agent_kb_kind_idx on public.ai_agent_kb (kind, sort);
alter table public.ai_agent_kb enable row level security;
revoke all on public.ai_agent_kb from anon, authenticated;
grant all on public.ai_agent_kb to service_role;

-- 0118's sections move over once (each item for its one assistant)
insert into public.ai_agent_kb (kind, section, title, body, agents, sort)
select k.kind, left(g ->> 'name', 60), left(it ->> 'title', 80), left(coalesce(it ->> 'text', ''), 1500), array[a.id], (gi * 100 + ii)::int
from public.settings s
cross join (values ('buyer'), ('designer'), ('dev')) as a(id)
cross join (values ('rules'), ('skills')) as k(kind)
cross join lateral jsonb_array_elements(case when jsonb_typeof(s.data -> 'agents' -> a.id -> k.kind) = 'array' then s.data -> 'agents' -> a.id -> k.kind else '[]'::jsonb end) with ordinality as gg(g, gi)
cross join lateral jsonb_array_elements(case when jsonb_typeof(g -> 'items') = 'array' then g -> 'items' else '[]'::jsonb end) with ordinality as ii_(it, ii)
where s.section = 'marketing' and not exists (select 1 from public.ai_agent_kb)
  and coalesce(btrim(g ->> 'name'), '') <> '' and coalesce(btrim(it ->> 'title'), '') <> '';

-- the admin's list of a kind: [{ id, section, title, text, agents }] in order
create or replace function public.ai_agent_kb_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.is_admin() then coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'kind', k.kind, 'section', k.section, 'title', k.title, 'text', k.body, 'agents', to_jsonb(k.agents)) order by k.kind, k.sort, k.id) from public.ai_agent_kb k), '[]'::jsonb)
    else '[]'::jsonb end
$$;
revoke execute on function public.ai_agent_kb_list() from public, anon;
grant execute on function public.ai_agent_kb_list() to authenticated, service_role;

-- p_items: [{ section, title, text, agents: [id…] (empty = all) }] — the kind's whole list in its order; at most 200 items, 40000 characters
create or replace function public.ai_agent_kb_set(p_kind text, p_items jsonb) returns int
language plpgsql volatile security definer set search_path = public as $$
declare
  it jsonb; v_sec text; v_title text; v_text text; v_agents text[]; v_total int := 0; i int := 0;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_kind is null or p_kind not in ('rules', 'skills') then raise exception 'invalid: kind' using errcode = '22023'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 200 then raise exception 'invalid: items' using errcode = '22023'; end if;
  delete from public.ai_agent_kb where kind = p_kind;
  for it in select * from jsonb_array_elements(p_items) loop
    i := i + 1;
    if jsonb_typeof(it) <> 'object' then raise exception 'invalid: items' using errcode = '22023'; end if;
    v_sec := btrim(coalesce(it ->> 'section', '')); v_title := btrim(coalesce(it ->> 'title', ''));
    v_text := btrim(regexp_replace(coalesce(it ->> 'text', ''), E'\r\n?', E'\n', 'g'));
    if v_sec = '' or char_length(v_sec) > 60 or v_sec ~ '[<>]' then raise exception 'invalid: section' using errcode = '22023'; end if;
    if v_title = '' or char_length(v_title) > 80 or v_title ~ '[<>]' then raise exception 'invalid: title' using errcode = '22023'; end if;
    if char_length(v_text) > 1500 or v_text ~ '[<>]' then raise exception 'invalid: text' using errcode = '22023'; end if;
    if it ? 'agents' and jsonb_typeof(it -> 'agents') <> 'array' then raise exception 'invalid: agents' using errcode = '22023'; end if;
    select coalesce(array_agg(distinct v), '{}') into v_agents from jsonb_array_elements_text(coalesce(it -> 'agents', '[]'::jsonb)) v;
    if exists (select 1 from unnest(v_agents) v where not exists (select 1 from public.ai_agents a where a.id = v)) then raise exception 'invalid: agents' using errcode = '22023'; end if;
    v_total := v_total + char_length(v_sec) + char_length(v_title) + char_length(v_text);
    insert into public.ai_agent_kb (kind, section, title, body, agents, sort) values (p_kind, v_sec, v_title, v_text, v_agents, i);
  end loop;
  if v_total > 40000 then raise exception 'invalid: size' using errcode = '22023'; end if;
  insert into public.activity_log (actor, action, entity, entity_id, new_value) values (auth.uid(), 'ai.agent.kb', 'ai_agent_kb', p_kind, jsonb_build_object('items', i));
  return i;
end
$$;
revoke execute on function public.ai_agent_kb_set(text, jsonb) from public, anon;
grant execute on function public.ai_agent_kb_set(text, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------- the chats follow the registry

alter table public.mkt_agent_chats drop constraint if exists mkt_agent_chats_agent_check;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'mkt_agent_chats_agent_fkey') then
    alter table public.mkt_agent_chats add constraint mkt_agent_chats_agent_fkey foreign key (agent) references public.ai_agents(id);
  end if;
end $$;

drop policy if exists mkt_agent_chats_select on public.mkt_agent_chats;
create policy mkt_agent_chats_select on public.mkt_agent_chats for select to authenticated
  using (member_id = (select auth.uid()) and deleted_at is null and public.ai_agent_can(agent));
drop policy if exists mkt_agent_chats_update on public.mkt_agent_chats;
create policy mkt_agent_chats_update on public.mkt_agent_chats for update to authenticated
  using (member_id = (select auth.uid()) and deleted_at is null and public.ai_agent_can(agent))
  with check (member_id = (select auth.uid()));
drop policy if exists mkt_agent_messages_select on public.mkt_agent_messages;
create policy mkt_agent_messages_select on public.mkt_agent_messages for select to authenticated
  using (exists (select 1 from public.mkt_agent_chats c where c.id = chat_id and c.member_id = (select auth.uid()) and c.deleted_at is null and public.ai_agent_can(c.agent)));

create or replace function public.mkt_agent_chat_delete(p_id uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  update public.mkt_agent_chats set deleted_at = now() where id = p_id and member_id = auth.uid() and deleted_at is null and public.ai_agent_can(agent);
  if not found then raise exception 'chat not found' using errcode = 'P0002'; end if;
end
$$;
revoke execute on function public.mkt_agent_chat_delete(uuid) from public, anon;
grant execute on function public.mkt_agent_chat_delete(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- a request from any assistant

alter table public.tickets drop constraint if exists tickets_kind_check;
alter table public.tickets add constraint tickets_kind_check check (kind is null or kind ~ '^[a-z][a-z0-9_]{1,30}$');

create or replace function public.ticket_kind_role(p_kind text) returns text
language sql stable security definer set search_path = public as $$
  select case when p_kind in ('design', 'dev', 'media')
    then coalesce((public.ticket_role_labels(case p_kind when 'design' then 'designer' when 'dev' then 'developer' when 'media' then 'media_buyer' end))[1], 'مدير النظام')
    else coalesce((select a.role from public.ai_agents a where a.id = p_kind and a.archived_at is null), 'مدير النظام') end
$$;
revoke execute on function public.ticket_kind_role(text) from public, anon;
grant execute on function public.ticket_kind_role(text) to authenticated, service_role;

create or replace function public.ticket_request_create(p_kind text, p_project text, p_input jsonb) returns bigint
language plpgsql volatile security definer set search_path = public as $$
declare
  v_id bigint; v_in jsonb;
begin
  if p_kind is null or not (p_kind in ('design', 'dev', 'media') or (p_kind not in ('buyer', 'designer') and public.ai_agent_can(p_kind))) then raise exception 'invalid: kind' using errcode = '22023'; end if;
  if jsonb_typeof(p_input) <> 'object' then raise exception 'invalid: input' using errcode = '22023'; end if;
  v_in := p_input || jsonb_build_object('type', 'internal')
          || case when coalesce(p_input ->> 'assigneeRole', '') = '' then jsonb_build_object('assigneeRole', public.ticket_kind_role(p_kind)) else '{}'::jsonb end;
  v_id := public.ticket_create(v_in); -- tickets.manage F, the role, the title, the files… (42501 / 22023 as there)
  update public.tickets set kind = p_kind, project = nullif(public.ticket_clean(p_project, 60), '') where id = v_id;
  return v_id;
end
$$;
revoke execute on function public.ticket_request_create(text, text, jsonb) from public, anon;
grant execute on function public.ticket_request_create(text, text, jsonb) to authenticated, service_role;
