-- 0124 — the assistants talk through notifications (docs/superpowers/plans/2026-11-17-agents-brain.md decision 1 — the owner 17 Nov:
-- «يقولي ان في مشكلة في التنبيهات و لما ادوس عليها توديني عندوا نحلها سوا … لغة حوارنا دايما من خلال التنبيهات … مكان في كل حتة زي
-- السيتينج و التنبيهات اللي بتظهر للمستخدمين»).
-- * ai_agent_notes: what an assistant tells the team — a problem / an idea / an update / a report / an alert, with an optional page it
--   points at; the server writes them (ai_agent_note_add, service_role), one live row per (assistant, ref) so a check that runs again
--   refreshes its note instead of piling up. Who sees one = who sees the assistant (ai_agent_can), the last 30 days.
-- * ai_agent_note_reads: each member's own read mark, and the chat the note opened for them.
-- * ai_agent_note_open(id): the bell's click — a new chat for the member with the note as the assistant's first message (once per member;
--   again = the same chat while it lives), marks it read, returns the chat.
-- * settings.notif.agents.<id>.on = false stops an assistant's notes (the admin, «الإعدادات › التنبيهات › المساعدين»).
-- Re-runnable.

create table if not exists public.ai_agent_notes (
  id bigint generated always as identity primary key,
  agent text not null references public.ai_agents(id) on delete cascade,
  kind text not null check (kind in ('problem', 'idea', 'update', 'report', 'alert')),
  title text not null check (char_length(title) between 2 and 120 and title !~ '[<>]'),
  body text not null default '' check (char_length(body) <= 4000),
  link text check (link is null or link ~ '^[a-z][a-z0-9-]{0,60}(/[A-Za-z0-9_-]{1,40})?$'),
  ref text check (ref is null or char_length(ref) between 1 and 120),
  created_at timestamptz not null default now()
);
create unique index if not exists ai_agent_notes_ref_key on public.ai_agent_notes (agent, ref) where ref is not null;
create index if not exists ai_agent_notes_at_idx on public.ai_agent_notes (created_at desc);
alter table public.ai_agent_notes enable row level security;
revoke all on public.ai_agent_notes from anon, authenticated;
grant select on public.ai_agent_notes to authenticated;
grant all on public.ai_agent_notes to service_role;
drop policy if exists ai_agent_notes_select on public.ai_agent_notes;
create policy ai_agent_notes_select on public.ai_agent_notes for select to authenticated
  using (created_at > now() - interval '30 days' and public.ai_agent_can(agent));

create table if not exists public.ai_agent_note_reads (
  note_id bigint not null references public.ai_agent_notes(id) on delete cascade,
  member_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  chat_id uuid references public.mkt_agent_chats(id) on delete set null,
  primary key (note_id, member_id)
);
alter table public.ai_agent_note_reads enable row level security;
revoke all on public.ai_agent_note_reads from anon, authenticated;
grant select on public.ai_agent_note_reads to authenticated;
grant all on public.ai_agent_note_reads to service_role;
drop policy if exists ai_agent_note_reads_select on public.ai_agent_note_reads;
create policy ai_agent_note_reads_select on public.ai_agent_note_reads for select to authenticated using (member_id = (select auth.uid()));

-- the server's writer: null when the assistant's notes are off (or it is archived); the same ref refreshes its row — a refresh after a
-- week counts as new (its read marks go, the time moves)
create or replace function public.ai_agent_note_add(p_agent text, p_kind text, p_title text, p_body text default '', p_ref text default null, p_link text default null)
returns bigint
language plpgsql volatile security definer set search_path = public as $$
declare v_id bigint; v_old timestamptz;
begin
  if not exists (select 1 from public.ai_agents where id = p_agent and archived_at is null) then return null; end if;
  if coalesce((select data -> 'agents' -> p_agent ->> 'on' from public.settings where section = 'notif'), 'true') = 'false' then return null; end if;
  if p_ref is not null then
    select id, created_at into v_id, v_old from public.ai_agent_notes where agent = p_agent and ref = p_ref;
  end if;
  if v_id is null then
    insert into public.ai_agent_notes (agent, kind, title, body, link, ref) values (p_agent, p_kind, left(btrim(p_title), 120), left(coalesce(p_body, ''), 4000), p_link, p_ref)
    returning id into v_id;
  else
    update public.ai_agent_notes set kind = p_kind, title = left(btrim(p_title), 120), body = left(coalesce(p_body, ''), 4000), link = p_link,
      created_at = case when v_old < now() - interval '7 days' then now() else created_at end
    where id = v_id;
    if v_old < now() - interval '7 days' then delete from public.ai_agent_note_reads where note_id = v_id; end if;
  end if;
  return v_id;
end
$$;
revoke execute on function public.ai_agent_note_add(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.ai_agent_note_add(text, text, text, text, text, text) to service_role;

-- read marks (the member's own, notes they see)
create or replace function public.ai_agent_note_read(p_ids bigint[]) returns int
language plpgsql volatile security definer set search_path = public as $$
declare v_n int;
begin
  if auth.uid() is null then raise exception 'not allowed' using errcode = '42501'; end if;
  insert into public.ai_agent_note_reads (note_id, member_id)
  select n.id, auth.uid() from public.ai_agent_notes n
  where n.id = any (coalesce(p_ids, '{}')) and public.ai_agent_can(n.agent) and n.created_at > now() - interval '30 days'
  on conflict (note_id, member_id) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
revoke execute on function public.ai_agent_note_read(bigint[]) from public, anon;
grant execute on function public.ai_agent_note_read(bigint[]) to authenticated, service_role;

-- the bell's click: the member's chat for the note (made once, the note as the assistant's first message)
create or replace function public.ai_agent_note_open(p_id bigint) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare n public.ai_agent_notes; v_chat uuid;
begin
  if auth.uid() is null then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into n from public.ai_agent_notes where id = p_id and created_at > now() - interval '30 days';
  if not found or not public.ai_agent_can(n.agent) then raise exception 'note not found' using errcode = 'P0002'; end if;
  select r.chat_id into v_chat from public.ai_agent_note_reads r join public.mkt_agent_chats c on c.id = r.chat_id
  where r.note_id = p_id and r.member_id = auth.uid() and c.deleted_at is null;
  if v_chat is not null then return v_chat; end if;
  insert into public.mkt_agent_chats (member_id, agent, title) values (auth.uid(), n.agent, left(n.title, 80)) returning id into v_chat;
  insert into public.mkt_agent_messages (chat_id, role, text) values (v_chat, 'assistant', left(n.title || case when n.body <> '' then E'\n\n' || n.body else '' end, 8000));
  insert into public.ai_agent_note_reads (note_id, member_id, chat_id) values (p_id, auth.uid(), v_chat)
  on conflict (note_id, member_id) do update set chat_id = excluded.chat_id;
  return v_chat;
end
$$;
revoke execute on function public.ai_agent_note_open(bigint) from public, anon;
grant execute on function public.ai_agent_note_open(bigint) to authenticated, service_role;

-- the bell refreshes on the «alerts» sync signal (0104)
drop trigger if exists ai_agent_notes_live on public.ai_agent_notes;
create trigger ai_agent_notes_live after insert or update or delete on public.ai_agent_notes for each statement execute function public.live_changed('alerts');
