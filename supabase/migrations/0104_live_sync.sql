-- 0104_live_sync — one change signal for the whole system (docs/superpowers/plans/2026-11-15-live-sync.md decision 1).
-- The owner 15 Nov: «الويبسايت يبقي synced عند كل الاكونتات … لازم اعمل reload عشان اشوفها». Customer service, the team requests, HR and
-- marketing already tell every open screen when something changed (their own private broadcast channels); orders, the accounts, the
-- makers, the inventory, the products and the settings did not (postgres_changes does not arrive on the hosted project — 0038).
-- Here: a private Realtime channel «sync». A statement on any of the tables below broadcasts { t: <group>, at } — the group's name
-- only, never a row — and the open screens of that group read again (app/js/adapter/live.js). Orders carry the changed order ids
-- (at most 30) so one order is read, not the whole list. One signal per group (and per id list) in a transaction. Active members
-- receive; nobody sends from a browser. Re-runnable.

-- ---------------------------------------------------------------- the send
-- A signal never fails a write: no Realtime (a plain local database) or any error inside → nothing is sent.
create or replace function public.live_send(p_topic text, p_ids bigint[] default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  k text := '|' || p_topic || ':' || coalesce(array_to_string(p_ids, ','), '*') || '|';
  sent text := coalesce(current_setting('ib.live_sent', true), '');
begin
  if to_regprocedure('realtime.send(jsonb, text, text, boolean)') is null then return; end if;
  if position(k in sent) > 0 then return; end if;                       -- the same signal already went in this transaction
  perform set_config('ib.live_sent', case when length(sent) > 6000 then '' else sent end || k, true);
  execute 'select realtime.send($1, $2, $3, $4)'
    using jsonb_strip_nulls(jsonb_build_object('t', p_topic, 'ids', to_jsonb(p_ids), 'at', now())), 'changed', 'sync', true;
exception when others then null;
end $$;
revoke execute on function public.live_send(text, bigint[]) from public, anon, authenticated;

-- a table of a group: tg_argv[0] = the group
create or replace function public.live_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.live_send(tg_argv[0], null);
  return null;
exception when others then return null;
end $$;
revoke execute on function public.live_changed() from public, anon, authenticated;

-- the orders' tables: tg_argv[0] = the column that holds the order's id in the statement's rows (the transition table «live_rows»)
create or replace function public.live_orders() returns trigger
language plpgsql security definer set search_path = public as $$
declare ids bigint[];
begin
  execute format('select array_agg(x order by x) from (select distinct %I as x from live_rows where %I is not null limit 31) s', tg_argv[0], tg_argv[0]) into ids;
  if ids is null then return null; end if;                              -- a statement that touched no row
  perform public.live_send('orders', case when array_length(ids, 1) > 30 then null else ids end);
  return null;
exception when others then return null;
end $$;
revoke execute on function public.live_orders() from public, anon, authenticated;

-- ---------------------------------------------------------------- the triggers
do $$
declare g record; t text; o record;
begin
  for g in select * from (values
    ('accounts',  array['acc_expenses', 'acc_vendor_moves', 'acc_account_moves', 'acc_vendor_settlements', 'acc_list_items', 'dokan_withdrawals', 'dokan_balances']),
    ('vendors',   array['vendors', 'vendor_rates', 'vendor_category_rates', 'vendor_bank', 'vendor_logins', 'brands', 'brand_owners']),
    ('inventory', array['inv_locations', 'inv_lots', 'inv_moves', 'inv_consolidations', 'inv_consolidation_items', 'inv_counts', 'inv_count_lines']),
    ('products',  array['products', 'woo_categories', 'woo_brands', 'product_commissions', 'sku_colors']),
    ('studio',    array['studio_batches']),
    ('settings',  array['settings', 'status_map', 'quick_actions', 'company_docs']),
    ('team',      array['profiles', 'roles']),
    ('alerts',    array['alerts'])
  ) as x(topic, tables) loop
    foreach t in array g.tables loop
      if to_regclass('public.' || t) is null then continue; end if;
      execute format('drop trigger if exists %I on public.%I', t || '_live', t);
      execute format('create trigger %I after insert or update or delete on public.%I for each statement execute function public.live_changed(%L)', t || '_live', t, g.topic);
    end loop;
  end loop;
  -- orders: a transition table takes one event a trigger — insert / update (the new rows) and delete (the old ones)
  for o in select * from (values ('orders', 'id'), ('order_items', 'order_id'), ('sub_orders', 'order_id')) as x(tbl, col) loop
    execute format('drop trigger if exists %I on public.%I', o.tbl || '_live_ins', o.tbl);
    execute format('drop trigger if exists %I on public.%I', o.tbl || '_live_upd', o.tbl);
    execute format('drop trigger if exists %I on public.%I', o.tbl || '_live_del', o.tbl);
    execute format('create trigger %I after insert on public.%I referencing new table as live_rows for each statement execute function public.live_orders(%L)', o.tbl || '_live_ins', o.tbl, o.col);
    execute format('create trigger %I after update on public.%I referencing new table as live_rows for each statement execute function public.live_orders(%L)', o.tbl || '_live_upd', o.tbl, o.col);
    execute format('create trigger %I after delete on public.%I referencing old table as live_rows for each statement execute function public.live_orders(%L)', o.tbl || '_live_del', o.tbl, o.col);
  end loop;
  -- who hears «sync»: any active member (the signal carries a group's name and order ids — no data); nobody sends
  if to_regclass('realtime.messages') is not null and to_regprocedure('realtime.topic()') is not null then
    execute 'drop policy if exists sync_receive on realtime.messages';
    execute $p$create policy sync_receive on realtime.messages for select to authenticated
      using (realtime.topic() = 'sync' and extension = 'broadcast' and (select public.hr_active()))$p$;
  end if;
end $$;
