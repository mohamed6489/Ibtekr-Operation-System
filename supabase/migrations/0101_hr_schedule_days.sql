-- 0101 — owner batch 2 decision 7 (docs/superpowers/plans/2026-11-14-owner-batch-2.md): «وقت عمل مخصص» for a role or a member has
-- its own work days (chips) beside its hours — settings «hr».schedules.<role|member>.<key> = { from, to, days?: [isodow 1–7] }.
-- * hr_member_dows(member): the days of the member's own schedule, else of his main role's, else the work days of the settings
--   (hr_work_dows, 0087) — a schedule with no days keeps the official ones.
-- * hr_member_workday(member, day) — the weekday only (the holidays are checked where they were, as in 0087).
-- * hr_rest_day(day) = not a work day of the signed-in member (every caller is the member's own clock / overtime: hr_clock_out,
--   hr_overtime_begin, hr_overtime_request) or a confirmed holiday; no member (the server alone) = the settings' days.
-- * hr_att_score / hr_leave_used / hr_payroll_calc (0087's bodies): the member's own work days instead of the settings' ones.

create or replace function public.hr_member_dows(p_member uuid) returns int[]
language sql stable security definer set search_path = public as $$
  with s as (select coalesce((select data from public.settings where section = 'hr'), '{}'::jsonb) -> 'schedules' as sc),
  c as (
    select s.sc -> 'member' -> (p_member::text) -> 'days' as m,
      s.sc -> 'role' -> (select p.role_id from public.profiles p where p.id = p_member) -> 'days' as r
    from s),
  d as (
    select (select array_agg(distinct x::int order by x::int) from jsonb_array_elements_text(case when jsonb_typeof(c.m) = 'array' then c.m else '[]'::jsonb end) x where x ~ '^[1-7]$') as m,
      (select array_agg(distinct x::int order by x::int) from jsonb_array_elements_text(case when jsonb_typeof(c.r) = 'array' then c.r else '[]'::jsonb end) x where x ~ '^[1-7]$') as r
    from c)
  select coalesce(nullif(d.m, '{}'::int[]), nullif(d.r, '{}'::int[]), public.hr_work_dows()) from d
$$;

create or replace function public.hr_member_workday(p_member uuid, p_day date) returns boolean
language sql stable security definer set search_path = public as $$
  select extract(isodow from p_day)::int = any(case when p_member is null then public.hr_work_dows() else public.hr_member_dows(p_member) end)
$$;
revoke execute on function public.hr_member_dows(uuid), public.hr_member_workday(uuid, date) from public, anon, authenticated;
grant execute on function public.hr_member_dows(uuid), public.hr_member_workday(uuid, date) to service_role;

-- a rest day = not a work day of the member (his schedule's days, decision 7), or a confirmed holiday
create or replace function public.hr_rest_day(p_day date) returns boolean
language sql stable security definer set search_path = public as $$
  select not public.hr_member_workday(auth.uid(), p_day)
    or exists (select 1 from public.hr_holidays h where h.status = 'مؤكد' and p_day between h.day and h.day + (h.days - 1))
$$;

-- the attendance score (0087's body) on the member's own work days
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
    where public.hr_member_workday(p_member, g.d::date)
      and g.d::date not in (select public.hr_holiday_days())
      and g.d::date not in (select d from lv)
      and g.d::date >= coalesce((select m.hire_date from public.hr_members m where m.member_id = p_member), b.m0)
  )
  select case when (select count(*) from req) = 0 then null
    else round(least(1, (select count(distinct a.day) from public.hr_attendance a where a.member_id = p_member and a.day in (select d from req))::numeric
               / (select count(*) from req)) * 10) / 2 end
$$;

-- the leave days off the balance (0087's body) on the member's own work days
create or replace function public.hr_leave_used(p_member uuid, p_year int) returns numeric
language sql stable security definer set search_path = public as $$
  select count(*)::numeric from public.hr_requests r
  join public.hr_leave_types t on t.name = r.type and t.deducts
  cross join lateral generate_series(greatest(r.from_day, make_date(p_year, 1, 1)), least(r.to_day, make_date(p_year, 12, 31)), interval '1 day') g(d)
  where r.member_id = p_member and r.status = 'موافق' and public.hr_member_workday(p_member, g.d::date) and g.d::date not in (select public.hr_holiday_days())
$$;

-- the month's lines (0087's body): an unpaid leave counts the member's own work days
create or replace function public.hr_payroll_calc(p_month date)
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
  v_div numeric := public.hr_day_divisor(); -- 0087: the day rate = the salary ÷ it (24 by default)
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
    where r.status = 'موافق' and public.hr_member_workday(r.member_id, g.d::date) and g.d::date not in (select public.hr_holiday_days())
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
      round(m.s / v_div / (public.hr_day_minutes(m.id) / 60.0) * greatest(0, coalesce(ot.mins, 0) + coalesce(ota.mins, 0)) / 60, 2) as otp,
      coalesce(rest.n, 0) as rd, round(m.s / v_div * 2 * coalesce(rest.n, 0), 2) as rp,
      coalesce(unpaid.n, 0) as ud, round(m.s / v_div * coalesce(unpaid.n, 0), 2) as uc,
      round(m.al + coalesce(adj.plus, 0), 2) as al2, round(coalesce(adj.minus, 0), 2) as ded, round(coalesce(adv.per, 0), 2) as adv2,
      case when q_end then round(coalesce(ev.earned, 0) + coalesce(ex.amt, 0), 2) else 0 end as qb,
      case when q_end then 3 - coalesce(ev.n, 0) else 0 end as miss,
      case when v_dec then public.hr_leave_left(m.id, v_year) else 0 end as ld
    from mem m
    left join ot on ot.mid = m.id left join ota on ota.mid = m.id left join rest on rest.mid = m.id left join unpaid on unpaid.mid = m.id
    left join adj on adj.mid = m.id left join adv on adv.mid = m.id left join ev on ev.mid = m.id left join ex on ex.mid = m.id
  )
  select b.id, b.name, b.s, b.hb, b.paid0, b.otm, b.otp, b.rd, b.rp, b.ud, b.uc, b.al2, b.ded, b.adv2, b.qb,
    round(b.paid0 + b.otp + b.rp + b.al2 - b.ded - b.adv2 - b.uc + b.qb + round(b.s / v_div * b.ld, 2), 2), b.miss, b.ld, round(b.s / v_div * b.ld, 2)
  from base b order by b.name;
end $$;
