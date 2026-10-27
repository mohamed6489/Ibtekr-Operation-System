-- RLS / permission tests for 0018_orders_maker_rating (the sub-order statuses named «المبتكر», customer_ratings and
-- order_complete). Depends on 0001_identity … 0018_orders_maker_rating.
-- Runs in one transaction and rolls back; prints NOTICE 'rls_customer_ratings: ok' only if every case passed.
-- Live-safe: every count is scoped to the rows this file writes. Every name, number and phone is made up.

begin;

-- Test users (fixed UUIDs …c1–…c3): orders.status = F; orders.view F but orders.status N; orders.view N.
insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000000c1', 'cr-ops.dev@ibtekr.local',  '010000000c1'),
  ('00000000-0000-4000-8000-0000000000c2', 'cr-view.dev@ibtekr.local', '010000000c2'),
  ('00000000-0000-4000-8000-0000000000c3', 'cr-none.dev@ibtekr.local', '010000000c3');

insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email)
from auth.users u
where u.id in ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000c3');

insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-0000000000c1', 'تقييم العمليات', 'cr-ops.dev@ibtekr.local',  '010000000c1', 'ops', 'active', '{"orders.view":"F","orders.status":"F"}'),
  ('00000000-0000-4000-8000-0000000000c2', 'تقييم المشاهدة', 'cr-view.dev@ibtekr.local', '010000000c2', 'ops', 'active', '{"orders.view":"F","orders.status":"N"}'),
  ('00000000-0000-4000-8000-0000000000c3', 'تقييم بدون',     'cr-none.dev@ibtekr.local', '010000000c3', 'ops', 'active', '{"orders.view":"N","orders.status":"N"}');

insert into public.orders (id, number, customer_name, customer_phone, status, woo_status, total, placed_at) values
  (99960001, '99960001', 'عميل تجريبي', '01000000001', 'قيد الانتظار', 'pending', 500, '2026-10-20T09:00:00Z'),
  (99960002, '99960002', 'عميل تجريبي تاني', '01000000002', 'قيد الانتظار', 'pending', 300, '2026-10-20T10:00:00Z');
insert into public.order_items (id, order_id, name, qty, total) values
  (99960101, 99960001, 'منتج تجريبي', 1, 500);

-- ================================================================ runner: the statuses, the table, the grants

do $$ begin
  if (select pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid = 'public.order_items'::regclass and c.conname = 'order_items_status_check') like '%المورد%' then
    raise exception 'case the status check no longer names «المورد» failed';
  end if;
  update public.order_items set status = 'جاهز للشحن من المبتكر للعميل' where id = 99960101;
  begin
    update public.order_items set status = 'جاهز للشحن من المورد للعميل' where id = 99960101;
    raise exception 'case the old status name must be refused failed';
  exception when check_violation then null;
  end;
  -- the line sent back to its maker still writes its returns row (item_to_vendor)
  update public.order_items set status = 'مرتجع للمبتكر', ret = '{"reason":"سبب تجريبي"}' where id = 99960101;
  if (select count(*) from public.returns where item_id = 99960101 and kind = 'item_to_vendor') <> 1 then
    raise exception 'case «مرتجع للمبتكر» writes a returns row failed';
  end if;
  if has_table_privilege('authenticated', 'public.customer_ratings', 'UPDATE') or has_table_privilege('authenticated', 'public.customer_ratings', 'DELETE')
     or not has_table_privilege('authenticated', 'public.customer_ratings', 'INSERT') or has_table_privilege('anon', 'public.customer_ratings', 'SELECT') then
    raise exception 'case customer_ratings grants (authenticated select / insert only, anon nothing) failed';
  end if;
end $$;

-- ================================================================ orders.status = F: completes with a rating

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}';
do $$ declare rid bigint; begin
  rid := public.order_complete(99960001, 5, 4, '  ذوق جداً  ');
  if (select status from public.orders where id = 99960001) <> 'مكتمل' then raise exception 'case order_complete sets «مكتمل» failed'; end if;
  if not exists (select 1 from public.customer_ratings where id = rid and order_id = 99960001 and sat = 5 and manners = 4
                 and note = 'ذوق جداً' and by_user = '00000000-0000-4000-8000-0000000000c1') then
    raise exception 'case order_complete writes the rating (trimmed note, by the caller) failed';
  end if;
  begin
    perform public.order_complete(99960002, 6, 3, null);
    raise exception 'case a figure over 5 must error failed';
  exception when others then
    if sqlstate <> '22023' then raise exception 'case figure 6: expected 22023, got % (%)', sqlstate, sqlerrm; end if;
  end;
  if (select status from public.orders where id = 99960002) <> 'قيد الانتظار' then raise exception 'case a refused rating leaves the status failed'; end if;
  begin
    perform public.order_complete(99960999, 3, 3, null);
    raise exception 'case an unknown order must error failed';
  exception when others then
    if sqlstate <> 'P0002' then raise exception 'case unknown order: expected P0002, got % (%)', sqlstate, sqlerrm; end if;
  end;
  begin
    insert into public.customer_ratings (order_id, sat, manners, by_user) values (99960002, 3, 3, '00000000-0000-4000-8000-0000000000c2');
    raise exception 'case a rating in another member''s name must error failed';
  exception when others then
    if sqlstate <> '42501' then raise exception 'case other by_user: expected 42501, got % (%)', sqlstate, sqlerrm; end if;
  end;
  begin
    update public.customer_ratings set sat = 1 where id = rid;
    raise exception 'case a member may not update a rating failed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ================================================================ orders.view F, orders.status N: reads, cannot complete

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000c2","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.customer_ratings where order_id = 99960001) <> 1 then raise exception 'case orders.view reads the rating failed'; end if;
  begin
    perform public.order_complete(99960002, 4, 4, null);
    raise exception 'case orders.status N must not complete failed';
  exception when others then
    if sqlstate <> '42501' then raise exception 'case status N: expected 42501, got % (%)', sqlstate, sqlerrm; end if;
  end;
end $$;

-- ================================================================ orders.view N: sees nothing, cannot complete

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000c3","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.customer_ratings where order_id = 99960001) <> 0 then raise exception 'case orders.view N reads no rating failed'; end if;
  begin
    perform public.order_complete(99960002, 4, 4, null);
    raise exception 'case orders.view N must not complete failed';
  exception when others then
    if sqlstate not in ('P0002', '42501') then raise exception 'case view N: expected P0002 / 42501, got % (%)', sqlstate, sqlerrm; end if;
  end;
end $$;

-- ================================================================ anon: no execute

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$ begin
  begin
    perform public.order_complete(99960002, 4, 4, null);
    raise exception 'case anon must error failed';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;

do $$ begin raise notice 'rls_customer_ratings: ok'; end $$;
