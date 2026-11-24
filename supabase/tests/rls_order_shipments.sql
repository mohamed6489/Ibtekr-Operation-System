-- Tests for 0151 (the meeting of 23 Nov [#15] — «تم الشحن»): a member who may change an order's statuses records how a piece went to the
-- warehouse or how the order goes to the customer through order_shipment_add only — the shapes the meeting set (a ride with its app
-- and amount, Bosta's pickup with its amount, a ride to the customer with who pays), one row on the order's timeline; a member who
-- may only read the order reads them and records nothing; nobody inserts directly. Depends on 0001 … 0151. One transaction, rolled
-- back; NOTICE 'rls_order_shipments: ok' only if every case passed. Live-safe: made-up members, maker and order far from the site's.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-000000151a01', 'ship-ops.dev@ibtekr.local', '0100151a01'),
  ('00000000-0000-4000-8000-000000151a02', 'ship-view.dev@ibtekr.local', '0100151a02');
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-000000151a01', 'عمليات الشحن', 'ship-ops.dev@ibtekr.local', '0100151a01', 'ops', 'active', '{"orders.view":"F","orders.status":"F","orders.edit":"F","accounts.add":"F"}'),
  ('00000000-0000-4000-8000-000000151a02', 'مشاهد الشحن', 'ship-view.dev@ibtekr.local', '0100151a02', 'viewer', 'active', '{"orders.view":"F","orders.status":"N","orders.edit":"N"}');
insert into public.vendors (id, woo_vendor_id, name, status) values ('00000000-0000-4000-8000-000000151b01', 915101, 'مبتكر الشحن', 'active');
insert into public.orders (id, number, customer_name, customer_phone, status, woo_status, payment_method, total, deposit, placed_at) values
  (915101, '915101', 'عميل الشحن', '01000151001', 'جاري التنفيذ', 'processing', 'cod', 900, 0, now());
insert into public.order_items (id, order_id, name, total, vendor_id) values (9151011, 915101, 'قطعة الشحن', 900, '00000000-0000-4000-8000-000000151b01');
insert into public.acc_vendor_moves (id, vendor_id, on_date, direction, kind, amount) values (915101, '00000000-0000-4000-8000-000000151b01', current_date, 'withdraw', 'مواصلات', 80);
insert into public.acc_vendor_moves (id, vendor_id, on_date, direction, kind, amount) values (915102, '00000000-0000-4000-8000-000000151b01', current_date, 'withdraw', 'عربون', 80);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000151a01","role":"authenticated"}';

do $$ declare n bigint; begin
  -- to the warehouse: a ride with its app and amount (the maker's «مواصلات» passed), Bosta with its fee, the maker himself, our courier
  n := public.order_shipment_add(915101, 9151011, 'warehouse', 'ride', 'أوبر', 80, null, 915101, null);
  if (select vendor_id from public.order_shipments where id = n) is distinct from '00000000-0000-4000-8000-000000151b01' then raise exception 'case the line''s maker is kept failed'; end if;
  if (select payer from public.order_shipments where id = n) is distinct from 'maker' then raise exception 'case the warehouse ride is the maker''s failed'; end if;
  perform public.order_shipment_add(915101, 9151011, 'warehouse', 'bosta', null, 45, null, null, null);
  perform public.order_shipment_add(915101, 9151011, 'warehouse', 'maker', null, null, null, null, null);
  perform public.order_shipment_add(915101, 9151011, 'warehouse', 'courier', null, null, null, null, null);
  -- to the customer: Bosta (recorded only), a ride paid by the customer (no money row), a ride paid by the company
  perform public.order_shipment_add(915101, null, 'customer', 'bosta', null, null, null, null, null);
  n := public.order_shipment_add(915101, null, 'customer', 'ride', 'إن درايف', 60, 'customer', null, null);
  if (select amount from public.order_shipments where id = n) is distinct from 60 or (select payer from public.order_shipments where id = n) <> 'customer' then
    raise exception 'case the customer''s shipping charge is kept failed'; end if;
  if (select count(*) from public.order_events where order_id = 915101 and kind = 'shipment') <> 6 then raise exception 'case every shipment is on the timeline failed'; end if;
  if not exists (select 1 from public.order_events where order_id = 915101 and kind = 'shipment' and new_value = 'اتشحن للمخزن — توصيلة (أوبر)') then raise exception 'case the timeline line says it failed'; end if;
  -- the shapes refused
  begin perform public.order_shipment_add(915101, 9151011, 'warehouse', 'ride', 'أوبر', null, null, null, null); raise exception 'case a ride without its amount failed';
  exception when invalid_parameter_value then null; end;
  begin perform public.order_shipment_add(915101, 9151011, 'warehouse', 'ride', '', 80, null, null, null); raise exception 'case a ride without its app failed';
  exception when invalid_parameter_value then null; end;
  begin perform public.order_shipment_add(915101, 9151011, 'warehouse', 'bosta', null, null, null, null, null); raise exception 'case Bosta''s pickup without its fee failed';
  exception when invalid_parameter_value then null; end;
  begin perform public.order_shipment_add(915101, null, 'customer', 'maker', null, null, null, null, null); raise exception 'case the maker himself to the customer failed';
  exception when invalid_parameter_value then null; end;
  begin perform public.order_shipment_add(915101, null, 'customer', 'ride', 'أوبر', 60, null, null, null); raise exception 'case a customer ride without who pays failed';
  exception when invalid_parameter_value then null; end;
  begin perform public.order_shipment_add(915101, 9151011, 'warehouse', 'ride', 'أوبر', 80, null, 915102, null); raise exception 'case a vendor move that is not «مواصلات» failed';
  exception when invalid_parameter_value then null; end;
  begin perform public.order_shipment_add(915101, 9151011, 'warehouse', 'ride', '<b>', 80, null, null, null); raise exception 'case html in the app failed';
  exception when invalid_parameter_value then null; end;
  -- no direct writes
  begin insert into public.order_shipments (order_id, leg, method) values (915101, 'customer', 'bosta'); raise exception 'case no direct insert failed';
  exception when insufficient_privilege then null; end;
end $$;

-- a member who may only read the order reads the shipments and records none
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000151a02","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.order_shipments where order_id = 915101) <> 6 then raise exception 'case the reader reads them failed'; end if;
  begin perform public.order_shipment_add(915101, null, 'customer', 'bosta', null, null, null, null, null); raise exception 'case a reader records nothing failed';
  exception when insufficient_privilege then null; end;
end $$;

do $$ begin raise notice 'rls_order_shipments: ok'; end $$;
rollback;
