-- 0079_order_items_dropped: a product taken off a multi-maker order stays off here although the site's parent order keeps it
-- (the owner, 11 Nov 2026 — «زي الـ automation»; the plan docs/superpowers/plans/2026-11-11-dokan-resplit.md). Uses 0007.
--
-- Why: Dokan deletes and recreates the sub-orders of a multi-vendor parent order whenever that parent is updated through the
-- WooCommerce REST API (getdokan/dokan PR #3454 — open), so the sub-orders got new numbers each time the system wrote the parent.
-- From now on the system never writes the parent of an order that has sub-orders: the status goes to each sub-order (woo-sync
-- push_status), and «مسح الأوردر الفرعي» / «مسح المنتج» take the products off the sub-order only. The parent on the site keeps those
-- lines, so the sync would bring them back (it upserts every line of the parent with removed = false): a line the system took off is
-- stamped dropped_at (the server, woo-sync suborder_trash / line_trash) and this trigger keeps it removed whatever the sync writes.
--
-- Members never read nor write dropped_at (no column grant; the 0007 guard refuses any non-status column). Re-runnable.

alter table public.order_items add column if not exists dropped_at timestamptz;

create or replace function public.order_items_keep_dropped() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.dropped_at is not null then
    new.removed := true;
  end if;
  return new;
end $$;
revoke execute on function public.order_items_keep_dropped() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'order_items_keep_dropped' and tgrelid = 'public.order_items'::regclass) then
    create trigger order_items_keep_dropped before insert or update on public.order_items for each row execute function public.order_items_keep_dropped();
  end if;
end $$;
