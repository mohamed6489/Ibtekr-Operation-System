-- 0076 — phase 13 decision 52 (owner 10 Nov — «التأخير للأوردر الفرعي = تاريخ إبلاغ المبتكر + أيام التصنيع للمنتج»; the answer
-- «Maker + product override»): a product's own making days, over the maker's «مدة التجهيز» (vendors.lead_days). Re-runnable.
-- * product_lead_days (product_id = the WooCommerce product, as order_items.product_id, days 1–90): read by any member who sees
--   orders, products or makers; written by the admin or products.edit = F. updated_by / updated_at from the server (the trigger).
--   No row = the maker's days.

create table if not exists public.product_lead_days (
  product_id bigint primary key check (product_id > 0),
  days int not null check (days between 1 and 90),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.product_lead_days enable row level security;

create or replace function public.product_lead_days_stamp() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_by := auth.uid(); new.updated_at := now();
  return new;
end $$;
drop trigger if exists product_lead_days_stamp on public.product_lead_days;
create trigger product_lead_days_stamp before insert or update on public.product_lead_days
  for each row execute function public.product_lead_days_stamp();

drop policy if exists product_lead_days_select on public.product_lead_days;
create policy product_lead_days_select on public.product_lead_days for select to authenticated
  using ((select public.has_perm('orders.view')) <> 'N' or (select public.has_perm('products.view')) <> 'N' or (select public.has_perm('vendors.view')) <> 'N');
drop policy if exists product_lead_days_insert on public.product_lead_days;
create policy product_lead_days_insert on public.product_lead_days for insert to authenticated
  with check ((select public.is_admin()) or (select public.has_perm('products.edit')) = 'F');
drop policy if exists product_lead_days_update on public.product_lead_days;
create policy product_lead_days_update on public.product_lead_days for update to authenticated
  using ((select public.is_admin()) or (select public.has_perm('products.edit')) = 'F')
  with check ((select public.is_admin()) or (select public.has_perm('products.edit')) = 'F');
drop policy if exists product_lead_days_delete on public.product_lead_days;
create policy product_lead_days_delete on public.product_lead_days for delete to authenticated
  using ((select public.is_admin()) or (select public.has_perm('products.edit')) = 'F');

grant select, insert, update, delete on public.product_lead_days to authenticated;
grant all on public.product_lead_days to service_role;
