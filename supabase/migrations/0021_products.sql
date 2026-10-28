-- 0021_products: the products page, records + edit (phase 5). Uses roles (0001/0003), has_perm (0008), products (0007,
-- 0009). The plan: docs/superpowers/plans/2026-10-28-phase-5-products.md.
--
-- Decision 3: three permission keys — products.view (the page), products.edit (edit, bulk edit, publish) and
--   products.trash (to the trash and back). Built-in roles get their defaults only when the key is missing (the admin is
--   F through has_perm). Reading products: orders.view <> N (the orders screen, as before) or products.view <> N.
-- Decision 4: the mirror columns woo-write's mapProduct fills (WPML lang + translation ids, prices, stock, sales,
--   categories, brands, images, weight, flags, the site's modified time, when it went to the trash). Members never
--   write products: every change goes through woo-sync (service_role) and comes back from WooCommerce.
--
-- Notes for readers:
-- * Re-runnable: add column if not exists, the role defaults merged only when absent, the select policy dropped and
--   created again (same name). No delete / truncate.
-- * rule 4: products keeps its grants (0007 / 0009: select for authenticated, DML for service_role); the new columns
--   carry nothing personal (public product data; images are the site's public URLs).

-- ---------------------------------------------------------------- permission keys (decision 3)

update public.roles r set permissions = d.perms || r.permissions
from (values
  ('ops',              '{"products.view":"F","products.edit":"F","products.trash":"N"}'::jsonb),
  ('cs',               '{"products.view":"F","products.edit":"N","products.trash":"N"}'::jsonb),
  ('accounts',         '{"products.view":"F","products.edit":"N","products.trash":"N"}'::jsonb),
  ('vendors_followup', '{"products.view":"F","products.edit":"N","products.trash":"N"}'::jsonb),
  ('viewer',           '{"products.view":"F","products.edit":"N","products.trash":"N"}'::jsonb),
  ('admin',            '{"products.view":"F","products.edit":"F","products.trash":"F"}'::jsonb)
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
alter table public.products add column if not exists images jsonb;
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
