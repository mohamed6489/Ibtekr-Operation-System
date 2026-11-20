-- Tests for 0148 (the owner 20 Nov — an order deleted on the site goes from the system too): a row the site hid (woo-webhook:
-- deleted_by null, delete_reason «اتمسح من الموقع») is still taken by the system's own «مسح» (order_delete writes the member's reason);
-- a row a member deleted is not taken again. One transaction, rolled back; NOTICE 'rls_order_site_deleted: ok' if every case passed.
begin;
insert into auth.users (id, email, phone) values ('00000000-0000-4000-8000-000000148a01', 'site-deleted.dev@ibtekr.local', '0100148a01');
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-000000148a01', 'عمليات المسح', 'site-deleted.dev@ibtekr.local', '0100148a01', 'ops', 'active', '{"orders.view":"F","orders.status":"F"}');
insert into public.orders (id, number, customer_name, customer_phone, status, woo_status, payment_method, total, deposit, placed_at) values
  (914801, '914801', 'أ', '01000148001', 'ملغي', 'cancelled', 'cod', 100, 0, now()),
  (914802, '914802', 'ب', '01000148002', 'ملغي', 'cancelled', 'cod', 100, 0, now());
-- the site's delivery hid 914801 first; a member deleted 914802 before
update public.orders set deleted_at = now(), deleted_by = null, delete_reason = 'اتمسح من الموقع' where id = 914801;
update public.orders set deleted_at = now(), deleted_by = '00000000-0000-4000-8000-000000148a01', delete_reason = 'مكرر' where id = 914802;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000148a01","role":"authenticated"}';
do $$ begin
  perform public.order_delete(914801, 'العميل لغاه');
  begin
    perform public.order_delete(914802, 'تاني');
    raise exception 'case a member-deleted order is not taken again failed';
  exception when no_data_found then null;
  end;
end $$;
reset role;
do $$ begin
  if (select delete_reason from public.orders where id = 914801) <> 'العميل لغاه' or (select deleted_by from public.orders where id = 914801) is null then
    raise exception 'case the member''s reason over the site''s failed';
  end if;
  raise notice 'rls_order_site_deleted: ok';
end $$;
rollback;
