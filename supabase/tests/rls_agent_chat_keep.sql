-- Tests for 0168 (an assistant's chats go by themselves after the admin's time — Safwat 25 Nov): 48 hours by default, the admin's
-- hours per assistant (24 … 2160), anything else = 48; ai_chats_expire marks deleted_at on a chat whose last message is older than
-- its assistant's time, leaves the rest and the ones already deleted; members can't call it.
-- Depends on 0001 … 0168. One transaction, rolled back; NOTICE 'rls_agent_chat_keep: ok' only if every case passed.
begin;
insert into auth.users (id, email, phone) values ('00000000-0000-4000-8000-000000168a01', 'keep-adm.dev@ibtekr.local', '0100168a01');
insert into public.profiles (id, name, email, phone, role_id, status) values
  ('00000000-0000-4000-8000-000000168a01', 'أدمن الشات', 'keep-adm.dev@ibtekr.local', '0100168a01', 'admin', 'active');
delete from public.settings where section = 'ai';
insert into public.settings (section, data) values ('ai', '{"agents":{"designer":{"keep":24},"dev":{"keep":2160},"buyer":{"keep":"x"}}}'::jsonb);
insert into public.mkt_agent_chats (id, member_id, agent, title, updated_at, deleted_at) values
  ('00000000-0000-4000-8000-000000168c01', '00000000-0000-4000-8000-000000168a01', 'designer', 'ديزاينر قديم', now() - interval '30 hours', null),
  ('00000000-0000-4000-8000-000000168c02', '00000000-0000-4000-8000-000000168a01', 'designer', 'ديزاينر جديد', now() - interval '2 hours', null),
  ('00000000-0000-4000-8000-000000168c03', '00000000-0000-4000-8000-000000168a01', 'dev', 'مبرمج من شهر', now() - interval '40 days', null),
  ('00000000-0000-4000-8000-000000168c04', '00000000-0000-4000-8000-000000168a01', 'buyer', 'ميديا باير 3 أيام', now() - interval '3 days', null),
  ('00000000-0000-4000-8000-000000168c05', '00000000-0000-4000-8000-000000168a01', 'buyer', 'ميديا باير يوم', now() - interval '1 day', null),
  ('00000000-0000-4000-8000-000000168c06', '00000000-0000-4000-8000-000000168a01', 'designer', 'ممسوح', now() - interval '10 days', now() - interval '5 days');
do $$
declare n int; was timestamptz;
begin
  if public.ai_chat_keep_hours('designer') <> 24 then raise exception 'case the admin''s 24 hours failed'; end if;
  if public.ai_chat_keep_hours('dev') <> 2160 then raise exception 'case 3 months failed'; end if;
  if public.ai_chat_keep_hours('buyer') <> 48 then raise exception 'case a wrong value = 48 failed'; end if;
  if public.ai_chat_keep_hours('stock') <> 48 then raise exception 'case the default 48 failed'; end if;
  select deleted_at into was from public.mkt_agent_chats where id = '00000000-0000-4000-8000-000000168c06';
  n := public.ai_chats_expire();
  if n <> 2 then raise exception 'case two chats expired failed (%)', n; end if;
  if (select array_agg(title order by title) from public.mkt_agent_chats where member_id = '00000000-0000-4000-8000-000000168a01' and deleted_at is null)
     is distinct from array['ديزاينر جديد', 'مبرمج من شهر', 'ميديا باير يوم'] then raise exception 'case the right chats stay failed'; end if;
  if (select deleted_at from public.mkt_agent_chats where id = '00000000-0000-4000-8000-000000168c06') is distinct from was then raise exception 'case an already deleted chat untouched failed'; end if;
end $$;
-- a member can't run the expiry
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000168a01","role":"authenticated"}';
do $$
begin
  begin perform public.ai_chats_expire(); raise exception 'case a member can''t expire failed';
  exception when insufficient_privilege then null; end;
  raise notice 'rls_agent_chat_keep: ok';
end $$;
rollback;
