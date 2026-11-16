-- Tests for 0108_category_order (a category's place among its siblings — comments decision 56). Depends on 0001_identity … 0108.
-- Runs in one transaction and rolls back; prints NOTICE 'rls_category_order: ok' only if every case passed. Live-safe: its
-- made-up member and categories are rolled back.
-- * woo_categories.menu_order: 0 until the site's order is known; read by the members like the rest of the row
-- * never written by a member (the sync and woo-sync category_order write it — the server's role only)

begin;

insert into auth.users (id, email, phone) values ('00000000-0000-4000-8000-0000000108a1', 'co-ops.dev@ibtekr.local', '010000108a1');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u where u.email = 'co-ops.dev@ibtekr.local';
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-0000000108a1', 'عمليات الترتيب', 'co-ops.dev@ibtekr.local', '010000108a1', 'ops', 'active', '{}');

-- the server's rows: one written before the column was known (no order), two with the site's order
insert into public.woo_categories (id, name, slug, parent_id) values (910801, 'ترتيب — رئيسي', 'co-main', null);
insert into public.woo_categories (id, name, slug, parent_id, menu_order) values (910802, 'ترتيب — تاني', 'co-b', 910801, 2), (910803, 'ترتيب — أول', 'co-a', 910801, 1);

do $$ begin
  if (select menu_order from public.woo_categories where id = 910801) <> 0 then raise exception 'case a category without an order is 0 failed'; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000108a1","role":"authenticated"}', true);

do $$
declare got int[]; n int;
begin
  -- a member reads the order with the row: the children in the site's order
  select array_agg(id order by menu_order, name) into got from public.woo_categories where parent_id = 910801;
  if got is distinct from array[910803, 910802] then raise exception 'case the children read in the site''s order failed (%)', got; end if;
  -- and never writes it (no update grant on the mirror; were there one, the row is not his to change)
  begin
    update public.woo_categories set menu_order = 9 where id = 910802;
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'case a member does not write a category''s order failed'; end if;
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
do $$ begin
  if (select menu_order from public.woo_categories where id = 910802) <> 2 then raise exception 'case the order is unchanged failed'; end if;
  raise notice 'rls_category_order: ok';
end $$;
rollback;
