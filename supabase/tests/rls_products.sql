-- RLS / permission tests for 0021_products (the permission keys, the new mirror columns, reading products with
-- products.view). Depends on 0001_identity … 0021_products. Runs in one transaction and rolls back; prints NOTICE
-- 'rls_products: ok' only if every case passed. Live-safe: the one product row it writes has id 9990021001 and is rolled
-- back. Every name, number and phone is made up.

begin;

-- Test users (fixed UUIDs …f1–…f3): products only (view F, edit F), orders only (orders.view F, products.view N), nothing.
insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000000f1', 'prod-v.dev@ibtekr.local', '010000000f1'),
  ('00000000-0000-4000-8000-0000000000f2', 'prod-o.dev@ibtekr.local', '010000000f2'),
  ('00000000-0000-4000-8000-0000000000f3', 'prod-n.dev@ibtekr.local', '010000000f3');

insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email)
from auth.users u
where u.id in ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000f3');

insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-0000000000f1', 'منتجات بس', 'prod-v.dev@ibtekr.local', '010000000f1', 'viewer', 'active', '{"orders.view":"N","products.view":"F","products.edit":"F","vendors.view":"N"}'),
  ('00000000-0000-4000-8000-0000000000f2', 'أوردرات بس', 'prod-o.dev@ibtekr.local', '010000000f2', 'viewer', 'active', '{"orders.view":"F","products.view":"N"}'),
  ('00000000-0000-4000-8000-0000000000f3', 'من غير', 'prod-n.dev@ibtekr.local', '010000000f3', 'viewer', 'active', '{"orders.view":"N","products.view":"N","vendors.view":"N"}');

insert into public.products (id, sku, name, status, lang, translation_ids, type, regular_price, sale_price, stock_status,
  manage_stock, total_sales, category_ids, brand_ids, image_count, featured, desc_filled, short_desc_filled)
values (9990021001, 'IBTK-0021', 'منتج 0021 تجريبي', 'publish', 'en', '{"ar": 9990021002, "en": 9990021001}', 'simple',
  1000, 800, 'instock', false, 3, '{15}', '{7}', 4, false, true, true);
insert into public.woo_brands (id, name, slug) values (9990021, 'براند 0021 تجريبي', 'brand-0021');
insert into public.woo_categories (id, name, slug) values (9990021, 'قسم 0021 تجريبي', 'cat-0021');

-- ================================================================ runner: role defaults and grants

do $$ begin
  if (select permissions ->> 'products.view' from public.roles where id = 'ops') <> 'F'
     or (select permissions ->> 'products.edit' from public.roles where id = 'ops') <> 'F'
     or (select permissions ->> 'products.trash' from public.roles where id = 'ops') <> 'N'
     or (select permissions ->> 'products.edit' from public.roles where id = 'cs') <> 'N'
     or (select permissions ->> 'products.view' from public.roles where id = 'viewer') <> 'F' then
    raise exception 'case role defaults for products.* failed';
  end if;
  if has_table_privilege('authenticated', 'public.products', 'INSERT') or has_table_privilege('anon', 'public.products', 'SELECT')
     or has_table_privilege('authenticated', 'public.woo_brands', 'INSERT') or has_table_privilege('anon', 'public.woo_brands', 'SELECT')
     or not has_table_privilege('authenticated', 'public.woo_brands', 'SELECT') then
    raise exception 'case products grants (authenticated select only; anon nothing) failed';
  end if;
end $$;

-- ================================================================ products.view F, orders.view N: reads, writes nothing

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000f1","role":"authenticated"}';
do $$ declare r record; begin
  select * into r from public.products where id = 9990021001;
  if r.id is null then raise exception 'case products.view reads products failed'; end if;
  if r.lang <> 'en' or r.translation_ids ->> 'ar' <> '9990021002' or r.sale_price <> 800 or r.category_ids <> '{15}' or r.total_sales <> 3 then
    raise exception 'case the mirror columns are kept failed';
  end if;
  begin
    update public.products set sale_price = 1 where id = 9990021001;
    raise exception 'case a member (even products.edit = F) may not write products failed';
  exception when insufficient_privilege then null;
  end;
  if (select sale_price from public.products where id = 9990021001) <> 800 then raise exception 'case the price is unchanged failed'; end if;
  if not exists (select 1 from public.woo_brands where id = 9990021) or not exists (select 1 from public.woo_categories where id = 9990021) then
    raise exception 'case products.view reads woo_brands and woo_categories failed';
  end if;
  begin
    insert into public.woo_brands (id, name) values (9990022, 'x');
    raise exception 'case a member may not write woo_brands failed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ================================================================ orders.view F, products.view N: still reads (the orders screen)

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000f2","role":"authenticated"}';
do $$ begin
  if not exists (select 1 from public.products where id = 9990021001) then raise exception 'case orders.view still reads products failed'; end if;
end $$;

-- ================================================================ neither: reads nothing

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000f3","role":"authenticated"}';
do $$ begin
  if exists (select 1 from public.products where id = 9990021001) then raise exception 'case no orders.view / products.view reads no product failed'; end if;
  if exists (select 1 from public.woo_brands where id = 9990021) then raise exception 'case no products.view / vendors.view reads no brand failed'; end if;
end $$;

reset role;
do $$ begin raise notice 'rls_products: ok'; end $$;
rollback;
