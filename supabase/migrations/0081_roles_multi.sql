-- 0081_roles_multi (the owner, 12 Nov — «في الأدوار في أعضاء الفريق نقدر نزود أدوار زي ديزاينر، ميديا باير، مبرمج، وكل الأدوار اللي
-- ممكن نحتاجها في الشركة ونديها صلاحيات معينة» + «دور أساسي + أدوار إضافية» for a member who does more than one job).
-- Plan: docs/superpowers/plans/2026-11-12-marketing-agents.md (decisions 1–3).
-- * three system roles: designer «ديزاينر» · media_buyer «ميديا باير» · developer «مبرمج» — the viewer's permissions plus marketing
--   (view / create F; the media buyer publish F too) and the team requests (tickets.view P · tickets.manage F); the admin edits them
--   like any role
-- * profiles.extra_roles: a member's extra roles — written by member_roles_set (the admin) only; existing, not hidden, never «أدمن»,
--   never the main role, 6 at most (a guard trigger holds it for any writer). has_perm = the highest of the main and the extra roles
--   (F > P > N; a hidden role gives nothing as an extra); custom_perms still win; the admin role is a main role only
-- * role_delete drops the role from every member's extras (and a deleted custom role's open team requests go to «مدير النظام»);
--   member_role_set drops the new main role from the extras; role_update renames a custom role's team requests with it
-- * the team requests (tickets) go to any role: the six old labels of the old system roles as they were (ticket_role_labels), any
--   other role by its name. The fixed check is gone — ticket_role_ok() in ticket_create / ticket_act and a guard trigger on the table;
--   «my roles» = the main role + the extras; ticket_roles() lists the roles a request may go to (the «طلب جديد» popup)

-- ---------------------------------------------------------------- the three roles

insert into public.roles (id, name, description, is_system, permissions, sort)
select d.id, d.name, d.descr, true,
       coalesce((select permissions from public.roles where id = 'viewer'), '{}'::jsonb) || d.perms,
       coalesce((select max(sort) from public.roles), 0) + d.n
from (values
  ('designer',    'ديزاينر',    'التصميم والبوستات والفيديوهات وطلبات الديزاين',   '{"marketing.view":"F","marketing.create":"F","marketing.publish":"N","tickets.view":"P","tickets.manage":"F"}'::jsonb, 1),
  ('media_buyer', 'ميديا باير', 'الحملات الإعلانية وأرقامها وطلبات الإعلانات',       '{"marketing.view":"F","marketing.create":"F","marketing.publish":"F","reports.view":"F","tickets.view":"P","tickets.manage":"F"}'::jsonb, 2),
  ('developer',   'مبرمج',      'الموقع والسيستم وطلبات البرمجة',                  '{"marketing.view":"F","marketing.create":"F","marketing.publish":"N","tickets.view":"P","tickets.manage":"F"}'::jsonb, 3)
) as d(id, name, descr, perms, n)
where not exists (select 1 from public.roles r where r.id = d.id)
  and not exists (select 1 from public.roles r where lower(btrim(r.name)) = lower(btrim(d.name)));

-- ---------------------------------------------------------------- extra roles

alter table public.profiles add column if not exists extra_roles text[] not null default '{}'::text[];

create or replace function public.profiles_extra_roles_guard() returns trigger
language plpgsql set search_path = public as $$
declare
  x text;
begin
  new.extra_roles := coalesce(new.extra_roles, '{}'::text[]);
  if tg_op = 'UPDATE' and new.extra_roles is not distinct from old.extra_roles and new.role_id is not distinct from old.role_id then return new; end if;
  if cardinality(new.extra_roles) > 6 then raise exception 'invalid: roles' using errcode = '22023'; end if;
  if cardinality(new.extra_roles) <> (select count(distinct v) from unnest(new.extra_roles) v) then raise exception 'invalid: roles' using errcode = '22023'; end if;
  foreach x in array new.extra_roles loop
    if x = 'admin' or x = new.role_id or not exists (select 1 from public.roles r where r.id = x and not r.hidden) then
      raise exception 'invalid: roles' using errcode = '22023';
    end if;
  end loop;
  return new;
end
$$;
revoke execute on function public.profiles_extra_roles_guard() from public, anon, authenticated;
drop trigger if exists profiles_extra_roles_guard on public.profiles;
create trigger profiles_extra_roles_guard before insert or update of extra_roles, role_id on public.profiles
  for each row execute function public.profiles_extra_roles_guard();

-- has_perm: the highest of the main and the extra roles (custom_perms first, as before)
create or replace function public.has_perm(key text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when p.status <> 'active' then 'N'
      when (coalesce(p.twofa, false) or public.force2fa_on()) and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then 'N'
      when p.role_id = 'admin' then 'F'
      when p.custom_perms ? key then p.custom_perms ->> key
      else (select case max(case r.permissions ->> key when 'F' then 2 when 'P' then 1 else 0 end) when 2 then 'F' when 1 then 'P' else 'N' end
              from public.roles r
             where r.id = p.role_id or (r.id = any (coalesce(p.extra_roles, '{}'::text[])) and not r.hidden and r.id <> 'admin'))
    end
    from public.profiles p
    where p.id = auth.uid()
  ), 'N')
$$;

-- a member's extra roles (the admin only); the list as a whole, [] = none
create or replace function public.member_roles_set(p_member uuid, p_roles text[]) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  v_main text; v_old text[]; v_new text[];
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select role_id, extra_roles into v_main, v_old from public.profiles where id = p_member for update;
  if not found then raise exception 'no such member' using errcode = 'P0002'; end if;
  if v_main = 'admin' then raise exception 'invalid: admin' using errcode = '22023'; end if;
  v_new := coalesce((select array_agg(distinct x order by x) from unnest(coalesce(p_roles, '{}'::text[])) x where x is not null and btrim(x) <> ''), '{}'::text[]);
  if v_new is not distinct from (select coalesce(array_agg(x order by x), '{}') from unnest(v_old) x) then return; end if;
  update public.profiles set extra_roles = v_new where id = p_member; -- the guard checks every role
  perform public.log_activity('settings.member.roles', 'profile', p_member::text, to_jsonb(v_old), to_jsonb(v_new));
  perform public.perm_change_alert('اتغيّرت الأدوار الإضافية لعضو (' || cardinality(v_new) || ')', p_member::text);
end
$$;
revoke execute on function public.member_roles_set(uuid, text[]) from public, anon;
grant execute on function public.member_roles_set(uuid, text[]) to authenticated, service_role;

-- ---------------------------------------------------------------- the team requests go to any role

-- the old system roles keep their six labels; any other role (not hidden) answers to its name
create or replace function public.ticket_role_labels(p_role text) returns text[]
language sql stable set search_path = public as $$
  select case p_role
    when 'admin' then array['مدير النظام']
    when 'cs' then array['خدمة العملاء']
    when 'vendors_followup' then array['متابعة المبتكرين']
    when 'accounts' then array['الحسابات']
    when 'ops' then array['اللوجستيك والشحن', 'المحتوى والتصوير']
    when 'viewer' then '{}'::text[]
    else coalesce((select array[r.name] from public.roles r where r.id = p_role and not r.hidden), '{}'::text[]) end
$$;

-- the labels a request may go to, in the roles' order (the six old ones always)
create or replace function public.ticket_roles() returns table (label text, role_id text)
language sql stable security definer set search_path = public as $$
  select l.label, l.role_id from (
    select x.label, r.id as role_id, coalesce(r.sort, 999) as s, x.o
      from public.roles r cross join lateral unnest(public.ticket_role_labels(r.id)) with ordinality as x(label, o)
     where r.id in ('admin', 'cs', 'vendors_followup', 'accounts', 'ops') or not r.hidden
  ) l order by l.s, l.o
$$;
revoke execute on function public.ticket_roles() from public, anon;
grant execute on function public.ticket_roles() to authenticated, service_role;

create or replace function public.ticket_role_ok(p_label text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_label is not null and exists (select 1 from public.ticket_roles() t where t.label = p_label)
$$;
revoke execute on function public.ticket_role_ok(text) from public, anon;
grant execute on function public.ticket_role_ok(text) to authenticated, service_role;

-- the ticket roles of the signed-in member: the main role + the extras (an inactive member has none)
create or replace function public.ticket_my_roles() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce((select array(select distinct l from unnest(array[p.role_id] || coalesce(p.extra_roles, '{}'::text[])) rid
                                cross join lateral unnest(public.ticket_role_labels(rid)) l)
                     from public.profiles p where p.id = auth.uid() and p.status = 'active'), '{}'::text[])
$$;

alter table public.tickets drop constraint if exists tickets_assignee_role_check;
create or replace function public.tickets_assignee_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if not public.ticket_role_ok(new.assignee_role) then raise exception 'invalid: assigneeRole' using errcode = '22023'; end if;
  return new;
end
$$;
revoke execute on function public.tickets_assignee_guard() from public, anon, authenticated;
drop trigger if exists tickets_assignee_guard on public.tickets;
create trigger tickets_assignee_guard before insert or update of assignee_role on public.tickets
  for each row execute function public.tickets_assignee_guard();

create or replace function public.ticket_create(p_input jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  a record; v_id bigint; v_type text := p_input ->> 'type'; v_title text; v_desc text; v_prio text := p_input ->> 'priority';
  v_role text := p_input ->> 'assigneeRole'; v_order text; v_order_id bigint; v_customer text; v_cust uuid; v_conv uuid;
  v_vendor uuid; v_vendor_name text; v_reason text := nullif(p_input ->> 'reason', ''); v_follow date; v_files jsonb; v_phone text;
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

  insert into public.tickets (type, title, description, priority, assignee_role, order_number, order_id, customer, cs_customer_id, cs_conversation_id,
                              vendor_id, vendor, reason, follow_up, attachments, created_by, created_by_name, created_by_role)
    values (v_type, v_title, v_desc, v_prio, v_role, v_order, v_order_id, v_customer, v_cust, v_conv,
            v_vendor, v_vendor_name, v_reason, v_follow, v_files, a.uid, a.name, a.role)
    returning id into v_id;
  perform public.ticket_event(v_id, 'event', a.name || ' أنشأ التذكرة وعيّنها لدور «' || v_role || '»', null, null, null, a.name, a.role);
  perform public.ticket_event(v_id, 'message', v_desc, null, null, null, a.name, a.role);
  return v_id;
end $$;

create or replace function public.ticket_act(p_id bigint, p_action text, p_args jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  a record; t public.tickets%rowtype; can_work boolean; can_close boolean; v text; v_note text; v_files jsonb; v_old text; v_new text;
  v_date date; args jsonb := coalesce(p_args, '{}'::jsonb);
begin
  if public.has_perm('tickets.manage') <> 'F' then raise exception 'tickets.manage required' using errcode = '42501'; end if;
  select * into a from public.ticket_actor();
  if a.uid is null then raise exception 'tickets.manage required' using errcode = '42501'; end if;
  select * into t from public.tickets where id = p_id for update;
  if not found or not public.ticket_can_see(t.assignee_role, t.created_by) then raise exception 'ticket not found' using errcode = 'P0002'; end if;
  can_work := public.is_admin() or t.assignee_role = any (public.ticket_my_roles());
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
    if args ? 'assigneeRole' then
      v := args ->> 'assigneeRole';
      if v is null or not public.ticket_role_ok(v) then
        raise exception 'invalid: assigneeRole' using errcode = '22023';
      end if;
      if v <> t.assignee_role then
        update public.tickets set assignee_role = v where id = p_id;
        perform public.ticket_event(p_id, 'event', a.name || ' غيّر المسؤول من «' || t.assignee_role || '» إلى «' || v || '»', t.assignee_role, v, null, a.name, a.role);
      end if;
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

-- ---------------------------------------------------------------- the role RPCs keep the extras and the requests in step

create or replace function public.role_update(p_role text, p_name text, p_desc text) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  r record;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select * into r from public.roles where id = p_role for update;
  if r.id is null then raise exception 'no such role' using errcode = 'P0002'; end if;
  if p_name is not null and btrim(p_name) <> r.name then
    if r.is_system then raise exception 'invalid: name' using errcode = '22023'; end if;
    if coalesce(btrim(p_name), '') = '' or length(btrim(p_name)) > 40 then raise exception 'invalid: name' using errcode = '22023'; end if;
    if exists (select 1 from public.roles where id <> p_role and lower(btrim(name)) = lower(btrim(p_name))) then raise exception 'exists' using errcode = '23505'; end if;
    update public.roles set name = btrim(p_name) where id = p_role;
    -- the role's team requests keep following it (a custom role answers to its name)
    update public.tickets set assignee_role = btrim(p_name) where assignee_role = r.name;
  end if;
  update public.roles set description = nullif(btrim(coalesce(p_desc, '')), '') where id = p_role;
  perform public.log_activity('settings.role.update', 'role', p_role, null, jsonb_build_object('name', coalesce(btrim(p_name), r.name)));
end
$$;

create or replace function public.role_delete(p_role text, p_moves jsonb) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  r record; m record; v_to text; v_moved jsonb := '[]'::jsonb;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_role = 'admin' then raise exception 'the admin role cannot be deleted' using errcode = '22023'; end if;
  select * into r from public.roles where id = p_role for update;
  if r.id is null then raise exception 'no such role' using errcode = 'P0002'; end if;
  for m in select p.id, p.name from public.profiles p where p.role_id = p_role loop
    v_to := coalesce(p_moves ->> m.id::text, p_moves ->> '*');
    if v_to is null or v_to = p_role or not exists (select 1 from public.roles x where x.id = v_to and not x.hidden) then
      raise exception 'invalid: moves' using errcode = '22023';
    end if;
    update public.profiles set role_id = v_to, extra_roles = array_remove(extra_roles, v_to) where id = m.id;
    v_moved := v_moved || jsonb_build_object('member', m.id, 'to', v_to);
  end loop;
  update public.profiles set extra_roles = array_remove(extra_roles, p_role) where p_role = any (extra_roles);
  -- a role that stops answering: its open team requests go to the system's manager (the old six labels never stop)
  if p_role not in ('cs', 'vendors_followup', 'accounts', 'ops') then
    update public.tickets set assignee_role = 'مدير النظام' where assignee_role = r.name and status in ('open', 'in_progress', 'waiting');
  end if;
  if r.is_system then update public.roles set hidden = true where id = p_role;
  else delete from public.roles where id = p_role; end if;
  perform public.log_activity('settings.role.delete', 'role', p_role, jsonb_build_object('name', r.name), v_moved);
  perform public.perm_change_alert('اتحذف دور «' || r.name || '»', p_role);
end
$$;

create or replace function public.member_role_set(p_member uuid, p_role text) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  v_old text;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if not exists (select 1 from public.roles where id = p_role and not hidden) then raise exception 'invalid: role' using errcode = '22023'; end if;
  select role_id into v_old from public.profiles where id = p_member for update;
  if v_old is null then raise exception 'no such member' using errcode = 'P0002'; end if;
  if v_old = p_role then return; end if;
  if v_old = 'admin' and (select count(*) from public.profiles where role_id = 'admin' and status = 'active' and id <> p_member) = 0 then
    raise exception 'last admin' using errcode = '22023';
  end if;
  -- the new main role leaves the extras; an admin has none
  update public.profiles set role_id = p_role,
         extra_roles = case when p_role = 'admin' then '{}'::text[] else array_remove(extra_roles, p_role) end
   where id = p_member;
  perform public.log_activity('settings.member.role', 'profile', p_member::text, to_jsonb(v_old), to_jsonb(p_role));
  perform public.perm_change_alert('اتغيّر دور عضو: ' || v_old || ' ← ' || p_role, p_member::text);
end
$$;
