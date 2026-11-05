-- RLS / permission tests for 0046_hr (phase 10 «الموارد البشرية»: the members' HR data and pay, the clock, overtime, requests,
-- ratings and the payroll into the accounts). Depends on 0001_identity … 0046_hr. Runs in one transaction and rolls back; prints
-- NOTICE 'rls_hr: ok' only if every case passed. Live-safe: its made-up members and rows are rolled back.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000046a1', 'hr-adm.dev@ibtekr.local', '01000046a01'),
  ('00000000-0000-4000-8000-0000000046a2', 'hr-mgr.dev@ibtekr.local', '01000046a02'),
  ('00000000-0000-4000-8000-0000000046a3', 'hr-rep.dev@ibtekr.local', '01000046a03'),
  ('00000000-0000-4000-8000-0000000046a4', 'hr-other.dev@ibtekr.local', '01000046a04'),
  ('00000000-0000-4000-8000-0000000046a5', 'hr-view.dev@ibtekr.local', '01000046a05');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u where u.email like 'hr-%.dev@ibtekr.local';
insert into public.profiles (id, name, email, phone, role_id, status, manager_id) values
  ('00000000-0000-4000-8000-0000000046a1', 'أدمن الموارد', 'hr-adm.dev@ibtekr.local', '01000046a01', 'admin', 'active', null),
  ('00000000-0000-4000-8000-0000000046a2', 'مدير العمليات', 'hr-mgr.dev@ibtekr.local', '01000046a02', 'ops', 'active', null),
  ('00000000-0000-4000-8000-0000000046a3', 'عضو تحت المدير', 'hr-rep.dev@ibtekr.local', '01000046a03', 'cs', 'active', '00000000-0000-4000-8000-0000000046a2'),
  ('00000000-0000-4000-8000-0000000046a4', 'عضو تاني', 'hr-other.dev@ibtekr.local', '01000046a04', 'cs', 'active', null),
  ('00000000-0000-4000-8000-0000000046a5', 'مشاهد', 'hr-view.dev@ibtekr.local', '01000046a05', 'viewer', 'active', null);

create temp table hr_ids (k text primary key, v text) on commit drop;
grant all on hr_ids to authenticated;

-- ================================================================ the permissions of 0046

do $$
begin
  if (select permissions ->> 'hr.view' from public.roles where id = 'admin') <> 'F' or (select permissions ->> 'sensitive.salaries' from public.roles where id = 'admin') <> 'F'
     or (select permissions ->> 'hr.view' from public.roles where id = 'ops') <> 'P' or (select permissions ->> 'sensitive.salaries' from public.roles where id = 'accounts') <> 'N'
     or (select permissions ->> 'hr.view' from public.roles where id = 'viewer') <> 'N' then
    raise exception 'case the HR permissions of decision 11 failed';
  end if;
end $$;

-- ================================================================ the admin: the pay and the members' data

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000046a1","role":"authenticated"}', true);
insert into public.hr_pay (member_id, salary, holdback, allowances) values ('00000000-0000-4000-8000-0000000046a3', 9600, 1000, 200);
insert into public.hr_members (member_id, leave_days) values ('00000000-0000-4000-8000-0000000046a3', 21);
insert into public.hr_holidays (name, day) values ('عطلة تجربة', '2026-01-07');
do $$
begin
  if (select updated_by from public.hr_pay where member_id = '00000000-0000-4000-8000-0000000046a3') <> '00000000-0000-4000-8000-0000000046a1' then
    raise exception 'case the pay is stamped with its writer failed';
  end if;
end $$;

-- ================================================================ the manager (hr.view P) sees their team, not the pay

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000046a2","role":"authenticated"}', true);
do $$
begin
  if not public.hr_can_see('00000000-0000-4000-8000-0000000046a3') then raise exception 'case a manager sees their report failed'; end if;
  if public.hr_can_see('00000000-0000-4000-8000-0000000046a4') then raise exception 'case a manager does not see a member outside their team failed'; end if;
  if (select count(*) from public.hr_pay) <> 0 then raise exception 'case the pay is hidden from the manager failed'; end if;
  if (select count(*) from public.hr_members) <> 1 then raise exception 'case the manager reads their report''s HR data failed'; end if;
  begin
    insert into public.hr_pay (member_id, salary) values ('00000000-0000-4000-8000-0000000046a4', 1);
    raise exception 'case only sensitive.salaries writes the pay failed';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.hr_holidays (name, day) values ('عطلة المدير', '2026-02-01');
    raise exception 'case only hr.edit writes the lists failed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ================================================================ the member: own pay, the clock, overtime, requests

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000046a3","role":"authenticated"}', true);
do $$
declare s jsonb; s2 jsonb; r jsonb;
begin
  if (select salary from public.hr_pay where member_id = '00000000-0000-4000-8000-0000000046a3') <> 9600 then raise exception 'case a member reads their own pay failed'; end if;
  if (select count(*) from public.hr_holidays) < 1 or (select count(*) from public.hr_leave_types) < 4 then raise exception 'case the lists are readable failed'; end if;
  s := public.hr_clock_in();
  s2 := public.hr_clock_in();
  if s ->> 'id' is null or s ->> 'id' <> s2 ->> 'id' then raise exception 'case one open shift (a second start returns it) failed'; end if;
  if (public.hr_shift_now() ->> 'id') <> s ->> 'id' then raise exception 'case the open shift comes back after a refresh failed'; end if;
  insert into hr_ids values ('shift', s ->> 'id');
end $$;

-- the shift started 9 hours ago on a working day (as the server; a run on a Friday / Saturday moves it to Thursday)
reset role;
update public.hr_attendance set in_at = now() - interval '9 hours',
  day = public.hr_today() - case extract(isodow from public.hr_today())::int when 5 then 1 when 6 then 2 else 0 end
where id = (select v::bigint from hr_ids where k = 'shift');
insert into hr_ids select 'day', day::text from public.hr_attendance where id = (select v::bigint from hr_ids where k = 'shift');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000046a3","role":"authenticated"}', true);
do $$
declare r jsonb; v_ot bigint;
begin
  r := public.hr_clock_out('جهزت أوردرات الشحن');
  v_ot := (r ->> 'overtime_id')::bigint;
  if v_ot is null or (r ->> 'overtime')::int not between 59 and 61 then raise exception 'case the overtime past 8 hours is recorded failed (%)', r; end if;
  insert into hr_ids values ('ot', v_ot::text);
  if (select v::date from hr_ids where k = 'day') = public.hr_today() then
    begin perform public.hr_clock_in(); raise exception 'case one shift a day failed'; exception when invalid_parameter_value then null; end;
  end if;
  begin perform public.hr_overtime_decide(v_ot, 'add'); raise exception 'case a member does not decide their own overtime failed'; exception when insufficient_privilege then null; end;
  begin perform public.hr_attendance_set('00000000-0000-4000-8000-0000000046a3', public.hr_today(), '08:00'); raise exception 'case only hr.edit sets attendance by hand failed';
  exception when insufficient_privilege then null; end;
  insert into hr_ids values ('leave', public.hr_request_create('{"type":"إجازة سنوية","from":"2026-12-06","to":"2026-12-07","note":"فرح أخويا"}')::text);
  insert into hr_ids values ('adv', public.hr_request_create('{"type":"سُلفة","amount":"6000","months":"3"}')::text);
  insert into hr_ids values ('fix', public.hr_request_create(jsonb_build_object('type', 'تصحيح انصراف', 'from', (select v from hr_ids where k = 'day'), 'time', '23:30'))::text);
  begin perform public.hr_request_create('{"type":"إجازة خيالية"}'); raise exception 'case an unknown type is refused failed'; exception when invalid_parameter_value then null; end;
  begin perform public.hr_request_create('{"type":"سُلفة","amount":"0","months":"3"}'); raise exception 'case an advance needs an amount failed'; exception when invalid_parameter_value then null; end;
  begin perform public.hr_request_create('{"type":"إجازة سنوية","member":"00000000-0000-4000-8000-0000000046a4"}'); raise exception 'case a member files for themselves only failed';
  exception when insufficient_privilege then null; end;
  if (select amount from public.hr_requests_v where code = 'HR-' || lpad((select v from hr_ids where k = 'adv'), 4, '0')) <> 6000 then raise exception 'case a member reads their own advance failed'; end if;
  begin perform 1 from public.hr_requests; raise exception 'case the requests table is closed to members failed'; exception when insufficient_privilege then null; end;
  begin perform public.hr_payroll_calc(public.hr_today()); raise exception 'case the payroll is closed to a member failed'; exception when insufficient_privilege then null; end;
end $$;

-- ================================================================ another member and the viewer see nothing of them

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000046a4","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.hr_attendance) <> 0 or (select count(*) from public.hr_overtime) <> 0 or (select count(*) from public.hr_requests_v) <> 0 or (select count(*) from public.hr_pay) <> 0 then
    raise exception 'case a member outside the team sees nothing of another failed';
  end if;
  begin perform public.hr_overtime_decide((select v::bigint from hr_ids where k = 'ot'), 'add'); raise exception 'case a stranger cannot decide failed'; exception when no_data_found then null; end;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000046a5","role":"authenticated"}', true);
do $$
begin
  if public.hr_can_see('00000000-0000-4000-8000-0000000046a3') or (select count(*) from public.hr_members) <> 0 then raise exception 'case hr.view N sees only themselves failed'; end if;
end $$;

-- ================================================================ the direct manager decides; the advance's amount is masked for them

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000046a2","role":"authenticated"}', true);
do $$
declare v_ot bigint := (select v::bigint from hr_ids where k = 'ot'); v_adv text := (select v from hr_ids where k = 'adv');
begin
  if (select count(*) from public.hr_requests_v) <> 3 then raise exception 'case the manager sees the team''s requests failed'; end if;
  if (select amount from public.hr_requests_v where code = 'HR-' || lpad(v_adv, 4, '0')) is not null then raise exception 'case the advance amount is masked for the manager failed'; end if;
  begin perform public.hr_overtime_decide(v_ot, 'add', 999); raise exception 'case no more minutes than recorded failed'; exception when invalid_parameter_value then null; end;
  if public.hr_overtime_decide(v_ot, 'add', 45) <> 'اتضاف' then raise exception 'case «ضيفه» failed'; end if;
  if (select paid_minutes from public.hr_overtime where id = v_ot) <> 45 then raise exception 'case «ضيفه» with fewer minutes failed'; end if;
  begin perform public.hr_overtime_decide(v_ot, 'reject', null, 'سبب'); raise exception 'case a decided overtime stays failed'; exception when invalid_parameter_value then null; end;
  begin perform public.hr_request_decide((select v::bigint from hr_ids where k = 'leave'), 'مرفوض'); raise exception 'case a refusal needs a reason failed'; exception when invalid_parameter_value then null; end;
  if public.hr_request_decide((select v::bigint from hr_ids where k = 'leave'), 'موافق') <> 'موافق' then raise exception 'case the manager approves the leave failed'; end if;
  perform public.hr_request_decide((select v::bigint from hr_ids where k = 'fix'), 'موافق');
  if (select source from public.hr_attendance where id = (select v::bigint from hr_ids where k = 'shift')) <> 'fix' then raise exception 'case an approved «تصحيح انصراف» closes the day failed'; end if;
end $$;

-- ================================================================ the admin: ratings, rejected overtime → meeting, the payroll into the accounts

-- a Friday of that month worked by the member, waiting for its approval (as the clock would record it)
reset role;
insert into public.hr_overtime (member_id, day, start_at, end_at, minutes, kind, note)
select '00000000-0000-4000-8000-0000000046a3', d, public.hr_at(d, '10:00'), public.hr_at(d, '14:00'), 240, 'rest_day', 'شغل يوم راحة / عطلة'
from (select date_trunc('month', (select v::date from hr_ids where k = 'day'))::date + ((5 - extract(isodow from date_trunc('month', (select v::date from hr_ids where k = 'day')))::int + 7) % 7) as d) x;
insert into hr_ids select 'rest', max(id)::text from public.hr_overtime where kind = 'rest_day';
set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000046a1","role":"authenticated"}', true);
do $$
declare k1 bigint; k2 bigint; sc numeric; v_month date := date_trunc('month', (select v::date from hr_ids where k = 'day'))::date; v_line public.hr_payroll_lines; v_exp int; v_net numeric;
  v_fri date;
begin
  -- a Friday worked this month, still waiting for its approval: not on the sheet (the security review: no self-service ×2)
  v_fri := v_month + ((5 - extract(isodow from v_month)::int + 7) % 7);
  insert into hr_ids values ('fri', v_fri::text);
  insert into public.hr_kpis (member_id, name, weight, target) values ('00000000-0000-4000-8000-0000000046a3', 'أوردرات اتأكدت', 60, 100) returning id into k1;
  insert into public.hr_kpis (member_id, name, weight, target, inverse) values ('00000000-0000-4000-8000-0000000046a3', 'أخطاء', 40, 2, true) returning id into k2;
  sc := public.hr_rate_month('00000000-0000-4000-8000-0000000046a3', v_month, jsonb_build_object(k1::text, 90, k2::text, 1));
  -- 90% × 60 + min(200, 120)% × 40 = 54 + 48 = 102
  if sc <> 102 then raise exception 'case the month''s score from the KPIs failed (%)', sc; end if;
  update public.hr_kpis set weight = 50 where id = k2;
  begin perform public.hr_rate_month('00000000-0000-4000-8000-0000000046a3', v_month, jsonb_build_object(k1::text, 90, k2::text, 1)); raise exception 'case the weights must add to 100 failed';
  exception when invalid_parameter_value then null; end;
  update public.hr_kpis set weight = 40 where id = k2;

  -- the advance (approved by the admin this month → the installments start next month)
  perform public.hr_request_decide((select v::bigint from hr_ids where k = 'adv'), 'موافق');
  insert into public.hr_adjustments (member_id, month, amount, label) values ('00000000-0000-4000-8000-0000000046a3', v_month, -150, 'خصم تأخير');

  perform public.hr_payroll_open(v_month);
  begin perform public.hr_payroll_step(v_month, 'معتمد'); raise exception 'case the sheet goes through review first failed'; exception when invalid_parameter_value then null; end;
  perform public.hr_payroll_step(v_month, 'مراجعة');
  perform public.hr_payroll_step(v_month, 'معتمد');
  select * into v_line from public.hr_payroll_lines where month = v_month and member_id = '00000000-0000-4000-8000-0000000046a3';
  -- 9600 − 1000 = 8600 · overtime 45 min at 9600/24/8 = 50/h → 37.50 · allowances 200 · deduction 150 · advance from next month only
  if v_line.paid <> 8600 or v_line.ot_minutes <> 45 or v_line.ot_pay <> 37.5 or v_line.allowances <> 200 or v_line.deductions <> 150 or v_line.advance <> 0 or v_line.rest_days <> 0 then
    raise exception 'case the payslip line failed (%)', row_to_json(v_line);
  end if;
  v_net := v_line.net;
  begin insert into public.hr_adjustments (member_id, month, amount, label) values ('00000000-0000-4000-8000-0000000046a3', v_month, 50, 'بدل'); raise exception 'case an approved sheet is locked failed';
  exception when invalid_parameter_value then null; end;
  begin perform public.hr_payroll_pay(v_month, 'حساب وهمي'); raise exception 'case the account is one of the four failed'; exception when invalid_parameter_value then null; end;
  if public.hr_payroll_pay(v_month, 'حساب البنك') <> v_net then raise exception 'case the payroll total paid failed'; end if;
  select count(*) into v_exp from public.acc_expenses where category = 'المرتبات' and beneficiary = 'عضو تحت المدير' and amount = v_net and note like 'مرتب %';
  if v_exp <> 1 then raise exception 'case «مدفوع» writes the member''s «المرتبات» expense failed'; end if;
  if not exists (select 1 from public.acc_account_moves where account = 'حساب البنك' and direction = 'withdraw' and amount = v_net and note like 'مرتبات %') then
    raise exception 'case «مدفوع» writes one withdrawal from the account picked failed';
  end if;
  if (select status from public.hr_payroll where month = v_month) <> 'مدفوع' then raise exception 'case the sheet is paid failed'; end if;
  begin perform public.hr_payroll_step(v_month, 'مراجعة'); raise exception 'case a paid sheet stays paid failed'; exception when invalid_parameter_value then null; end;
end $$;

-- the member reads their own payslip line; the manager does not
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000046a3","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.hr_payroll_lines) <> 1 then raise exception 'case a member reads their own payslip failed'; end if;
  if (select count(*) from public.hr_payroll) <> 0 then raise exception 'case the sheet itself is for sensitive.salaries failed'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000046a2","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.hr_payroll_lines) <> 0 then raise exception 'case the manager does not see their report''s payslip failed'; end if;
  if public.hr_overtime_decide((select v::bigint from hr_ids where k = 'rest'), 'add', 5) <> 'اتضاف' then raise exception 'case the manager approves the rest day failed'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000046a1","role":"authenticated"}', true);
do $$
declare c record;
begin
  -- approved after its month's sheet was paid: it rides the next sheet still open (decision 16), whole (the 5 minutes ignored):
  -- one day ×2 = 9600 ÷ 24 × 2
  select * into c from public.hr_payroll_calc((date_trunc('month', (select v::date from hr_ids where k = 'fri')) + interval '1 month')::date) where member_id = '00000000-0000-4000-8000-0000000046a3';
  if c.rest_days <> 1 or c.rest_pay <> 800 then raise exception 'case an approved rest day counts ×2 on the next open sheet failed (%)', row_to_json(c); end if;
  select * into c from public.hr_payroll_calc((select v::date from hr_ids where k = 'fri')) where member_id = '00000000-0000-4000-8000-0000000046a3';
  if c.rest_days <> 0 then raise exception 'case the paid sheet''s month keeps its lines failed (%)', row_to_json(c); end if;
  if (select pay_month from public.hr_overtime where id = (select v::bigint from hr_ids where k = 'rest')) <> (date_trunc('month', (select v::date from hr_ids where k = 'fri')) + interval '1 month')::date then
    raise exception 'case a late approval is paid with the next open sheet failed';
  end if;
end $$;

-- a rejected overtime opens a one-to-one meeting
reset role;
insert into public.hr_overtime (member_id, day, start_at, end_at, minutes, note)
  values ('00000000-0000-4000-8000-0000000046a3', public.hr_today() - 1, now() - interval '2 hours', now() - interval '1 hour', 60, 'تجربة');
insert into hr_ids select 'ot2', max(id)::text from public.hr_overtime;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000046a2","role":"authenticated"}', true);
do $$
declare v_ot bigint := (select v::bigint from hr_ids where k = 'ot2');
begin
  begin perform public.hr_overtime_decide(v_ot, 'reject'); raise exception 'case «متضيفهوش» needs a reason failed'; exception when invalid_parameter_value then null; end;
  perform public.hr_overtime_decide(v_ot, 'reject', null, 'مش متفق عليه');
  if not exists (select 1 from public.hr_meetings where member_id = '00000000-0000-4000-8000-0000000046a3' and ref = 'OT-' || v_ot and status = 'مطلوب') then
    raise exception 'case «متضيفهوش» opens a one-to-one meeting failed';
  end if;
  -- after the meeting: «الوقت يتضاف» (decision 16); a refused one is never refused again
  begin perform public.hr_overtime_decide(v_ot, 'reject', null, 'تاني'); raise exception 'case a refused overtime is not refused twice failed'; exception when invalid_parameter_value then null; end;
  if public.hr_overtime_decide(v_ot, 'add') <> 'اتضاف' then raise exception 'case «ضيفه» after the meeting failed'; end if;
  if (select paid_minutes from public.hr_overtime where id = v_ot) <> 60 then raise exception 'case «ضيفه» after the meeting pays it all failed'; end if;
end $$;

-- ================================================================ decision 16: documents, a leave's report, achievements, settings, profiles

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000046a1","role":"authenticated"}', true);
do $$
declare v_next date := (date_trunc('month', public.hr_today()) + interval '1 month')::date;
begin
  insert into public.hr_documents (member_id, kind, path, name, start_on, end_on)
  values ('00000000-0000-4000-8000-0000000046a3', 'عقد عمل', '00000000-0000-4000-8000-0000000046a3/contract.pdf', 'contract.pdf', '2026-01-01', '2026-12-31');
  begin
    insert into public.hr_documents (member_id, kind, path, name) values ('00000000-0000-4000-8000-0000000046a3', 'أخرى', '00000000-0000-4000-8000-0000000046a4/x.pdf', 'x.pdf');
    raise exception 'case a document lives in its member''s folder failed';
  exception when check_violation then null;
  end;
  begin update public.hr_documents set name = 'other.pdf' where path like '%/contract.pdf'; raise exception 'case a document changes only by its void failed';
  exception when insufficient_privilege or invalid_parameter_value then null; end;
  update public.hr_documents set voided_at = now() where path like '%/contract.pdf' and false; -- the void column is the one granted
  begin
    insert into public.hr_adjustments (member_id, month, amount, label, kind) values ('00000000-0000-4000-8000-0000000046a3', v_next, -100, 'إنجاز بالسالب', 'achievement');
    raise exception 'case an achievement is an addition failed';
  exception when check_violation then null;
  end;
  insert into public.hr_adjustments (member_id, month, amount, label, kind) values ('00000000-0000-4000-8000-0000000046a3', v_next, 750, 'تصوير 120 منتج في أسبوع', 'achievement');
  if public.hr_settings() is null then raise exception 'case hr_settings for an active member failed'; end if;
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000046a3","role":"authenticated"}', true);
do $$
declare v_id bigint;
begin
  if (select count(*) from public.hr_documents) <> 1 then raise exception 'case a member reads their own documents failed'; end if;
  begin
    insert into public.hr_documents (member_id, kind, path, name) values ('00000000-0000-4000-8000-0000000046a3', 'أخرى', '00000000-0000-4000-8000-0000000046a3/mine.pdf', 'mine.pdf');
    raise exception 'case only hr.edit writes the documents failed';
  exception when insufficient_privilege then null;
  end;
  if not public.hr_doc_visible('00000000-0000-4000-8000-0000000046a3/contract.pdf') or public.hr_doc_visible('00000000-0000-4000-8000-0000000046a4/x.pdf')
     or public.hr_doc_visible('not-a-folder/x.pdf') then
    raise exception 'case a member reads the files of their own folder only failed';
  end if;
  if public.hr_settings() is null then raise exception 'case hr_settings for a member without settings.view failed'; end if;
  if (select count(*) from public.hr_adjustments where kind = 'achievement') <> 1 then raise exception 'case a member reads their own achievement failed'; end if;
  -- a sick leave needs its report, in the member's own folder
  begin perform public.hr_request_create('{"type":"إجازة مرضية","from":"2026-12-13","to":"2026-12-14"}'); raise exception 'case a sick leave needs its report failed'; exception when invalid_parameter_value then null; end;
  begin perform public.hr_request_create('{"type":"إجازة مرضية","from":"2026-12-13","to":"2026-12-14","doc":"00000000-0000-4000-8000-0000000046a4/r.pdf"}');
    raise exception 'case the report is in the member''s own folder failed'; exception when invalid_parameter_value then null; end;
  v_id := public.hr_request_create('{"type":"إجازة مرضية","from":"2026-12-13","to":"2026-12-14","doc":"00000000-0000-4000-8000-0000000046a3/report.pdf"}');
  if (select doc_path from public.hr_requests_v where id = v_id) <> '00000000-0000-4000-8000-0000000046a3/report.pdf' then raise exception 'case the report is on the request failed'; end if;
  if (select doc_path from public.hr_requests_v where id = public.hr_request_create('{"type":"شغل عن بُعد","from":"2026-12-15","doc":"00000000-0000-4000-8000-0000000046a3/z.pdf"}')) is not null then
    raise exception 'case only a leave keeps an attachment failed';
  end if;
  insert into hr_ids values ('sick', v_id::text);
end $$;

-- the manager reads the report of the request they decide; the stranger reads none of it
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000046a2","role":"authenticated"}', true);
do $$
begin
  if not public.hr_doc_visible('00000000-0000-4000-8000-0000000046a3/report.pdf') then raise exception 'case the decider reads the leave''s report failed'; end if;
  if public.hr_doc_visible('00000000-0000-4000-8000-0000000046a3/contract.pdf') then raise exception 'case the manager does not read the contract failed'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000046a4","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.hr_documents) <> 0 or public.hr_doc_visible('00000000-0000-4000-8000-0000000046a3/report.pdf') then
    raise exception 'case a stranger reads no document failed';
  end if;
  if (select count(*) from public.profiles) <> 1 then raise exception 'case a member without settings.view reads their own profile only failed'; end if;
end $$;

-- a direct manager without settings.view (cs) reads the profile of the member they manage
reset role;
update public.profiles set manager_id = '00000000-0000-4000-8000-0000000046a4' where id = '00000000-0000-4000-8000-0000000046a5';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000046a4","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.profiles) <> 2 or not exists (select 1 from public.profiles where id = '00000000-0000-4000-8000-0000000046a5') then
    raise exception 'case a manager reads their team''s profiles failed';
  end if;
end $$;

reset role;
do $$ begin raise notice 'rls_hr: ok'; end $$;
rollback;
