-- Tests for 0094_product_status_cancelled (the plan docs/superpowers/plans/2026-11-14-order-edit-tabs.md, decisions 1, 2 and 6):
-- «ملغي» in the product status, set by itself when the order or the maker's sub-order is cancelled (a returned line keeps its status,
-- «استرجاع» changes nothing); a line the system added to a sub-order stays whatever the sync writes. Depends on 0001 … 0094.
-- One transaction, rolled back; NOTICE 'rls_order_items_cancel: ok' only if every case passed. Live-safe: made-up orders (99_094_…),
-- a made-up maker and member; nothing else is read or written.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000094a1', 'cn-ops.dev@ibtekr.local', '010000094a1'),
  ('00000000-0000-4000-8000-0000000094a2', 'cn-view.dev@ibtekr.local', '010000094a2');
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-0000000094a1', 'عمليات الإلغاء', 'cn-ops.dev@ibtekr.local', '010000094a1', 'ops', 'active', '{"orders.view":"F","orders.status":"F"}'),
  ('00000000-0000-4000-8000-0000000094a2', 'مشاهد الإلغاء', 'cn-view.dev@ibtekr.local', '010000094a2', 'viewer', 'active', '{"orders.view":"F","orders.status":"N"}');
insert into public.vendors (id, name, status) values
  ('00000000-0000-4000-8000-0000000094b1', 'مبتكر 0094 تجريبي', 'active'),
  ('00000000-0000-4000-8000-0000000094b2', 'مبتكر 0094 تاني', 'active');

insert into public.orders (id, number, customer_name, customer_phone, status, woo_status, total, placed_at) values
  (99094001, '99094001', 'عميل إلغاء', '01000094001', 'جاري التنفيذ', 'processing', 900, '2026-11-14T10:00:00Z'),
  (99094002, '99094002', 'عميل فرعي', '01000094002', 'جاري التنفيذ', 'processing', 700, '2026-11-14T10:00:00Z');
insert into public.sub_orders (order_id, vendor_id, woo_order_id, woo_status, total) values
  (99094002, '00000000-0000-4000-8000-0000000094b1', 99094012, 'processing', 300),
  (99094002, '00000000-0000-4000-8000-0000000094b2', 99094013, 'processing', 400);
insert into public.order_items (id, order_id, name, qty, total, removed, status) values
  (99094101, 99094001, 'منتج أ', 1, 300, false, 'مؤكد'),
  (99094102, 99094001, 'منتج ب', 1, 300, false, 'مرتجع للمبتكر'),
  (99094103, 99094001, 'منتج ممسوح', 1, 300, true, 'مؤكد');
insert into public.order_items (id, order_id, sub_order_id, vendor_id, name, qty, total, removed, status)
select 99094201, 99094002, s.id, s.vendor_id, 'منتج المبتكر الأول', 1, 300, false, 'قيد التنفيذ' from public.sub_orders s where s.woo_order_id = 99094012
union all
select 99094202, 99094002, s.id, s.vendor_id, 'منتج المبتكر التاني', 1, 400, false, 'قيد التنفيذ' from public.sub_orders s where s.woo_order_id = 99094013;

create or replace function pg_temp.as_member(p_uid text) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', 'aal2')::text, true);
end $$;

-- the grants: the trigger functions are closed; added_at is the server's
do $$ begin
  if has_function_privilege('authenticated', 'public.orders_cancel_lines()', 'EXECUTE') or has_function_privilege('authenticated', 'public.sub_orders_cancel_lines()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.order_items_keep_added()', 'EXECUTE') or has_function_privilege('anon', 'public.orders_cancel_lines()', 'EXECUTE') then
    raise exception 'case the trigger functions are closed to members failed';
  end if;
  if has_column_privilege('authenticated', 'public.order_items', 'added_at', 'SELECT') or has_column_privilege('authenticated', 'public.order_items', 'added_at', 'UPDATE') then
    raise exception 'case members never see nor write added_at failed';
  end if;
end $$;

-- a member (orders.status = F) sets «ملغي» on a line by hand; a viewer cannot
select pg_temp.as_member('00000000-0000-4000-8000-0000000094a1');
do $$ begin
  update public.order_items set status = 'ملغي' where id = 99094201;
  if (select status from public.order_items where id = 99094201) <> 'ملغي' then raise exception 'case «ملغي» is a product status failed'; end if;
  update public.order_items set status = 'قيد التنفيذ' where id = 99094201;
  begin
    update public.order_items set status = 'حالة مش موجودة' where id = 99094201;
    raise exception 'case an unknown product status is refused failed';
  exception when check_violation then null;
  end;
end $$;
reset role;
select pg_temp.as_member('00000000-0000-4000-8000-0000000094a2');
do $$ begin
  begin
    update public.order_items set status = 'ملغي' where id = 99094201;
    raise exception 'case a viewer cannot set a product status failed';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- the member cancels the order: its lines become «ملغي», the returned one and the removed one stay; the event names the member
select pg_temp.as_member('00000000-0000-4000-8000-0000000094a1');
do $$ begin
  update public.orders set status = 'ملغي' where id = 99094001;
end $$;
reset role;
do $$ begin
  if (select status from public.order_items where id = 99094101) <> 'ملغي' then raise exception 'case the order cancelled cancels its lines failed'; end if;
  if (select status from public.order_items where id = 99094102) <> 'مرتجع للمبتكر' then raise exception 'case a returned line keeps its status failed'; end if;
  if (select status from public.order_items where id = 99094103) <> 'مؤكد' then raise exception 'case a removed line is left as it is failed'; end if;
  if not exists (select 1 from public.order_events where item_id = 99094101 and kind = 'item_status' and new_value = 'ملغي'
                   and actor = '00000000-0000-4000-8000-0000000094a1') then
    raise exception 'case the line change is recorded with the member failed';
  end if;
end $$;

-- the server: «استرجاع» on a sub-order changes nothing; «ملغي» on it cancels its lines only; the order stays as it is
set local role service_role;
do $$ begin
  update public.sub_orders set woo_status = 'refunded' where woo_order_id = 99094012;
  if (select status from public.order_items where id = 99094201) <> 'قيد التنفيذ' then raise exception 'case a refund on the site changes no line failed'; end if;
  update public.sub_orders set woo_status = 'cancelled' where woo_order_id = 99094012;
  if (select status from public.order_items where id = 99094201) <> 'ملغي' then raise exception 'case the sub-order cancelled cancels its lines failed'; end if;
  if (select status from public.order_items where id = 99094202) <> 'قيد التنفيذ' then raise exception 'case another maker''s lines stay failed'; end if;
  update public.sub_orders set woo_status = 'cancelled' where woo_order_id = 99094013;
  if (select status from public.orders where id = 99094002) <> 'جاري التنفيذ' then raise exception 'case the order stays when all its sub-orders are cancelled failed'; end if;

  -- a line added to a sub-order (woo-sync line_add): the sync's removed flag does not take it off; a drop on purpose does
  insert into public.order_items (id, order_id, sub_order_id, vendor_id, name, qty, total, removed, status, added_at)
  select 99094203, 99094002, s.id, s.vendor_id, 'منتج مضاف', 2, 500, false, '', now() from public.sub_orders s where s.woo_order_id = 99094013;
  update public.order_items set removed = true where id = 99094203;
  if (select removed from public.order_items where id = 99094203) then raise exception 'case the sync cannot flag an added line removed failed'; end if;
  update public.order_items set added_at = null where id = 99094203;
  if (select added_at from public.order_items where id = 99094203) is null then raise exception 'case added_at stays failed'; end if;
  update public.order_items set dropped_at = now() where id = 99094203;
  if not (select removed from public.order_items where id = 99094203) then raise exception 'case a dropped added line is removed failed'; end if;
  -- a line the sync did not add follows the removed flag as before
  update public.order_items set removed = true where id = 99094202;
  if not (select removed from public.order_items where id = 99094202) then raise exception 'case a plain line follows the sync failed'; end if;
end $$;
reset role;

do $$ begin raise notice 'rls_order_items_cancel: ok'; end $$;
rollback;
