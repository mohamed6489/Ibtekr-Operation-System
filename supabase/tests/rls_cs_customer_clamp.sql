-- Tests for 0159 (the meeting of 23 Nov phase 9): an order with a long address / name / city / governorate is written and its customer
-- takes each text cut to the column; an order whose phone the customers' table cannot hold is written with no customer.
-- Depends on 0001 … 0159. One transaction, rolled back; NOTICE 'rls_cs_customer_clamp: ok' only if every case passed.

begin;

insert into public.orders (id, number, customer_name, customer_phone, customer_city, customer_address, customer_state, status, woo_status, total, placed_at) values
  (99159001, '99159001', repeat('ن', 150), '01099159001', repeat('م', 130), repeat('ع', 400), repeat('ح', 60), 'مكتمل', 'completed', 100, '2026-03-02T10:00:00Z'),
  (99159002, '99159002', 'رقم غريب', '0109915900212345678', 'القاهرة', 'شارع', null, 'مكتمل', 'completed', 100, '2026-03-02T10:00:00Z');

do $$ declare c record; begin
  if (select count(*) from public.orders where id in (99159001, 99159002)) <> 2 then raise exception 'case both orders written failed'; end if;
  select * into c from public.cs_customers where phone = '01099159001';
  if c is null then raise exception 'case the customer made failed'; end if;
  if char_length(c.name) <> 120 or char_length(c.city) <> 120 or char_length(c.address) <> 300 or char_length(c.province) <> 40 then
    raise exception 'case each text cut to its column failed';
  end if;
  if exists (select 1 from public.cs_customers where phone like '0109915900212%') then raise exception 'case an odd phone makes no customer failed'; end if;
  raise notice 'rls_cs_customer_clamp: ok';
end $$;
rollback;
