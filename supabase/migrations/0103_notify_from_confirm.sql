-- 0103: the confirmation date fills «تاريخ تبليغ المبتكر» by itself (the owner 15 Nov: «خلّي تاريخ التأكيد يتضاف أوتوماتيك في تاريخ
-- تبليغ الفيندر للأوردرات الفرعية»). A line's notify date is order_items.expected_at (decision 52); it now takes its order's
-- confirmation date (orders.confirm_at):
-- 1. the order confirmed — confirm_at set or moved: its lines with no notify date, and those still on the old confirmation date
--    (the ones this rule filled), take the new date; a date set by hand to another day stays; confirm_at cleared changes nothing;
-- 2. a line that reaches an order already confirmed (the sync, «إضافة منتج» — line_add) with no notify date takes it;
-- 3. once: the lines of the open orders already confirmed (not completed / cancelled / refunded / failed, not deleted) with no
--    notify date take it — written without a history row (order_events would name the site as the author of a change it
--    never made).
-- A line pulled from Ibtekr's stock (pulled) has no maker to notify and is left as it is, and a removed line too. The change of
-- (1) is recorded in order_events as any line change (the member who confirmed). The sync never writes expected_at (woo-write
-- ITEM_COLUMNS), so a date set here or by hand is never overwritten. Depends on 0007 (orders / order_items / the line
-- triggers), 0018 (order_items_log_events), 0033 (orders.deleted_at).

-- 1. the order confirmed → its lines
create or replace function public.orders_notify_from_confirm() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.confirm_at is not null and new.confirm_at is distinct from old.confirm_at then
    update public.order_items
       set expected_at = new.confirm_at
     where order_id = new.id and removed = false and pulled = false
       and (expected_at is null or (old.confirm_at is not null and expected_at = old.confirm_at));
  end if;
  return null;
end $$;
revoke execute on function public.orders_notify_from_confirm() from public, anon, authenticated;
drop trigger if exists orders_notify_from_confirm on public.orders;
create trigger orders_notify_from_confirm after update of confirm_at on public.orders
  for each row execute function public.orders_notify_from_confirm();

-- 2. a new line of a confirmed order
create or replace function public.order_items_notify_default() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.expected_at is null and coalesce(new.pulled, false) = false and coalesce(new.removed, false) = false then
    select o.confirm_at into new.expected_at from public.orders o where o.id = new.order_id;
  end if;
  return new;
end $$;
revoke execute on function public.order_items_notify_default() from public, anon, authenticated;
drop trigger if exists order_items_notify_default on public.order_items;
create trigger order_items_notify_default before insert on public.order_items
  for each row execute function public.order_items_notify_default();

-- 3. the open orders confirmed already (once; the history trigger off for this one fill only)
alter table public.order_items disable trigger order_items_log_events;
update public.order_items i
   set expected_at = o.confirm_at
  from public.orders o
 where o.id = i.order_id and o.confirm_at is not null and o.deleted_at is null
   and o.status not in ('مكتمل', 'ملغي', 'استرجاع', 'فشل')
   and i.expected_at is null and i.removed = false and i.pulled = false;
alter table public.order_items enable trigger order_items_log_events;
