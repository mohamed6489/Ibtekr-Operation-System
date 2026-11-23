-- RLS / rule tests for 0150_system_brain (the system first, an outside AI by the member's approval — the owner 22 Nov): who answered a
-- turn and what it was given are the server's to write; the system's own answer is kept in the member's own chat with an assistant
-- they see (text only, marked «system», throttled); «المدير العام» is a built-in for whoever opens the team's requests; the numbers
-- the assistants watch are the server's row, and a member is given the assistants they see and — of each — only the numbers of the
-- pages they read in full; the makers without a bank account are counted for the server only.
-- Depends on 0001 … 0150. One transaction rolled back; prints NOTICE 'rls_system_brain: ok' only if every case passed. Live-safe.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000150a1', 'sb-adm.dev@ibtekr.local', '01000150a01'),
  ('00000000-0000-4000-8000-0000000150a2', 'sb-acc.dev@ibtekr.local', '01000150a02'),
  ('00000000-0000-4000-8000-0000000150a3', 'sb-ops.dev@ibtekr.local', '01000150a03'),
  ('00000000-0000-4000-8000-0000000150a4', 'sb-view.dev@ibtekr.local', '01000150a04');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u where u.email like 'sb-%.dev@ibtekr.local';
insert into public.profiles (id, name, email, phone, role_id, status) values
  ('00000000-0000-4000-8000-0000000150a1', 'أدمن المخ', 'sb-adm.dev@ibtekr.local', '01000150a01', 'admin', 'active'),
  ('00000000-0000-4000-8000-0000000150a2', 'حسابات المخ', 'sb-acc.dev@ibtekr.local', '01000150a02', 'accounts', 'active'),
  ('00000000-0000-4000-8000-0000000150a3', 'عمليات المخ', 'sb-ops.dev@ibtekr.local', '01000150a03', 'ops', 'active'),
  ('00000000-0000-4000-8000-0000000150a4', 'ديزاينر المخ', 'sb-view.dev@ibtekr.local', '01000150a04', 'designer', 'active');

-- a chat of the accounts member with the accountant, and one of the ops member with «stock» (made by the server)
insert into public.mkt_agent_chats (id, member_id, agent, title) values
  ('00000000-0000-4000-8000-0000000150c1', '00000000-0000-4000-8000-0000000150a2', 'accountant', 'شات الحسابات'),
  ('00000000-0000-4000-8000-0000000150c2', '00000000-0000-4000-8000-0000000150a3', 'stock', 'شات التشغيل');
-- makers for the count: one active with an account, one active without, one active with an empty row, one inactive, one archived
insert into public.vendors (id, name, status) values
  ('00000000-0000-4000-8000-0000000150b1', 'مبتكر ببنك 0150', 'active'), ('00000000-0000-4000-8000-0000000150b2', 'مبتكر من غير بنك 0150', 'active'),
  ('00000000-0000-4000-8000-0000000150b3', 'مبتكر بصف فاضي 0150', 'active'), ('00000000-0000-4000-8000-0000000150b4', 'مبتكر موقوف 0150', 'inactive'),
  ('00000000-0000-4000-8000-0000000150b5', 'مبتكر مؤرشف 0150', 'active');
update public.vendors set archived_at = now() where id = '00000000-0000-4000-8000-0000000150b5';
insert into public.vendor_bank (vendor_id, method, account_number) values ('00000000-0000-4000-8000-0000000150b1', 'bank', '1234567890');
insert into public.vendor_bank (vendor_id, method, account_number, iban, wallet) values ('00000000-0000-4000-8000-0000000150b3', 'bank', '  ', null, '');

do $$ declare n0 int; begin
  -- the server writes who answered and what was shared; only the known names and a short list of kinds
  insert into public.mkt_agent_messages (chat_id, role, text, source, shared) values ('00000000-0000-4000-8000-0000000150c1', 'assistant', 'رد', 'openai', '["expenses"]');
  begin insert into public.mkt_agent_messages (chat_id, role, text, source) values ('00000000-0000-4000-8000-0000000150c1', 'assistant', 'رد', 'robot'); raise exception 'case an unknown source is refused failed';
  exception when check_violation then null; end;
  begin insert into public.mkt_agent_messages (chat_id, role, text, shared) values ('00000000-0000-4000-8000-0000000150c1', 'assistant', 'رد', '{"a":1}'); raise exception 'case shared is a list failed';
  exception when check_violation then null; end;
  if (select shared from public.mkt_agent_messages where chat_id = '00000000-0000-4000-8000-0000000150c1' and source = 'openai') <> '["expenses"]'::jsonb then raise exception 'case shared kept failed'; end if;
  -- «المدير العام»: a built-in for whoever opens the team's requests, its team = the management's, with its rules and skills
  if not exists (select 1 from public.ai_agents where id = 'manager' and builtin and perm = 'tickets.view' and icon = 'sliders' and sort = 5
       and role = (select name from public.roles where id = 'admin') and sees @> '{orders,tickets,hr,inventory}') then raise exception 'case the general manager failed'; end if;
  if (select count(*) from public.ai_agent_kb where 'manager' = any (agents) and kind = 'rules') <> 3 or (select count(*) from public.ai_agent_kb where 'manager' = any (agents) and kind = 'skills') <> 2
    then raise exception 'case its rules and skills failed'; end if;
  -- the count of the makers without an account: the active, not archived, with no account kept (an empty row is no account)
  select public.ai_agent_bankless() into n0;
  if n0 < 2 or n0 <> (select count(*) from public.vendors v where v.status = 'active' and v.archived_at is null and v.id not in ('00000000-0000-4000-8000-0000000150b1')
       and not exists (select 1 from public.vendor_bank b where b.vendor_id = v.id and coalesce(btrim(b.account_number), '') || coalesce(btrim(b.iban), '') || coalesce(btrim(b.wallet), '') <> ''))
    then raise exception 'case the makers without an account failed: %', n0; end if;
  -- closed doors: anon nowhere, the members never read the state nor call the count
  if has_function_privilege('anon', 'public.mkt_agent_system_turn(text, uuid, text, text)', 'execute') or has_function_privilege('anon', 'public.ai_agent_facts()', 'execute')
    or has_function_privilege('anon', 'public.ai_agent_bankless()', 'execute') or has_function_privilege('authenticated', 'public.ai_agent_bankless()', 'execute')
    or has_table_privilege('authenticated', 'public.ai_agent_state', 'select') or has_table_privilege('anon', 'public.ai_agent_state', 'select')
    or not (select relrowsecurity from pg_class where oid = 'public.ai_agent_state'::regclass) then raise exception 'case the closed doors failed'; end if;
  -- the server's row: the numbers of three assistants, each with the permission behind it (and one with none — the admin's alone)
  insert into public.ai_agent_state (facts, at) values (jsonb_build_object('at', '2026-11-22T10:00:00Z', 'agents', jsonb_build_object(
    'manager', jsonb_build_object('name', 'المدير العام', 'metrics', jsonb_build_array(
      jsonb_build_object('key', 'orders_unconfirmed', 'perm', 'orders.view', 'now', 4), jsonb_build_object('key', 'tickets_urgent', 'perm', 'tickets.view', 'now', 2), jsonb_build_object('key', 'odd', 'perm', '', 'now', 9))),
    'accountant', jsonb_build_object('name', 'المحاسب الذكي', 'metrics', jsonb_build_array(jsonb_build_object('key', 'withdraw_pending', 'perm', 'accounts.view', 'now', 1))),
    'stock', jsonb_build_object('name', 'التشغيل الذكي', 'metrics', jsonb_build_array(jsonb_build_object('key', 'orders_late', 'perm', 'orders.view', 'now', 3), jsonb_build_object('key', 'returns_waiting', 'perm', 'inventory.view', 'now', 1))),
    'robot', jsonb_build_object('name', 'مش موجود', 'metrics', jsonb_build_array(jsonb_build_object('key', 'x', 'perm', 'orders.view', 'now', 1))))), '2026-11-22T10:00:00Z');
  begin insert into public.ai_agent_state (id, facts) values (false, '{}'); raise exception 'case one row only failed'; exception when check_violation then null; end;
  -- the notes: one of a rule (the orders' count — it needs the orders' page in full) and one without a permission, both the manager's
  perform public.ai_agent_note_add('manager', 'alert', 'أوردرات مفتوحة مستنية تأكيد: 4', 'القاعدة', 'rule:manager:orders_unconfirmed', null, 'orders.view');
  perform public.ai_agent_note_add('manager', 'report', 'ملخص الفريق 0150', 'ملخص', 'team:0150', null);
  if (select perm from public.ai_agent_notes where ref = 'rule:manager:orders_unconfirmed') <> 'orders.view' or (select perm from public.ai_agent_notes where ref = 'team:0150') is not null then raise exception 'case the note keeps its permission failed'; end if;
  begin perform public.ai_agent_note_add('manager', 'alert', 'غلط', '', 'rule:x', null, 'not a perm'); raise exception 'case a bad permission is refused failed'; exception when check_violation then null; end;
  if has_function_privilege('authenticated', 'public.ai_agent_note_add(text, text, text, text, text, text, text)', 'execute') or has_function_privilege('anon', 'public.ai_agent_note_sees(text, text)', 'execute')
    or to_regprocedure('public.ai_agent_note_add(text, text, text, text, text, text)') is not null then raise exception 'case the one writer, the server''s failed'; end if;
end $$;

set local role authenticated;

-- ================================================================ accounts: accounts / orders / inventory in full, the requests in part, no marketing
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000150a2","role":"authenticated"}', true);
do $$ declare f jsonb; r jsonb; c uuid; i int; begin
  begin perform 1 from public.ai_agent_state; raise exception 'case a member never reads the state failed'; exception when insufficient_privilege then null; end;
  begin perform public.ai_agent_bankless(); raise exception 'case a member never calls the count failed'; exception when insufficient_privilege then null; end;
  f := public.ai_agent_facts();
  -- the assistants they see (ai_agent_can) — never one that is not in the registry
  if (select string_agg(k, ',' order by k) from jsonb_object_keys(f -> 'agents') k) <> 'accountant,manager,stock' then raise exception 'case the assistants by ai_agent_can failed: %', f; end if;
  if (f -> 'agents' -> 'accountant' -> 'metrics') <> '[{"key":"withdraw_pending","now":1}]'::jsonb then raise exception 'case a number of a page read in full, without its permission key failed: %', f; end if;
  -- seeing the assistant is not enough: the orders' count yes (read in full), the requests' count no (a partial view), a number with no permission no
  if (f -> 'agents' -> 'manager' -> 'metrics') <> '[{"key":"orders_unconfirmed","now":4}]'::jsonb then raise exception 'case a partial view gets no count failed: %', f; end if;
  if (f ->> 'at') is null then raise exception 'case the moment failed'; end if;
  -- the system's own answer: in my own chat with an assistant I see
  r := public.mkt_agent_system_turn('accountant', '00000000-0000-4000-8000-0000000150c1', '  كام طلب سحب مستني؟ ', 'طلبات سحب مستنية الموافقة: 1');
  if (r -> 'chat' ->> 'id') <> '00000000-0000-4000-8000-0000000150c1' or jsonb_array_length(r -> 'turns') <> 2
    or (r -> 'turns' -> 0 ->> 'role') <> 'user' or (r -> 'turns' -> 0 ->> 'text') <> 'كام طلب سحب مستني؟' or (r -> 'turns' -> 1 ->> 'source') <> 'system' or (r -> 'turns' -> 1 -> 'shared') <> '[]'::jsonb
    then raise exception 'case the turn kept failed: %', r; end if;
  -- no chat yet = a new one named by the question
  r := public.mkt_agent_system_turn('accountant', null, 'المصروفات الشهر ده', 'المصروفات: 1,200 ج.م');
  c := (r -> 'chat' ->> 'id')::uuid;
  if c = '00000000-0000-4000-8000-0000000150c1' or (r -> 'chat' ->> 'title') <> 'المصروفات الشهر ده' or (select member_id from public.mkt_agent_chats where id = c) <> '00000000-0000-4000-8000-0000000150a2'
    then raise exception 'case a new chat failed: %', r; end if;
  -- an assistant I do not see, someone else's chat, a chat of another assistant
  begin perform public.mkt_agent_system_turn('buyer', null, 'سؤال', 'رد'); raise exception 'case an assistant I do not see failed'; exception when insufficient_privilege then null; end;
  begin perform public.mkt_agent_system_turn('robot', null, 'سؤال', 'رد'); raise exception 'case an unknown assistant failed'; exception when insufficient_privilege then null; end;
  begin perform public.mkt_agent_system_turn('manager', '00000000-0000-4000-8000-0000000150c1', 'سؤال', 'رد'); raise exception 'case a chat of another assistant failed'; exception when no_data_found then null; end;
  begin perform public.mkt_agent_system_turn('manager', '00000000-0000-4000-8000-0000000150c2', 'سؤال', 'رد'); raise exception 'case someone else''s chat failed'; exception when no_data_found then null; end;
  -- the limits
  begin perform public.mkt_agent_system_turn('accountant', null, '   ', 'رد'); raise exception 'case an empty question failed'; exception when invalid_parameter_value then null; end;
  begin perform public.mkt_agent_system_turn('accountant', null, 'سؤال', ''); raise exception 'case an empty answer failed'; exception when invalid_parameter_value then null; end;
  begin perform public.mkt_agent_system_turn('accountant', null, repeat('س', 1001), 'رد'); raise exception 'case a long question failed'; exception when invalid_parameter_value then null; end;
  begin perform public.mkt_agent_system_turn('accountant', null, 'سؤال', repeat('ر', 2001)); raise exception 'case a long answer failed'; exception when invalid_parameter_value then null; end;
  -- a member never writes a turn directly, nor marks one as an outside company's
  begin insert into public.mkt_agent_messages (chat_id, role, text, source) values ('00000000-0000-4000-8000-0000000150c1', 'assistant', 'رد', 'claude'); raise exception 'case a member never writes a turn failed';
  exception when insufficient_privilege then null; end;
  begin update public.mkt_agent_messages set source = 'claude' where chat_id = '00000000-0000-4000-8000-0000000150c1'; raise exception 'case a member never re-marks a turn failed';
  exception when insufficient_privilege then null; end;
  -- more than 30 of the system's turns a minute is not a person
  for i in 1 .. 28 loop perform public.mkt_agent_system_turn('accountant', c, 'سؤال ' || i, 'رد'); end loop;
  begin perform public.mkt_agent_system_turn('accountant', c, 'سؤال زيادة', 'رد'); raise exception 'case the throttle failed'; exception when sqlstate '53400' then null; end;
end $$;

-- ================================================================ ops: orders / inventory / tickets in full, the accounts in part
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000150a3","role":"authenticated"}', true);
do $$ declare f jsonb; begin
  f := public.ai_agent_facts();
  -- ops opens the accountant (the accounts in part) but is not told the accounts' count
  if (f -> 'agents' -> 'accountant' -> 'metrics') <> '[]'::jsonb then raise exception 'case the accounts in part get no count failed: %', f; end if;
  if (select string_agg(m ->> 'key', ',' order by o) from jsonb_array_elements(f -> 'agents' -> 'stock' -> 'metrics') with ordinality as x(m, o)) <> 'orders_late,returns_waiting' then raise exception 'case ops reads stock in full failed: %', f; end if;
  if (select string_agg(m ->> 'key', ',' order by o) from jsonb_array_elements(f -> 'agents' -> 'manager' -> 'metrics') with ordinality as x(m, o)) <> 'orders_unconfirmed,tickets_urgent' then raise exception 'case a number with no permission is the admin''s failed: %', f; end if;
  -- the other member's turns are theirs
  if exists (select 1 from public.mkt_agent_messages where chat_id = '00000000-0000-4000-8000-0000000150c1') then raise exception 'case another member''s turns failed'; end if;
end $$;

-- ================================================================ a designer: the requests in part, no orders / inventory / accounts
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000150a4","role":"authenticated"}', true);
do $$ declare f jsonb; begin
  f := public.ai_agent_facts();
  if (select string_agg(k, ',' order by k) from jsonb_object_keys(f -> 'agents') k) <> 'manager' then raise exception 'case a designer sees the manager alone failed: %', f; end if;
  if (f -> 'agents' -> 'manager' -> 'metrics') <> '[]'::jsonb then raise exception 'case a designer is told no number failed: %', f; end if;
  begin perform public.mkt_agent_system_turn('accountant', null, 'سؤال', 'رد'); raise exception 'case a designer never writes to the accountant failed'; exception when insufficient_privilege then null; end;
  -- the manager's notes: the team's summary yes, the orders' count no (no orders page) — not seen, not marked read, not opened
  if (select string_agg(ref, ',' order by ref) from public.ai_agent_notes where agent = 'manager' and ref in ('team:0150', 'rule:manager:orders_unconfirmed')) <> 'team:0150' then raise exception 'case a rule''s note needs its page failed'; end if;
  if public.ai_agent_note_read(array(select id from public.ai_agent_notes)) <> (select count(*) from public.ai_agent_notes) then raise exception 'case only the notes seen are marked failed'; end if;
  begin perform public.ai_agent_note_open((select max(id) + 0 from (select id from public.ai_agent_notes) x) + 100000); raise exception 'case a missing note failed'; exception when no_data_found then null; end;
end $$;
reset role;
do $$ declare v bigint := (select id from public.ai_agent_notes where ref = 'rule:manager:orders_unconfirmed'); begin perform set_config('ib.t150_note', v::text, true); end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000150a4","role":"authenticated"}', true);
do $$ begin
  begin perform public.ai_agent_note_open(current_setting('ib.t150_note')::bigint); raise exception 'case a note not seen is not opened failed'; exception when no_data_found then null; end;
  if public.ai_agent_note_read(array[current_setting('ib.t150_note')::bigint]) <> 0 then raise exception 'case a note not seen is not marked failed'; end if;
end $$;
-- ops reads the orders in full: the note is theirs, and opening it starts a chat whose first turn is the system's
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000150a3","role":"authenticated"}', true);
do $$ declare c uuid; begin
  if not exists (select 1 from public.ai_agent_notes where ref = 'rule:manager:orders_unconfirmed') then raise exception 'case the note with its page failed'; end if;
  c := public.ai_agent_note_open(current_setting('ib.t150_note')::bigint);
  if (select string_agg(role || ':' || coalesce(source, '-'), ',') from public.mkt_agent_messages where chat_id = c) <> 'assistant:system' then raise exception 'case a note opened is the system''s turn failed'; end if;
end $$;

-- ================================================================ the admin: everything
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000150a1","role":"authenticated"}', true);
do $$ declare f jsonb; begin
  f := public.ai_agent_facts();
  if (select string_agg(k, ',' order by k) from jsonb_object_keys(f -> 'agents') k) <> 'accountant,manager,stock' then raise exception 'case the admin sees every live assistant failed: %', f; end if;
  if jsonb_array_length(f -> 'agents' -> 'manager' -> 'metrics') <> 3 then raise exception 'case the admin gets every number failed: %', f; end if;
  if (f -> 'agents' -> 'manager' -> 'metrics' -> 0) ? 'perm' then raise exception 'case the permission key is the server''s failed'; end if;
end $$;

reset role;
do $$ begin raise notice 'rls_system_brain: ok'; end $$;
rollback;
