-- Tests for 0140_orders_bosta (the owner 19 Nov — the Bosta tracking number next to the customer address): the trigger copies
-- the site's bosta_tracking_number / bosta_status meta from orders.raw into bosta_tracking / bosta_state (the last value of a
-- key, a plain string, ≤ 60 characters), a member with orders.view reads them through orders_v, and the helper functions are
-- closed to members. Depends on 0001 … 0140. One transaction, rolled back; NOTICE 'rls_orders_bosta: ok' only if every case
-- passed. Live-safe: made-up orders (99_140_…), a made-up member; nothing else is read or written.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-000000140a01', 'bosta-ops.dev@ibtekr.local', '0100140a01');
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-000000140a01', 'عمليات بوسطة', 'bosta-ops.dev@ibtekr.local', '0100140a01', 'ops', 'active', '{"orders.view":"F"}');

insert into public.orders (id, number, customer_name, customer_phone, status, woo_status, total, placed_at, raw) values
  (99140001, '99140001', 'عميل بوسطة', '01000140001', 'قيد الشحن', 'processing', 900, '2026-11-10T10:00:00Z',
   '{"meta_data":[{"key":"bosta_tracking_number","value":"111"},{"key":"bosta_status","value":"Pickup requested"},{"key":"bosta_tracking_number","value":"7012345"}]}'),
  (99140002, '99140002', 'عميل من غير بوسطة', '01000140002', 'جاري التنفيذ', 'processing', 300, '2026-11-10T10:00:00Z',
   '{"meta_data":[{"key":"bosta_tracking_number","value":{"x":1}}]}');

create or replace function pg_temp.as_member(p_uid text) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', 'aal2')::text, true);
end $$;

do $$ begin
  if has_function_privilege('authenticated', 'public.orders_bosta_set()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.order_meta_text(jsonb, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.orders_bosta_set()', 'EXECUTE') then
    raise exception 'case the bosta functions are closed to members failed';
  end if;
end $$;

-- the last value of the key wins; a non-string value is no number
do $$ begin
  if (select bosta_tracking from public.orders where id = 99140001) is distinct from '7012345'
     or (select bosta_state from public.orders where id = 99140001) is distinct from 'Pickup requested' then
    raise exception 'case the trigger copies the last tracking number and the status failed';
  end if;
  if (select bosta_tracking from public.orders where id = 99140002) is not null then
    raise exception 'case a non-string meta value stays out failed';
  end if;
end $$;

-- a new sync of the order moves the values with it
update public.orders set raw = '{"meta_data":[{"key":"bosta_tracking_number","value":"7099999"},{"key":"bosta_status","value":"Delivered"}]}' where id = 99140002;
do $$ begin
  if (select bosta_tracking || '/' || bosta_state from public.orders where id = 99140002) is distinct from '7099999/Delivered' then
    raise exception 'case a re-synced order takes the new values failed';
  end if;
end $$;

-- a member with orders.view reads them from orders_v
select pg_temp.as_member('00000000-0000-4000-8000-000000140a01');
do $$ begin
  if (select bosta_tracking from public.orders_v where id = 99140001) is distinct from '7012345' then
    raise exception 'case a member reads the tracking number from orders_v failed';
  end if;
end $$;
reset role;

do $$ begin raise notice 'rls_orders_bosta: ok'; end $$;
rollback;
