-- Tests for 0091_order_items_qty (a quantity the system changed on a maker's sub-order stays whatever the sync writes).
-- Depends on 0001 … 0091. One transaction, rolled back; NOTICE 'rls_order_items_qty: ok' only if every case passed. Live-safe:
-- a made-up order (99_091_001) and a made-up member; nothing else is read or written.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000091a1', 'qt-ops.dev@ibtekr.local', '010000091a1');
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-0000000091a1', 'عمليات الكمية', 'qt-ops.dev@ibtekr.local', '010000091a1', 'ops', 'active', '{"orders.view":"F","orders.status":"F"}');

insert into public.orders (id, number, customer_name, customer_phone, status, woo_status, total, placed_at) values
  (99091001, '99091001', 'عميل كمية', '01000091001', 'جاري التنفيذ', 'processing', 500, '2026-11-14T10:00:00Z');
insert into public.order_items (id, order_id, name, qty, total, removed) values
  (99091011, 99091001, 'منتج أ', 3, 300, false),
  (99091012, 99091001, 'منتج ب', 1, 200, false);

create or replace function pg_temp.as_member(p_uid text) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', 'aal2')::text, true);
end $$;

-- the grants: members never read nor write qty_set / total_set; the server does
do $$ begin
  if has_column_privilege('authenticated', 'public.order_items', 'qty_set', 'SELECT') or has_column_privilege('authenticated', 'public.order_items', 'qty_set', 'UPDATE')
     or has_column_privilege('authenticated', 'public.order_items', 'total_set', 'SELECT') or has_column_privilege('authenticated', 'public.order_items', 'total_set', 'UPDATE')
     or has_column_privilege('anon', 'public.order_items', 'qty_set', 'SELECT') then
    raise exception 'case members never see nor write qty_set / total_set failed';
  end if;
  if not has_column_privilege('service_role', 'public.order_items', 'qty_set', 'UPDATE') or not has_column_privilege('service_role', 'public.order_items', 'total_set', 'UPDATE') then
    raise exception 'case the server writes qty_set / total_set failed';
  end if;
  if has_function_privilege('authenticated', 'public.order_items_keep_qty()', 'EXECUTE') or has_function_privilege('anon', 'public.order_items_keep_qty()', 'EXECUTE') then
    raise exception 'case the trigger function is closed to members failed';
  end if;
end $$;

-- the server changes a quantity (woo-sync line_qty, an order with sub-orders): 3 → 2, the value 300 → 200
set local role service_role;
do $$ begin
  update public.order_items set qty = 2, total = 200, qty_set = 2, total_set = 200 where id = 99091011;
  if (select qty from public.order_items where id = 99091011) <> 2 or (select total from public.order_items where id = 99091011) <> 200 then raise exception 'case the new quantity and value failed'; end if;
  -- the sync brings the parent's lines back (an upsert with the old quantity and value, qty_set not sent): the new ones stay
  insert into public.order_items (id, order_id, name, qty, total, removed) values
    (99091011, 99091001, 'منتج أ', 3, 300, false), (99091012, 99091001, 'منتج ب', 1, 200, false)
  on conflict (id) do update set name = excluded.name, qty = excluded.qty, total = excluded.total, removed = excluded.removed;
  if (select qty from public.order_items where id = 99091011) <> 2 or (select total from public.order_items where id = 99091011) <> 200 then raise exception 'case the sync cannot bring the old quantity back failed'; end if;
  if (select qty from public.order_items where id = 99091012) <> 1 then raise exception 'case a line not changed follows the sync failed'; end if;
  update public.order_items set qty = 5, total = 500 where id = 99091011;
  if (select qty from public.order_items where id = 99091011) <> 2 then raise exception 'case a plain update keeps the set quantity failed'; end if;
  -- a quantity only (no value stamp): the value follows the sync
  update public.order_items set qty_set = 4, total_set = null where id = 99091012;
  update public.order_items set total = 250 where id = 99091012;
  if (select qty from public.order_items where id = 99091012) <> 4 or (select total from public.order_items where id = 99091012) <> 250 then raise exception 'case a quantity stamp without a value failed'; end if;
  -- the checks: 1–999 and a value ≥ 0
  begin update public.order_items set qty_set = 0 where id = 99091011; raise exception 'case qty_set ≥ 1 failed'; exception when check_violation then null; end;
  begin update public.order_items set total_set = -1 where id = 99091011; raise exception 'case total_set ≥ 0 failed'; exception when check_violation then null; end;
  -- a dropped line (0079) stays removed with its stamp
  update public.order_items set dropped_at = now() where id = 99091011;
  if not (select removed from public.order_items where id = 99091011) then raise exception 'case a dropped line with a stamp is removed failed'; end if;
end $$;
reset role;

-- a member (orders.status = F) changes the team status columns only; the quantity is never theirs
select pg_temp.as_member('00000000-0000-4000-8000-0000000091a1');
do $$ begin
  update public.order_items set comment = 'ملاحظة' where id = 99091012;
  begin
    update public.order_items set qty = 9 where id = 99091012;
    raise exception 'case a member cannot change a quantity failed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.order_items set qty_set = null where id = 99091012;
    raise exception 'case a member cannot clear qty_set failed';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$ begin
  if (select qty from public.order_items where id = 99091012) <> 4 or (select comment from public.order_items where id = 99091012) is distinct from 'ملاحظة' then
    raise exception 'case the member''s comment kept, the stamped quantity kept failed';
  end if;
end $$;

do $$ begin raise notice 'rls_order_items_qty: ok'; end $$;
rollback;
