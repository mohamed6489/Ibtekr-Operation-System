-- Tests for 0097_ticket_member (owner batch 2 decision 32): «طلب جديد» to a role and then «كل الدور» or one member of it. One
-- transaction, rolled back; NOTICE 'rls_ticket_member: ok' only if every case passed. Live-safe: made-up members and tickets.
-- * ticket_create: assigneeMember must be an active member holding the role (main or extra) — else 22023 invalid: assigneeMember
-- * ticket_act update: a new role clears the member; a member outside the role 22023; '' = the whole role; the events name the member
-- * the assigned member sees and works the ticket even after leaving the role (tickets_select / ticket_act); nobody else gains it

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000097a1', 'tm-adm.dev@ibtekr.local', '010000097a1'),
  ('00000000-0000-4000-8000-0000000097a2', 'tm-acc.dev@ibtekr.local', '010000097a2'),
  ('00000000-0000-4000-8000-0000000097a3', 'tm-acc2.dev@ibtekr.local', '010000097a3'),
  ('00000000-0000-4000-8000-0000000097a4', 'tm-ops.dev@ibtekr.local', '010000097a4'),
  ('00000000-0000-4000-8000-0000000097a5', 'tm-off.dev@ibtekr.local', '010000097a5'),
  ('00000000-0000-4000-8000-0000000097a6', 'tm-view.dev@ibtekr.local', '010000097a6');
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms, extra_roles) values
  ('00000000-0000-4000-8000-0000000097a1', 'أدمن الطلبات', 'tm-adm.dev@ibtekr.local', '010000097a1', 'admin', 'active', '{}', '{}'),
  ('00000000-0000-4000-8000-0000000097a2', 'منى الحسابات', 'tm-acc.dev@ibtekr.local', '010000097a2', 'accounts', 'active', '{}', '{}'),
  ('00000000-0000-4000-8000-0000000097a3', 'هالة الحسابات', 'tm-acc2.dev@ibtekr.local', '010000097a3', 'accounts', 'active', '{}', '{}'),
  ('00000000-0000-4000-8000-0000000097a4', 'علي العمليات', 'tm-ops.dev@ibtekr.local', '010000097a4', 'ops', 'active', '{}', '{accounts}'),
  ('00000000-0000-4000-8000-0000000097a5', 'موقوف الحسابات', 'tm-off.dev@ibtekr.local', '010000097a5', 'accounts', 'suspended', '{}', '{}'),
  ('00000000-0000-4000-8000-0000000097a6', 'مشاهد', 'tm-view.dev@ibtekr.local', '010000097a6', 'viewer', 'active', '{"tickets.view":"P","tickets.manage":"F"}', '{}');

create or replace function pg_temp.as_member(p_uid text) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', 'aal2')::text, true);
end $$;
create temp table tm_ids (k text primary key, id bigint);
grant all on tm_ids to authenticated;

-- ================================================================ ticket_create with a member
select pg_temp.as_member('00000000-0000-4000-8000-0000000097a1');
do $$
declare v_id bigint; r record;
begin
  v_id := public.ticket_create(jsonb_build_object('type', 'internal', 'title', 'طلب لمنى', 'description', 'راجعي الكشف', 'priority', 'normal',
    'assigneeRole', 'الحسابات', 'assigneeMember', '00000000-0000-4000-8000-0000000097a2'));
  insert into tm_ids values ('one', v_id);
  select assignee_role, assignee_member, assignee_member_name into r from public.tickets where id = v_id;
  if r.assignee_member <> '00000000-0000-4000-8000-0000000097a2' or r.assignee_member_name <> 'منى الحسابات' then raise exception 'case the member is stored with the name failed'; end if;
  if not exists (select 1 from public.ticket_events where ticket_id = v_id and text like '%الحسابات» — منى الحسابات%') then raise exception 'case the event names the member failed'; end if;
  -- an extra role counts
  v_id := public.ticket_create(jsonb_build_object('type', 'internal', 'title', 'طلب لعلي', 'description', 'وصف', 'priority', 'low',
    'assigneeRole', 'الحسابات', 'assigneeMember', '00000000-0000-4000-8000-0000000097a4'));
  -- the whole role (no member)
  v_id := public.ticket_create(jsonb_build_object('type', 'internal', 'title', 'طلب للدور', 'description', 'وصف', 'priority', 'low', 'assigneeRole', 'الحسابات'));
  insert into tm_ids values ('role', v_id);
  if (select assignee_member from public.tickets where id = v_id) is not null then raise exception 'case no member = the whole role failed'; end if;
  -- refused: outside the role, suspended, not a uuid
  begin perform public.ticket_create(jsonb_build_object('type', 'internal', 'title', 'x', 'description', 'y', 'priority', 'low', 'assigneeRole', 'خدمة العملاء', 'assigneeMember', '00000000-0000-4000-8000-0000000097a2'));
    raise exception 'case a member outside the role is refused failed'; exception when invalid_parameter_value then if sqlerrm <> 'invalid: assigneeMember' then raise; end if; end;
  begin perform public.ticket_create(jsonb_build_object('type', 'internal', 'title', 'x', 'description', 'y', 'priority', 'low', 'assigneeRole', 'الحسابات', 'assigneeMember', '00000000-0000-4000-8000-0000000097a5'));
    raise exception 'case a suspended member is refused failed'; exception when invalid_parameter_value then null; end;
  begin perform public.ticket_create(jsonb_build_object('type', 'internal', 'title', 'x', 'description', 'y', 'priority', 'low', 'assigneeRole', 'الحسابات', 'assigneeMember', 'منى'));
    raise exception 'case a bad member id is refused failed'; exception when invalid_parameter_value then null; end;
end $$;
reset role;

-- ================================================================ ticket_act update: the member and the role together
select pg_temp.as_member('00000000-0000-4000-8000-0000000097a1');
do $$
declare v_id bigint := (select id from tm_ids where k = 'role');
begin
  perform public.ticket_act(v_id, 'update', '{"assigneeMember":"00000000-0000-4000-8000-0000000097a3"}');
  if (select assignee_member_name from public.tickets where id = v_id) <> 'هالة الحسابات' then raise exception 'case update sets the member failed'; end if;
  if not exists (select 1 from public.ticket_events where ticket_id = v_id and text like '%مع هالة الحسابات%') then raise exception 'case the event of the member failed'; end if;
  begin perform public.ticket_act(v_id, 'update', '{"assigneeMember":"00000000-0000-4000-8000-0000000097a6"}'); raise exception 'case update refuses a member outside the role failed';
  exception when invalid_parameter_value then null; end;
  -- security review: a new role with the same member passed again is checked against the new role
  begin perform public.ticket_act(v_id, 'update', '{"assigneeRole":"خدمة العملاء","assigneeMember":"00000000-0000-4000-8000-0000000097a3"}');
    raise exception 'case a new role re-checks the member failed'; exception when invalid_parameter_value then null; end;
  perform public.ticket_act(v_id, 'update', '{"assigneeRole":"خدمة العملاء"}');
  if (select assignee_member from public.tickets where id = v_id) is not null or (select assignee_role from public.tickets where id = v_id) <> 'خدمة العملاء' then raise exception 'case a new role clears the member failed'; end if;
  perform public.ticket_act(v_id, 'update', '{"assigneeRole":"الحسابات","assigneeMember":"00000000-0000-4000-8000-0000000097a2"}');
  perform public.ticket_act(v_id, 'update', '{"assigneeMember":""}');
  if (select assignee_member from public.tickets where id = v_id) is not null then raise exception 'case an empty member = the whole role failed'; end if;
  if not exists (select 1 from public.ticket_events where ticket_id = v_id and text like '%لكل دور «الحسابات»%') then raise exception 'case the event of the whole role failed'; end if;
end $$;
reset role;

-- ================================================================ the assigned member sees and works it after leaving the role
update public.profiles set role_id = 'viewer', custom_perms = '{"tickets.view":"P","tickets.manage":"F"}' where id = '00000000-0000-4000-8000-0000000097a2';
select pg_temp.as_member('00000000-0000-4000-8000-0000000097a2');
do $$
declare v_one bigint := (select id from tm_ids where k = 'one'); v_role bigint := (select id from tm_ids where k = 'role');
begin
  if not exists (select 1 from public.tickets where id = v_one) then raise exception 'case the assigned member sees the ticket failed'; end if;
  if exists (select 1 from public.tickets where id = v_role) then raise exception 'case a role ticket is not seen after leaving the role failed'; end if;
  perform public.ticket_act(v_one, 'set_status', '{"status":"in_progress"}');
  if (select status from public.tickets where id = v_one) <> 'in_progress' then raise exception 'case the assigned member works the ticket failed'; end if;
  begin perform public.ticket_act(v_role, 'set_status', '{"status":"in_progress"}'); raise exception 'case a role ticket is not workable failed'; exception when no_data_found then null; end;
end $$;
reset role;
-- another viewer: nothing
select pg_temp.as_member('00000000-0000-4000-8000-0000000097a6');
do $$ begin
  if exists (select 1 from public.tickets where id = (select id from tm_ids where k = 'one')) then raise exception 'case nobody else gains the ticket failed'; end if;
end $$;
reset role;

do $$ begin raise notice 'rls_ticket_member: ok'; end $$;
rollback;
