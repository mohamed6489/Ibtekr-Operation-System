-- RLS tests for 0132_auto_cleanup (the owner 18 Nov — the clean-up every 48 hours): data_cleanup deletes only what its rules name (old
-- logs, read alerts past 60 days, notes past 30 days, the archived batches / deleted chats it is handed when they still match) and
-- never a fresh row; cleanup_plan and data_cleanup are the server's only. One transaction rolled back; prints NOTICE
-- 'rls_auto_cleanup: ok'. Live-safe (the counts are not asserted — only the rows made here).

begin;

insert into auth.users (id, email, phone) values ('00000000-0000-4000-8000-0000000132a1', 'ac-admin.dev@ibtekr.local', '01000132a01');
insert into public.profiles (id, name, email, phone, role_id, status) values
  ('00000000-0000-4000-8000-0000000132a1', 'أدمن التنضيف', 'ac-admin.dev@ibtekr.local', '01000132a01', 'admin', 'active');

-- what a run meets: old and fresh of each kind
insert into public.woo_sync_log (at, kind, result, entity, action) values
  (now() - interval '31 days', 'cron', 'ok', 'ac-test', 'old'), (now() - interval '2 days', 'cron', 'ok', 'ac-test', 'fresh');
insert into public.alerts (id, at, kind, title, user_id, read_at) values
  (-13201, now() - interval '61 days', 'ac', 'قديم ومقروء', '00000000-0000-4000-8000-0000000132a1', now() - interval '60 days'),
  (-13202, now() - interval '61 days', 'ac', 'قديم ومش مقروء', '00000000-0000-4000-8000-0000000132a1', null),
  (-13203, now() - interval '61 days', 'ac', 'قديم لدور واتقرا', null, null),
  (-13204, now() - interval '5 days', 'ac', 'جديد ومقروء', '00000000-0000-4000-8000-0000000132a1', now());
update public.alerts set role_id = 'admin' where id = -13203;
insert into public.alert_reads (alert_id, user_id) values (-13203, '00000000-0000-4000-8000-0000000132a1');
insert into public.ai_agent_notes (agent, kind, title, body, ref, created_at) values
  ('dev', 'problem', 'ملاحظة قديمة', 'x', 'ac-test:old', now() - interval '31 days'),
  ('dev', 'problem', 'ملاحظة جديدة', 'x', 'ac-test:new', now() - interval '2 days');
insert into public.studio_batches (id, title, archived_at) values
  ('00000000-0000-4000-8000-0000000132b1', 'دفعة قديمة', now() - interval '31 days'),
  ('00000000-0000-4000-8000-0000000132b2', 'دفعة اتأرشفت قريب', now() - interval '3 days'),
  ('00000000-0000-4000-8000-0000000132b3', 'دفعة شغّالة', null);
insert into public.mkt_agent_chats (id, member_id, agent, title, deleted_at) values
  ('00000000-0000-4000-8000-0000000132c1', '00000000-0000-4000-8000-0000000132a1', 'dev', 'اتمسح', now() - interval '2 days'),
  ('00000000-0000-4000-8000-0000000132c2', '00000000-0000-4000-8000-0000000132a1', 'dev', 'لسه', null);

set local role service_role;
do $$
declare r jsonb;
begin
  -- every batch and chat handed in: only the ones that still match their rule go
  r := public.data_cleanup(array['00000000-0000-4000-8000-0000000132b1', '00000000-0000-4000-8000-0000000132b2', '00000000-0000-4000-8000-0000000132b3']::uuid[], '{}',
                           array['00000000-0000-4000-8000-0000000132c1', '00000000-0000-4000-8000-0000000132c2']::uuid[]);
  if r is null or not (r ? 'sync_log' and r ? 'alerts' and r ? 'studio_batches') then raise exception 'case the counts shape failed: %', r; end if;
  if exists (select 1 from public.woo_sync_log where entity = 'ac-test' and action = 'old') then raise exception 'case an old sync row goes failed'; end if;
  if not exists (select 1 from public.woo_sync_log where entity = 'ac-test' and action = 'fresh') then raise exception 'case a fresh sync row stays failed'; end if;
  if exists (select 1 from public.alerts where id in (-13201, -13203)) then raise exception 'case old read alerts go failed'; end if;
  if not exists (select 1 from public.alerts where id = -13202) then raise exception 'case an old unread alert stays failed'; end if;
  if not exists (select 1 from public.alerts where id = -13204) then raise exception 'case a fresh read alert stays failed'; end if;
  if exists (select 1 from public.ai_agent_notes where ref = 'ac-test:old') then raise exception 'case an old note goes failed'; end if;
  if not exists (select 1 from public.ai_agent_notes where ref = 'ac-test:new') then raise exception 'case a fresh note stays failed'; end if;
  if exists (select 1 from public.studio_batches where id = '00000000-0000-4000-8000-0000000132b1') then raise exception 'case an old archived batch goes failed'; end if;
  if (select count(*) from public.studio_batches where id in ('00000000-0000-4000-8000-0000000132b2', '00000000-0000-4000-8000-0000000132b3')) <> 2 then
    raise exception 'case a recent or working batch stays failed'; end if;
  if exists (select 1 from public.mkt_agent_chats where id = '00000000-0000-4000-8000-0000000132c1') then raise exception 'case a deleted chat goes failed'; end if;
  if not exists (select 1 from public.mkt_agent_chats where id = '00000000-0000-4000-8000-0000000132c2') then raise exception 'case a live chat stays failed'; end if;
  -- the plan reads storage (Supabase only)
  if to_regclass('storage.objects') is not null then
    r := public.cleanup_plan(10);
    if not (r ? 'studio' and r ? 'images' and r ? 'jobs' and r ? 'chats') then raise exception 'case the plan shape failed: %', r; end if;
  end if;
end $$;

-- a member (even the admin) calls neither
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000132a1","role":"authenticated","aal":"aal2"}', true);
do $$
begin
  begin perform public.data_cleanup('{}', '{}', '{}'); raise exception 'case a member cleans nothing failed';
  exception when insufficient_privilege then null; end;
  begin perform public.cleanup_plan(10); raise exception 'case a member reads no plan failed';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
do $$ begin raise notice 'rls_auto_cleanup: ok'; end $$;
rollback;
