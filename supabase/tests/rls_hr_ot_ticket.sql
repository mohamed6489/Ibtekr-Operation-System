-- Tests for 0069_hr_overtime_ticket (phase 13 decision 25 — overtime goes through a team ticket: «ابدأ وقت إضافي» opens the request
-- ticket for the direct manager's role with a bell alert to the admins and the manager, the session's overtime counts from then (or past
-- 8 hours of the day), it is written with the ticket and nothing is paid before the manager's decision, which closes the ticket; an
-- overtime ended with none closes it; a rest day carries its ticket). Depends on 0001_identity … 0069. Runs in one transaction and rolls
-- back; prints NOTICE 'rls_hr_ot_ticket: ok' only if every case passed. Live-safe: its made-up members and rows are rolled back.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000069a1', 'ot-adm.dev@ibtekr.local', '01000069a01'),
  ('00000000-0000-4000-8000-0000000069a2', 'ot-mgr.dev@ibtekr.local', '01000069a02'),
  ('00000000-0000-4000-8000-0000000069a3', 'ot-rep.dev@ibtekr.local', '01000069a03'),
  ('00000000-0000-4000-8000-0000000069a4', 'ot-other.dev@ibtekr.local', '01000069a04');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u where u.email like 'ot-%.dev@ibtekr.local';
insert into public.profiles (id, name, email, phone, role_id, status, manager_id) values
  ('00000000-0000-4000-8000-0000000069a1', 'أدمن الإضافي', 'ot-adm.dev@ibtekr.local', '01000069a01', 'admin', 'active', null),
  ('00000000-0000-4000-8000-0000000069a2', 'مدير العمليات', 'ot-mgr.dev@ibtekr.local', '01000069a02', 'ops', 'active', null),
  ('00000000-0000-4000-8000-0000000069a3', 'عضو الإضافي', 'ot-rep.dev@ibtekr.local', '01000069a03', 'cs', 'active', '00000000-0000-4000-8000-0000000069a2'),
  ('00000000-0000-4000-8000-0000000069a4', 'زميل حسابات', 'ot-other.dev@ibtekr.local', '01000069a04', 'accounts', 'active', null);

create temp table ot (k text primary key, v text) on commit drop;
grant all on ot to authenticated;

-- the member's session opened through the clock, moved (as the server) to a Monday and a start
create or replace function pg_temp.ot_open(p_key text, p_day date, p_ago interval) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000069a3","role":"authenticated"}', true);
  insert into ot values (p_key, public.hr_clock_in() ->> 'id');
  reset role;
  update public.hr_attendance set day = p_day, in_at = now() - p_ago where id = (select v::bigint from ot where k = p_key);
end $$;
create or replace function pg_temp.as_member(p_uid text) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;

-- ================================================================ «ابدأ وقت إضافي» before 8 hours: the ticket, the alerts, the time from then

select pg_temp.ot_open('s1', '2026-11-02', interval '2 hours');
select pg_temp.as_member('00000000-0000-4000-8000-0000000069a3');
do $$
declare r jsonb; r2 jsonb; t public.tickets;
begin
  r := public.hr_overtime_begin();
  r2 := public.hr_overtime_begin();
  if r ->> 'ticket' is null or r ->> 'ticket' <> r2 ->> 'ticket' then raise exception 'case one ticket for the session failed (% / %)', r, r2; end if;
  insert into ot values ('t1', r ->> 'ticket');
  select * into t from public.tickets where id = (r ->> 'ticket')::bigint;
  if not found then raise exception 'case the member sees the ticket opened in their name failed'; end if;
  if t.type <> 'internal' or t.assignee_role <> 'اللوجستيك والشحن' or t.created_by <> auth.uid() or t.status <> 'open' or t.title not like 'وقت إضافي — عضو الإضافي%' then
    raise exception 'case the ticket goes to the direct manager''s role failed (%, %, %)', t.type, t.assignee_role, t.title;
  end if;
  if (public.hr_shift_now() ->> 'ot_ticket') <> r ->> 'ticket' or public.hr_shift_now() ->> 'ot_from' is null then raise exception 'case the session carries the overtime start failed'; end if;
  begin perform public.hr_ot_ticket(auth.uid(), current_date, false); raise exception 'case the ticket helper is the server''s failed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.alerts where kind = 'hr.overtime' and entity_id = 'ot:' || (select v from ot where k = 't1') and role_id = 'admin') <> 1
     or (select count(*) from public.alerts where kind = 'hr.overtime' and entity_id = 'ot:' || (select v from ot where k = 't1') and user_id = '00000000-0000-4000-8000-0000000069a2') <> 1 then
    raise exception 'case the admins and the direct manager get the bell failed';
  end if;
  if (select entity from public.alerts where entity_id = 'ot:' || (select v from ot where k = 't1') limit 1) <> 'tickets/TKT-' || lpad((select v from ot where k = 't1'), 4, '0') then
    raise exception 'case the alert opens the ticket failed';
  end if;
end $$;
-- the overtime started an hour ago on a session of two hours
update public.hr_attendance set ot_from = now() - interval '1 hour' where id = (select v::bigint from ot where k = 's1');
select pg_temp.as_member('00000000-0000-4000-8000-0000000069a3');
do $$
declare r jsonb; o public.hr_overtime;
begin
  r := public.hr_clock_out('تقفيل شحنة المسا');
  if (r ->> 'overtime')::int not between 59 and 61 or r ->> 'ticket' <> (select v from ot where k = 't1') then raise exception 'case the overtime counts from its start, with the ticket failed (%)', r; end if;
  select * into o from public.hr_overtime where id = (r ->> 'overtime_id')::bigint;
  if o.ticket_id::text <> (select v from ot where k = 't1') or o.status <> 'مستني' or o.paid_minutes <> 0 then raise exception 'case nothing is paid before the decision failed'; end if;
  insert into ot values ('o1', o.id::text);
  if not exists (select 1 from public.ticket_events e where e.ticket_id = o.ticket_id and e.text like 'الوقت الإضافي:%دقيقة%') then
    raise exception 'case the ticket gets the minutes failed';
  end if;
  -- the security review: the ticket is seen by the manager's whole role — no note, no times, no reason in it
  if exists (select 1 from public.ticket_events e where e.ticket_id = o.ticket_id and e.text like '%تقفيل شحنة المسا%') then
    raise exception 'case no HR detail in the ticket failed';
  end if;
  begin perform public.hr_overtime_decide(o.id, 'add'); raise exception 'case a member does not decide their own overtime failed'; exception when insufficient_privilege then null; end;
end $$;

-- ================================================================ a colleague does not see it; the direct manager decides and the ticket closes

select pg_temp.as_member('00000000-0000-4000-8000-0000000069a4');
do $$ begin
  if exists (select 1 from public.tickets where id = (select v::bigint from ot where k = 't1')) then raise exception 'case a colleague of another role (tickets.view P) does not see the ticket failed'; end if;
end $$;
select pg_temp.as_member('00000000-0000-4000-8000-0000000069a2');
do $$
declare t public.tickets;
begin
  if not exists (select 1 from public.tickets where id = (select v::bigint from ot where k = 't1')) then raise exception 'case the manager''s role sees the ticket failed'; end if;
  if public.hr_overtime_decide((select v::bigint from ot where k = 'o1'), 'add', 45) <> 'اتضاف' then raise exception 'case the direct manager adds failed'; end if;
  select * into t from public.tickets where id = (select v::bigint from ot where k = 't1');
  if t.status <> 'closed' or t.resolution_outcome <> 'اتحلت المشكلة' or t.resolution_note <> 'اتضاف 45 دقيقة' or t.closed_by <> auth.uid() then
    raise exception 'case the decision closes the ticket failed (%, %)', t.status, t.resolution_note;
  end if;
  if (select paid_minutes from public.hr_overtime where id = (select v::bigint from ot where k = 'o1')) <> 45 then raise exception 'case the minutes added failed'; end if;
end $$;

-- ================================================================ an overtime ended with none closes its ticket; a refusal closes it too

reset role;
select pg_temp.ot_open('s2', '2026-11-03', interval '1 hour');
select pg_temp.as_member('00000000-0000-4000-8000-0000000069a3');
do $$
declare r jsonb; t text;
begin
  t := public.hr_overtime_begin() ->> 'ticket';
  insert into ot values ('t2', t);
  r := public.hr_clock_out();   -- no note: nothing recorded
  if r ->> 'overtime_id' is not null then raise exception 'case no note, no overtime failed'; end if;
end $$;
reset role;
do $$ begin
  if (select status || '/' || resolution_outcome from public.tickets where id = (select v::bigint from ot where k = 't2')) <> 'closed/مش مشكلة' then
    raise exception 'case an overtime ended with none closes its ticket failed';
  end if;
end $$;
select pg_temp.ot_open('s3', '2026-11-04', interval '3 hours');
update public.hr_attendance set ot_from = now() - interval '30 minutes' where id = (select v::bigint from ot where k = 's3');
select pg_temp.as_member('00000000-0000-4000-8000-0000000069a3');
do $$
declare r jsonb;
begin
  r := public.hr_clock_out('جرد');   -- no ticket opened yet (ot_from set by the server here): one is opened with the overtime
  if r ->> 'ticket' is null or (r ->> 'overtime')::int not between 29 and 31 then raise exception 'case a missing ticket is opened with the overtime failed (%)', r; end if;
  insert into ot values ('o3', r ->> 'overtime_id'), ('t3', r ->> 'ticket');
end $$;
select pg_temp.as_member('00000000-0000-4000-8000-0000000069a2');
do $$ begin
  perform public.hr_overtime_decide((select v::bigint from ot where k = 'o3'), 'reject', null, 'مش متفق عليه');
  if (select status || '/' || resolution_outcome from public.tickets where id = (select v::bigint from ot where k = 't3')) <> 'closed/مش مشكلة' then
    raise exception 'case a refusal closes the ticket failed';
  end if;
  if exists (select 1 from public.ticket_events where ticket_id = (select v::bigint from ot where k = 't3') and text like '%مش متفق عليه%')
     or (select resolution_note from public.tickets where id = (select v::bigint from ot where k = 't3')) like '%مش متفق عليه%' then
    raise exception 'case the refusal reason stays out of the ticket failed';
  end if;
end $$;

-- ================================================================ a rest day: the ×2 row carries the ticket of «ابدأ وقت إضافي»

reset role;
select pg_temp.ot_open('r1', '2026-11-06', interval '2 hours');
select pg_temp.as_member('00000000-0000-4000-8000-0000000069a3');
do $$
declare t text; r jsonb;
begin
  t := public.hr_overtime_begin() ->> 'ticket';
  if (select title from public.tickets where id = t::bigint) not like 'يوم راحة/عطلة — %' then raise exception 'case the rest-day ticket title failed'; end if;
  r := public.hr_clock_out();
  if not coalesce((r ->> 'rest_day')::boolean, false) or r ->> 'ticket' <> t or (select ticket_id::text from public.hr_overtime where id = (r ->> 'overtime_id')::bigint) <> t then
    raise exception 'case the rest-day row carries the ticket failed (%)', r;
  end if;
end $$;

-- ================================================================ the grants

reset role;
do $$ begin
  if has_function_privilege('authenticated', 'public.hr_ot_ticket(uuid, date, boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.hr_ot_event(bigint, text)', 'execute')
     or has_function_privilege('authenticated', 'public.hr_ot_ticket_close(bigint, text, text)', 'execute')
     or has_function_privilege('anon', 'public.hr_overtime_begin()', 'execute')
     or not has_function_privilege('authenticated', 'public.hr_overtime_begin()', 'execute') then
    raise exception 'case the grants of 0069 failed';
  end if;
  raise notice 'rls_hr_ot_ticket: ok';
end $$;

rollback;
