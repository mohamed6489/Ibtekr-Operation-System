-- 0082_agent_requests (the owner, 12 Nov — «تقديم طلب» beside each assistant in التسويق: a request to the human designer / media buyer /
-- developer «بنفس طريقة بوب أب طلبات الفريق… ولما يتعمل يتسجل هنا في صفحة الديزاينر أو المبرمج ونقول مين مقدم الطلب… ويبقى مربوط بصفحة
-- طلبات الفريق فالتاسك تروح هناك هي كمان»). Plan: docs/superpowers/plans/2026-11-12-marketing-agents.md (decision 4).
-- * a request = a team request (ticket): tickets.kind 'design' | 'dev' | 'media' (internal type) + tickets.project; one source — the
--   marketing page lists them, «طلبات الفريق» works them (their role, their statuses, their timeline)
-- * ticket_request_create(p_kind, p_project, p_input): ticket_create's rules (tickets.manage F, any role, the files…) + the kind and the
--   project; the request goes to the kind's role when it answers (designer «ديزاينر» · developer «مبرمج» · media_buyer «ميديا باير»)
--   unless the member picked another
-- * mkt_requests (0053) move over once (ticket_id marks them): the status as the ticket's, the author and the date kept; the table stays
--   for its history and nothing writes it any more (the media buyer's «نسخة جديدة» opens a design request — mkt-ads)

alter table public.tickets add column if not exists kind text check (kind is null or kind in ('design', 'dev', 'media'));
alter table public.tickets add column if not exists project text check (project is null or char_length(project) <= 60);
create index if not exists tickets_kind_idx on public.tickets (kind, status, last_update desc) where kind is not null;
alter table public.mkt_requests add column if not exists ticket_id bigint references public.tickets on delete set null;

-- the label of a kind's role, else the system's manager
create or replace function public.ticket_kind_role(p_kind text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((public.ticket_role_labels(case p_kind when 'design' then 'designer' when 'dev' then 'developer' when 'media' then 'media_buyer' end))[1], 'مدير النظام')
$$;
revoke execute on function public.ticket_kind_role(text) from public, anon;
grant execute on function public.ticket_kind_role(text) to authenticated, service_role;

create or replace function public.ticket_request_create(p_kind text, p_project text, p_input jsonb) returns bigint
language plpgsql volatile security definer set search_path = public as $$
declare
  v_id bigint; v_in jsonb;
begin
  if p_kind is null or p_kind not in ('design', 'dev', 'media') then raise exception 'invalid: kind' using errcode = '22023'; end if;
  if jsonb_typeof(p_input) <> 'object' then raise exception 'invalid: input' using errcode = '22023'; end if;
  v_in := p_input || jsonb_build_object('type', 'internal')
          || case when coalesce(p_input ->> 'assigneeRole', '') = '' then jsonb_build_object('assigneeRole', public.ticket_kind_role(p_kind)) else '{}'::jsonb end;
  v_id := public.ticket_create(v_in); -- tickets.manage F, the role, the title, the files… (42501 / 22023 as there)
  update public.tickets set kind = p_kind, project = nullif(public.ticket_clean(p_project, 60), '') where id = v_id;
  return v_id;
end
$$;
revoke execute on function public.ticket_request_create(text, text, jsonb) from public, anon;
grant execute on function public.ticket_request_create(text, text, jsonb) to authenticated, service_role;

-- the server's design request (mkt-ads: the admin approves the media buyer's «نسخة جديدة») — as the deciding member, to the kind's role
create or replace function public.ticket_request_server(p_kind text, p_project text, p_title text, p_desc text, p_by uuid) returns bigint
language plpgsql volatile security definer set search_path = public as $$
declare
  v_id bigint; v_name text; v_role text; v_title text := public.ticket_clean(p_title, 1000); v_desc text := public.ticket_clean(p_desc, 5000); v_to text;
begin
  if p_kind is null or p_kind not in ('design', 'dev', 'media') then raise exception 'invalid: kind' using errcode = '22023'; end if;
  if v_title = '' or char_length(v_title) > 80 then raise exception 'invalid: title' using errcode = '22023'; end if;
  if v_desc = '' then v_desc := v_title; end if;
  select left(p.name, 120), left(coalesce((public.ticket_role_labels(p.role_id))[1], r.name, 'عضو'), 60) into v_name, v_role
    from public.profiles p left join public.roles r on r.id = p.role_id where p.id = p_by;
  v_name := coalesce(v_name, 'السيستم'); v_role := coalesce(v_role, 'عضو'); v_to := public.ticket_kind_role(p_kind);
  insert into public.tickets (type, kind, project, title, description, priority, assignee_role, status, created_by, created_by_name, created_by_role)
    values ('internal', p_kind, nullif(public.ticket_clean(p_project, 60), ''), v_title, v_desc, 'normal', v_to, 'open', p_by, v_name, v_role)
    returning id into v_id;
  insert into public.ticket_events (ticket_id, kind, actor, actor_name, actor_role, text)
    values (v_id, 'event', p_by, v_name, v_role, v_name || ' وافق على اقتراح الميديا باير وفتح طلب لدور «' || v_to || '»'),
           (v_id, 'message', p_by, v_name, v_role, left(v_desc, 7000));
  return v_id;
end
$$;
revoke execute on function public.ticket_request_server(text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.ticket_request_server(text, text, text, text, uuid) to service_role;

-- ---------------------------------------------------------------- the old requests move over once

do $$
declare
  q record; v_id bigint; v_name text; v_role text; v_status text;
begin
  for q in select * from public.mkt_requests where ticket_id is null order by id loop
    select left(p.name, 120), left(coalesce((public.ticket_role_labels(p.role_id))[1], r.name, 'عضو'), 60) into v_name, v_role
      from public.profiles p left join public.roles r on r.id = p.role_id where p.id = q.created_by;
    v_status := case q.status when 'بيتعمل' then 'in_progress' when 'جاهز للمراجعة' then 'waiting' when 'خلص' then 'resolved' else 'open' end;
    insert into public.tickets (type, kind, project, title, description, priority, assignee_role, status, created_by, created_by_name, created_by_role,
                                created_at, last_update, resolution_outcome, resolved_at)
      values ('internal', case q.kind when 'dev' then 'dev' else 'design' end, left(q.project, 60), left(btrim(q.title), 80),
              left(coalesce(nullif(btrim(q.details), ''), btrim(q.title)), 5000), 'normal',
              public.ticket_kind_role(case q.kind when 'dev' then 'dev' else 'design' end), v_status, q.created_by,
              coalesce(v_name, 'عضو'), coalesce(v_role, 'عضو'), q.created_at, q.updated_at,
              case when v_status = 'resolved' then 'اتحلت المشكلة' end, case when v_status = 'resolved' then coalesce(q.done_at, q.updated_at) end)
      returning id into v_id;
    insert into public.ticket_events (ticket_id, kind, at, actor, actor_name, actor_role, text)
      values (v_id, 'event', q.created_at, q.created_by, coalesce(v_name, 'عضو'), coalesce(v_role, 'عضو'), coalesce(v_name, 'عضو') || ' طلب من صفحة التسويق (اتنقل من طلبات المساعدين)'),
             (v_id, 'message', q.created_at, q.created_by, coalesce(v_name, 'عضو'), coalesce(v_role, 'عضو'), left(coalesce(nullif(btrim(q.details), ''), btrim(q.title)), 7000));
    update public.mkt_requests set ticket_id = v_id where id = q.id;
  end loop;
end $$;

-- nothing writes mkt_requests any more from a member (the requests are team requests now); the server keeps its grant
revoke insert, update, delete on public.mkt_requests from authenticated;
