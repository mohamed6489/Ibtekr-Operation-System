-- Tests for 0089_hr_notes (owner batch 14 Nov decision 13 — the evaluation ⋮: a meeting, a warning, an improvement plan, a thanks).
-- Depends on 0001_identity … 0089_hr_notes. Runs in one transaction and rolls back; prints NOTICE 'rls_hr_notes: ok' only if every
-- case passed. Live-safe: its made-up members, notes, tickets and alerts are rolled back.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000089a1', 'hn-adm.dev@ibtekr.local', '010000089a1'),
  ('00000000-0000-4000-8000-0000000089a2', 'hn-mgr.dev@ibtekr.local', '010000089a2'),
  ('00000000-0000-4000-8000-0000000089a3', 'hn-rep.dev@ibtekr.local', '010000089a3'),
  ('00000000-0000-4000-8000-0000000089a4', 'hn-oth.dev@ibtekr.local', '010000089a4');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u where u.email like 'hn-%.dev@ibtekr.local';
insert into public.profiles (id, name, email, phone, role_id, status, manager_id) values
  ('00000000-0000-4000-8000-0000000089a1', 'أدمن الملاحظات', 'hn-adm.dev@ibtekr.local', '010000089a1', 'admin', 'active', null),
  ('00000000-0000-4000-8000-0000000089a2', 'مدير الملاحظات', 'hn-mgr.dev@ibtekr.local', '010000089a2', 'ops', 'active', null),
  ('00000000-0000-4000-8000-0000000089a3', 'عضو الملاحظات', 'hn-rep.dev@ibtekr.local', '010000089a3', 'cs', 'active', '00000000-0000-4000-8000-0000000089a2'),
  ('00000000-0000-4000-8000-0000000089a4', 'عضو تاني', 'hn-oth.dev@ibtekr.local', '010000089a4', 'cs', 'active', null);

create or replace function pg_temp.as_member(p_uid text) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;
create temp table hn (k text primary key, v text) on commit drop;
grant all on hn to authenticated;

-- ================================================================ grants: the table is read-only for the members, the function closed to anon
do $$ begin
  if has_table_privilege('authenticated', 'public.hr_notes_log', 'INSERT') or has_table_privilege('authenticated', 'public.hr_notes_log', 'UPDATE')
     or has_table_privilege('authenticated', 'public.hr_notes_log', 'DELETE') or has_table_privilege('anon', 'public.hr_notes_log', 'SELECT')
     or has_function_privilege('anon', 'public.hr_member_note_add(uuid, text, text, text, timestamptz)', 'execute')
     or not has_function_privilege('authenticated', 'public.hr_member_note_add(uuid, text, text, text, timestamptz)', 'execute') then
    raise exception 'case the grants failed';
  end if;
end $$;

-- ================================================================ the direct manager: a warning, a plan, a meeting (with its request), a thanks
select pg_temp.as_member('00000000-0000-4000-8000-0000000089a2');
do $$
declare r jsonb; v_m text := to_char(public.hr_today(), 'YYYY-MM');
begin
  r := public.hr_member_note_add('00000000-0000-4000-8000-0000000089a3', 'warning', v_m, 'الأوردرات اتأخرت أكتر من مرة');
  insert into hn values ('warn', r ->> 'id');
  if r ->> 'ticket' is not null then raise exception 'case a warning opens no request failed'; end if;
  r := public.hr_member_note_add('00000000-0000-4000-8000-0000000089a3', 'plan', v_m, 'الرد في نفس اليوم على كل الرسايل', now() + interval '30 days');
  r := public.hr_member_note_add('00000000-0000-4000-8000-0000000089a3', 'meeting', to_char(public.hr_today(), 'YYYY') || '-Q' || to_char(public.hr_today(), 'Q'), 'نراجع التقييم', now() + interval '2 days');
  if r ->> 'ticket' is null then raise exception 'case a meeting opens a team request failed'; end if;
  insert into hn values ('ticket', r ->> 'ticket');
  r := public.hr_member_note_add('00000000-0000-4000-8000-0000000089a3', 'thanks', v_m);
end $$;
reset role;
do $$ begin
  if (select count(*) from public.hr_notes_log where member_id = '00000000-0000-4000-8000-0000000089a3') <> 4 then raise exception 'case four notes written failed'; end if;
  if exists (select 1 from public.hr_notes_log where member_id = '00000000-0000-4000-8000-0000000089a3' and by_id <> '00000000-0000-4000-8000-0000000089a2') then raise exception 'case the writer is the caller failed'; end if;
  -- the request: to the member's role, the time only — no agenda, no rating
  if not exists (select 1 from public.tickets t where t.id = (select v::bigint from hn where k = 'ticket') and t.type = 'internal' and t.assignee_role = 'خدمة العملاء'
                 and t.follow_up is not null and t.title like 'ميتنج فردي — %' and position('نراجع' in t.description) = 0 and position('تقييم' in t.title || t.description) = 0) then
    raise exception 'case the meeting request carries the time only failed';
  end if;
  -- the bell: one per note, to the member only
  if (select count(*) from public.alerts where kind = 'hr.note' and user_id = '00000000-0000-4000-8000-0000000089a3') <> 4
     or exists (select 1 from public.alerts where kind = 'hr.note' and (role_id is not null or user_id <> '00000000-0000-4000-8000-0000000089a3')) then
    raise exception 'case the bell rings the member only failed';
  end if;
  if not exists (select 1 from public.alerts where kind = 'hr.note' and entity = 'profile-performance')
     or not exists (select 1 from public.alerts where kind = 'hr.note' and entity like 'tickets/TKT-%') then raise exception 'case the bell links failed'; end if;
  -- the log: the kind and the period, no text
  if not exists (select 1 from public.activity_log where action = 'hr.note.add' and entity_id = '00000000-0000-4000-8000-0000000089a3')
     or exists (select 1 from public.activity_log where action = 'hr.note.add' and new_value::text like '%الأوردرات%') then raise exception 'case the log carries no text failed'; end if;
end $$;

-- ================================================================ who reads: the member, the manager, the admin — not another member
select pg_temp.as_member('00000000-0000-4000-8000-0000000089a3');
do $$ begin
  if (select count(*) from public.hr_notes_log) <> 4 then raise exception 'case the member reads their notes failed'; end if;
end $$;
select pg_temp.as_member('00000000-0000-4000-8000-0000000089a4');
do $$ begin
  if exists (select 1 from public.hr_notes_log where member_id = '00000000-0000-4000-8000-0000000089a3') then raise exception 'case another member reads nothing failed'; end if;
end $$;
select pg_temp.as_member('00000000-0000-4000-8000-0000000089a1');
do $$ begin
  if (select count(*) from public.hr_notes_log where member_id = '00000000-0000-4000-8000-0000000089a3') <> 4 then raise exception 'case the admin reads all failed'; end if;
end $$;

-- ================================================================ who writes: never oneself, never a stranger; the inputs checked
select pg_temp.as_member('00000000-0000-4000-8000-0000000089a3');
do $$ begin
  begin perform public.hr_member_note_add('00000000-0000-4000-8000-0000000089a3', 'thanks', to_char(public.hr_today(), 'YYYY-MM')); raise exception 'case a note on oneself failed';
  exception when insufficient_privilege then null; end;
  begin perform public.hr_member_note_add('00000000-0000-4000-8000-0000000089a4', 'warning', to_char(public.hr_today(), 'YYYY-MM'), 'x'); raise exception 'case a member writes on another failed';
  exception when insufficient_privilege then null; end;
  begin insert into public.hr_notes_log (member_id, kind, period, body) values ('00000000-0000-4000-8000-0000000089a4', 'thanks', '2026-01', 'x'); raise exception 'case a direct insert failed';
  exception when insufficient_privilege then null; end;
end $$;
select pg_temp.as_member('00000000-0000-4000-8000-0000000089a1');
do $$
declare v_m text := to_char(public.hr_today(), 'YYYY-MM');
begin
  begin perform public.hr_member_note_add('00000000-0000-4000-8000-0000000089a1', 'thanks', v_m); raise exception 'case the admin on themself failed';
  exception when insufficient_privilege then null; end;
  begin perform public.hr_member_note_add('00000000-0000-4000-8000-0000000089a4', 'warning', v_m); raise exception 'case a warning needs its reason failed';
  exception when sqlstate '22023' then null; end;
  begin perform public.hr_member_note_add('00000000-0000-4000-8000-0000000089a4', 'plan', v_m, '   '); raise exception 'case a plan needs its goals failed';
  exception when sqlstate '22023' then null; end;
  begin perform public.hr_member_note_add('00000000-0000-4000-8000-0000000089a4', 'meeting', v_m); raise exception 'case a meeting needs its time failed';
  exception when sqlstate '22023' then null; end;
  begin perform public.hr_member_note_add('00000000-0000-4000-8000-0000000089a4', 'meeting', v_m, null, now() - interval '1 day'); raise exception 'case a meeting in the past failed';
  exception when sqlstate '22023' then null; end;
  begin perform public.hr_member_note_add('00000000-0000-4000-8000-0000000089a4', 'bonus', v_m); raise exception 'case an unknown kind failed';
  exception when sqlstate '22023' then null; end;
  begin perform public.hr_member_note_add('00000000-0000-4000-8000-0000000089a4', 'thanks', '2099-01'); raise exception 'case a future month failed';
  exception when sqlstate '22023' then null; end;
  begin perform public.hr_member_note_add('00000000-0000-4000-8000-0000000089a4', 'thanks', '2026-13'); raise exception 'case a broken period failed';
  exception when sqlstate '22023' then null; end;
  begin perform public.hr_member_note_add('00000000-0000-4000-8000-0000000089a4', 'thanks', v_m, repeat('x', 1001)); raise exception 'case a long text failed';
  exception when sqlstate '22023' then null; end;
  begin perform public.hr_member_note_add('00000000-0000-4000-8000-000000000000', 'thanks', v_m); raise exception 'case an unknown member failed';
  exception when sqlstate 'P0002' then null; end;
  -- the admin on anyone else: fine, and a thanks with no text
  perform public.hr_member_note_add('00000000-0000-4000-8000-0000000089a4', 'thanks', v_m);
end $$;
reset role;

do $$ begin raise notice 'rls_hr_notes: ok'; end $$;
rollback;
