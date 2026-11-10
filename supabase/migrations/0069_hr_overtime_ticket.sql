-- 0069_hr_overtime_ticket.sql — phase 13 decision 25 (the owner, 10 Nov: «لو زاد إجمالي الساعات في اليوم عن 8 ساعات يطلع بوب أب يقوله اكتمال
-- ساعات العمل ويطلعله اختيار بإنهاء الدوام أو البدء في وقت إضافي، وفي حالة اختياره لوقت إضافي يتبعت للأدمن تنبيه ويجيله في تذاكر الفريق طلب
-- بإضافة وقت إضافي وما يتضافش للموظف إلا بعد الموافقة» — then: «الموافقة للمدير المباشر», the decision inside the ticket (and «الموارد
-- البشرية › الطلبات», either closes the other), a rest day the same way, and «إضافة وقت إضافي» = start overtime now, even before 8 hours).
-- Re-runnable.
-- * hr_attendance.ot_from (when this session's overtime started) and ot_ticket (its request ticket); hr_overtime.ticket_id.
-- * hr_overtime_begin(): the member, on their open session — sets ot_from (once) and opens the ticket: «تذاكر الفريق», internal, assigned
--   to the direct manager's role (else «مدير النظام»), opened by the member; a bell alert to the admins and to the direct manager.
-- * hr_clock_out: the overtime of a session = the larger of (its minutes since ot_from) and (its part past 8 hours of the day), never more
--   than the session; written with the ticket (a missing one is opened then) and an event on it with its minutes only;
--   an overtime started but ended with none closes its ticket. A rest day: the ×2 row carries the ticket, each session adds an event.
-- * hr_overtime_decide: as 0046 (the direct manager, hr.approve F or the admin) — and the linked ticket gets the decision and is closed.
--   Nothing is counted for the member before that (as it always was: paid_minutes / pay_month only on «اتضاف»).
-- * Privacy (security review of this change): the ticket is seen by the manager's whole role, so it carries no HR detail — no note of
--   what was worked on, no times, no refusal reason; those stay in hr_overtime under the HR rules (hr_can_see), where the ticket card
--   reads them only for those allowed.

alter table public.hr_attendance add column if not exists ot_from timestamptz;
alter table public.hr_attendance add column if not exists ot_ticket bigint references public.tickets on delete set null;
alter table public.hr_overtime add column if not exists ticket_id bigint references public.tickets on delete set null;
create index if not exists hr_overtime_ticket_idx on public.hr_overtime (ticket_id) where ticket_id is not null;

-- the ticket of a member's overtime request (internal): to the direct manager's role, opened in the member's name; the alerts with it
create or replace function public.hr_ot_ticket(p_member uuid, p_day date, p_rest boolean) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_p public.profiles; v_mgr public.profiles; v_role text; v_id bigint; v_name text; v_when text := to_char(p_day, 'DD/MM');
begin
  select * into v_p from public.profiles where id = p_member;
  if not found then return null; end if;
  if v_p.manager_id is not null then select * into v_mgr from public.profiles where id = v_p.manager_id and status = 'active'; end if;
  v_role := coalesce((public.ticket_role_labels(v_mgr.role_id))[1], 'مدير النظام');
  v_name := left(coalesce(nullif(btrim(v_p.name), ''), 'عضو'), 60);
  insert into public.tickets (type, title, description, priority, assignee_role, status, created_by, created_by_name, created_by_role)
  values ('internal', left((case when p_rest then 'يوم راحة/عطلة — ' else 'وقت إضافي — ' end) || v_name || ' · ' || v_when, 80),
    'طلب إضافة ' || (case when p_rest then 'يوم راحة/عطلة اشتغله (اليوم بيومين)' else 'وقت إضافي' end) || ' لـ ' || v_name || ' يوم ' || v_when
      || '. مايتحسبش في المرتب غير بعد موافقة المدير المباشر — من التذكرة دي أو من «الموارد البشرية › الطلبات».',
    'normal', v_role, 'open', p_member, left(v_p.name, 120), left(coalesce((public.ticket_role_labels(v_p.role_id))[1], 'عضو'), 60))
  returning id into v_id;
  insert into public.ticket_events (ticket_id, kind, actor, actor_name, actor_role, text, new_value)
  values (v_id, 'event', p_member, left(v_p.name, 120), left(coalesce((public.ticket_role_labels(v_p.role_id))[1], 'عضو'), 60), 'فتح التذكرة', 'open');
  insert into public.alerts (kind, title, body, role_id, entity, entity_id)
  values ('hr.overtime', v_name || (case when p_rest then ' بيشتغل يوم راحة/عطلة' else ' بدأ وقت إضافي' end), 'مستني موافقة المدير المباشر',
    'admin', 'tickets/TKT-' || lpad(v_id::text, 4, '0'), 'ot:' || v_id);
  if v_mgr.id is not null and v_mgr.role_id is distinct from 'admin' then
    insert into public.alerts (kind, title, body, user_id, entity, entity_id)
    values ('hr.overtime', v_name || (case when p_rest then ' بيشتغل يوم راحة/عطلة' else ' بدأ وقت إضافي' end), 'محتاج موافقتك',
      v_mgr.id, 'tickets/TKT-' || lpad(v_id::text, 4, '0'), 'ot:' || v_id);
  end if;
  return v_id;
end $$;

-- an event on the request ticket, in the actor's name (the member, the manager, or the server's own words)
create or replace function public.hr_ot_event(p_ticket bigint, p_text text) returns void
language plpgsql security definer set search_path = public as $$
declare v_name text; v_role text;
begin
  if p_ticket is null then return; end if;
  select left(p.name, 120), left(coalesce((public.ticket_role_labels(p.role_id))[1], 'عضو'), 60) into v_name, v_role from public.profiles p where p.id = auth.uid();
  insert into public.ticket_events (ticket_id, kind, actor, actor_name, actor_role, text)
  values (p_ticket, 'event', auth.uid(), coalesce(v_name, 'السيستم'), coalesce(v_role, 'السيستم'), left(p_text, 7000));
  update public.tickets set last_update = now() where id = p_ticket;
end $$;

-- the request ticket closed with the decision (once)
create or replace function public.hr_ot_ticket_close(p_ticket bigint, p_outcome text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if p_ticket is null then return; end if;
  select left(p.name, 120) into v_name from public.profiles p where p.id = auth.uid();
  update public.tickets set status = 'closed', resolution_outcome = p_outcome, resolution_note = left(p_note, 1000),
    resolved_by = auth.uid(), resolved_by_name = coalesce(v_name, 'السيستم'), resolved_at = now(),
    closed_by = auth.uid(), closed_by_name = coalesce(v_name, 'السيستم'), closed_at = now(), last_update = now()
  where id = p_ticket and status <> 'closed';
end $$;

-- the member, on their open session: overtime starts now (before 8 hours too) and its request ticket opens; again = the same
create or replace function public.hr_overtime_begin() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_row public.hr_attendance; v_t bigint;
begin
  if not public.hr_active() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_row from public.hr_attendance where member_id = auth.uid() and out_at is null and in_at > now() - interval '20 hours'
    order by in_at desc limit 1 for update;
  if not found then raise exception 'invalid: shift' using errcode = '22023'; end if;
  v_t := v_row.ot_ticket;
  if v_t is null then
    v_t := public.hr_ot_ticket(auth.uid(), v_row.day, public.hr_rest_day(v_row.day));
    update public.hr_attendance set ot_ticket = v_t, ot_from = coalesce(ot_from, now()), updated_at = now() where id = v_row.id;
  elsif v_row.ot_from is null then
    update public.hr_attendance set ot_from = now(), updated_at = now() where id = v_row.id;
  end if;
  return jsonb_build_object('ticket', v_t, 'ot_from', coalesce(v_row.ot_from, now()));
end $$;

-- my open session (0068) + when its overtime started and its ticket
create or replace function public.hr_shift_now() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not public.hr_active() then null else (
    select jsonb_build_object('id', a.id, 'day', a.day, 'in_at', a.in_at, 'out_at', a.out_at, 'remote', a.remote,
      'done', public.hr_day_done(a.member_id, a.day, a.id),
      'sessions', (select count(*)::int from public.hr_attendance x where x.member_id = a.member_id and x.day = a.day),
      'ot_from', a.ot_from, 'ot_ticket', a.ot_ticket)
    from public.hr_attendance a
    where a.member_id = auth.uid() and (a.out_at is null and a.in_at > now() - interval '20 hours' or a.day = public.hr_today())
    order by (a.out_at is null) desc, a.in_at desc limit 1) end
$$;

-- the end of my session (0068) — the overtime with its ticket (decision 25)
create or replace function public.hr_clock_out(p_ot_note text default null, p_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_row public.hr_attendance; v_out timestamptz; v_worked int; v_shift int := 480; v_before int; v_total int; v_part int; v_since int; v_ot bigint;
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
    perform public.hr_ot_event(v_t, 'الوقت الإضافي: ' || v_part || ' دقيقة — مستني موافقة المدير المباشر (التفاصيل في «الموارد البشرية › الطلبات»)');
  elsif v_row.ot_ticket is not null then
    perform public.hr_ot_event(v_row.ot_ticket, 'الدوام خلص من غير وقت إضافي يتسجل');
    perform public.hr_ot_ticket_close(v_row.ot_ticket, 'مش مشكلة', 'مافيش وقت إضافي اتسجل');
  end if;
  return jsonb_build_object('worked', v_worked, 'day_total', v_total, 'overtime_id', v_ot, 'overtime', case when v_ot is null then 0 else v_part end, 'ticket', v_t);
end $$;

-- «ضيفه» / «متضيفهوش» (0046) — the request ticket gets the decision and is closed
create or replace function public.hr_overtime_decide(p_id bigint, p_decision text, p_minutes int default null, p_reason text default null) returns text
language plpgsql security definer set search_path = public as $$
declare v_o public.hr_overtime; v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_min int; v_pm date;
begin
  select * into v_o from public.hr_overtime where id = p_id for update;
  if not found or not public.hr_can_see(v_o.member_id) then raise exception 'not found' using errcode = 'P0002'; end if;
  if not public.hr_can_decide(v_o.member_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  if not (v_o.status = 'مستني' or (v_o.status = 'اترفض' and p_decision = 'add')) then raise exception 'invalid: status' using errcode = '22023'; end if;
  if v_reason is not null and char_length(v_reason) > 300 then raise exception 'invalid: reason' using errcode = '22023'; end if;
  if v_o.status = 'اترفض' then
    if not public.hr_editor() then raise exception 'not allowed' using errcode = '42501'; end if;
    update public.hr_meetings set status = 'اتقفلت', outcome = 'اتضاف الوقت'
    where member_id = v_o.member_id and ref = 'OT-' || p_id and status <> 'اتقفلت';
    if not found then raise exception 'invalid: meeting' using errcode = '22023'; end if;
  end if;
  if p_decision = 'add' then
    v_min := case when v_o.kind = 'rest_day' then v_o.minutes else coalesce(p_minutes, v_o.minutes) end;
    if v_min <= 0 or v_min > v_o.minutes then raise exception 'invalid: minutes' using errcode = '22023'; end if;
    v_pm := date_trunc('month', v_o.day)::date;
    while exists (select 1 from public.hr_payroll p where p.month = v_pm and p.status in ('معتمد', 'مدفوع')) loop
      v_pm := (v_pm + interval '1 month')::date;
    end loop;
    update public.hr_overtime set status = 'اتضاف', paid_minutes = v_min, pay_month = v_pm, decided_by = auth.uid(), decided_at = now(), reason = v_reason where id = p_id;
    perform public.hr_ot_event(v_o.ticket_id, case when v_o.kind = 'rest_day' then 'اتوافق على يوم الراحة/العطلة (اليوم بيومين)'
      else 'اتضاف الوقت الإضافي: ' || v_min || ' دقيقة' || case when v_min < v_o.minutes then ' من ' || v_o.minutes else '' end end);
    perform public.hr_ot_ticket_close(v_o.ticket_id, 'اتحلت المشكلة', case when v_o.kind = 'rest_day' then 'اتوافق — اليوم بيومين' else 'اتضاف ' || v_min || ' دقيقة' end);
    return 'اتضاف';
  elsif p_decision = 'reject' then
    if v_reason is null then raise exception 'invalid: reason' using errcode = '22023'; end if;
    update public.hr_overtime set status = 'اترفض', paid_minutes = 0, pay_month = null, decided_by = auth.uid(), decided_at = now(), reason = v_reason where id = p_id;
    insert into public.hr_meetings (member_id, reason, ref, created_by) values (v_o.member_id, 'وقت إضافي اترفض — نعرف كان بيعمل إيه', 'OT-' || p_id, auth.uid());
    perform public.hr_ot_event(v_o.ticket_id, 'اترفض الوقت الإضافي (السبب في «الموارد البشرية › الطلبات»)');
    perform public.hr_ot_ticket_close(v_o.ticket_id, 'مش مشكلة', 'اترفض');
    return 'اترفض';
  end if;
  raise exception 'invalid: decision' using errcode = '22023';
end $$;

-- the grants (rule 4 / 0050): the helpers are the server's; hr_overtime_begin is the members'
revoke execute on function public.hr_ot_ticket(uuid, date, boolean), public.hr_ot_event(bigint, text), public.hr_ot_ticket_close(bigint, text, text),
  public.hr_overtime_begin() from public, anon;
revoke execute on function public.hr_ot_ticket(uuid, date, boolean), public.hr_ot_event(bigint, text), public.hr_ot_ticket_close(bigint, text, text) from authenticated;
grant execute on function public.hr_overtime_begin() to authenticated;
grant execute on function public.hr_ot_ticket(uuid, date, boolean), public.hr_ot_event(bigint, text), public.hr_ot_ticket_close(bigint, text, text),
  public.hr_overtime_begin() to service_role;
-- the new columns: read with the rows (0046's select grants are table-wide); written only by these functions
grant select (ot_from, ot_ticket) on public.hr_attendance to authenticated;
grant select (ticket_id) on public.hr_overtime to authenticated;
