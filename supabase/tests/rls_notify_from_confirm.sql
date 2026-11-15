-- Tests for 0103_notify_from_confirm (the owner 15 Nov): the order's confirmation date fills its lines' «تاريخ تبليغ المبتكر»
-- (order_items.expected_at) — on confirming (the lines with none, and those still on the old date when it moves), and on a line
-- that reaches a confirmed order; a date set by hand, a line pulled from the stock and a removed line stay. Depends on 0001 … 0103.
-- One transaction, rolled back; NOTICE 'rls_notify_from_confirm: ok' only if every case passed. Live-safe: made-up orders
-- (99_103_…), a made-up member; nothing else is read or written.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-000000103a01', 'nf-ops.dev@ibtekr.local', '0100103a01');
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-000000103a01', 'عمليات التبليغ', 'nf-ops.dev@ibtekr.local', '0100103a01', 'ops', 'active', '{"orders.view":"F","orders.status":"F"}');

insert into public.orders (id, number, customer_name, customer_phone, status, woo_status, total, placed_at) values
  (99103001, '99103001', 'عميل التبليغ', '01000103001', 'جاري التنفيذ', 'processing', 900, '2026-11-10T10:00:00Z'),
  (99103002, '99103002', 'عميل مش مؤكد', '01000103002', 'جاري التنفيذ', 'processing', 300, '2026-11-10T10:00:00Z');
insert into public.order_items (id, order_id, name, qty, total, removed, pulled, status, expected_at) values
  (99103101, 99103001, 'من غير تاريخ', 1, 300, false, false, 'قيد التنفيذ', null),
  (99103102, 99103001, 'تاريخ بالإيد', 1, 300, false, false, 'قيد التنفيذ', '2026-11-01'),
  (99103103, 99103001, 'من المخزن', 1, 300, false, true, 'قيد التنفيذ', null),
  (99103104, 99103001, 'ممسوح', 1, 300, true, false, 'قيد التنفيذ', null);

create or replace function pg_temp.as_member(p_uid text) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', 'aal2')::text, true);
end $$;

-- the trigger functions are closed to members
do $$ begin
  if has_function_privilege('authenticated', 'public.orders_notify_from_confirm()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.order_items_notify_default()', 'EXECUTE')
     or has_function_privilege('anon', 'public.orders_notify_from_confirm()', 'EXECUTE') then
    raise exception 'case the trigger functions are closed to members failed';
  end if;
end $$;

-- a line of an order not confirmed yet has no notify date
do $$ begin
  insert into public.order_items (id, order_id, name, qty, total, removed, status) values (99103201, 99103002, 'أوردر مش مؤكد', 1, 300, false, 'قيد التنفيذ');
  if (select expected_at from public.order_items where id = 99103201) is not null then raise exception 'case no date before the confirmation failed'; end if;
end $$;

-- the member confirms on 11 Nov: the line with no date takes it; the hand-set one, the pulled one and the removed one stay
select pg_temp.as_member('00000000-0000-4000-8000-000000103a01');
do $$ begin
  update public.orders set confirm = 'مؤكد بدون عربون', confirm_at = '2026-11-11' where id = 99103001;
end $$;
reset role;
do $$ begin
  if (select expected_at from public.order_items where id = 99103101) is distinct from date '2026-11-11' then raise exception 'case the confirmation date fills the line failed'; end if;
  if (select expected_at from public.order_items where id = 99103102) is distinct from date '2026-11-01' then raise exception 'case a date set by hand stays failed'; end if;
  if (select expected_at from public.order_items where id = 99103103) is not null then raise exception 'case a line pulled from the stock stays failed'; end if;
  if (select expected_at from public.order_items where id = 99103104) is not null then raise exception 'case a removed line stays failed'; end if;
  if not exists (select 1 from public.order_events where item_id = 99103101 and kind = 'item_expected_at' and new_value = '2026-11-11'
                   and actor = '00000000-0000-4000-8000-000000103a01' and source = 'user') then
    raise exception 'case the line change is recorded with the member failed';
  end if;
end $$;

-- the confirmation date moved to 12 Nov: the line on the old date follows, the hand-set one stays; cleared: nothing moves
select pg_temp.as_member('00000000-0000-4000-8000-000000103a01');
do $$ begin
  update public.orders set confirm_at = '2026-11-12' where id = 99103001;
end $$;
reset role;
do $$ begin
  if (select expected_at from public.order_items where id = 99103101) is distinct from date '2026-11-12' then raise exception 'case a moved confirmation moves the filled line failed'; end if;
  if (select expected_at from public.order_items where id = 99103102) is distinct from date '2026-11-01' then raise exception 'case a date set by hand stays when the confirmation moves failed'; end if;
end $$;
select pg_temp.as_member('00000000-0000-4000-8000-000000103a01');
do $$ begin
  update public.orders set confirm = 'غير مؤكد', confirm_at = null where id = 99103001;
end $$;
reset role;
do $$ begin
  if (select expected_at from public.order_items where id = 99103101) is distinct from date '2026-11-12' then raise exception 'case a cleared confirmation changes no line failed'; end if;
end $$;

-- the server: a line reaching a confirmed order (the sync, «إضافة منتج») takes the date; one with its own date or pulled does not
set local role service_role;
do $$ begin
  update public.orders set confirm = 'مؤكد بدون عربون', confirm_at = '2026-11-13' where id = 99103002;
  if (select expected_at from public.order_items where id = 99103201) is distinct from date '2026-11-13' then raise exception 'case the sync confirming fills the line failed'; end if;
  insert into public.order_items (id, order_id, name, qty, total, removed, status) values (99103202, 99103002, 'سطر جديد', 1, 200, false, '');
  if (select expected_at from public.order_items where id = 99103202) is distinct from date '2026-11-13' then raise exception 'case a new line of a confirmed order takes the date failed'; end if;
  insert into public.order_items (id, order_id, name, qty, total, removed, status, expected_at) values (99103203, 99103002, 'بتاريخه', 1, 200, false, '', '2026-11-05');
  if (select expected_at from public.order_items where id = 99103203) is distinct from date '2026-11-05' then raise exception 'case a new line with its own date keeps it failed'; end if;
  insert into public.order_items (id, order_id, name, qty, total, removed, pulled, status) values (99103204, 99103002, 'مسحوب', 1, 200, false, true, '');
  if (select expected_at from public.order_items where id = 99103204) is not null then raise exception 'case a new pulled line has no date failed'; end if;
end $$;
reset role;

do $$ begin raise notice 'rls_notify_from_confirm: ok'; end $$;
rollback;
