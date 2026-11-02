-- RLS / permission tests for 0033_order_delete (order_delete, orders_v without deleted orders). Depends on 0001 … 0033.
-- Runs in one transaction and rolls back; prints NOTICE 'rls_order_delete: ok' only if every case passed.
-- Live-safe: every count is scoped to the rows this file writes. Every name, number and phone is made up.

begin;

-- Test users (fixed UUIDs …d1–…d3): orders.status = F; orders.view F but orders.status N; orders.view N.
insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000000d1', 'od-ops.dev@ibtekr.local',  '010000000d1'),
  ('00000000-0000-4000-8000-0000000000d2', 'od-view.dev@ibtekr.local', '010000000d2'),
  ('00000000-0000-4000-8000-0000000000d3', 'od-none.dev@ibtekr.local', '010000000d3');

insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email)
from auth.users u
where u.id in ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000d3');

insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-0000000000d1', 'مسح العمليات', 'od-ops.dev@ibtekr.local',  '010000000d1', 'ops', 'active', '{"orders.view":"F","orders.status":"F"}'),
  ('00000000-0000-4000-8000-0000000000d2', 'مسح المشاهدة', 'od-view.dev@ibtekr.local', '010000000d2', 'ops', 'active', '{"orders.view":"F","orders.status":"N"}'),
  ('00000000-0000-4000-8000-0000000000d3', 'مسح بدون',     'od-none.dev@ibtekr.local', '010000000d3', 'ops', 'active', '{"orders.view":"N","orders.status":"N"}');

insert into public.orders (id, number, customer_name, customer_phone, status, woo_status, total, placed_at, cancel) values
  (99970001, '99970001', 'عميل ملغي', '01000000001', 'ملغي', 'cancelled', 500, '2026-10-20T09:00:00Z', '{"reason":"سبب تجريبي"}'),
  (99970002, '99970002', 'عميل شغال', '01000000002', 'قيد الانتظار', 'pending', 300, '2026-10-20T10:00:00Z', null),
  (99970003, '99970003', 'عميل ملغي تاني', '01000000003', 'ملغي', 'cancelled', 200, '2026-10-20T11:00:00Z', '{"reason":"سبب تجريبي"}');

-- ================================================================ runner: the columns, the grants, the view

do $$ begin
  if not has_column_privilege('authenticated', 'public.orders', 'deleted_at', 'SELECT') or has_column_privilege('authenticated', 'public.orders', 'deleted_at', 'UPDATE')
     or has_column_privilege('authenticated', 'public.orders', 'delete_reason', 'UPDATE') or not has_column_privilege('service_role', 'public.orders', 'deleted_at', 'UPDATE') then
    raise exception 'case grants (members read the mark, never write it; the sync may) failed';
  end if;
  if has_function_privilege('anon', 'public.order_delete(bigint, text)', 'EXECUTE') or not has_function_privilege('authenticated', 'public.order_delete(bigint, text)', 'EXECUTE') then
    raise exception 'case order_delete execute grants failed';
  end if;
  begin
    update public.orders set delete_reason = repeat('ن', 121) where id = 99970003;
    raise exception 'case a reason over 120 characters must be refused failed';
  exception when check_violation then null;
  end;
end $$;

-- ================================================================ orders.status = F: deletes a cancelled order only

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}';
do $$ declare rid bigint; begin
  if (select count(*) from public.orders_v where id in (99970001, 99970002, 99970003)) <> 3 then raise exception 'case the view shows the three orders before failed'; end if;
  rid := public.order_delete(99970001, '  إلغاء من العميل  ');
  if rid <> 99970001 then raise exception 'case order_delete returns the id failed'; end if;
  if (select count(*) from public.orders_v where id = 99970001) <> 0 then raise exception 'case a deleted order leaves orders_v failed'; end if;
  if not exists (select 1 from public.orders where id = 99970001 and deleted_at is not null and delete_reason = 'إلغاء من العميل'
                 and deleted_by = '00000000-0000-4000-8000-0000000000d1' and status = 'ملغي') then
    raise exception 'case the mark (trimmed reason, by the caller, the row kept) failed';
  end if;
  begin
    perform public.order_delete(99970002, 'تعديل من العميل');
    raise exception 'case a non-cancelled order must error failed';
  exception when others then
    if sqlstate <> '22023' then raise exception 'case not cancelled: expected 22023, got % (%)', sqlstate, sqlerrm; end if;
  end;
  if (select deleted_at from public.orders where id = 99970002) is not null then raise exception 'case a refused delete leaves the order failed'; end if;
  begin
    perform public.order_delete(99970003, '   ');
    raise exception 'case an empty reason must error failed';
  exception when others then
    if sqlstate <> '22023' then raise exception 'case empty reason: expected 22023, got % (%)', sqlstate, sqlerrm; end if;
  end;
  begin
    perform public.order_delete(99970003, repeat('ن', 121));
    raise exception 'case a long reason must error failed';
  exception when others then
    if sqlstate <> '22023' then raise exception 'case long reason: expected 22023, got % (%)', sqlstate, sqlerrm; end if;
  end;
  begin
    perform public.order_delete(99970001, 'تاني');
    raise exception 'case deleting twice must error failed';
  exception when others then
    if sqlstate <> 'P0002' then raise exception 'case twice: expected P0002, got % (%)', sqlstate, sqlerrm; end if;
  end;
  begin
    perform public.order_delete(99970999, 'مش موجود');
    raise exception 'case an unknown order must error failed';
  exception when others then
    if sqlstate <> 'P0002' then raise exception 'case unknown: expected P0002, got % (%)', sqlstate, sqlerrm; end if;
  end;
  begin
    update public.orders set deleted_at = now() where id = 99970003;
    raise exception 'case a member may not write the mark directly failed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ================================================================ orders.view F, orders.status N: reads, cannot delete

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000d2","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.orders_v where id = 99970003) <> 1 then raise exception 'case orders.view reads the cancelled order failed'; end if;
  if (select count(*) from public.orders_v where id = 99970001) <> 0 then raise exception 'case orders.view does not read the deleted one failed'; end if;
  begin
    perform public.order_delete(99970003, 'إلغاء من العميل');
    raise exception 'case orders.status N must not delete failed';
  exception when others then
    if sqlstate <> '42501' then raise exception 'case status N: expected 42501, got % (%)', sqlstate, sqlerrm; end if;
  end;
end $$;

-- ================================================================ orders.view N: sees nothing, cannot delete

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000d3","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.orders_v where id = 99970003) <> 0 then raise exception 'case orders.view N reads nothing failed'; end if;
  begin
    perform public.order_delete(99970003, 'إلغاء من العميل');
    raise exception 'case orders.view N must not delete failed';
  exception when others then
    if sqlstate <> 'P0002' then raise exception 'case view N: expected P0002, got % (%)', sqlstate, sqlerrm; end if;
  end;
end $$;

-- ================================================================ anon: no execute

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$ begin
  begin
    perform public.order_delete(99970003, 'إلغاء من العميل');
    raise exception 'case anon must error failed';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;

do $$ begin raise notice 'rls_order_delete: ok'; end $$;
