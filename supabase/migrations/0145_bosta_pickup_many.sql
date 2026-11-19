-- 0145 — a maker pickup with several waybills (the owner 19 Nov: «لما بعمل بيك اب ممكن ابعتله اكتر من بوليصة … بوليصات بتجيلي المخزن و
-- بتبقي بتحصيل صفر و فيه بوليصات بتطلع للعميل علطول»; answers: the orders to the customer by their numbers typed, the warehouse waybills
-- each with its own note — the order numbers coming — and its cartons; plan docs/superpowers/plans/2026-11-19-orders-batch.md decision 18).
-- bosta_pickups.deliveries — every waybill of the pickup: [{ kind: 'warehouse' | 'order', order_id?, note?, delivery, tracking, error? }]
-- (the server's, like the row). delivery_id / tracking stay the first one's (0144 readers); note / parcels the first warehouse row's.
alter table public.bosta_pickups add column if not exists deliveries jsonb not null default '[]'::jsonb;
alter table public.bosta_pickups drop constraint if exists bosta_pickups_receiver_name_check;
alter table public.bosta_pickups alter column receiver_name drop not null;
alter table public.bosta_pickups add constraint bosta_pickups_receiver_name_check check (receiver_name is null or char_length(receiver_name) between 2 and 60);
