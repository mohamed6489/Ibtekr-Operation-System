-- 0087 — owner batch 14 Nov (docs/superpowers/plans/2026-11-14-owner-batch.md, decision 7): the work days, the official hours, a custom
-- time for a department or a member, and the day rate — all from «الإعدادات › الموارد البشرية» (the settings row «hr», the admin writes it
-- through IBHR.saveSettings — the 0002 policies; every member reads it with hr_settings()):
--   workDays   [isodow, …]   the work days (1 = Monday … 7 = Sunday; default Sunday–Thursday). The others are rest days: working on one = a
--                            rest-day overtime (0068/0069) and they do not count in the attendance score, the leave days or the unpaid cut.
--   workFrom / workTo 'HH:MM' the official hours (default 09:00–17:00) → the minutes asked of a day.
--   schedules  { dept: { <dept>: { from, to } }, member: { <member uuid>: { from, to } } } — a custom time: the member's, else his
--              department's, else the official one. No lateness (flexible attendance, 0068): the time is the day's length (the overtime
--              starts past it) and the start reminder of the clock.
--   dayDivisor the day rate = the salary ÷ it (default 24, 20–31); the hour = the day rate ÷ the member's day hours.
-- The functions that read 480 / Sunday–Thursday / ÷ 24 are replaced with the same bodies on these helpers: hr_rest_day, hr_clock_out (0069),
-- hr_att_score, hr_leave_used and hr_payroll_calc (0083). Re-runnable: create or replace.

-- 'HH:MM' → minutes of the day, else null
create or replace function public.hr_hm(p text) returns int
language sql immutable set search_path = public as $$
  select case when p ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then split_part(p, ':', 1)::int * 60 + split_part(p, ':', 2)::int end
$$;

-- the minutes between two times (past midnight = the next day), 1–16 hours, else null
create or replace function public.hr_span(p_from text, p_to text) returns int
language sql immutable set search_path = public as $$
  select case when d between 60 and 960 then d end
  from (select (public.hr_hm(p_to) - public.hr_hm(p_from) + 1440) % 1440 as d) x
$$;

-- the work days (isodow) of the settings, Sunday–Thursday when none is set
create or replace function public.hr_work_dows() returns int[]
language sql stable security definer set search_path = public as $$
  select coalesce(nullif((select array_agg(distinct x::int order by x::int)
    from public.settings s, jsonb_array_elements_text(case when jsonb_typeof(s.data -> 'workDays') = 'array' then s.data -> 'workDays' else '[]'::jsonb end) x
    where s.section = 'hr' and x ~ '^[1-7]$'), '{}'::int[]), array[1, 2, 3, 4, 7])
$$;

-- is the day one of the work days (the weekday only — the holidays are checked where they were)
create or replace function public.hr_workday_dow(p_day date) returns boolean
language sql stable security definer set search_path = public as $$
  select extract(isodow from p_day)::int = any(public.hr_work_dows())
$$;

-- the day rate's divisor (20–31, else 24)
create or replace function public.hr_day_divisor() returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select case when (s.data ->> 'dayDivisor') ~ '^[0-9]{2}$' and (s.data ->> 'dayDivisor')::int between 20 and 31 then (s.data ->> 'dayDivisor')::numeric end
    from public.settings s where s.section = 'hr'), 24)
$$;

-- a member's time: { from, to, kind: member | dept | general }
create or replace function public.hr_schedule(p_member uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with s as (select coalesce((select data from public.settings where section = 'hr'), '{}'::jsonb) as d),
  c as (
    select s.d -> 'schedules' -> 'member' -> (p_member::text) as m,
      s.d -> 'schedules' -> 'dept' -> (select p.dept from public.profiles p where p.id = p_member) as g,
      jsonb_build_object('from', s.d ->> 'workFrom', 'to', s.d ->> 'workTo') as o
    from s)
  select case
    when public.hr_span(c.m ->> 'from', c.m ->> 'to') is not null then jsonb_build_object('from', c.m ->> 'from', 'to', c.m ->> 'to', 'kind', 'member')
    when public.hr_span(c.g ->> 'from', c.g ->> 'to') is not null then jsonb_build_object('from', c.g ->> 'from', 'to', c.g ->> 'to', 'kind', 'dept')
    when public.hr_span(c.o ->> 'from', c.o ->> 'to') is not null then jsonb_build_object('from', c.o ->> 'from', 'to', c.o ->> 'to', 'kind', 'general')
    else '{"from":"09:00","to":"17:00","kind":"general"}'::jsonb end
  from c
$$;

-- the minutes a member's day asks (480 when nothing is set)
create or replace function public.hr_day_minutes(p_member uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(public.hr_span(s ->> 'from', s ->> 'to'), 480) from (select public.hr_schedule(p_member) as s) x
$$;

revoke execute on function public.hr_work_dows(), public.hr_workday_dow(date), public.hr_day_divisor(), public.hr_schedule(uuid), public.hr_day_minutes(uuid) from public, anon, authenticated;
grant execute on function public.hr_work_dows(), public.hr_workday_dow(date), public.hr_day_divisor(), public.hr_schedule(uuid), public.hr_day_minutes(uuid) to service_role;
revoke execute on function public.hr_hm(text), public.hr_span(text, text) from public, anon;
grant execute on function public.hr_hm(text), public.hr_span(text, text) to authenticated, service_role;

-- a rest day = not a work day of the settings, or a confirmed holiday (0046's body on the settings' days)
create or replace function public.hr_rest_day(p_day date) returns boolean
language sql stable security definer set search_path = public as $$
  select not public.hr_workday_dow(p_day)
    or exists (select 1 from public.hr_holidays h where h.status = 'مؤكد' and p_day between h.day and h.day + (h.days - 1))
$$;

-- the end of my session (0069's body): the overtime starts past MY day's minutes (hr_day_minutes) instead of 480
create or replace function public.hr_clock_out(p_ot_note text default null, p_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_row public.hr_attendance; v_out timestamptz; v_worked int; v_shift int := public.hr_day_minutes(auth.uid()); v_before int; v_total int; v_part int; v_since int; v_ot bigint;
  v_t bigint; v_rest boolean; v_note text := nullif(btrim(coalesce(p_ot_note, '')), '');
begin
  if not public.hr_active() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_row from public.hr_attendance where member_id = auth.uid() and out_at is null and in_at > now() - interval '20 hours'
    order by in_at desc limit 1 for update;
  if not found then raise exception 'invalid: no open shift' using errcode = '22023'; end if;
  v_out := least(now(), coalesce(p_at, now()));
  if v_out < v_row.in_at then raise exception 'invalid: at' using errcode = '22023'; end if;
  if v_note is not null and char_length(v_note) > 300 then raise exception 'invalid: note' using errcode = '22023'; end if;
  update public.hr_attendance set out_at = v_out, updated_at = now() where id = v_row.id;
  v_worked := floor(extract(epoch from (v_out - v_row.in_at)) / 60);
  v_before := public.hr_day_done(auth.uid(), v_row.day, v_row.id);
  v_total := v_before + v_worked;
  v_rest := public.hr_rest_day(v_row.day);
  if v_rest then
    v_ot := public.hr_rest_day_add(auth.uid(), v_row.day, v_row.in_at, v_out, coalesce(v_note, 'شغل يوم راحة / عطلة'));
    if v_ot is not null then
      select ticket_id into v_t from public.hr_overtime where id = v_ot;
      if v_t is null then
        v_t := coalesce(v_row.ot_ticket, public.hr_ot_ticket(auth.uid(), v_row.day, true));
        update public.hr_overtime set ticket_id = v_t where id = v_ot;
      elsif v_row.ot_ticket is not null and v_row.ot_ticket <> v_t then
        perform public.hr_ot_ticket_close(v_row.ot_ticket, 'مكرر', 'الطلب في التذكرة TKT-' || lpad(v_t::text, 4, '0'));
      end if;
      perform public.hr_ot_event(v_t, 'جلسة يوم راحة/عطلة: ' || v_worked || ' دقيقة');
    end if;
    return jsonb_build_object('worked', v_worked, 'day_total', v_total, 'overtime_id', v_ot, 'overtime', 0, 'rest_day', true, 'ticket', v_t);
  end if;
  v_since := case when v_row.ot_from is null then 0 else greatest(floor(extract(epoch from (v_out - greatest(v_row.ot_from, v_row.in_at))) / 60)::int, 0) end;
  v_part := least(v_worked, greatest(greatest(v_total - v_shift, 0), v_since));
  if v_note is not null and v_part > 0 then
    v_t := coalesce(v_row.ot_ticket, public.hr_ot_ticket(auth.uid(), v_row.day, false));
    insert into public.hr_overtime (member_id, day, start_at, end_at, minutes, note, ticket_id)
    values (auth.uid(), v_row.day, v_out - make_interval(mins => v_part), v_out, v_part, v_note, v_t)
    returning id into v_ot;
    perform public.hr_ot_event(v_t, 'الوقت الإضافي: ' || v_part || ' دقيقة — مستني موافقة المدير المباشر (التفاصيل في كارت الطلب هنا)');
  elsif v_row.ot_ticket is not null then
    perform public.hr_ot_event(v_row.ot_ticket, 'الدوام خلص من غير وقت إضافي يتسجل');
    perform public.hr_ot_ticket_close(v_row.ot_ticket, 'مش مشكلة', 'مافيش وقت إضافي اتسجل');
  end if;
  return jsonb_build_object('worked', v_worked, 'day_total', v_total, 'overtime_id', v_ot, 'overtime', case when v_ot is null then 0 else v_part end, 'ticket', v_t);
end $$;

-- the attendance score (0083's body) on the settings' work days
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
    where public.hr_workday_dow(g.d::date)
      and g.d::date not in (select public.hr_holiday_days())
      and g.d::date not in (select d from lv)
      and g.d::date >= coalesce((select m.hire_date from public.hr_members m where m.member_id = p_member), b.m0)
  )
  select case when (select count(*) from req) = 0 then null
    else round(least(1, (select count(distinct a.day) from public.hr_attendance a where a.member_id = p_member and a.day in (select d from req))::numeric
               / (select count(*) from req)) * 10) / 2 end
$$;

-- the leave days off the balance (0083's body) on the settings' work days
create or replace function public.hr_leave_used(p_member uuid, p_year int) returns numeric
language sql stable security definer set search_path = public as $$
  select count(*)::numeric from public.hr_requests r
  join public.hr_leave_types t on t.name = r.type and t.deducts
  cross join lateral generate_series(greatest(r.from_day, make_date(p_year, 1, 1)), least(r.to_day, make_date(p_year, 12, 31)), interval '1 day') g(d)
  where r.member_id = p_member and r.status = 'موافق' and public.hr_workday_dow(g.d::date) and g.d::date not in (select public.hr_holiday_days())
$$;

-- the month's lines (0083's body): the work days, the day rate ÷ dayDivisor, the overtime hour = the day rate ÷ the member's day hours
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
    where r.status = 'موافق' and public.hr_workday_dow(g.d::date) and g.d::date not in (select public.hr_holiday_days())
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
