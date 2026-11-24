-- 0159 — the customer made from an order never refuses the order (the meeting of 23 Nov phase 9 — the old orders' import, 24 Nov): the
-- trigger orders_cs_customer (0034) wrote the order's name / city / address / governorate as they came, and cs_customers' checks
-- (name ≤ 120, city ≤ 120, address ≤ 300, province ≤ 40, phone 6–15 digits) refused the whole order when one was longer or the phone
-- odd — seen live on old site orders (a long address). Now each text is cut to its column's length, and a phone the customers' table
-- cannot hold makes no customer (the order is written all the same) — for every order, the sync's and the webhook's too.
create or replace function public.cs_customer_from_order() returns trigger
language plpgsql security definer set search_path = public as $$
declare p text := public.norm_phone(new.customer_phone);
begin
  if p = '' or p !~ '^\d{6,15}$' then return new; end if;
  insert into public.cs_customers (phone, name, city, address, province, created_from, created_by)
  values (p, left(coalesce(nullif(btrim(new.customer_name), ''), 'عميل'), 120), left(nullif(btrim(new.customer_city), ''), 120),
          left(nullif(btrim(new.customer_address), ''), 300), left(nullif(btrim(new.customer_state), ''), 40), 'orders', null)
  on conflict (phone) do update set
    city = coalesce(public.cs_customers.city, excluded.city),
    address = coalesce(public.cs_customers.address, excluded.address),
    province = coalesce(public.cs_customers.province, excluded.province);
  return new;
end $$;
revoke execute on function public.cs_customer_from_order() from public, anon, authenticated;
