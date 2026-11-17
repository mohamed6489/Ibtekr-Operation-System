-- RLS / rule tests for 0120_ai_agents («الذكاء الاصطناعي»): the eight built-in assistants, each seen with its page's permission (the
-- admin all); a new one is the admin's (an id «c_…», archived not deleted, a builtin never archived); the rules and skills in one list
-- with the assistants each is for; the chats follow the assistant's permission; a request from any assistant goes to its role.
-- Depends on 0001 … 0120. One transaction rolled back; prints NOTICE 'rls_ai_agents: ok' only if every case passed. Live-safe.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000120a1', 'ag-adm.dev@ibtekr.local', '01000120a01'),
  ('00000000-0000-4000-8000-0000000120a2', 'ag-acc.dev@ibtekr.local', '01000120a02'),
  ('00000000-0000-4000-8000-0000000120a3', 'ag-ops.dev@ibtekr.local', '01000120a03');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u where u.email like 'ag-%.dev@ibtekr.local';
insert into public.profiles (id, name, email, phone, role_id, status) values
  ('00000000-0000-4000-8000-0000000120a1', 'أدمن المساعدين', 'ag-adm.dev@ibtekr.local', '01000120a01', 'admin', 'active'),
  ('00000000-0000-4000-8000-0000000120a2', 'حسابات المساعدين', 'ag-acc.dev@ibtekr.local', '01000120a02', 'accounts', 'active'),
  ('00000000-0000-4000-8000-0000000120a3', 'عمليات المساعدين', 'ag-ops.dev@ibtekr.local', '01000120a03', 'ops', 'active');

-- the accountant's chat (the accounts member's) and a buyer's chat of the same member (made by the server)
insert into public.mkt_agent_chats (id, member_id, agent, title) values
  ('00000000-0000-4000-8000-0000000120c1', '00000000-0000-4000-8000-0000000120a2', 'accountant', 'مصروفات الشهر'),
  ('00000000-0000-4000-8000-0000000120c2', '00000000-0000-4000-8000-0000000120a2', 'buyer', 'شات قديم');
insert into public.mkt_agent_messages (chat_id, role, text) values ('00000000-0000-4000-8000-0000000120c1', 'user', 'صرفنا كام؟');

do $$ begin
  if (select count(*) from public.ai_agents where builtin) <> 8 then raise exception 'case the eight built-ins failed'; end if;
  if (select string_agg(id, ',' order by sort) from public.ai_agents where builtin) <> 'buyer,designer,dev,stock,cs,makers,accountant,hr' then raise exception 'case their order failed'; end if;
  begin insert into public.mkt_agent_chats (member_id, agent) values ('00000000-0000-4000-8000-0000000120a2', 'robot'); raise exception 'case a chat is with a known assistant failed';
  exception when foreign_key_violation then null; end;
  if has_function_privilege('anon', 'public.ai_agents_list()', 'execute') or has_function_privilege('anon', 'public.ai_agent_save(jsonb)', 'execute')
    or has_function_privilege('anon', 'public.ai_agent_kb_set(text, jsonb)', 'execute') or has_function_privilege('anon', 'public.ai_agent_can(text)', 'execute')
    or has_table_privilege('authenticated', 'public.ai_agents', 'select') or has_table_privilege('authenticated', 'public.ai_agent_kb', 'select') then
    raise exception 'case closed to anon and to direct reads failed'; end if;
end $$;

set local role authenticated;

-- ================================================================ accounts (accounts.view, no marketing / inventory / cs / hr)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000120a2","role":"authenticated"}', true);
do $$ declare l jsonb; begin
  l := public.ai_agents_list();
  -- by the role's own permissions (accounts: no marketing.view, no cs.view)
  if not exists (select 1 from jsonb_array_elements(l) x where x ->> 'id' = 'accountant') or exists (select 1 from jsonb_array_elements(l) x where x ->> 'id' in ('buyer', 'designer', 'dev', 'cs'))
    then raise exception 'case accounts sees by its permissions failed: %', l; end if;
  if exists (select 1 from jsonb_array_elements(l) x where x ->> 'instructions' <> '') then raise exception 'case the instructions are the admin''s failed'; end if;
  if not public.ai_agent_can('accountant') or public.ai_agent_can('buyer') or public.ai_agent_can('robot') then raise exception 'case ai_agent_can failed'; end if;
  -- the chats follow the assistant: the accountant's yes, the buyer's (no marketing.view) no
  if (select string_agg(agent, ',') from public.mkt_agent_chats) <> 'accountant' then raise exception 'case the chats by the assistant''s permission failed'; end if;
  if (select count(*) from public.mkt_agent_messages) <> 1 then raise exception 'case the turns by the assistant''s permission failed'; end if;
  begin perform public.mkt_agent_chat_delete('00000000-0000-4000-8000-0000000120c2'); raise exception 'case a chat of an assistant I do not see is not deleted failed';
  exception when no_data_found then null; end;
  perform public.mkt_agent_chat_delete('00000000-0000-4000-8000-0000000120c1');
  if (select count(*) from public.mkt_agent_chats) <> 0 then raise exception 'case my chat deleted failed'; end if;
  begin perform public.ai_agent_save('{"name":"مساعد"}'); raise exception 'case a member never adds failed'; exception when insufficient_privilege then null; end;
  begin perform public.ai_agent_kb_set('rules', '[]'); raise exception 'case a member never sets rules failed'; exception when insufficient_privilege then null; end;
  if public.ai_agent_kb_list() <> '[]'::jsonb then raise exception 'case the list is the admin''s failed'; end if;
end $$;

-- ================================================================ the admin: everyone, a new one, the rules with their assistants
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000120a1","role":"authenticated"}', true);
do $$ declare v text; n int; l jsonb; begin
  if jsonb_array_length(public.ai_agents_list()) <> 8 then raise exception 'case the admin sees all failed'; end if;
  v := public.ai_agent_save('{"name":"مساعد المنتجات","icon":"package","perm":"products.view","sees":["orders","sales"],"role":"الحسابات","about":"الأكتر مبيعًا","instructions":"ركّز على الأقسام","suggestions":["إيه الأكتر مبيعًا؟"]}');
  if v !~ '^c_[0-9a-f]{10}$' then raise exception 'case a new one gets an id failed: %', v; end if;
  if (select x ->> 'perm' || '|' || (x -> 'sees')::text || '|' || (x ->> 'role') from jsonb_array_elements(public.ai_agents_list()) x where x ->> 'id' = v) <> 'products.view|["orders", "sales"]|الحسابات' then raise exception 'case a new one stored failed'; end if;
  -- a builtin: the name and the words change, its permission and what it reads do not
  perform public.ai_agent_save('{"id":"stock","name":"أمين المخزن","perm":"orders.view","sees":["hr"],"intro":"أهلًا"}');
  if (select x ->> 'name' || '|' || (x ->> 'perm') || '|' || (x -> 'sees')::text || '|' || (x ->> 'intro') from jsonb_array_elements(public.ai_agents_list()) x where x ->> 'id' = 'stock') <> 'أمين المخزن|inventory.view|["inventory", "orders"]|أهلًا' then raise exception 'case a builtin keeps its permission failed'; end if;
  -- the limits
  begin perform public.ai_agent_save('{"name":"x"}'); raise exception 'case a name of 2 failed'; exception when invalid_parameter_value then null; end;
  begin perform public.ai_agent_save('{"name":"مساعد","perm":"settings.view"}'); raise exception 'case a page permission failed'; exception when invalid_parameter_value then null; end;
  begin perform public.ai_agent_save('{"name":"مساعد","perm":"orders.view","sees":["salaries"]}'); raise exception 'case known data failed'; exception when invalid_parameter_value then null; end;
  begin perform public.ai_agent_save('{"name":"<b>مساعد</b>","perm":"orders.view"}'); raise exception 'case no tags failed'; exception when invalid_parameter_value then null; end;
  begin perform public.ai_agent_save('{"name":"مساعد","perm":"orders.view","admin":true}'); raise exception 'case known keys failed'; exception when invalid_parameter_value then null; end;
  begin perform public.ai_agent_save('{"id":"robot","name":"مساعد"}'); raise exception 'case an unknown id failed'; exception when no_data_found then null; end;
  -- archive: a new one yes (and back), a builtin never
  begin perform public.ai_agent_archive('cs'); raise exception 'case a builtin is never archived failed'; exception when invalid_parameter_value then null; end;
  perform public.ai_agent_archive(v);
  if not ((public.ai_agents_list() -> 8 ->> 'archived')::boolean) then raise exception 'case the admin sees it archived failed'; end if;
  if public.ai_agent_can(v) then raise exception 'case an archived one is closed failed'; end if;
  perform public.ai_agent_archive(v, false);
  perform public.ai_agent_order(array[v, 'hr']);
  if (select string_agg(x ->> 'id', ',') from jsonb_array_elements(public.ai_agents_list()) x) not like v || ',hr,%' then raise exception 'case the order failed'; end if;
  -- the rules: one list, each with its assistants (empty = all)
  n := public.ai_agent_kb_set('rules', jsonb_build_array(
    jsonb_build_object('section', 'البراند', 'title', 'الألوان', 'text', 'أخضر ودهبي', 'agents', jsonb_build_array('designer', 'buyer')),
    jsonb_build_object('section', 'عام', 'title', 'اللهجة', 'text', 'مصري', 'agents', '[]'::jsonb),
    jsonb_build_object('section', 'المخزن', 'title', 'المرتجع', 'text', 'افحص الأول', 'agents', jsonb_build_array('stock', v))));
  if n <> 3 then raise exception 'case three rules failed'; end if;
  -- the rules alone (a live database may already hold the admin's skills)
  select coalesce(jsonb_agg(x), '[]'::jsonb) into l from jsonb_array_elements(public.ai_agent_kb_list()) x where x ->> 'kind' = 'rules';
  if jsonb_array_length(l) <> 3 or l -> 0 ->> 'title' <> 'الألوان' or l -> 1 -> 'agents' <> '[]'::jsonb then raise exception 'case the list back failed: %', l; end if;
  perform public.ai_agent_kb_set('skills', '[{"section":"الريلز","title":"Hook","text":"أول ثانيتين","agents":["designer"]}]');
  if jsonb_array_length(public.ai_agent_kb_list()) <> 4 then raise exception 'case rules and skills apart failed'; end if;
  perform public.ai_agent_kb_set('rules', '[]');
  if (select count(*) from jsonb_array_elements(public.ai_agent_kb_list()) x where x ->> 'kind' = 'rules') <> 0 or (select count(*) from jsonb_array_elements(public.ai_agent_kb_list()) x where x ->> 'kind' = 'skills') <> 1 then raise exception 'case a kind replaced alone failed'; end if;
  begin perform public.ai_agent_kb_set('rules', '[{"section":"x","title":"t","agents":["robot"]}]'); raise exception 'case known assistants failed'; exception when invalid_parameter_value then null; end;
  begin perform public.ai_agent_kb_set('rules', '[{"section":"","title":"t"}]'); raise exception 'case a section failed'; exception when invalid_parameter_value then null; end;
  begin perform public.ai_agent_kb_set('notes', '[]'); raise exception 'case rules or skills failed'; exception when invalid_parameter_value then null; end;
  begin perform public.ai_agent_kb_set('rules', jsonb_build_array(jsonb_build_object('section', 's', 'title', 't', 'text', repeat('a', 1501)))); raise exception 'case a text limit failed'; exception when invalid_parameter_value then null; end;
  if (select count(*) from public.activity_log where action like 'ai.agent.%' and actor = '00000000-0000-4000-8000-0000000120a1') < 6 then raise exception 'case logged failed'; end if;
end $$;

-- ================================================================ ops: a request from the stock assistant goes to its role
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000120a3","role":"authenticated"}', true);
do $$ declare t bigint; begin
  if not public.ai_agent_can('stock') then raise exception 'case ops sees the stock assistant failed'; end if;
  t := public.ticket_request_create('stock', 'المخزن', '{"title":"رف جديد للمرتجعات","description":"محتاجين رف","priority":"normal"}');
  if (select kind || '|' || assignee_role from public.tickets where id = t) <> 'stock|اللوجستيك والشحن' then raise exception 'case the stock request to its role failed'; end if;
  begin perform public.ticket_request_create('robot', null, '{"title":"x","description":"x","priority":"normal"}'); raise exception 'case an unknown assistant failed';
  exception when invalid_parameter_value then null; end;
  begin perform public.ticket_request_create('buyer', null, '{"title":"x","description":"x","priority":"normal"}'); raise exception 'case the buyer keeps «media» failed';
  exception when invalid_parameter_value then null; end;
end $$;

reset role;
do $$ begin raise notice 'rls_ai_agents: ok'; end $$;
rollback;
