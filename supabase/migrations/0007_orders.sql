-- 0007_orders: vendors, products, orders, sub_orders, order_items, order_events, returns, woo_webhook_events,
-- woo_sync_log, sync_state; mask_phone + orders_v; guard and event triggers; RLS; grants; status_map reseed; Realtime.
-- Uses has_perm / is_admin (0001), profiles / status_map (0002), the role matrix (0003), the grant rules (0004).
--
-- Decision: the "sub-order" the orders screen manages is a product line (order_items) with its own operational
--   status; sub_orders is the Dokan sub-order per maker (finance and the Woo mirror). Why: the spec names sub_orders
--   per maker, while the screen runs every product on its own (reached the store, shipped, returned) — both are
--   needed. Cost if wrong: one extra table.
-- Decision: order_events is filled by triggers, never by the front end, so every change — from the screen or from
--   the sync — is recorded the same way. Cost if wrong: trigger complexity.
--
-- Notes for readers:
-- * Every write path into orders / order_items from the API goes through RLS + a BEFORE UPDATE guard that names the
--   columns each permission may change; WooCommerce columns are sync-only. The guards apply to anon / authenticated
--   only (phase-0 pattern): postgres / service_role (the sync) pass, and their changes are recorded with source
--   'woo' (no auth.uid()).
-- * The update policies of orders / order_items read `using (orders.view)` and put the brief's permission rule
--   (orders.status = F or orders.edit <> N) in `with check`, so a member who can see an order but may not change it
--   gets 42501 (guard or with check) instead of a silent "0 rows" — the screen must know the write was refused.
-- * customer_phone: authenticated gets SELECT on every orders column EXCEPT customer_phone (column grants), so the
--   raw number cannot be read from the table through PostgREST (or a filter on it used as an oracle), and Realtime,
--   which checks the subscriber's column privileges, does not carry it. orders_v (security_invoker) returns it
--   through order_customer_phone(id), a definer accessor that applies the masking rule: full when
--   has_perm('sensitive.customer_phone') = 'F', else mask_phone(); nothing without orders.view. Readers use orders_v;
--   writers update orders without asking for the row back (PostgREST return=minimal): `returning *` is refused.
-- * order_events never holds a phone: a customer_phone change is one row of kind 'phone' with null values. A
--   woo_status change is recorded too (kind 'woo_status'), so a push or a webhook shows in the order's history.
-- * returns rows come from the same triggers: an order that becomes «ملغي» / «استرجاع» with cancel / ret carrying a
--   reason, or a line that becomes «مرتجع للمخزن» / «مرتجع للمورد» with item ret carrying a reason (the reason may
--   also arrive in a later write; one row per return).
-- * status_map: the existing columns already allow the new rows (woo_status nullable and not unique, direction
--   'from_system' allowed), so no constraint changes. The reseed is update + insert only (no delete) and runs while
--   no order exists. Slugs from the staging probe (Task 1, run 40204355895).
-- * Covering indexes for every foreign key (advisor 0001_unindexed_foreign_keys, as in 0005).
-- * No drop / delete statements in this file.

-- ---------------------------------------------------------------- tables

create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  woo_vendor_id int unique,
  name text not null,
  aliases text[] not null default '{}',
  phone text,
  email text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  commission_pct numeric(5,2),
  raw jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.products (
  id bigint primary key,
  sku text,
  name text not null,
  image_url text,
  vendor_id uuid references public.vendors,
  price numeric(12,2),
  status text,
  raw jsonb,
  updated_at timestamptz default now()
);

create table public.orders (
  id bigint primary key,
  number text not null,
  customer_name text not null,
  customer_phone text,
  customer_city text,
  customer_address text,
  payment_method text,
  payment_title text,
  status text not null references public.status_map (system_status),
  woo_status text,
  confirm text not null default 'غير مؤكد'
    check (confirm in ('مؤكد بعربون', 'مؤكد بدون عربون', 'غير مؤكد', 'في انتظار الرد')),
  confirm_at date,
  confirm_note text,
  deposit numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  currency text default 'EGP',
  note text,
  customer_note text,
  placed_at timestamptz not null,
  woo_updated_at timestamptz,
  cancel jsonb,
  ret jsonb,
  raw jsonb,
  synced_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.sub_orders (
  id bigserial primary key,
  order_id bigint not null references public.orders on delete cascade,
  vendor_id uuid references public.vendors,
  woo_order_id bigint unique,
  woo_status text,
  total numeric(12,2),
  dokan_earning numeric(12,2),
  commission jsonb,
  raw jsonb,
  updated_at timestamptz default now(),
  unique (order_id, vendor_id)
);

-- status: the 11 sub-statuses of block 29 (SS, RET included) or '' (not set yet).
create table public.order_items (
  id bigint primary key,
  order_id bigint not null references public.orders on delete cascade,
  sub_order_id bigint references public.sub_orders,
  product_id bigint,
  sku text,
  name text not null,
  qty int not null default 1,
  total numeric(12,2) not null default 0,
  vendor_id uuid references public.vendors,
  status text not null default ''
    check (status in ('', 'غير مؤكد', 'مؤكد', 'قيد التنفيذ', 'جاهز للشحن من المورد للعميل',
                      'جاهز للشحن من المخزن للعميل', 'جاهز للشحن من المورد للمخزن', 'تم الشحن للمخزن',
                      'وصل المخزن', 'تم الشحن للعميل', 'مرتجع للمخزن', 'مرتجع للمورد')),
  expected_at date,
  comment text,
  ready_at timestamptz,
  waybill jsonb,
  pulled boolean not null default false,
  ret jsonb,
  store jsonb,
  raw jsonb,
  updated_at timestamptz default now()
);

create table public.order_events (
  id bigserial primary key,
  at timestamptz default now(),
  order_id bigint references public.orders on delete cascade,
  item_id bigint references public.order_items on delete cascade,
  actor uuid references public.profiles,
  source text not null check (source in ('user', 'woo', 'sync', 'system')),
  kind text not null,
  old_value text,
  new_value text,
  detail jsonb
);

create table public.returns (
  id bigserial primary key,
  at timestamptz default now(),
  order_id bigint not null references public.orders on delete cascade,
  item_id bigint references public.order_items on delete cascade,
  kind text not null check (kind in ('order_refund', 'order_cancel', 'item_to_stock', 'item_to_vendor')),
  reason text not null,
  note text,
  on_date date,
  by_user uuid references public.profiles
);

create table public.woo_webhook_events (
  id bigserial primary key,
  received_at timestamptz default now(),
  delivery_id text unique,
  webhook_id text,
  topic text not null,
  resource_id bigint,
  status text not null check (status in ('ok', 'ignored', 'duplicate', 'error')),
  error text,
  payload jsonb
);

create table public.woo_sync_log (
  id bigserial primary key,
  at timestamptz default now(),
  kind text not null check (kind in ('webhook', 'sync', 'push', 'manual', 'cron')),
  direction text check (direction in ('in', 'out')),
  entity text,
  entity_id text,
  action text,
  result text not null check (result in ('ok', 'error', 'conflict', 'skipped')),
  detail jsonb
);

create table public.sync_state (
  key text primary key,
  value jsonb not null default '{}',
  updated_at timestamptz default now()
);

create index orders_placed_at_idx on public.orders (placed_at desc);
create index orders_status_idx on public.orders (status);
create index orders_woo_updated_at_idx on public.orders (woo_updated_at);

-- covering indexes for the foreign keys (sub_orders.order_id is covered by unique (order_id, vendor_id)).
create index products_vendor_id_idx on public.products (vendor_id);
create index sub_orders_vendor_id_idx on public.sub_orders (vendor_id);
create index order_items_order_id_idx on public.order_items (order_id);
create index order_items_sub_order_id_idx on public.order_items (sub_order_id);
create index order_items_vendor_id_idx on public.order_items (vendor_id);
create index order_events_order_id_idx on public.order_events (order_id);
create index order_events_item_id_idx on public.order_events (item_id);
create index order_events_actor_idx on public.order_events (actor);
create index returns_order_id_idx on public.returns (order_id);
create index returns_item_id_idx on public.returns (item_id);
create index returns_by_user_idx on public.returns (by_user);

alter table public.vendors enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.sub_orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_events enable row level security;
alter table public.returns enable row level security;
alter table public.woo_webhook_events enable row level security;
alter table public.woo_sync_log enable row level security;
alter table public.sync_state enable row level security;

-- ---------------------------------------------------------------- functions / triggers

-- '01100007039' → '011••••7039'. null → null; fewer than 8 characters → unchanged (not a phone number).
create function public.mask_phone(p text) returns text
language sql immutable set search_path = public as $$
  select case
    when p is null then null
    when char_length(p) < 8 then p
    else left(p, 3) || '••••' || right(p, 4)
  end
$$;

-- The phone of one order as the caller may see it: full with sensitive.customer_phone = F, masked otherwise,
-- null without orders.view or for an unknown order. Definer because authenticated has no select on the column;
-- orders_v calls it per row (the row itself already passed the caller's RLS). plpgsql, not sql: its cached plans
-- keep the per-row cost near 60 µs (a sql body re-plans itself and both has_perm calls on every row, ~300 µs).
create function public.order_customer_phone(order_id bigint) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  full_phone boolean;
  phone text;
begin
  if public.has_perm('orders.view') = 'N' then
    return null;
  end if;
  full_phone := public.has_perm('sensitive.customer_phone') = 'F';
  select o.customer_phone into phone from public.orders o where o.id = order_customer_phone.order_id;
  return case when full_phone then phone else public.mask_phone(phone) end;
end
$$;

-- API roles: status / confirm / confirm_at / confirm_note / cancel / ret need orders.status = F;
-- note / customer_city / customer_address / deposit need orders.edit <> N; every other column (the WooCommerce
-- ones: customer_name, customer_phone, total, woo_status, placed_at, raw, …) is sync-only → 42501.
create function public.orders_guard_update() returns trigger
language plpgsql set search_path = public as $$
declare
  status_cols constant text[] := array['status', 'confirm', 'confirm_at', 'confirm_note', 'cancel', 'ret'];
  edit_cols constant text[] := array['note', 'customer_city', 'customer_address', 'deposit'];
  n jsonb;
  o jsonb;
begin
  if current_user in ('anon', 'authenticated') then
    n := to_jsonb(new);
    o := to_jsonb(old);
    if (n - status_cols - edit_cols) is distinct from (o - status_cols - edit_cols) then
      raise exception 'order columns synced from WooCommerce cannot be changed here' using errcode = '42501';
    end if;
    if (n - edit_cols) is distinct from (o - edit_cols) and public.has_perm('orders.status') <> 'F' then
      raise exception 'orders.status = F is required to change an order status or confirmation' using errcode = '42501';
    end if;
    if (n - status_cols) is distinct from (o - status_cols) and public.has_perm('orders.edit') = 'N' then
      raise exception 'orders.edit is required to change an order note, address or deposit' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;

create trigger orders_guard_update before update on public.orders
  for each row execute function public.orders_guard_update();

-- API roles: status / expected_at / ready_at / waybill / pulled / ret / store / comment need orders.status = F;
-- every other column of a line is sync-only → 42501.
create function public.order_items_guard_update() returns trigger
language plpgsql set search_path = public as $$
declare
  status_cols constant text[] := array['status', 'expected_at', 'ready_at', 'waybill', 'pulled', 'ret', 'store', 'comment'];
  n jsonb;
  o jsonb;
begin
  if current_user in ('anon', 'authenticated') then
    n := to_jsonb(new);
    o := to_jsonb(old);
    if (n - status_cols) is distinct from (o - status_cols) then
      raise exception 'order line columns synced from WooCommerce cannot be changed here' using errcode = '42501';
    end if;
    if n is distinct from o and public.has_perm('orders.status') <> 'F' then
      raise exception 'orders.status = F is required to change an order line' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;

create trigger order_items_guard_update before update on public.order_items
  for each row execute function public.order_items_guard_update();

-- One order_events row per changed tracked column (status, woo_status, confirm, deposit, note, cancel, ret; a
-- customer_phone change as kind 'phone' without values), then a returns row for a cancel / refund with a reason.
-- source 'user' when auth.uid() is set, else 'woo'. Definer: the API roles have no insert on either table.
create function public.orders_log_events() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  src text := case when uid is null then 'woo' else 'user' end;
  k text;
  j jsonb;
  d date;
begin
  insert into public.order_events (order_id, actor, source, kind, old_value, new_value)
  select new.id, uid, src, e.kind, e.old_value, e.new_value
  from (values
          ('status',     old.status,        new.status),
          ('woo_status', old.woo_status,    new.woo_status),
          ('confirm',    old.confirm,       new.confirm),
          ('deposit',    old.deposit::text, new.deposit::text),
          ('note',       old.note,          new.note),
          ('cancel',     old.cancel::text,  new.cancel::text),
          ('ret',        old.ret::text,     new.ret::text)
       ) as e (kind, old_value, new_value)
  where e.old_value is distinct from e.new_value;

  if new.customer_phone is distinct from old.customer_phone then
    insert into public.order_events (order_id, actor, source, kind) values (new.id, uid, src, 'phone');
  end if;

  if new.status = 'ملغي' and coalesce(btrim(new.cancel ->> 'reason'), '') <> ''
     and (old.status is distinct from new.status or coalesce(btrim(old.cancel ->> 'reason'), '') = '') then
    k := 'order_cancel';
    j := new.cancel;
  elsif new.status = 'استرجاع' and coalesce(btrim(new.ret ->> 'reason'), '') <> ''
     and (old.status is distinct from new.status or coalesce(btrim(old.ret ->> 'reason'), '') = '') then
    k := 'order_refund';
    j := new.ret;
  end if;
  if k is not null then
    begin
      d := (j ->> 'date')::date;
    exception when others then
      d := null; -- a missing or malformed date never blocks the status change
    end;
    insert into public.returns (order_id, kind, reason, note, on_date, by_user)
    values (new.id, k, j ->> 'reason', j ->> 'note', d, uid);
  end if;
  return null;
end
$$;

create trigger orders_log_events after update on public.orders
  for each row execute function public.orders_log_events();

-- Lines: item_status, item_expected_at, item_waybill, item_pulled; a returns row when a line becomes
-- «مرتجع للمخزن» / «مرتجع للمورد» with item ret carrying a reason.
create function public.order_items_log_events() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  src text := case when uid is null then 'woo' else 'user' end;
  d date;
begin
  insert into public.order_events (order_id, item_id, actor, source, kind, old_value, new_value)
  select new.order_id, new.id, uid, src, e.kind, e.old_value, e.new_value
  from (values
          ('item_status',      old.status,                             new.status),
          ('item_expected_at', to_char(old.expected_at, 'YYYY-MM-DD'), to_char(new.expected_at, 'YYYY-MM-DD')),
          ('item_waybill',     old.waybill::text,                      new.waybill::text),
          ('item_pulled',      old.pulled::text,                       new.pulled::text)
       ) as e (kind, old_value, new_value)
  where e.old_value is distinct from e.new_value;

  if new.status in ('مرتجع للمخزن', 'مرتجع للمورد') and coalesce(btrim(new.ret ->> 'reason'), '') <> ''
     and (old.status is distinct from new.status or coalesce(btrim(old.ret ->> 'reason'), '') = '') then
    begin
      d := (new.ret ->> 'date')::date;
    exception when others then
      d := null;
    end;
    insert into public.returns (order_id, item_id, kind, reason, note, on_date, by_user)
    values (new.order_id, new.id,
            case new.status when 'مرتجع للمخزن' then 'item_to_stock' else 'item_to_vendor' end,
            new.ret ->> 'reason', new.ret ->> 'note', d, uid);
  end if;
  return null;
end
$$;

create trigger order_items_log_events after update on public.order_items
  for each row execute function public.order_items_log_events();

revoke execute on function public.mask_phone(text) from public, anon;
revoke execute on function public.order_customer_phone(bigint) from public, anon;
revoke execute on function public.orders_guard_update() from public, anon, authenticated;
revoke execute on function public.order_items_guard_update() from public, anon, authenticated;
revoke execute on function public.orders_log_events() from public, anon, authenticated;
revoke execute on function public.order_items_log_events() from public, anon, authenticated;
grant execute on function public.mask_phone(text) to authenticated, service_role;
grant execute on function public.order_customer_phone(bigint) to authenticated, service_role;

-- ---------------------------------------------------------------- view

-- Every orders column, customer_phone masked unless sensitive.customer_phone = F. The adapter reads orders only here.
create view public.orders_v with (security_invoker = true) as
select o.id, o.number, o.customer_name,
       public.order_customer_phone(o.id) as customer_phone,
       o.customer_city, o.customer_address, o.payment_method, o.payment_title, o.status, o.woo_status,
       o.confirm, o.confirm_at, o.confirm_note, o.deposit, o.total, o.currency, o.note, o.customer_note,
       o.placed_at, o.woo_updated_at, o.cancel, o.ret, o.raw, o.synced_at, o.created_at, o.updated_at
from public.orders o;

-- ---------------------------------------------------------------- policies

-- vendors: read with vendors.view; write as admin or with vendors.edit = F.
create policy vendors_select on public.vendors for select to authenticated
  using ((select public.has_perm('vendors.view')) <> 'N');
create policy vendors_insert on public.vendors for insert to authenticated
  with check ((select public.is_admin()) or (select public.has_perm('vendors.edit')) = 'F');
create policy vendors_update on public.vendors for update to authenticated
  using ((select public.is_admin()) or (select public.has_perm('vendors.edit')) = 'F')
  with check ((select public.is_admin()) or (select public.has_perm('vendors.edit')) = 'F');
create policy vendors_delete on public.vendors for delete to authenticated
  using ((select public.is_admin()) or (select public.has_perm('vendors.edit')) = 'F');

-- products: read with orders.view; writes admin (the sync writes as service_role).
create policy products_select on public.products for select to authenticated
  using ((select public.has_perm('orders.view')) <> 'N');
create policy products_insert on public.products for insert to authenticated
  with check ((select public.is_admin()));
create policy products_update on public.products for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy products_delete on public.products for delete to authenticated
  using ((select public.is_admin()));

-- orders / order_items: read with orders.view; update with orders.status = F or orders.edit <> N (columns decided
-- by the guard triggers; see the header for why `using` is orders.view); insert / delete admin.
create policy orders_select on public.orders for select to authenticated
  using ((select public.has_perm('orders.view')) <> 'N');
create policy orders_update on public.orders for update to authenticated
  using ((select public.has_perm('orders.view')) <> 'N')
  with check ((select public.has_perm('orders.status')) = 'F' or (select public.has_perm('orders.edit')) <> 'N');
create policy orders_insert on public.orders for insert to authenticated
  with check ((select public.is_admin()));
create policy orders_delete on public.orders for delete to authenticated
  using ((select public.is_admin()));

create policy order_items_select on public.order_items for select to authenticated
  using ((select public.has_perm('orders.view')) <> 'N');
create policy order_items_update on public.order_items for update to authenticated
  using ((select public.has_perm('orders.view')) <> 'N')
  with check ((select public.has_perm('orders.status')) = 'F' or (select public.has_perm('orders.edit')) <> 'N');
create policy order_items_insert on public.order_items for insert to authenticated
  with check ((select public.is_admin()));
create policy order_items_delete on public.order_items for delete to authenticated
  using ((select public.is_admin()));

-- sub_orders / order_events / returns: read with orders.view; insert / delete admin (no update policy).
create policy sub_orders_select on public.sub_orders for select to authenticated
  using ((select public.has_perm('orders.view')) <> 'N');
create policy sub_orders_insert on public.sub_orders for insert to authenticated
  with check ((select public.is_admin()));
create policy sub_orders_delete on public.sub_orders for delete to authenticated
  using ((select public.is_admin()));

create policy order_events_select on public.order_events for select to authenticated
  using ((select public.has_perm('orders.view')) <> 'N');
create policy order_events_insert on public.order_events for insert to authenticated
  with check ((select public.is_admin()));
create policy order_events_delete on public.order_events for delete to authenticated
  using ((select public.is_admin()));

create policy returns_select on public.returns for select to authenticated
  using ((select public.has_perm('orders.view')) <> 'N');
create policy returns_insert on public.returns for insert to authenticated
  with check ((select public.is_admin()));
create policy returns_delete on public.returns for delete to authenticated
  using ((select public.is_admin()));

-- woo_webhook_events / woo_sync_log / sync_state: read with settings.view; written by service_role only.
create policy woo_webhook_events_select on public.woo_webhook_events for select to authenticated
  using ((select public.has_perm('settings.view')) <> 'N');
create policy woo_sync_log_select on public.woo_sync_log for select to authenticated
  using ((select public.has_perm('settings.view')) <> 'N');
create policy sync_state_select on public.sync_state for select to authenticated
  using ((select public.has_perm('settings.view')) <> 'N');

-- ---------------------------------------------------------------- grants (rule 4: explicit, see 0004_grants)

-- orders: every column but customer_phone is readable (orders_v serves the phone, masked as needed);
-- update on the table, the guard trigger decides the columns.
grant select (id, number, customer_name, customer_city, customer_address, payment_method, payment_title,
              status, woo_status, confirm, confirm_at, confirm_note, deposit, total, currency, note,
              customer_note, placed_at, woo_updated_at, cancel, ret, raw, synced_at, created_at, updated_at)
  on public.orders to authenticated;
grant update on public.orders to authenticated;
grant select, update on public.order_items to authenticated;
grant select on public.sub_orders, public.order_events, public.returns, public.products, public.vendors,
  public.orders_v, public.woo_webhook_events, public.woo_sync_log, public.sync_state
  to authenticated;
-- vendors: the policies decide (admin or vendors.edit = F).
grant insert, update, delete on public.vendors to authenticated;

grant select, insert, update, delete on
  public.vendors, public.products, public.orders, public.sub_orders, public.order_items, public.order_events,
  public.returns, public.woo_webhook_events, public.woo_sync_log, public.sync_state
  to service_role;
grant select on public.orders_v to service_role;

revoke truncate, references, trigger on
  public.vendors, public.products, public.orders, public.sub_orders, public.order_items, public.order_events,
  public.returns, public.woo_webhook_events, public.woo_sync_log, public.sync_state, public.orders_v
  from anon, authenticated, service_role;

-- bigserial ids written by the sync (order_events / returns are written by the definer triggers).
grant usage, select on sequence
  public.sub_orders_id_seq, public.order_events_id_seq, public.returns_id_seq,
  public.woo_webhook_events_id_seq, public.woo_sync_log_id_seq
  to service_role;

-- ---------------------------------------------------------------- status_map: the nine system statuses

-- Screen order (block 29 ST): قيد الانتظار، جاري التنفيذ، معلّق، جاهز للشحن، قيد الشحن، تم RTC، مكتمل، استرجاع، ملغي.
-- Phase-0 rows are renamed / re-slugged in place; the three new ones are inserted. تم RTC has no Woo status: it is
-- never pushed and never arrives (direction from_system).
update public.status_map set system_status = 'استرجاع'
where system_status = 'مرتجع'
  and not exists (select 1 from public.status_map where system_status = 'استرجاع');

update public.status_map m
set woo_status = v.woo_status, direction = v.direction, sort = v.sort
from (values
  ('جاري التنفيذ', 'processing',  'both', 2),
  ('معلّق',        'on-hold',     'both', 3),
  ('قيد الشحن',    'in-shipping', 'both', 5),
  ('مكتمل',        'completed',   'both', 7),
  ('استرجاع',      'refunded',    'both', 8),
  ('ملغي',         'cancelled',   'both', 9)
) as v (system_status, woo_status, direction, sort)
where m.system_status = v.system_status;

insert into public.status_map (system_status, woo_status, direction, sort) values
  ('قيد الانتظار', 'pending',        'both',        1),
  ('جاهز للشحن',   'ready-shipping', 'both',        4),
  ('تم RTC',       null,             'from_system', 6)
on conflict (system_status) do nothing;

-- ---------------------------------------------------------------- Realtime on orders, order_items, sub_orders (guarded)

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['orders', 'order_items', 'sub_orders'] loop
      if not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
