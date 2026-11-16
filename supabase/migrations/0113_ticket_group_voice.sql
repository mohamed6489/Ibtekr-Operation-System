-- 0113 — team requests as a group chat + voice notes (the owner 16 Nov: «امكانية اني افتح طلب واحد يبقي فيه اكتر من فرد يبقي زي
-- الجروب … زود امكانية ارسال تسجيل صوتي اقصي مدة ليه 60 ثانية … زر اغلاق نهائي و اعادة فتح يبقي بس عند اللي فتح»; answers: «أي حد
-- في الطلب يضيف», close / reopen = «اللي فتحه + الأدمن»). Plan: docs/superpowers/plans/2026-11-15-comments.md ش26.
-- * tickets.members uuid[] (≤ 30): the people added to the request besides the role / member it is assigned to. A member in the list
--   sees the request (tickets.view <> N), writes in it and works it like the role (status / resolve / update) — closing and
--   reopening stay the opener's and the admin's (0045, unchanged).
-- * ticket_can_see(role, by, member, members): 0097's OR «I am in the members». tickets_select / ticket_file_visible / ticket_act use it.
-- * ticket_people(): id / name / main role of who can be in a request (names only), for the pickers.
-- * ticket_create: p_input.members (uuid list) — active members with tickets.view <> N, the opener and the assigned member left out.
-- * ticket_act add_members { members } (anyone in the request: the role, the assigned member, a member, the opener, the admin) and
--   remove_member { member } (the opener or the admin; anyone may take themselves out); the events name them.
-- * ticket_act set_status also takes «open» (the status dropdown); reply takes no text when a file is attached (a voice note alone).
-- * ticket_files: a voice note = audio/webm · ogg · mp4 · mpeg of 3 MB at most with its length in seconds (1–60, the client's — the
--   recorder stops at 60); the «tickets» bucket allows those types.
-- ticket_create / ticket_act are 0097's with these additions only (the old event texts stay — IbtekrTickets.words reads them).

alter table public.tickets add column if not exists members uuid[] not null default '{}';
alter table public.tickets drop constraint if exists tickets_members_check;
alter table public.tickets add constraint tickets_members_check check (cardinality(members) <= 30);
create index if not exists tickets_members_idx on public.tickets using gin (members);

-- the people a request may take: active, reading the requests (tickets.view <> N, whatever their role), deduped, in order
create or replace function public.ticket_members_clean(p jsonb, p_skip uuid[]) returns uuid[]
language plpgsql stable security definer set search_path = public as $$
declare out uuid[] := '{}'; v jsonb; m uuid;
begin
  if p is null or p = 'null'::jsonb then return out; end if;
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 30 then raise exception 'invalid: members' using errcode = '22023'; end if;
  for v in select value from jsonb_array_elements(p) loop
    if jsonb_typeof(v) <> 'string' then raise exception 'invalid: members' using errcode = '22023'; end if;
    begin m := (v #>> '{}')::uuid; exception when others then raise exception 'invalid: members' using errcode = '22023'; end;
    if m = any (coalesce(p_skip, '{}')) or m = any (out) then continue; end if;
    if not exists (select 1 from public.profiles p where p.id = m and p.status = 'active') or public.member_perm_raw(m, 'tickets.view') = 'N' then
      raise exception 'invalid: members' using errcode = '22023';
    end if;
    out := out || m;
  end loop;
  return out;
end $$;
revoke execute on function public.ticket_members_clean(jsonb, uuid[]) from public, anon, authenticated;
grant execute on function public.ticket_members_clean(jsonb, uuid[]) to service_role;

-- who can be added (and the names in a request): the active members who read the requests — id, name and main role only (no e-mail,
-- phone or permissions), for a member with tickets.manage F (the directory shows a member only themselves without settings.view)
create or replace function public.ticket_people() returns table (id uuid, name text, role_id text)
language sql stable security definer set search_path = public as $$
  select p.id, left(p.name, 120), p.role_id from public.profiles p
   where p.status = 'active' and public.has_perm('tickets.manage') = 'F' and public.member_perm_raw(p.id, 'tickets.view') <> 'N'
   order by p.name
$$;
revoke execute on function public.ticket_people() from public, anon;
grant execute on function public.ticket_people() to authenticated, service_role;

-- the names of a list of members, «، » between them (the events)
create or replace function public.ticket_names(p uuid[]) returns text
language sql stable security definer set search_path = public as $$
  select left(string_agg(left(p2.name, 60), '، ' order by array_position(p, p2.id)), 600) from public.profiles p2 where p2.id = any (coalesce(p, '{}'))
$$;
revoke execute on function public.ticket_names(uuid[]) from public, anon, authenticated;
grant execute on function public.ticket_names(uuid[]) to service_role;

create or replace function public.ticket_can_see(p_role text, p_by uuid, p_member uuid, p_members uuid[]) returns boolean
language sql stable security definer set search_path = public as $$
  select public.ticket_can_see(p_role, p_by, p_member)
      or (auth.uid() is not null and auth.uid() = any (coalesce(p_members, '{}')) and public.has_perm('tickets.view') <> 'N')
$$;
revoke execute on function public.ticket_can_see(text, uuid, uuid, uuid[]) from public, anon;
grant execute on function public.ticket_can_see(text, uuid, uuid, uuid[]) to authenticated, service_role;

drop policy if exists tickets_select on public.tickets;
create policy tickets_select on public.tickets for select to authenticated
  using ((select public.ticket_can_see(assignee_role, created_by, assignee_member, members)));

create or replace function public.ticket_file_visible(p_path text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tickets t
    where public.ticket_can_see(t.assignee_role, t.created_by, t.assignee_member, t.members)
      and (t.attachments @> jsonb_build_array(jsonb_build_object('path', p_path))
           or exists (select 1 from public.ticket_events e where e.ticket_id = t.id and e.attachments @> jsonb_build_array(jsonb_build_object('path', p_path))))
  )
$$;

-- ---------------------------------------------------------------- the files: + a voice note (≤ 3 MB, 1–60 seconds)
create or replace function public.ticket_files(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  out jsonb := '[]'::jsonb; f jsonb; v_path text; v_name text; v_type text; v_size bigint; seen text[] := '{}'; v_dur numeric; v_item jsonb;
  has_storage boolean := to_regclass('storage.objects') is not null;
begin
  if p is null or p = 'null'::jsonb then return out; end if;
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 10 then raise exception 'invalid: attachments' using errcode = '22023'; end if;
  for f in select value from jsonb_array_elements(p) loop
    if jsonb_typeof(f) <> 'object' then raise exception 'invalid: attachments' using errcode = '22023'; end if;
    v_path := f ->> 'path';
    if v_path is null or auth.uid() is null or v_path !~ ('^' || auth.uid()::text || '/[A-Za-z0-9][A-Za-z0-9._-]{0,159}$') then
      raise exception 'invalid: attachments' using errcode = '22023';
    end if;
    if v_path = any (seen) then continue; end if;
    seen := seen || v_path;
    if has_storage then
      execute $q$select metadata ->> 'mimetype', (metadata ->> 'size')::bigint from storage.objects where bucket_id = 'tickets' and name = $1$q$
        into v_type, v_size using v_path;
      if v_type is null then raise exception 'invalid: attachments' using errcode = '22023'; end if;
      v_type := split_part(v_type, ';', 1);
    else
      v_type := f ->> 'type'; v_size := nullif(f ->> 'size', '')::bigint;
    end if;
    v_name := nullif(public.ticket_clean(f ->> 'name', 120), '');
    v_item := jsonb_build_object('path', v_path, 'name', coalesce(v_name, regexp_replace(v_path, '^.*/', '')), 'type', v_type, 'size', v_size);
    if v_type in ('audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg') then
      begin v_dur := round((f ->> 'duration')::numeric, 1); exception when others then v_dur := null; end;
      if v_size is null or v_size < 0 or v_size > 3145728 or v_dur is null or v_dur < 1 or v_dur > 60 then
        raise exception 'invalid: attachments' using errcode = '22023';
      end if;
      v_item := v_item || jsonb_build_object('duration', v_dur);
    elsif v_type is null or v_type not in ('image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf') or v_size is null or v_size < 0 or v_size > 10485760 then
      raise exception 'invalid: attachments' using errcode = '22023';
    end if;
    out := out || jsonb_build_array(v_item);
  end loop;
  return out;
end $$;

-- ---------------------------------------------------------------- ticket_create (0097) + the members
create or replace function public.ticket_create(p_input jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  a record; v_id bigint; v_type text := p_input ->> 'type'; v_title text; v_desc text; v_prio text := p_input ->> 'priority';
  v_role text := p_input ->> 'assigneeRole'; v_order text; v_order_id bigint; v_customer text; v_cust uuid; v_conv uuid;
  v_vendor uuid; v_vendor_name text; v_reason text := nullif(p_input ->> 'reason', ''); v_follow date; v_files jsonb; v_phone text;
  v_member uuid; v_member_name text; v_members uuid[];
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
  if nullif(p_input ->> 'assigneeMember', '') is not null then
    begin v_member := (p_input ->> 'assigneeMember')::uuid; exception when others then raise exception 'invalid: assigneeMember' using errcode = '22023'; end;
    if not public.ticket_member_ok(v_member, v_role) then raise exception 'invalid: assigneeMember' using errcode = '22023'; end if;
    select left(p.name, 120) into v_member_name from public.profiles p where p.id = v_member;
  end if;
  -- the group (16 Nov): more people in the request
  v_members := public.ticket_members_clean(p_input -> 'members', array_remove(array[a.uid, v_member], null));
  v_follow := public.ticket_date(p_input ->> 'followUp');
  v_files := public.ticket_files(p_input -> 'attachments');

  if nullif(p_input ->> 'csConversationId', '') is not null then
    if public.has_perm('cs.view') = 'N' then raise exception 'invalid: csConversationId' using errcode = '22023'; end if;
    begin v_conv := (p_input ->> 'csConversationId')::uuid; exception when others then raise exception 'invalid: csConversationId' using errcode = '22023'; end;
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

  insert into public.tickets (type, title, description, priority, assignee_role, assignee_member, assignee_member_name, members, order_number, order_id, customer,
                              cs_customer_id, cs_conversation_id, vendor_id, vendor, reason, follow_up, attachments, created_by, created_by_name, created_by_role)
    values (v_type, v_title, v_desc, v_prio, v_role, v_member, v_member_name, v_members, v_order, v_order_id, v_customer,
            v_cust, v_conv, v_vendor, v_vendor_name, v_reason, v_follow, v_files, a.uid, a.name, a.role)
    returning id into v_id;
  perform public.ticket_event(v_id, 'event', a.name || ' أنشأ التذكرة وعيّنها لدور «' || v_role || '»' || coalesce(' — ' || v_member_name, ''), null, null, null, a.name, a.role);
  if cardinality(v_members) > 0 then
    perform public.ticket_event(v_id, 'event', a.name || ' ضاف للطلب: ' || public.ticket_names(v_members), null, null, null, a.name, a.role);
  end if;
  perform public.ticket_event(v_id, 'message', v_desc, null, null, null, a.name, a.role);
  return v_id;
end $$;

-- ---------------------------------------------------------------- ticket_act (0097) + the members, «open», a voice note alone
create or replace function public.ticket_act(p_id bigint, p_action text, p_args jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  a record; t public.tickets%rowtype; can_work boolean; can_close boolean; v text; v_note text; v_files jsonb; v_old text; v_new text;
  v_date date; args jsonb := coalesce(p_args, '{}'::jsonb); v_role text; v_member uuid; v_member_name text; v_add uuid[]; in_group boolean;
begin
  if public.has_perm('tickets.manage') <> 'F' then raise exception 'tickets.manage required' using errcode = '42501'; end if;
  select * into a from public.ticket_actor();
  if a.uid is null then raise exception 'tickets.manage required' using errcode = '42501'; end if;
  select * into t from public.tickets where id = p_id for update;
  if not found or not public.ticket_can_see(t.assignee_role, t.created_by, t.assignee_member, t.members) then raise exception 'ticket not found' using errcode = 'P0002'; end if;
  in_group := a.uid = any (t.members);
  can_work := public.is_admin() or t.assignee_role = any (public.ticket_my_roles()) or (t.assignee_member is not null and t.assignee_member = a.uid) or in_group;
  can_close := public.is_admin() or t.created_by = a.uid;

  if p_action = 'set_status' then
    v := args ->> 'status';
    if v is null or v not in ('open', 'in_progress', 'waiting') then raise exception 'invalid: status' using errcode = '22023'; end if;
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

  elsif p_action = 'add_members' then
    -- anyone in the request adds (the owner: «أي حد في الطلب يضيف»)
    if not (can_work or can_close) then raise exception 'not in this request' using errcode = '42501'; end if;
    if t.status = 'closed' then raise exception 'invalid: closed' using errcode = '22023'; end if;
    v_add := public.ticket_members_clean(args -> 'members', array_remove(array[t.created_by, t.assignee_member] || t.members, null));
    if cardinality(v_add) = 0 then return; end if;
    if cardinality(t.members) + cardinality(v_add) > 30 then raise exception 'invalid: members' using errcode = '22023'; end if;
    update public.tickets set members = t.members || v_add where id = p_id;
    perform public.ticket_event(p_id, 'event', a.name || ' ضاف للطلب: ' || public.ticket_names(v_add), null, null, null, a.name, a.role);

  elsif p_action = 'remove_member' then
    begin v_member := (args ->> 'member')::uuid; exception when others then raise exception 'invalid: member' using errcode = '22023'; end;
    if v_member is null or not (v_member = any (t.members)) then raise exception 'invalid: member' using errcode = '22023'; end if;
    -- the opener or the admin takes anyone out; a member may leave
    if not (can_close or v_member = a.uid) then raise exception 'not the opener of this ticket' using errcode = '42501'; end if;
    update public.tickets set members = array_remove(t.members, v_member) where id = p_id;
    perform public.ticket_event(p_id, 'event',
      case when v_member = a.uid then a.name || ' خرج من الطلب' else a.name || ' شال من الطلب: ' || public.ticket_names(array[v_member]) end,
      null, null, null, a.name, a.role);

  elsif p_action = 'update' then
    if not (can_work or can_close) then raise exception 'not the role or the opener of this ticket' using errcode = '42501'; end if;
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
    if v_member is not null and (v_member is distinct from t.assignee_member or v_role <> t.assignee_role) and not public.ticket_member_ok(v_member, v_role) then
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
    if t.status = 'closed' then raise exception 'invalid: closed' using errcode = '22023'; end if;
    v_files := public.ticket_files(args -> 'attachments');
    if v = '' then
      if jsonb_array_length(v_files) = 0 then raise exception 'invalid: text' using errcode = '22023'; end if;
      -- a file alone: the line a message needs (1–7000) names it
      v := case when exists (select 1 from jsonb_array_elements(v_files) x where x ->> 'type' like 'audio/%') then 'رسالة صوتية' else 'مرفق' end;
    end if;
    perform public.ticket_event(p_id, 'message', v, null, null, v_files, a.name, a.role);

  else
    raise exception 'invalid: action' using errcode = '22023';
  end if;
end $$;

-- ---------------------------------------------------------------- Storage: the voice-note types on the «tickets» bucket (guarded)
do $storage$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') and to_regclass('storage.buckets') is not null then
    execute $s$update storage.buckets set allowed_mime_types = '{image/png,image/jpeg,image/webp,image/gif,application/pdf,audio/webm,audio/ogg,audio/mp4,audio/mpeg}'
               where id = 'tickets'$s$;
  end if;
end $storage$;
