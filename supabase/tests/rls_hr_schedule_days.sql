-- Tests for 0101_hr_schedule_days (owner batch 2 decision 7): «وقت عمل مخصص» for a role or a member has its own work days.
-- One transaction, rolled back; NOTICE 'rls_hr_schedule_days: ok' only if every case passed. Live-safe: made-up members and rows.
-- 2026-11-06 is a Friday (isodow 5), 2026-11-07 a Saturday (6), 2026-11-08 a Sunday (7), 2026-11-09 a Monday (1).
-- * hr_member_dows: the member's schedule days, else his role's, else the settings' work days (a schedule with no days keeps them)
-- * hr_rest_day(day) = not a work day of the signed-in member, or a holiday; no member = the settings' days
-- * hr_leave_used counts the member's own work days; the new helpers are service_role only

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000101a1', 'sd-own.dev@ibtekr.local', '01000101a01'),
  ('00000000-0000-4000-8000-0000000101a2', 'sd-role.dev@ibtekr.local', '01000101a02'),
  ('00000000-0000-4000-8000-0000000101a3', 'sd-plain.dev@ibtekr.local', '01000101a03'),
  ('00000000-0000-4000-8000-0000000101a4', 'sd-hours.dev@ibtekr.local', '01000101a04');
insert into public.profiles (id, name, email, phone, role_id, status) values
  ('00000000-0000-4000-8000-0000000101a1', 'عضو بأيامه', 'sd-own.dev@ibtekr.local', '01000101a01', 'cs', 'active'),
  ('00000000-0000-4000-8000-0000000101a2', 'عضو العمليات', 'sd-role.dev@ibtekr.local', '01000101a02', 'ops', 'active'),
  ('00000000-0000-4000-8000-0000000101a3', 'عضو عادي', 'sd-plain.dev@ibtekr.local', '01000101a03', 'cs', 'active'),
  ('00000000-0000-4000-8000-0000000101a4', 'عضو بساعاته بس', 'sd-hours.dev@ibtekr.local', '01000101a04', 'ops', 'active');

delete from public.settings where section = 'hr';
insert into public.settings (section, data) values ('hr', jsonb_build_object('workDays', jsonb_build_array(1, 2, 3, 4, 7), 'workFrom', '09:00', 'workTo', '17:00',
  'schedules', jsonb_build_object(
    'role', jsonb_build_object('ops', jsonb_build_object('from', '10:00', 'to', '18:00', 'days', jsonb_build_array(1, 2, 3, 4, 5, 6))),
    'member', jsonb_build_object(
      '00000000-0000-4000-8000-0000000101a1', jsonb_build_object('from', '12:00', 'to', '20:00', 'days', jsonb_build_array(5, 6, '6', 9, 'x')),
      '00000000-0000-4000-8000-0000000101a4', jsonb_build_object('from', '08:00', 'to', '14:00')))));

do $$ begin
  if public.hr_member_dows('00000000-0000-4000-8000-0000000101a1') <> array[5, 6] then raise exception 'case the member''s own days (bad values dropped) failed'; end if;
  if public.hr_member_dows('00000000-0000-4000-8000-0000000101a2') <> array[1, 2, 3, 4, 5, 6] then raise exception 'case the role''s days failed'; end if;
  if public.hr_member_dows('00000000-0000-4000-8000-0000000101a3') <> array[1, 2, 3, 4, 7] then raise exception 'case the settings'' days failed'; end if;
  if public.hr_member_dows('00000000-0000-4000-8000-0000000101a4') <> array[1, 2, 3, 4, 5, 6] then raise exception 'case a member schedule with no days takes the role''s failed'; end if;
  if not public.hr_member_workday('00000000-0000-4000-8000-0000000101a1', '2026-11-06') or public.hr_member_workday('00000000-0000-4000-8000-0000000101a1', '2026-11-08') then
    raise exception 'case the member works Friday and rests Sunday failed'; end if;
  if public.hr_member_workday(null, '2026-11-06') or not public.hr_member_workday(null, '2026-11-08') then raise exception 'case no member = the settings'' days failed'; end if;
  if not public.hr_rest_day('2026-11-06') or not public.hr_rest_day('2026-11-07') or public.hr_rest_day('2026-11-08') then raise exception 'case no signed-in member rests on the settings'' days failed'; end if;
  if has_function_privilege('authenticated', 'public.hr_member_dows(uuid)', 'EXECUTE') or has_function_privilege('anon', 'public.hr_member_workday(uuid, date)', 'EXECUTE') then
    raise exception 'case the helpers are service_role only failed'; end if;
end $$;

-- the signed-in member's own rest day (the clock / overtime callers)
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000101a1', 'role', 'authenticated')::text, true);
do $$ begin
  if public.hr_rest_day('2026-11-06') then raise exception 'case Friday is a work day of his failed'; end if;
  if not public.hr_rest_day('2026-11-08') or not public.hr_rest_day('2026-11-09') then raise exception 'case Sunday and Monday are his rest days failed'; end if;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000101a3', 'role', 'authenticated')::text, true);
do $$ begin
  if not public.hr_rest_day('2026-11-06') or public.hr_rest_day('2026-11-08') then raise exception 'case a plain member rests on the settings'' days failed'; end if;
end $$;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- the leave days off the balance: Thursday 5 Nov – Monday 9 Nov
insert into public.hr_requests (member_id, type, from_day, to_day, status, created_by) values
  ('00000000-0000-4000-8000-0000000101a1', 'إجازة سنوية', '2026-11-05', '2026-11-09', 'موافق', '00000000-0000-4000-8000-0000000101a1'),
  ('00000000-0000-4000-8000-0000000101a3', 'إجازة سنوية', '2026-11-05', '2026-11-09', 'موافق', '00000000-0000-4000-8000-0000000101a3');
do $$ begin
  if public.hr_leave_used('00000000-0000-4000-8000-0000000101a1', 2026) <> 2 then raise exception 'case his leave counts Friday and Saturday failed (%)', public.hr_leave_used('00000000-0000-4000-8000-0000000101a1', 2026); end if;
  if public.hr_leave_used('00000000-0000-4000-8000-0000000101a3', 2026) <> 3 then raise exception 'case the plain leave counts Thursday, Sunday and Monday failed (%)', public.hr_leave_used('00000000-0000-4000-8000-0000000101a3', 2026); end if;
end $$;

do $$ begin raise notice 'rls_hr_schedule_days: ok'; end $$;
rollback;
