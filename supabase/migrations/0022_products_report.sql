-- 0022_products_report: the «التقارير» tab of the products page (phase 5.1, plan decision 20). Uses has_perm (0008),
-- orders / order_items (0007, 0018), products (0021). The plan: docs/superpowers/plans/2026-10-28-phase-5-products.md.
--
-- products_report(p_from, p_to) → jsonb, read with products.view <> N (security definer: a products-only member reads
-- order lines through it as totals only — no customer, no order number, no address):
--   orders   — our orders placed in the range (placed_at as a Cairo date) that are not «ملغي» / «استرجاع» / «فشل»
--   qty, revenue, distinct — the pieces, the line totals and the number of products sold in them (removed lines left out)
--   top      — the 20 best sellers: { key, name, skus, vendor_id, qty, orders, revenue }, by pieces, then revenue, then name.
--              key = the record's product id: a line on the Arabic translation (WPML) counts under its English product
--              (translation_ids.en); a line whose product is not mirrored keeps its own product_id, and one with none
--              groups by its name (key null).
--   cats     — every category of the products sold: { id, sold, revenue, orders, products } (the record product's
--              category_ids; a product in several categories counts in each, like WooCommerce's categories report).
--
-- Notes for readers:
-- * Re-runnable (create or replace). No table, no row written.
-- * rule 4: execute for authenticated and service_role only (revoked from public / anon).

create or replace function public.products_report(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb;
begin
  if coalesce(public.has_perm('products.view'), 'N') = 'N' then
    raise exception 'products.view is needed' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 3700 then
    raise exception 'the range is from <= to, at most ten years' using errcode = '22023';
  end if;
  with o as (
    select x.id from public.orders x
    where (x.placed_at at time zone 'Africa/Cairo')::date between p_from and p_to
      and x.status not in ('ملغي', 'استرجاع', 'فشل')
  ), l as (
    select i.order_id, i.qty, i.total, i.name, nullif(btrim(i.sku), '') as sku, i.vendor_id,
           coalesce(case when p.lang = 'ar' and (p.translation_ids ->> 'en') ~ '^[0-9]{1,18}$' then (p.translation_ids ->> 'en')::bigint end,
                    i.product_id) as key
    from o join public.order_items i on i.order_id = o.id and not i.removed
    left join public.products p on p.id = i.product_id
  ), g as (
    select max(l.key) as key, min(l.name) as name,
           coalesce(array_agg(distinct l.sku) filter (where l.sku is not null), '{}') as skus,
           (array_agg(l.vendor_id) filter (where l.vendor_id is not null))[1] as vendor_id,
           sum(l.qty) as qty, count(distinct l.order_id) as orders, round(sum(l.total), 2) as revenue
    from l group by coalesce(l.key::text, 'n:' || lower(btrim(l.name)))
  ), c as (
    select cid as id, sum(l.qty) as sold, round(sum(l.total), 2) as revenue, count(distinct l.order_id) as orders, count(distinct l.key) as products
    from l join public.products rp on rp.id = l.key cross join lateral unnest(rp.category_ids) as cid
    group by cid
  )
  select jsonb_build_object(
    'orders', (select count(*) from o),
    'qty', coalesce((select sum(qty) from l), 0),
    'revenue', coalesce((select round(sum(total), 2) from l), 0),
    'distinct', (select count(*) from g),
    'top', coalesce((select jsonb_agg(to_jsonb(t)) from (select * from g order by g.qty desc, g.revenue desc, g.name limit 20) t), '[]'::jsonb),
    'cats', coalesce((select jsonb_agg(to_jsonb(c) order by c.sold desc, c.revenue desc) from c), '[]'::jsonb))
  into v;
  return v;
end $$;
revoke execute on function public.products_report(date, date) from public, anon;
grant execute on function public.products_report(date, date) to authenticated, service_role;
