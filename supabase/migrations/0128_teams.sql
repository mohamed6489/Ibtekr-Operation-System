-- 0128 — the ready-made teams (docs/superpowers/plans/2026-11-17-agents-brain.md decision 9 — the owner 17 Nov, «موافق» on the table):
-- the roles are teams from the start with fitting permissions, and every one is renamed / deleted at will except «الإدارة» (admin).
--   الإدارة · العمليات والشحن · خدمة العملاء · متابعة المبتكرين · الحسابات · التصميم · الإعلانات · البرمجة · المحتوى والتصوير (new) ·
--   الموارد البشرية (new) · مشاهد
-- A request (tickets.assignee_role) answers to the team's current name: the old fixed labels («مدير النظام», «اللوجستيك والشحن»,
-- «ديزاينر» …) are mapped on write to the team that held them (ticket_label_canon) so every server path that still writes one keeps
-- working, and a rename moves the open and closed requests with it (role_update). The assistants follow their team (ai_agents.role).

-- 1) the names
update public.roles set name = 'الإدارة' where id = 'admin';
update public.roles set name = 'العمليات والشحن' where id = 'ops';
update public.roles set name = 'متابعة المبتكرين' where id = 'vendors_followup';
update public.roles set name = 'الحسابات' where id = 'accounts';
update public.roles set name = 'التصميم' where id = 'designer';
update public.roles set name = 'الإعلانات' where id = 'media_buyer';
update public.roles set name = 'البرمجة' where id = 'developer';

-- 2) the two new teams (started from «مشاهد», then their work)
insert into public.roles (id, name, description, is_system, permissions, sort)
select 'content', 'المحتوى والتصوير', 'تصوير المنتجات والمحتوى والاستوديو', true,
       v.permissions || jsonb_build_object('products.view', 'F', 'products.edit', 'F', 'products.add', 'F', 'products.bulk', 'F',
         'marketing.view', 'F', 'marketing.create', 'F', 'inventory.view', 'F', 'tickets.view', 'P', 'tickets.manage', 'F', 'reports.view', 'P'), 10
  from public.roles v where v.id = 'viewer'
on conflict (id) do nothing;
insert into public.roles (id, name, description, is_system, permissions, sort)
select 'hr', 'الموارد البشرية', 'الحضور والإجازات والتقييمات وطلبات الفريق', true,
       v.permissions || jsonb_build_object('hr.view', 'F', 'hr.edit', 'F', 'hr.approve', 'F', 'tickets.view', 'P', 'tickets.manage', 'F',
         'reports.view', 'P', 'sensitive.salaries', 'N'), 11
  from public.roles v where v.id = 'viewer'
on conflict (id) do nothing;

-- 3) a request's team: the current name of a team, or an old fixed label → the team that held it (a deleted team → «الإدارة»)
create or replace function public.ticket_label_canon(p_label text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select r.name from public.roles r where r.name = btrim(p_label) and not coalesce(r.hidden, false) and r.id <> 'viewer'),
    (select r.name from public.roles r
      where r.id = case btrim(coalesce(p_label, ''))
                     when 'مدير النظام' then 'admin' when 'أدمن' then 'admin'
                     when 'اللوجستيك والشحن' then 'ops' when 'عمليات' then 'ops'
                     when 'المحتوى والتصوير' then 'content'
                     when 'خدمة العملاء' then 'cs'
                     when 'متابعة المبتكرين' then 'vendors_followup' when 'متابعة الموردين' then 'vendors_followup'
                     when 'الحسابات' then 'accounts' when 'حسابات' then 'accounts'
                     when 'ديزاينر' then 'designer' when 'ميديا باير' then 'media_buyer' when 'مبرمج' then 'developer'
                     else null end
        and not coalesce(r.hidden, false)),
    case when btrim(coalesce(p_label, '')) in ('مدير النظام', 'أدمن', 'اللوجستيك والشحن', 'عمليات', 'المحتوى والتصوير', 'خدمة العملاء',
           'متابعة المبتكرين', 'متابعة الموردين', 'الحسابات', 'حسابات', 'ديزاينر', 'ميديا باير', 'مبرمج')
         then (select r.name from public.roles r where r.id = 'admin') end,
    p_label)
$$;
revoke execute on function public.ticket_label_canon(text) from public, anon;
grant execute on function public.ticket_label_canon(text) to authenticated, service_role;

-- every team answers to its own name (the viewers take no requests)
create or replace function public.ticket_role_labels(p_role text) returns text[]
language sql stable set search_path = public as $$
  select case when p_role = 'viewer' then '{}'::text[]
    else coalesce((select array[r.name] from public.roles r where r.id = p_role and not coalesce(r.hidden, false)), '{}'::text[]) end
$$;

create or replace function public.ticket_roles() returns table (label text, role_id text)
language sql stable security definer set search_path = public as $$
  select r.name as label, r.id as role_id from public.roles r
   where r.id <> 'viewer' and not coalesce(r.hidden, false)
   order by coalesce(r.sort, 999), r.id
$$;
revoke execute on function public.ticket_roles() from public, anon;
grant execute on function public.ticket_roles() to authenticated, service_role;

-- an old label is still accepted where a request is opened or moved (ticket_create / ticket_act check before the insert): it is the team
create or replace function public.ticket_role_ok(p_label text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_label is not null and exists (select 1 from public.ticket_roles() t where t.label = public.ticket_label_canon(p_label))
$$;
revoke execute on function public.ticket_role_ok(text) from public, anon;
grant execute on function public.ticket_role_ok(text) to authenticated, service_role;

-- the guard writes the canonical name (an old label from any server path lands on its team) before it checks
create or replace function public.tickets_assignee_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  new.assignee_role := public.ticket_label_canon(new.assignee_role);
  if not public.ticket_role_ok(new.assignee_role) then raise exception 'invalid: assigneeRole' using errcode = '22023'; end if;
  return new;
end
$$;
revoke execute on function public.tickets_assignee_guard() from public, anon, authenticated;

-- the requests and the assistants on the new names (the guard maps each old label)
update public.tickets set assignee_role = public.ticket_label_canon(assignee_role)
 where assignee_role is distinct from public.ticket_label_canon(assignee_role);
update public.ai_agents set role = public.ticket_label_canon(role) where role is not null and role is distinct from public.ticket_label_canon(role);
-- decision 10: each team's assistant
update public.ai_agents set role = (select name from public.roles where id = 'hr') where id = 'hr';
update public.ai_agents set role = (select name from public.roles where id = 'ops') where id = 'stock';

-- 4) a rename: any team but «الإدارة»; its requests and its assistant follow the name
create or replace function public.role_update(p_role text, p_name text, p_desc text) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  r record;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select * into r from public.roles where id = p_role for update;
  if r.id is null then raise exception 'no such role' using errcode = 'P0002'; end if;
  if p_name is not null and btrim(p_name) <> r.name then
    if r.id = 'admin' then raise exception 'invalid: name' using errcode = '22023'; end if;
    if coalesce(btrim(p_name), '') = '' or length(btrim(p_name)) > 40 then raise exception 'invalid: name' using errcode = '22023'; end if;
    if exists (select 1 from public.roles where id <> p_role and lower(btrim(name)) = lower(btrim(p_name))) then raise exception 'exists' using errcode = '23505'; end if;
    update public.roles set name = btrim(p_name) where id = p_role;
    update public.tickets set assignee_role = btrim(p_name) where assignee_role = r.name;
    update public.ai_agents set role = btrim(p_name) where role = r.name;
  end if;
  update public.roles set description = nullif(btrim(coalesce(p_desc, '')), '') where id = p_role;
  perform public.log_activity('settings.role.update', 'role', p_role, null, jsonb_build_object('name', coalesce(btrim(p_name), r.name)));
end
$$;

-- 5) a delete: any team but «الإدارة»; its open requests and its assistant go to «الإدارة»
create or replace function public.role_delete(p_role text, p_moves jsonb) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  r record; m record; v_to text; v_moved jsonb := '[]'::jsonb; v_admin text;
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
  if r.is_system then update public.roles set hidden = true where id = p_role;
  else delete from public.roles where id = p_role; end if;
  select name into v_admin from public.roles where id = 'admin';
  update public.tickets set assignee_role = v_admin where assignee_role = r.name and status in ('open', 'in_progress', 'waiting');
  update public.ai_agents set role = v_admin where role = r.name;
  perform public.log_activity('settings.role.delete', 'role', p_role, jsonb_build_object('name', r.name), v_moved);
  perform public.perm_change_alert('اتحذف دور «' || r.name || '»', p_role);
end
$$;

-- 6) the starting alerts of the teams (decision 9 «بتنبيهات مبدئية مناسبة»): while the admin has not saved a matrix, the teams after the
-- six get the alert column of the team closest to their work — التصميم / الإعلانات / البرمجة / المحتوى والتصوير the «العمليات والشحن»
-- one, الموارد البشرية the «الإدارة» one — and each team's permissions still gate what reaches it (notify.js permOk / IbtekrNotifRoles.canSee).
-- The columns follow the settings' order: the six system ones, then by sort (التصميم 7 · الإعلانات 8 · البرمجة 9 · المحتوى 10 · الموارد البشرية 11).
update public.settings set data = jsonb_set(coalesce(data, '{}'::jsonb), '{alertRoles}', '{"customers.late":"RRRNSNRRRRR","customers.follow":"RRRNNNRRRRR","customers.unconf":"RRRNNNRRRRR","customers.waiting":"RSRNNNSSSSR","vendors.late":"RRSNRNRRRRR","vendors.risk":"RSNNRNSSSSR","vendors.daily":"RSNNRNSSSSR","vendors.weekly":"RSNSRNSSSSR","accounts.payroll":"RNNRNNNNNNR","accounts.vendors":"RSNRRNSSSSR","tasks.urgent":"RRRRRSRRRRR","tasks.high":"RRRRRSRRRRR","tasks.normal":"RSSSSNSSSSR","tasks.low":"SSSSSNSSSSS","messages.waiting":"RSRNNNSSSSR","messages.late":"RRRNNNRRRRR","messages.mention":"RRRRRRRRRRR","messages.channels":"RRRNNNRRRRR","messages.upset":"RSRNNNSSSSR","messages.camps":"RSRNNNSSSSR","team.ot":"RRNNNNRRRRR","team.req":"RRNNNNRRRRR","team.meet":"RRNNNNRRRRR","stock.cons":"RRNNNNRRRRR","stock.photo":"RRNNNNRRRRR","stock.ret":"RRNNSNRRRRR","stock.pull":"RSNNNNSSSSR","delivery.waybills":"RRNNNNRRRRR","delivery.late":"RRNNNNRRRRR","delivery.daily":"RRNNNNRRRRR"}'::jsonb)
 where section = 'notif' and coalesce(data -> 'alertRoles', '{}'::jsonb) = '{}'::jsonb;
