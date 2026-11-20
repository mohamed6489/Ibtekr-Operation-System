-- 0147 — orders_v appends bosta_district (0146). The orders page reads it from the view (the area «تعديل العنوان» preselects); 0146
-- added the column to orders only, so the page's select failed («معرفناش نحمّل الأوردرات») until this (live 20 Nov). create or replace
-- can only append, so the 0007 … 0144 columns stay in their order.
create or replace view public.orders_v with (security_invoker = true) as
 SELECT id, number, customer_name, order_customer_phone(id) AS customer_phone, customer_city, customer_address, payment_method, payment_title,
    status, woo_status, confirm, confirm_at, confirm_note, deposit, total, currency, note, customer_note, placed_at, woo_updated_at,
    cancel, ret, synced_at, created_at, updated_at, customer_state, bosta_tracking, bosta_state, bosta_delivery, bosta_cod, bosta_cod_error,
    bosta_district
   FROM orders o
  WHERE deleted_at IS NULL;
grant select on public.orders_v to authenticated;
