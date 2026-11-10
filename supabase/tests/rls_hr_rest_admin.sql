-- Tests for 0070_hr_rest_day_admin (phase 13 decision 32 — a rest day or an official holiday worked is the admins' to approve: its
-- request ticket goes to «مدير النظام», only the admins get the bell, the direct manager cannot decide it, an admin can; an ordinary
-- overtime stays the direct manager's — rls_hr_ot_ticket). Depends on 0001_identity … 0070. Runs in one transaction and rolls back;
-- prints NOTICE 'rls_hr_rest_admin: ok' only if every case passed. Live-safe: its made-up members and rows are rolled back.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000070a1', 'ra-adm.dev@ibtekr.local', '01000070a01'),
  ('00000000-0000-4000-8000-0000000070a2', 'ra-mgr.dev@ibtekr.local', '01000070a02'),
  ('00000000-0000-4000-8000-0000000070a3', 'ra-rep.dev@ibtekr.local', '01000070a03');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u where u.email like 'ra-%.dev@ibtekr.local';
insert into public.profiles (id, name, email, phone, role_id, status, manager_id) values
  ('00000000-0000-4000-8000-0000000070a1', 'أدمن الراحة', 'ra-adm.dev@ibtekr.local', '01000070a01', 'admin', 'active', null),
  ('00000000-0000-4000-8000-0000000070a2', 'مدير الراحة', 'ra-mgr.dev@ibtekr.local', '01000070a02', 'ops', 'active', null),
  ('00000000-0000-4000-8000-0000000070a3', 'عضو الراحة', 'ra-rep.dev@ibtekr.local', '01000070a03', 'cs', 'active', '00000000-0000-4000-8000-0000000070a2');

create temp table ra (k text primary key, v text) on commit drop;
grant all on ra to authenticated;

create or replace function pg_temp.as_member(p_uid text) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;

-- the member's session through the clock, moved (as the server) to a Friday (a rest day) two hours ago
select pg_temp.as_member('00000000-0000-4000-8000-0000000070a3');
insert into ra values ('s', public.hr_clock_in() ->> 'id');
reset role;
update public.hr_attendance set day = '2026-11-06', in_at = now() - interval '2 hours' where id = (select v::bigint from ra where k = 's');

-- ================================================================ the ticket goes to «مدير النظام», the bell to the admins only

select pg_temp.as_member('00000000-0000-4000-8000-0000000070a3');
do $$
declare t text; r jsonb;
begin
  t := public.hr_overtime_begin() ->> 'ticket';
  insert into ra values ('t', t);
  r := public.hr_clock_out();
  if not coalesce((r ->> 'rest_day')::boolean, false) or r ->> 'ticket' <> t then raise exception 'case the rest-day row carries the ticket failed (%)', r; end if;
  insert into ra values ('o', r ->> 'overtime_id');
end $$;
reset role;
do $$
declare v_t public.tickets; v_id bigint := (select v::bigint from ra where k = 't');
begin
  select * into v_t from public.tickets where id = v_id;
  if v_t.assignee_role <> 'مدير النظام' or v_t.title not like 'يوم راحة/عطلة — %' or v_t.description not like '%موافقة الأدمن%' then
    raise exception 'case a rest day goes to «مدير النظام», not the manager''s role failed (%, %)', v_t.assignee_role, v_t.description;
  end if;
  if (select count(*) from public.alerts where entity_id = 'ot:' || v_id and role_id = 'admin' and body = 'مستني موافقة الأدمن') <> 1
     or exists (select 1 from public.alerts where entity_id = 'ot:' || v_id and user_id = '00000000-0000-4000-8000-0000000070a2') then
    raise exception 'case only the admins get the rest day''s bell failed';
  end if;
end $$;

-- ================================================================ the direct manager cannot decide it; an admin can, and the ticket closes

select pg_temp.as_member('00000000-0000-4000-8000-0000000070a2');
do $$ begin
  begin perform public.hr_overtime_decide((select v::bigint from ra where k = 'o'), 'add'); raise exception 'case the direct manager does not decide a rest day failed';
  exception when insufficient_privilege then null; end;
  begin perform public.hr_overtime_decide((select v::bigint from ra where k = 'o'), 'reject', null, 'لأ'); raise exception 'case the direct manager does not refuse a rest day failed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  if (select status from public.hr_overtime where id = (select v::bigint from ra where k = 'o')) <> 'مستني' then raise exception 'case the refused decision left it waiting failed'; end if;
end $$;
select pg_temp.as_member('00000000-0000-4000-8000-0000000070a1');
do $$ begin
  if public.hr_overtime_decide((select v::bigint from ra where k = 'o'), 'add') <> 'اتضاف' then raise exception 'case an admin approves a rest day failed'; end if;
  if (select status || '/' || resolution_outcome from public.tickets where id = (select v::bigint from ra where k = 't')) <> 'closed/اتحلت المشكلة' then
    raise exception 'case the admin''s decision closes the ticket failed';
  end if;
end $$;

reset role;
do $$ begin raise notice 'rls_hr_rest_admin: ok'; end $$;
rollback;
