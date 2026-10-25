-- RLS / permission / trigger tests for 0007_orders (vendors, products, orders, sub_orders, order_items,
-- order_events, returns, woo_webhook_events, woo_sync_log, sync_state, orders_v, mask_phone, status_map reseed).
-- Depends on 0001_identity … 0007_orders.
-- Runs in one transaction and rolls back; prints NOTICE 'rls_orders: ok' only if every case passed.
-- Each case switches role explicitly: the runner (postgres) owns the tables, bypasses RLS and plays the
-- trusted sync (service_role) — the trigger guards apply to anon/authenticated only.
-- No statement here removes rows or objects, so it runs live through the Supabase MCP's execute_sql unchanged.

begin;

-- Test users (fixed UUIDs): admin, ops (orders.status F / orders.edit P), cs (orders.status F / orders.edit N /
-- sensitive.customer_phone F), accounts (orders.status N / orders.edit N / sensitive.customer_phone N),
-- suspended viewer, vendors follow-up (orders.status F / sensitive.customer_phone N / vendors.edit F).
-- Every value comes from the built-in role matrix of 0003_seed_roles (no overrides).
insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-000000000031', 'ord-admin.dev@ibtekr.local',    '01000000031'),
  ('00000000-0000-4000-8000-000000000032', 'ord-ops.dev@ibtekr.local',      '01000000032'),
  ('00000000-0000-4000-8000-000000000033', 'ord-cs.dev@ibtekr.local',       '01000000033'),
  ('00000000-0000-4000-8000-000000000034', 'ord-accounts.dev@ibtekr.local', '01000000034'),
  ('00000000-0000-4000-8000-000000000035', 'ord-susp.dev@ibtekr.local',     '01000000035'),
  ('00000000-0000-4000-8000-000000000036', 'ord-vf.dev@ibtekr.local',       '01000000036');

insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email)
from auth.users u
where u.id in ('00000000-0000-4000-8000-000000000031',
               '00000000-0000-4000-8000-000000000032',
               '00000000-0000-4000-8000-000000000033',
               '00000000-0000-4000-8000-000000000034',
               '00000000-0000-4000-8000-000000000035',
               '00000000-0000-4000-8000-000000000036');

insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-000000000031', 'أدمن الأوردرات',   'ord-admin.dev@ibtekr.local',    '01000000031', 'admin',    'active',    '{}'),
  ('00000000-0000-4000-8000-000000000032', 'عمليات الأوردرات', 'ord-ops.dev@ibtekr.local',      '01000000032', 'ops',      'active',    '{}'),
  ('00000000-0000-4000-8000-000000000033', 'خدمة العملاء',     'ord-cs.dev@ibtekr.local',       '01000000033', 'cs',       'active',    '{}'),
  ('00000000-0000-4000-8000-000000000034', 'الحسابات',         'ord-accounts.dev@ibtekr.local', '01000000034', 'accounts', 'active',    '{}'),
  ('00000000-0000-4000-8000-000000000035', 'مشاهد موقوف',      'ord-susp.dev@ibtekr.local',     '01000000035', 'viewer',   'suspended', '{}'),
  ('00000000-0000-4000-8000-000000000036', 'متابعة الموردين',  'ord-vf.dev@ibtekr.local',       '01000000036', 'vendors_followup', 'active', '{}');

-- One Dokan vendor, two products, order 181668 with one Dokan sub-order and two lines, order 181700 with no lines;
-- one sync log row and one webhook delivery. Written by the runner, as the sync would.
insert into public.vendors (id, woo_vendor_id, name, phone) values
  ('00000000-0000-4000-8000-0000000000a1', 77, 'متجر سلمى', '01000000077');

insert into public.products (id, sku, name, vendor_id, price, status) values
  (501, 'SC-12', 'شمعة معطرة', '00000000-0000-4000-8000-0000000000a1', 501, 'publish'),
  (502, 'SC-13', 'كوب فخار',   '00000000-0000-4000-8000-0000000000a1', 250, 'publish');

insert into public.orders (id, number, customer_name, customer_phone, customer_city, customer_address,
                           payment_method, payment_title, status, woo_status, total, placed_at, woo_updated_at) values
  (181668, '181668', 'سلوى زيتوني', '01100007039', 'القاهرة', 'شارع التحرير',
   'cod', 'الدفع عند الاستلام', 'قيد الانتظار', 'pending', 1252, '2026-10-19T09:12:00Z', '2026-10-19T09:12:00Z'),
  (181700, '181700', 'منى سامي', '01011112222', 'الجيزة', 'شارع الهرم',
   'cod', 'الدفع عند الاستلام', 'جاري التنفيذ', 'processing', 400, '2026-10-20T10:00:00Z', '2026-10-20T10:00:00Z');

insert into public.sub_orders (order_id, vendor_id, woo_order_id, woo_status, total) values
  (181668, '00000000-0000-4000-8000-0000000000a1', 181669, 'pending', 1252);

insert into public.order_items (id, order_id, sub_order_id, product_id, sku, name, qty, total, vendor_id) values
  (9001, 181668, (select id from public.sub_orders where woo_order_id = 181669), 501, 'SC-12', 'شمعة معطرة', 2, 1002,
   '00000000-0000-4000-8000-0000000000a1'),
  (9002, 181668, (select id from public.sub_orders where woo_order_id = 181669), 502, 'SC-13', 'كوب فخار', 1, 250,
   '00000000-0000-4000-8000-0000000000a1');

insert into public.woo_sync_log (kind, direction, entity, entity_id, action, result) values
  ('sync', 'in', 'order', '181668', 'upsert', 'ok');
insert into public.woo_webhook_events (delivery_id, webhook_id, topic, resource_id, status) values
  ('dlv-181668-1', '91', 'order.updated', 181668, 'ok');
insert into public.sync_state (key, value) values ('orders', '{"cursor":"2026-10-19T09:12:00Z"}');

-- ================================================================ runner: seed, mask_phone, constraints

do $$ begin
  if not ((select string_agg(system_status || '=' || coalesce(woo_status, '∅') || '/' || direction, ',' order by sort)
           from public.status_map)
          = 'قيد الانتظار=pending/both,جاري التنفيذ=processing/both,معلّق=on-hold/both,'
            || 'جاهز للشحن=ready-shipping/both,قيد الشحن=in-shipping/both,تم RTC=∅/from_system,'
            || 'مكتمل=completed/both,استرجاع=refunded/both,ملغي=cancelled/both') then
    raise exception 'case status_map nine rows in screen order (slugs from the staging probe) failed';
  end if;
  if not ((select array_agg(sort order by sort) from public.status_map) = array[1, 2, 3, 4, 5, 6, 7, 8, 9]) then
    raise exception 'case status_map sort 1..9 failed';
  end if;
  if exists (select 1 from public.status_map where system_status in ('مرتجع') or woo_status = 'shipped') then
    raise exception 'case status_map phase-0 names renamed (مرتجع → استرجاع, shipped → in-shipping) failed';
  end if;

  if not (public.mask_phone('01100007039') = '011••••7039') then raise exception 'case mask_phone 11 digits failed'; end if;
  if not (public.mask_phone(null) is null) then raise exception 'case mask_phone(null) is null failed'; end if;
  if not (public.mask_phone('') = '') then raise exception 'case mask_phone empty string unchanged failed'; end if;
  if not (public.mask_phone('0223456789') = '022••••6789') then raise exception 'case mask_phone 10 characters failed'; end if;
  if not (public.mask_phone('0224779') = '••••79') then raise exception 'case mask_phone short value shows the last 2 only failed'; end if;
  if not (public.mask_phone('1') = '••••1') then raise exception 'case mask_phone one character failed'; end if;

  -- raw is service_role-only: orders_v does not carry it at all.
  if not ((select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'orders_v' and column_name = 'raw') = 0) then
    raise exception 'case orders_v has no raw column failed';
  end if;
  if not ((select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'order_items' and column_name = 'removed'
             and data_type = 'boolean' and is_nullable = 'NO' and column_default = 'false') = 1) then
    raise exception 'case order_items.removed boolean not null default false failed';
  end if;
end $$;

do $$ begin
  begin
    insert into public.orders (id, number, customer_name, status, placed_at)
      values (1, '1', 'x', 'shipped', now());
  exception when others then
    if sqlstate = '23503' then return; end if; -- expected: orders.status references status_map(system_status)
    raise exception 'case orders.status outside status_map: expected 23503, got % (%)', sqlstate, sqlerrm;
  end;
  raise exception 'case orders.status outside status_map must error failed';
end $$;

do $$ begin
  begin
    update public.order_items set status = 'مشحون' where id = 9002;
  exception when others then
    if sqlstate = '23514' then return; end if; -- expected: the 11 sub-statuses of block 29 (SS) or ''
    raise exception 'case order_items.status outside SS: expected 23514, got % (%)', sqlstate, sqlerrm;
  end;
  raise exception 'case order_items.status outside SS must error failed';
end $$;

do $$ begin
  begin
    update public.orders set confirm = 'مؤكد' where id = 181668;
  exception when others then
    if sqlstate = '23514' then return; end if; -- expected: the 4 confirm states of block 29 (CF)
    raise exception 'case orders.confirm outside CF: expected 23514, got % (%)', sqlstate, sqlerrm;
  end;
  raise exception 'case orders.confirm outside CF must error failed';
end $$;

-- ================================================================ accounts: reads masked, writes nothing

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000034","role":"authenticated"}';
do $$ begin
  if not ((select count(*) from public.orders_v) = 2) then raise exception 'case accounts reads orders_v (2 rows) failed'; end if;
  if not ((select customer_phone from public.orders_v where id = 181668) = '011••••7039') then
    raise exception 'case accounts (sensitive.customer_phone N) sees the phone masked 011••••7039 failed';
  end if;
  if not ((select customer_name from public.orders where id = 181668) = 'سلوى زيتوني') then
    raise exception 'case accounts reads the non-sensitive columns of orders failed';
  end if;
  if not ((select count(*) from public.order_items) = 2 and (select count(*) from public.sub_orders) = 1
          and (select count(*) from public.products) = 2 and (select count(*) from public.vendors) = 1) then
    raise exception 'case accounts reads order_items/sub_orders/products/vendors failed';
  end if;
  if not ((select count(*) from public.woo_sync_log) = 0 and (select count(*) from public.woo_webhook_events) = 0
          and (select count(*) from public.sync_state) = 0) then
    raise exception 'case accounts (settings.view N) reads zero woo_sync_log/woo_webhook_events/sync_state failed';
  end if;
end $$;

-- The raw phone is not readable from the table: the masked view is the only way to it.
do $$ begin
  begin
    perform customer_phone from public.orders where id = 181668;
  exception when others then
    if sqlstate = '42501' then return; end if; -- expected: no select privilege on orders.customer_phone
    raise exception 'case accounts reads orders.customer_phone directly: expected 42501, got % (%)', sqlstate, sqlerrm;
  end;
  raise exception 'case accounts reads orders.customer_phone directly must error failed';
end $$;

-- No phone oracle through UPDATE: setting the phone to its CURRENT value is refused too (column-level grant).
do $$ begin
  begin
    update public.orders set customer_phone = '01100007039' where id = 181668;
  exception when others then
    if sqlstate = '42501' then return; end if; -- expected: no update privilege on orders.customer_phone
    raise exception 'case accounts sets customer_phone to its current value: expected 42501, got % (%)', sqlstate, sqlerrm;
  end;
  raise exception 'case accounts sets customer_phone to its current value must error failed';
end $$;

do $$ begin
  begin
    update public.orders set status = 'جاري التنفيذ' where id = 181668;
  exception when others then
    if sqlstate = '42501' then return; end if; -- expected: orders.status N
    raise exception 'case accounts changes order status: expected 42501, got % (%)', sqlstate, sqlerrm;
  end;
  raise exception 'case accounts changes order status must error failed';
end $$;

do $$ begin
  begin
    update public.order_items set status = 'مؤكد' where id = 9001;
  exception when others then
    if sqlstate = '42501' then return; end if; -- expected: orders.status N
    raise exception 'case accounts changes an item status: expected 42501, got % (%)', sqlstate, sqlerrm;
  end;
  raise exception 'case accounts changes an item status must error failed';
end $$;

-- ================================================================ cs: full phone, confirms, no edit

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000033","role":"authenticated"}';
do $$ declare n int; begin
  if not ((select customer_phone from public.orders_v where id = 181668) = '01100007039') then
    raise exception 'case cs (sensitive.customer_phone F) sees the full phone failed';
  end if;

  update public.orders set confirm = 'مؤكد بعربون', confirm_at = '2026-10-25' where id = 181668;
  get diagnostics n = row_count;
  if not (n = 1) then raise exception 'case cs (orders.status F) confirms the order failed'; end if;
  if not exists (select 1 from public.order_events
                 where order_id = 181668 and kind = 'confirm' and old_value = 'غير مؤكد' and new_value = 'مؤكد بعربون'
                   and source = 'user' and actor = auth.uid()) then
    raise exception 'case cs confirm writes order_events kind confirm failed';
  end if;
end $$;

do $$ begin
  begin
    update public.orders set note = 'ملاحظة من خدمة العملاء' where id = 181668;
  exception when others then
    if sqlstate = '42501' then return; end if; -- expected: orders.edit N
    raise exception 'case cs changes note: expected 42501, got % (%)', sqlstate, sqlerrm;
  end;
  raise exception 'case cs changes note must error failed';
end $$;

-- ================================================================ ops: status, edit, cancel, refund, item return

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000032","role":"authenticated"}';
do $$ declare n int; begin
  if not ((select customer_phone from public.orders_v where id = 181668) = '01100007039') then
    raise exception 'case ops (sensitive.customer_phone F) sees the full phone failed';
  end if;

  update public.orders set status = 'جاري التنفيذ' where id = 181668;
  get diagnostics n = row_count;
  if not (n = 1) then raise exception 'case ops (orders.status F) changes status failed'; end if;
  if not exists (select 1 from public.order_events
                 where order_id = 181668 and item_id is null and kind = 'status'
                   and old_value = 'قيد الانتظار' and new_value = 'جاري التنفيذ'
                   and source = 'user' and actor = '00000000-0000-4000-8000-000000000032') then
    raise exception 'case ops status change writes order_events kind status, source user, actor ops failed';
  end if;

  update public.orders set note = 'اتصل بعد الضهر', deposit = 100 where id = 181668;
  get diagnostics n = row_count;
  if not (n = 1) then raise exception 'case ops (orders.edit P) changes note and deposit failed'; end if;
  if not (exists (select 1 from public.order_events where kind = 'note' and old_value is null and new_value = 'اتصل بعد الضهر')
          and exists (select 1 from public.order_events where kind = 'deposit' and old_value = '0.00' and new_value = '100.00')) then
    raise exception 'case ops note/deposit write order_events kinds note and deposit failed';
  end if;

  update public.orders set status = 'ملغي', cancel = '{"reason":"العميل لا يرد","date":"2026-10-25"}' where id = 181668;
  get diagnostics n = row_count;
  if not (n = 1) then raise exception 'case ops cancels the order failed'; end if;
  if not exists (select 1 from public.returns
                 where order_id = 181668 and item_id is null and kind = 'order_cancel' and reason = 'العميل لا يرد'
                   and on_date = '2026-10-25' and by_user = auth.uid()) then
    raise exception 'case ops cancel with a reason writes returns kind order_cancel failed';
  end if;
  if not exists (select 1 from public.order_events where kind = 'cancel' and old_value is null and new_value like '%العميل لا يرد%') then
    raise exception 'case ops cancel writes order_events kind cancel failed';
  end if;

  update public.orders set status = 'استرجاع', ret = '{"reason":"المنتج مكسور","date":"2026-10-26","note":"صورة على الواتساب"}'
    where id = 181668;
  if not exists (select 1 from public.returns
                 where order_id = 181668 and kind = 'order_refund' and reason = 'المنتج مكسور'
                   and note = 'صورة على الواتساب' and on_date = '2026-10-26' and by_user = auth.uid()) then
    raise exception 'case ops refund with a reason writes returns kind order_refund failed';
  end if;
  if not exists (select 1 from public.order_events
                 where order_id = 181668 and kind = 'ret' and old_value is null and new_value like '%المنتج مكسور%'
                   and source = 'user' and actor = auth.uid()) then
    raise exception 'case ops refund writes order_events kind ret failed';
  end if;

  update public.order_items set status = 'مرتجع للمخزن', ret = '{"reason":"مقاس غلط"}' where id = 9001;
  get diagnostics n = row_count;
  if not (n = 1) then raise exception 'case ops (orders.status F) changes an item status failed'; end if;
  if not exists (select 1 from public.returns
                 where order_id = 181668 and item_id = 9001 and kind = 'item_to_stock' and reason = 'مقاس غلط'
                   and on_date is null and by_user = auth.uid()) then
    raise exception 'case ops item return to stock writes returns kind item_to_stock failed';
  end if;
  if not exists (select 1 from public.order_events
                 where order_id = 181668 and item_id = 9001 and kind = 'item_status'
                   and old_value = '' and new_value = 'مرتجع للمخزن' and source = 'user' and actor = auth.uid()) then
    raise exception 'case ops item status writes order_events kind item_status failed';
  end if;

  update public.order_items set waybill = '{"no":"BX-1"}', pulled = true, expected_at = '2026-10-28' where id = 9002;
  if not (exists (select 1 from public.order_events where item_id = 9002 and kind = 'item_waybill' and new_value like '%BX-1%')
          and exists (select 1 from public.order_events where item_id = 9002 and kind = 'item_pulled'
                      and old_value = 'false' and new_value = 'true')
          and exists (select 1 from public.order_events where item_id = 9002 and kind = 'item_expected_at'
                      and old_value is null and new_value = '2026-10-28')) then
    raise exception 'case ops waybill/pulled/expected_at write order_events failed';
  end if;

  update public.order_items set status = 'مرتجع للمورد', ret = '{"reason":"عيب صناعة","date":"2026-10-27"}' where id = 9002;
  if not exists (select 1 from public.returns
                 where order_id = 181668 and item_id = 9002 and kind = 'item_to_vendor' and reason = 'عيب صناعة'
                   and on_date = '2026-10-27' and by_user = auth.uid()) then
    raise exception 'case ops item return to vendor writes returns kind item_to_vendor failed';
  end if;

  -- a cancel without a reason changes the status (and is logged) but is no return
  update public.orders set status = 'ملغي', cancel = '{"date":"2026-10-25"}' where id = 181700;
  get diagnostics n = row_count;
  if not (n = 1) then raise exception 'case ops cancels order 181700 without a reason failed'; end if;
  if exists (select 1 from public.returns where order_id = 181700) then
    raise exception 'case cancel without a reason writes no returns row failed';
  end if;
  if not exists (select 1 from public.order_events where order_id = 181700 and kind = 'status' and new_value = 'ملغي') then
    raise exception 'case cancel without a reason still writes order_events kind status failed';
  end if;

  -- columns by name work; raw is not among them, select * on orders_v works
  if not ((select count(*) from (select id, status, removed from public.order_items where not removed) x) = 2) then
    raise exception 'case ops selects id, status, removed from order_items failed';
  end if;
  if not ((select count(*) from (select * from public.orders_v) x) = 2) then
    raise exception 'case ops select * from orders_v failed';
  end if;

  if not ((select count(*) from public.woo_sync_log) = 1 and (select count(*) from public.woo_webhook_events) = 1
          and (select count(*) from public.sync_state) = 1) then
    raise exception 'case ops (settings.view P) reads woo_sync_log/woo_webhook_events/sync_state failed';
  end if;
end $$;

do $$
declare t text;
begin
  foreach t in array array['orders', 'order_items', 'sub_orders'] loop
    begin
      execute format('select raw from public.%I limit 1', t);
      raise exception 'case ops select raw from % must error failed', t;
    exception when others then
      if sqlstate <> '42501' then -- expected: raw is service_role-only (column grants)
        raise exception 'case ops select raw from %: expected 42501, got % (%)', t, sqlstate, sqlerrm;
      end if;
    end;
  end loop;
end $$;

do $$ begin
  begin
    update public.orders set customer_name = 'سلوى زيتوني' where id = 181668;
  exception when others then
    if sqlstate = '42501' then return; end if; -- expected: no update privilege on a WooCommerce column, same value or not
    raise exception 'case ops sets customer_name to its current value: expected 42501, got % (%)', sqlstate, sqlerrm;
  end;
  raise exception 'case ops sets customer_name to its current value must error failed';
end $$;

do $$ begin
  begin
    update public.order_items set qty = 2, removed = false where id = 9001;
  exception when others then
    if sqlstate = '42501' then return; end if; -- expected: no update privilege on a sync-only line column, same value or not
    raise exception 'case ops sets item qty/removed to their current values: expected 42501, got % (%)', sqlstate, sqlerrm;
  end;
  raise exception 'case ops sets item qty/removed to their current values must error failed';
end $$;

do $$ begin
  begin
    update public.vendors set aliases = '{"سلمى"}' where woo_vendor_id = 77;
  exception when others then
    if sqlstate = '42501' then return; end if; -- expected: vendors.edit P is not F (with check)
    raise exception 'case ops (vendors.edit P) updates a vendor: expected 42501, got % (%)', sqlstate, sqlerrm;
  end;
  raise exception 'case ops (vendors.edit P) updates a vendor must error failed';
end $$;

do $$ begin
  begin
    update public.orders set customer_name = 'اسم تاني' where id = 181668;
  exception when others then
    if sqlstate = '42501' then return; end if; -- expected: a WooCommerce column, never written from the API
    raise exception 'case ops changes customer_name: expected 42501, got % (%)', sqlstate, sqlerrm;
  end;
  raise exception 'case ops changes customer_name must error failed';
end $$;

do $$ begin
  begin
    update public.orders set customer_phone = '01000000000' where id = 181668;
  exception when others then
    if sqlstate = '42501' then return; end if; -- expected: a WooCommerce column, never written from the API
    raise exception 'case ops changes customer_phone: expected 42501, got % (%)', sqlstate, sqlerrm;
  end;
  raise exception 'case ops changes customer_phone must error failed';
end $$;

do $$ begin
  begin
    update public.order_items set name = 'اسم تاني' where id = 9001;
  exception when others then
    if sqlstate = '42501' then return; end if; -- expected: a WooCommerce column of the line
    raise exception 'case ops changes an item name: expected 42501, got % (%)', sqlstate, sqlerrm;
  end;
  raise exception 'case ops changes an item name must error failed';
end $$;

do $$ begin
  begin
    insert into public.vendors (woo_vendor_id, name) values (78, 'متجر جديد');
  exception when others then
    if sqlstate = '42501' then return; end if; -- expected: vendors.edit P is not F
    raise exception 'case ops (vendors.edit P) inserts a vendor: expected 42501, got % (%)', sqlstate, sqlerrm;
  end;
  raise exception 'case ops (vendors.edit P) inserts a vendor must error failed';
end $$;

do $$ begin
  begin
    insert into public.order_events (order_id, source, kind) values (181668, 'user', 'status');
  exception when others then
    if sqlstate = '42501' then return; end if; -- expected: events come from the triggers only (no insert grant)
    raise exception 'case ops inserts order_events: expected 42501, got % (%)', sqlstate, sqlerrm;
  end;
  raise exception 'case ops inserts order_events must error failed';
end $$;

-- ================================================================ suspended viewer: nothing

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000035","role":"authenticated"}';
do $$ declare n int; begin
  if not ((select count(*) from public.orders_v) = 0) then raise exception 'case suspended viewer reads zero orders_v failed'; end if;
  if not ((select count(*) from public.orders) = 0 and (select count(*) from public.order_items) = 0
          and (select count(*) from public.sub_orders) = 0 and (select count(*) from public.order_events) = 0
          and (select count(*) from public.returns) = 0 and (select count(*) from public.products) = 0
          and (select count(*) from public.vendors) = 0) then
    raise exception 'case suspended viewer reads zero rows of the orders tables failed';
  end if;
  if not (public.order_customer_phone(181668) is null) then
    raise exception 'case suspended viewer gets no phone through order_customer_phone failed';
  end if;
  update public.orders set note = 'x' where id = 181668;
  get diagnostics n = row_count;
  if not (n = 0) then raise exception 'case suspended viewer updates zero orders failed'; end if;
end $$;

-- ================================================================ vendors follow-up: orders.status F, phone N, vendors.edit F

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000036","role":"authenticated"}';
do $$ declare n int; begin
  if not ((select customer_phone from public.orders_v where id = 181668) = '011••••7039') then
    raise exception 'case vendors follow-up (sensitive.customer_phone N) sees the phone masked failed';
  end if;
  update public.vendors set aliases = '{"سلمى", "Salma"}' where woo_vendor_id = 77;
  get diagnostics n = row_count;
  if not (n = 1) then raise exception 'case vendors follow-up (vendors.edit F, not admin) updates a vendor failed'; end if;
end $$;

-- orders.status F is enough to pass the update policy, so a guess that matches would succeed if the column were
-- writable: the grant refuses the phone column whatever its value.
do $$ begin
  begin
    update public.orders set customer_phone = '01100007039' where id = 181668;
  exception when others then
    if sqlstate = '42501' then return; end if; -- expected: no update privilege on orders.customer_phone
    raise exception 'case vendors follow-up sets customer_phone to its current value: expected 42501, got % (%)', sqlstate, sqlerrm;
  end;
  raise exception 'case vendors follow-up sets customer_phone to its current value must error failed';
end $$;

-- ================================================================ admin: vendors yes, Woo columns no

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000031","role":"authenticated"}';
do $$ declare n int; begin
  insert into public.vendors (woo_vendor_id, name, aliases) values (78, 'متجر جديد', '{"جديد"}');
  get diagnostics n = row_count;
  if not (n = 1) then raise exception 'case admin inserts a vendor failed'; end if;
end $$;

do $$ begin
  begin
    update public.orders set total = 1 where id = 181668;
  exception when others then
    if sqlstate = '42501' then return; end if; -- expected: WooCommerce columns are sync-only, admin included
    raise exception 'case admin changes total: expected 42501, got % (%)', sqlstate, sqlerrm;
  end;
  raise exception 'case admin changes total must error failed';
end $$;

-- ================================================================ anon: zero rows or permission denied

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
declare t text; n bigint;
begin
  foreach t in array array['vendors', 'products', 'orders', 'orders_v', 'sub_orders', 'order_items', 'order_events',
                           'returns', 'woo_webhook_events', 'woo_sync_log', 'sync_state'] loop
    begin
      execute format('select count(*) from public.%I', t) into strict n;
      if n <> 0 then raise exception 'case anon reads zero rows (%) failed', t; end if;
    exception when insufficient_privilege then
      if sqlerrm ilike '%function%' then
        raise exception 'case anon on % hit a policy function: %', t, sqlerrm;
      end if; -- else: table-level permission denied is acceptable
    end;
  end loop;
end $$;

-- ================================================================ runner (the sync, no auth.uid()): source woo

reset role;
set local request.jwt.claims = '';
do $$ declare n int; begin
  update public.orders set woo_status = 'refunded', woo_updated_at = '2026-10-26T10:00:00Z' where id = 181668;
  if not exists (select 1 from public.order_events
                 where order_id = 181668 and kind = 'woo_status' and old_value = 'pending' and new_value = 'refunded'
                   and source = 'woo' and actor is null) then
    raise exception 'case runner woo_status change writes order_events source woo, actor null failed';
  end if;

  update public.orders set customer_phone = '01099998888' where id = 181668;
  if not ((select count(*) from public.order_events where order_id = 181668 and kind = 'phone'
           and old_value is null and new_value is null and source = 'woo') = 1) then
    raise exception 'case phone change writes one order_events row kind phone without values failed';
  end if;
  if exists (select 1 from public.order_events
             where concat(old_value, new_value, detail::text) ~ '(9941|8888|01100007039|01099998888)') then
    raise exception 'case order_events never stores a phone value failed';
  end if;

  -- a refused change leaves no event: exactly the four user status changes and nothing from accounts.
  if not ((select count(*) from public.order_events where kind = 'status' and source = 'user') = 4) then
    raise exception 'case order_events holds exactly the four accepted status changes failed';
  end if;
  if not ((select string_agg(kind, ',' order by id) from public.returns)
          = 'order_cancel,order_refund,item_to_stock,item_to_vendor') then
    raise exception 'case returns holds exactly order_cancel, order_refund, item_to_stock, item_to_vendor failed';
  end if;
end $$;

do $$ begin
  begin
    insert into public.woo_webhook_events (delivery_id, webhook_id, topic, resource_id, status)
      values ('dlv-181668-1', '91', 'order.updated', 181668, 'ok');
  exception when others then
    if sqlstate = '23505' then return; end if; -- expected: delivery_id is unique (webhook idempotency)
    raise exception 'case duplicate webhook delivery_id: expected 23505, got % (%)', sqlstate, sqlerrm;
  end;
  raise exception 'case duplicate webhook delivery_id must error failed';
end $$;

-- ================================================================ admin renames a status in use: orders follow

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000031","role":"authenticated"}';
do $$ declare n int; begin
  update public.status_map set system_status = 'استرجاع كامل' where system_status = 'استرجاع';
  get diagnostics n = row_count;
  if not (n = 1) then raise exception 'case admin renames a status_map row in use failed'; end if;
  if not ((select status from public.orders where id = 181668) = 'استرجاع كامل') then
    raise exception 'case orders.status follows the rename (on update cascade) failed';
  end if;
  if not exists (select 1 from public.order_events
                 where order_id = 181668 and kind = 'status' and old_value = 'استرجاع' and new_value = 'استرجاع كامل') then
    raise exception 'case the cascaded rename is recorded in order_events failed';
  end if;
end $$;

reset role;
rollback;

do $$ begin raise notice 'rls_orders: ok'; end $$;
