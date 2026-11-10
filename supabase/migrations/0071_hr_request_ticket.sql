-- 0071 — phase 13 decision 33 (owner 10 Nov — «تحويل طلباتي إلى تذاكر الفريق», and in the reply: the «طلباتي» tab goes, leave / advance /
-- remote-work requests are filed as a team ticket and decided from there, like the overtime):
-- * hr_requests.ticket_id — every request filed opens an internal ticket (hr_req_ticket, the server's): to the direct manager's role
--   (else «مدير النظام»), opened in the member's name, a bell to the admins and to the direct manager (kind 'hr.request').
-- * The ticket carries NO HR detail (the security rule of 0069): the title is the request's family only — «طلب إجازة» for every leave type
--   (not «مرضية»), «طلب سُلفة» (no amount), «شغل عن بُعد», «إذن انصراف مبكر», «تصحيح انصراف» — the member's name and the date it was
--   filed; never the dates asked, the note, the amount or a refusal reason. Those stay in hr_requests under the HR rules (hr_can_see);
--   the ticket's request card reads them for whoever may.
-- * hr_request_decide (0068 + an event and the ticket closed: موافق → «اتحلت المشكلة», مرفوض → «مش مشكلة»; «قيد المراجعة» = an event)
--   and hr_request_cancel (the ticket closed «مش مشكلة» «اتلغى من صاحبه»).
-- * hr_requests_list() / hr_requests_v (0050) return ticket_id too; the requests still open get their ticket now.

alter table public.hr_requests add column if not exists ticket_id bigint references public.tickets on delete set null;
create index if not exists hr_requests_ticket_idx on public.hr_requests (ticket_id) where ticket_id is not null;

-- the request's family — the ticket's title words (no leave sub-type, no amount)
create or replace function public.hr_req_family(p_type text) returns text
language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from public.hr_leave_types t where t.name = p_type) then 'طلب إجازة'
              when p_type = 'سُلفة' then 'طلب سُلفة'
              when p_type in ('شغل عن بُعد', 'إذن انصراف مبكر', 'تصحيح انصراف') then 'طلب ' || p_type
              else 'طلب موارد بشرية' end
$$;

-- the ticket of a request (internal): to the direct manager's role, opened in the member's name; the alerts with it
create or replace function public.hr_req_ticket(p_req bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_r public.hr_requests; v_p public.profiles; v_mgr public.profiles; v_role text; v_id bigint; v_name text; v_fam text;
  v_when text; v_actor_role text;
begin
  select * into v_r from public.hr_requests where id = p_req;
  if not found then return null; end if;
  if v_r.ticket_id is not null then return v_r.ticket_id; end if;
  select * into v_p from public.profiles where id = v_r.member_id;
  if not found then return null; end if;
  if v_p.manager_id is not null then select * into v_mgr from public.profiles where id = v_p.manager_id and status = 'active'; end if;
  v_role := coalesce((public.ticket_role_labels(v_mgr.role_id))[1], 'مدير النظام');
  v_name := left(coalesce(nullif(btrim(v_p.name), ''), 'عضو'), 60);
  v_fam := public.hr_req_family(v_r.type);
  v_when := to_char((v_r.created_at at time zone 'Africa/Cairo')::date, 'DD/MM');
  v_actor_role := left(coalesce((public.ticket_role_labels(v_p.role_id))[1], 'عضو'), 60);
  insert into public.tickets (type, title, description, priority, assignee_role, status, created_by, created_by_name, created_by_role, created_at, last_update)
  values ('internal', left(v_fam || ' — ' || v_name || ' · ' || v_when, 80),
    v_fam || ' من ' || v_name || ' (HR-' || lpad(v_r.id::text, 4, '0') || '). التفاصيل والقرار في كارت الطلب هنا أو في «الموارد البشرية › الطلبات» — للي يقدر يشوفها بس.',
    'normal', v_role, 'open', v_r.member_id, left(v_p.name, 120), v_actor_role, v_r.created_at, now())
  returning id into v_id;
  insert into public.ticket_events (ticket_id, kind, actor, actor_name, actor_role, text, new_value)
  values (v_id, 'event', v_r.member_id, left(v_p.name, 120), v_actor_role, 'فتح التذكرة', 'open');
  update public.hr_requests set ticket_id = v_id where id = p_req;
  insert into public.alerts (kind, title, body, role_id, entity, entity_id)
  values ('hr.request', v_fam || ' — ' || v_name, 'مستني قرار المدير المباشر', 'admin', 'tickets/TKT-' || lpad(v_id::text, 4, '0'), 'rq:' || v_id);
  if v_mgr.id is not null and v_mgr.role_id is distinct from 'admin' then
    insert into public.alerts (kind, title, body, user_id, entity, entity_id)
    values ('hr.request', v_fam || ' — ' || v_name, 'محتاج قرارك', v_mgr.id, 'tickets/TKT-' || lpad(v_id::text, 4, '0'), 'rq:' || v_id);
  end if;
  return v_id;
end $$;

-- 0046 + the ticket
create or replace function public.hr_request_create(p_input jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_member uuid := coalesce(nullif(p_input ->> 'member', '')::uuid, auth.uid()); v_type text := btrim(coalesce(p_input ->> 'type', ''));
  v_from date; v_to date; v_at time; v_hours numeric; v_amount numeric; v_months int; v_note text := nullif(btrim(coalesce(p_input ->> 'note', '')), ''); v_id bigint;
  v_doc text := nullif(btrim(coalesce(p_input ->> 'doc', '')), '');
begin
  if not public.hr_active() then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_member <> auth.uid() and not public.hr_editor() then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = v_member and status = 'active') then raise exception 'not found' using errcode = 'P0002'; end if;
  if not (v_type = any (public.hr_request_types())) then raise exception 'invalid: type' using errcode = '22023'; end if;
  begin
    v_from := coalesce(nullif(p_input ->> 'from', '')::date, public.hr_today());
    v_to := coalesce(nullif(p_input ->> 'to', '')::date, v_from);
    v_at := nullif(p_input ->> 'time', '')::time;
    v_hours := nullif(p_input ->> 'hours', '')::numeric;
    v_amount := nullif(p_input ->> 'amount', '')::numeric;
    v_months := nullif(p_input ->> 'months', '')::int;
  exception when others then raise exception 'invalid: value' using errcode = '22023';
  end;
  if v_to < v_from then raise exception 'invalid: to' using errcode = '22023'; end if;
  if v_note is not null and char_length(v_note) > 500 then raise exception 'invalid: note' using errcode = '22023'; end if;
  if v_type = 'سُلفة' then
    if v_amount is null or v_amount <= 0 or v_amount > 10000000 or v_months is null or v_months not between 1 and 24 then raise exception 'invalid: amount' using errcode = '22023'; end if;
    v_from := public.hr_today(); v_to := v_from; v_at := null; v_hours := null;
  elsif v_type in ('إذن انصراف مبكر', 'تصحيح انصراف') then
    if v_at is null then raise exception 'invalid: time' using errcode = '22023'; end if;
    v_to := v_from; v_amount := null; v_months := null;
    if v_type = 'تصحيح انصراف' and (v_from > public.hr_today() or not exists (select 1 from public.hr_attendance where member_id = v_member and day = v_from)) then
      raise exception 'invalid: day' using errcode = '22023';
    end if;
    if v_type = 'إذن انصراف مبكر' and (v_hours is null or v_hours <= 0 or v_hours > 12) then v_hours := 2; end if;
  else
    v_at := null; v_hours := null; v_amount := null; v_months := null;
    if v_to - v_from > 60 then raise exception 'invalid: to' using errcode = '22023'; end if;
  end if;
  if not exists (select 1 from public.hr_leave_types t where t.name = v_type) then v_doc := null; end if;
  if v_doc is not null and (char_length(v_doc) > 300 or v_doc not like v_member::text || '/%' or v_doc like '%..%') then
    raise exception 'invalid: doc' using errcode = '22023';
  end if;
  if v_doc is null and exists (select 1 from public.hr_leave_types t where t.name = v_type and btrim(t.doc) not in ('', '—', '-')) then
    raise exception 'invalid: doc' using errcode = '22023';
  end if;
  insert into public.hr_requests (member_id, type, from_day, to_day, at_time, hours, amount, months, note, doc_path)
  values (v_member, v_type, v_from, v_to, v_at, v_hours, v_amount, v_months, v_note, v_doc) returning id into v_id;
  perform public.hr_req_ticket(v_id); -- decision 33
  return v_id;
end $$;

-- 0068 + the ticket gets the decision (no reason in it) and is closed
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
    decided_at = case when p_decision = 'قيد المراجعة' then null else now() end
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
      perform public.hr_ot_event(v_r.ticket_id, case when p_decision = 'موافق' then 'اتوافق على الطلب' else 'اترفض الطلب (السبب في «الموارد البشرية › الطلبات»)' end);
      perform public.hr_ot_ticket_close(v_r.ticket_id, case when p_decision = 'موافق' then 'اتحلت المشكلة' else 'مش مشكلة' end,
        case when p_decision = 'موافق' then 'اتوافق' else 'اترفض' end);
    end if;
  end if;
  return p_decision;
end $$;

-- 0046 + the ticket closed with the cancel
create or replace function public.hr_request_cancel(p_id bigint) returns text
language plpgsql security definer set search_path = public as $$
declare v_t bigint;
begin
  if not public.hr_active() then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.hr_requests set status = 'اتلغى' where id = p_id and member_id = auth.uid() and status in ('جديد', 'قيد المراجعة')
  returning ticket_id into v_t;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  if v_t is not null then
    perform public.hr_ot_event(v_t, 'صاحب الطلب لغاه');
    perform public.hr_ot_ticket_close(v_t, 'مش مشكلة', 'اتلغى من صاحبه');
  end if;
  return 'اتلغى';
end $$;

-- 0050's list + the ticket
drop view if exists public.hr_requests_v;
drop function if exists public.hr_requests_list();
create function public.hr_requests_list()
returns table (id bigint, member_id uuid, type text, from_day date, to_day date, at_time time, hours numeric, amount numeric, months int,
  note text, status text, decided_by uuid, decided_at timestamptz, reason text, created_by uuid, created_at timestamptz, doc_path text, ticket_id bigint)
language sql stable security definer set search_path = public as $$
  select r.id, r.member_id, r.type, r.from_day, r.to_day, r.at_time, r.hours,
    case when public.hr_salaries() or r.member_id = auth.uid() then r.amount end, r.months, r.note, r.status,
    r.decided_by, r.decided_at, r.reason, r.created_by, r.created_at, r.doc_path, r.ticket_id
  from public.hr_requests r
  where public.hr_can_see(r.member_id)
$$;
create view public.hr_requests_v with (security_invoker = true) as
  select l.id, 'HR-' || lpad(l.id::text, 4, '0') as code, l.member_id, l.type, l.from_day, l.to_day, l.at_time, l.hours, l.amount, l.months,
    l.note, l.status, l.decided_by, l.decided_at, l.reason, l.created_by, l.created_at, l.doc_path, l.ticket_id
  from public.hr_requests_list() l;
revoke all on public.hr_requests_v from anon, authenticated;
grant select on public.hr_requests_v to authenticated, service_role;

-- the grants (rule 4 / 0050): the helpers are the server's; the list and the RPCs the members'
revoke execute on function public.hr_req_family(text), public.hr_req_ticket(bigint), public.hr_requests_list() from public, anon;
revoke execute on function public.hr_req_family(text), public.hr_req_ticket(bigint) from authenticated;
grant execute on function public.hr_requests_list() to authenticated, service_role;
grant execute on function public.hr_req_family(text), public.hr_req_ticket(bigint) to service_role;

-- the requests still open get their ticket now (closed ones stay without)
do $$
declare r record;
begin
  for r in select id from public.hr_requests where ticket_id is null and status in ('جديد', 'قيد المراجعة') order by id loop
    perform public.hr_req_ticket(r.id);
  end loop;
end $$;
