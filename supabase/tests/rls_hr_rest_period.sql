-- Tests for 0077_hr_rest_period (phase 13 decision 66 — «طلب فترة راحة»: one day, a start time and its hours; the team ticket says the
-- family only). Depends on 0001_identity … 0077. One transaction, rolled back; NOTICE 'rls_hr_rest_period: ok' only if every case passed.
-- Live-safe: made-up members, rolled back.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000077a1', 'rp-mgr.dev@ibtekr.local', '01000077a01'),
  ('00000000-0000-4000-8000-0000000077a2', 'rp-rep.dev@ibtekr.local', '01000077a02');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u where u.email like 'rp-%.dev@ibtekr.local';
insert into public.profiles (id, name, email, phone, role_id, status, manager_id) values
  ('00000000-0000-4000-8000-0000000077a1', 'مدير الراحة', 'rp-mgr.dev@ibtekr.local', '01000077a01', 'ops', 'active', null),
  ('00000000-0000-4000-8000-0000000077a2', 'عضو الراحة', 'rp-rep.dev@ibtekr.local', '01000077a02', 'cs', 'active', '00000000-0000-4000-8000-0000000077a1');

create or replace function pg_temp.as_member(p_uid text) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;

select pg_temp.as_member('00000000-0000-4000-8000-0000000077a2');
do $$
declare v bigint; r record; t public.tickets;
begin
  v := public.hr_request_create(jsonb_build_object('type', 'فترة راحة', 'from', '2026-12-05', 'to', '2026-12-09', 'time', '13:00', 'hours', 1.5, 'note', 'دكتور'));
  select type, from_day, to_day, at_time, hours, amount, ticket_id into r from public.hr_requests_v where id = v;
  if r.type <> 'فترة راحة' or r.from_day <> '2026-12-05' or r.to_day <> '2026-12-05' or r.at_time <> '13:00' or r.hours <> 1.5 then raise exception 'case one day, the time and the hours failed'; end if;
  select * into t from public.tickets where id = r.ticket_id;
  if t.title not like 'طلب فترة راحة — عضو الراحة%' or t.title like '%13:00%' or t.description like '%دكتور%' then raise exception 'case the ticket says the family only failed'; end if;
  begin perform public.hr_request_create(jsonb_build_object('type', 'فترة راحة', 'from', '2026-12-05', 'hours', 2)); raise exception 'case no start time failed';
  exception when invalid_parameter_value then null; end;
  begin perform public.hr_request_create(jsonb_build_object('type', 'فترة راحة', 'from', '2026-12-05', 'time', '10:00', 'hours', 13)); raise exception 'case over 12 hours failed';
  exception when invalid_parameter_value then null; end;
  begin perform public.hr_request_create(jsonb_build_object('type', 'فترة راحة', 'from', '2026-12-05', 'time', '10:00')); raise exception 'case no hours failed';
  exception when invalid_parameter_value then null; end;
  begin perform public.hr_request_create(jsonb_build_object('type', 'فترة راحة', 'from', '2026-12-05', 'time', '22:00', 'hours', 4)); raise exception 'case past midnight failed';
  exception when invalid_parameter_value then null; end;
end $$;
reset role;

do $$ begin
  if has_function_privilege('anon', 'public.hr_request_create(jsonb)', 'execute') or has_function_privilege('authenticated', 'public.hr_req_family(text)', 'execute') then
    raise exception 'case the grants of 0077 failed';
  end if;
  raise notice 'rls_hr_rest_period: ok';
end $$;
rollback;
