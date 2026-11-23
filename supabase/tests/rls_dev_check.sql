-- RLS tests for 0130_dev_check (agents-brain decision 5, «طريقة أ» — the owner 18 Nov): the developer's daily check reads the scheduled
-- jobs' health and clears the notes of problems gone — both for the server only; the clear deletes only the agent's notes under the prefix
-- that are not kept. One transaction rolled back; prints NOTICE 'rls_dev_check: ok'. Live-safe.

begin;

insert into auth.users (id, email, phone) values ('00000000-0000-4000-8000-0000000130a1', 'dc-admin.dev@ibtekr.local', '01000130a01');
insert into public.profiles (id, name, email, phone, role_id, status) values
  ('00000000-0000-4000-8000-0000000130a1', 'أدمن الفحص', 'dc-admin.dev@ibtekr.local', '01000130a01', 'admin', 'active');

-- the server: the health reads, the notes are written and cleared
set local role service_role;
do $$
declare h jsonb; n int; m int;
begin
  h := public.dev_cron_health(24);
  if h is null or jsonb_typeof(h -> 'jobs') <> 'array' or not (h ? 'http') then raise exception 'case the health shape failed: %', h; end if;
  perform public.ai_agent_note_add('dev', 'problem', 'خطأ على الشاشة', 'x', 'dev:crash:a', null);
  perform public.ai_agent_note_add('dev', 'problem', 'مزامنة فشلت', 'x', 'dev:sync:b', null);
  perform public.ai_agent_note_add('dev', 'update', 'ملاحظة تانية', 'x', 'other:1', null);
  perform public.ai_agent_note_add('accountant', 'report', 'مش بتاعه', 'x', 'dev:crash:a', null);
  -- the live project may hold the developer's own notes: the clear takes those too, so the count is what stands under the prefix
  -- apart from the kept one (on an empty database: the one written above)
  select count(*) into m from public.ai_agent_notes where agent = 'dev' and ref like 'dev:%' and ref <> 'dev:sync:b';
  if m < 1 then raise exception 'case the note to clear is there failed: %', m; end if;
  n := public.ai_agent_note_clear('dev', 'dev:', array['dev:sync:b']);
  if n <> m then raise exception 'case the clear deletes what is not kept failed: % of %', n, m; end if;
  if exists (select 1 from public.ai_agent_notes where agent = 'dev' and ref like 'dev:%' and ref <> 'dev:sync:b') then raise exception 'case nothing else stays under the prefix failed'; end if;
  if exists (select 1 from public.ai_agent_notes where agent = 'dev' and ref = 'dev:crash:a') then raise exception 'case the problem gone loses its note failed'; end if;
  if not exists (select 1 from public.ai_agent_notes where agent = 'dev' and ref = 'dev:sync:b') then raise exception 'case a kept note stays failed'; end if;
  if not exists (select 1 from public.ai_agent_notes where agent = 'dev' and ref = 'other:1') then raise exception 'case another prefix stays failed'; end if;
  if not exists (select 1 from public.ai_agent_notes where agent = 'accountant' and ref = 'dev:crash:a') then raise exception 'case another assistant stays failed'; end if;
  begin perform public.ai_agent_note_clear('dev', '', '{}'); raise exception 'case an empty prefix is refused failed';
  exception when sqlstate '22023' then null; end;
  begin perform public.ai_agent_note_clear('dev', 'dev%:', '{}'); raise exception 'case a pattern prefix is refused failed';
  exception when sqlstate '22023' then null; end;
end $$;

-- a member (even the admin) calls neither
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000130a1","role":"authenticated","aal":"aal2"}', true);
do $$
begin
  begin perform public.dev_cron_health(24); raise exception 'case a member reads no job health failed';
  exception when insufficient_privilege then null; end;
  begin perform public.ai_agent_note_clear('dev', 'dev:', '{}'); raise exception 'case a member clears no note failed';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
do $$ begin raise notice 'rls_dev_check: ok'; end $$;
rollback;
