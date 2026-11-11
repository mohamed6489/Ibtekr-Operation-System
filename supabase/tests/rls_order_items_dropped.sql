-- Tests for 0079_order_items_dropped (a product the system took off a multi-maker order stays removed whatever the sync writes).
-- Depends on 0001 … 0079. One transaction, rolled back; NOTICE 'rls_order_items_dropped: ok' only if every case passed. Live-safe:
-- a made-up order (99_079_001) and made-up members; nothing else is read or written.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000079a1', 'dr-ops.dev@ibtekr.local', '010000079a1');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u where u.email = 'dr-ops.dev@ibtekr.local';
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-0000000079a1', 'عمليات المسح', 'dr-ops.dev@ibtekr.local', '010000079a1', 'ops', 'active', '{"orders.view":"F","orders.status":"F"}');

insert into public.orders (id, number, customer_name, customer_phone, status, woo_status, total, placed_at) values
  (99079001, '99079001', 'عميل مسح', '01000079001', 'جاري التنفيذ', 'processing', 300, '2026-11-11T10:00:00Z');
insert into public.order_items (id, order_id, name, qty, total, removed) values
  (99079011, 99079001, 'منتج أ', 1, 100, false),
  (99079012, 99079001, 'منتج ب', 1, 200, false);

create or replace function pg_temp.as_member(p_uid text) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;

-- the grants: members never read nor write dropped_at; the server does
do $$ begin
  if has_column_privilege('authenticated', 'public.order_items', 'dropped_at', 'SELECT') or has_column_privilege('authenticated', 'public.order_items', 'dropped_at', 'UPDATE')
     or has_column_privilege('anon', 'public.order_items', 'dropped_at', 'SELECT') then
    raise exception 'case members never see nor write dropped_at failed';
  end if;
  if not has_column_privilege('service_role', 'public.order_items', 'dropped_at', 'UPDATE') then
    raise exception 'case the server writes dropped_at failed';
  end if;
  if has_function_privilege('authenticated', 'public.order_items_keep_dropped()', 'EXECUTE') or has_function_privilege('anon', 'public.order_items_keep_dropped()', 'EXECUTE') then
    raise exception 'case the trigger function is closed to members failed';
  end if;
end $$;

-- the server drops a line (woo-sync suborder_trash / line_trash): removed with it
set local role service_role;
do $$ begin
  update public.order_items set dropped_at = now() where id = 99079011;
  if not (select removed from public.order_items where id = 99079011) then raise exception 'case a dropped line is removed failed'; end if;
  -- the sync brings the parent's lines back (an upsert with removed = false, dropped_at not sent): the dropped one stays removed
  insert into public.order_items (id, order_id, name, qty, total, removed) values
    (99079011, 99079001, 'منتج أ', 1, 100, false), (99079012, 99079001, 'منتج ب', 1, 200, false)
  on conflict (id) do update set name = excluded.name, qty = excluded.qty, total = excluded.total, removed = excluded.removed;
  if not (select removed from public.order_items where id = 99079011) then raise exception 'case the sync cannot bring a dropped line back failed'; end if;
  if (select removed from public.order_items where id = 99079012) then raise exception 'case a line not dropped follows the sync failed'; end if;
  update public.order_items set removed = false where id = 99079011;
  if not (select removed from public.order_items where id = 99079011) then raise exception 'case a plain update cannot bring it back failed'; end if;
  -- an undo by hand: dropped_at cleared, then the sync decides again
  update public.order_items set dropped_at = null, removed = false where id = 99079011;
  if (select removed from public.order_items where id = 99079011) then raise exception 'case clearing dropped_at lets the line back failed'; end if;
  update public.order_items set dropped_at = now() where id = 99079011;
end $$;
reset role;

-- a member (orders.status = F) still changes a dropped line's team status columns; removed stays; dropped_at is never theirs
select pg_temp.as_member('00000000-0000-4000-8000-0000000079a1');
do $$ begin
  update public.order_items set comment = 'ملاحظة' where id = 99079011;
  begin
    update public.order_items set dropped_at = null where id = 99079011;
    raise exception 'case a member cannot clear dropped_at failed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.order_items set removed = false where id = 99079011;
    raise exception 'case a member cannot bring a line back failed';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$ begin
  if not (select removed from public.order_items where id = 99079011) or (select comment from public.order_items where id = 99079011) is distinct from 'ملاحظة' then
    raise exception 'case the member''s comment kept, the line still removed failed';
  end if;
end $$;

do $$ begin raise notice 'rls_order_items_dropped: ok'; end $$;
rollback;
