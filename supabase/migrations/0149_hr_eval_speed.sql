-- 0149_hr_eval_speed: the monthly evaluations list in time (the owner 22 Nov — «الصفحة فضيت»; the live log showed
-- hr_evaluations_list taking 6–12 s and once cancelled by the statement timeout, slowing every other read while it ran).
-- The cause: hr_att_score (0101) asked hr_member_workday — the member's schedule read from the settings row — and the holidays
-- set once for every day of the month, walked every approved leave of the member's whole history day by day, and
-- hr_evaluations_list called it twice per member and month (last year + this year: ~23 months × every active member).
-- Same answer, read once: the member's work days and hire date once, the holidays once as an array, the leaves clipped to the
-- month; the list calls the score once per row. Signatures, grants and results unchanged. Re-runnable: create or replace.

create or replace function public.hr_att_score(p_member uuid, p_month date) returns numeric
language sql stable security definer set search_path = public as $$
  with b as (
    select date_trunc('month', p_month)::date as m0,
           least((date_trunc('month', p_month) + interval '1 month - 1 day')::date, public.hr_today()) as m1,
           case when p_member is null then public.hr_work_dows() else public.hr_member_dows(p_member) end as dows,
           coalesce((select m.hire_date from public.hr_members m where m.member_id = p_member), date_trunc('month', p_month)::date) as hire
  ), hol as (
    select coalesce(array_agg(h.d), '{}'::date[]) as a from public.hr_holiday_days() as h(d)
  ), lv as (
    select g.d::date as d from b
    cross join public.hr_requests r
    cross join lateral generate_series(greatest(r.from_day, b.m0), least(r.to_day, b.m1), interval '1 day') g(d)
    where r.member_id = p_member and r.status = 'موافق' and r.from_day is not null and r.to_day is not null
      and r.from_day <= b.m1 and r.to_day >= b.m0
      and exists (select 1 from public.hr_leave_types t where t.name = r.type)
  ), req as (
    select g.d::date as d from b cross join hol cross join lateral generate_series(b.m0, b.m1, interval '1 day') g(d)
    where extract(isodow from g.d)::int = any(b.dows)
      and not (g.d::date = any(hol.a))
      and g.d::date not in (select d from lv)
      and g.d::date >= b.hire
  )
  select case when (select count(*) from req) = 0 then null
    else round(least(1, (select count(distinct a.day) from public.hr_attendance a where a.member_id = p_member and a.day in (select d from req))::numeric
               / (select count(*) from req)) * 10) / 2 end
$$;

create or replace function public.hr_evaluations_list(p_from date, p_to date)
returns table (member_id uuid, month date, attendance numeric, performance smallint, communication smallint, total numeric, note text, rated_by uuid, rated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare v_from date := date_trunc('month', p_from)::date; v_to date := least(date_trunc('month', p_to)::date, date_trunc('month', public.hr_today())::date);
begin
  if not public.hr_active() then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_from is null or v_to is null or v_from > v_to or v_to - v_from > 740 then raise exception 'invalid: range' using errcode = '22023'; end if;
  return query
  select p.id, g.m::date, s.att, e.performance, e.communication,
         public.hr_eval_total(s.att, e.performance, e.communication), e.note, e.rated_by, e.rated_at
  from public.profiles p
  cross join lateral generate_series(v_from, v_to, interval '1 month') g(m)
  cross join lateral (select public.hr_att_score(p.id, g.m::date) as att) s
  left join public.hr_evaluations e on e.member_id = p.id and e.month = g.m::date
  where p.status = 'active' and public.hr_can_see(p.id)
  order by p.name, g.m;
end $$;
revoke execute on function public.hr_evaluations_list(date, date) from public, anon;
grant execute on function public.hr_evaluations_list(date, date) to authenticated, service_role;
