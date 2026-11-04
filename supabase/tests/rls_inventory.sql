-- RLS / permission tests for 0044_inventory (the hub: lots, append-only moves, consolidations, counts). Depends on 0001_identity …
-- 0044_inventory. Runs in one transaction and rolls back; prints NOTICE 'rls_inventory: ok' only if every case passed. Live-safe:
-- its rows (three made-up members, one order with a line, lots, moves, a consolidation, a count) are rolled back.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000000a1', 'inv-ops.dev@ibtekr.local', '01000000a01'),
  ('00000000-0000-4000-8000-0000000000a2', 'inv-acc.dev@ibtekr.local', '01000000a02'),
  ('00000000-0000-4000-8000-0000000000a3', 'inv-adm.dev@ibtekr.local', '01000000a03');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u
where u.id in ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a3');
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-0000000000a1', 'مخزن عمليات', 'inv-ops.dev@ibtekr.local', '01000000a01', 'ops', 'active', '{}'),
  ('00000000-0000-4000-8000-0000000000a2', 'مخزن حسابات', 'inv-acc.dev@ibtekr.local', '01000000a02', 'accounts', 'active', '{}'),
  ('00000000-0000-4000-8000-0000000000a3', 'مخزن أدمن', 'inv-adm.dev@ibtekr.local', '01000000a03', 'admin', 'active', '{}');

-- an order with one line (as the sync writes them)
insert into public.orders (id, number, customer_name, status, placed_at) values (990044, '990044', 'عميل مخزن', (select system_status from public.status_map order by id limit 1), now());
insert into public.order_items (id, order_id, name, qty, total) values (99004401, 990044, 'سلة كروشيه', 1, 260), (99004402, 990044, 'فازة', 1, 300);
insert into public.orders (id, number, customer_name, status, placed_at) values (990045, '990045', 'عميل تاني', (select system_status from public.status_map order by id limit 1), now());
insert into public.order_items (id, order_id, name, qty, total) values (99004501, 990045, 'شنطة', 1, 400);

create temp table inv_ids (k text primary key, v text) on commit drop;
grant all on inv_ids to authenticated;

-- ================================================================ ops: inventory.edit F, inventory.approve N

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);

do $$
declare l uuid; c uuid; n bigint;
begin
  insert into public.inv_lots (reason, status, sku, name, loc, cost, order_id, item_id, ref, created_by)
    values ('تجميع أوردر', 'وصل المخزن', 'IBT-CB-01', 'سلة كروشيه', 'T', 260, 990044, 99004401, 'IB-990044', '00000000-0000-4000-8000-0000000000a3') returning id into l;
  if (select created_by from public.inv_lots where id = l) <> '00000000-0000-4000-8000-0000000000a1' then raise exception 'case created_by is stamped failed'; end if;
  insert into inv_ids values ('lot', l::text);
  insert into public.inv_moves (lot_id, type, qty, label, reason, ref, by, at) values (l, 'in', 1, 'دخول — تجميع', 'تجميع أوردر', 'IB-990044', '00000000-0000-4000-8000-0000000000a3', '2020-01-01');
  if (select by from public.inv_moves where lot_id = l) <> '00000000-0000-4000-8000-0000000000a1' or (select at from public.inv_moves where lot_id = l) < now() - interval '1 minute' then raise exception 'case a move is stamped by / at failed'; end if;
  begin
    insert into public.inv_moves (lot_id, type, qty) values (l, 'adjust', -1);
    raise exception 'case a manual adjustment needs inventory.approve failed';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.inv_moves (lot_id, type, qty) values (l, 'in', 0);
    raise exception 'case a zero in is refused failed';
  exception when check_violation then null;
  end;
  begin
    update public.inv_moves set qty = 5 where lot_id = l;
    raise exception 'case moves cannot be changed failed';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.inv_moves where lot_id = l;
    raise exception 'case moves cannot be deleted failed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.inv_lots set sku = 'OTHER' where id = l;
    raise exception 'case a lot''s identity is fixed failed';
  exception when insufficient_privilege then null;
  end;
  update public.inv_lots set status = 'جاهز يطلع كامل', loc = 'A' where id = l;
  begin
    delete from public.inv_lots where id = l;
    raise exception 'case a lot is never deleted failed';
  exception when insufficient_privilege then null;
  end;
  -- a consolidation: one open per order; closed stays closed
  insert into public.inv_consolidations (order_id, zone) values (990044, 'T') returning id into c;
  insert into public.inv_consolidation_items (consolidation_id, item_id) values (c, 99004401);
  insert into inv_ids values ('cons', c::text);
  begin
    insert into public.inv_consolidation_items (consolidation_id, item_id) values (c, 99004501);
    raise exception 'case a line of another order is refused failed';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.inv_consolidations (order_id, zone) values (990044, 'T');
    raise exception 'case one open consolidation per order failed';
  exception when unique_violation then null;
  end;
  update public.inv_consolidations set status = 'shipped', carrier = 'Bosta' where id = c;
  begin
    insert into public.inv_consolidation_items (consolidation_id, item_id) values (c, 99004402);
    raise exception 'case no line joins a closed consolidation failed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.inv_consolidations set closed_at = now() - interval '9 days' where id = c;
    raise exception 'case a closed consolidation''s close stays failed';
  exception when insufficient_privilege then null;
  end;
  if (select closed_by from public.inv_consolidations where id = c) <> '00000000-0000-4000-8000-0000000000a1' then raise exception 'case the close is stamped failed'; end if;
  begin
    update public.inv_consolidations set status = 'open' where id = c;
    raise exception 'case a closed consolidation stays closed failed';
  exception when insufficient_privilege then null;
  end;
  -- a count: ops starts and counts it, cannot approve it
  insert into public.inv_counts (zone) values ('رف A') returning id into n;
  insert into inv_ids values ('count', n::text);
  insert into public.inv_count_lines (count_id, lot_id, system, counted, note) values (n, l, 99, 0, 'مش لاقيينها');
  if (select system from public.inv_count_lines where count_id = n) <> 1 then raise exception 'case the system quantity is the server''s failed'; end if;
  update public.inv_count_lines set system = 50 where count_id = n;
  if (select system from public.inv_count_lines where count_id = n) <> 1 then raise exception 'case the system quantity cannot be changed failed'; end if;
  begin
    update public.inv_counts set status = 'approved' where id = n;
    raise exception 'case a count is approved through the RPC only failed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.inv_count_approve(n);
    raise exception 'case ops cannot approve a count failed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ================================================================ accounts: inventory.view F only

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
do $$ begin
  if (select count(*) from public.inv_lots where sku = 'IBT-CB-01') <> 1 then raise exception 'case accounts reads the lots failed'; end if;
  if (select count(*) from public.inv_locations) < 7 then raise exception 'case the places are seeded failed'; end if;
  begin
    insert into public.inv_lots (reason, status, name) values ('متاح للبيع', 'متاح', 'x');
    raise exception 'case accounts cannot receive failed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ================================================================ admin: approving the count writes the adjustment

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
do $$
declare n bigint := (select v::bigint from inv_ids where k = 'count'); l uuid := (select v::uuid from inv_ids where k = 'lot'); a int;
begin
  a := public.inv_count_approve(n);
  if a <> 1 then raise exception 'case one adjusted line failed (%)', a; end if;
  if (select qty from public.inv_moves where lot_id = l and type = 'adjust') <> -1 then raise exception 'case the adjustment is the difference failed'; end if;
  if public.inv_lot_on_hand(l) <> 0 then raise exception 'case on hand after the count failed'; end if;
  if (select status from public.inv_counts where id = n) <> 'approved' then raise exception 'case the count is approved failed'; end if;
  begin
    update public.inv_count_lines set counted = 3 where count_id = n;
    raise exception 'case an approved count''s lines are frozen failed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.inv_count_approve(n);
    raise exception 'case a count is approved once failed';
  exception when invalid_parameter_value then null;
  end;
  insert into public.inv_moves (lot_id, type, qty, reason) values (l, 'adjust', 1, 'لقيناها');
end $$;

reset role;
do $$ begin raise notice 'rls_inventory: ok'; end $$;
rollback;
