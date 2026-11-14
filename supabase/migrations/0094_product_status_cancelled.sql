-- 0094_product_status_cancelled: «حالة المنتج» takes «ملغي», set by itself when the order or the maker's sub-order is cancelled; a
-- product the system added to a Dokan sub-order stays although the site's parent order never lists it (the owner, 14 Nov 2026 — the
-- plan docs/superpowers/plans/2026-11-14-order-edit-tabs.md, decisions 1, 2 and 6). Uses 0007, 0018, 0079.
--
-- * order_items.status (the team's «حالة المنتج») accepts 'ملغي' — chosen by hand too.
-- * orders.status becomes 'ملغي' (the page, the bulk bar, the assistant, the sync from the site) → every line of the order still on
--   it (not removed) becomes 'ملغي'; sub_orders.woo_status becomes 'cancelled' (woo-sync suborder_status / push_status, or the sync
--   from the site) → the lines of that sub-order become 'ملغي'. A line already returned ('مرتجع للمخزن' / 'مرتجع للمبتكر' — its
--   `returns` row stands) keeps its status. Nothing else follows: «استرجاع» on the site changes no line, and the order itself never
--   changes because its sub-orders were cancelled (the owner's answers). The functions run as their owner, so the 0007 member guard
--   is not in the way; the 0018 event trigger still records each line's change with the member who cancelled (auth.uid()).
-- * order_items.added_at (server only — no member grant): woo-sync line_add puts a product on a Dokan sub-order only (the parent of an
--   order with sub-orders is never written — 0079); the sync, which reads the parent's lines, would flag that line removed, so
--   order_items_keep_added keeps it on unless it is dropped on purpose (dropped_at, line_trash).
-- Re-runnable.

-- 1. the status check (named in 0018) with 'ملغي'
alter table public.order_items drop constraint if exists order_items_status_check;
alter table public.order_items add constraint order_items_status_check
  check (status in ('', 'غير مؤكد', 'مؤكد', 'قيد التنفيذ', 'جاهز للشحن من المبتكر للعميل',
                    'جاهز للشحن من المخزن للعميل', 'جاهز للشحن من المبتكر للمخزن', 'تم الشحن للمخزن',
                    'وصل المخزن', 'تم الشحن للعميل', 'مرتجع للمخزن', 'مرتجع للمبتكر', 'ملغي'));

-- 2. the order cancelled → its lines
create or replace function public.orders_cancel_lines() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'ملغي' and old.status is distinct from new.status then
    update public.order_items
       set status = 'ملغي'
     where order_id = new.id and removed = false
       and status not in ('ملغي', 'مرتجع للمخزن', 'مرتجع للمبتكر');
  end if;
  return null;
end $$;
revoke execute on function public.orders_cancel_lines() from public, anon, authenticated;
drop trigger if exists orders_cancel_lines on public.orders;
create trigger orders_cancel_lines after update of status on public.orders
  for each row execute function public.orders_cancel_lines();

-- 3. the maker's sub-order cancelled on the site → its lines
create or replace function public.sub_orders_cancel_lines() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.woo_status = 'cancelled' and old.woo_status is distinct from new.woo_status then
    update public.order_items
       set status = 'ملغي'
     where sub_order_id = new.id and removed = false
       and status not in ('ملغي', 'مرتجع للمخزن', 'مرتجع للمبتكر');
  end if;
  return null;
end $$;
revoke execute on function public.sub_orders_cancel_lines() from public, anon, authenticated;
drop trigger if exists sub_orders_cancel_lines on public.sub_orders;
create trigger sub_orders_cancel_lines after update of woo_status on public.sub_orders
  for each row execute function public.sub_orders_cancel_lines();

-- 4. a line added to a sub-order by the system stays (the sync never sees it in the parent)
alter table public.order_items add column if not exists added_at timestamptz;

create or replace function public.order_items_keep_added() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.added_at is not null and new.removed and new.dropped_at is null then
    new.removed := false;
  end if;
  new.added_at := coalesce(old.added_at, new.added_at);
  return new;
end $$;
revoke execute on function public.order_items_keep_added() from public, anon, authenticated;
drop trigger if exists order_items_keep_added on public.order_items;
create trigger order_items_keep_added before update on public.order_items
  for each row execute function public.order_items_keep_added();
