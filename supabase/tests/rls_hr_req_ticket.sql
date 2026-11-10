-- Tests for 0071_hr_request_ticket (phase 13 decision 33 — an HR request is a team ticket: filed = an internal ticket to the direct
-- manager's role with a bell to the admins and the manager; the ticket carries the request's family only (no leave sub-type, dates,
-- note, amount or refusal reason); the decision and the cancel close it; hr_requests_v gives its ticket). Depends on 0001_identity … 0071.
-- Runs in one transaction and rolls back; prints NOTICE 'rls_hr_req_ticket: ok' only if every case passed. Live-safe: its made-up
-- members and rows are rolled back.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000071a1', 'rq-adm.dev@ibtekr.local', '01000071a01'),
  ('00000000-0000-4000-8000-0000000071a2', 'rq-mgr.dev@ibtekr.local', '01000071a02'),
  ('00000000-0000-4000-8000-0000000071a3', 'rq-rep.dev@ibtekr.local', '01000071a03'),
  ('00000000-0000-4000-8000-0000000071a4', 'rq-other.dev@ibtekr.local', '01000071a04');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u where u.email like 'rq-%.dev@ibtekr.local';
insert into public.profiles (id, name, email, phone, role_id, status, manager_id) values
  ('00000000-0000-4000-8000-0000000071a1', 'أدمن الطلبات', 'rq-adm.dev@ibtekr.local', '01000071a01', 'admin', 'active', null),
  ('00000000-0000-4000-8000-0000000071a2', 'مدير الطلبات', 'rq-mgr.dev@ibtekr.local', '01000071a02', 'ops', 'active', null),
  ('00000000-0000-4000-8000-0000000071a3', 'عضو الطلبات', 'rq-rep.dev@ibtekr.local', '01000071a03', 'cs', 'active', '00000000-0000-4000-8000-0000000071a2'),
  ('00000000-0000-4000-8000-0000000071a4', 'زميل الطلبات', 'rq-other.dev@ibtekr.local', '01000071a04', 'accounts', 'active', null);

create temp table rq (k text primary key, v text) on commit drop;
grant all on rq to authenticated;
create or replace function pg_temp.as_member(p_uid text) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;

-- ================================================================ filed: a ticket to the manager's role, with no HR detail

select pg_temp.as_member('00000000-0000-4000-8000-0000000071a3');
do $$
declare v_l bigint; v_a bigint; v_w bigint;
begin
  v_l := public.hr_request_create(jsonb_build_object('type', 'إجازة عارضة', 'from', '2026-12-01', 'to', '2026-12-02', 'note', 'فرح أختي'));
  v_a := public.hr_request_create(jsonb_build_object('type', 'سُلفة', 'amount', 4321, 'months', 3, 'note', 'مصاريف علاج'));
  v_w := public.hr_request_create(jsonb_build_object('type', 'شغل عن بُعد', 'from', '2026-12-03'));
  insert into rq values ('l', v_l), ('a', v_a), ('w', v_w);
  insert into rq select 'tl', ticket_id::text from public.hr_requests_v where id = v_l;
  insert into rq select 'ta', ticket_id::text from public.hr_requests_v where id = v_a;
  insert into rq select 'tw', ticket_id::text from public.hr_requests_v where id = v_w;
  if (select count(*) from rq where k like 't_' and v is not null) <> 3 then raise exception 'case every request has its ticket (hr_requests_v) failed'; end if;
  if not exists (select 1 from public.tickets where id = (select v::bigint from rq where k = 'tl')) then raise exception 'case the member sees the ticket opened in their name failed'; end if;
  begin perform public.hr_req_ticket(v_l); raise exception 'case the ticket helper is the server''s failed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$
declare t public.tickets; v_txt text;
begin
  select * into t from public.tickets where id = (select v::bigint from rq where k = 'tl');
  if t.type <> 'internal' or t.assignee_role <> 'اللوجستيك والشحن' or t.created_by <> '00000000-0000-4000-8000-0000000071a3' or t.status <> 'open' or t.title not like 'طلب إجازة — عضو الطلبات · %' then
    raise exception 'case a leave is a ticket «طلب إجازة» to the direct manager''s role failed (%, %)', t.assignee_role, t.title;
  end if;
  if (select title from public.tickets where id = (select v::bigint from rq where k = 'ta')) not like 'طلب موارد بشرية — %' -- an advance is not named (security review)
     or (select title from public.tickets where id = (select v::bigint from rq where k = 'tw')) not like 'طلب شغل عن بُعد — %' then
    raise exception 'case the family in the title failed';
  end if;
  -- nothing of the request's detail in any of the three tickets or their events
  select string_agg(coalesce(x.title, '') || ' ' || coalesce(x.description, ''), ' ') into v_txt from public.tickets x where x.id in (select v::bigint from rq where k like 't_');
  v_txt := v_txt || ' ' || coalesce((select string_agg(e.text, ' ') from public.ticket_events e where e.ticket_id in (select v::bigint from rq where k like 't_')), '');
  if v_txt like '%عارضة%' or v_txt like '%فرح%' or v_txt like '%4321%' or v_txt like '%4,321%' or v_txt like '%علاج%' or v_txt like '%سُلفة%' or v_txt like '%سلفة%' or v_txt like '%01/12%' or v_txt like '%2026-12%' then
    raise exception 'case the ticket carries no HR detail failed (%)', v_txt;
  end if;
  if (select count(*) from public.alerts where kind = 'hr.request' and entity_id = 'rq:' || (select v from rq where k = 'tl') and role_id = 'admin') <> 1
     or (select count(*) from public.alerts where kind = 'hr.request' and entity_id = 'rq:' || (select v from rq where k = 'tl') and user_id = '00000000-0000-4000-8000-0000000071a2') <> 1 then
    raise exception 'case the admins and the direct manager get the bell failed';
  end if;
end $$;

-- ================================================================ a colleague of another role does not see it

select pg_temp.as_member('00000000-0000-4000-8000-0000000071a4');
do $$ begin
  if exists (select 1 from public.tickets where id = (select v::bigint from rq where k = 'tl')) then raise exception 'case a colleague of another role (tickets.view P) does not see the ticket failed'; end if;
  if exists (select 1 from public.hr_requests_v where id = (select v::bigint from rq where k = 'l')) then raise exception 'case a colleague does not see the request failed'; end if;
end $$;

-- ================================================================ the manager decides: the ticket closes, the reason stays out of it

select pg_temp.as_member('00000000-0000-4000-8000-0000000071a2');
do $$
declare t public.tickets;
begin
  if public.hr_request_decide((select v::bigint from rq where k = 'l'), 'موافق') <> 'موافق' then raise exception 'case the manager approves failed'; end if;
  select * into t from public.tickets where id = (select v::bigint from rq where k = 'tl');
  if t.status <> 'closed' or t.resolution_outcome <> 'اتحلت المشكلة' or t.closed_by <> auth.uid() then raise exception 'case the approval closes the ticket failed (%)', t.status; end if;
  perform public.hr_request_decide((select v::bigint from rq where k = 'a'), 'مرفوض', 'الميزانية مقفولة الشهر ده');
  select * into t from public.tickets where id = (select v::bigint from rq where k = 'ta');
  if t.status <> 'closed' or t.resolution_outcome <> 'مش مشكلة' or coalesce(t.resolution_note, '') like '%الميزانية%' then raise exception 'case a refusal closes the ticket without its reason failed'; end if;
  if exists (select 1 from public.ticket_events e where e.ticket_id = t.id and e.text like '%الميزانية%') then raise exception 'case the refusal reason stays out of the ticket failed'; end if;
end $$;

-- ================================================================ the member cancels: the ticket closes

select pg_temp.as_member('00000000-0000-4000-8000-0000000071a3');
do $$ begin
  perform public.hr_request_cancel((select v::bigint from rq where k = 'w'));
  if (select status || '/' || resolution_outcome from public.tickets where id = (select v::bigint from rq where k = 'tw')) <> 'closed/مش مشكلة' then
    raise exception 'case a cancel closes the ticket failed';
  end if;
end $$;

-- ================================================================ the grants

reset role;
do $$ begin
  if has_function_privilege('authenticated', 'public.hr_req_ticket(bigint)', 'execute')
     or has_function_privilege('authenticated', 'public.hr_req_family(text)', 'execute')
     or has_function_privilege('anon', 'public.hr_requests_list()', 'execute')
     or not has_function_privilege('authenticated', 'public.hr_requests_list()', 'execute') then
    raise exception 'case the grants of 0071 failed';
  end if;
  raise notice 'rls_hr_req_ticket: ok';
end $$;
rollback;
