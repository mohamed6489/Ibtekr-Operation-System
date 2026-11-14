-- Tests for 0087_hr_hours (owner batch 14 Nov decision 7 — the work days, the official hours, a custom time for a department / a member,
-- and the day rate from the settings row «hr»). Depends on 0001_identity … 0087_hr_hours. Runs in one transaction and rolls back; prints
-- NOTICE 'rls_hr_hours: ok' only if every case passed. Live-safe: its made-up members and rows are rolled back. D is a Monday, F a Friday,
-- U a Sunday.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000087a1', 'hh-adm.dev@ibtekr.local', '01000087a01'),
  ('00000000-0000-4000-8000-0000000087a2', 'hh-dep.dev@ibtekr.local', '01000087a02'),
  ('00000000-0000-4000-8000-0000000087a3', 'hh-own.dev@ibtekr.local', '01000087a03');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u where u.email like 'hh-%.dev@ibtekr.local';
insert into public.profiles (id, name, email, phone, role_id, status, manager_id, dept) values
  ('00000000-0000-4000-8000-0000000087a1', 'أدمن الساعات', 'hh-adm.dev@ibtekr.local', '01000087a01', 'admin', 'active', null, 'الإدارة'),
  ('00000000-0000-4000-8000-0000000087a2', 'عضو قسم', 'hh-dep.dev@ibtekr.local', '01000087a02', 'cs', 'active', null, 'خدمة العملاء'),
  ('00000000-0000-4000-8000-0000000087a3', 'عضو مخصوص', 'hh-own.dev@ibtekr.local', '01000087a03', 'cs', 'active', null, 'خدمة العملاء');

-- ================================================================ nothing set: Sunday–Thursday, 8 hours, ÷ 24
delete from public.settings where section = 'hr';
do $$ begin
  if public.hr_day_minutes('00000000-0000-4000-8000-0000000087a2') <> 480 then raise exception 'case the default day is 8 hours failed'; end if;
  if public.hr_day_divisor() <> 24 then raise exception 'case the default divisor is 24 failed'; end if;
  if not public.hr_rest_day('2026-11-06') or public.hr_rest_day('2026-11-08') or public.hr_rest_day('2026-11-02') then raise exception 'case Friday rests, Sunday and Monday work failed'; end if;
  if public.hr_span('09:00', '17:00') <> 480 or public.hr_span('22:00', '06:00') <> 480 or public.hr_span('09:00', '09:00') is not null
     or public.hr_span('9:00', '17:00') is not null or public.hr_span('09:00', '09:30') is not null then raise exception 'case the span of two times failed'; end if;
end $$;

-- ================================================================ the settings: Monday–Friday, 10–16 official, a department 09–15, a member 08–18, ÷ 30
insert into public.settings (section, data) values ('hr', jsonb_build_object(
  'workDays', '[1,2,3,4,5]'::jsonb, 'workFrom', '10:00', 'workTo', '16:00', 'dayDivisor', '30',
  'schedules', jsonb_build_object('dept', jsonb_build_object('خدمة العملاء', jsonb_build_object('from', '09:00', 'to', '15:30')),
                                  'member', jsonb_build_object('00000000-0000-4000-8000-0000000087a3', jsonb_build_object('from', '08:00', 'to', '18:00')))))
  on conflict (section) do update set data = excluded.data;
do $$ begin
  if public.hr_day_minutes('00000000-0000-4000-8000-0000000087a1') <> 360 then raise exception 'case the official hours (no department time) failed'; end if;
  if public.hr_day_minutes('00000000-0000-4000-8000-0000000087a2') <> 390 then raise exception 'case the department''s time failed'; end if;
  if public.hr_day_minutes('00000000-0000-4000-8000-0000000087a3') <> 600 then raise exception 'case the member''s own time wins failed'; end if;
  if public.hr_schedule('00000000-0000-4000-8000-0000000087a3') ->> 'kind' <> 'member' or public.hr_schedule('00000000-0000-4000-8000-0000000087a2') ->> 'kind' <> 'dept'
     or public.hr_schedule('00000000-0000-4000-8000-0000000087a1') ->> 'kind' <> 'general' then raise exception 'case the schedule says where it came from failed'; end if;
  if public.hr_day_divisor() <> 30 then raise exception 'case the divisor from the settings failed'; end if;
  if public.hr_rest_day('2026-11-06') or not public.hr_rest_day('2026-11-08') then raise exception 'case Friday works and Sunday rests with Monday–Friday failed'; end if;
end $$;
-- a broken value falls back
update public.settings set data = data || '{"dayDivisor":"99","workDays":["x"],"workFrom":"25:00"}'::jsonb where section = 'hr';
do $$ begin
  if public.hr_day_divisor() <> 24 then raise exception 'case a divisor out of 20–31 is 24 failed'; end if;
  if public.hr_rest_day('2026-11-02') or not public.hr_rest_day('2026-11-06') then raise exception 'case no valid work day = Sunday–Thursday failed'; end if;
  if public.hr_day_minutes('00000000-0000-4000-8000-0000000087a1') <> 480 then raise exception 'case a broken official time = 8 hours failed'; end if;
end $$;

-- ================================================================ the clock: the overtime starts past the member's own day (10 hours)
update public.settings set data = data || '{"workDays":[1,2,3,4,5,7]}'::jsonb where section = 'hr';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000087a3","role":"authenticated"}', true);
create temp table hh (k text primary key, v text) on commit drop;
insert into hh values ('s', public.hr_clock_in() ->> 'id');
reset role;
update public.hr_attendance set day = '2026-11-02', in_at = now() - interval '9 hours' where id = (select v::bigint from hh where k = 's');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000087a3","role":"authenticated"}', true);
do $$
declare r jsonb;
begin
  r := public.hr_clock_out('شغل');
  if (r ->> 'overtime')::int <> 0 then raise exception 'case 9 hours of a 10-hour day are no overtime failed (%)', r; end if;
end $$;
reset role;

-- ================================================================ the doors: the helpers are the server's
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000087a2","role":"authenticated"}', true);
do $$ begin
  begin perform public.hr_day_minutes('00000000-0000-4000-8000-0000000087a3'); raise exception 'case a member reads another''s day failed';
  exception when insufficient_privilege then null; end;
  begin perform public.hr_schedule('00000000-0000-4000-8000-0000000087a3'); raise exception 'case a member calls hr_schedule failed';
  exception when insufficient_privilege then null; end;
  begin perform public.hr_day_divisor(); raise exception 'case a member calls hr_day_divisor failed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

do $$ begin raise notice 'rls_hr_hours: ok'; end $$;
rollback;
