-- Tests for 0171_agent_ready (agent chat flows, phase 3): the ready requests and reports of an assistant's chat.
-- One transaction, rolled back; NOTICE 'rls_agent_ready: ok' only if every case passed. Live-safe: made-up members, rows rolled back.
-- * the admin writes (a name and element › type › state rows), nobody else · a row is seen by who sees the assistant and holds its role
-- * none = everyone who opens the assistant · an extra role counts · the table is select-only · closed to anon

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000171a1', 'rd-adm.dev@ibtekr.local', '01000171a1'),
  ('00000000-0000-4000-8000-0000000171a2', 'rd-cs.dev@ibtekr.local', '01000171a2'),
  ('00000000-0000-4000-8000-0000000171a3', 'rd-ops.dev@ibtekr.local', '01000171a3'),
  ('00000000-0000-4000-8000-0000000171a4', 'rd-ext.dev@ibtekr.local', '01000171a4');
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms, extra_roles, level) values
  ('00000000-0000-4000-8000-0000000171a1', 'أدمن', 'rd-adm.dev@ibtekr.local', '01000171a1', 'admin', 'active', '{}', '{}', 'employee'),
  ('00000000-0000-4000-8000-0000000171a2', 'خدمة عملاء', 'rd-cs.dev@ibtekr.local', '01000171a2', 'cs', 'active', '{}', '{}', 'employee'),
  ('00000000-0000-4000-8000-0000000171a3', 'عمليات', 'rd-ops.dev@ibtekr.local', '01000171a3', 'ops', 'active', '{"cs.view":"F"}', '{}', 'employee'),
  ('00000000-0000-4000-8000-0000000171a4', 'عمليات وخدمة عملاء', 'rd-ext.dev@ibtekr.local', '01000171a4', 'ops', 'active', '{"cs.view":"F"}', '{cs}', 'employee');
delete from public.ai_agent_ready where true;

create or replace function pg_temp.as_member(p_uid text) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', 'aal2')::text, true);
end $$;
create temp table rd_ids (k text primary key, id uuid);
grant all on rd_ids to authenticated;

-- the admin: a ready request for everyone, a ready report for «cs»; the checks
select pg_temp.as_member('00000000-0000-4000-8000-0000000171a1');
do $$ begin
  insert into rd_ids values ('all', public.ai_agent_ready_save('{"agent":"cs","kind":"request","name":"متابعة أوردر متأخر","parts":[{"element":"orders","type":"delay","state":"late"}]}'));
  insert into rd_ids values ('cs', public.ai_agent_ready_save('{"agent":"cs","kind":"report","name":"المحادثات المستنية","role":"cs","parts":[{"element":"messages","type":"customers","state":"waiting"},{"element":"orders","type":"delay","state":"risk"}]}'));
  begin perform public.ai_agent_ready_save('{"agent":"cs","kind":"report","name":"<b>","parts":[{"element":"orders","type":"delay","state":"late"}]}'); raise exception 'case a name with <> is refused failed'; exception when invalid_parameter_value then null; end;
  begin perform public.ai_agent_ready_save('{"agent":"cs","kind":"report","name":"x","parts":[]}'); raise exception 'case no parts is refused failed'; exception when invalid_parameter_value then null; end;
  begin perform public.ai_agent_ready_save('{"agent":"cs","kind":"report","name":"x","parts":[{"element":"orders","type":"delay"}]}'); raise exception 'case a part without a state is refused failed'; exception when invalid_parameter_value then null; end;
  begin perform public.ai_agent_ready_save('{"agent":"cs","kind":"alert","name":"x","parts":[{"element":"orders","type":"delay","state":"late"}]}'); raise exception 'case a wrong kind is refused failed'; exception when invalid_parameter_value then null; end;
  begin perform public.ai_agent_ready_save('{"agent":"nobody","kind":"report","name":"x","parts":[{"element":"orders","type":"delay","state":"late"}]}'); raise exception 'case an unknown assistant is refused failed'; exception when invalid_parameter_value then null; end;
  begin perform public.ai_agent_ready_save('{"agent":"cs","kind":"report","name":"x","role":"no_such_role","parts":[{"element":"orders","type":"delay","state":"late"}]}'); raise exception 'case an unknown role is refused failed'; exception when invalid_parameter_value then null; end;
  if jsonb_array_length(public.ai_agent_ready_list('cs')) <> 2 then raise exception 'case the admin sees both failed'; end if;
  -- an edit keeps the id; the name and the parts change
  perform public.ai_agent_ready_save(jsonb_build_object('id', (select id from rd_ids where k = 'all'), 'agent', 'cs', 'kind', 'request', 'name', 'متابعة أوردر', 'parts', '[{"element":"orders","type":"delay","state":"risk"}]'::jsonb));
  if (select name from public.ai_agent_ready where id = (select id from rd_ids where k = 'all')) <> 'متابعة أوردر' then raise exception 'case an edit saves failed'; end if;
end $$;
reset role;

-- a cs member: both rows; writes nothing; the table is not writable directly
select pg_temp.as_member('00000000-0000-4000-8000-0000000171a2');
do $$ begin
  if jsonb_array_length(public.ai_agent_ready_list('cs')) <> 2 then raise exception 'case the role sees its rows and the open ones failed'; end if;
  begin perform public.ai_agent_ready_save('{"agent":"cs","kind":"request","name":"x","parts":[{"element":"orders","type":"delay","state":"late"}]}'); raise exception 'case a member writes nothing failed'; exception when insufficient_privilege then null; end;
  begin perform public.ai_agent_ready_delete((select id from rd_ids where k = 'cs')); raise exception 'case a member deletes nothing failed'; exception when insufficient_privilege then null; end;
  begin insert into public.ai_agent_ready (agent, kind, name, parts) values ('cs', 'request', 'x', '[{"element":"a","type":"b","state":"c"}]'); raise exception 'case no direct insert failed'; exception when insufficient_privilege then null; end;
end $$;
reset role;

-- an ops member who sees the assistant: the row with no role only; one with cs as an extra role: both
select pg_temp.as_member('00000000-0000-4000-8000-0000000171a3');
do $$ begin
  if jsonb_array_length(public.ai_agent_ready_list('cs')) <> 1 or (public.ai_agent_ready_list('cs') -> 0 ->> 'kind') <> 'request' then raise exception 'case another role sees the open row only failed'; end if;
  if (select count(*) from public.ai_agent_ready) <> 1 then raise exception 'case the table follows the same rule failed'; end if;
end $$;
reset role;
select pg_temp.as_member('00000000-0000-4000-8000-0000000171a4');
do $$ begin
  if jsonb_array_length(public.ai_agent_ready_list('cs')) <> 2 then raise exception 'case an extra role sees its rows failed'; end if;
end $$;
reset role;

-- the admin deletes; anon has nothing
select pg_temp.as_member('00000000-0000-4000-8000-0000000171a1');
do $$ begin
  perform public.ai_agent_ready_delete((select id from rd_ids where k = 'cs'));
  if jsonb_array_length(public.ai_agent_ready_list('cs')) <> 1 then raise exception 'case the admin deletes failed'; end if;
  if has_function_privilege('anon', 'public.ai_agent_ready_save(jsonb)', 'EXECUTE') or has_function_privilege('anon', 'public.ai_agent_ready_list(text)', 'EXECUTE') then raise exception 'case closed to anon failed'; end if;
end $$;
reset role;

do $$ begin raise notice 'rls_agent_ready: ok'; end $$;
rollback;
