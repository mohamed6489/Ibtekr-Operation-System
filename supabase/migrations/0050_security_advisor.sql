-- 0050_security_advisor — the live project's Security Advisor (the owner, 6 Nov: «Security Definer View — public.hr_requests_v»):
-- * hr_requests_v (0046) was a plain view, so Postgres ran it with its owner's rights (the advisor's ERROR «security_definer_view»).
--   It now runs with the reader's rights (security_invoker) over hr_requests_list(), a security definer function that keeps 0046's
--   rule word for word: the rows of hr_can_see(member), an advance's amount for sensitive.salaries F or its own member only. The
--   table stays closed to the members (no grant), and the view keeps its name and columns (IBHR reads it unchanged).
-- * The HR functions 0046 granted to authenticated never left PUBLIC / anon (the advisor's WARN
--   «anon_security_definer_function_executable»). Nothing was open — each one checks auth.uid() / has_perm, and a caller who is not
--   signed in has neither — but they are now the members' and the server's only, like every other RPC. email_for_identifier stays
--   callable before sign-in (the login by username / code — 0001).
-- * shot_prompts_touch (0030) gets its search_path (the advisor's WARN «function_search_path_mutable»).
-- Re-runnable; no data touched (the view is dropped and made again — a view holds no rows).

-- the requests as members read them (0046's rule): the rows I see in HR, an advance's amount for sensitive.salaries F or mine
create or replace function public.hr_requests_list()
returns table (id bigint, member_id uuid, type text, from_day date, to_day date, at_time time, hours numeric, amount numeric, months int,
  note text, status text, decided_by uuid, decided_at timestamptz, reason text, created_by uuid, created_at timestamptz, doc_path text)
language sql stable security definer set search_path = public as $$
  select r.id, r.member_id, r.type, r.from_day, r.to_day, r.at_time, r.hours,
    case when public.hr_salaries() or r.member_id = auth.uid() then r.amount end, r.months, r.note, r.status,
    r.decided_by, r.decided_at, r.reason, r.created_by, r.created_at, r.doc_path
  from public.hr_requests r
  where public.hr_can_see(r.member_id)
$$;

drop view if exists public.hr_requests_v;
create view public.hr_requests_v with (security_invoker = true) as
  select l.id, 'HR-' || lpad(l.id::text, 4, '0') as code, l.member_id, l.type, l.from_day, l.to_day, l.at_time, l.hours, l.amount, l.months,
    l.note, l.status, l.decided_by, l.decided_at, l.reason, l.created_by, l.created_at, l.doc_path
  from public.hr_requests_list() l;
revoke all on public.hr_requests_v from anon, authenticated;
grant select on public.hr_requests_v to authenticated, service_role;

-- the HR RPCs and helpers 0046 granted to authenticated: closed to PUBLIC / anon, granted again to the members and the server
revoke execute on function public.hr_rest_day(date), public.hr_active(), public.hr_is_manager_of(uuid), public.hr_can_see(uuid),
  public.hr_can_decide(uuid), public.hr_salaries(), public.hr_editor(), public.hr_shift_now(), public.hr_clock_in(),
  public.hr_clock_out(text, timestamptz), public.hr_attendance_set(uuid, date, time, time, boolean, text), public.hr_request_types(),
  public.hr_request_create(jsonb), public.hr_request_decide(bigint, text, text), public.hr_request_cancel(bigint),
  public.hr_overtime_decide(bigint, text, int, text), public.hr_rate_month(uuid, date, jsonb, text), public.hr_payroll_step(date, text),
  public.hr_payroll_pay(date, text), public.hr_requests_list() from public, anon;
grant execute on function public.hr_rest_day(date), public.hr_active(), public.hr_is_manager_of(uuid), public.hr_can_see(uuid),
  public.hr_can_decide(uuid), public.hr_salaries(), public.hr_editor(), public.hr_shift_now(), public.hr_clock_in(),
  public.hr_clock_out(text, timestamptz), public.hr_attendance_set(uuid, date, time, time, boolean, text), public.hr_request_types(),
  public.hr_request_create(jsonb), public.hr_request_decide(bigint, text, text), public.hr_request_cancel(bigint),
  public.hr_overtime_decide(bigint, text, int, text), public.hr_rate_month(uuid, date, jsonb, text), public.hr_payroll_step(date, text),
  public.hr_payroll_pay(date, text), public.hr_requests_list() to authenticated, service_role;

-- the prompts library's stamp trigger (0030) with a fixed search_path
alter function public.shot_prompts_touch() set search_path = public;
