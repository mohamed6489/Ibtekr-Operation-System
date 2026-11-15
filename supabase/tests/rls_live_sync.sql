-- Tests for 0104_live_sync (docs/superpowers/plans/2026-11-15-live-sync.md decision 1 — the owner 15 Nov: «الويبسايت يبقي synced عند كل
-- الاكونتات»). Depends on 0001 … 0104. One transaction, rolled back; NOTICE 'rls_live_sync: ok' only if every case passed.
-- Live-safe: made-up rows, and the signals the cases send are rolled back with them (nobody hears a broadcast that never committed).

begin;

-- A plain local database has no Realtime: a stand-in that keeps what was sent, in the hosted project's shape (there the real
-- realtime.send writes realtime.messages and the cases read that).
do $$
begin
  if to_regprocedure('realtime.send(jsonb, text, text, boolean)') is null then
    create schema if not exists realtime;
    create table realtime.messages (topic text, extension text, payload jsonb, event text, private boolean, inserted_at timestamptz default now());
    create function realtime.send(payload jsonb, event text, topic text, private boolean) returns void language sql as
      $f$ insert into realtime.messages (topic, extension, payload, event, private) values ($3, 'broadcast', $1, $2, $4) $f$;
    perform set_config('test.live_stub', '1', true);
  end if;
end $$;

insert into auth.users (id, email, phone) values ('00000000-0000-4000-8000-0000000104a1', 'live-adm.dev@ibtekr.local', '01000001041');
insert into public.profiles (id, name, email, phone, role_id, status) values ('00000000-0000-4000-8000-0000000104a1', 'أدمن المزامنة', 'live-adm.dev@ibtekr.local', '01000001041', 'admin', 'active');
insert into public.vendors (id, name) values ('00000000-0000-4000-8000-0000000104f1', 'مبتكر المزامنة');
insert into public.orders (id, number, customer_name, status, placed_at)
  select 990104000 + g, 'L' || g, 'عميل مزامنة', 'جاري التنفيذ', now() from generate_series(1, 40) g;
insert into public.order_items (id, order_id, name, qty, total) values (990104901, 990104001, 'منتج مزامنة', 1, 10), (990104902, 990104002, 'منتج مزامنة ٢', 1, 10);

-- what went on «sync» since the last look (and a fresh transaction's memory of what it already sent). The hosted project's
-- realtime.send adds the message's own uuid to the payload (`id`) — Realtime's, not ours — so it is left out of the comparison.
create or replace function pg_temp.sent() returns jsonb language plpgsql as $$
declare r jsonb;
begin
  select coalesce(jsonb_agg(m.payload - 'at' - 'id' order by m.payload ->> 't', m.payload -> 'ids'), '[]'::jsonb) into r
    from realtime.messages m where m.topic = 'sync' and m.event = 'changed' and m.private and m.extension = 'broadcast';
  delete from realtime.messages where topic = 'sync';
  perform set_config('ib.live_sent', '', true);
  return r;
end $$;
create or replace function pg_temp.as_member(p_uid text) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', 'aal2')::text, true);
end $$;

do $$
declare s jsonb; n int;
begin
  perform pg_temp.sent(); -- the seed's own signals

  -- 1) a money entry by a member: one signal that names the group and nothing else
  perform pg_temp.as_member('00000000-0000-4000-8000-0000000104a1');
  insert into public.acc_vendor_moves (vendor_id, on_date, direction, kind, amount) values ('00000000-0000-4000-8000-0000000104f1', current_date, 'withdraw', 'عربون', 10);
  reset role;
  select count(*) into n from realtime.messages where topic = 'sync' and (payload - 't' - 'at' - 'id') <> '{}'::jsonb;
  if n <> 0 then raise exception 'a signal carries more than its group and time'; end if;
  s := pg_temp.sent();
  if s <> '[{"t":"accounts"}]'::jsonb then raise exception 'accounts signal: %', s; end if;

  -- 2) once per group in a transaction, however many statements; another group still goes
  insert into public.acc_account_moves (account, on_date, direction, amount) values ('حساب البنك', current_date, 'deposit', 5);
  insert into public.acc_account_moves (account, on_date, direction, amount) values ('حساب البنك', current_date, 'deposit', 6);
  update public.acc_account_moves set note = 'x' where amount = 6 and note is null;
  update public.vendors set name = 'مبتكر المزامنة ٢' where id = '00000000-0000-4000-8000-0000000104f1';
  s := pg_temp.sent();
  if s <> '[{"t":"accounts"},{"t":"vendors"}]'::jsonb then raise exception 'one signal a group: %', s; end if;

  -- 3) orders: the changed order's id — from the order itself and from its lines; no row touched = no signal
  update public.orders set status = 'جاهز للشحن' where id = 990104001;
  s := pg_temp.sent();
  if s <> '[{"t":"orders","ids":[990104001]}]'::jsonb then raise exception 'order id: %', s; end if;
  update public.order_items set qty = 2 where id in (990104901, 990104902);
  s := pg_temp.sent();
  if s <> '[{"t":"orders","ids":[990104001,990104002]}]'::jsonb then raise exception 'line → its order: %', s; end if;
  update public.orders set note = 'x' where id = -1;
  s := pg_temp.sent();
  if s <> '[]'::jsonb then raise exception 'no row, no signal: %', s; end if;
  -- the same order twice in a transaction: once; a different order: its own signal
  update public.orders set note = 'a' where id = 990104003; update public.orders set note = 'b' where id = 990104003; update public.orders set note = 'c' where id = 990104004;
  s := pg_temp.sent();
  if s <> '[{"t":"orders","ids":[990104003]},{"t":"orders","ids":[990104004]}]'::jsonb then raise exception 'per order: %', s; end if;
  -- more than 30 orders in one statement (a sync): «read them all», no list
  update public.orders set note = 'bulk' where id between 990104001 and 990104040;
  s := pg_temp.sent();
  if s <> '[{"t":"orders"}]'::jsonb then raise exception 'bulk: %', s; end if;
  delete from public.order_items where id = 990104902;
  s := pg_temp.sent();
  -- (the inventory hears it too: a lot points at the line)
  if not (s @> '[{"t":"orders","ids":[990104002]}]'::jsonb) then raise exception 'a deleted line: %', s; end if;

  -- 4) every group has its tables
  insert into public.inv_locations (code, label) values ('ZL4', 'مكان مزامنة');
  insert into public.woo_categories (id, name, slug) values (990104, 'قسم مزامنة', 'cat-live-0104');
  insert into public.studio_batches (title, type, state, step, created_by) values ('دفعة مزامنة', 'Simple', '{"items": []}', 1, '00000000-0000-4000-8000-0000000104a1');
  insert into public.settings (section, data) values ('live_test_0104', '{}'::jsonb);
  insert into public.roles (id, name, permissions) values ('live_test_0104', 'دور مزامنة', '{}'::jsonb);
  insert into public.alerts (kind, title, role_id) values ('test', 'تنبيه مزامنة', 'admin');
  s := pg_temp.sent();
  if s <> '[{"t":"alerts"},{"t":"inventory"},{"t":"products"},{"t":"settings"},{"t":"studio"},{"t":"team"}]'::jsonb then raise exception 'groups: %', s; end if;

  -- 5) members cannot call the senders themselves
  if has_function_privilege('authenticated', 'public.live_send(text, bigint[])', 'execute') or has_function_privilege('anon', 'public.live_send(text, bigint[])', 'execute')
    or has_function_privilege('authenticated', 'public.live_changed()', 'execute') or has_function_privilege('authenticated', 'public.live_orders()', 'execute') then
    raise exception 'the senders are callable by members';
  end if;

  -- 6) the hosted project: active members hear «sync» (the policy); locally there is no realtime.topic() to write it with
  if to_regprocedure('realtime.topic()') is not null and not exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname = 'sync_receive' and cmd = 'SELECT') then
    raise exception 'sync_receive policy missing';
  end if;

  -- 7) a failing send never fails the write (the stand-in only: the real function is not replaced)
  if current_setting('test.live_stub', true) = '1' then
    create or replace function realtime.send(payload jsonb, event text, topic text, private boolean) returns void language plpgsql as $f$ begin raise exception 'realtime is down'; end $f$;
    perform set_config('ib.live_sent', '', true);
    update public.orders set note = 'still written' where id = 990104005;
    insert into public.acc_account_moves (account, on_date, direction, amount) values ('حساب البنك', current_date, 'deposit', 7);
    if (select note from public.orders where id = 990104005) <> 'still written' then raise exception 'the write was lost with the signal'; end if;
  end if;
end $$;

do $$ begin raise notice 'rls_live_sync: ok'; end $$;
rollback;
