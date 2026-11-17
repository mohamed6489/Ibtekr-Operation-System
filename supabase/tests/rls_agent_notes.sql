-- RLS tests for 0124_agent_notes (the owner 17 Nov — the assistants talk through notifications): a note reaches who sees its assistant,
-- the server writes it (one live row per ref, off in settings = none), a member marks only his own reads, and the click opens one chat
-- for him with the note as the assistant's first message. One transaction rolled back; prints NOTICE 'rls_agent_notes: ok'. Live-safe.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000124a1', 'an-acc.dev@ibtekr.local', '01000124a01'),
  ('00000000-0000-4000-8000-0000000124a2', 'an-ops.dev@ibtekr.local', '01000124a02');
insert into public.profiles (id, name, email, phone, role_id, status) values
  ('00000000-0000-4000-8000-0000000124a1', 'حسابات التنبيهات', 'an-acc.dev@ibtekr.local', '01000124a01', 'accounts', 'active'),
  ('00000000-0000-4000-8000-0000000124a2', 'عمليات التنبيهات', 'an-ops.dev@ibtekr.local', '01000124a02', 'ops', 'active');

create temp table an_ids (k text primary key, id bigint, chat uuid) on commit drop;
grant all on an_ids to authenticated, service_role;
create temp table an_saved on commit drop as select data from public.settings where section = 'notif';

-- the server writes (service_role); the same ref refreshes the row
set local role service_role;
do $$
declare a bigint; b bigint; c bigint;
begin
  a := public.ai_agent_note_add('accountant', 'report', 'مستحقات المبتكرين', 'فيه 3 مبتكرين مستحقين تحويل', 'due:1', 'accounts');
  b := public.ai_agent_note_add('accountant', 'report', 'مستحقات المبتكرين (محدّث)', 'فيه 4', 'due:1', 'accounts');
  if a is null or a <> b or (select title from public.ai_agent_notes where id = a) <> 'مستحقات المبتكرين (محدّث)' then raise exception 'case one live row per ref failed'; end if;
  c := public.ai_agent_note_add('cs', 'alert', 'محادثات مستنية رد', '', null, 'cs');
  insert into an_ids (k, id) values ('acc', a), ('stock', c);
end $$;

-- a member never writes notes (the server's writer is closed to him)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000124a1","role":"authenticated"}', true);
do $$
begin
  begin perform public.ai_agent_note_add('accountant', 'idea', 'من عضو', ''); raise exception 'case a member adds no note failed';
  exception when insufficient_privilege then null; end;
  begin insert into public.ai_agent_notes (agent, kind, title) values ('accountant', 'idea', 'مباشر'); raise exception 'case a member inserts no note failed';
  exception when insufficient_privilege then null; end;
  -- accounts sees the accountant's note, not the customer-service assistant's
  if not exists (select 1 from public.ai_agent_notes where id = (select id from an_ids where k = 'acc')) then raise exception 'case accounts sees the accountant''s note failed'; end if;
  if exists (select 1 from public.ai_agent_notes where id = (select id from an_ids where k = 'stock')) then raise exception 'case accounts does not see the cs note failed'; end if;
  -- reads: only notes he sees
  if public.ai_agent_note_read(array[(select id from an_ids where k = 'acc'), (select id from an_ids where k = 'stock')]) <> 1 then raise exception 'case read marks the seen one only failed'; end if;
  -- open: a chat of his with the note as the first message; again = the same chat
  update an_ids set chat = public.ai_agent_note_open((select id from an_ids where k = 'acc')) where k = 'acc';
  if (select chat from an_ids where k = 'acc') is null
     or (select count(*) from public.mkt_agent_messages m where m.chat_id = (select chat from an_ids where k = 'acc') and m.role = 'assistant' and m.text like 'مستحقات المبتكرين%') <> 1 then
    raise exception 'case open makes the chat with the note failed';
  end if;
  if public.ai_agent_note_open((select id from an_ids where k = 'acc')) <> (select chat from an_ids where k = 'acc') then raise exception 'case open again = the same chat failed'; end if;
  begin perform public.ai_agent_note_open((select id from an_ids where k = 'stock')); raise exception 'case open a note he does not see failed';
  exception when sqlstate 'P0002' then null; end;
end $$;

-- the other member sees no read mark of the first
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000124a2","role":"authenticated"}', true);
do $$
begin
  if exists (select 1 from public.ai_agent_note_reads) then raise exception 'case read marks are one''s own failed'; end if;
  if not exists (select 1 from public.ai_agent_notes where id = (select id from an_ids where k = 'stock')) then raise exception 'case ops sees the cs note failed'; end if;
end $$;

-- off in settings = no note
reset role;
delete from public.settings where section = 'notif';
insert into public.settings (section, data) values ('notif', '{"agents":{"cs":{"on":false}}}'::jsonb);
set local role service_role;
do $$
begin
  if public.ai_agent_note_add('cs', 'alert', 'مقفول', '') is not null then raise exception 'case an assistant switched off adds nothing failed'; end if;
  if public.ai_agent_note_add('nobody', 'alert', 'مش موجود', '') is not null then raise exception 'case an unknown assistant adds nothing failed'; end if;
end $$;

reset role;
do $$ begin raise notice 'rls_agent_notes: ok'; end $$;
rollback;
