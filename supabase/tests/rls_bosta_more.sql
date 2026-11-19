-- Tests for 0144 (the owner 19 Nov — Bosta part 2): a member's deposit change on an order Bosta has marks its new cash due (the trigger
-- fires after the members' guard); the same cash is not due; the Bosta columns are the server's (a member cannot write them); the
-- maker pickups are read with orders.view and written by the server only. Depends on 0001 … 0144. One transaction, rolled back;
-- NOTICE 'rls_bosta_more: ok' only if every case passed. Live-safe: made-up member and orders with ids far from the site's.

begin;

insert into auth.users (id, email, phone) values ('00000000-0000-4000-8000-000000144a01', 'bosta-more.dev@ibtekr.local', '0100144a01');
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-000000144a01', 'عمليات بوسطة', 'bosta-more.dev@ibtekr.local', '0100144a01', 'ops', 'active',
   '{"orders.view":"F","orders.status":"F","orders.edit":"F"}');
insert into public.orders (id, number, customer_name, customer_phone, status, woo_status, payment_method, total, deposit, placed_at, bosta_delivery, bosta_cod) values
  (914401, '914401', 'عميل بوسطة', '01000144001', 'جاري التنفيذ', 'processing', 'cod', 1200, 0, now(), 'dlv914401', 1200),
  (914402, '914402', 'عميل من غير بوسطة', '01000144002', 'جاري التنفيذ', 'processing', 'cod', 900, 0, now(), null, null);
-- on insert the delivery comes from the site's order (the plugin's meta — 0144 orders_bosta_set); the system's own send writes it after
update public.orders set bosta_delivery = 'dlv914401', bosta_cod = 1200 where id = 914401;
insert into public.bosta_pickups (location_id, scheduled_date, slot, receiver_name, state) values ('ZAAN', current_date, '10:00 to 13:00', 'مدير التشغيل', 'sent');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000144a01","role":"authenticated"}';

do $$
declare n int;
begin
  -- the deposit changes on an order on Bosta → its cash is due
  update public.orders set deposit = 200 where id = 914401;
  -- an order not on Bosta → nothing due (both read back below, as the server — a member never reads bosta_cod_due)
  update public.orders set deposit = 100 where id = 914402;
  -- a member cannot write the Bosta columns
  begin
    update public.orders set bosta_cod_due = false where id = 914401;
    raise exception 'case bosta_cod_due is the server''s failed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.orders set bosta_delivery = 'x' where id = 914402;
    raise exception 'case bosta_delivery is the server''s failed';
  exception when insufficient_privilege then null;
  end;
  -- the pickups: read with orders.view, never written by a member
  select count(*) into n from public.bosta_pickups where location_id = 'ZAAN';
  if n < 1 then raise exception 'case the pickups are read with orders.view failed'; end if;
  begin
    insert into public.bosta_pickups (location_id, scheduled_date, slot, receiver_name) values ('X', current_date, '10:00 to 13:00', 'اسم');
    raise exception 'case a member cannot add a pickup failed';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
do $$ begin
  if not (select bosta_cod_due from public.orders where id = 914401) then raise exception 'case the new cash is due failed'; end if;
  if (select bosta_cod_due from public.orders where id = 914402) then raise exception 'case an order off Bosta stays failed'; end if;
end $$;
-- the same cash again is not due (the server sent it already)
update public.orders set bosta_cod = 1000, bosta_cod_due = false where id = 914401;
update public.orders set total = 1200 where id = 914401;
do $$ begin
  if (select bosta_cod_due from public.orders where id = 914401) then raise exception 'case the same cash is not due failed'; end if;
  if public.bosta_cod_of('cod', 1200, 200) <> 1000 or public.bosta_cod_of('paymob', 1200, 0) <> 0 or public.bosta_cod_of('cod', 100, 500) <> 0 then raise exception 'case bosta_cod_of failed'; end if;
end $$;
do $$ begin raise notice 'rls_bosta_more: ok'; end $$;
rollback;
