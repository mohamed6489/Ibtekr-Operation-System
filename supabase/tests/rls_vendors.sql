-- RLS / permission / trigger tests for 0011_vendors (the team's columns on vendors and their column-list grants, the
-- update / delete policies, the column guard vendors_guard_update, vendor_rates + the commission_pct trigger,
-- vendor_bank, order_items.commission_rate / commission_fee, the Storage bucket vendor-contracts when the storage
-- schema exists). The backfills of 0011 are tested on older rows in migrate_0011.sql (local only).
-- Depends on 0001_identity … 0011_vendors.
-- Runs in one transaction and rolls back; prints NOTICE 'rls_vendors: ok' only if every case passed.
-- Each case switches role explicitly: the runner (postgres) owns the tables, bypasses RLS and plays the trusted sync
-- (service_role) — the guard applies to anon / authenticated only.
-- No statement here removes rows or objects (the deletes below are expected to be refused and are run as text, like
-- rls_orders.sql), so it runs live through the Supabase MCP's execute_sql unchanged. Every phone, name and IBAN is
-- made up.

begin;

-- Test users (fixed UUIDs …41–…46): admin, ops (vendors.edit P / toggle N / bank N / commission N), cs (vendors.view P,
-- nothing else), accounts (vendors.edit N / sensitive.vendor_bank F / commission N), suspended viewer, vendors follow-up
-- (vendors.edit F / toggle N / bank N / commission N). Every value comes from the built-in matrix of 0003_seed_roles.
insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-000000000041', 'vnd-admin.dev@ibtekr.local',    '01000000041'),
  ('00000000-0000-4000-8000-000000000042', 'vnd-ops.dev@ibtekr.local',      '01000000042'),
  ('00000000-0000-4000-8000-000000000043', 'vnd-cs.dev@ibtekr.local',       '01000000043'),
  ('00000000-0000-4000-8000-000000000044', 'vnd-accounts.dev@ibtekr.local', '01000000044'),
  ('00000000-0000-4000-8000-000000000045', 'vnd-susp.dev@ibtekr.local',     '01000000045'),
  ('00000000-0000-4000-8000-000000000046', 'vnd-vf.dev@ibtekr.local',       '01000000046');

insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email)
from auth.users u
where u.id in ('00000000-0000-4000-8000-000000000041',
               '00000000-0000-4000-8000-000000000042',
               '00000000-0000-4000-8000-000000000043',
               '00000000-0000-4000-8000-000000000044',
               '00000000-0000-4000-8000-000000000045',
               '00000000-0000-4000-8000-000000000046');

insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-000000000041', 'أدمن المبتكرين',    'vnd-admin.dev@ibtekr.local',    '01000000041', 'admin',            'active',    '{}'),
  ('00000000-0000-4000-8000-000000000042', 'عمليات المبتكرين',  'vnd-ops.dev@ibtekr.local',      '01000000042', 'ops',              'active',    '{}'),
  ('00000000-0000-4000-8000-000000000043', 'خدمة عملاء المبتكرين', 'vnd-cs.dev@ibtekr.local',    '01000000043', 'cs',               'active',    '{}'),
  ('00000000-0000-4000-8000-000000000044', 'حسابات المبتكرين',  'vnd-accounts.dev@ibtekr.local', '01000000044', 'accounts',         'active',    '{}'),
  ('00000000-0000-4000-8000-000000000045', 'مشاهد موقوف',       'vnd-susp.dev@ibtekr.local',     '01000000045', 'viewer',           'suspended', '{}'),
  ('00000000-0000-4000-8000-000000000046', 'متابعة المبتكرين',  'vnd-vf.dev@ibtekr.local',       '01000000046', 'vendors_followup', 'active',    '{}');

-- Two Dokan stores as the phase-3 sync inserts them (joined_at from `registered`, store_url from `shop_url`), one
-- completed order with two lines of the first store (the site's commission on each line), its Dokan sub-order.
-- Written by the runner, as the sync would.
insert into public.vendors (id, woo_vendor_id, name, phone, status, raw, joined_at, store_url) values
  ('00000000-0000-4000-8000-0000000000b1', 441, 'ورشة النور', '01000000441', 'active',
   '{"id":441,"store_name":"ورشة النور","shop_url":"https://stage.example.test/store/nour/","registered":"2025-01-02 10:00:00"}',
   '2025-01-02', 'https://stage.example.test/store/nour/'),
  ('00000000-0000-4000-8000-0000000000b2', 442, 'ورشة القمر', null, 'active',
   '{"id":442,"store_name":"ورشة القمر","shop_url":"https://stage.example.test/store/qamar/","registered":"2025-02-03 11:00:00"}',
   '2025-02-03', 'https://stage.example.test/store/qamar/');

insert into public.orders (id, number, customer_name, customer_phone, status, woo_status, total, placed_at, woo_updated_at) values
  (181800, '181800', 'عميلة المبتكرين', '01000000800', 'مكتمل', 'completed', 2000, '2026-10-20T09:00:00Z', '2026-10-22T09:00:00Z');

insert into public.sub_orders (order_id, vendor_id, woo_order_id, woo_status, total) values
  (181800, '00000000-0000-4000-8000-0000000000b1', 181801, 'completed', 2000);

insert into public.order_items (id, order_id, sub_order_id, product_id, name, qty, total, vendor_id, commission_rate, commission_fee) values
  (9401, 181800, (select id from public.sub_orders where woo_order_id = 181801), 701, 'مبخرة خزف', 1, 1000,
   '00000000-0000-4000-8000-0000000000b1', 35, 0),
  (9402, 181800, (select id from public.sub_orders where woo_order_id = 181801), 702, 'طقم فناجين', 1, 1000,
   '00000000-0000-4000-8000-0000000000b1', 40, 10);

-- ================================================================ runner: schema, grants, policies, triggers, constraints

do $$ begin
  -- vendors: the 12 columns of 0011 with their types, nullability and defaults.
  if not ((select string_agg(column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '∅'), ',' order by column_name)
           from information_schema.columns
           where table_schema = 'public' and table_name = 'vendors'
             and column_name in ('legal_name', 'category', 'alt_phone', 'address', 'instagram', 'store_url', 'lead_days',
                                 'deposit_policy', 'notes', 'joined_at', 'contract', 'opening_balance'))
          = 'address:text:YES:∅,alt_phone:text:YES:∅,category:text:YES:∅,contract:jsonb:YES:∅,deposit_policy:text:YES:∅,'
            || 'instagram:text:YES:∅,joined_at:date:YES:∅,lead_days:integer:NO:7,legal_name:text:YES:∅,notes:text:YES:∅,'
            || 'opening_balance:numeric:NO:0,store_url:text:YES:∅') then
    raise exception 'case vendors has the 12 columns of 0011 (types, nullability, defaults) failed';
  end if;
  -- order_items: commission_rate numeric(5,2), commission_fee numeric(10,2), both nullable.
  if not ((select string_agg(column_name || ':' || numeric_precision || ',' || numeric_scale || ':' || is_nullable, ',' order by column_name)
           from information_schema.columns
           where table_schema = 'public' and table_name = 'order_items' and column_name in ('commission_rate', 'commission_fee'))
          = 'commission_fee:10,2:YES,commission_rate:5,2:YES') then
    raise exception 'case order_items.commission_rate numeric(5,2) / commission_fee numeric(10,2) failed';
  end if;
  -- vendor_rates / vendor_bank: columns, keys, RLS.
  if not ((select string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' order by ordinal_position)
           from information_schema.columns where table_schema = 'public' and table_name = 'vendor_rates')
          = 'id:bigint:NO,vendor_id:uuid:NO,rate:numeric:NO,since:date:NO,set_by:text:YES,created_at:timestamp with time zone:NO') then
    raise exception 'case vendor_rates columns failed';
  end if;
  if not ((select string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' order by ordinal_position)
           from information_schema.columns where table_schema = 'public' and table_name = 'vendor_bank')
          = 'vendor_id:uuid:NO,method:text:NO,bank_name:text:YES,holder:text:YES,iban:text:YES,wallet:text:YES,updated_by:text:YES,updated_at:timestamp with time zone:NO') then
    raise exception 'case vendor_bank columns failed';
  end if;
  -- keys: conname:contype:columns:referenced table:on delete ('c' = cascade, ' ' when not a foreign key)
  if not ((select string_agg(c.conname || ':' || c.contype::text || ':' || (select string_agg(a.attname::text, ',' order by k.ord)
                                                                           from unnest(c.conkey) with ordinality k (attnum, ord)
                                                                           join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)
                             || ':' || coalesce((select relname::text from pg_class where oid = c.confrelid), '∅') || ':' || coalesce(nullif(c.confdeltype::text, ' '), '∅'), ',' order by c.conname)
           from pg_constraint c where c.conrelid = 'public.vendor_rates'::regclass and c.contype in ('p', 'u', 'f'))
          = 'vendor_rates_pkey:p:id:∅:∅,vendor_rates_vendor_id_fkey:f:vendor_id:vendors:c,vendor_rates_vendor_id_since_key:u:vendor_id,since:∅:∅') then
    raise exception 'case vendor_rates keys (pk id, unique (vendor_id, since), fk vendors on delete cascade) failed';
  end if;
  if not ((select string_agg(c.conname || ':' || c.contype::text || ':' || (select string_agg(a.attname::text, ',' order by k.ord)
                                                                           from unnest(c.conkey) with ordinality k (attnum, ord)
                                                                           join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)
                             || ':' || coalesce((select relname::text from pg_class where oid = c.confrelid), '∅') || ':' || coalesce(nullif(c.confdeltype::text, ' '), '∅'), ',' order by c.conname)
           from pg_constraint c where c.conrelid = 'public.vendor_bank'::regclass and c.contype in ('p', 'f'))
          = 'vendor_bank_pkey:p:vendor_id:∅:∅,vendor_bank_vendor_id_fkey:f:vendor_id:vendors:c') then
    raise exception 'case vendor_bank keys (pk vendor_id, fk vendors on delete cascade) failed';
  end if;
  if not ((select relrowsecurity from pg_class where oid = 'public.vendor_rates'::regclass)
          and (select relrowsecurity from pg_class where oid = 'public.vendor_bank'::regclass)) then
    raise exception 'case vendor_rates / vendor_bank have RLS enabled failed';
  end if;

  -- policies: vendors keeps its four (update with check admits admin / vendors.edit <> N / sensitive.vendor_bank = F;
  -- delete admin only), vendor_rates select + insert, vendor_bank select + insert + update — all to authenticated.
  if not ((select string_agg(policyname || ':' || cmd, ',' order by policyname) from pg_policies where schemaname = 'public' and tablename = 'vendors')
          = 'vendors_delete:DELETE,vendors_insert:INSERT,vendors_select:SELECT,vendors_update:UPDATE') then
    raise exception 'case vendors has exactly its four policies failed';
  end if;
  if not ((select with_check from pg_policies where schemaname = 'public' and tablename = 'vendors' and policyname = 'vendors_update')
          like '%is_admin%vendors.edit%sensitive.vendor_bank%'
          and (select qual from pg_policies where schemaname = 'public' and tablename = 'vendors' and policyname = 'vendors_update')
              like '%vendors.view%') then
    raise exception 'case vendors_update: using vendors.view, with check is_admin / vendors.edit <> N / sensitive.vendor_bank = F failed';
  end if;
  if not ((select qual from pg_policies where schemaname = 'public' and tablename = 'vendors' and policyname = 'vendors_delete')
          like '%is_admin%'
          and (select qual from pg_policies where schemaname = 'public' and tablename = 'vendors' and policyname = 'vendors_delete')
              not like '%vendors.edit%') then
    raise exception 'case vendors_delete is admin only (no vendors.edit) failed';
  end if;
  if not ((select string_agg(policyname || ':' || cmd || ':' || array_to_string(roles, '|'), ',' order by policyname)
           from pg_policies where schemaname = 'public' and tablename = 'vendor_rates')
          = 'vendor_rates_insert:INSERT:authenticated,vendor_rates_select:SELECT:authenticated'
          and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'vendor_rates'
               and coalesce(qual, with_check) like '%sensitive.commission%' and coalesce(qual, with_check) like '%''F''%') = 2) then
    raise exception 'case vendor_rates policies: select / insert with sensitive.commission = F, nothing else failed';
  end if;
  if not ((select string_agg(policyname || ':' || cmd || ':' || array_to_string(roles, '|'), ',' order by policyname)
           from pg_policies where schemaname = 'public' and tablename = 'vendor_bank')
          = 'vendor_bank_insert:INSERT:authenticated,vendor_bank_select:SELECT:authenticated,vendor_bank_update:UPDATE:authenticated'
          and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'vendor_bank'
               and coalesce(qual, with_check) like '%sensitive.vendor_bank%') = 3) then
    raise exception 'case vendor_bank policies: select / insert / update with sensitive.vendor_bank = F, no delete failed';
  end if;

  -- grants on vendors for authenticated: a column list (commission_pct never readable; woo_vendor_id / commission_pct /
  -- raw / opening_balance never writable; contract updatable, not insertable); delete on the table; no truncate.
  if not (has_column_privilege('authenticated', 'public.vendors', 'name', 'SELECT')
          and has_column_privilege('authenticated', 'public.vendors', 'raw', 'SELECT')
          and has_column_privilege('authenticated', 'public.vendors', 'woo_vendor_id', 'SELECT')
          and has_column_privilege('authenticated', 'public.vendors', 'joined_at', 'SELECT')
          and has_column_privilege('authenticated', 'public.vendors', 'contract', 'SELECT')
          and has_column_privilege('authenticated', 'public.vendors', 'opening_balance', 'SELECT')
          and not has_column_privilege('authenticated', 'public.vendors', 'commission_pct', 'SELECT')
          and not has_table_privilege('authenticated', 'public.vendors', 'SELECT')) then
    raise exception 'case authenticated selects vendors by column list, never commission_pct failed';
  end if;
  if not ((select count(*) from information_schema.column_privileges
           where grantee = 'authenticated' and table_schema = 'public' and table_name = 'vendors' and privilege_type = 'SELECT') = 22) then
    raise exception 'case authenticated selects exactly 22 vendors columns failed';
  end if;
  if not (has_column_privilege('authenticated', 'public.vendors', 'name', 'INSERT')
          and has_column_privilege('authenticated', 'public.vendors', 'joined_at', 'INSERT')
          and not has_column_privilege('authenticated', 'public.vendors', 'woo_vendor_id', 'INSERT')
          and not has_column_privilege('authenticated', 'public.vendors', 'contract', 'INSERT')
          and not has_column_privilege('authenticated', 'public.vendors', 'raw', 'INSERT')
          and not has_column_privilege('authenticated', 'public.vendors', 'commission_pct', 'INSERT')
          and not has_column_privilege('authenticated', 'public.vendors', 'opening_balance', 'INSERT')
          and not has_column_privilege('authenticated', 'public.vendors', 'id', 'INSERT')) then
    raise exception 'case authenticated inserts the team columns of vendors only failed';
  end if;
  if not (has_column_privilege('authenticated', 'public.vendors', 'contract', 'UPDATE')
          and has_column_privilege('authenticated', 'public.vendors', 'status', 'UPDATE')
          and has_column_privilege('authenticated', 'public.vendors', 'name', 'UPDATE')
          and has_column_privilege('authenticated', 'public.vendors', 'phone', 'UPDATE')
          and has_column_privilege('authenticated', 'public.vendors', 'notes', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.vendors', 'woo_vendor_id', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.vendors', 'raw', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.vendors', 'commission_pct', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.vendors', 'opening_balance', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.vendors', 'id', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.vendors', 'updated_at', 'UPDATE')) then
    raise exception 'case authenticated updates the team columns + contract of vendors only failed';
  end if;
  if not (has_table_privilege('authenticated', 'public.vendors', 'DELETE')
          and not has_table_privilege('authenticated', 'public.vendors', 'TRUNCATE')
          and has_table_privilege('service_role', 'public.vendors', 'SELECT')
          and has_column_privilege('service_role', 'public.vendors', 'commission_pct', 'SELECT')
          and has_table_privilege('service_role', 'public.vendors', 'UPDATE')
          and not has_table_privilege('service_role', 'public.vendors', 'TRUNCATE')
          and not has_column_privilege('anon', 'public.vendors', 'name', 'SELECT')) then
    raise exception 'case vendors grants (authenticated delete, service_role all incl. commission_pct, anon none, no truncate) failed';
  end if;
  -- order_items: members read the commission columns with orders.view, never write them; the sync writes them.
  if not (has_column_privilege('authenticated', 'public.order_items', 'commission_rate', 'SELECT')
          and has_column_privilege('authenticated', 'public.order_items', 'commission_fee', 'SELECT')
          and not has_column_privilege('authenticated', 'public.order_items', 'commission_rate', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.order_items', 'commission_fee', 'UPDATE')
          and has_column_privilege('service_role', 'public.order_items', 'commission_rate', 'UPDATE')
          and has_column_privilege('service_role', 'public.order_items', 'commission_fee', 'INSERT')
          and not has_column_privilege('anon', 'public.order_items', 'commission_rate', 'SELECT')) then
    raise exception 'case order_items.commission_rate / commission_fee grants (members select, sync writes, anon none) failed';
  end if;
  -- vendor_rates: members select + insert (+ the sequence), never update / delete; vendor_bank: select + insert + update.
  if not (has_table_privilege('authenticated', 'public.vendor_rates', 'SELECT')
          and has_table_privilege('authenticated', 'public.vendor_rates', 'INSERT')
          and not has_table_privilege('authenticated', 'public.vendor_rates', 'UPDATE')
          and not has_table_privilege('authenticated', 'public.vendor_rates', 'DELETE')
          and not has_table_privilege('authenticated', 'public.vendor_rates', 'TRUNCATE')
          and has_sequence_privilege('authenticated', 'public.vendor_rates_id_seq', 'USAGE')
          and has_sequence_privilege('service_role', 'public.vendor_rates_id_seq', 'USAGE')
          and has_table_privilege('service_role', 'public.vendor_rates', 'DELETE')
          and not has_table_privilege('service_role', 'public.vendor_rates', 'TRUNCATE')
          and not has_table_privilege('anon', 'public.vendor_rates', 'SELECT')) then
    raise exception 'case vendor_rates grants (authenticated select/insert + sequence, service_role all, anon none, no truncate) failed';
  end if;
  if not (has_table_privilege('authenticated', 'public.vendor_bank', 'SELECT')
          and has_table_privilege('authenticated', 'public.vendor_bank', 'INSERT')
          and has_table_privilege('authenticated', 'public.vendor_bank', 'UPDATE')
          and not has_table_privilege('authenticated', 'public.vendor_bank', 'DELETE')
          and not has_table_privilege('authenticated', 'public.vendor_bank', 'TRUNCATE')
          and has_table_privilege('service_role', 'public.vendor_bank', 'DELETE')
          and not has_table_privilege('service_role', 'public.vendor_bank', 'TRUNCATE')
          and not has_table_privilege('anon', 'public.vendor_bank', 'SELECT')) then
    raise exception 'case vendor_bank grants (authenticated select/insert/update, service_role all, anon none, no truncate) failed';
  end if;

  -- triggers and their functions: the guard (invoker, before update), the rate copy (definer, owned by postgres,
  -- after insert), neither executable by the API roles.
  if not ((select string_agg(t.tgname || ':' || c.relname || ':' || p.proname || ':' || p.prosecdef || ':' || r.rolname, ',' order by t.tgname)
           from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid join pg_roles r on r.oid = p.proowner
           where not t.tgisinternal and t.tgname in ('vendors_guard_update', 'vendor_rates_apply'))
          = 'vendor_rates_apply:vendor_rates:vendor_rates_apply:true:postgres,vendors_guard_update:vendors:vendors_guard_update:false:postgres') then
    raise exception 'case triggers vendors_guard_update (invoker) and vendor_rates_apply (definer, owner postgres) failed';
  end if;
  if not (not has_function_privilege('authenticated', 'public.vendors_guard_update()', 'EXECUTE')
          and not has_function_privilege('anon', 'public.vendors_guard_update()', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.vendor_rates_apply()', 'EXECUTE')
          and not has_function_privilege('anon', 'public.vendor_rates_apply()', 'EXECUTE')) then
    raise exception 'case the API roles cannot execute the trigger functions failed';
  end if;
  if not ((select array_agg(proconfig) from pg_proc where proname in ('vendors_guard_update', 'vendor_rates_apply')) = array[array['search_path=public'], array['search_path=public']]) then
    raise exception 'case both trigger functions pin search_path = public failed';
  end if;

  -- Storage (live only; a plain local Postgres has no storage schema): the private bucket and its three policies.
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    if not exists (select 1 from storage.buckets
                   where id = 'vendor-contracts' and name = 'vendor-contracts' and public = false and file_size_limit = 10485760
                     and allowed_mime_types = array['application/pdf', 'image/png', 'image/jpeg']) then
      raise exception 'case bucket vendor-contracts (private, 10 MB, PDF / PNG / JPEG) failed';
    end if;
    if not ((select string_agg(policyname || ':' || cmd || ':' || array_to_string(roles, '|'), ',' order by policyname)
             from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'vendor_contracts_%')
            = 'vendor_contracts_insert:INSERT:authenticated,vendor_contracts_select:SELECT:authenticated,vendor_contracts_update:UPDATE:authenticated'
            and (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'vendor_contracts_%'
                 and coalesce(qual, with_check) like '%vendor-contracts%' and coalesce(qual, with_check) like '%sensitive.vendor_bank%') = 3) then
      raise exception 'case storage.objects policies vendor_contracts_select / insert / update (sensitive.vendor_bank = F), no delete failed';
    end if;
  end if;
end $$;

-- check constraints and the unique key (runner, bypassing RLS)
do $$
declare stmt text; code text;
begin
  for stmt, code in select * from (values
    ('update public.vendors set category = ''فئة غريبة'' where woo_vendor_id = 442', '23514'),
    ('update public.vendors set lead_days = 0 where woo_vendor_id = 442', '23514'),
    ('update public.vendors set lead_days = 61 where woo_vendor_id = 442', '23514'),
    ('insert into public.vendor_rates (vendor_id, rate, since) values (''00000000-0000-4000-8000-0000000000b2'', 66, current_date)', '23514'),
    ('insert into public.vendor_bank (vendor_id, method) values (''00000000-0000-4000-8000-0000000000b2'', ''cheque'')', '23514'),
    ('insert into public.vendor_rates (vendor_id, rate, since) values (''00000000-0000-4000-8000-000000000041'', 30, current_date)', '23503')
  ) as v (stmt, code) loop
    begin
      execute stmt;
      raise exception 'case constraint must error failed: %', stmt;
    exception when others then
      if sqlstate <> code then
        raise exception 'case constraint: expected %, got % (%) for %', code, sqlstate, sqlerrm, stmt;
      end if;
    end;
  end loop;
end $$;

-- ================================================================ admin: status, rate, bank, contract, insert; never the sync columns

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000041","role":"authenticated"}';
do $$ declare n int; begin
  -- the list, by column list (what the adapter selects), raw included
  if not ((select count(*) from (select id, woo_vendor_id, name, aliases, phone, email, status, raw, created_at, updated_at, legal_name,
                                        category, alt_phone, address, instagram, store_url, lead_days, deposit_policy, notes, joined_at,
                                        contract, opening_balance
                                 from public.vendors) v) = 2
          and (select raw ->> 'store_name' from public.vendors where woo_vendor_id = 441) = 'ورشة النور'
          and (select joined_at from public.vendors where woo_vendor_id = 441) = '2025-01-02') then
    raise exception 'case admin reads the vendors list by column list (raw, joined_at included) failed';
  end if;

  update public.vendors set status = 'inactive' where woo_vendor_id = 442;
  get diagnostics n = row_count;
  if not (n = 1) then raise exception 'case admin (vendors.toggle F) changes a vendor status failed'; end if;

  update public.vendors set name = 'ورشة النور الجديدة', legal_name = 'شركة النور', category = 'هدايا', aliases = '{"النور"}',
                            lead_days = 10, deposit_policy = 'نص', joined_at = '2025-01-03', phone = '01000000442', notes = 'ملاحظة الأدمن'
  where woo_vendor_id = 441;
  get diagnostics n = row_count;
  if not (n = 1) then raise exception 'case admin changes every team column of a vendor failed'; end if;

  -- the agreement: today 35, an older 30, a future 40 → the copy is 35 (checked below as the runner)
  insert into public.vendor_rates (vendor_id, rate, since, set_by) values
    ('00000000-0000-4000-8000-0000000000b1', 35, current_date, 'أدمن المبتكرين'),
    ('00000000-0000-4000-8000-0000000000b1', 30, current_date - 10, 'أدمن المبتكرين'),
    ('00000000-0000-4000-8000-0000000000b1', 40, current_date + 1, 'أدمن المبتكرين');
  if not ((select string_agg(rate::text, ',' order by since) from public.vendor_rates where vendor_id = '00000000-0000-4000-8000-0000000000b1')
          = '30.00,35.00,40.00') then
    raise exception 'case admin (sensitive.commission F) writes and reads vendor_rates failed';
  end if;

  insert into public.vendor_bank (vendor_id, method, bank_name, holder, iban, updated_by) values
    ('00000000-0000-4000-8000-0000000000b1', 'bank', 'بنك التجربة', 'ورشة النور', 'EG00TEST00000000000000000441', 'أدمن المبتكرين');
  if not ((select iban from public.vendor_bank where vendor_id = '00000000-0000-4000-8000-0000000000b1') = 'EG00TEST00000000000000000441') then
    raise exception 'case admin (sensitive.vendor_bank F) writes and reads vendor_bank failed';
  end if;

  update public.vendors
  set contract = ('{"path":"00000000-0000-4000-8000-0000000000b1/1761480000000-contract.pdf","file_name":"contract.pdf","size":2048,'
                  || '"expires":"2027-10-26","uploaded_by":"أدمن المبتكرين","uploaded_at":"2026-10-26T12:00:00Z"}')::jsonb
  where woo_vendor_id = 441;
  get diagnostics n = row_count;
  if not (n = 1) then raise exception 'case admin (sensitive.vendor_bank F) records a contract failed'; end if;

  -- a maker without a store (the screen's «إضافة مبتكر»)
  insert into public.vendors (name, aliases, category, phone, lead_days, joined_at)
  values ('مبتكر يدوي', '{"يدوي"}', 'هدايا', '01000000449', 5, '2026-10-26');
  get diagnostics n = row_count;
  if not (n = 1 and (select count(*) from public.vendors where name = 'مبتكر يدوي' and woo_vendor_id is null and lead_days = 5) = 1) then
    raise exception 'case admin inserts a maker without a store failed';
  end if;
end $$;

-- The sync's columns are not writable, with any value, admin included (column grants): the first layer, before the
-- guard. The copy of the rate is not readable either, and neither is `select *`.
do $$
declare stmt text;
begin
  foreach stmt in array array[
    'insert into public.vendors (woo_vendor_id, name) values (443, ''متجر بمعرّف'')',
    'update public.vendors set woo_vendor_id = 441 where woo_vendor_id = 441',
    'update public.vendors set raw = ''{}'' where woo_vendor_id = 441',
    'update public.vendors set opening_balance = 100 where woo_vendor_id = 441',
    'update public.vendors set commission_pct = 35 where woo_vendor_id = 441',
    'update public.vendors set updated_at = now() where woo_vendor_id = 441',
    'select commission_pct from public.vendors where woo_vendor_id = 441',
    'select * from public.vendors',
    'update public.vendor_rates set rate = 1 where vendor_id = ''00000000-0000-4000-8000-0000000000b1''',
    'delete from public.vendor_rates where vendor_id = ''00000000-0000-4000-8000-0000000000b1''',
    'delete from public.vendor_bank where vendor_id = ''00000000-0000-4000-8000-0000000000b1''',
    'update public.order_items set commission_rate = 35 where id = 9401'] loop
    begin
      execute stmt;
      raise exception 'case admin on a sync / server column must error failed: %', stmt;
    exception when others then
      if sqlstate <> '42501' then -- expected: no privilege on the column / table
        raise exception 'case admin on a sync / server column: expected 42501, got % (%) for %', sqlstate, sqlerrm, stmt;
      end if;
    end;
  end loop;
end $$;

-- Delete: the admin reaches the row (the policy lets them), and the lines of the maker refuse it.
do $$ begin
  begin
    execute 'delete from public.vendors where woo_vendor_id = 441';
  exception when others then
    if sqlstate = '23503' then return; end if; -- expected: order_items / sub_orders reference the maker
    raise exception 'case admin deletes a maker with lines: expected 23503, got % (%)', sqlstate, sqlerrm;
  end;
  raise exception 'case admin deletes a maker with lines must error failed';
end $$;

-- ================================================================ runner: the rate copy, the sync on an existing store

reset role;
set local request.jwt.claims = '';
do $$ declare n int; begin
  if not ((select commission_pct from public.vendors where woo_vendor_id = 441) = 35) then
    raise exception 'case vendor_rates insert refreshes vendors.commission_pct with the rate effective today (35, not 30 / 40) failed';
  end if;
  -- a maker with only a future-dated rate: the copy stays null until it is effective
  insert into public.vendor_rates (vendor_id, rate, since) values ('00000000-0000-4000-8000-0000000000b2', 20, current_date + 5);
  if not ((select commission_pct from public.vendors where woo_vendor_id = 442) is null) then
    raise exception 'case a future-dated rate alone leaves commission_pct null failed';
  end if;
  insert into public.vendor_rates (vendor_id, rate, since) values ('00000000-0000-4000-8000-0000000000b2', 25, current_date - 1);
  if not ((select commission_pct from public.vendors where woo_vendor_id = 442) = 25) then
    raise exception 'case a rate effective yesterday becomes the copy (25) failed';
  end if;
  -- the sync (service_role) on an existing store writes raw only: the team's name / status / phone stay
  update public.vendors set raw = raw || '{"store_name":"اسم جديد على الموقع","registered":"2025-01-02 10:00:00"}' where woo_vendor_id = 441;
  get diagnostics n = row_count;
  if not (n = 1 and (select name || '/' || status || '/' || phone || '/' || (raw ->> 'store_name') from public.vendors where woo_vendor_id = 441)
                    = 'ورشة النور الجديدة/active/01000000442/اسم جديد على الموقع') then
    raise exception 'case the runner updates raw on an existing store, the team columns stay failed';
  end if;
end $$;

do $$ begin
  begin
    insert into public.vendor_rates (vendor_id, rate, since) values ('00000000-0000-4000-8000-0000000000b1', 36, current_date);
  exception when others then
    if sqlstate = '23505' then return; end if; -- expected: unique (vendor_id, since)
    raise exception 'case a second rate on the same day: expected 23505, got % (%)', sqlstate, sqlerrm;
  end;
  raise exception 'case a second rate on the same day must error failed';
end $$;

-- ================================================================ vendors follow-up: edit F — name / category yes; status, rate, bank, contract no

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000046","role":"authenticated"}';
do $$ declare n int; begin
  update public.vendors set name = 'ورشة القمر الجديدة', category = 'فنون ولوحات', aliases = '{"القمر"}', legal_name = 'مؤسسة القمر',
                            deposit_policy = 'عربون 50%', joined_at = '2025-02-04', lead_days = 14
  where woo_vendor_id = 442;
  get diagnostics n = row_count;
  if not (n = 1) then raise exception 'case vendors follow-up (vendors.edit F) changes name / category / aliases / … failed'; end if;
  update public.vendors set phone = '01000000443', notes = 'ملاحظة المتابعة', instagram = 'qamar.test' where woo_vendor_id = 442;
  get diagnostics n = row_count;
  if not (n = 1) then raise exception 'case vendors follow-up (vendors.edit F) changes the contact columns failed'; end if;
  insert into public.vendors (name, category) values ('مبتكر المتابعة', 'هدايا');
  get diagnostics n = row_count;
  if not (n = 1) then raise exception 'case vendors follow-up (vendors.edit F) inserts a maker failed'; end if;
  -- the sensitive tables: zero rows, not an error
  if not ((select count(*) from public.vendor_rates) = 0 and (select count(*) from public.vendor_bank) = 0) then
    raise exception 'case vendors follow-up (commission N, bank N) reads zero vendor_rates / vendor_bank rows failed';
  end if;
  update public.vendor_bank set holder = 'x' where vendor_id = '00000000-0000-4000-8000-0000000000b1';
  get diagnostics n = row_count;
  if not (n = 0) then raise exception 'case vendors follow-up updates zero vendor_bank rows failed'; end if;
end $$;

do $$
declare stmt text; needle text;
begin
  for stmt, needle in select * from (values
    ('update public.vendors set status = ''active'' where woo_vendor_id = 442', 'vendors.toggle'),
    ('update public.vendors set contract = ''{"path":"x"}'' where woo_vendor_id = 442', 'sensitive.vendor_bank'),
    ('insert into public.vendor_rates (vendor_id, rate, since) values (''00000000-0000-4000-8000-0000000000b2'', 30, current_date)', 'policy'),
    ('insert into public.vendor_bank (vendor_id, method, iban) values (''00000000-0000-4000-8000-0000000000b2'', ''bank'', ''EG00TEST00000000000000000442'')', 'policy'),
    ('select commission_pct from public.vendors where woo_vendor_id = 442', 'permission denied')
  ) as v (stmt, needle) loop
    begin
      execute stmt;
      raise exception 'case vendors follow-up must error failed: %', stmt;
    exception when others then
      if sqlstate <> '42501' or sqlerrm not like '%' || needle || '%' then -- expected: the named rule
        raise exception 'case vendors follow-up: expected 42501 mentioning %, got % (%) for %', needle, sqlstate, sqlerrm, stmt;
      end if;
    end;
  end loop;
end $$;

-- ================================================================ ops: edit P — contact columns yes; name / category / status no; reads the line's commission

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000042","role":"authenticated"}';
do $$ declare n int; begin
  update public.vendors set phone = '01000000444', alt_phone = '01000000445', email = 'nour.test@example.com', address = 'شارع الورشة',
                            instagram = 'nour.test', store_url = 'https://stage.example.test/store/nour-2/', notes = 'ملاحظة العمليات'
  where woo_vendor_id = 441;
  get diagnostics n = row_count;
  if not (n = 1) then raise exception 'case ops (vendors.edit P) changes the contact columns failed'; end if;
  if not ((select count(*) from public.vendor_rates) = 0 and (select count(*) from public.vendor_bank) = 0) then
    raise exception 'case ops (commission N, bank N) reads zero vendor_rates / vendor_bank rows failed';
  end if;
  -- the site's commission on each line, with orders.view (decision 4): the share of 1000 at 35 % / 0 is 650, at 40 % / 10 is 640
  if not ((select string_agg(id || '=' || commission_rate || '/' || commission_fee || '→' || round(total - (total * commission_rate / 100 + commission_fee), 2), ',' order by id)
           from public.order_items where order_id = 181800)
          = '9401=35.00/0.00→650.00,9402=40.00/10.00→640.00') then
    raise exception 'case ops (orders.view F) reads order_items.commission_rate / commission_fee failed: got %',
      coalesce((select string_agg(id || '=' || coalesce(commission_rate::text, '∅') || '/' || coalesce(commission_fee::text, '∅') || '→' || coalesce(round(total - (total * commission_rate / 100 + commission_fee), 2)::text, '∅'), ',' order by id)
                from public.order_items where order_id = 181800), '<no rows>');
  end if;
end $$;

do $$
declare stmt text; needle text;
begin
  for stmt, needle in select * from (values
    ('update public.vendors set name = ''اسم من العمليات'' where woo_vendor_id = 441', 'vendors.edit = F'),
    ('update public.vendors set category = ''هدايا'' where woo_vendor_id = 441', 'vendors.edit = F'),
    ('update public.vendors set aliases = ''{"x"}'' where woo_vendor_id = 441', 'vendors.edit = F'),
    ('update public.vendors set joined_at = ''2026-01-01'' where woo_vendor_id = 441', 'vendors.edit = F'),
    ('update public.vendors set status = ''inactive'' where woo_vendor_id = 441', 'vendors.toggle'),
    ('update public.vendors set contract = ''{"path":"x"}'' where woo_vendor_id = 441', 'sensitive.vendor_bank'),
    ('update public.vendors set phone = ''01000000446'', name = ''اسم'' where woo_vendor_id = 441', 'vendors.edit = F'),
    ('insert into public.vendors (name) values (''مبتكر العمليات'')', 'policy'),
    ('insert into public.vendor_rates (vendor_id, rate, since) values (''00000000-0000-4000-8000-0000000000b1'', 30, current_date + 2)', 'policy'),
    ('insert into public.vendor_bank (vendor_id) values (''00000000-0000-4000-8000-0000000000b2'')', 'policy'),
    ('update public.order_items set commission_rate = 36 where id = 9401', 'permission denied'),
    ('select * from public.vendors', 'permission denied')
  ) as v (stmt, needle) loop
    begin
      execute stmt;
      raise exception 'case ops must error failed: %', stmt;
    exception when others then
      if sqlstate <> '42501' or sqlerrm not like '%' || needle || '%' then -- expected: the named rule
        raise exception 'case ops: expected 42501 mentioning %, got % (%) for %', needle, sqlstate, sqlerrm, stmt;
      end if;
    end;
  end loop;
end $$;

-- a refused write leaves the row as it was
do $$ begin
  if not ((select name || '/' || status || '/' || phone from public.vendors where woo_vendor_id = 441) = 'ورشة النور الجديدة/active/01000000444') then
    raise exception 'case a refused write leaves the vendor row unchanged failed';
  end if;
end $$;

-- ================================================================ accounts: bank F, edit N — bank and contract yes; name, phone, status no

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000044","role":"authenticated"}';
do $$ declare n int; begin
  if not ((select count(*) from public.vendors) = 4) then raise exception 'case accounts (vendors.view F) reads the 4 makers failed'; end if;
  if not ((select method || '/' || bank_name || '/' || iban from public.vendor_bank where vendor_id = '00000000-0000-4000-8000-0000000000b1')
          = 'bank/بنك التجربة/EG00TEST00000000000000000441') then
    raise exception 'case accounts (sensitive.vendor_bank F) reads vendor_bank failed';
  end if;
  update public.vendor_bank set holder = 'ورشة النور — الحساب', updated_by = 'حسابات المبتكرين', updated_at = now()
  where vendor_id = '00000000-0000-4000-8000-0000000000b1';
  get diagnostics n = row_count;
  if not (n = 1) then raise exception 'case accounts updates vendor_bank failed'; end if;
  insert into public.vendor_bank (vendor_id, method, wallet, updated_by) values
    ('00000000-0000-4000-8000-0000000000b2', 'wallet', '01000000447', 'حسابات المبتكرين');
  get diagnostics n = row_count;
  if not (n = 1 and (select count(*) from public.vendor_bank) = 2) then raise exception 'case accounts inserts vendor_bank failed'; end if;
  -- the contract (decision 7: admin + accounts): the policy admits sensitive.vendor_bank = F, the guard allows contract alone
  update public.vendors
  set contract = ('{"path":"00000000-0000-4000-8000-0000000000b2/1761480000001-contract.pdf","file_name":"contract.pdf","size":1024,'
                  || '"expires":null,"uploaded_by":"حسابات المبتكرين","uploaded_at":"2026-10-26T12:30:00Z"}')::jsonb
  where woo_vendor_id = 442;
  get diagnostics n = row_count;
  if not (n = 1 and (select contract ->> 'uploaded_by' from public.vendors where woo_vendor_id = 442) = 'حسابات المبتكرين') then
    raise exception 'case accounts (sensitive.vendor_bank F, vendors.edit N) records a contract failed';
  end if;
  if not ((select count(*) from public.vendor_rates) = 0) then
    raise exception 'case accounts (sensitive.commission N) reads zero vendor_rates rows failed';
  end if;
  if not ((select commission_rate from public.order_items where id = 9401) = 35) then
    raise exception 'case accounts (orders.view F) reads order_items.commission_rate failed';
  end if;
end $$;

do $$
declare stmt text; needle text;
begin
  for stmt, needle in select * from (values
    ('update public.vendors set name = ''اسم من الحسابات'' where woo_vendor_id = 442', 'vendors.edit = F'),
    ('update public.vendors set phone = ''01000000448'' where woo_vendor_id = 442', 'vendors.edit (F or P)'),
    ('update public.vendors set notes = ''x'' where woo_vendor_id = 442', 'vendors.edit (F or P)'),
    ('update public.vendors set status = ''active'' where woo_vendor_id = 442', 'vendors.toggle'),
    ('update public.vendors set contract = null, lead_days = 3 where woo_vendor_id = 442', 'vendors.edit = F'),
    ('insert into public.vendors (name) values (''مبتكر الحسابات'')', 'policy'),
    ('insert into public.vendor_rates (vendor_id, rate, since) values (''00000000-0000-4000-8000-0000000000b2'', 30, current_date + 3)', 'policy'),
    ('select commission_pct from public.vendors where woo_vendor_id = 442', 'permission denied')
  ) as v (stmt, needle) loop
    begin
      execute stmt;
      raise exception 'case accounts must error failed: %', stmt;
    exception when others then
      if sqlstate <> '42501' or sqlerrm not like '%' || needle || '%' then -- expected: the named rule
        raise exception 'case accounts: expected 42501 mentioning %, got % (%) for %', needle, sqlstate, sqlerrm, stmt;
      end if;
    end;
  end loop;
end $$;

-- ================================================================ cs: vendors.view P — the list only (no masking), nothing written

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000043","role":"authenticated"}';
do $$ declare n int; begin
  if not ((select count(*) from public.vendors) = 4
          and (select name || '/' || phone || '/' || coalesce(category, '∅') from public.vendors where woo_vendor_id = 441)
              = 'ورشة النور الجديدة/01000000444/هدايا') then
    raise exception 'case cs (vendors.view P) reads the list with its phone and category (decision 9: no masking) failed';
  end if;
  if not ((select count(*) from public.vendor_rates) = 0 and (select count(*) from public.vendor_bank) = 0) then
    raise exception 'case cs reads zero vendor_rates / vendor_bank rows failed';
  end if;
  update public.vendor_bank set holder = 'x' where vendor_id = '00000000-0000-4000-8000-0000000000b1';
  get diagnostics n = row_count;
  if not (n = 0) then raise exception 'case cs updates zero vendor_bank rows failed'; end if;
end $$;

do $$
declare stmt text;
begin
  foreach stmt in array array[
    'update public.vendors set phone = ''01000000450'' where woo_vendor_id = 441',
    'update public.vendors set name = ''x'' where woo_vendor_id = 441',
    'update public.vendors set status = ''inactive'' where woo_vendor_id = 441',
    'insert into public.vendors (name) values (''مبتكر خدمة العملاء'')',
    'insert into public.vendor_rates (vendor_id, rate, since) values (''00000000-0000-4000-8000-0000000000b1'', 30, current_date + 4)',
    'insert into public.vendor_bank (vendor_id) values (''00000000-0000-4000-8000-000000000041'')'] loop
    begin
      execute stmt;
      raise exception 'case cs writes must error failed: %', stmt;
    exception when others then
      if sqlstate <> '42501' then -- expected: the with check (not admin, vendors.edit N, sensitive.vendor_bank N) or the policy
        raise exception 'case cs writes: expected 42501, got % (%) for %', sqlstate, sqlerrm, stmt;
      end if;
    end;
  end loop;
end $$;

-- ================================================================ suspended viewer: nothing

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000045","role":"authenticated"}';
do $$ declare n int; begin
  if not ((select count(*) from public.vendors) = 0 and (select count(*) from public.vendor_rates) = 0
          and (select count(*) from public.vendor_bank) = 0 and (select count(*) from public.order_items) = 0) then
    raise exception 'case suspended viewer reads zero rows of vendors / vendor_rates / vendor_bank / order_items failed';
  end if;
  update public.vendors set notes = 'x' where woo_vendor_id = 441;
  get diagnostics n = row_count;
  if not (n = 0) then raise exception 'case suspended viewer updates zero vendors failed'; end if;
end $$;

do $$ begin
  begin
    insert into public.vendors (name) values ('مبتكر الموقوف');
  exception when others then
    if sqlstate = '42501' then return; end if; -- expected: not admin, vendors.edit N
    raise exception 'case suspended viewer inserts a vendor: expected 42501, got % (%)', sqlstate, sqlerrm;
  end;
  raise exception 'case suspended viewer inserts a vendor must error failed';
end $$;

-- ================================================================ anon: zero rows or permission denied

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
declare t text; n bigint;
begin
  foreach t in array array['vendors', 'vendor_rates', 'vendor_bank'] loop
    begin
      execute format('select count(*) from public.%I', t) into strict n;
      if n <> 0 then raise exception 'case anon reads zero rows (%) failed', t; end if;
    exception when insufficient_privilege then
      if sqlerrm ilike '%function%' then
        raise exception 'case anon on % hit a policy function: %', t, sqlerrm;
      end if; -- else: table-level permission denied is acceptable
    end;
  end loop;
end $$;

-- ================================================================ runner: nothing was deleted, the copies are right

reset role;
set local request.jwt.claims = '';
do $$ begin
  if not ((select count(*) from public.vendors) = 4 and (select count(*) from public.vendor_rates) = 5
          and (select count(*) from public.vendor_bank) = 2 and (select count(*) from public.order_items where order_id = 181800) = 2) then
    raise exception 'case the refused deletes removed nothing failed';
  end if;
  if not ((select string_agg(woo_vendor_id || '=' || coalesce(commission_pct::text, '∅'), ',' order by woo_vendor_id)
           from public.vendors where woo_vendor_id in (441, 442)) = '441=35.00,442=25.00') then
    raise exception 'case commission_pct copies (441 → 35, 442 → 25) failed';
  end if;
end $$;

rollback;

do $$ begin raise notice 'rls_vendors: ok'; end $$;
