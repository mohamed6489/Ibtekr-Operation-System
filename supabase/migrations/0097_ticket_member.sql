-- 0097 — owner batch 2 decision 32 (docs/superpowers/plans/2026-11-14-owner-batch-2.md): «طلب جديد» goes to a role and then to «كل
-- الدور» or one member of that role. That member sees the request and works it.
-- * tickets.assignee_member (+ the name at the time, like created_by_name): null = the whole role, as before. Server written only
--   (the members have no write on tickets — 0045).
-- * ticket_member_ok(member, label): an active member who holds the role (main or extra — ticket_role_labels).
-- * ticket_create: p_input.assigneeMember (optional uuid) checked by ticket_member_ok; the event names the member.
-- * ticket_act update: assigneeMember ('' = the whole role); a new role without a member clears it, a member who does not hold the
--   (new) role is refused (22023 invalid: assigneeMember). can_work = the admin, the role (as before) or the assigned member.
-- * the visibility (tickets_select, ticket_file_visible, ticket_act): ticket_can_see OR the assigned member (active, tickets.view <> N).
-- ticket_create / ticket_act are 0081's with these additions only.

alter table public.tickets add column if not exists assignee_member uuid references public.profiles(id);
alter table public.tickets add column if not exists assignee_member_name text;
alter table public.tickets drop constraint if exists tickets_assignee_member_name_check;
alter table public.tickets add constraint tickets_assignee_member_name_check check (assignee_member_name is null or char_length(assignee_member_name) <= 120);
create index if not exists tickets_assignee_member_idx on public.tickets (assignee_member) where assignee_member is not null;

-- an active member who holds the ticket role (the main role or an extra one)
create or replace function public.ticket_member_ok(p_member uuid, p_label text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_member is not null and p_label is not null and exists (
    select 1 from public.profiles p
     where p.id = p_member and p.status = 'active'
       and p_label = any (array(select l from unnest(array[p.role_id] || coalesce(p.extra_roles, '{}'::text[])) rid
                                cross join lateral unnest(public.ticket_role_labels(rid)) l)))
$$;
revoke execute on function public.ticket_member_ok(uuid, text) from public, anon;
grant execute on function public.ticket_member_ok(uuid, text) to authenticated, service_role;

-- the assigned member reads the ticket (and works it — ticket_act below) while active with tickets.view <> N
create or replace function public.ticket_can_see(p_role text, p_by uuid, p_member uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.ticket_can_see(p_role, p_by)
      or (p_member is not null and p_member = auth.uid() and public.has_perm('tickets.view') <> 'N')
$$;
revoke execute on function public.ticket_can_see(text, uuid, uuid) from public, anon;
grant execute on function public.ticket_can_see(text, uuid, uuid) to authenticated, service_role;

drop policy if exists tickets_select on public.tickets;
create policy tickets_select on public.tickets for select to authenticated
  using ((select public.ticket_can_see(assignee_role, created_by, assignee_member)));

create or replace function public.ticket_file_visible(p_path text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tickets t
    where public.ticket_can_see(t.assignee_role, t.created_by, t.assignee_member)
      and (t.attachments @> jsonb_build_array(jsonb_build_object('path', p_path))
           or exists (select 1 from public.ticket_events e where e.ticket_id = t.id and e.attachments @> jsonb_build_array(jsonb_build_object('path', p_path))))
  )
$$;

-- ---------------------------------------------------------------- ticket_create (0081) + the member
create or replace function public.ticket_create(p_input jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  a record; v_id bigint; v_type text := p_input ->> 'type'; v_title text; v_desc text; v_prio text := p_input ->> 'priority';
  v_role text := p_input ->> 'assigneeRole'; v_order text; v_order_id bigint; v_customer text; v_cust uuid; v_conv uuid;
  v_vendor uuid; v_vendor_name text; v_reason text := nullif(p_input ->> 'reason', ''); v_follow date; v_files jsonb; v_phone text;
  v_member uuid; v_member_name text;
begin
  if public.has_perm('tickets.manage') <> 'F' then raise exception 'tickets.manage required' using errcode = '42501'; end if;
  select * into a from public.ticket_actor();
  if a.uid is null then raise exception 'tickets.manage required' using errcode = '42501'; end if;
  if jsonb_typeof(p_input) <> 'object' then raise exception 'invalid: input' using errcode = '22023'; end if;

  if v_type is null or v_type not in ('customer', 'vendor', 'internal') then raise exception 'invalid: type' using errcode = '22023'; end if;
  v_title := public.ticket_clean(p_input ->> 'title', 1000);
  if v_title = '' or char_length(v_title) > 80 then raise exception 'invalid: title' using errcode = '22023'; end if;
  v_desc := public.ticket_clean(p_input ->> 'description', 5000);
  if v_desc = '' then raise exception 'invalid: description' using errcode = '22023'; end if;
  if v_prio is null or v_prio not in ('urgent', 'high', 'normal', 'low') then raise exception 'invalid: priority' using errcode = '22023'; end if;
  if v_role is null or not public.ticket_role_ok(v_role) then
    raise exception 'invalid: assigneeRole' using errcode = '22023';
  end if;
  -- decision 32: one member of the role, or the whole role (none)
  if nullif(p_input ->> 'assigneeMember', '') is not null then
    begin v_member := (p_input ->> 'assigneeMember')::uuid; exception when others then raise exception 'invalid: assigneeMember' using errcode = '22023'; end;
    if not public.ticket_member_ok(v_member, v_role) then raise exception 'invalid: assigneeMember' using errcode = '22023'; end if;
    select left(p.name, 120) into v_member_name from public.profiles p where p.id = v_member;
  end if;
  v_follow := public.ticket_date(p_input ->> 'followUp');
  v_files := public.ticket_files(p_input -> 'attachments');

  -- the customer-service conversation (decision 11) and its customer
  if nullif(p_input ->> 'csConversationId', '') is not null then
    if public.has_perm('cs.view') = 'N' then raise exception 'invalid: csConversationId' using errcode = '22023'; end if;
    begin v_conv := (p_input ->> 'csConversationId')::uuid; exception when others then raise exception 'invalid: csConversationId' using errcode = '22023'; end;
    -- only a conversation the member reads (cs.view F, or P and assigned to them — the cs_conversations policy of 0034)
    select c.customer_id into v_cust from public.cs_conversations c where c.id = v_conv and (public.has_perm('cs.view') = 'F' or c.assignee = auth.uid());
    if not found then raise exception 'invalid: csConversationId' using errcode = '22023'; end if;
  end if;
  if nullif(p_input ->> 'csCustomerId', '') is not null then
    if public.has_perm('cs.view') = 'N' then raise exception 'invalid: csCustomerId' using errcode = '22023'; end if;
    begin v_cust := (p_input ->> 'csCustomerId')::uuid; exception when others then raise exception 'invalid: csCustomerId' using errcode = '22023'; end;
    if not exists (select 1 from public.cs_customers where id = v_cust) then raise exception 'invalid: csCustomerId' using errcode = '22023'; end if;
  end if;
  v_customer := nullif(public.ticket_clean(p_input ->> 'customer', 80), '');

  if v_type = 'customer' then
    v_order := nullif(public.ticket_clean(p_input ->> 'orderId', 20), '');
    if v_order is null then raise exception 'invalid: orderId' using errcode = '22023'; end if;
    if v_reason is null or v_reason not in ('تأخير في التسليم', 'منتج تالف', 'منتج مختلف عن الطلب', 'مشكلة دفع أو استرجاع', 'العميل مش بيرد', 'أخرى') then
      raise exception 'invalid: reason' using errcode = '22023';
    end if;
    -- the orders row (and its customer) only for a member who reads the orders (orders.view F) — else the typed number alone
    if public.has_perm('orders.view') = 'F' then
      select o.id, o.customer_name, o.customer_phone into v_order_id, v_customer, v_phone
        from public.orders o where o.deleted_at is null and (o.number = v_order or o.id::text = v_order) order by (o.number = v_order) desc limit 1;
    end if;
    if v_order_id is null then v_customer := nullif(public.ticket_clean(p_input ->> 'customer', 80), '');
    else
      v_customer := coalesce(nullif(public.ticket_clean(p_input ->> 'customer', 80), ''), left(v_customer, 80));
      if v_cust is null and v_phone is not null and public.has_perm('cs.view') <> 'N' then
        select c.id into v_cust from public.cs_customers c where c.phone = public.norm_phone(v_phone) and c.merged_into is null limit 1;
      end if;
    end if;
  elsif v_type = 'vendor' then
    begin v_vendor := (p_input ->> 'vendorId')::uuid; exception when others then raise exception 'invalid: vendor' using errcode = '22023'; end;
    select left(v.name, 80) into v_vendor_name from public.vendors v where v.id = v_vendor;
    if v_vendor is null or v_vendor_name is null then raise exception 'invalid: vendor' using errcode = '22023'; end if;
    if v_reason is null or v_reason not in ('تأخير تسليم', 'جودة', 'خامة ناقصة', 'خلاف على الحساب أو العمولة', 'مش بيرد', 'أخرى') then
      raise exception 'invalid: reason' using errcode = '22023';
    end if;
  else
    v_reason := null;
  end if;

  insert into public.tickets (type, title, description, priority, assignee_role, assignee_member, assignee_member_name, order_number, order_id, customer, cs_customer_id, cs_conversation_id,
                              vendor_id, vendor, reason, follow_up, attachments, created_by, created_by_name, created_by_role)
    values (v_type, v_title, v_desc, v_prio, v_role, v_member, v_member_name, v_order, v_order_id, v_customer, v_cust, v_conv,
            v_vendor, v_vendor_name, v_reason, v_follow, v_files, a.uid, a.name, a.role)
    returning id into v_id;
  perform public.ticket_event(v_id, 'event', a.name || ' أنشأ التذكرة وعيّنها لدور «' || v_role || '»' || coalesce(' — ' || v_member_name, ''), null, null, null, a.name, a.role);
  perform public.ticket_event(v_id, 'message', v_desc, null, null, null, a.name, a.role);
  return v_id;
end $$;

-- ---------------------------------------------------------------- ticket_act (0081) + the member
create or replace function public.ticket_act(p_id bigint, p_action text, p_args jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  a record; t public.tickets%rowtype; can_work boolean; can_close boolean; v text; v_note text; v_files jsonb; v_old text; v_new text;
  v_date date; args jsonb := coalesce(p_args, '{}'::jsonb); v_role text; v_member uuid; v_member_name text;
begin
  if public.has_perm('tickets.manage') <> 'F' then raise exception 'tickets.manage required' using errcode = '42501'; end if;
  select * into a from public.ticket_actor();
  if a.uid is null then raise exception 'tickets.manage required' using errcode = '42501'; end if;
  select * into t from public.tickets where id = p_id for update;
  if not found or not public.ticket_can_see(t.assignee_role, t.created_by, t.assignee_member) then raise exception 'ticket not found' using errcode = 'P0002'; end if;
  can_work := public.is_admin() or t.assignee_role = any (public.ticket_my_roles()) or (t.assignee_member is not null and t.assignee_member = a.uid);
  can_close := public.is_admin() or t.created_by = a.uid;

  if p_action = 'set_status' then
    v := args ->> 'status';
    if v is null or v not in ('in_progress', 'waiting') then raise exception 'invalid: status' using errcode = '22023'; end if;
    if not can_work then raise exception 'not the role of this ticket' using errcode = '42501'; end if;
    if t.status = 'closed' then raise exception 'invalid: closed' using errcode = '22023'; end if;
    if t.status = v then return; end if;
    update public.tickets set status = v where id = p_id;
    perform public.ticket_event(p_id, 'event', a.name || ' غيّر الحالة من «' || public.ticket_label('status', t.status) || '» إلى «' || public.ticket_label('status', v) || '»',
                                t.status, v, null, a.name, a.role);

  elsif p_action = 'resolve' then
    v := args ->> 'outcome';
    if not can_work then raise exception 'not the role of this ticket' using errcode = '42501'; end if;
    if v is null or v not in ('اتحلت المشكلة', 'مش مشكلة', 'مكرر', 'العميل / المبتكر ما ردش') then raise exception 'invalid: outcome' using errcode = '22023'; end if;
    if t.status = 'closed' then raise exception 'invalid: closed' using errcode = '22023'; end if;
    v_note := nullif(public.ticket_clean(args ->> 'note', 1000), '');
    update public.tickets set status = 'resolved', resolution_outcome = v, resolution_note = v_note, resolved_by = a.uid, resolved_by_name = a.name, resolved_at = now()
      where id = p_id;
    perform public.ticket_event(p_id, 'event', a.name || ' حوّل التذكرة إلى «تم الحل» — ' || v || coalesce(' · ' || v_note, ''), t.status, 'resolved', null, a.name, a.role);

  elsif p_action = 'close' then
    if not can_close then raise exception 'not the opener of this ticket' using errcode = '42501'; end if;
    if t.status = 'closed' then return; end if;
    update public.tickets set status = 'closed', closed_by = a.uid, closed_by_name = a.name, closed_at = now() where id = p_id;
    perform public.ticket_event(p_id, 'event', a.name || ' قفل التذكرة نهائيًا', t.status, 'closed', null, a.name, a.role);

  elsif p_action = 'reopen' then
    v_note := public.ticket_clean(args ->> 'reason', 1000);
    if v_note = '' then raise exception 'invalid: reason' using errcode = '22023'; end if;
    if not can_close then raise exception 'not the opener of this ticket' using errcode = '42501'; end if;
    if t.status not in ('resolved', 'closed') then raise exception 'invalid: status' using errcode = '22023'; end if;
    update public.tickets set status = 'open', reopen_count = reopen_count + 1, closed_by = null, closed_by_name = null, closed_at = null,
      resolution_outcome = null, resolution_note = null, resolved_by = null, resolved_by_name = null, resolved_at = null where id = p_id;
    perform public.ticket_event(p_id, 'event', a.name || ' أُعيد فتحه (×' || (t.reopen_count + 1) || ') — السبب: ' || v_note || ' · رجع لدور «' || t.assignee_role || '»',
                                t.status, 'open', null, a.name, a.role);

  elsif p_action = 'update' then
    if not (can_work or can_close) then raise exception 'not the role or the opener of this ticket' using errcode = '42501'; end if;
    -- the role and the member together (decision 32): a new role without a member = the whole new role; a member must hold the role
    v_role := t.assignee_role; v_member := t.assignee_member;
    if args ? 'assigneeRole' then
      v := args ->> 'assigneeRole';
      if v is null or not public.ticket_role_ok(v) then
        raise exception 'invalid: assigneeRole' using errcode = '22023';
      end if;
      if v <> t.assignee_role then v_role := v; v_member := null; end if;
    end if;
    if args ? 'assigneeMember' then
      if nullif(args ->> 'assigneeMember', '') is null then v_member := null;
      else
        begin v_member := (args ->> 'assigneeMember')::uuid; exception when others then raise exception 'invalid: assigneeMember' using errcode = '22023'; end;
      end if;
    end if;
    if v_member is not null and v_member is distinct from t.assignee_member and not public.ticket_member_ok(v_member, v_role) then
      raise exception 'invalid: assigneeMember' using errcode = '22023';
    end if;
    if v_role <> t.assignee_role then
      update public.tickets set assignee_role = v_role where id = p_id;
      perform public.ticket_event(p_id, 'event', a.name || ' غيّر المسؤول من «' || t.assignee_role || '» إلى «' || v_role || '»', t.assignee_role, v_role, null, a.name, a.role);
    end if;
    if v_member is distinct from t.assignee_member then
      v_member_name := case when v_member is null then null else (select left(p.name, 120) from public.profiles p where p.id = v_member) end;
      update public.tickets set assignee_member = v_member, assignee_member_name = v_member_name where id = p_id;
      perform public.ticket_event(p_id, 'event', a.name || ' خلّى الطلب ' || coalesce('مع ' || v_member_name, 'لكل دور «' || v_role || '»'),
                                  t.assignee_member_name, v_member_name, null, a.name, a.role);
    end if;
    if args ? 'priority' then
      v := args ->> 'priority';
      if v is null or v not in ('urgent', 'high', 'normal', 'low') then raise exception 'invalid: priority' using errcode = '22023'; end if;
      if v <> t.priority then
        update public.tickets set priority = v where id = p_id;
        perform public.ticket_event(p_id, 'event', a.name || ' غيّر الأولوية من «' || public.ticket_label('priority', t.priority) || '» إلى «' || public.ticket_label('priority', v) || '»',
                                    t.priority, v, null, a.name, a.role);
      end if;
    end if;
    if args ? 'followUp' then
      v_date := public.ticket_date(args ->> 'followUp');
      if v_date is distinct from t.follow_up then
        v_old := coalesce(to_char(t.follow_up, 'YYYY-MM-DD'), '—'); v_new := coalesce(to_char(v_date, 'YYYY-MM-DD'), '—');
        update public.tickets set follow_up = v_date where id = p_id;
        perform public.ticket_event(p_id, 'event', a.name || ' غيّر تاريخ المتابعة من «' || v_old || '» إلى «' || v_new || '»',
                                    to_char(t.follow_up, 'YYYY-MM-DD'), to_char(v_date, 'YYYY-MM-DD'), null, a.name, a.role);
      end if;
    end if;

  elsif p_action = 'reply' then
    v := public.ticket_clean(args ->> 'text', 5000);
    if v = '' then raise exception 'invalid: text' using errcode = '22023'; end if;
    if t.status = 'closed' then raise exception 'invalid: closed' using errcode = '22023'; end if;
    v_files := public.ticket_files(args -> 'attachments');
    perform public.ticket_event(p_id, 'message', v, null, null, v_files, a.name, a.role);

  else
    raise exception 'invalid: action' using errcode = '22023';
  end if;
end $$;
