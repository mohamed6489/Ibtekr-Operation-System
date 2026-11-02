-- RLS / permission tests for 0034_cs (customer service, phase 6.1): the customers from the orders, cs_customers_list, the
-- guards, conversations / messages, segments / campaigns / channels, the grants. Depends on 0001 … 0034.
-- Runs in one transaction and rolls back; prints NOTICE 'rls_cs: ok' only if every case passed.
-- Live-safe: every count is scoped to the rows this file writes (orders 99980001–3, phones 0109998xxxx). Everything is made up.

begin;

-- Test users (fixed UUIDs …e1–…e4): full (view F, reply F, manage F, phone F); reply-only (view F, reply F, manage N, phone N);
-- partial (view P, reply N, manage N); none.
insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000000e1', 'cs-full.dev@ibtekr.local',  '010000000e1'),
  ('00000000-0000-4000-8000-0000000000e2', 'cs-reply.dev@ibtekr.local', '010000000e2'),
  ('00000000-0000-4000-8000-0000000000e3', 'cs-part.dev@ibtekr.local',  '010000000e3'),
  ('00000000-0000-4000-8000-0000000000e4', 'cs-none.dev@ibtekr.local',  '010000000e4');

insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email)
from auth.users u
where u.id in ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000e4');

insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-0000000000e1', 'خدمة كامل', 'cs-full.dev@ibtekr.local',  '010000000e1', 'ops', 'active', '{"cs.view":"F","cs.reply":"F","cs.manage":"F","sensitive.customer_phone":"F","orders.view":"F"}'),
  ('00000000-0000-4000-8000-0000000000e2', 'خدمة رد',   'cs-reply.dev@ibtekr.local', '010000000e2', 'ops', 'active', '{"cs.view":"F","cs.reply":"F","cs.manage":"N","sensitive.customer_phone":"N"}'),
  ('00000000-0000-4000-8000-0000000000e3', 'خدمة جزئي', 'cs-part.dev@ibtekr.local',  '010000000e3', 'ops', 'active', '{"cs.view":"P","cs.reply":"N","cs.manage":"N","sensitive.customer_phone":"N","orders.view":"N"}'),
  ('00000000-0000-4000-8000-0000000000e4', 'خدمة بدون', 'cs-none.dev@ibtekr.local',  '010000000e4', 'ops', 'active', '{"cs.view":"N","cs.reply":"N","cs.manage":"N"}');

-- Two orders of one customer (Arabic digits and a +20 prefix on the second: one normalised phone) and one of another.
insert into public.orders (id, number, customer_name, customer_phone, customer_city, status, woo_status, total, placed_at) values
  (99980001, '99980001', 'عميلة تجريبية', '٠١٠٩٩٩٨٠٠٠١', 'القاهرة', 'مكتمل', 'completed', 500, '2026-10-01T09:00:00Z'),
  (99980002, '99980002', 'عميلة تجريبية', '+20 109 998 0001', null, 'جاري التنفيذ', 'processing', 300, '2026-10-20T10:00:00Z'),
  (99980003, '99980003', 'عميل تاني', '01099980002', 'الجيزة', 'ملغي', 'cancelled', 200, '2026-10-21T11:00:00Z');
insert into public.customer_ratings (order_id, sat, manners, by_user) values (99980001, 5, 3, null);

-- ================================================================ runner: roles, norm_phone, the trigger, grants

do $$ declare c1 uuid; begin
  if (select permissions ->> 'cs.view' from public.roles where id = 'cs') <> 'F' or (select permissions ->> 'cs.manage' from public.roles where id = 'ops') <> 'N'
     or (select permissions ->> 'cs.view' from public.roles where id = 'viewer') <> 'P' or (select permissions ->> 'cs.view' from public.roles where id = 'accounts') <> 'N' then
    raise exception 'case the cs.* keys on the roles failed';
  end if;
  if public.norm_phone('٠١٠٩٩٩٨٠٠٠١') <> '01099980001' or public.norm_phone('+20 109 998 0001') <> '01099980001' or public.norm_phone('0020 1099980001') <> '01099980001'
     or public.norm_phone('1099980001') <> '01099980001' or public.norm_phone('') <> '' or public.norm_phone(null) <> '' or public.norm_phone('abc') <> '' then
    raise exception 'case norm_phone failed';
  end if;
  if (select count(*) from public.cs_customers where phone in ('01099980001', '01099980002')) <> 2 then raise exception 'case the trigger makes one customer per normalised phone failed'; end if;
  select id into c1 from public.cs_customers where phone = '01099980001';
  if (select name || '|' || coalesce(city, '-') || '|' || created_from from public.cs_customers where id = c1) <> 'عميلة تجريبية|القاهرة|orders' then raise exception 'case the first order names the customer failed'; end if;
  -- a later order with another name keeps the team's name; an empty city is filled
  update public.orders set customer_name = 'اسم تاني' where id = 99980003;
  if (select name from public.cs_customers where phone = '01099980002') <> 'عميل تاني' then raise exception 'case an existing customer keeps its name failed'; end if;
  if has_column_privilege('authenticated', 'public.cs_customers', 'phone', 'SELECT') or has_column_privilege('authenticated', 'public.cs_customers', 'phone', 'UPDATE') or not has_column_privilege('authenticated', 'public.cs_customers', 'phone', 'INSERT')
     or has_column_privilege('authenticated', 'public.cs_campaign_recipients', 'phone', 'SELECT') or has_column_privilege('authenticated', 'public.cs_campaigns', 'test_phone', 'SELECT') then
    raise exception 'case the phones are never granted to members on the base tables failed';
  end if;
  if has_table_privilege('anon', 'public.cs_customers', 'SELECT') or has_table_privilege('authenticated', 'public.cs_customers', 'DELETE') or has_table_privilege('authenticated', 'public.cs_messages', 'UPDATE')
     or has_table_privilege('authenticated', 'public.cs_channels', 'UPDATE') or has_table_privilege('authenticated', 'public.cs_contacts', 'INSERT') or not has_table_privilege('authenticated', 'public.cs_segments', 'DELETE') then
    raise exception 'case grants failed';
  end if;
  if has_function_privilege('anon', 'public.cs_customers_list()', 'EXECUTE') or not has_function_privilege('authenticated', 'public.cs_customers_list()', 'EXECUTE') then raise exception 'case cs_customers_list grants failed'; end if;
  if (select count(*) from public.cs_channels) < 5 or exists (select 1 from public.cs_channels where status <> 'disconnected' and id in ('wa1', 'wa2', 'messenger', 'instagram', 'tiktok') and updated_at is null) then raise exception 'case the five channels start disconnected failed'; end if;
end $$;

-- ================================================================ full: the list, a manual customer, a conversation with messages, segments, campaigns

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000e1","role":"authenticated"}';
do $$ declare c1 uuid; c2 uuid; cv uuid; r record; sg uuid; k uuid; begin
  select l.id into c1 from public.cs_customers_list() l where l.name = 'عميلة تجريبية';
  select * into r from public.cs_customers_list() l where l.id = c1;
  if r.phone <> '01099980001' then raise exception 'case the full phone with sensitive.customer_phone = F failed (%)', r.phone; end if;
  if r.orders <> 2 or r.total <> 800 or r.refused <> 0 or r.returned <> 0 or r.rating_count <> 1 or r.rating_sat <> 5.0 or r.rating_manners <> 3.0 or jsonb_array_length(r.order_list) <> 2 then
    raise exception 'case the figures from the orders failed (% % % % %)', r.orders, r.total, r.rating_sat, r.rating_manners, r.order_list;
  end if;
  if (select l.total from public.cs_customers_list() l where l.phone = '01099980002') <> 0 then raise exception 'case a cancelled order is not a sale failed'; end if;
  -- a manual lead
  insert into public.cs_customers (name, phone, city, created_from, source) values ('ليد تجريبي', '01099980003', 'الإسكندرية', 'manual', 'إنستجرام') returning id into c2;
  if (select created_by from public.cs_customers where id = c2) <> '00000000-0000-4000-8000-0000000000e1' then raise exception 'case a manual customer is the caller''s failed'; end if;
  begin
    insert into public.cs_customers (name, phone, created_from) values ('x', '01099980004', 'orders');
    raise exception 'case a member cannot add a customer as orders failed';
  exception when others then if sqlstate <> '42501' then raise exception 'case created_from orders: expected 42501, got %', sqlstate; end if;
  end;
  update public.cs_customers set mood = 'سعيد', tags = array['هدايا'], address2 = 'شغل' where id = c1; -- manage: everything
  begin
    update public.cs_customers set phone = '01099980009' where id = c1;
    raise exception 'case the phone is fixed failed';
  exception when others then if sqlstate <> '42501' then raise exception 'case phone fixed: expected 42501, got %', sqlstate; end if;
  end;
  insert into public.cs_customer_notes (customer_id, text) values (c1, 'بتحب التغليف كهدية');
  insert into public.cs_rating_overrides (customer_id, stars, reason) values (c1, 4, 'تعديل يدوي');
  if (select l.override_stars from public.cs_customers_list() l where l.id = c1) <> 4 then raise exception 'case the override shows in the list failed'; end if;
  insert into public.cs_team_ratings (customer_id, sat, manners) values (c1, 3, 5); -- a rating from the chat joins the order's: sat (5+3)/2, manners (3+5)/2
  if (select l.rating_count || '|' || l.rating_sat || '|' || l.rating_manners from public.cs_customers_list() l where l.id = c1) <> '2|4.0|4.0' then raise exception 'case the chat rating averages with the order rating failed'; end if;
  begin
    perform * from public.cs_customers where phone = '01099980001';
    raise exception 'case a member cannot read the phone column failed';
  exception when insufficient_privilege then null;
  end;
  -- a plain conversation + a note + an outgoing message (queued) + an event
  insert into public.cs_conversations (seg, platform, channel, customer_id, assignee) values ('customers', 'whatsapp', 'wa1', c1, '00000000-0000-4000-8000-0000000000e3') returning id into cv;
  insert into public.cs_messages (conversation_id, kind, text) values (cv, 'note', 'ملاحظة داخلية');
  insert into public.cs_messages (conversation_id, kind, text) values (cv, 'out', 'أهلاً');
  insert into public.cs_messages (conversation_id, kind, text) values (cv, 'event', 'اتعيّنت');
  if (select count(*) from public.cs_messages where conversation_id = cv) <> 3 then raise exception 'case three member messages failed'; end if;
  if (select delivery from public.cs_messages where conversation_id = cv and kind = 'out') <> 'queued' then raise exception 'case out = queued failed'; end if;
  if (select author from public.cs_messages where conversation_id = cv and kind = 'note') <> '00000000-0000-4000-8000-0000000000e1' then raise exception 'case the author is the caller failed'; end if;
  if (select last_out_at from public.cs_conversations where id = cv) is null then raise exception 'case an out message stamps last_out_at failed'; end if;
  begin
    insert into public.cs_messages (conversation_id, kind, text) values (cv, 'in', 'من العميل');
    raise exception 'case a member cannot write an incoming message failed';
  exception when others then if sqlstate <> '42501' then raise exception 'case kind in: expected 42501, got %', sqlstate; end if;
  end;
  begin
    insert into public.cs_conversations (seg, platform, channel, customer_id, external_id) values ('customers', 'instagram', 'instagram', c1, 'thread-1');
    raise exception 'case a member cannot open a channel thread failed';
  exception when others then if sqlstate <> '42501' then raise exception 'case external_id: expected 42501, got %', sqlstate; end if;
  end;
  update public.cs_conversations set status = 'اتحلت', outcome = 'استفسار فقط' where id = cv;
  if (select closed_at from public.cs_conversations where id = cv) is null or (select closed_by from public.cs_conversations where id = cv) <> '00000000-0000-4000-8000-0000000000e1' then raise exception 'case closing stamps closed_* failed'; end if;
  begin
    update public.cs_conversations set platform = 'tiktok' where id = cv;
    raise exception 'case the identity of a conversation is fixed failed';
  exception when others then if sqlstate <> '42501' then raise exception 'case platform fixed: expected 42501, got %', sqlstate; end if;
  end;
  if (select count(*) from public.cs_customers_list() l where l.id = c1 and l.conversations = 1) <> 1 then raise exception 'case the conversation count failed'; end if;
  -- segments and a draft campaign
  insert into public.cs_segments (name, min_total, ranges) values ('VIP تجريبي', 500, '{"sat":[4,5]}') returning id into sg;
  insert into public.cs_campaigns (name, segment_id, body) values ('حملة تجريبية', sg, 'نص') returning id into k;
  if (select status from public.cs_campaigns where id = k) <> 'مسودة' then raise exception 'case a new campaign is a draft failed'; end if;
  begin
    insert into public.cs_campaigns (name, status) values ('x', 'شغالة');
    raise exception 'case a member cannot start a campaign failed';
  exception when others then if sqlstate <> '42501' then raise exception 'case status running: expected 42501, got %', sqlstate; end if;
  end;
  delete from public.cs_campaigns where id = k;
  delete from public.cs_segments where id = sg;
  -- merge: the lead into the customer — conversations and notes move, tags join, the other row is marked
  update public.cs_customers set tags = array['هدايا'] where id = c2;
  insert into public.cs_customer_notes (customer_id, text) values (c2, 'ملاحظة على الليد');
  if public.cs_merge_customers(c1, c2) <> c1 then raise exception 'case merge returns the kept id failed'; end if;
  if (select merged_into from public.cs_customers where id = c2) <> c1 then raise exception 'case the other is marked merged failed'; end if;
  if (select count(*) from public.cs_customer_notes where customer_id = c1) <> 2 then raise exception 'case the notes move on merge failed'; end if;
  if not ((select tags from public.cs_customers where id = c1) @> array['هدايا']) then raise exception 'case tags join on merge failed'; end if;
  if (select count(*) from public.cs_customers_list() l where l.id = c2) <> 0 then raise exception 'case a merged customer leaves the list failed'; end if;
  begin
    perform public.cs_merge_customers(c1, c1);
    raise exception 'case merging a customer with itself must error failed';
  exception when others then if sqlstate <> '22023' then raise exception 'case self merge: expected 22023, got %', sqlstate; end if;
  end;
  if (select count(*) from public.cs_channels) < 5 then raise exception 'case channels readable failed'; end if;
  begin
    update public.cs_channels set status = 'connected' where id = 'wa1';
    raise exception 'case channels are the server''s failed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ================================================================ reply-only: masked phone, mood / tags only, no customer add, no segments

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000e2","role":"authenticated"}';
do $$ declare c1 uuid; begin
  select l.id into c1 from public.cs_customers_list() l where l.name = 'عميلة تجريبية';
  if (select l.phone from public.cs_customers_list() l where l.id = c1) <> '010••••0001' then raise exception 'case the masked phone failed (%)', (select l.phone from public.cs_customers_list() l where l.id = c1); end if;
  update public.cs_customers set mood = 'متضايق', tags = array['مستعجل'] where id = c1;
  begin
    update public.cs_customers set city = 'طنطا' where id = c1;
    raise exception 'case reply-only cannot edit a customer''s data failed';
  exception when others then if sqlstate <> '42501' then raise exception 'case city by reply-only: expected 42501, got %', sqlstate; end if;
  end;
  begin
    insert into public.cs_customers (name, phone) values ('x', '01099980005');
    raise exception 'case reply-only cannot add a customer failed';
  exception when others then if sqlstate <> '42501' then raise exception 'case add by reply-only: expected 42501, got %', sqlstate; end if;
  end;
  begin
    insert into public.cs_segments (name) values ('x');
    raise exception 'case reply-only cannot add a segment failed';
  exception when others then if sqlstate <> '42501' then raise exception 'case segment by reply-only: expected 42501, got %', sqlstate; end if;
  end;
  insert into public.cs_customer_notes (customer_id, text) values (c1, 'ملاحظة من الرد');
  begin
    perform public.cs_merge_customers(c1, (select l.id from public.cs_customers_list() l where l.name = 'عميل تاني'));
    raise exception 'case reply-only cannot merge failed';
  exception when others then if sqlstate <> '42501' then raise exception 'case merge by reply-only: expected 42501, got %', sqlstate; end if;
  end;
end $$;

-- ================================================================ partial: the assigned conversation only, no writes

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000e3","role":"authenticated"}';
do $$ declare c1 uuid; cv uuid; begin
  select l.id into c1 from public.cs_customers_list() l where l.name = 'عميلة تجريبية';
  if (select count(*) from public.cs_customers_list() l where l.id = c1) <> 1 then raise exception 'case P reads the customers failed'; end if;
  if (select l.orders || '|' || l.total || '|' || jsonb_array_length(l.order_list) from public.cs_customers_list() l where l.id = c1) <> '0|0|0' then raise exception 'case without orders.view the orders figures are hidden failed'; end if;
  -- the orders' ratings are hidden with them: only the chat rating (3/5) remains
  if (select l.rating_count || '|' || l.rating_sat || '|' || l.rating_manners from public.cs_customers_list() l where l.id = c1) <> '1|3.0|5.0' then raise exception 'case without orders.view the orders ratings are hidden failed'; end if;
  select id into cv from public.cs_conversations where customer_id = c1;
  if cv is null then raise exception 'case P sees the conversation assigned to them failed'; end if;
  if (select count(*) from public.cs_messages where conversation_id = cv) <> 3 then raise exception 'case P reads the messages of their conversation failed'; end if;
  begin
    insert into public.cs_messages (conversation_id, kind, text) values (cv, 'note', 'x');
    raise exception 'case P cannot write failed';
  exception when others then if sqlstate <> '42501' then raise exception 'case P note: expected 42501, got %', sqlstate; end if;
  end;
end $$;

-- a conversation assigned to someone else is invisible to P
reset role;
update public.cs_conversations set assignee = '00000000-0000-4000-8000-0000000000e1' where customer_id = (select id from public.cs_customers where phone = '01099980001');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000e3","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.cs_conversations where customer_id = (select l.id from public.cs_customers_list() l where l.name = 'عميلة تجريبية')) <> 0 then raise exception 'case P does not see another''s conversation failed'; end if;
  if (select count(*) from public.cs_messages m where m.conversation_id in (select id from public.cs_conversations)) <> 0 then raise exception 'case P does not see another''s messages failed'; end if;
end $$;

-- ================================================================ none: nothing

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000e4","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.cs_customers) <> 0 or (select count(*) from public.cs_conversations) <> 0 or (select count(*) from public.cs_channels) <> 0 then raise exception 'case cs.view N sees nothing failed'; end if;
  begin
    perform public.cs_customers_list();
    raise exception 'case cs.view N cannot list failed';
  exception when others then if sqlstate <> '42501' then raise exception 'case list by N: expected 42501, got %', sqlstate; end if;
  end;
end $$;

-- ================================================================ anon

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$ begin
  begin
    perform count(*) from public.cs_customers;
    raise exception 'case anon must error failed';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;

do $$ begin raise notice 'rls_cs: ok'; end $$;
