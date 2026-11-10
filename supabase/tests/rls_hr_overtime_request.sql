-- Tests for 0073_hr_overtime_request (phase 13 decision 44 — «طلب وقت إضافي» from the account menu: the member asks for overtime they
-- worked; a «مستني» hr_overtime row with its request ticket; the admins, the direct manager and the hr.approve F people hear of it; never
-- twice for the same time; a rest day / holiday is the admins' only). Depends on 0001_identity … 0073. Runs in one transaction and rolls
-- back; prints NOTICE 'rls_hr_overtime_request: ok' only if every case passed. Live-safe: its made-up members and rows are rolled back.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000073a1', 'or-adm.dev@ibtekr.local', '01000073a01'),
  ('00000000-0000-4000-8000-0000000073a2', 'or-mgr.dev@ibtekr.local', '01000073a02'),
  ('00000000-0000-4000-8000-0000000073a3', 'or-rep.dev@ibtekr.local', '01000073a03'),
  ('00000000-0000-4000-8000-0000000073a4', 'or-apr.dev@ibtekr.local', '01000073a04'),
  ('00000000-0000-4000-8000-0000000073a5', 'or-oth.dev@ibtekr.local', '01000073a05');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u where u.email like 'or-%.dev@ibtekr.local';
insert into public.profiles (id, name, email, phone, role_id, status, manager_id, custom_perms) values
  ('00000000-0000-4000-8000-0000000073a1', 'أدمن الطلبات', 'or-adm.dev@ibtekr.local', '01000073a01', 'admin', 'active', null, null),
  ('00000000-0000-4000-8000-0000000073a2', 'مدير الطلبات', 'or-mgr.dev@ibtekr.local', '01000073a02', 'ops', 'active', null, null),
  ('00000000-0000-4000-8000-0000000073a3', 'عضو الطلبات', 'or-rep.dev@ibtekr.local', '01000073a03', 'cs', 'active', '00000000-0000-4000-8000-0000000073a2', null),
  ('00000000-0000-4000-8000-0000000073a4', 'موافق الطلبات', 'or-apr.dev@ibtekr.local', '01000073a04', 'cs', 'active', null, '{"hr.approve":"F","hr.view":"F"}'::jsonb),
  ('00000000-0000-4000-8000-0000000073a5', 'عضو تاني', 'or-oth.dev@ibtekr.local', '01000073a05', 'cs', 'active', null, null);

create temp table orq (k text primary key, v text) on commit drop;
grant all on orq to authenticated;
-- W: the latest working day before today (not a Friday / Saturday, not a holiday); R: the latest Friday before today
insert into orq values
  ('W', (select d::date from generate_series(public.hr_today() - 1, public.hr_today() - 10, interval '-1 day') d where not public.hr_rest_day(d::date) limit 1)::text),
  ('R', (select d::date from generate_series(public.hr_today() - 1, public.hr_today() - 7, interval '-1 day') d where extract(isodow from d) = 5 limit 1)::text);

create or replace function pg_temp.as_member(p_uid text) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;

-- ================================================================ the member asks; bad input refused; never twice for the same time

select pg_temp.as_member('00000000-0000-4000-8000-0000000073a3');
do $$
declare r jsonb; w date := (select v::date from orq where k = 'W');
begin
  begin perform public.hr_overtime_request(public.hr_today() + 1, '18:00', '20:00', 'جرد'); raise exception 'case a future day failed';
  exception when sqlstate '22023' then if sqlerrm <> 'invalid: day' then raise; end if; end;
  begin perform public.hr_overtime_request(public.hr_today() - 40, '18:00', '20:00', 'جرد'); raise exception 'case older than 31 days failed';
  exception when sqlstate '22023' then if sqlerrm <> 'invalid: day' then raise; end if; end;
  begin perform public.hr_overtime_request(w, '6pm', '20:00', 'جرد'); raise exception 'case a bad time failed';
  exception when sqlstate '22023' then if sqlerrm <> 'invalid: from' then raise; end if; end;
  begin perform public.hr_overtime_request(w, '18:00', '18:10', 'جرد'); raise exception 'case under 15 minutes failed';
  exception when sqlstate '22023' then if sqlerrm <> 'invalid: minutes' then raise; end if; end;
  begin perform public.hr_overtime_request(w, '20:00', '18:00', 'جرد'); raise exception 'case the end before the start failed';
  exception when sqlstate '22023' then if sqlerrm <> 'invalid: minutes' then raise; end if; end;
  begin perform public.hr_overtime_request(w, '18:00', '20:00', '  '); raise exception 'case no note failed';
  exception when sqlstate '22023' then if sqlerrm <> 'invalid: note' then raise; end if; end;
  r := public.hr_overtime_request(w, '18:00', '20:30', 'جرد المخزن');
  if (r ->> 'minutes')::int <> 150 or (r ->> 'rest_day')::boolean or r ->> 'ticket' is null then raise exception 'case the request failed (%)', r; end if;
  insert into orq values ('ot', r ->> 'id'), ('tk', r ->> 'ticket');
  begin perform public.hr_overtime_request(w, '19:00', '21:00', 'تاني'); raise exception 'case an overlapping request failed';
  exception when sqlstate '22023' then if sqlerrm <> 'invalid: overlap' then raise; end if; end;
  -- the same day, another time is fine
  perform public.hr_overtime_request(w, '21:00', '21:30', 'تقفيل');
end $$;
reset role;

do $$
declare o public.hr_overtime; t public.tickets; tk bigint := (select v::bigint from orq where k = 'tk');
begin
  select * into o from public.hr_overtime where id = (select v::bigint from orq where k = 'ot');
  if o.status <> 'مستني' or o.kind <> 'hours' or o.minutes <> 150 or o.ticket_id <> tk or o.note <> 'جرد المخزن' then raise exception 'case the hr_overtime row failed'; end if;
  if (o.start_at at time zone 'Africa/Cairo')::time <> '18:00' then raise exception 'case Cairo times failed'; end if;
  select * into t from public.tickets where id = tk;
  if t.assignee_role <> (public.ticket_role_labels('ops'))[1] or t.status <> 'open' or t.created_by <> '00000000-0000-4000-8000-0000000073a3' then raise exception 'case the ticket to the direct manager''s role failed'; end if;
  -- the bell: the admins, the direct manager, the hr.approve F person — not anyone else; «طلب وقت إضافي»; nothing of the note
  if not exists (select 1 from public.alerts where entity_id = 'ot:' || tk and role_id = 'admin' and title like '%طلب وقت إضافي%')
     or not exists (select 1 from public.alerts where entity_id = 'ot:' || tk and user_id = '00000000-0000-4000-8000-0000000073a2')
     or not exists (select 1 from public.alerts where entity_id = 'ot:' || tk and user_id = '00000000-0000-4000-8000-0000000073a4' and entity = 'hr-requests')
     or exists (select 1 from public.alerts where entity_id = 'ot:' || tk and user_id in ('00000000-0000-4000-8000-0000000073a5', '00000000-0000-4000-8000-0000000073a3')) then
    raise exception 'case the bell failed';
  end if;
  if exists (select 1 from public.alerts where entity_id = 'ot:' || tk and (coalesce(title, '') || coalesce(body, '')) like '%جرد%')
     or exists (select 1 from public.ticket_events where ticket_id = tk and coalesce(text, '') like '%جرد%')
     or (select coalesce(title, '') || coalesce(description, '') from public.tickets where id = tk) like '%جرد%' then
    raise exception 'case the ticket and the bell carry no note failed';
  end if;
end $$;

-- ================================================================ an hr.approve F member decides it; the ticket closes

select pg_temp.as_member('00000000-0000-4000-8000-0000000073a4');
do $$ begin
  if public.hr_overtime_decide((select v::bigint from orq where k = 'ot'), 'add') <> 'اتضاف' then raise exception 'case the approver adds it failed'; end if;
end $$;
reset role;
do $$ begin
  if (select status from public.tickets where id = (select v::bigint from orq where k = 'tk')) <> 'closed' then raise exception 'case the ticket closes failed'; end if;
end $$;

-- ================================================================ a rest day: to «مدير النظام», the admins only; once a day

select pg_temp.as_member('00000000-0000-4000-8000-0000000073a3');
do $$
declare r jsonb; d date := (select v::date from orq where k = 'R');
begin
  r := public.hr_overtime_request(d, '10:00', '14:00', 'شغل الجمعة');
  if not (r ->> 'rest_day')::boolean then raise exception 'case a Friday is a rest day failed'; end if;
  insert into orq values ('rot', r ->> 'id'), ('rtk', r ->> 'ticket');
  begin perform public.hr_overtime_request(d, '16:00', '17:00', 'تاني'); raise exception 'case a second rest-day request failed';
  exception when sqlstate '22023' then if sqlerrm <> 'invalid: overlap' then raise; end if; end;
end $$;
reset role;
do $$
declare tk bigint := (select v::bigint from orq where k = 'rtk');
begin
  if (select kind from public.hr_overtime where id = (select v::bigint from orq where k = 'rot')) <> 'rest_day'
     or (select assignee_role from public.tickets where id = tk) <> 'مدير النظام' then raise exception 'case the rest day row and ticket failed'; end if;
  if exists (select 1 from public.alerts where entity_id = 'ot:' || tk and user_id is not null) then raise exception 'case a rest day rings the admins only failed'; end if;
end $$;
select pg_temp.as_member('00000000-0000-4000-8000-0000000073a4');
do $$ begin
  begin perform public.hr_overtime_decide((select v::bigint from orq where k = 'rot'), 'add'); raise exception 'case only an admin decides a rest day failed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ================================================================ grants

do $$ begin
  if has_function_privilege('anon', 'public.hr_overtime_request(date, text, text, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.hr_overtime_request(date, text, text, text)', 'execute') then
    raise exception 'case the grants of 0073 failed';
  end if;
  raise notice 'rls_hr_overtime_request: ok';
end $$;
rollback;
