-- Tests for 0083_hr_rebuild (the owner, 12 Nov — the HR page rebuilt: the evaluation out of 5, the bonus month by month (whole or
-- nothing), the advance off the month's salary, «تحويل المرتبات» in one step with the early pay / the advance / the overtime fix per
-- member, the annual leave settled with December or carried). Depends on 0001_identity … 0083. Runs in one transaction and rolls back;
-- prints NOTICE 'rls_hr_rebuild: ok' only if every case passed. Live-safe: its made-up members, rows and settings are rolled back.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000083b1', 'hrr-adm.dev@ibtekr.local', '010000083b1'),
  ('00000000-0000-4000-8000-0000000083b2', 'hrr-mgr.dev@ibtekr.local', '010000083b2'),
  ('00000000-0000-4000-8000-0000000083b3', 'hrr-rep.dev@ibtekr.local', '010000083b3'),
  ('00000000-0000-4000-8000-0000000083b4', 'hrr-oth.dev@ibtekr.local', '010000083b4');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u where u.email like 'hrr-%.dev@ibtekr.local';
insert into public.profiles (id, name, email, phone, role_id, status, manager_id) values
  ('00000000-0000-4000-8000-0000000083b1', 'أدمن إعادة البناء', 'hrr-adm.dev@ibtekr.local', '010000083b1', 'admin', 'active', null),
  ('00000000-0000-4000-8000-0000000083b2', 'مدير إعادة البناء', 'hrr-mgr.dev@ibtekr.local', '010000083b2', 'ops', 'active', null),
  ('00000000-0000-4000-8000-0000000083b3', 'عضو إعادة البناء', 'hrr-rep.dev@ibtekr.local', '010000083b3', 'cs', 'active', '00000000-0000-4000-8000-0000000083b2'),
  ('00000000-0000-4000-8000-0000000083b4', 'عضو تاني للبناء', 'hrr-oth.dev@ibtekr.local', '010000083b4', 'cs', 'active', null);
insert into public.hr_pay (member_id, salary, holdback, allowances) values ('00000000-0000-4000-8000-0000000083b3', 9600, 1200, 0);
insert into public.hr_members (member_id, leave_days, hire_date) values ('00000000-0000-4000-8000-0000000083b3', 21, '2025-01-01');
insert into public.settings (section, data) values ('hr', '{}') on conflict (section) do nothing;
update public.settings set data = data - 'bonusMin' - 'leaveYearEnd' - 'payDay' where section = 'hr';

create or replace function pg_temp.as_member(p_uid text) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;
create temp table hrr (k text primary key, v text) on commit drop;
grant all on hrr to authenticated;

-- ================================================================ grants
do $$ begin
  if has_function_privilege('anon', 'public.hr_evaluate(uuid, date, int, int, text)', 'execute') or has_function_privilege('anon', 'public.hr_payroll_transfer(date, text)', 'execute')
     or has_function_privilege('authenticated', 'public.hr_att_score(uuid, date)', 'execute') or has_function_privilege('authenticated', 'public.hr_pay_line(date, uuid, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.hr_leave_roll(int)', 'execute') or has_function_privilege('authenticated', 'public.hr_setting(text, text)', 'execute')
     or has_table_privilege('authenticated', 'public.hr_evaluations', 'INSERT') or has_table_privilege('authenticated', 'public.hr_payroll_paid', 'INSERT')
     or has_table_privilege('authenticated', 'public.hr_ot_adjust', 'INSERT') then
    raise exception 'case the writes go through the functions only failed';
  end if;
end $$;

-- ================================================================ the requests tab is gone: no function sends the reader there
do $$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosrc like '%«الموارد البشرية › الطلبات»%') then
    raise exception 'case no text points at the removed requests tab failed';
  end if;
  if not exists (select 1 from pg_proc where proname = 'hr_overtime_decide' and prosrc like '%''اترفض الوقت الإضافي''%') then raise exception 'case the rejection event stays failed'; end if;
end $$;

-- ================================================================ the attendance score (by the days) — February 2026, no leave
do $$
declare req int; v numeric;
begin
  select count(*) into req from generate_series('2026-02-01'::date, '2026-02-28'::date, interval '1 day') g(d)
   where extract(isodow from g.d) not in (5, 6) and g.d::date not in (select public.hr_holiday_days());
  insert into public.hr_attendance (member_id, day, in_at, out_at)
  select '00000000-0000-4000-8000-0000000083b3', g.d::date, g.d + interval '9 hours', g.d + interval '17 hours'
  from (select d from generate_series('2026-02-01'::date, '2026-02-28'::date, interval '1 day') d where extract(isodow from d) not in (5, 6) and d::date not in (select public.hr_holiday_days()) order by d limit 10) g;
  v := public.hr_att_score('00000000-0000-4000-8000-0000000083b3', '2026-02-10');
  if v is distinct from round(least(1, 10::numeric / req) * 10) / 2 then raise exception 'case the attendance score by the days failed (% of %: %)', 10, req, v; end if;
  if public.hr_att_score('00000000-0000-4000-8000-0000000083b3', '2099-01-01') is not null then raise exception 'case a month with no day asked = null failed'; end if;
  if public.hr_eval_total(null, 4, 5) <> 4.5 or public.hr_eval_total(3, 3, 3) <> 3 or public.hr_eval_total(4, null, 5) is not null then raise exception 'case the month''s total = the average failed'; end if;
end $$;

-- ================================================================ the evaluation: the manager rates the report, never others or oneself
select pg_temp.as_member('00000000-0000-4000-8000-0000000083b2');
do $$ begin
  perform public.hr_evaluate('00000000-0000-4000-8000-0000000083b3', '2026-01-15', 5, 5, 'شغل كويس');
  begin perform public.hr_evaluate('00000000-0000-4000-8000-0000000083b4', '2026-01-01', 4, 4); raise exception 'case a manager rates their team only failed';
  exception when insufficient_privilege then null; end;
  begin perform public.hr_evaluate('00000000-0000-4000-8000-0000000083b2', '2026-01-01', 5, 5); raise exception 'case nobody rates themself failed';
  exception when insufficient_privilege then null; end;
  begin perform public.hr_evaluate('00000000-0000-4000-8000-0000000083b3', '2026-01-01', 6, 5); raise exception 'case 1–5 failed';
  exception when invalid_parameter_value then null; end;
  begin perform public.hr_evaluate('00000000-0000-4000-8000-0000000083b3', (public.hr_today() + interval '2 months')::date, 3, 3); raise exception 'case a future month failed';
  exception when invalid_parameter_value then null; end;
  if (select count(distinct l.member_id) from public.hr_evaluations_list('2026-01-01', '2026-01-01') l where l.member_id in ('00000000-0000-4000-8000-0000000083b3', '00000000-0000-4000-8000-0000000083b4')) <> 1 then
    raise exception 'case the manager lists their team only failed';
  end if;
  if (select l.performance from public.hr_evaluations_list('2026-01-01', '2026-01-01') l where l.member_id = '00000000-0000-4000-8000-0000000083b3') <> 5 then raise exception 'case the list carries the rating failed'; end if;
  begin insert into public.hr_evaluations (member_id, month, performance, communication) values ('00000000-0000-4000-8000-0000000083b3', '2026-03-01', 5, 5); raise exception 'case no direct write failed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ================================================================ the admin: February rated low; the quarter's bonus month by month (Jan whole, Feb nothing, Mar not rated)
select pg_temp.as_member('00000000-0000-4000-8000-0000000083b1');
do $$
declare c record;
begin
  perform public.hr_evaluate('00000000-0000-4000-8000-0000000083b3', '2026-02-01', 1, 1);
  select * into c from public.hr_payroll_calc('2026-03-01') x where x.member_id = '00000000-0000-4000-8000-0000000083b3';
  -- January: no attendance → 0 + 5 + 5 = 3.3 ≥ 3 → 1,200; February: (≤ 5 + 1 + 1) / 3 < 3 → 0; March: not rated → 0 and counted missing
  if c.quarter_bonus <> 1200 or c.missing_scores <> 1 then raise exception 'case the bonus whole or nothing by month failed (%, %)', c.quarter_bonus, c.missing_scores; end if;
  select * into c from public.hr_payroll_calc('2026-02-01') x where x.member_id = '00000000-0000-4000-8000-0000000083b3';
  if c.quarter_bonus <> 0 or c.paid <> 8400 then raise exception 'case the holdback is held in the quarter''s other months failed'; end if;
end $$;
reset role;
update public.settings set data = data || '{"bonusMin": 1}' where section = 'hr';
select pg_temp.as_member('00000000-0000-4000-8000-0000000083b1');
do $$ begin
  if (select quarter_bonus from public.hr_payroll_calc('2026-03-01') x where x.member_id = '00000000-0000-4000-8000-0000000083b3') <> 2400 then raise exception 'case the bar is the setting bonusMin failed'; end if;
end $$;
reset role;

-- ================================================================ the advance: decided → all of it off the month; given by the admin → the money out too
insert into public.hr_requests (member_id, type, from_day, to_day, amount, months, status, created_by)
values ('00000000-0000-4000-8000-0000000083b3', 'سُلفة', public.hr_today(), public.hr_today(), 300, 3, 'جديد', '00000000-0000-4000-8000-0000000083b3');
insert into hrr values ('adv1', currval(pg_get_serial_sequence('public.hr_requests', 'id'))::text);
select pg_temp.as_member('00000000-0000-4000-8000-0000000083b1');
do $$
declare v_month date := date_trunc('month', public.hr_today())::date; v_id bigint; v_exp int; v_mov int;
begin
  perform public.hr_request_decide((select v from hrr where k = 'adv1')::bigint, 'موافق');
  if (select advance from public.hr_payroll_calc(v_month) x where x.member_id = '00000000-0000-4000-8000-0000000083b3') <> 300 then raise exception 'case the advance comes off whole failed'; end if;
  select count(*) into v_exp from public.acc_expenses; select count(*) into v_mov from public.acc_account_moves;
  v_id := public.hr_advance_give('00000000-0000-4000-8000-0000000083b3', 500, 'ظرف طارئ', 'حساب البنك');
  if (select advance from public.hr_payroll_calc(v_month) x where x.member_id = '00000000-0000-4000-8000-0000000083b3') <> 800 then raise exception 'case a given advance comes off this month failed'; end if;
  if (select count(*) from public.acc_expenses) <> v_exp + 1 or (select count(*) from public.acc_account_moves) <> v_mov + 1 then raise exception 'case a given advance is money out failed'; end if;
  begin perform public.hr_advance_give('00000000-0000-4000-8000-0000000083b3', 500, '   ', 'حساب البنك'); raise exception 'case an advance needs its reason failed';
  exception when invalid_parameter_value then null; end;
end $$;
reset role;
do $$ begin
  if (select pay_from from public.hr_requests where id = (select v from hrr where k = 'adv1')::bigint) <> date_trunc('month', public.hr_today())::date then raise exception 'case the approved advance has its month failed'; end if;
  if (select count(*) from public.hr_requests where member_id = '00000000-0000-4000-8000-0000000083b3' and type = 'سُلفة' and status = 'موافق' and pay_from is not null) <> 2 then raise exception 'case a given advance is an approved request failed'; end if;
end $$;

-- ================================================================ the overtime fixed by minutes; the manager (no salaries) cannot
select pg_temp.as_member('00000000-0000-4000-8000-0000000083b1');
do $$ begin
  perform public.hr_ot_adjust_add('00000000-0000-4000-8000-0000000083b3', '2026-02-01', 90, 'اتسجل ناقص');
  if (select ot_minutes from public.hr_payroll_calc('2026-02-01') x where x.member_id = '00000000-0000-4000-8000-0000000083b3') <> 90 then raise exception 'case the overtime fix counts failed'; end if;
  perform public.hr_ot_adjust_add('00000000-0000-4000-8000-0000000083b3', '2026-02-01', -500, 'اتسجل غلط');
  if (select ot_minutes from public.hr_payroll_calc('2026-02-01') x where x.member_id = '00000000-0000-4000-8000-0000000083b3') <> 0 then raise exception 'case the overtime never goes below zero failed'; end if;
end $$;
reset role;
select pg_temp.as_member('00000000-0000-4000-8000-0000000083b2');
do $$ begin
  begin perform public.hr_ot_adjust_add('00000000-0000-4000-8000-0000000083b3', '2026-02-01', 30, 'x'); raise exception 'case the overtime fix is the salaries'' failed';
  exception when insufficient_privilege then null; end;
  begin perform public.hr_payroll_transfer('2026-02-01', 'حساب البنك'); raise exception 'case the transfer is the salaries'' failed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ================================================================ the pay: early needs a reason; a member is paid once; the transfer pays the rest
select pg_temp.as_member('00000000-0000-4000-8000-0000000083b1');
do $$
declare v numeric;
begin
  begin perform public.hr_pay_member('2099-06-01', '00000000-0000-4000-8000-0000000083b3', 'حساب البنك'); raise exception 'case an early pay needs its reason failed';
  exception when invalid_parameter_value then null; end;
  v := public.hr_pay_member('2026-02-01', '00000000-0000-4000-8000-0000000083b3', 'حساب البنك');
  if v is null or (select count(*) from public.hr_payroll_paid where month = '2026-02-01' and member_id = '00000000-0000-4000-8000-0000000083b3') <> 1 then raise exception 'case the member is paid failed'; end if;
  begin perform public.hr_pay_member('2026-02-01', '00000000-0000-4000-8000-0000000083b3', 'حساب البنك'); raise exception 'case a member is paid once failed';
  exception when invalid_parameter_value then null; end;
  begin perform public.hr_ot_adjust_add('00000000-0000-4000-8000-0000000083b3', '2026-02-01', 30, 'متأخر'); raise exception 'case no fix after the pay failed';
  exception when invalid_parameter_value then null; end;
  perform public.hr_payroll_transfer('2026-02-01', 'حساب البنك');
  if (select status from public.hr_payroll where month = '2026-02-01') <> 'مدفوع' then raise exception 'case the transfer marks the sheet paid failed'; end if;
  if (select count(*) from public.hr_payroll_paid where month = '2026-02-01' and member_id = '00000000-0000-4000-8000-0000000083b3') <> 1 then raise exception 'case the transfer skips the paid member failed'; end if;
  begin perform public.hr_payroll_transfer('2026-02-01', 'حساب البنك'); raise exception 'case a paid sheet is final failed';
  exception when invalid_parameter_value then null; end;
end $$;
reset role;
select pg_temp.as_member('00000000-0000-4000-8000-0000000083b3');
do $$ begin
  if not exists (select 1 from public.hr_my_slips() s where s.month = '2026-02-01' and s.status = 'مدفوع') then raise exception 'case the member reads their paid slip failed'; end if;
  if exists (select 1 from public.hr_payroll_paid where member_id <> '00000000-0000-4000-8000-0000000083b3') then raise exception 'case a member reads their own payments only failed'; end if;
end $$;
reset role;

-- ================================================================ the annual leave: 2 days used → 19 left; December pays them, or they are carried
insert into public.hr_requests (member_id, type, from_day, to_day, status, created_by) values ('00000000-0000-4000-8000-0000000083b3', 'إجازة سنوية', '2026-03-02', '2026-03-03', 'موافق', '00000000-0000-4000-8000-0000000083b3');
do $$
declare used numeric := public.hr_leave_used('00000000-0000-4000-8000-0000000083b3', 2026);
begin
  if public.hr_leave_left('00000000-0000-4000-8000-0000000083b3', 2026) <> 21 - used then raise exception 'case the leave left failed'; end if;
end $$;
select pg_temp.as_member('00000000-0000-4000-8000-0000000083b1');
do $$
declare c record; left0 numeric;
begin
  select * into c from public.hr_payroll_calc('2026-12-01') x where x.member_id = '00000000-0000-4000-8000-0000000083b3';
  left0 := c.leave_days_paid;
  if left0 < 1 or c.leave_pay <> round(9600 / 24.0 * left0, 2) then raise exception 'case December pays the leave left failed (%, %)', left0, c.leave_pay; end if;
  if (select leave_pay from public.hr_payroll_calc('2026-11-01') x where x.member_id = '00000000-0000-4000-8000-0000000083b3') <> 0 then raise exception 'case only December settles failed'; end if;
end $$;
reset role;
update public.settings set data = data || '{"leaveYearEnd": "carry"}' where section = 'hr';
select pg_temp.as_member('00000000-0000-4000-8000-0000000083b1');
do $$ begin
  if (select leave_pay from public.hr_payroll_calc('2026-12-01') x where x.member_id = '00000000-0000-4000-8000-0000000083b3') <> 0 then raise exception 'case «carry» pays nothing failed'; end if;
end $$;
reset role;
do $$ begin
  perform public.hr_leave_roll(2027);
  if (select leave_carry from public.hr_members where member_id = '00000000-0000-4000-8000-0000000083b3') <> public.hr_leave_left('00000000-0000-4000-8000-0000000083b3', 2026) then raise exception 'case «carry» moves the balance left failed'; end if;
  if public.hr_leave_left('00000000-0000-4000-8000-0000000083b3', 2027) <> 21 + (select leave_carry from public.hr_members where member_id = '00000000-0000-4000-8000-0000000083b3') then raise exception 'case the carried days count next year failed'; end if;
  raise notice 'rls_hr_rebuild: ok';
end $$;

rollback;
