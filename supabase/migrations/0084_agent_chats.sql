-- 0084_agent_chats (the owner, 12 Nov — «سايد بار فيه history chats… وأقدر أمسح الشات وأعدّل الاسم، حاجة شبه الـ interface بتاعة
-- Claude… وكل agent عنده زرار الإعدادات… بكل التعليمات والقواعد»; «كل عضو شاتاته بس»). Plan: docs/superpowers/plans/
-- 2026-11-12-marketing-agents.md (decision 5).
-- * mkt_agent_chats: a member's chats with one assistant (buyer | designer | dev) — the member reads their own only (marketing.view ≠ N),
--   renames them and deletes them (deleted_at, final); the server makes them (ai-content `agent`, on the first message)
-- * mkt_agent_messages: the turns — written by the server only (the question and the answer after the model's reply), so the history
--   the model reads is the server's; the member reads the turns of their own chats
-- * the assistants' settings in settings.marketing.agents.<agent> — mkt_agent_settings() for marketing.view, mkt_agent_settings_set()
--   for the admin (the intro, the instructions, the quick suggestions; checked here)

create table if not exists public.mkt_agent_chats (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete cascade,
  agent text not null check (agent in ('buyer', 'designer', 'dev')),
  title text not null default 'شات جديد' check (char_length(title) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists mkt_agent_chats_member_idx on public.mkt_agent_chats (member_id, agent, updated_at desc) where deleted_at is null;

create table if not exists public.mkt_agent_messages (
  id bigint generated always as identity primary key,
  chat_id uuid not null references public.mkt_agent_chats(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  text text not null default '' check (char_length(text) <= 8000),
  images jsonb not null default '[]'::jsonb check (jsonb_typeof(images) = 'array'),
  run_id bigint,
  created_at timestamptz not null default now()
);
create index if not exists mkt_agent_messages_chat_idx on public.mkt_agent_messages (chat_id, id);

alter table public.mkt_agent_chats enable row level security;
alter table public.mkt_agent_messages enable row level security;

drop policy if exists mkt_agent_chats_select on public.mkt_agent_chats;
create policy mkt_agent_chats_select on public.mkt_agent_chats for select to authenticated
  using (member_id = (select auth.uid()) and deleted_at is null and public.has_perm('marketing.view') <> 'N');
drop policy if exists mkt_agent_chats_update on public.mkt_agent_chats;
create policy mkt_agent_chats_update on public.mkt_agent_chats for update to authenticated
  using (member_id = (select auth.uid()) and deleted_at is null and public.has_perm('marketing.view') <> 'N')
  with check (member_id = (select auth.uid()));
drop policy if exists mkt_agent_messages_select on public.mkt_agent_messages;
create policy mkt_agent_messages_select on public.mkt_agent_messages for select to authenticated
  using (public.has_perm('marketing.view') <> 'N' and exists (select 1 from public.mkt_agent_chats c where c.id = chat_id and c.member_id = (select auth.uid()) and c.deleted_at is null));

revoke all on public.mkt_agent_chats, public.mkt_agent_messages from anon, authenticated;
grant select on public.mkt_agent_chats to authenticated;
grant update (title) on public.mkt_agent_chats to authenticated;
grant select on public.mkt_agent_messages to authenticated;
grant all on public.mkt_agent_chats, public.mkt_agent_messages to service_role;

-- a member renames their own chat (the title only); the rest is the server's (the owner, the assistant, the dates); a deleted chat is final
create or replace function public.mkt_agent_chats_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then new.updated_at := coalesce(new.updated_at, now()); return new; end if;
  if old.deleted_at is not null then raise exception 'a deleted chat is final' using errcode = '42501'; end if;
  new.member_id := old.member_id; new.agent := old.agent; new.created_at := old.created_at;
  new.title := left(btrim(regexp_replace(coalesce(new.title, ''), '[[:cntrl:]]', ' ', 'g')), 80);
  if new.title = '' then raise exception 'invalid: title' using errcode = '22023'; end if;
  new.deleted_at := old.deleted_at;
  new.updated_at := old.updated_at; -- a rename keeps the chat's place in the list
  return new;
end
$$;
drop trigger if exists mkt_agent_chats_guard on public.mkt_agent_chats;
create trigger mkt_agent_chats_guard before update on public.mkt_agent_chats for each row execute function public.mkt_agent_chats_guard();
revoke execute on function public.mkt_agent_chats_guard() from public, anon, authenticated;

-- the member deletes their own chat (final: gone from the list and from the model's history); someone else's = P0002
create or replace function public.mkt_agent_chat_delete(p_id uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if public.has_perm('marketing.view') = 'N' then raise exception 'marketing.view required' using errcode = '42501'; end if;
  update public.mkt_agent_chats set deleted_at = now() where id = p_id and member_id = auth.uid() and deleted_at is null;
  if not found then raise exception 'chat not found' using errcode = 'P0002'; end if;
end
$$;
revoke execute on function public.mkt_agent_chat_delete(uuid) from public, anon;
grant execute on function public.mkt_agent_chat_delete(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- the assistants' settings (settings.marketing.agents)

create or replace function public.mkt_agent_settings() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.has_perm('marketing.view') <> 'N' or public.is_admin()
    then coalesce((select data -> 'agents' from public.settings where section = 'marketing'), '{}'::jsonb) else '{}'::jsonb end
$$;
revoke execute on function public.mkt_agent_settings() from public, anon;
grant execute on function public.mkt_agent_settings() to authenticated, service_role;

-- p_cfg: { intro?, instructions?, suggestions? } — the keys sent replace the stored ones; text without < >; the admin only
create or replace function public.mkt_agent_settings_set(p_agent text, p_cfg jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_cur jsonb; v_new jsonb; v_s jsonb := '[]'::jsonb; x jsonb; t text;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_agent is null or p_agent not in ('buyer', 'designer', 'dev') then raise exception 'invalid: agent' using errcode = '22023'; end if;
  if p_cfg is null or jsonb_typeof(p_cfg) <> 'object' then raise exception 'invalid: cfg' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_object_keys(p_cfg) k where k not in ('intro', 'instructions', 'suggestions')) then raise exception 'invalid: key' using errcode = '22023'; end if;
  v_cur := coalesce((select data -> 'agents' -> p_agent from public.settings where section = 'marketing'), '{}'::jsonb);
  v_new := v_cur;
  if p_cfg ? 'intro' then
    t := btrim(coalesce(p_cfg ->> 'intro', ''));
    if char_length(t) > 600 or t ~ '[<>]' then raise exception 'invalid: intro' using errcode = '22023'; end if;
    v_new := v_new || jsonb_build_object('intro', t);
  end if;
  if p_cfg ? 'instructions' then
    t := btrim(coalesce(p_cfg ->> 'instructions', ''));
    if char_length(t) > 4000 or t ~ '[<>]' then raise exception 'invalid: instructions' using errcode = '22023'; end if;
    v_new := v_new || jsonb_build_object('instructions', t);
  end if;
  if p_cfg ? 'suggestions' then
    if jsonb_typeof(p_cfg -> 'suggestions') <> 'array' or jsonb_array_length(p_cfg -> 'suggestions') > 8 then raise exception 'invalid: suggestions' using errcode = '22023'; end if;
    for x in select * from jsonb_array_elements(p_cfg -> 'suggestions') loop
      t := btrim(coalesce(x #>> '{}', ''));
      if jsonb_typeof(x) <> 'string' or t = '' or char_length(t) > 80 or t ~ '[<>]' then raise exception 'invalid: suggestions' using errcode = '22023'; end if;
      v_s := v_s || to_jsonb(t);
    end loop;
    v_new := v_new || jsonb_build_object('suggestions', v_s);
  end if;
  insert into public.settings (section, data) values ('marketing', jsonb_build_object('agents', jsonb_build_object(p_agent, v_new)))
  on conflict (section) do update set data = jsonb_set(coalesce(public.settings.data, '{}'::jsonb), '{agents}', coalesce(public.settings.data -> 'agents', '{}'::jsonb) || jsonb_build_object(p_agent, v_new));
  return v_new;
end
$$;
revoke execute on function public.mkt_agent_settings_set(text, jsonb) from public, anon;
grant execute on function public.mkt_agent_settings_set(text, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------- the runs and the designer's images (decision 6)

-- ai-content `agent` and ai-images `agent_image` record their runs as source «agent»
alter table public.ai_runs drop constraint if exists ai_runs_source_check;
alter table public.ai_runs add constraint ai_runs_source_check
  check (source is null or source in ('data', 'image', 'product', 'studio', 'tool', 'edit', 'import', 'campaign', 'template', 'post', 'buyer', 'video', 'chat', 'filter', 'agent'));

-- the designer's images live in the bucket «marketing» under agents/<member>/<chat>/ (the server writes them): the bucket's read stays
-- marketing.view for the campaigns and the templates, and a chat's images are their member's only («كل عضو شاتاته بس»)
do $storage$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') and to_regclass('storage.buckets') is not null then
    execute $s$drop policy if exists marketing_files_select on storage.objects$s$;
    execute $s$create policy marketing_files_select on storage.objects for select to authenticated
               using (bucket_id = 'marketing' and (select public.has_perm('marketing.view')) <> 'N'
                      and ((storage.foldername(name))[1] is distinct from 'agents' or (storage.foldername(name))[2] = (select auth.uid())::text))$s$;
  end if;
end $storage$;
