-- 0070 — phase 13 decision 32 (owner 10 Nov — «في حالة العمل في الإجازات الرسمية أو العطلة بيتحسب كوقت إضافي يحتاج لموافقة من الأدمن»):
-- a rest day or an official holiday worked (hr_overtime.kind = 'rest_day', the day ×2 — hr_rest_day: the member's day off or a row of
-- hr_holidays) is decided by an active admin only, not the direct manager: its request ticket goes to «مدير النظام» and only the admins
-- get the bell. An ordinary overtime is unchanged (the direct manager, decision 25). The grants are 0069's (create or replace keeps them).

create or replace function public.hr_ot_ticket(p_member uuid, p_day date, p_rest boolean) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_p public.profiles; v_mgr public.profiles; v_role text; v_id bigint; v_name text; v_when text := to_char(p_day, 'DD/MM');
begin
  select * into v_p from public.profiles where id = p_member;
  if not found then return null; end if;
  if v_p.manager_id is not null then select * into v_mgr from public.profiles where id = v_p.manager_id and status = 'active'; end if;
  -- decision 32: a rest day / an official holiday is the admins' to approve — the ticket goes to «مدير النظام» and only the admins hear
  v_role := case when p_rest then 'مدير النظام' else coalesce((public.ticket_role_labels(v_mgr.role_id))[1], 'مدير النظام') end;
  v_name := left(coalesce(nullif(btrim(v_p.name), ''), 'عضو'), 60);
  insert into public.tickets (type, title, description, priority, assignee_role, status, created_by, created_by_name, created_by_role)
  values ('internal', left((case when p_rest then 'يوم راحة/عطلة — ' else 'وقت إضافي — ' end) || v_name || ' · ' || v_when, 80),
    'طلب إضافة ' || (case when p_rest then 'يوم راحة/عطلة اشتغله (اليوم بيومين)' else 'وقت إضافي' end) || ' لـ ' || v_name || ' يوم ' || v_when
      || '. مايتحسبش في المرتب غير بعد موافقة ' || (case when p_rest then 'الأدمن' else 'المدير المباشر' end) || ' — من التذكرة دي أو من «الموارد البشرية › الطلبات».',
    'normal', v_role, 'open', p_member, left(v_p.name, 120), left(coalesce((public.ticket_role_labels(v_p.role_id))[1], 'عضو'), 60))
  returning id into v_id;
  insert into public.ticket_events (ticket_id, kind, actor, actor_name, actor_role, text, new_value)
  values (v_id, 'event', p_member, left(v_p.name, 120), left(coalesce((public.ticket_role_labels(v_p.role_id))[1], 'عضو'), 60), 'فتح التذكرة', 'open');
  insert into public.alerts (kind, title, body, role_id, entity, entity_id)
  values ('hr.overtime', v_name || (case when p_rest then ' بيشتغل يوم راحة/عطلة' else ' بدأ وقت إضافي' end), case when p_rest then 'مستني موافقة الأدمن' else 'مستني موافقة المدير المباشر' end,
    'admin', 'tickets/TKT-' || lpad(v_id::text, 4, '0'), 'ot:' || v_id);
  if not p_rest and v_mgr.id is not null and v_mgr.role_id is distinct from 'admin' then
    insert into public.alerts (kind, title, body, user_id, entity, entity_id)
    values ('hr.overtime', v_name || (case when p_rest then ' بيشتغل يوم راحة/عطلة' else ' بدأ وقت إضافي' end), 'محتاج موافقتك',
      v_mgr.id, 'tickets/TKT-' || lpad(v_id::text, 4, '0'), 'ot:' || v_id);
  end if;
  return v_id;
end $$;

create or replace function public.hr_overtime_decide(p_id bigint, p_decision text, p_minutes int default null, p_reason text default null) returns text
language plpgsql security definer set search_path = public as $$
declare v_o public.hr_overtime; v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_min int; v_pm date;
begin
  select * into v_o from public.hr_overtime where id = p_id for update;
  if not found or not public.hr_can_see(v_o.member_id) then raise exception 'not found' using errcode = 'P0002'; end if;
  if not public.hr_can_decide(v_o.member_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  -- decision 32: a rest day / an official holiday worked = the admins' decision only (not the direct manager's)
  if v_o.kind = 'rest_day' and not public.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
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
