-- 0142 — «ابعت لبوسطة» from the system (the owner 19 Nov; plan docs/superpowers/plans/2026-11-19-orders-batch.md decision 9):
-- woo-sync bosta_send writes the tracking number and Bosta's state on the order here (orders.bosta_tracking / bosta_state) and
-- never on the site (a parent order with sub-orders is split again by Dokan when written — 0079). So the sync's next copy of the
-- order (no bosta meta on the site) must not wipe them: 0140's trigger keeps the value it has when the site's order carries none;
-- the site's own value (an order sent by the plugin there) still wins when there is one.

create or replace function public.orders_bosta_set() returns trigger
language plpgsql set search_path = public as $$
begin
  new.bosta_tracking := coalesce(public.order_meta_text(new.raw, 'bosta_tracking_number'), case when tg_op = 'UPDATE' then old.bosta_tracking end);
  new.bosta_state := coalesce(public.order_meta_text(new.raw, 'bosta_status'), case when tg_op = 'UPDATE' then old.bosta_state end);
  return new;
end $$;
revoke execute on function public.orders_bosta_set() from public, anon, authenticated;
grant execute on function public.orders_bosta_set() to service_role;
