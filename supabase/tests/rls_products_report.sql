-- Permission + result tests for 0022_products_report (the products page's reports tab). Depends on 0001_identity …
-- 0022_products_report. Runs in one transaction and rolls back; prints NOTICE 'rls_products_report: ok' only if every
-- case passed. Live-safe: its rows (ids 99922…, dates in 2001) are rolled back. Every name, number and phone is made up.

begin;

-- Test users (fixed UUIDs …f4–…f5): products.view F with no orders.view; nothing.
insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000000f4', 'prep-v.dev@ibtekr.local', '010000000f4'),
  ('00000000-0000-4000-8000-0000000000f5', 'prep-n.dev@ibtekr.local', '010000000f5');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email)
from auth.users u where u.id in ('00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-0000000000f5');
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-0000000000f4', 'تقارير منتجات', 'prep-v.dev@ibtekr.local', '010000000f4', 'viewer', 'active', '{"orders.view":"N","products.view":"F"}'),
  ('00000000-0000-4000-8000-0000000000f5', 'من غير', 'prep-n.dev@ibtekr.local', '010000000f5', 'viewer', 'active', '{"orders.view":"N","products.view":"N"}');

-- Lamp: English 99922001 + Arabic 99922002 (categories 99922 + 99923); Cup: 99922003 (category 99922).
insert into public.products (id, sku, name, status, lang, translation_ids, category_ids) values
  (99922001, 'LAMP-1', 'Lamp', 'publish', 'en', '{"en": 99922001, "ar": 99922002}', '{99922,99923}'),
  (99922002, 'LAMP-1', 'لمبة', 'publish', 'ar', '{"en": 99922001, "ar": 99922002}', '{99932}'),
  (99922003, 'CUP-1', 'Cup', 'publish', 'en', '{"en": 99922003}', '{99922}');
-- 3 orders in range (one cancelled), 1 out of range; a removed line; a line on the Arabic Lamp; a line with no product.
insert into public.orders (id, number, customer_name, customer_phone, status, woo_status, total, placed_at) values
  (99922101, '99922101', 'عميل تجريبي', '01000000001', 'مكتمل', 'completed', 0, '2001-02-10T09:00:00Z'),
  (99922102, '99922102', 'عميل تجريبي', '01000000002', 'قيد الشحن', 'in-shipping', 0, '2001-02-11T09:00:00Z'),
  (99922103, '99922103', 'عميل تجريبي', '01000000003', 'ملغي', 'cancelled', 0, '2001-02-12T09:00:00Z'),
  (99922104, '99922104', 'عميل تجريبي', '01000000004', 'مكتمل', 'completed', 0, '2001-03-20T09:00:00Z');
insert into public.order_items (id, order_id, product_id, sku, name, qty, total, removed) values
  (99922201, 99922101, 99922001, 'LAMP-1', 'Lamp', 2, 400, false),
  (99922202, 99922102, 99922002, 'LAMP-1', 'لمبة', 1, 200, false),
  (99922203, 99922101, 99922003, 'CUP-1', 'Cup', 1, 50, false),
  (99922204, 99922102, 99922003, 'CUP-1', 'Cup', 5, 250, true),
  (99922205, 99922102, null, null, 'Gift box', 3, 90, false),
  (99922206, 99922103, 99922003, 'CUP-1', 'Cup', 9, 450, false),
  (99922207, 99922104, 99922003, 'CUP-1', 'Cup', 9, 450, false);

do $$ begin
  if has_function_privilege('anon', 'public.products_report(date, date)', 'EXECUTE') then raise exception 'case anon may not run products_report failed'; end if;
end $$;

-- ================================================================ products.view F (no orders.view): the totals

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000f4","role":"authenticated"}';
do $$ declare r jsonb; t jsonb; begin
  r := public.products_report('2001-02-01', '2001-02-28');
  if (r ->> 'orders')::int <> 2 then raise exception 'case orders = in range, not cancelled failed (%)', r ->> 'orders'; end if;
  if (r ->> 'qty')::int <> 7 or (r ->> 'revenue')::numeric <> 740 or (r ->> 'distinct')::int <> 3 then
    raise exception 'case totals leave out removed / cancelled / out-of-range lines failed (%)', r;
  end if;
  t := r -> 'top' -> 0;
  if (t ->> 'key')::bigint <> 99922001 or (t ->> 'qty')::int <> 3 or (t ->> 'orders')::int <> 2 or (t ->> 'revenue')::numeric <> 600 or t -> 'skus' <> '["LAMP-1"]' then
    raise exception 'case the Arabic line counts under the English product failed (%)', t;
  end if;
  t := r -> 'top' -> 1;
  if t ->> 'key' is not null or t ->> 'name' <> 'Gift box' or (t ->> 'qty')::int <> 3 then raise exception 'case a line with no product groups by name failed (%)', t; end if;
  if (select count(*) from jsonb_array_elements(r -> 'cats')) <> 2
     or (select (c ->> 'sold')::int from jsonb_array_elements(r -> 'cats') c where (c ->> 'id')::int = 99922) <> 4
     or (select (c ->> 'products')::int from jsonb_array_elements(r -> 'cats') c where (c ->> 'id')::int = 99922) <> 2
     or (select (c ->> 'sold')::int from jsonb_array_elements(r -> 'cats') c where (c ->> 'id')::int = 99923) <> 3 then
    raise exception 'case categories of the record product failed (%)', r -> 'cats';
  end if;
  if r::text ~ '0100000000' or r::text ~ 'عميل' or r::text ~ '9992210' then raise exception 'case no customer or order data in the report failed'; end if;
  if (public.products_report('2001-01-01', '2001-01-31') -> 'top') <> '[]' then raise exception 'case an empty range failed'; end if;
  begin
    perform public.products_report('2001-02-28', '2001-02-01');
    raise exception 'case a reversed range is refused failed';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- ================================================================ products.view N: refused

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000f5","role":"authenticated"}';
do $$ begin
  begin
    perform public.products_report('2001-02-01', '2001-02-28');
    raise exception 'case products.view N is refused failed';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
do $$ begin raise notice 'rls_products_report: ok'; end $$;
rollback;
