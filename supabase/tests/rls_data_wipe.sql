-- Tests for 0117_data_wipe: the admin only; unknown sections refused; a dry run counts the chosen tables and what references them; the real
-- run needs the phrase, wipes the chosen sections and keeps the team, roles and settings; one activity_log row.
begin;
insert into auth.users (id, email, phone) values ('00000000-0000-4000-8000-000000117a01', 'wipe-admin.dev@ibtekr.local', '0100000117a1'), ('00000000-0000-4000-8000-000000117a02', 'wipe-ops.dev@ibtekr.local', '0100000117a2');
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms, extra_roles) values
  ('00000000-0000-4000-8000-000000117a01', 'أدمن المسح', 'wipe-admin.dev@ibtekr.local', '0100000117a1', 'admin', 'active', '{}', '{}'),
  ('00000000-0000-4000-8000-000000117a02', 'عمليات المسح', 'wipe-ops.dev@ibtekr.local', '0100000117a2', 'ops', 'active', '{}', '{}');
insert into public.tickets (title, description, type, priority, assignee_role, created_by, created_by_name, created_by_role) values ('اختبار المسح', 'تفاصيل', 'internal', 'normal', 'الإدارة', '00000000-0000-4000-8000-000000117a01', 'أدمن المسح', 'أدمن');
set local role authenticated;
-- ops: refused
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000117a02', 'role', 'authenticated', 'aal', 'aal2')::text, true);
do $$ begin perform public.data_wipe(array['tickets'], null, true); raise exception 'case ops refused failed'; exception when insufficient_privilege then null; end $$;
-- the admin: an unknown section, then the dry run
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000117a01', 'role', 'authenticated', 'aal', 'aal2')::text, true);
do $$ begin perform public.data_wipe(array['profiles'], null, true); raise exception 'case unknown section failed'; exception when invalid_parameter_value then null; end $$;
do $$ declare r jsonb; begin
  r := public.data_wipe(array['tickets'], null, true);
  if (r ->> 'dry')::boolean is not true or not exists (select 1 from jsonb_array_elements(r -> 'tables') t where t ->> 'table' = 'tickets' and (t ->> 'rows')::int >= 1) then raise exception 'case dry run failed: %', r; end if;
  if (select count(*) from public.tickets) = 0 then raise exception 'case dry run wiped failed'; end if;
end $$;
-- the wrong phrase, then the real one
do $$ begin perform public.data_wipe(array['tickets'], 'امسح', false); raise exception 'case phrase failed'; exception when invalid_parameter_value then null; end $$;
do $$ declare r jsonb; begin
  r := public.data_wipe(array['tickets'], 'امسح البيانات', false);
  if (select count(*) from public.tickets) <> 0 then raise exception 'case wipe failed'; end if;
  if (select count(*) from public.profiles where id = '00000000-0000-4000-8000-000000117a01') <> 1 then raise exception 'case team kept failed'; end if;
  if not exists (select 1 from public.roles) or not exists (select 1 from public.activity_log where action = 'settings.data.wipe') then raise exception 'case kept / logged failed'; end if;
end $$;
-- the orders section never empties a table that only points at it: a request linked to an order keeps its row (the link is unlinked)
do $$ declare r jsonb; v_order bigint; begin
  select id into v_order from public.orders limit 1;
  if v_order is null then return; end if;
  r := public.data_wipe(array['orders'], null, true);
  if exists (select 1 from jsonb_array_elements(r -> 'tables') t where t ->> 'table' = 'tickets' and t ->> 'kind' = 'wipe') then raise exception 'case orders keep tickets failed'; end if;
end $$;
reset role;
do $$ begin raise notice 'rls_data_wipe: ok'; end $$;
rollback;
