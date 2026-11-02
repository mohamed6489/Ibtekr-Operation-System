-- 0033_order_delete — phase 5.5 decision 10 (the owner, 2 Nov): «مسح» on the orders page for a cancelled order only. The row
-- stays (an order is never deleted: lines, sub-orders, ratings and the activity log point at it) — deleted_at / deleted_by /
-- delete_reason are set by RPC order_delete, and orders_v leaves a deleted order out, so every member screen loses it (the
-- orders page, the dashboard, the search). The sync (service_role, woo-write ORDER_COLUMNS) never touches these columns, so a
-- later WooCommerce update does not bring the order back; accounts_sales / products_report keep counting it in their cancelled
-- bucket (a cancelled order has no sales). Permission: orders.status = F (the permission that cancels), the order visible
-- (orders.view) and «ملغي»; the reason is required (1–120 characters). Re-runnable.

alter table public.orders
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles (id) on delete set null,
  add column if not exists delete_reason text;

alter table public.orders drop constraint if exists orders_delete_reason_check;
alter table public.orders add constraint orders_delete_reason_check
  check (delete_reason is null or char_length(delete_reason) between 1 and 120);

-- rule 4: explicit grants. Members read the three columns (the view's where clause reads deleted_at as the invoker); only the
-- RPC writes them (security definer); the sync may read / write them like any order column.
grant select (deleted_at, deleted_by, delete_reason) on public.orders to authenticated;
grant select (deleted_at, deleted_by, delete_reason), insert (deleted_at, deleted_by, delete_reason), update (deleted_at, deleted_by, delete_reason) on public.orders to service_role;

-- The 0010 view, column for column, without deleted orders.
create or replace view public.orders_v with (security_invoker = true) as
select o.id, o.number, o.customer_name,
       public.order_customer_phone(o.id) as customer_phone,
       o.customer_city, o.customer_address, o.payment_method, o.payment_title, o.status, o.woo_status,
       o.confirm, o.confirm_at, o.confirm_note, o.deposit, o.total, o.currency, o.note, o.customer_note,
       o.placed_at, o.woo_updated_at, o.cancel, o.ret, o.synced_at, o.created_at, o.updated_at,
       o.customer_state
from public.orders o
where o.deleted_at is null;

grant select on public.orders_v to authenticated, service_role;

-- Definer: the guard trigger (0007) refuses any column outside the status / edit sets for a member, so the mark is written here
-- with the same checks the guard would make. 42501 without orders.status = F; P0002 when the order is not visible, unknown or
-- already deleted; 22023 when it is not «ملغي» or the reason is empty / over 120 characters.
create or replace function public.order_delete(p_order bigint, p_reason text)
returns bigint language plpgsql volatile security definer set search_path = public as $$
declare
  v_status text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if public.has_perm('orders.view') = 'N' then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if public.has_perm('orders.status') <> 'F' then
    raise exception 'orders.status = F is required to delete a cancelled order' using errcode = '42501';
  end if;
  if v_reason is null or char_length(v_reason) > 120 then
    raise exception 'a delete reason of 1 to 120 characters is required' using errcode = '22023';
  end if;
  select o.status into v_status from public.orders o where o.id = p_order and o.deleted_at is null;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if v_status <> 'ملغي' then
    raise exception 'only a cancelled order can be deleted' using errcode = '22023';
  end if;
  update public.orders set deleted_at = now(), deleted_by = auth.uid(), delete_reason = v_reason where id = p_order;
  return p_order;
end $$;
revoke execute on function public.order_delete(bigint, text) from public, anon;
grant execute on function public.order_delete(bigint, text) to authenticated, service_role;
