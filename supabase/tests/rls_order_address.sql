-- Tests for 0146 (the owner 19 Nov — «تعديل العنوان»): a member reads the order's Bosta area and when the team set the address, but only
-- the server (woo-sync order_address) writes them; the area id is Bosta's shape. Depends on 0001 … 0146. One transaction, rolled
-- back; NOTICE 'rls_order_address: ok' only if every case passed. Live-safe: a made-up member and order with an id far from the site's.

begin;

insert into auth.users (id, email, phone) values ('00000000-0000-4000-8000-000000146a01', 'order-address.dev@ibtekr.local', '0100146a01');
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-000000146a01', 'عمليات العنوان', 'order-address.dev@ibtekr.local', '0100146a01', 'ops', 'active',
   '{"orders.view":"F","orders.status":"F","orders.edit":"F"}');
insert into public.orders (id, number, customer_name, customer_phone, status, woo_status, payment_method, total, deposit, placed_at) values
  (914601, '914601', 'عميل العنوان', '01000146001', 'جاري التنفيذ', 'processing', 'cod', 900, 0, now());
-- the server writes them (service_role / the owner)
update public.orders set bosta_district = 'dNasr-1', address_set_at = now(), customer_address = '15 شارع عباس العقاد', customer_state = 'EG-01' where id = 914601;
do $$ begin
  begin
    update public.orders set bosta_district = 'bad area!' where id = 914601;
    raise exception 'case the area id is Bosta''s shape failed';
  exception when check_violation then null;
  end;
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000146a01","role":"authenticated"}';

do $$ begin
  if (select bosta_district from public.orders where id = 914601) is distinct from 'dNasr-1' then raise exception 'case a member reads the area failed'; end if;
  if (select address_set_at from public.orders where id = 914601) is null then raise exception 'case a member reads address_set_at failed'; end if;
  begin
    update public.orders set bosta_district = 'x' where id = 914601;
    raise exception 'case bosta_district is the server''s failed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.orders set address_set_at = null where id = 914601;
    raise exception 'case address_set_at is the server''s failed';
  exception when insufficient_privilege then null;
  end;
end $$;

do $$ begin raise notice 'rls_order_address: ok'; end $$;
rollback;
