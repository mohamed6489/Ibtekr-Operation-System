-- 0083_hr_rebuild (the owner, 12 Nov — «صفحة الموارد البشرية هتبقى: نظرة عامة · الفريق والحضور · المرتبات · التقييمات · التقارير ·
-- سجل الحركات»; the evaluation monthly and quarterly out of 5; «تحويل المرتبات» in one step with a row menu per member; the advance off
-- this month's salary; the annual leave left at the year's end paid with December's salary or carried). Plan:
-- docs/superpowers/plans/2026-11-12-hr-rebuild.md (decisions 2–8).
-- * hr_evaluations: the month's performance and communication (1–5) — written by hr_evaluate (the admin, hr.edit F or the direct
--   manager; never one's own); the attendance (0–5) from the days (hr_att_score); the month = the three's average
-- * the bonus (the held-back part of the salary): at the quarter's third month, each month's holdback whole when its evaluation is ≥ the
--   setting bonusMin (default 3), else nothing (the owner: «كامل أو صفر، مش نسبة»)
-- * the advance: all of it off the salary of the month it was approved (pay_from); the old ones by installments go on as they were
-- * hr_ot_adjust: the overtime corrected by minutes (±) with a reason, into the month's sheet
-- * the year's end: December's sheet pays the annual leave left (salary ÷ 24 a day) when leaveYearEnd = 'pay' (the default); 'carry' puts
--   it on next year's balance (hr_members.leave_carry, rolled once a year by hr_payroll_open)
-- * hr_payroll_transfer / hr_pay_member / hr_advance_give: the money out (an «المرتبات» expense per member + one withdrawal) with
--   hr_payroll_paid so a member is never paid twice for a month; an early pay needs its reason

-- ---------------------------------------------------------------- the settings this file reads (the row «hr», the admin writes it)

create or replace function public.hr_setting(p_key text, p_default text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select data ->> p_key from public.settings where section = 'hr'), p_default)
$$;
revoke execute on function public.hr_setting(text, text) from public, anon, authenticated;
grant execute on function public.hr_setting(text, text) to service_role;

-- ---------------------------------------------------------------- the evaluation

create table if not exists public.hr_evaluations (
  member_id uuid not null references public.profiles on delete cascade,
  month date not null check (extract(day from month) = 1),
  performance smallint not null check (performance between 1 and 5),
  communication smallint not null check (communication between 1 and 5),
  note text check (note is null or char_length(note) <= 500),
  rated_by uuid references public.profiles,
  rated_at timestamptz not null default now(),
  primary key (member_id, month)
);
alter table public.hr_evaluations enable row level security;
drop policy if exists hr_evaluations_select on public.hr_evaluations;
create policy hr_evaluations_select on public.hr_evaluations for select to authenticated using (public.hr_can_see(member_id));
revoke all on public.hr_evaluations from anon, authenticated;
grant select on public.hr_evaluations to authenticated;
grant all on public.hr_evaluations to service_role;

-- the confirmed holidays as days
create or replace function public.hr_holiday_days() returns setof date
language sql stable security definer set search_path = public as $$
  select (h.day + g.i)::date from public.hr_holidays h cross join lateral generate_series(0, h.days - 1) g(i) where h.status = 'مؤكد'
$$;
revoke execute on function public.hr_holiday_days() from public, anon, authenticated;
grant execute on function public.hr_holiday_days() to service_role;

-- the attendance out of 5 (to the half): the days attended ÷ the working days asked of the member in the month (Sunday–Thursday, not a
-- confirmed holiday, not an approved leave, not before the hire date, up to today in the current month); null when none was asked
create or replace function public.hr_att_score(p_member uuid, p_month date) returns numeric
language sql stable security definer set search_path = public as $$
  with b as (
    select date_trunc('month', p_month)::date as m0, least((date_trunc('month', p_month) + interval '1 month - 1 day')::date, public.hr_today()) as m1
  ), lv as (
    select g.d::date as d from public.hr_requests r
    cross join lateral generate_series(r.from_day, r.to_day, interval '1 day') g(d)
    where r.member_id = p_member and r.status = 'موافق' and r.from_day is not null and r.to_day is not null
      and exists (select 1 from public.hr_leave_types t where t.name = r.type)
  ), req as (
    select g.d::date as d from b cross join lateral generate_series(b.m0, b.m1, interval '1 day') g(d)
    where extract(isodow from g.d) not in (5, 6)
      and g.d::date not in (select public.hr_holiday_days())
      and g.d::date not in (select d from lv)
      and g.d::date >= coalesce((select m.hire_date from public.hr_members m where m.member_id = p_member), b.m0)
  )
  select case when (select count(*) from req) = 0 then null
    else round(least(1, (select count(distinct a.day) from public.hr_attendance a where a.member_id = p_member and a.day in (select d from req))::numeric
               / (select count(*) from req)) * 10) / 2 end
$$;
revoke execute on function public.hr_att_score(uuid, date) from public, anon, authenticated;
grant execute on function public.hr_att_score(uuid, date) to service_role;

-- the month's total out of 5: the average of the attendance, the performance and the communication (the two when no day was asked)
create or replace function public.hr_eval_total(p_att numeric, p_perf int, p_comm int) returns numeric
language sql immutable set search_path = public as $$
  select case when p_perf is null or p_comm is null then null
    when p_att is null then round((p_perf + p_comm)::numeric / 2, 1)
    else round((p_att + p_perf + p_comm) / 3, 1) end
$$;
revoke execute on function public.hr_eval_total(numeric, int, int) from public, anon;
grant execute on function public.hr_eval_total(numeric, int, int) to authenticated, service_role;

-- the evaluations of the members I see, month by month (24 months at most, up to the current one)
create or replace function public.hr_evaluations_list(p_from date, p_to date)
returns table (member_id uuid, month date, attendance numeric, performance smallint, communication smallint, total numeric, note text, rated_by uuid, rated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare v_from date := date_trunc('month', p_from)::date; v_to date := least(date_trunc('month', p_to)::date, date_trunc('month', public.hr_today())::date);
begin
  if not public.hr_active() then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_from is null or v_to is null or v_from > v_to or v_to - v_from > 740 then raise exception 'invalid: range' using errcode = '22023'; end if;
  return query
  select p.id, g.m::date, public.hr_att_score(p.id, g.m::date), e.performance, e.communication,
         public.hr_eval_total(public.hr_att_score(p.id, g.m::date), e.performance, e.communication), e.note, e.rated_by, e.rated_at
  from public.profiles p
  cross join lateral generate_series(v_from, v_to, interval '1 month') g(m)
  left join public.hr_evaluations e on e.member_id = p.id and e.month = g.m::date
  where p.status = 'active' and public.hr_can_see(p.id)
  order by p.name, g.m;
end $$;
revoke execute on function public.hr_evaluations_list(date, date) from public, anon;
grant execute on function public.hr_evaluations_list(date, date) to authenticated, service_role;

-- the month rated: the admin, hr.edit F or the direct manager; never one's own (but the admin); a month up to the current one
create or replace function public.hr_evaluate(p_member uuid, p_month date, p_perf int, p_comm int, p_note text default null) returns numeric
language plpgsql security definer set search_path = public as $$
declare v_month date := date_trunc('month', p_month)::date; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.hr_active() then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = p_member) then raise exception 'not found' using errcode = 'P0002'; end if;
  if not (public.is_admin() or (p_member is distinct from auth.uid() and (public.hr_editor() or public.hr_is_manager_of(p_member)))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_month is null or v_month > date_trunc('month', public.hr_today())::date then raise exception 'invalid: month' using errcode = '22023'; end if;
  if p_perf is null or p_perf not between 1 and 5 then raise exception 'invalid: performance' using errcode = '22023'; end if;
  if p_comm is null or p_comm not between 1 and 5 then raise exception 'invalid: communication' using errcode = '22023'; end if;
  if v_note is not null and char_length(v_note) > 500 then raise exception 'invalid: note' using errcode = '22023'; end if;
  insert into public.hr_evaluations (member_id, month, performance, communication, note, rated_by, rated_at)
  values (p_member, v_month, p_perf, p_comm, v_note, auth.uid(), now())
  on conflict (member_id, month) do update set performance = excluded.performance, communication = excluded.communication, note = excluded.note,
    rated_by = auth.uid(), rated_at = now();
  perform public.log_activity('hr.evaluate', 'hr', p_member::text, null, to_jsonb(to_char(v_month, 'YYYY-MM'))); -- no score in the log
  return public.hr_eval_total(public.hr_att_score(p_member, v_month), p_perf, p_comm);
end $$;
revoke execute on function public.hr_evaluate(uuid, date, int, int, text) from public, anon;
grant execute on function public.hr_evaluate(uuid, date, int, int, text) to authenticated, service_role;

-- ---------------------------------------------------------------- the money out: who was paid for a month

create table if not exists public.hr_payroll_paid (
  month date not null check (extract(day from month) = 1),
  member_id uuid not null references public.profiles on delete cascade,
  amount numeric(12,2) not null,
  account text not null check (account in ('حساب البنك', 'حساب بوسطة', 'حساب باي موب', 'محفظة إلكترونية')),
  early_reason text check (early_reason is null or char_length(early_reason) <= 300),
  paid_by uuid references public.profiles default auth.uid(),
  paid_at timestamptz not null default now(),
  primary key (month, member_id)
);
alter table public.hr_payroll_paid enable row level security;
drop policy if exists hr_payroll_paid_select on public.hr_payroll_paid;
create policy hr_payroll_paid_select on public.hr_payroll_paid for select to authenticated using (public.hr_salaries() or member_id = (select auth.uid()));
revoke all on public.hr_payroll_paid from anon, authenticated;
grant select on public.hr_payroll_paid to authenticated;
grant all on public.hr_payroll_paid to service_role;

-- the first month from p_from whose sheet is not paid and where the member was not paid yet (an advance comes off it)
create or replace function public.hr_open_month_for(p_member uuid, p_from date) returns date
language plpgsql stable security definer set search_path = public as $$
declare v date := date_trunc('month', coalesce(p_from, public.hr_today()))::date;
begin
  while exists (select 1 from public.hr_payroll p where p.month = v and p.status = 'مدفوع') or exists (select 1 from public.hr_payroll_paid x where x.month = v and x.member_id = p_member) loop
    v := (v + interval '1 month')::date;
  end loop;
  return v;
end $$;
revoke execute on function public.hr_open_month_for(uuid, date) from public, anon, authenticated;
grant execute on function public.hr_open_month_for(uuid, date) to service_role;

-- ---------------------------------------------------------------- the advance: all of it off the month it was approved in

alter table public.hr_requests add column if not exists pay_from date check (pay_from is null or extract(day from pay_from) = 1);

-- 0071's decision + the approved advance's month (pay_from)
create or replace function public.hr_request_decide(p_id bigint, p_decision text, p_reason text default null) returns text
language plpgsql security definer set search_path = public as $$
declare v_r public.hr_requests; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into v_r from public.hr_requests where id = p_id for update;
  if not found or not public.hr_can_see(v_r.member_id) then raise exception 'not found' using errcode = 'P0002'; end if;
  if not public.hr_can_decide(v_r.member_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_r.status not in ('جديد', 'قيد المراجعة') then raise exception 'invalid: status' using errcode = '22023'; end if;
  if p_decision not in ('موافق', 'مرفوض', 'قيد المراجعة') then raise exception 'invalid: decision' using errcode = '22023'; end if;
  if p_decision = 'مرفوض' and v_reason is null then raise exception 'invalid: reason' using errcode = '22023'; end if;
  if v_reason is not null and char_length(v_reason) > 300 then raise exception 'invalid: reason' using errcode = '22023'; end if;
  update public.hr_requests set status = p_decision, reason = v_reason,
    decided_by = case when p_decision = 'قيد المراجعة' then null else auth.uid() end,
    decided_at = case when p_decision = 'قيد المراجعة' then null else now() end,
    pay_from = case when p_decision = 'موافق' and v_r.type = 'سُلفة' then public.hr_open_month_for(v_r.member_id, public.hr_today()) else null end
  where id = p_id;
  if p_decision = 'موافق' and v_r.type = 'تصحيح انصراف' then
    update public.hr_attendance set out_at = greatest(in_at, public.hr_at(v_r.from_day, v_r.at_time)), source = 'fix', updated_at = now()
    where id = (select a.id from public.hr_attendance a where a.member_id = v_r.member_id and a.day = v_r.from_day
                order by (a.out_at is null) desc, a.in_at desc limit 1);
  end if;
  if v_r.ticket_id is not null then
    if p_decision = 'قيد المراجعة' then
      perform public.hr_ot_event(v_r.ticket_id, 'الطلب قيد المراجعة');
    else
      perform public.hr_ot_event(v_r.ticket_id, case when p_decision = 'موافق' then 'اتوافق على الطلب' else 'اترفض الطلب' end);
      perform public.hr_ot_ticket_close(v_r.ticket_id, case when p_decision = 'موافق' then 'اتحلت المشكلة' else 'مش مشكلة' end,
        case when p_decision = 'موافق' then 'اتوافق' else 'اترفض' end);
    end if;
  end if;
  return p_decision;
end $$;

-- ---------------------------------------------------------------- the overtime corrected by minutes

create table if not exists public.hr_ot_adjust (
  id bigserial primary key,
  member_id uuid not null references public.profiles on delete cascade,
  month date not null check (extract(day from month) = 1),
  minutes int not null check (minutes <> 0 and minutes between -6000 and 6000),
  reason text not null check (char_length(btrim(reason)) between 1 and 300),
  by_id uuid references public.profiles default auth.uid(),
  at timestamptz not null default now()
);
create index if not exists hr_ot_adjust_month_idx on public.hr_ot_adjust (month, member_id);
alter table public.hr_ot_adjust enable row level security;
drop policy if exists hr_ot_adjust_select on public.hr_ot_adjust;
create policy hr_ot_adjust_select on public.hr_ot_adjust for select to authenticated using (public.hr_can_see(member_id));
revoke all on public.hr_ot_adjust from anon, authenticated;
grant select on public.hr_ot_adjust to authenticated;
grant all on public.hr_ot_adjust to service_role;
grant usage on sequence public.hr_ot_adjust_id_seq to service_role;

create or replace function public.hr_ot_adjust_add(p_member uuid, p_month date, p_minutes int, p_reason text) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_month date := date_trunc('month', coalesce(p_month, public.hr_today()))::date; v_id bigint; v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not public.hr_salaries() then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = p_member) then raise exception 'not found' using errcode = 'P0002'; end if;
  if p_minutes is null or p_minutes = 0 or abs(p_minutes) > 6000 then raise exception 'invalid: minutes' using errcode = '22023'; end if;
  if v_reason = '' or char_length(v_reason) > 300 then raise exception 'invalid: reason' using errcode = '22023'; end if;
  if exists (select 1 from public.hr_payroll p where p.month = v_month and p.status = 'مدفوع') or exists (select 1 from public.hr_payroll_paid x where x.month = v_month and x.member_id = p_member) then
    raise exception 'invalid: paid' using errcode = '22023';
  end if;
  insert into public.hr_ot_adjust (member_id, month, minutes, reason) values (p_member, v_month, p_minutes, v_reason) returning id into v_id;
  perform public.log_activity('hr.overtime.adjust', 'hr', p_member::text, null, to_jsonb(to_char(v_month, 'YYYY-MM') || ' ' || p_minutes || ' د'));
  return v_id;
end $$;
revoke execute on function public.hr_ot_adjust_add(uuid, date, int, text) from public, anon;
grant execute on function public.hr_ot_adjust_add(uuid, date, int, text) to authenticated, service_role;

-- ---------------------------------------------------------------- the annual leave: used, carried, settled

alter table public.hr_members add column if not exists leave_carry numeric(5,1) not null default 0 check (leave_carry >= 0 and leave_carry <= 365);
alter table public.hr_members add column if not exists leave_carry_year int;
grant select (leave_carry, leave_carry_year) on public.hr_members to authenticated;

-- the days of a year's approved leaves that come off the annual balance (Sunday–Thursday, not a holiday)
create or replace function public.hr_leave_used(p_member uuid, p_year int) returns numeric
language sql stable security definer set search_path = public as $$
  select count(*)::numeric from public.hr_requests r
  join public.hr_leave_types t on t.name = r.type and t.deducts
  cross join lateral generate_series(greatest(r.from_day, make_date(p_year, 1, 1)), least(r.to_day, make_date(p_year, 12, 31)), interval '1 day') g(d)
  where r.member_id = p_member and r.status = 'موافق' and extract(isodow from g.d) not in (5, 6) and g.d::date not in (select public.hr_holiday_days())
$$;
revoke execute on function public.hr_leave_used(uuid, int) from public, anon, authenticated;
grant execute on function public.hr_leave_used(uuid, int) to service_role;

-- the balance left of a year = the year's days (+ what was carried into it) − the used
create or replace function public.hr_leave_left(p_member uuid, p_year int) returns numeric
language sql stable security definer set search_path = public as $$
  select greatest(0, coalesce(m.leave_days, 21) + case when m.leave_carry_year = p_year then m.leave_carry else 0 end - public.hr_leave_used(p_member, p_year))
  from public.profiles p left join public.hr_members m on m.member_id = p.id where p.id = p_member
$$;
revoke execute on function public.hr_leave_left(uuid, int) from public, anon, authenticated;
grant execute on function public.hr_leave_left(uuid, int) to service_role;

-- once a year (the daily cron's hr_payroll_open): 'carry' puts last year's balance left on this year's; 'pay' carries nothing (December paid it)
create or replace function public.hr_leave_roll(p_year int) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.hr_members m set
    leave_carry = case when public.hr_setting('leaveYearEnd', 'pay') = 'carry' then least(365, public.hr_leave_left(m.member_id, p_year - 1)) else 0 end,
    leave_carry_year = p_year
  where m.leave_carry_year is distinct from p_year;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.hr_leave_roll(int) from public, anon, authenticated;
grant execute on function public.hr_leave_roll(int) to service_role;

create or replace function public.hr_payroll_open(p_month date default null) returns date
language plpgsql security definer set search_path = public as $$
declare v_month date := date_trunc('month', coalesce(p_month, public.hr_today()))::date;
begin
  -- the cron / service_role carry no member (anon has no execute)
  if not (public.hr_salaries() or auth.uid() is null) then raise exception 'not allowed' using errcode = '42501'; end if;
  insert into public.hr_payroll (month) values (v_month) on conflict (month) do nothing;
  perform public.hr_leave_roll(extract(year from public.hr_today())::int);
  return v_month;
end $$;

-- ---------------------------------------------------------------- the month's lines (0046's + the leave pay, the adjustments, the bonus by month)

alter table public.hr_payroll_lines add column if not exists leave_days_paid numeric(5,1) not null default 0;
alter table public.hr_payroll_lines add column if not exists leave_pay numeric(12,2) not null default 0;

drop function if exists public.hr_payroll_calc(date);
create function public.hr_payroll_calc(p_month date)
returns table (member_id uuid, name text, salary numeric, holdback numeric, paid numeric, ot_minutes int, ot_pay numeric, rest_days int,
  rest_pay numeric, unpaid_days numeric, unpaid_cut numeric, allowances numeric, deductions numeric, advance numeric, quarter_bonus numeric,
  net numeric, missing_scores int, leave_days_paid numeric, leave_pay numeric)
language plpgsql stable security definer set search_path = public as $$
declare m0 date := date_trunc('month', p_month)::date; m1 date := (date_trunc('month', p_month) + interval '1 month')::date;
  q0 date := date_trunc('quarter', p_month)::date; q_end boolean := extract(month from p_month)::int % 3 = 0;
  q_ref text := to_char(date_trunc('quarter', p_month), 'YYYY') || '-Q' || extract(quarter from p_month)::int;
  v_min numeric := coalesce(nullif(public.hr_setting('bonusMin', '3'), '')::numeric, 3);
  v_dec boolean := extract(month from p_month)::int = 12 and public.hr_setting('leaveYearEnd', 'pay') = 'pay';
  v_year int := extract(year from p_month)::int;
begin
  -- the cron / service_role carry no member (anon has no execute)
  if not (public.hr_salaries() or auth.uid() is null) then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
  with mem as (
    select p.id, p.name, pay.salary s, pay.holdback hb, pay.allowances al
    from public.profiles p join public.hr_pay pay on pay.member_id = p.id
    where p.status = 'active' and pay.salary > 0
  ), ot as (
    select o.member_id mid, sum(o.paid_minutes)::int mins from public.hr_overtime o
    where o.kind = 'hours' and o.status = 'اتضاف' and o.pay_month = m0 group by o.member_id
  ), ota as (
    select a.member_id mid, sum(a.minutes)::int mins from public.hr_ot_adjust a where a.month = m0 group by a.member_id
  ), rest as (
    select o.member_id mid, count(*)::int n from public.hr_overtime o
    where o.kind = 'rest_day' and o.status = 'اتضاف' and o.pay_month = m0 group by o.member_id
  ), unpaid as (
    select r.member_id mid, count(*)::numeric n
    from public.hr_requests r join public.hr_leave_types t on t.name = r.type and t.unpaid
    cross join lateral generate_series(greatest(r.from_day, m0), least(r.to_day, m1 - 1), interval '1 day') g(d)
    where r.status = 'موافق' and extract(isodow from g.d) not in (5, 6) and g.d::date not in (select public.hr_holiday_days())
    group by r.member_id
  ), adj as (
    select j.member_id mid, sum(greatest(j.amount, 0)) plus, sum(greatest(-j.amount, 0)) minus
    from public.hr_adjustments j where j.month = m0 and j.voided_at is null group by j.member_id
  ), adv as (
    -- decision 4: an advance with its month (pay_from) comes off it whole; the old ones by installments from the month after the decision
    select r.member_id mid, sum(case when r.pay_from is not null then case when r.pay_from = m0 then r.amount else 0 end
      when m0 >= (date_trunc('month', r.decided_at at time zone 'Africa/Cairo') + interval '1 month')::date
       and m0 < (date_trunc('month', r.decided_at at time zone 'Africa/Cairo') + make_interval(months => 1 + r.months))::date then round(r.amount / r.months, 2) else 0 end) per
    from public.hr_requests r
    where r.type = 'سُلفة' and r.status = 'موافق' and r.decided_at is not null
    group by r.member_id
  ), ev as (
    -- decision 3: the quarter's months, each evaluation's total; the holdback of a month whole when it is ≥ bonusMin
    select m.id mid, count(e.member_id)::int n,
      sum(case when e.member_id is not null and public.hr_eval_total(public.hr_att_score(m.id, g.mm::date), e.performance, e.communication) >= v_min then m.hb else 0 end) earned
    from mem m cross join lateral generate_series(q0, (q0 + interval '2 months')::date, interval '1 month') g(mm)
    left join public.hr_evaluations e on e.member_id = m.id and e.month = g.mm::date
    group by m.id
  ), ex as (
    select e.member_id mid, sum(e.amount) amt from public.hr_extras e where e.quarter = q_ref and e.status = 'معتمدة' group by e.member_id
  ), base as (
    select m.id, m.name, m.s, m.hb, round(m.s - m.hb, 2) as paid0,
      greatest(0, coalesce(ot.mins, 0) + coalesce(ota.mins, 0)) as otm,
      round(m.s / 24 / 8 * greatest(0, coalesce(ot.mins, 0) + coalesce(ota.mins, 0)) / 60, 2) as otp,
      coalesce(rest.n, 0) as rd, round(m.s / 24 * 2 * coalesce(rest.n, 0), 2) as rp,
      coalesce(unpaid.n, 0) as ud, round(m.s / 24 * coalesce(unpaid.n, 0), 2) as uc,
      round(m.al + coalesce(adj.plus, 0), 2) as al2, round(coalesce(adj.minus, 0), 2) as ded, round(coalesce(adv.per, 0), 2) as adv2,
      case when q_end then round(coalesce(ev.earned, 0) + coalesce(ex.amt, 0), 2) else 0 end as qb,
      case when q_end then 3 - coalesce(ev.n, 0) else 0 end as miss,
      case when v_dec then public.hr_leave_left(m.id, v_year) else 0 end as ld
    from mem m
    left join ot on ot.mid = m.id left join ota on ota.mid = m.id left join rest on rest.mid = m.id left join unpaid on unpaid.mid = m.id
    left join adj on adj.mid = m.id left join adv on adv.mid = m.id left join ev on ev.mid = m.id left join ex on ex.mid = m.id
  )
  select b.id, b.name, b.s, b.hb, b.paid0, b.otm, b.otp, b.rd, b.rp, b.ud, b.uc, b.al2, b.ded, b.adv2, b.qb,
    round(b.paid0 + b.otp + b.rp + b.al2 - b.ded - b.adv2 - b.uc + b.qb + round(b.s / 24 * b.ld, 2), 2), b.miss, b.ld, round(b.s / 24 * b.ld, 2)
  from base b order by b.name;
end $$;
revoke execute on function public.hr_payroll_calc(date) from public, anon;
grant execute on function public.hr_payroll_calc(date) to authenticated, service_role;

-- 0046's approval snapshot with the two new columns (the steps stay for the history; the page transfers in one step)
create or replace function public.hr_payroll_step(p_month date, p_step text) returns text
language plpgsql security definer set search_path = public as $$
declare v_p public.hr_payroll; v_month date := date_trunc('month', p_month)::date;
begin
  if not public.hr_salaries() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_p from public.hr_payroll where month = v_month for update;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  if not ((v_p.status = 'مسودة' and p_step = 'مراجعة') or (v_p.status = 'مراجعة' and p_step in ('مسودة', 'معتمد')) or (v_p.status = 'معتمد' and p_step = 'مراجعة')) then
    raise exception 'invalid: step' using errcode = '22023';
  end if;
  if p_step = 'معتمد' then
    delete from public.hr_payroll_lines l where l.month = v_month and not exists (select 1 from public.hr_payroll_paid x where x.month = v_month and x.member_id = l.member_id);
    insert into public.hr_payroll_lines (month, member_id, name, salary, holdback, paid, ot_minutes, ot_pay, rest_days, rest_pay, unpaid_days, unpaid_cut,
      allowances, deductions, advance, quarter_bonus, net, leave_days_paid, leave_pay)
    select v_month, c.member_id, c.name, c.salary, c.holdback, c.paid, c.ot_minutes, c.ot_pay, c.rest_days, c.rest_pay, c.unpaid_days, c.unpaid_cut,
      c.allowances, c.deductions, c.advance, c.quarter_bonus, c.net, c.leave_days_paid, c.leave_pay from public.hr_payroll_calc(v_month) c
    where not exists (select 1 from public.hr_payroll_paid x where x.month = v_month and x.member_id = c.member_id);
    update public.hr_payroll set status = 'معتمد', approved_by = auth.uid(), approved_at = now(),
      total = (select coalesce(sum(net), 0) from public.hr_payroll_lines where month = v_month) where month = v_month;
  elsif p_step = 'مراجعة' then
    delete from public.hr_payroll_lines l where l.month = v_month and not exists (select 1 from public.hr_payroll_paid x where x.month = v_month and x.member_id = l.member_id);
    update public.hr_payroll set status = 'مراجعة', reviewed_by = auth.uid(), reviewed_at = now(), approved_by = null, approved_at = null, total = null where month = v_month;
  else
    update public.hr_payroll set status = 'مسودة', reviewed_by = null, reviewed_at = null where month = v_month;
  end if;
  return p_step;
end $$;

-- one member's line snapshotted, paid out (an «المرتبات» expense at the net + a withdrawal), marked paid
create or replace function public.hr_pay_line(p_month date, p_member uuid, p_account text, p_reason text) returns numeric
language plpgsql security definer set search_path = public as $$
declare v_label text := to_char(p_month, 'YYYY-MM'); c record;
begin
  select * into c from public.hr_payroll_calc(p_month) x where x.member_id = p_member;
  if not found then return null; end if;
  delete from public.hr_payroll_lines where month = p_month and member_id = p_member;
  insert into public.hr_payroll_lines (month, member_id, name, salary, holdback, paid, ot_minutes, ot_pay, rest_days, rest_pay, unpaid_days, unpaid_cut,
    allowances, deductions, advance, quarter_bonus, net, leave_days_paid, leave_pay)
  values (p_month, c.member_id, c.name, c.salary, c.holdback, c.paid, c.ot_minutes, c.ot_pay, c.rest_days, c.rest_pay, c.unpaid_days, c.unpaid_cut,
    c.allowances, c.deductions, c.advance, c.quarter_bonus, c.net, c.leave_days_paid, c.leave_pay);
  if c.net > 0 then
    insert into public.acc_expenses (on_date, direction, category, beneficiary, beneficiary_other, amount, note)
    values (public.hr_today(), 'withdraw', 'المرتبات', left(c.name, 80), false, c.net, 'مرتب ' || v_label);
  end if;
  insert into public.hr_payroll_paid (month, member_id, amount, account, early_reason) values (p_month, p_member, greatest(c.net, 0), p_account, p_reason);
  return greatest(c.net, 0);
end $$;
revoke execute on function public.hr_pay_line(date, uuid, text, text) from public, anon, authenticated;
grant execute on function public.hr_pay_line(date, uuid, text, text) to service_role;

-- the pay day of a month (the setting payDay, default 28; past the month's end = its last day)
create or replace function public.hr_pay_day(p_month date) returns date
language sql stable security definer set search_path = public as $$
  select make_date(extract(year from p_month)::int, extract(month from p_month)::int,
    least(greatest(1, coalesce(nullif(public.hr_setting('payDay', '28'), '')::int, 28)), extract(day from (date_trunc('month', p_month) + interval '1 month - 1 day'))::int))
$$;
revoke execute on function public.hr_pay_day(date) from public, anon;
grant execute on function public.hr_pay_day(date) to authenticated, service_role;

-- «تحويل المرتب» for one member (decision 8): before the pay day a reason is a must
create or replace function public.hr_pay_member(p_month date, p_member uuid, p_account text, p_reason text default null) returns numeric
language plpgsql security definer set search_path = public as $$
declare v_month date := date_trunc('month', coalesce(p_month, public.hr_today()))::date; v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_net numeric;
begin
  if not public.hr_salaries() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_account is null or p_account not in ('حساب البنك', 'حساب بوسطة', 'حساب باي موب', 'محفظة إلكترونية') then raise exception 'invalid: account' using errcode = '22023'; end if;
  if v_reason is not null and char_length(v_reason) > 300 then raise exception 'invalid: reason' using errcode = '22023'; end if;
  insert into public.hr_payroll (month) values (v_month) on conflict (month) do nothing;
  perform 1 from public.hr_payroll where month = v_month for update;
  if exists (select 1 from public.hr_payroll where month = v_month and status = 'مدفوع') or exists (select 1 from public.hr_payroll_paid where month = v_month and member_id = p_member) then
    raise exception 'invalid: paid' using errcode = '22023';
  end if;
  if public.hr_today() < public.hr_pay_day(v_month) and v_reason is null then raise exception 'invalid: reason' using errcode = '22023'; end if;
  v_net := public.hr_pay_line(v_month, p_member, p_account, case when public.hr_today() < public.hr_pay_day(v_month) then v_reason else null end);
  if v_net is null then raise exception 'not found' using errcode = 'P0002'; end if;
  if v_net > 0 then
    insert into public.acc_account_moves (account, on_date, direction, amount, note) values (p_account, public.hr_today(), 'withdraw', v_net, 'مرتب ' || to_char(v_month, 'YYYY-MM'));
  end if;
  perform public.log_activity('hr.payroll.member', 'hr', p_member::text, null, to_jsonb(to_char(v_month, 'YYYY-MM') || case when public.hr_today() < public.hr_pay_day(v_month) then ' مبكر' else '' end));
  return v_net;
end $$;
revoke execute on function public.hr_pay_member(date, uuid, text, text) from public, anon;
grant execute on function public.hr_pay_member(date, uuid, text, text) to authenticated, service_role;

-- «تحويل المرتبات» (decision 7): everyone not paid yet for the month, one withdrawal with the total; the sheet «مدفوع»
create or replace function public.hr_payroll_transfer(p_month date, p_account text) returns numeric
language plpgsql security definer set search_path = public as $$
declare v_month date := date_trunc('month', coalesce(p_month, public.hr_today()))::date; v_total numeric := 0; v_one numeric; r record;
begin
  if not public.hr_salaries() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_account is null or p_account not in ('حساب البنك', 'حساب بوسطة', 'حساب باي موب', 'محفظة إلكترونية') then raise exception 'invalid: account' using errcode = '22023'; end if;
  insert into public.hr_payroll (month) values (v_month) on conflict (month) do nothing;
  perform 1 from public.hr_payroll where month = v_month for update;
  if exists (select 1 from public.hr_payroll where month = v_month and status = 'مدفوع') then raise exception 'invalid: paid' using errcode = '22023'; end if;
  for r in select c.member_id from public.hr_payroll_calc(v_month) c where not exists (select 1 from public.hr_payroll_paid x where x.month = v_month and x.member_id = c.member_id) loop
    v_one := public.hr_pay_line(v_month, r.member_id, p_account, null);
    v_total := v_total + coalesce(v_one, 0);
  end loop;
  if v_total > 0 then
    insert into public.acc_account_moves (account, on_date, direction, amount, note) values (p_account, public.hr_today(), 'withdraw', v_total, 'مرتبات ' || to_char(v_month, 'YYYY-MM'));
  end if;
  update public.hr_payroll set status = 'مدفوع', paid_by = auth.uid(), paid_at = now(), paid_account = p_account,
    total = (select coalesce(sum(net), 0) from public.hr_payroll_lines where month = v_month) where month = v_month;
  perform public.log_activity('hr.payroll.paid', 'hr', to_char(v_month, 'YYYY-MM'), null, to_jsonb(to_char(v_month, 'YYYY-MM')));
  return v_total;
end $$;
revoke execute on function public.hr_payroll_transfer(date, text) from public, anon;
grant execute on function public.hr_payroll_transfer(date, text) to authenticated, service_role;

-- «تحويل سلفة» (decision 8): an approved advance of this month (it comes off this month's salary) + the money out now
create or replace function public.hr_advance_give(p_member uuid, p_amount numeric, p_reason text, p_account text) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_name text; v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not public.hr_salaries() then raise exception 'not allowed' using errcode = '42501'; end if;
  select name into v_name from public.profiles where id = p_member and status = 'active';
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000000 then raise exception 'invalid: amount' using errcode = '22023'; end if;
  if v_reason = '' or char_length(v_reason) > 300 then raise exception 'invalid: reason' using errcode = '22023'; end if;
  if p_account is null or p_account not in ('حساب البنك', 'حساب بوسطة', 'حساب باي موب', 'محفظة إلكترونية') then raise exception 'invalid: account' using errcode = '22023'; end if;
  insert into public.hr_requests (member_id, type, from_day, to_day, amount, months, note, status, decided_by, decided_at, created_by, pay_from)
  values (p_member, 'سُلفة', public.hr_today(), public.hr_today(), round(p_amount, 2), 1, v_reason, 'موافق', auth.uid(), now(), auth.uid(),
          public.hr_open_month_for(p_member, public.hr_today()))
  returning id into v_id;
  insert into public.acc_expenses (on_date, direction, category, beneficiary, beneficiary_other, amount, note)
  values (public.hr_today(), 'withdraw', 'المرتبات', left(v_name, 80), false, round(p_amount, 2), 'سلفة HR-' || lpad(v_id::text, 4, '0'));
  insert into public.acc_account_moves (account, on_date, direction, amount, note) values (p_account, public.hr_today(), 'withdraw', round(p_amount, 2), 'سلفة HR-' || lpad(v_id::text, 4, '0'));
  perform public.log_activity('hr.advance.give', 'hr', p_member::text, null, to_jsonb('HR-' || lpad(v_id::text, 4, '0')));
  return v_id;
end $$;
revoke execute on function public.hr_advance_give(uuid, numeric, text, text) from public, anon;
grant execute on function public.hr_advance_give(uuid, numeric, text, text) to authenticated, service_role;

-- «ملفي › مرتبي»: my lines of the paid / approved months and of a month I was paid early (0046 + the leave pay)
drop function if exists public.hr_my_slips();
create function public.hr_my_slips()
returns table (month date, status text, paid_at timestamptz, name text, salary numeric, holdback numeric, paid numeric, ot_minutes int, ot_pay numeric,
  rest_days int, rest_pay numeric, unpaid_days numeric, unpaid_cut numeric, allowances numeric, deductions numeric, advance numeric, quarter_bonus numeric, net numeric,
  leave_days_paid numeric, leave_pay numeric)
language sql stable security definer set search_path = public as $$
  select l.month, case when x.member_id is not null then 'مدفوع' else p.status end, coalesce(x.paid_at, p.paid_at), l.name, l.salary, l.holdback, l.paid, l.ot_minutes, l.ot_pay,
    l.rest_days, l.rest_pay, l.unpaid_days, l.unpaid_cut, l.allowances, l.deductions, l.advance, l.quarter_bonus, l.net, l.leave_days_paid, l.leave_pay
  from public.hr_payroll_lines l join public.hr_payroll p on p.month = l.month
  left join public.hr_payroll_paid x on x.month = l.month and x.member_id = l.member_id
  where l.member_id = auth.uid() and public.hr_active() and (p.status in ('معتمد', 'مدفوع') or x.member_id is not null)
  order by l.month desc limit 36
$$;
revoke execute on function public.hr_my_slips() from public, anon;
grant execute on function public.hr_my_slips() to authenticated, service_role;

-- ---------------------------------------------------------------- the texts that pointed at the requests tab (gone — decision 1)
-- 0069 / 0070 / 0071 / 0073 / 0074 write ticket events and descriptions that sent the reader to «الموارد البشرية › الطلبات»; each function
-- still carrying it is re-created from its own definition with the text pointing at the request card / «نظرة عامة» (grants kept: create or replace)
do $$
declare f regprocedure; d text;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f' and p.prosrc like '%«الموارد البشرية › الطلبات»%' loop
    d := pg_get_functiondef(f);
    d := replace(d, ' (السبب في «الموارد البشرية › الطلبات»)', '');
    d := replace(d, '(التفاصيل في «الموارد البشرية › الطلبات»)', '(التفاصيل في كارت الطلب هنا)');
    d := replace(d, '«الموارد البشرية › الطلبات»', '«الموارد البشرية › نظرة عامة»');
    execute d;
  end loop;
end $$;
