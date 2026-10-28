-- 0021_products: the products page, records + edit (phase 5). Uses roles (0001/0003), has_perm (0008), products (0007,
-- 0009). The plan: docs/superpowers/plans/2026-10-28-phase-5-products.md.
--
-- Decision 3: four permission keys (the owner, 28 Oct) — products.view (the page), products.edit (one product: edit,
--   publish), products.bulk (the bulk bar: several products at once) and products.trash (to the trash and back). Built-in roles get their defaults only when the key is missing (the admin is
--   F through has_perm). Reading products: orders.view <> N (the orders screen, as before) or products.view <> N.
-- Decision 4: the mirror columns woo-write's mapProduct fills (WPML lang + translation ids, prices, stock, sales,
--   categories, brands, the number of images, weight, flags, the site's modified time, when it went to the trash). Members
--   never write products: every change goes through woo-sync (service_role) and comes back from WooCommerce. The images
--   themselves are read live by the edit page (product_get); the list keeps the first one (image_url) and the count.
-- Decision 12: product_commissions — Dokan's per-product admin commission (_per_product_admin_commission / _type /
--   _additional_fee meta), one row per mirrored product (rate null = none: the store's rate applies), written by the sync
--   only. The vendor price = the sale price − Dokan's commission (the product's own, else the store's / its category's).
--   Read with sensitive.commission = F, like vendor_rates.
-- Decision 6: woo_brands — the site's WooCommerce Brands (id, name, slug, parent_id), pulled with the categories, for the
--   brand filter and «نقل لبراند تاني». Read like woo_categories, which products.view can now read too.
--
-- Notes for readers:
-- * Re-runnable: add column if not exists, the role defaults merged only when absent, the select policy dropped and
--   created again (same name). No delete / truncate.
-- * rule 4: woo_brands and product_commissions — select for authenticated, DML for service_role, nothing for anon. products keeps its grants (0007 / 0009: select for authenticated, DML for service_role); the new columns
--   carry nothing personal (public product data; images are the site's public URLs).

-- ---------------------------------------------------------------- permission keys (decision 3)

update public.roles r set permissions = d.perms || r.permissions
from (values
  ('ops',              '{"products.view":"F","products.edit":"F","products.bulk":"F","products.trash":"N"}'::jsonb),
  ('cs',               '{"products.view":"F","products.edit":"N","products.bulk":"N","products.trash":"N"}'::jsonb),
  ('accounts',         '{"products.view":"F","products.edit":"N","products.bulk":"N","products.trash":"N"}'::jsonb),
  ('vendors_followup', '{"products.view":"F","products.edit":"N","products.bulk":"N","products.trash":"N"}'::jsonb),
  ('viewer',           '{"products.view":"F","products.edit":"N","products.bulk":"N","products.trash":"N"}'::jsonb),
  ('admin',            '{"products.view":"F","products.edit":"F","products.bulk":"F","products.trash":"F"}'::jsonb)
) as d(id, perms)
where r.id = d.id;

-- ---------------------------------------------------------------- mirror columns (decision 4)

alter table public.products add column if not exists lang text;
alter table public.products add column if not exists translation_ids jsonb;
alter table public.products add column if not exists type text;
alter table public.products add column if not exists regular_price numeric(12,2);
alter table public.products add column if not exists sale_price numeric(12,2);
alter table public.products add column if not exists stock_quantity integer;
alter table public.products add column if not exists stock_status text;
alter table public.products add column if not exists manage_stock boolean;
alter table public.products add column if not exists backorders text;
alter table public.products add column if not exists low_stock_amount integer;
alter table public.products add column if not exists total_sales integer;
alter table public.products add column if not exists category_ids bigint[];
alter table public.products add column if not exists brand_ids bigint[];
alter table public.products add column if not exists image_count integer;
alter table public.products add column if not exists weight text;
alter table public.products add column if not exists featured boolean;
alter table public.products add column if not exists desc_filled boolean;
alter table public.products add column if not exists short_desc_filled boolean;
alter table public.products add column if not exists woo_modified_at timestamptz;
alter table public.products add column if not exists trashed_at timestamptz;

create index if not exists products_lang_idx on public.products (lang);
create index if not exists products_status_idx on public.products (status);

-- ---------------------------------------------------------------- reading (decision 3)

drop policy if exists products_select on public.products;
create policy products_select on public.products for select to authenticated
  using ((select public.has_perm('orders.view')) <> 'N' or (select public.has_perm('products.view')) <> 'N');

-- ---------------------------------------------------------------- the site's brands and categories (decision 6)

create table if not exists public.woo_brands (
  id bigint primary key,
  name text not null,
  slug text,
  parent_id bigint,
  updated_at timestamptz not null default now()
);
alter table public.woo_brands enable row level security;
drop policy if exists woo_brands_select on public.woo_brands;
create policy woo_brands_select on public.woo_brands for select to authenticated
  using ((select public.has_perm('products.view')) <> 'N' or (select public.has_perm('vendors.view')) <> 'N');
grant select on public.woo_brands to authenticated;
grant select, insert, update, delete on public.woo_brands to service_role;
revoke all on public.woo_brands from anon;
revoke truncate, references, trigger on public.woo_brands from authenticated, service_role;

drop policy if exists woo_categories_select on public.woo_categories;
create policy woo_categories_select on public.woo_categories for select to authenticated
  using ((select public.has_perm('vendors.view')) <> 'N' or (select public.has_perm('products.view')) <> 'N');

-- ---------------------------------------------------------------- the product's own Dokan commission (decision 12)

create table if not exists public.product_commissions (
  product_id bigint primary key,
  rate numeric(12,2),
  type text,
  fee numeric(12,2),
  updated_at timestamptz not null default now()
);
alter table public.product_commissions enable row level security;
drop policy if exists product_commissions_select on public.product_commissions;
create policy product_commissions_select on public.product_commissions for select to authenticated
  using ((select public.has_perm('sensitive.commission')) = 'F');
grant select on public.product_commissions to authenticated;
grant select, insert, update, delete on public.product_commissions to service_role;
revoke all on public.product_commissions from anon;
revoke truncate, references, trigger on public.product_commissions from authenticated, service_role;
