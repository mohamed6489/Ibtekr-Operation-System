-- 0150 — the system first, an outside AI by the member's approval (docs/superpowers/plans/2026-11-22-system-brain.md — the owner 22 Nov:
-- «السيستم يتحول لايجنت منفصل يقدر يعمل كل الاكشنز في حدود المعلومات و البيانات اللي داخلالوا» and «اي مخ خارجي لما بدخلوا لازم اوافق …
-- من غير ما يكون عندوا كل معلومات الشركة الا لو انا وافقت بعد ما الايجنت بتاعي يطلب مني»).
-- * mkt_agent_messages.source / .shared: who answered a turn — the system itself or the outside company — and the kinds of the system's
--   data that company was given for it (ai-content writes them; a company is later given only the turns it answered itself).
-- * mkt_agent_system_turn(agent, chat, question, answer): the system's own answer in an assistant's chat, kept in the member's own
--   chat (text only, marked «system») — no model behind it, never part of what an outside company is given.
-- * «المدير العام»: a built-in assistant for whoever opens the team's requests — it routes to the right assistant and reads every desk.
-- * ai_agent_state: the numbers the assistants watch, counted by the scheduled check (notify — every 15 minutes, _shared/agent-rules.js)
--   with the rule on each that holds; ai_agent_facts() gives a member the assistants they see (ai_agent_can) and, of each, the numbers
--   of the pages they read in full (has_perm = F) — what an assistant's chat answers a number from, with no model. The rules themselves live in the row «ai» (agents.<id>.rules — the admin's settings).
-- * ai_agent_notes.perm: a rule's note carries a page's count — it is seen with that page in full (ai_agent_note_sees), like the numbers.
-- Re-runnable.

alter table public.mkt_agent_messages add column if not exists source text;
alter table public.mkt_agent_messages add column if not exists shared jsonb not null default '[]'::jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'mkt_agent_messages_source_check') then
    alter table public.mkt_agent_messages add constraint mkt_agent_messages_source_check check (source is null or source in ('system', 'claude', 'openai', 'gemini'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mkt_agent_messages_shared_check') then
    alter table public.mkt_agent_messages add constraint mkt_agent_messages_shared_check check (jsonb_typeof(shared) = 'array' and jsonb_array_length(shared) <= 20);
  end if;
end $$;

-- the system's own answer, kept in the member's chat (their own chat with an assistant they see; a new chat is named by the question)
create or replace function public.mkt_agent_system_turn(p_agent text, p_chat uuid, p_question text, p_answer text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := (select auth.uid());
  v_q text := btrim(regexp_replace(coalesce(p_question, ''), '[[:cntrl:]]', ' ', 'g'));
  v_a text := btrim(regexp_replace(coalesce(p_answer, ''), E'[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]', ' ', 'g'));
  v_chat public.mkt_agent_chats; v_turns jsonb; v_title text;
begin
  if v_uid is null or not public.ai_agent_can(p_agent) then raise exception 'forbidden' using errcode = '42501'; end if;
  if char_length(v_q) not between 1 and 1000 then raise exception 'invalid: question' using errcode = '22023'; end if;
  if char_length(v_a) not between 1 and 2000 then raise exception 'invalid: answer' using errcode = '22023'; end if;
  -- a member's page writes a turn per question: more than 30 a minute is not a person
  if (select count(*) from public.mkt_agent_messages m join public.mkt_agent_chats c on c.id = m.chat_id
       where c.member_id = v_uid and m.source = 'system' and m.role = 'user' and m.created_at > now() - interval '1 minute') >= 30 then
    raise exception 'busy' using errcode = '53400';
  end if;
  if p_chat is null then
    v_title := left(regexp_replace(v_q, '\s+', ' ', 'g'), 60);
    insert into public.mkt_agent_chats (member_id, agent, title) values (v_uid, p_agent, v_title) returning * into v_chat;
  else
    select * into v_chat from public.mkt_agent_chats where id = p_chat and member_id = v_uid and agent = p_agent and deleted_at is null;
    if not found then raise exception 'not found' using errcode = 'P0002'; end if;
    update public.mkt_agent_chats set updated_at = now() where id = v_chat.id;
  end if;
  with ins as (
    insert into public.mkt_agent_messages (chat_id, role, text, source) values (v_chat.id, 'user', v_q, 'system'), (v_chat.id, 'assistant', v_a, 'system')
    returning id, role, text, images, created_at, source, shared
  ) select jsonb_agg(to_jsonb(ins) order by ins.id) into v_turns from ins;
  return jsonb_build_object('chat', jsonb_build_object('id', v_chat.id, 'agent', v_chat.agent, 'title', v_chat.title, 'created_at', v_chat.created_at, 'updated_at', now()), 'turns', v_turns);
end
$$;
revoke execute on function public.mkt_agent_system_turn(text, uuid, text, text) from public, anon;
grant execute on function public.mkt_agent_system_turn(text, uuid, text, text) to authenticated, service_role;

-- «المدير العام»: for whoever opens the team's requests; its team = the management's (the role's name as it stands today)
insert into public.ai_agents (id, name, icon, perm, sees, role, about, builtin, sort)
select 'manager', 'المدير العام', 'sliders', 'tickets.view', '{orders,vendors,customers,tickets,tasks,expenses,sales,inventory,hr}', r.name,
       'بيرتّب الشغل ويوجّهك للمساعد الصح: ملخص اليوم، العاجل والمتأخر الأول، وتقسيم الطلب الكبير على الفرق', true, 5
  from public.roles r where r.id = 'admin'
on conflict (id) do nothing;
insert into public.ai_agent_kb (kind, section, title, body, agents, sort)
select v.kind, 'الإدارة', v.title, v.body, array['manager'], v.sort
from (values
  ('rules', 'وجّه للمساعد الصح', 'اعرف تخصص كل مساعد ووجّه الطلب له. ماتردش إنت على سؤال إعلانات أو حسابات أو مخزن.', 9001),
  ('rules', 'العاجل والمتأخر الأول', 'رتّب أي قايمة بالأولوية: أوردرات متأخرة، طلبات عاجلة، محادثات مستنية رد، وبعدين الباقي.', 9002),
  ('rules', 'ملخص قبل التفاصيل', 'ابدأ بسطرين عن الوضع، والتفاصيل لمن يطلبها.', 9003),
  ('skills', 'تقسيم طلب كبير', 'قسّم الطلب لمهام صغيرة، كل مهمة للفريق المختص، واعرضها للمراجعة قبل الإرسال.', 9001),
  ('skills', 'متابعة حمل الفرق', 'مين عنده شغل متأخر ومين حمله خفيف، واقترح مين ياخد إيه — من غير ما تعيّن.', 9002)
) as v(kind, title, body, sort)
where exists (select 1 from public.ai_agents where id = 'manager')
  and not exists (select 1 from public.ai_agent_kb k where 'manager' = any (k.agents));

-- the active makers with no bank account kept — counted here for the scheduled check, so no account is ever read out for a count
create or replace function public.ai_agent_bankless() returns integer
language sql stable set search_path = public as $$
  select count(*)::int from public.vendors v
  where v.status = 'active' and v.archived_at is null
    and not exists (select 1 from public.vendor_bank b where b.vendor_id = v.id
      and coalesce(btrim(b.account_number), '') || coalesce(btrim(b.iban), '') || coalesce(btrim(b.wallet), '') <> '')
$$;
revoke execute on function public.ai_agent_bankless() from public, anon, authenticated;
grant execute on function public.ai_agent_bankless() to service_role;

-- the numbers the assistants watch now (one row, the server's): { at, agents: { <id>: { name, metrics: [...] } } }
create table if not exists public.ai_agent_state (
  id boolean primary key default true check (id),
  facts jsonb not null default '{}'::jsonb check (jsonb_typeof(facts) = 'object'),
  at timestamptz not null default now()
);
alter table public.ai_agent_state enable row level security;
revoke all on public.ai_agent_state from anon, authenticated;
grant all on public.ai_agent_state to service_role;

-- a member is given the assistants they see (ai_agent_can) and, of each, only the numbers of the pages they read in full: a number
-- counts a page's rows, so it needs that page's permission at `F` (the admin: all) — seeing the assistant is not enough, and a
-- partial view («P» — my own requests, my own team) never gets the company's count. A number with no known permission is the admin's.
create or replace function public.ai_agent_facts() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('at', s.at, 'agents', coalesce((
    select jsonb_object_agg(e.key, jsonb_build_object('name', e.value -> 'name', 'metrics', coalesce((
      select jsonb_agg(m.value - 'perm' order by m.ord)
      from jsonb_array_elements(case when jsonb_typeof(e.value -> 'metrics') = 'array' then e.value -> 'metrics' else '[]'::jsonb end) with ordinality as m(value, ord)
      where public.is_admin() or (coalesce(m.value ->> 'perm', '') <> '' and public.has_perm(m.value ->> 'perm') = 'F')), '[]'::jsonb)))
    from jsonb_each(case when jsonb_typeof(s.facts -> 'agents') = 'object' then s.facts -> 'agents' else '{}'::jsonb end) e
    where public.ai_agent_can(e.key)), '{}'::jsonb))
  from public.ai_agent_state s where s.id
$$;
revoke execute on function public.ai_agent_facts() from public, anon;
grant execute on function public.ai_agent_facts() to authenticated, service_role;

-- a note may need a page's permission (security review 22 Nov): a rule's note carries the count of a page («أوردرات متأخرة: 3»), so
-- seeing the assistant is not enough for it — the member needs that page in full, like the numbers of ai_agent_facts(). The other
-- notes (the team's summary, the developer's check, …) carry no permission and stay with whoever sees the assistant.
alter table public.ai_agent_notes add column if not exists perm text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ai_agent_notes_perm_check') then
    alter table public.ai_agent_notes add constraint ai_agent_notes_perm_check check (perm is null or perm ~ '^[a-z_]+\.[a-z_0-9]+$');
  end if;
end $$;
create or replace function public.ai_agent_note_sees(p_agent text, p_perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.ai_agent_can(p_agent) and (p_perm is null or public.is_admin() or public.has_perm(p_perm) = 'F')
$$;
revoke execute on function public.ai_agent_note_sees(text, text) from public, anon;
grant execute on function public.ai_agent_note_sees(text, text) to authenticated, service_role;
drop policy if exists ai_agent_notes_select on public.ai_agent_notes;
create policy ai_agent_notes_select on public.ai_agent_notes for select to authenticated
  using (created_at > now() - interval '30 days' and public.ai_agent_note_sees(agent, perm));

-- the server's writer, with the note's permission (the six-argument one of 0124 goes: one function, the new argument last and optional)
drop function if exists public.ai_agent_note_add(text, text, text, text, text, text);
create or replace function public.ai_agent_note_add(p_agent text, p_kind text, p_title text, p_body text default '', p_ref text default null, p_link text default null, p_perm text default null)
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
    insert into public.ai_agent_notes (agent, kind, title, body, link, ref, perm) values (p_agent, p_kind, left(btrim(p_title), 120), left(coalesce(p_body, ''), 4000), p_link, p_ref, p_perm)
    returning id into v_id;
  else
    update public.ai_agent_notes set kind = p_kind, title = left(btrim(p_title), 120), body = left(coalesce(p_body, ''), 4000), link = p_link, perm = p_perm,
      created_at = case when v_old < now() - interval '7 days' then now() else created_at end
    where id = v_id;
    if v_old < now() - interval '7 days' then delete from public.ai_agent_note_reads where note_id = v_id; end if;
  end if;
  return v_id;
end
$$;
revoke execute on function public.ai_agent_note_add(text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.ai_agent_note_add(text, text, text, text, text, text, text) to service_role;

-- the read mark and the bell's click follow the same rule
create or replace function public.ai_agent_note_read(p_ids bigint[]) returns int
language plpgsql volatile security definer set search_path = public as $$
declare v_n int;
begin
  if auth.uid() is null then raise exception 'not allowed' using errcode = '42501'; end if;
  insert into public.ai_agent_note_reads (note_id, member_id)
  select n.id, auth.uid() from public.ai_agent_notes n
  where n.id = any (coalesce(p_ids, '{}')) and public.ai_agent_note_sees(n.agent, n.perm) and n.created_at > now() - interval '30 days'
  on conflict (note_id, member_id) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
revoke execute on function public.ai_agent_note_read(bigint[]) from public, anon;
grant execute on function public.ai_agent_note_read(bigint[]) to authenticated, service_role;

create or replace function public.ai_agent_note_open(p_id bigint) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare n public.ai_agent_notes; v_chat uuid;
begin
  if auth.uid() is null then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into n from public.ai_agent_notes where id = p_id and created_at > now() - interval '30 days';
  if not found or not public.ai_agent_note_sees(n.agent, n.perm) then raise exception 'note not found' using errcode = 'P0002'; end if;
  select r.chat_id into v_chat from public.ai_agent_note_reads r join public.mkt_agent_chats c on c.id = r.chat_id
  where r.note_id = p_id and r.member_id = auth.uid() and c.deleted_at is null;
  if v_chat is not null then return v_chat; end if;
  insert into public.mkt_agent_chats (member_id, agent, title) values (auth.uid(), n.agent, left(n.title, 80)) returning id into v_chat;
  insert into public.mkt_agent_messages (chat_id, role, text, source) values (v_chat, 'assistant', left(n.title || case when n.body <> '' then E'\n\n' || n.body else '' end, 8000), 'system');
  insert into public.ai_agent_note_reads (note_id, member_id, chat_id) values (p_id, auth.uid(), v_chat)
  on conflict (note_id, member_id) do update set chat_id = excluded.chat_id;
  return v_chat;
end
$$;
revoke execute on function public.ai_agent_note_open(bigint) from public, anon;
grant execute on function public.ai_agent_note_open(bigint) to authenticated, service_role;

-- the numbers kept for the chats go with «السجلات» when the admin wipes the data (the map of 0144 + this one row; the scheduled
-- check writes them again on its next run) — so nothing counted before a wipe is told after it
create or replace function public.data_wipe_map() returns table (section text, tbl text)
language sql immutable set search_path = public as $$
  select * from (values
    ('orders', 'orders'), ('orders', 'sub_orders'), ('orders', 'order_items'), ('orders', 'order_events'), ('orders', 'customer_ratings'), ('orders', 'returns'), ('orders', 'woo_webhook_events'), ('orders', 'sync_state'), ('orders', 'bosta_pickups'),
    ('vendors', 'vendors'), ('vendors', 'vendor_rates'), ('vendors', 'vendor_category_rates'), ('vendors', 'vendor_bank'), ('vendors', 'vendor_logins'), ('vendors', 'vendor_login_resets'), ('vendors', 'brands'), ('vendors', 'brand_owners'), ('vendors', 'brand_rates'),
    ('products', 'products'), ('products', 'woo_categories'), ('products', 'woo_brands'), ('products', 'product_commissions'), ('products', 'product_lead_days'), ('products', 'studio_batches'), ('products', 'image_imports'), ('products', 'image_shares'),
    ('accounts', 'acc_expenses'), ('accounts', 'acc_vendor_moves'), ('accounts', 'acc_account_moves'), ('accounts', 'acc_vendor_settlements'), ('accounts', 'dokan_withdrawals'), ('accounts', 'dokan_balances'),
    ('inventory', 'inv_lots'), ('inventory', 'inv_moves'), ('inventory', 'inv_consolidations'), ('inventory', 'inv_consolidation_items'), ('inventory', 'inv_counts'), ('inventory', 'inv_count_lines'),
    ('cs', 'cs_customers'), ('cs', 'cs_contacts'), ('cs', 'cs_customer_notes'), ('cs', 'cs_rating_overrides'), ('cs', 'cs_team_ratings'), ('cs', 'cs_conversations'), ('cs', 'cs_messages'), ('cs', 'cs_segments'), ('cs', 'cs_campaigns'), ('cs', 'cs_campaign_recipients'), ('cs', 'cs_posts'), ('cs', 'cs_carts'), ('cs', 'cs_auto_runs'),
    ('tickets', 'tickets'), ('tickets', 'ticket_events'),
    ('marketing', 'mkt_campaigns'), ('marketing', 'mkt_posts'), ('marketing', 'mkt_ad_objects'), ('marketing', 'mkt_ad_stats'), ('marketing', 'mkt_suggestions'), ('marketing', 'mkt_requests'), ('marketing', 'mkt_video_jobs'), ('marketing', 'mkt_agent_chats'), ('marketing', 'mkt_agent_messages'), ('marketing', 'mkt_trends'), ('marketing', 'mkt_competitors'), ('marketing', 'site_checks'),
    ('hr', 'hr_attendance'), ('hr', 'hr_overtime'), ('hr', 'hr_requests'), ('hr', 'hr_payroll'), ('hr', 'hr_payroll_lines'), ('hr', 'hr_payroll_paid'), ('hr', 'hr_adjustments'), ('hr', 'hr_evaluations'), ('hr', 'hr_scores'), ('hr', 'hr_extras'), ('hr', 'hr_meetings'), ('hr', 'hr_notes_log'), ('hr', 'hr_ot_adjust'), ('hr', 'hr_tasks'),
    ('logs', 'activity_log'), ('logs', 'alerts'), ('logs', 'alert_reads'), ('logs', 'alert_state'), ('logs', 'ai_runs'), ('logs', 'woo_sync_log'), ('logs', 'cs_channel_events'), ('logs', 'login_failures'),
    ('logs', 'ai_agent_notes'), ('logs', 'ai_agent_note_reads'), ('logs', 'ai_agent_state')
  ) v(section, tbl)
$$;
revoke execute on function public.data_wipe_map() from public, anon;
grant execute on function public.data_wipe_map() to authenticated, service_role;
