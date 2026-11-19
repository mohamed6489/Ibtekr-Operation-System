-- 0146 — the order's address edited from the system (the owner 19 Nov: «ضيفلي هنا تعديل العنوان و خليه يسمع ف بوسطة و ف الويبسايت»;
-- answers: the address + governorate + area (Bosta's own list), and an order of several makers is written here and on Bosta only — the
-- parent on the site is never written (0079)). woo-sync order_address writes them (service_role); the sync never touches them after the
-- first insert (customer_address / customer_state are team-edited — woo-write TEAM_EDITED).
--   orders.bosta_district   — Bosta's area id (districtId) the team picked; the site keeps it in _billing_area
--   orders.address_set_at   — when the team set the address here: from then on Bosta's delivery reads customer_address / customer_state /
--                             bosta_district, not the site's copy of the order (deliveryOf)
alter table public.orders add column if not exists bosta_district text;
alter table public.orders add column if not exists address_set_at timestamptz;
alter table public.orders drop constraint if exists orders_bosta_district_check;
alter table public.orders add constraint orders_bosta_district_check check (bosta_district is null or bosta_district ~ '^[A-Za-z0-9_-]{1,40}$');

grant select (bosta_district, address_set_at) on public.orders to authenticated;
grant select, update (bosta_district, address_set_at) on public.orders to service_role;
