-- Tests for the data statements of 0011_vendors on rows that predate it. Vendors as the phase-2 sync wrote them
-- (joined_at / store_url null, Dokan's `registered` / `shop_url` only in raw) and order lines as it wrote them
-- (commission_rate / commission_fee null, _dokan_commission_rate / _dokan_additional_fee only in raw.meta_data) are
-- inserted, the migration file itself is applied again with \ir, then once more to prove that a re-run changes nothing.
-- LOCAL ONLY (psql): \ir is a psql command, so this file does not run through the Supabase MCP's execute_sql; on the
-- live project 0011 is checked with the queries in tools/deploy.md §2.1. The schema side of 0011 (the columns and their
-- grants, the policies, the guard, vendor_rates, vendor_bank, the bucket) is in rls_vendors.sql.
-- Runs in one transaction and rolls back; prints NOTICE 'migrate_0011: ok' only if every case passed.
-- As the runner (postgres, no auth.uid()): the trusted sync and the migrations both write this way.
-- No statement here removes rows or objects.

begin;
-- the re-runs print "column … already exists, skipping" / "relation … already exists, skipping"
set local client_min_messages = warning;
set local request.jwt.claims = '';

-- ---------------------------------------------------------------- the state before 0011

-- Stores as the 2.x sync wrote them (the columns exist already — the migrations ran before this file — so joined_at and
-- store_url are set to null on purpose). raw as woo-core's mapStore keeps it; one row (9905) already carries values the
-- new sync wrote, which the backfill must keep. created_at at noon UTC so its date is the same in any session zone.
insert into public.vendors (id, woo_vendor_id, name, created_at, joined_at, store_url, raw) values
  ('00000000-0000-4000-8000-0000000000c1', 9901, 'متجر تجربة 1', '2026-10-20T12:00:00Z', null, null,
   '{"id":9901,"store_name":"متجر تجربة 1","shop_url":"https://stage.example.test/store/one/","registered":"2025-01-02 10:00:00"}'),
  ('00000000-0000-4000-8000-0000000000c2', 9902, 'متجر تجربة 2', '2026-10-21T12:00:00Z', null, null,
   '{"id":9902,"shop_url":"http://insecure.example.test/store/two/","registered":""}'),
  ('00000000-0000-4000-8000-0000000000c3', 9903, 'متجر تجربة 3', '2026-10-22T12:00:00Z', null, null, null),
  ('00000000-0000-4000-8000-0000000000c4', 9904, 'متجر تجربة 4', '2026-10-23T12:00:00Z', null, null,
   '{"id":9904,"registered":"yesterday","shop_url":" https://stage.example.test/store/four/ "}'),
  ('00000000-0000-4000-8000-0000000000c5', 9905, 'متجر تجربة 5', '2026-10-24T12:00:00Z', '2024-05-05', 'https://kept.example.test/',
   '{"id":9905,"registered":"2025-06-07 08:00:00","shop_url":"https://stage.example.test/store/five/"}'),
  ('00000000-0000-4000-8000-0000000000c6', 9906, 'متجر تجربة 6', '2026-10-25T12:00:00Z', null, null,
   '{"id":9906,"registered":"2025-03-04T08:00:00","shop_url":""}');

-- Lines as the 2.x sync wrote them: the commission only in raw.meta_data (woo-core keeps the _dokan_* entries).
insert into public.orders (id, number, customer_name, status, placed_at) values
  (990301, '990301', 'عميلة تجربة', 'مكتمل', '2026-10-20T12:00:00Z');

insert into public.order_items (id, order_id, name, total, commission_rate, commission_fee, raw) values
  (9301, 990301, 'سطر 1', 1000, null, null,
   '{"id":9301,"meta_data":[{"id":1,"key":"_dokan_vendor_id","value":"9901"},{"id":2,"key":"_dokan_commission_rate","value":"35"},{"id":3,"key":"_dokan_additional_fee","value":""}]}'),
  (9302, 990301, 'سطر 2', 1000, null, null,
   '{"id":9302,"meta_data":[{"id":4,"key":"_dokan_commission_rate","value":40},{"id":5,"key":"_dokan_additional_fee","value":"10"}]}'),
  (9303, 990301, 'سطر 3', 1000, null, null, null),
  (9304, 990301, 'سطر 4', 1000, null, null,
   '{"id":9304,"meta_data":[{"id":6,"key":"_dokan_commission_rate","value":""},{"id":7,"key":"_dokan_additional_fee","value":"0"}]}'),
  (9305, 990301, 'سطر 5', 1000, null, null,
   '{"id":9305,"meta_data":[{"id":8,"key":"_dokan_commission_rate","value":"n/a"},{"id":9,"key":"_dokan_additional_fee","value":"-5"}]}'),
  (9306, 990301, 'سطر 6', 1000, 20, 5,
   '{"id":9306,"meta_data":[{"id":10,"key":"_dokan_commission_rate","value":"35"},{"id":11,"key":"_dokan_additional_fee","value":"1"}]}'),
  (9307, 990301, 'سطر 7', 1000, null, null,
   '{"id":9307,"meta_data":{"key":"_dokan_commission_rate","value":"35"}}'),
  (9308, 990301, 'سطر 8', 1000, null, null,
   '{"id":9308,"meta_data":[{"id":12,"key":"_dokan_commission_rate","value":" 45.5 "},{"id":13,"key":"_dokan_additional_fee","value":"2.345"}]}'),
  (9309, 990301, 'سطر 9', 1000, null, null,
   '{"id":9309,"meta_data":[{"id":14,"key":"_dokan_commission_rate","value":"1234"},{"id":15,"key":"_dokan_additional_fee","value":"12345678.9"}]}');

do $$ begin
  perform set_config('migrate_0011.events', (select count(*)::text from public.order_events), true);
end $$;

-- ---------------------------------------------------------------- 0011 on that state

\ir ../migrations/0011_vendors.sql

do $$ begin
  if not ((select string_agg(woo_vendor_id || '=' || coalesce(joined_at::text, '∅'), ',' order by woo_vendor_id)
           from public.vendors where woo_vendor_id between 9901 and 9906)
          = '9901=2025-01-02,9902=2026-10-21,9903=2026-10-22,9904=2026-10-23,9905=2024-05-05,9906=2025-03-04') then
    raise exception 'case joined_at backfilled from raw.registered (the date part; blank / malformed / no raw → created_at; an existing value kept) failed';
  end if;
  if not ((select string_agg(woo_vendor_id || '=' || coalesce(store_url, '∅'), ',' order by woo_vendor_id)
           from public.vendors where woo_vendor_id between 9901 and 9906)
          = '9901=https://stage.example.test/store/one/,9902=∅,9903=∅,9904=https://stage.example.test/store/four/,'
            || '9905=https://kept.example.test/,9906=∅') then
    raise exception 'case store_url backfilled from raw.shop_url (https only, trimmed; an existing value kept) failed';
  end if;
  if not ((select string_agg(id || '=' || coalesce(commission_rate::text, '∅') || '/' || coalesce(commission_fee::text, '∅'), ',' order by id)
           from public.order_items where order_id = 990301)
          = '9301=35.00/∅,9302=40.00/10.00,9303=∅/∅,9304=∅/0.00,9305=∅/∅,9306=20.00/5.00,9307=∅/∅,9308=45.50/2.35,9309=∅/12345678.90') then
    raise exception 'case commission_rate / commission_fee backfilled from raw.meta_data (blank = null, plain decimals only, an existing value kept, a non-array meta_data skipped) failed';
  end if;
  if not ((select count(*) from public.order_events)::text = current_setting('migrate_0011.events')) then
    raise exception 'case the backfill writes no order_events rows (the commission columns are not tracked) failed';
  end if;
  -- the other columns of a backfilled row are untouched
  if not ((select name || '/' || status || '/' || lead_days || '/' || opening_balance from public.vendors where woo_vendor_id = 9901) = 'متجر تجربة 1/active/7/0.00') then
    raise exception 'case the backfill leaves the other vendor columns as they are failed';
  end if;
end $$;

-- ---------------------------------------------------------------- a re-run changes nothing

do $$ begin
  perform set_config('migrate_0011.before', concat_ws('|',
    (select string_agg(woo_vendor_id || coalesce(joined_at::text, '∅') || coalesce(store_url, '∅') || coalesce(commission_pct::text, '∅'), ',' order by woo_vendor_id) from public.vendors),
    (select string_agg(id || coalesce(commission_rate::text, '∅') || coalesce(commission_fee::text, '∅'), ',' order by id) from public.order_items),
    (select string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '∅'), ',' order by table_name, ordinal_position)
     from information_schema.columns where table_schema = 'public' and table_name in ('vendors', 'order_items', 'vendor_rates', 'vendor_bank')),
    (select string_agg(tablename || '.' || policyname || ':' || cmd || ':' || array_to_string(roles, '|') || ':' || coalesce(qual, '∅') || ':' || coalesce(with_check, '∅'), ',' order by tablename, policyname)
     from pg_policies where schemaname = 'public' and tablename in ('vendors', 'vendor_rates', 'vendor_bank')),
    (select string_agg(table_name || '.' || column_name || ':' || grantee || ':' || privilege_type, ',' order by table_name, column_name, grantee, privilege_type)
     from information_schema.column_privileges where table_schema = 'public' and table_name in ('vendors', 'order_items')),
    (select string_agg(table_name || ':' || grantee || ':' || privilege_type, ',' order by table_name, grantee, privilege_type)
     from information_schema.role_table_grants where table_schema = 'public' and table_name in ('vendors', 'vendor_rates', 'vendor_bank', 'order_items')),
    (select string_agg(t.tgname || ':' || c.relname || ':' || t.tgenabled::text, ',' order by t.tgname)
     from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and c.relname in ('vendors', 'vendor_rates')),
    (select string_agg(md5(pg_get_functiondef(oid)) || ':' || prosecdef, ',' order by proname) from pg_proc where proname in ('vendors_guard_update', 'vendor_rates_apply')),
    (select string_agg(conname || ':' || pg_get_constraintdef(oid), ',' order by conname)
     from pg_constraint where conrelid in ('public.vendors'::regclass, 'public.order_items'::regclass, 'public.vendor_rates'::regclass, 'public.vendor_bank'::regclass)),
    (select count(*) from public.order_events),
    (select count(*) from public.vendors), (select count(*) from public.vendor_rates), (select count(*) from public.vendor_bank)), true);
end $$;

\ir ../migrations/0011_vendors.sql

do $$ begin
  if not (current_setting('migrate_0011.before')
          = concat_ws('|',
              (select string_agg(woo_vendor_id || coalesce(joined_at::text, '∅') || coalesce(store_url, '∅') || coalesce(commission_pct::text, '∅'), ',' order by woo_vendor_id) from public.vendors),
              (select string_agg(id || coalesce(commission_rate::text, '∅') || coalesce(commission_fee::text, '∅'), ',' order by id) from public.order_items),
              (select string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '∅'), ',' order by table_name, ordinal_position)
               from information_schema.columns where table_schema = 'public' and table_name in ('vendors', 'order_items', 'vendor_rates', 'vendor_bank')),
              (select string_agg(tablename || '.' || policyname || ':' || cmd || ':' || array_to_string(roles, '|') || ':' || coalesce(qual, '∅') || ':' || coalesce(with_check, '∅'), ',' order by tablename, policyname)
               from pg_policies where schemaname = 'public' and tablename in ('vendors', 'vendor_rates', 'vendor_bank')),
              (select string_agg(table_name || '.' || column_name || ':' || grantee || ':' || privilege_type, ',' order by table_name, column_name, grantee, privilege_type)
               from information_schema.column_privileges where table_schema = 'public' and table_name in ('vendors', 'order_items')),
              (select string_agg(table_name || ':' || grantee || ':' || privilege_type, ',' order by table_name, grantee, privilege_type)
               from information_schema.role_table_grants where table_schema = 'public' and table_name in ('vendors', 'vendor_rates', 'vendor_bank', 'order_items')),
              (select string_agg(t.tgname || ':' || c.relname || ':' || t.tgenabled::text, ',' order by t.tgname)
               from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and c.relname in ('vendors', 'vendor_rates')),
              (select string_agg(md5(pg_get_functiondef(oid)) || ':' || prosecdef, ',' order by proname) from pg_proc where proname in ('vendors_guard_update', 'vendor_rates_apply')),
              (select string_agg(conname || ':' || pg_get_constraintdef(oid), ',' order by conname)
               from pg_constraint where conrelid in ('public.vendors'::regclass, 'public.order_items'::regclass, 'public.vendor_rates'::regclass, 'public.vendor_bank'::regclass)),
              (select count(*) from public.order_events),
              (select count(*) from public.vendors), (select count(*) from public.vendor_rates), (select count(*) from public.vendor_bank))) then
    raise exception 'case 0011 applied a second time changes nothing (backfills, columns, policies, grants, triggers, functions, constraints, order_events) failed';
  end if;
  if not ((select count(*) from pg_policies where schemaname = 'public' and tablename = 'vendor_rates') = 2
          and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'vendor_bank') = 3
          and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'vendors') = 4
          and (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
               where not t.tgisinternal and c.relname = 'vendors' and t.tgname = 'vendors_guard_update') = 1
          and (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
               where not t.tgisinternal and c.relname = 'vendor_rates' and t.tgname = 'vendor_rates_apply') = 1) then
    raise exception 'case the policies and triggers of 0011 exist once after three runs failed';
  end if;
end $$;

rollback;

do $$ begin raise notice 'migrate_0011: ok'; end $$;
