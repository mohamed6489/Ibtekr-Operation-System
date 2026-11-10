-- Tests for 0068_hr_flex (phase 13 decision 24 — flexible hours: several sessions a day, the day's hours summed, overtime past 8 hours
-- of the day, a rest day's ×2 row growing, hr_attendance_close for one session, the hand entry replacing the day, «تصحيح انصراف» on the
-- open session only). Depends on 0001_identity … 0068_hr_flex. Runs in one transaction and rolls back; prints NOTICE 'rls_hr_flex: ok'
-- only if every case passed. Live-safe: its made-up members and rows are rolled back. The days are fixed: D a Monday, R a Friday.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000068a1', 'fx-adm.dev@ibtekr.local', '01000068a01'),
  ('00000000-0000-4000-8000-0000000068a3', 'fx-rep.dev@ibtekr.local', '01000068a03');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u where u.email like 'fx-%.dev@ibtekr.local';
insert into public.profiles (id, name, email, phone, role_id, status, manager_id) values
  ('00000000-0000-4000-8000-0000000068a1', 'أدمن المرونة', 'fx-adm.dev@ibtekr.local', '01000068a01', 'admin', 'active', null),
  ('00000000-0000-4000-8000-0000000068a3', 'عضو مرن', 'fx-rep.dev@ibtekr.local', '01000068a03', 'cs', 'active', null);

create temp table fx (k text primary key, v text) on commit drop;
grant all on fx to authenticated;
insert into fx values ('D', '2026-11-02'), ('R', '2026-11-06');

-- a session of the member opened through the clock, then (as the server) moved to a day and a start
create or replace function pg_temp.fx_open(p_key text) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000068a3","role":"authenticated"}', true);
  insert into fx values (p_key, public.hr_clock_in() ->> 'id');
  reset role;
end $$;
create or replace function pg_temp.fx_move(p_key text, p_day text, p_ago interval) returns void language sql as $$
  update public.hr_attendance set day = (select v::date from fx where k = p_day), in_at = now() - p_ago where id = (select v::bigint from fx where k = p_key)
$$;

-- ================================================================ two sessions on a working day: the hours summed, the overtime past 8 hours of the DAY

select pg_temp.fx_open('s1');
select pg_temp.fx_move('s1', 'D', interval '5 hours');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000068a3","role":"authenticated"}', true);
do $$
declare r jsonb;
begin
  r := public.hr_clock_out();
  if (r ->> 'worked')::int not between 299 and 301 or (r ->> 'overtime')::int <> 0 then raise exception 'case the first session is 5 hours failed (%)', r; end if;
  -- «ابدأ الدوام» again: a new session (no «ended»)
  insert into fx values ('s2', public.hr_clock_in() ->> 'id');
  if (select v from fx where k = 's2') is null or (select v from fx where k = 's2') = (select v from fx where k = 's1') then raise exception 'case a second start opens a new session failed'; end if;
  if (public.hr_clock_in() ->> 'id') <> (select v from fx where k = 's2') then raise exception 'case a start while one is open returns it failed'; end if;
end $$;
reset role;
select pg_temp.fx_move('s2', 'D', interval '4 hours');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000068a3","role":"authenticated"}', true);
do $$
declare s jsonb; r jsonb; o public.hr_overtime;
begin
  s := public.hr_shift_now();
  if s ->> 'id' <> (select v from fx where k = 's2') or (s ->> 'done')::int not between 299 and 301 or (s ->> 'sessions')::int <> 2 then
    raise exception 'case the open session comes with the day''s other closed minutes failed (%)', s;
  end if;
  r := public.hr_clock_out('جهزت أوردرات الشحن');
  if (r ->> 'worked')::int not between 239 and 241 or (r ->> 'day_total')::int not between 538 and 542 then raise exception 'case the day total is the sum of the sessions failed (%)', r; end if;
  if (r ->> 'overtime')::int not between 58 and 62 then raise exception 'case the overtime is only the part past 8 hours of the day failed (%)', r; end if;
  select * into o from public.hr_overtime where id = (r ->> 'overtime_id')::bigint;
  if o.kind <> 'hours' or o.day <> (select v::date from fx where k = 'D') or o.end_at - o.start_at not between interval '58 minutes' and interval '62 minutes' then
    raise exception 'case the overtime row is this session''s tail failed';
  end if;
  if (select count(*) from public.hr_attendance where member_id = auth.uid() and day = (select v::date from fx where k = 'D')) <> 2 then
    raise exception 'case two rows on one day are kept failed';
  end if;
end $$;
reset role;

-- a session under 8 hours of the day with a note writes no overtime
select pg_temp.fx_open('s0');
update public.hr_attendance set day = '2026-11-03', in_at = now() - interval '3 hours' where id = (select v::bigint from fx where k = 's0');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000068a3","role":"authenticated"}', true);
do $$
declare r jsonb;
begin
  r := public.hr_clock_out('ملاحظة');
  if r ->> 'overtime_id' is not null or (r ->> 'overtime')::int <> 0 then raise exception 'case no overtime under 8 hours of the day failed (%)', r; end if;
end $$;
reset role;

-- ================================================================ a rest day: one ×2 row growing with each session

select pg_temp.fx_open('r1');
select pg_temp.fx_move('r1', 'R', interval '2 hours');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000068a3","role":"authenticated"}', true);
do $$ declare r jsonb; begin
  r := public.hr_clock_out();
  if not coalesce((r ->> 'rest_day')::boolean, false) or r ->> 'overtime_id' is null then raise exception 'case a rest-day session writes the ×2 row failed (%)', r; end if;
  insert into fx values ('rot', r ->> 'overtime_id');
end $$;
reset role;
select pg_temp.fx_open('r2');
select pg_temp.fx_move('r2', 'R', interval '1 hour');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000068a3","role":"authenticated"}', true);
do $$ declare r jsonb; begin
  r := public.hr_clock_out();
  if r ->> 'overtime_id' <> (select v from fx where k = 'rot') then raise exception 'case the second rest-day session reuses the row failed (%)', r; end if;
  if (select minutes from public.hr_overtime where id = (select v::bigint from fx where k = 'rot')) not between 178 and 182 then raise exception 'case the rest-day row grows with each session failed'; end if;
  if (select count(*) from public.hr_overtime where member_id = auth.uid() and kind = 'rest_day') <> 1 then raise exception 'case one rest-day row a day failed'; end if;
end $$;

-- ================================================================ hr_attendance_close: hr.edit F only, one open session

do $$ begin
  insert into fx values ('s5', public.hr_clock_in() ->> 'id');
  begin perform public.hr_attendance_close((select v::bigint from fx where k = 's5')); raise exception 'case a member cannot close by hand failed';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000068a1","role":"authenticated"}', true);
do $$ begin
  perform public.hr_attendance_close((select v::bigint from fx where k = 's5'), null, 'إنهاء الدوام — أدمن المرونة');
  if (select out_at from public.hr_attendance where id = (select v::bigint from fx where k = 's5')) is null then raise exception 'case the admin closes one session failed'; end if;
  if (select source from public.hr_attendance where id = (select v::bigint from fx where k = 's5')) <> 'fix' then raise exception 'case a hand close is «fix» failed'; end if;
  begin perform public.hr_attendance_close((select v::bigint from fx where k = 's5')); raise exception 'case a closed session needs a time failed';
  exception when invalid_parameter_value then null; end;
  begin perform public.hr_attendance_close(-1); raise exception 'case an unknown session failed'; exception when no_data_found then null; end;
  if (select out_at from public.hr_attendance where id = (select v::bigint from fx where k = 's1')) is null then raise exception 'case other sessions are untouched failed'; end if;
end $$;

-- a corrected end of a closed session (the typed time after an approved request): s5 moved to a fixed day, 10:00–12:00 → 13:00
reset role;
update public.hr_attendance set day = '2026-11-04', in_at = public.hr_at('2026-11-04', '10:00'), out_at = public.hr_at('2026-11-04', '12:00')
where id = (select v::bigint from fx where k = 's5');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000068a1","role":"authenticated"}', true);
do $$ begin
  perform public.hr_attendance_close((select v::bigint from fx where k = 's5'), '13:00');
  if (select out_at from public.hr_attendance where id = (select v::bigint from fx where k = 's5')) <> public.hr_at('2026-11-04', '13:00') then
    raise exception 'case a closed session''s end is corrected failed';
  end if;
end $$;

-- ================================================================ «تصحيح انصراف» closes the day's open session only

reset role;
select pg_temp.fx_open('s6');
update public.hr_attendance set day = (select v::date from fx where k = 'D'), in_at = public.hr_at((select v::date from fx where k = 'D'), '18:00')
where id = (select v::bigint from fx where k = 's6');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000068a3","role":"authenticated"}', true);
do $$ begin
  insert into fx values ('fix', public.hr_request_create(jsonb_build_object('type', 'تصحيح انصراف', 'from', (select v from fx where k = 'D'), 'time', '20:00'))::text);
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000068a1","role":"authenticated"}', true);
do $$
declare v_s1 timestamptz;
begin
  select out_at into v_s1 from public.hr_attendance where id = (select v::bigint from fx where k = 's1');
  perform public.hr_request_decide((select v::bigint from fx where k = 'fix'), 'موافق');
  if (select out_at from public.hr_attendance where id = (select v::bigint from fx where k = 's6')) <> public.hr_at((select v::date from fx where k = 'D'), '20:00') then
    raise exception 'case the approved fix closes the open session at its time failed';
  end if;
  if (select out_at from public.hr_attendance where id = (select v::bigint from fx where k = 's1')) <> v_s1 then raise exception 'case the fix leaves the closed sessions alone failed'; end if;

-- ================================================================ the hand entry replaces the day with one session

  perform public.hr_attendance_set('00000000-0000-4000-8000-0000000068a3', (select v::date from fx where k = 'D'), '09:00', '17:00', false, 'يوم بالإيد');
  if (select count(*) from public.hr_attendance where member_id = '00000000-0000-4000-8000-0000000068a3' and day = (select v::date from fx where k = 'D')) <> 1 then
    raise exception 'case the hand entry leaves one session for the day failed';
  end if;
  if (select sum(extract(epoch from (out_at - in_at)) / 60) from public.hr_attendance where member_id = '00000000-0000-4000-8000-0000000068a3'
      and day = (select v::date from fx where k = 'D')) <> 480 then raise exception 'case the hand day is 8 hours failed'; end if;
  begin perform public.hr_day_done(auth.uid(), current_date, null); raise exception 'case the helper is the server''s failed';
  exception when insufficient_privilege then null; end;
end $$;

-- ================================================================ the grants: the helpers are the server's, the close is the members' (with hr.edit F)

reset role;
do $$ begin
  if has_function_privilege('authenticated', 'public.hr_day_done(uuid, date, bigint)', 'execute')
     or has_function_privilege('authenticated', 'public.hr_rest_day_add(uuid, date, timestamptz, timestamptz, text)', 'execute')
     or has_function_privilege('anon', 'public.hr_attendance_close(bigint, time, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.hr_attendance_close(bigint, time, text)', 'execute') then
    raise exception 'case the grants of 0068 failed';
  end if;
  if exists (select 1 from pg_constraint where conrelid = 'public.hr_attendance'::regclass and contype = 'u') then raise exception 'case the one-row-a-day rule is gone failed'; end if;
  raise notice 'rls_hr_flex: ok';
end $$;

rollback;
