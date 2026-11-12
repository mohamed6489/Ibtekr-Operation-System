-- Tests for 0082_agent_requests (the owner, 12 Nov — «تقديم طلب» from each assistant = a team request to the human role). Depends on
-- 0001_identity … 0082. Runs in one transaction and rolls back; prints NOTICE 'rls_agent_requests: ok' only if every case passed.
-- Live-safe: its made-up members and requests are rolled back.
-- * ticket_request_create(kind, project, input): an internal team request with the kind and the project, to the kind's role unless
--   another was picked; ticket_create's rules (tickets.manage F → else 42501; an unknown role 22023); an unknown kind 22023
-- * the designer sees and works the request; a member never writes mkt_requests any more; closed to anon
-- * ticket_request_server (mkt-ads — the admin approves the media buyer's «نسخة جديدة»): service_role only; a design request as the
--   deciding member to «ديزاينر» with its timeline; a long title 22023

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000082a1', 'ar-ops.dev@ibtekr.local', '010000082a1'),
  ('00000000-0000-4000-8000-0000000082a2', 'ar-des.dev@ibtekr.local', '010000082a2'),
  ('00000000-0000-4000-8000-0000000082a3', 'ar-vw.dev@ibtekr.local',  '010000082a3');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u where u.email like 'ar-%.dev@ibtekr.local';
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-0000000082a1', 'عمليات الطلبات', 'ar-ops.dev@ibtekr.local', '010000082a1', 'ops',      'active', '{}'),
  ('00000000-0000-4000-8000-0000000082a2', 'ديزاينر الطلبات', 'ar-des.dev@ibtekr.local', '010000082a2', 'designer', 'active', '{}'),
  ('00000000-0000-4000-8000-0000000082a3', 'مشاهد الطلبات',  'ar-vw.dev@ibtekr.local',  '010000082a3', 'viewer',   'active', '{}');

create or replace function pg_temp.as_member(p_uid text) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;

do $$ begin
  if has_function_privilege('anon', 'public.ticket_request_create(text, text, jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.ticket_request_create(text, text, jsonb)', 'execute') then
    raise exception 'case ticket_request_create: closed to anon, open to the members failed';
  end if;
  if has_function_privilege('anon', 'public.ticket_request_server(text, text, text, text, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.ticket_request_server(text, text, text, text, uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.ticket_request_server(text, text, text, text, uuid)', 'execute') then
    raise exception 'case ticket_request_server: the server only failed';
  end if;
  if has_table_privilege('authenticated', 'public.mkt_requests', 'INSERT') or has_table_privilege('authenticated', 'public.mkt_requests', 'UPDATE') then
    raise exception 'case a member never writes mkt_requests failed';
  end if;
  if not has_column_privilege('authenticated', 'public.tickets', 'kind', 'SELECT') or not has_column_privilege('authenticated', 'public.mkt_requests', 'ticket_id', 'SELECT') then
    raise exception 'case the members read the kind and the link failed';
  end if;
end $$;

-- ops (tickets.manage F) asks the designer and the developer
select pg_temp.as_member('00000000-0000-4000-8000-0000000082a1');
do $$
declare
  t1 bigint; t2 bigint; r record;
begin
  t1 := public.ticket_request_create('design', '  عروض   الشتا ', '{"title":"3 بوستات","description":"1080×1350 للمنتجات الجديدة","priority":"high","followUp":"2026-11-20"}');
  select * into r from public.tickets where id = t1;
  if r.type <> 'internal' or r.kind <> 'design' or r.project <> 'عروض الشتا' or r.assignee_role <> 'ديزاينر' or r.priority <> 'high' or r.created_by_name <> 'عمليات الطلبات' then
    raise exception 'case a design request = an internal request to «ديزاينر» with its project failed (% % % %)', r.type, r.kind, r.project, r.assignee_role;
  end if;
  perform set_config('ar.t1', t1::text, true);
  t2 := public.ticket_request_create('dev', null, '{"title":"صفحة هبوط","description":"لعروض الشتا","priority":"normal","assigneeRole":"مدير النظام"}');
  if (select assignee_role from public.tickets where id = t2) <> 'مدير النظام' or (select kind from public.tickets where id = t2) <> 'dev' then
    raise exception 'case a picked role is kept failed';
  end if;
  perform set_config('ar.t2', t2::text, true);
  begin perform public.ticket_request_create('logo', null, '{"title":"x","description":"x","priority":"normal"}'); raise exception 'case an unknown kind failed';
  exception when invalid_parameter_value then null; end;
  begin perform public.ticket_request_create('design', null, '{"title":"x","description":"x","priority":"normal","assigneeRole":"فلان"}'); raise exception 'case an unknown role failed';
  exception when invalid_parameter_value then null; end;
  begin perform public.ticket_request_create('media', null, '{"title":"","description":"x","priority":"normal"}'); raise exception 'case ticket_create''s rules apply failed';
  exception when invalid_parameter_value then null; end;
end $$;
reset role;

-- the designer (tickets.view P, manage F) sees their role's request and works it
select pg_temp.as_member('00000000-0000-4000-8000-0000000082a2');
do $$ begin
  -- live-safe: the live project has requests of its own (0082 moved the old ones), so by id and by role
  if not exists (select 1 from public.tickets where id = current_setting('ar.t1')::bigint) or exists (select 1 from public.tickets where id = current_setting('ar.t2')::bigint)
     or exists (select 1 from public.tickets where kind is not null and assignee_role <> 'ديزاينر') then raise exception 'case the designer sees the design request only failed'; end if;
  perform public.ticket_act(current_setting('ar.t1')::bigint, 'set_status', '{"status":"in_progress"}');
  if (select status from public.tickets where id = current_setting('ar.t1')::bigint) <> 'in_progress' then raise exception 'case the designer works it failed'; end if;
end $$;
reset role;

-- the server's request (runner = the service role's path): as the deciding member, to «ديزاينر», with its two events
do $$
declare
  t3 bigint; r record;
begin
  t3 := public.ticket_request_server('design', 'Macrame', 'نسخة جديدة لإعلان «carousel»', 'الميديا باير: الناس زهقت منه', '00000000-0000-4000-8000-0000000082a1');
  select * into r from public.tickets where id = t3;
  if r.kind <> 'design' or r.type <> 'internal' or r.assignee_role <> 'ديزاينر' or r.project <> 'Macrame' or r.created_by <> '00000000-0000-4000-8000-0000000082a1'
     or r.created_by_name <> 'عمليات الطلبات' or r.status <> 'open' then
    raise exception 'case the server request = a design request as the deciding member failed';
  end if;
  if (select count(*) from public.ticket_events where ticket_id = t3) <> 2 then raise exception 'case the server request has its timeline failed'; end if;
  begin perform public.ticket_request_server('design', null, repeat('x', 81), 'x', null); raise exception 'case a long title failed';
  exception when invalid_parameter_value then null; end;
end $$;

-- a viewer (tickets.manage N) never opens one
select pg_temp.as_member('00000000-0000-4000-8000-0000000082a3');
do $$ begin
  begin perform public.ticket_request_create('design', null, '{"title":"x","description":"x","priority":"normal"}'); raise exception 'case tickets.manage F is needed failed';
  exception when insufficient_privilege then null; end;
  raise notice 'rls_agent_requests: ok';
end $$;
reset role;

rollback;
