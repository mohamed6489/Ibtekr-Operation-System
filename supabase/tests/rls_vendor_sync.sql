-- RLS / permission / trigger tests for 0014_vendor_sync (the phase-3.3 columns of vendors with their column-list
-- grants and the widened guard vendors_guard_update, vendor_rates.flat, the tables vendor_category_rates and
-- woo_categories with their policies and grants, the server's own writes of the snapshot columns).
-- Depends on 0001_identity … 0014_vendor_sync.
-- Runs in one transaction and rolls back; prints NOTICE 'rls_vendor_sync: ok' only if every case passed.
-- Each case switches role explicitly: the runner (postgres) owns the tables, bypasses RLS and plays the trusted server
-- (service_role: the sync, push_vendor) — the guard applies to anon / authenticated only.
-- Live-safe: every count is scoped to the rows this file writes (the live project has 55 stores and real categories),
-- and the only `delete from` statements are run as text and expected to be refused (42501), like rls_vendors.sql.
-- Every phone, name, link and figure is made up.

begin;

-- Test users (fixed UUIDs …71–…76): admin, vendors follow-up (vendors.edit F / commission N), ops (vendors.edit P),
-- accounts (vendors.view F / edit N), cs (vendors.view P / edit N), suspended viewer. Every value comes from the
-- built-in matrix of 0003_seed_roles.
insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-000000000071', 'vs-admin.dev@ibtekr.local',    '01000000071'),
  ('00000000-0000-4000-8000-000000000072', 'vs-vf.dev@ibtekr.local',       '01000000072'),
  ('00000000-0000-4000-8000-000000000073', 'vs-ops.dev@ibtekr.local',      '01000000073'),
  ('00000000-0000-4000-8000-000000000074', 'vs-accounts.dev@ibtekr.local', '01000000074'),
  ('00000000-0000-4000-8000-000000000075', 'vs-cs.dev@ibtekr.local',       '01000000075'),
  ('00000000-0000-4000-8000-000000000076', 'vs-susp.dev@ibtekr.local',     '01000000076');

insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email)
from auth.users u
where u.id in ('00000000-0000-4000-8000-000000000071',
               '00000000-0000-4000-8000-000000000072',
               '00000000-0000-4000-8000-000000000073',
               '00000000-0000-4000-8000-000000000074',
               '00000000-0000-4000-8000-000000000075',
               '00000000-0000-4000-8000-000000000076');

insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-000000000071', 'أدمن المزامنة',        'vs-admin.dev@ibtekr.local',    '01000000071', 'admin',            'active',    '{}'),
  ('00000000-0000-4000-8000-000000000072', 'متابعة المزامنة',      'vs-vf.dev@ibtekr.local',       '01000000072', 'vendors_followup', 'active',    '{}'),
  ('00000000-0000-4000-8000-000000000073', 'عمليات المزامنة',      'vs-ops.dev@ibtekr.local',      '01000000073', 'ops',              'active',    '{}'),
  ('00000000-0000-4000-8000-000000000074', 'حسابات المزامنة',      'vs-accounts.dev@ibtekr.local', '01000000074', 'accounts',         'active',    '{}'),
  ('00000000-0000-4000-8000-000000000075', 'خدمة عملاء المزامنة',  'vs-cs.dev@ibtekr.local',       '01000000075', 'cs',               'active',    '{}'),
  ('00000000-0000-4000-8000-000000000076', 'مشاهد موقوف المزامنة', 'vs-susp.dev@ibtekr.local',     '01000000076', 'viewer',           'suspended', '{}');

-- Two Dokan stores as the phase-3.3 sync inserts them (the first with the full payload columns and a snapshot, the
-- second bare), one rate for the first; two site categories. Written by the runner, as the sync would.
insert into public.vendors (id, woo_vendor_id, name, phone, status, raw, joined_at, contact_name, address_parts, address, social,
                            logo_url, banner_url, woo_payment_methods, woo_snapshot, woo_synced_at) values
  ('00000000-0000-4000-8000-0000000000f1', 9941, 'ورشة المزامنة', '01000009941', 'active',
   '{"id":9941,"store_name":"ورشة المزامنة","shop_url":"https://stage.example.test/store/sync/","registered":"2025-03-01 10:00:00","enabled":true}',
   '2025-03-01', 'صاحب المزامنة', '{"street_1":"شارع 1","street_2":"","city":"القاهرة","state":"EG-01","zip":"","country":"EG"}', 'شارع 1، القاهرة، EG-01',
   '{"fb":"https://facebook.example/sync","instagram":"","twitter":"","youtube":"","linkedin":"","pinterest":"","threads":"","flickr":""}',
   'https://stage.example.test/g.jpg', 'https://stage.example.test/b.jpg', '{bank}',
   '{"name":"ورشة المزامنة","phone":"01000009941","email":null,"contact_name":"صاحب المزامنة","status":"active","rate":{"rate":30,"flat":null},"category_rates":[]}',
   '2026-10-27T12:00:00Z'),
  ('00000000-0000-4000-8000-0000000000f2', 9942, 'ورشة المزامنة التانية', null, 'active',
   '{"id":9942,"store_name":"ورشة المزامنة التانية"}', '2025-03-02', null, null, null, null, null, null, null, null, null);
-- an old updated_at on the second store so the guard's bump (now() = the transaction time) is observable below
update public.vendors set updated_at = '2026-01-01T00:00:00Z' where woo_vendor_id = 9942;

insert into public.vendor_rates (vendor_id, rate, flat, since, set_by) values
  ('00000000-0000-4000-8000-0000000000f1', 30, 2.5, '2026-10-01', 'الموقع');

insert into public.woo_categories (id, name, slug, parent_id) values
  (9900001, 'هدايا المزامنة', 'sync-gifts', null),
  (9900002, 'شموع المزامنة', 'sync-candles', 9900001);

-- ================================================================ runner: schema, keys, policies, grants, functions

do $$ begin
  -- vendors: the nine columns of 0014 with their types and nullability (no defaults).
  if not ((select string_agg(column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '∅'), ',' order by column_name)
           from information_schema.columns
           where table_schema = 'public' and table_name = 'vendors'
             and column_name in ('contact_name', 'address_parts', 'social', 'logo_url', 'banner_url', 'woo_payment_methods', 'woo_snapshot', 'push_pending', 'woo_synced_at'))
          = 'address_parts:jsonb:YES:∅,banner_url:text:YES:∅,contact_name:text:YES:∅,logo_url:text:YES:∅,push_pending:jsonb:YES:∅,'
            || 'social:jsonb:YES:∅,woo_payment_methods:ARRAY:YES:∅,woo_snapshot:jsonb:YES:∅,woo_synced_at:timestamp with time zone:YES:∅') then
    raise exception 'case vendors has the 9 columns of 0014 (types, nullability, no defaults) failed';
  end if;
  if not ((select udt_name from information_schema.columns where table_schema = 'public' and table_name = 'vendors' and column_name = 'woo_payment_methods') = '_text') then
    raise exception 'case vendors.woo_payment_methods is text[] failed';
  end if;
  -- vendor_rates.flat numeric(10,2), nullable, ≥ 0
  if not ((select numeric_precision || ',' || numeric_scale || ':' || is_nullable from information_schema.columns
           where table_schema = 'public' and table_name = 'vendor_rates' and column_name = 'flat') = '10,2:YES'
          and exists (select 1 from pg_constraint where conrelid = 'public.vendor_rates'::regclass and conname = 'vendor_rates_flat_check' and contype = 'c')) then
    raise exception 'case vendor_rates.flat numeric(10,2) nullable with its check failed';
  end if;
  -- vendor_category_rates / woo_categories: columns, keys, RLS
  if not ((select string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' order by ordinal_position)
           from information_schema.columns where table_schema = 'public' and table_name = 'vendor_category_rates')
          = 'id:bigint:NO,vendor_id:uuid:NO,woo_category_id:integer:NO,rate:numeric:YES,flat:numeric:YES,since:date:NO,set_by:text:YES,created_at:timestamp with time zone:NO') then
    raise exception 'case vendor_category_rates columns failed';
  end if;
  if not ((select string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' order by ordinal_position)
           from information_schema.columns where table_schema = 'public' and table_name = 'woo_categories')
          = 'id:integer:NO,name:text:NO,slug:text:YES,parent_id:integer:YES,updated_at:timestamp with time zone:NO') then
    raise exception 'case woo_categories columns failed';
  end if;
  if not ((select string_agg(c.conname || ':' || c.contype::text || ':' || (select string_agg(a.attname::text, ',' order by k.ord)
                                                                           from unnest(c.conkey) with ordinality k (attnum, ord)
                                                                           join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)
                             || ':' || coalesce((select relname::text from pg_class where oid = c.confrelid), '∅') || ':' || coalesce(nullif(c.confdeltype::text, ' '), '∅'), ',' order by c.conname)
           from pg_constraint c where c.conrelid = 'public.vendor_category_rates'::regclass and c.contype in ('p', 'u', 'f'))
          = 'vendor_category_rates_pkey:p:id:∅:∅,vendor_category_rates_vendor_id_fkey:f:vendor_id:vendors:c,'
            || 'vendor_category_rates_vendor_id_woo_category_id_since_key:u:vendor_id,woo_category_id,since:∅:∅') then
    raise exception 'case vendor_category_rates keys (pk id, unique (vendor_id, woo_category_id, since), fk vendors on delete cascade) failed';
  end if;
  if not ((select count(*) from pg_constraint where conrelid = 'public.woo_categories'::regclass and contype = 'f') = 0
          and (select conname from pg_constraint where conrelid = 'public.woo_categories'::regclass and contype = 'p') = 'woo_categories_pkey') then
    raise exception 'case woo_categories: pk id, no foreign key on parent_id failed';
  end if;
  if not ((select relrowsecurity from pg_class where oid = 'public.vendor_category_rates'::regclass)
          and (select relrowsecurity from pg_class where oid = 'public.woo_categories'::regclass)) then
    raise exception 'case vendor_category_rates / woo_categories have RLS enabled failed';
  end if;

  -- policies: vendor_category_rates select + insert with sensitive.commission = F; woo_categories select with
  -- vendors.view <> N; nothing else; vendors keeps its four.
  if not ((select string_agg(policyname || ':' || cmd || ':' || array_to_string(roles, '|'), ',' order by policyname)
           from pg_policies where schemaname = 'public' and tablename = 'vendor_category_rates')
          = 'vendor_category_rates_insert:INSERT:authenticated,vendor_category_rates_select:SELECT:authenticated'
          and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'vendor_category_rates'
               and coalesce(qual, with_check) like '%sensitive.commission%' and coalesce(qual, with_check) like '%''F''%') = 2) then
    raise exception 'case vendor_category_rates policies: select / insert with sensitive.commission = F, nothing else failed';
  end if;
  if not ((select string_agg(policyname || ':' || cmd || ':' || array_to_string(roles, '|'), ',' order by policyname)
           from pg_policies where schemaname = 'public' and tablename = 'woo_categories')
          = 'woo_categories_select:SELECT:authenticated'
          and (select qual from pg_policies where schemaname = 'public' and tablename = 'woo_categories') like '%vendors.view%') then
    raise exception 'case woo_categories policies: one select with vendors.view, no write failed';
  end if;
  if not ((select count(*) from pg_policies where schemaname = 'public' and tablename = 'vendors') = 4) then
    raise exception 'case vendors keeps exactly its four policies failed';
  end if;

  -- grants on vendors: the members read the eight new columns, never woo_snapshot; write the three contact columns
  -- only (insert + update); the server columns have no insert / update grant for them. service_role everything.
  if not (has_column_privilege('authenticated', 'public.vendors', 'contact_name', 'SELECT')
          and has_column_privilege('authenticated', 'public.vendors', 'address_parts', 'SELECT')
          and has_column_privilege('authenticated', 'public.vendors', 'social', 'SELECT')
          and has_column_privilege('authenticated', 'public.vendors', 'logo_url', 'SELECT')
          and has_column_privilege('authenticated', 'public.vendors', 'banner_url', 'SELECT')
          and has_column_privilege('authenticated', 'public.vendors', 'woo_payment_methods', 'SELECT')
          and has_column_privilege('authenticated', 'public.vendors', 'push_pending', 'SELECT')
          and has_column_privilege('authenticated', 'public.vendors', 'woo_synced_at', 'SELECT')
          and not has_column_privilege('authenticated', 'public.vendors', 'woo_snapshot', 'SELECT')
          and not has_column_privilege('authenticated', 'public.vendors', 'commission_pct', 'SELECT')
          and not has_table_privilege('authenticated', 'public.vendors', 'SELECT')) then
    raise exception 'case authenticated selects the 8 readable columns of 0014, never woo_snapshot failed';
  end if;
  if not (has_column_privilege('authenticated', 'public.vendors', 'contact_name', 'INSERT')
          and has_column_privilege('authenticated', 'public.vendors', 'address_parts', 'INSERT')
          and has_column_privilege('authenticated', 'public.vendors', 'social', 'INSERT')
          and has_column_privilege('authenticated', 'public.vendors', 'contact_name', 'UPDATE')
          and has_column_privilege('authenticated', 'public.vendors', 'address_parts', 'UPDATE')
          and has_column_privilege('authenticated', 'public.vendors', 'social', 'UPDATE')
          and has_column_privilege('authenticated', 'public.vendors', 'address', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.vendors', 'logo_url', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.vendors', 'banner_url', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.vendors', 'woo_payment_methods', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.vendors', 'woo_snapshot', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.vendors', 'push_pending', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.vendors', 'woo_synced_at', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.vendors', 'logo_url', 'INSERT')
          and not has_column_privilege('authenticated', 'public.vendors', 'push_pending', 'INSERT')
          and not has_column_privilege('authenticated', 'public.vendors', 'woo_snapshot', 'INSERT')) then
    raise exception 'case authenticated writes contact_name / address_parts / social (+ address) only; the server columns never failed';
  end if;
  if not (has_column_privilege('service_role', 'public.vendors', 'woo_snapshot', 'SELECT')
          and has_column_privilege('service_role', 'public.vendors', 'woo_snapshot', 'UPDATE')
          and has_column_privilege('service_role', 'public.vendors', 'push_pending', 'UPDATE')
          and has_column_privilege('service_role', 'public.vendors', 'logo_url', 'INSERT')
          and not has_table_privilege('service_role', 'public.vendors', 'TRUNCATE')
          and not has_column_privilege('anon', 'public.vendors', 'contact_name', 'SELECT')) then
    raise exception 'case service_role reads / writes the snapshot columns, anon nothing, no truncate failed';
  end if;
  -- vendor_rates.flat: covered by the table-level grants of 0011
  if not (has_column_privilege('authenticated', 'public.vendor_rates', 'flat', 'SELECT')
          and has_column_privilege('authenticated', 'public.vendor_rates', 'flat', 'INSERT')
          and not has_table_privilege('authenticated', 'public.vendor_rates', 'UPDATE')) then
    raise exception 'case vendor_rates.flat readable / insertable by the members, never updatable failed';
  end if;
  -- vendor_category_rates: members select the table, insert the six client columns (never id / created_at), never
  -- update / delete / truncate; the sequence usable; service_role everything but truncate; anon nothing.
  if not (has_table_privilege('authenticated', 'public.vendor_category_rates', 'SELECT')
          and not has_table_privilege('authenticated', 'public.vendor_category_rates', 'INSERT')
          and has_column_privilege('authenticated', 'public.vendor_category_rates', 'vendor_id', 'INSERT')
          and has_column_privilege('authenticated', 'public.vendor_category_rates', 'woo_category_id', 'INSERT')
          and has_column_privilege('authenticated', 'public.vendor_category_rates', 'rate', 'INSERT')
          and has_column_privilege('authenticated', 'public.vendor_category_rates', 'flat', 'INSERT')
          and has_column_privilege('authenticated', 'public.vendor_category_rates', 'since', 'INSERT')
          and has_column_privilege('authenticated', 'public.vendor_category_rates', 'set_by', 'INSERT')
          and not has_column_privilege('authenticated', 'public.vendor_category_rates', 'id', 'INSERT')
          and not has_column_privilege('authenticated', 'public.vendor_category_rates', 'created_at', 'INSERT')
          and not has_table_privilege('authenticated', 'public.vendor_category_rates', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.vendor_category_rates', 'rate', 'UPDATE')
          and not has_table_privilege('authenticated', 'public.vendor_category_rates', 'DELETE')
          and not has_table_privilege('authenticated', 'public.vendor_category_rates', 'TRUNCATE')
          and has_sequence_privilege('authenticated', 'public.vendor_category_rates_id_seq', 'USAGE')
          and has_sequence_privilege('service_role', 'public.vendor_category_rates_id_seq', 'USAGE')
          and has_table_privilege('service_role', 'public.vendor_category_rates', 'DELETE')
          and not has_table_privilege('service_role', 'public.vendor_category_rates', 'TRUNCATE')
          and not has_table_privilege('anon', 'public.vendor_category_rates', 'SELECT')) then
    raise exception 'case vendor_category_rates grants (members select + insert by column list + sequence, service_role all, anon none, no truncate) failed';
  end if;
  if not (has_table_privilege('authenticated', 'public.woo_categories', 'SELECT')
          and not has_table_privilege('authenticated', 'public.woo_categories', 'INSERT')
          and not has_column_privilege('authenticated', 'public.woo_categories', 'name', 'INSERT')
          and not has_table_privilege('authenticated', 'public.woo_categories', 'UPDATE')
          and not has_table_privilege('authenticated', 'public.woo_categories', 'DELETE')
          and not has_table_privilege('authenticated', 'public.woo_categories', 'TRUNCATE')
          and has_table_privilege('service_role', 'public.woo_categories', 'INSERT')
          and has_table_privilege('service_role', 'public.woo_categories', 'UPDATE')
          and not has_table_privilege('service_role', 'public.woo_categories', 'TRUNCATE')
          and not has_table_privilege('anon', 'public.woo_categories', 'SELECT')) then
    raise exception 'case woo_categories grants (members select only, service_role writes, anon none, no truncate) failed';
  end if;

  -- the guard: still one trigger on vendors, invoker, owned by postgres, search_path pinned, not executable by the API
  -- roles; its message names the new server columns.
  if not ((select string_agg(t.tgname || ':' || p.prosecdef || ':' || r.rolname, ',' order by t.tgname)
           from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid join pg_roles r on r.oid = p.proowner
           where not t.tgisinternal and c.relname = 'vendors' and t.tgname = 'vendors_guard_update')
          = 'vendors_guard_update:false:postgres'
          and (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and c.relname = 'vendors' and t.tgname = 'vendors_guard_update') = 1
          and not has_function_privilege('authenticated', 'public.vendors_guard_update()', 'EXECUTE')
          and not has_function_privilege('anon', 'public.vendors_guard_update()', 'EXECUTE')
          and (select proconfig from pg_proc where proname = 'vendors_guard_update' and pronamespace = 'public'::regnamespace) = array['search_path=public']
          and (select prosrc from pg_proc where proname = 'vendors_guard_update' and pronamespace = 'public'::regnamespace) like '%woo_snapshot%') then
    raise exception 'case the widened guard vendors_guard_update (one trigger, invoker, postgres, search_path, names woo_snapshot) failed';
  end if;
end $$;

-- check constraints and the keys (runner, bypassing RLS)
do $$
declare stmt text; code text;
begin
  for stmt, code in select * from (values
    ('insert into public.vendor_rates (vendor_id, rate, flat, since) values (''00000000-0000-4000-8000-0000000000f2'', 30, -1, current_date)', '23514'),
    ('insert into public.vendor_category_rates (vendor_id, woo_category_id, rate, since) values (''00000000-0000-4000-8000-0000000000f2'', 9900001, 66, current_date)', '23514'),
    ('insert into public.vendor_category_rates (vendor_id, woo_category_id, rate, flat, since) values (''00000000-0000-4000-8000-0000000000f2'', 9900001, 10, -0.5, current_date)', '23514'),
    ('insert into public.vendor_category_rates (vendor_id, woo_category_id, rate, since) values (''00000000-0000-4000-8000-0000000000f2'', 0, 10, current_date)', '23514'),
    ('insert into public.vendor_category_rates (vendor_id, woo_category_id, rate, since) values (''00000000-0000-4000-8000-000000000071'', 9900001, 10, current_date)', '23503'),
    ('insert into public.woo_categories (id, name) values (9900003, null)', '23502')
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
  -- the unique key: the same category on the same day twice → 23505 (a correction is a row with a later date)
  insert into public.vendor_category_rates (vendor_id, woo_category_id, rate, since, set_by) values ('00000000-0000-4000-8000-0000000000f2', 9900001, 10, current_date, 'الموقع');
  begin
    insert into public.vendor_category_rates (vendor_id, woo_category_id, rate, since) values ('00000000-0000-4000-8000-0000000000f2', 9900001, 11, current_date);
    raise exception 'case a second category rate on the same day must error failed';
  exception when others then
    if sqlstate <> '23505' then raise exception 'case a second category rate on the same day: expected 23505, got % (%)', sqlstate, sqlerrm; end if;
  end;
  -- rate null = removed from that date on; a later date for the same category is allowed
  insert into public.vendor_category_rates (vendor_id, woo_category_id, rate, since, set_by) values ('00000000-0000-4000-8000-0000000000f2', 9900001, null, current_date + 1, 'الموقع');
end $$;

-- ================================================================ runner: the server's own writes (the sync / push_vendor as service_role)

do $$ declare n int; begin
  update public.vendors
  set woo_snapshot = '{"name":"ورشة المزامنة التانية","phone":null,"email":null,"contact_name":null,"status":"active","rate":{"rate":null,"flat":null},"category_rates":[]}',
      push_pending = '["phone"]', woo_synced_at = now(), logo_url = 'https://stage.example.test/g2.jpg', woo_payment_methods = '{bank,paypal}',
      contact_name = 'صاحب من الموقع', address_parts = '{"street_1":"","street_2":"","city":"الجيزة","state":"","zip":"","country":"EG"}', address = 'الجيزة', status = 'inactive'
  where woo_vendor_id = 9942;
  get diagnostics n = row_count;
  if not (n = 1 and (select push_pending ->> 0 || '/' || contact_name || '/' || address || '/' || status || '/' || array_to_string(woo_payment_methods, ',') from public.vendors where woo_vendor_id = 9942)
                    = 'phone/صاحب من الموقع/الجيزة/inactive/bank,paypal'
          and (select updated_at from public.vendors where woo_vendor_id = 9942) = now()) then
    raise exception 'case the runner writes the snapshot / mirror / synced columns and status on an existing store (the guard passes, updated_at bumps) failed';
  end if;
  -- the site's rate on a change: a new vendor_rates row dated today, set_by «الموقع», with the flat fee
  insert into public.vendor_rates (vendor_id, rate, flat, since, set_by) values ('00000000-0000-4000-8000-0000000000f1', 35, 0, current_date, 'الموقع');
  if not ((select commission_pct from public.vendors where woo_vendor_id = 9941) = 35) then
    raise exception 'case a site rate row refreshes commission_pct (the 0011 trigger) failed';
  end if;
  -- a site-side change is one activity_log row with the field names only (actor null: no auth.uid() for the server)
  insert into public.activity_log (action, entity, entity_id, old_value, new_value) values ('vendor.sync', 'vendor', '00000000-0000-4000-8000-0000000000f2', null, to_jsonb('contact_name, address_parts, status'::text));
  if not ((select actor is null and new_value = to_jsonb('contact_name, address_parts, status'::text) from public.activity_log
           where action = 'vendor.sync' and entity_id = '00000000-0000-4000-8000-0000000000f2' order by id desc limit 1)) then
    raise exception 'case the server''s activity_log vendor.sync row (actor null, new_value = the field names) failed';
  end if;
end $$;

-- ================================================================ admin: reads the new columns, writes the contact ones and the category rates; never the server columns

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000071","role":"authenticated"}';
do $$ declare n int; begin
  -- the list, by column list (what the adapter selects now)
  if not ((select count(*) from (select id, woo_vendor_id, name, status, contact_name, address_parts, address, social, logo_url, banner_url,
                                        woo_payment_methods, push_pending, woo_synced_at
                                 from public.vendors where woo_vendor_id in (9941, 9942)) v) = 2
          and (select contact_name || '/' || (address_parts ->> 'city') || '/' || (social ->> 'fb') || '/' || logo_url || '/' || array_to_string(woo_payment_methods, ',')
               from public.vendors where woo_vendor_id = 9941) = 'صاحب المزامنة/القاهرة/https://facebook.example/sync/https://stage.example.test/g.jpg/bank'
          and (select push_pending ->> 0 from public.vendors where woo_vendor_id = 9942) = 'phone') then
    raise exception 'case admin reads the phase-3.3 columns by column list failed';
  end if;
  update public.vendors
  set contact_name = 'صاحب جديد', address_parts = '{"street_1":"شارع 2","street_2":"الدور 3","city":"القاهرة","state":"EG-01","zip":"","country":"EG"}',
      address = 'شارع 2، الدور 3، القاهرة، EG-01', social = '{"fb":"","instagram":"https://instagram.example/sync","twitter":"","youtube":"","linkedin":"","pinterest":"","threads":"","flickr":""}'
  where woo_vendor_id = 9941;
  get diagnostics n = row_count;
  if not (n = 1) then raise exception 'case admin changes contact_name / address_parts / address / social failed'; end if;
  -- a maker without a store, with the new columns (the popup)
  insert into public.vendors (name, aliases, category, contact_name, address_parts, address, social, lead_days, joined_at)
  values ('مبتكر المزامنة اليدوي', '{}', 'هدايا', 'صاحب يدوي', '{"street_1":"","street_2":"","city":"طنطا","state":"","zip":"","country":"EG"}', 'طنطا',
          '{"fb":"","instagram":"","twitter":"","youtube":"","linkedin":"","pinterest":"","threads":"","flickr":""}', 5, '2026-10-27');
  get diagnostics n = row_count;
  if not (n = 1 and (select contact_name || '/' || address from public.vendors where name = 'مبتكر المزامنة اليدوي') = 'صاحب يدوي/طنطا') then
    raise exception 'case admin inserts a maker with contact_name / address_parts / social failed';
  end if;
  -- the per-category commission (sensitive.commission F): two rows for one category at different dates + one for another; the file's rows only
  insert into public.vendor_category_rates (vendor_id, woo_category_id, rate, flat, since, set_by) values
    ('00000000-0000-4000-8000-0000000000f1', 9900001, 20, null, current_date - 5, 'أدمن المزامنة'),
    ('00000000-0000-4000-8000-0000000000f1', 9900001, 22, 1.5, current_date, 'أدمن المزامنة'),
    ('00000000-0000-4000-8000-0000000000f1', 9900002, 25, null, current_date, 'أدمن المزامنة');
  if not ((select string_agg(woo_category_id || '=' || coalesce(rate::text, '∅') || '/' || coalesce(flat::text, '∅'), ',' order by woo_category_id, since)
           from public.vendor_category_rates where vendor_id = '00000000-0000-4000-8000-0000000000f1')
          = '9900001=20.00/∅,9900001=22.00/1.50,9900002=25.00/∅') then
    raise exception 'case admin (sensitive.commission F) writes and reads vendor_category_rates failed';
  end if;
  if not ((select string_agg(coalesce(rate::text, '∅'), ',' order by since) from public.vendor_category_rates where vendor_id = '00000000-0000-4000-8000-0000000000f2') = '10.00,∅') then
    raise exception 'case admin reads the runner''s category rows (the removal row with rate null) failed';
  end if;
  -- the flat fee on vendor_rates (display only)
  insert into public.vendor_rates (vendor_id, rate, flat, since, set_by) values ('00000000-0000-4000-8000-0000000000f2', 40, 3, current_date, 'أدمن المزامنة');
  if not ((select flat from public.vendor_rates where vendor_id = '00000000-0000-4000-8000-0000000000f2' and since = current_date) = 3) then
    raise exception 'case admin writes vendor_rates.flat failed';
  end if;
  -- the category names
  if not ((select string_agg(id || ':' || name || ':' || coalesce(parent_id::text, '∅'), ',' order by id) from public.woo_categories where id in (9900001, 9900002))
          = '9900001:هدايا المزامنة:∅,9900002:شموع المزامنة:9900001') then
    raise exception 'case admin reads woo_categories failed';
  end if;
end $$;

-- The server columns are not writable, with any value, admin included (column grants, then the guard): 42501. Nor is
-- the snapshot readable, nor the two new tables editable or deletable, nor woo_categories writable.
do $$
declare stmt text;
begin
  foreach stmt in array array[
    'update public.vendors set logo_url = ''https://x.example/l.jpg'' where woo_vendor_id = 9941',
    'update public.vendors set banner_url = null where woo_vendor_id = 9941',
    'update public.vendors set woo_payment_methods = ''{cash}'' where woo_vendor_id = 9941',
    'update public.vendors set woo_snapshot = ''{}'' where woo_vendor_id = 9941',
    'update public.vendors set push_pending = ''[]'' where woo_vendor_id = 9942',
    'update public.vendors set woo_synced_at = now() where woo_vendor_id = 9941',
    'update public.vendors set contact_name = ''x'', woo_synced_at = now() where woo_vendor_id = 9941',
    'insert into public.vendors (name, logo_url) values (''مبتكر بلوجو'', ''https://x.example/l.jpg'')',
    'select woo_snapshot from public.vendors where woo_vendor_id = 9941',
    'select * from public.vendors',
    'update public.vendor_category_rates set rate = 1 where vendor_id = ''00000000-0000-4000-8000-0000000000f1''',
    'delete from public.vendor_category_rates where vendor_id = ''00000000-0000-4000-8000-0000000000f1''',
    'insert into public.vendor_category_rates (id, vendor_id, woo_category_id, rate, since) values (1, ''00000000-0000-4000-8000-0000000000f1'', 9900002, 1, current_date + 9)',
    'update public.vendor_rates set flat = 1 where vendor_id = ''00000000-0000-4000-8000-0000000000f1''',
    'insert into public.woo_categories (id, name) values (9900003, ''من الأدمن'')',
    'update public.woo_categories set name = ''x'' where id = 9900001',
    'delete from public.woo_categories where id = 9900001'] loop
    begin
      execute stmt;
      raise exception 'case admin on a server column / table must error failed: %', stmt;
    exception when others then
      if sqlstate <> '42501' then -- expected: no privilege on the column / table
        raise exception 'case admin on a server column / table: expected 42501, got % (%) for %', sqlstate, sqlerrm, stmt;
      end if;
    end;
  end loop;
end $$;

-- ================================================================ vendors follow-up: edit F — the contact columns yes; the category rates hidden (commission N)

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000072","role":"authenticated"}';
do $$ declare n int; begin
  update public.vendors set contact_name = 'صاحب المتابعة', social = '{"fb":"https://facebook.example/vf","instagram":"","twitter":"","youtube":"","linkedin":"","pinterest":"","threads":"","flickr":""}' where woo_vendor_id = 9941;
  get diagnostics n = row_count;
  if not (n = 1) then raise exception 'case vendors follow-up (vendors.edit F) changes contact_name / social failed'; end if;
  if not ((select count(*) from public.vendor_category_rates) = 0) then
    raise exception 'case vendors follow-up (commission N) reads zero vendor_category_rates rows failed';
  end if;
  if not ((select count(*) from public.woo_categories where id in (9900001, 9900002)) = 2) then
    raise exception 'case vendors follow-up (vendors.view F) reads woo_categories failed';
  end if;
end $$;

do $$
declare stmt text; needle text;
begin
  for stmt, needle in select * from (values
    ('insert into public.vendor_category_rates (vendor_id, woo_category_id, rate, since) values (''00000000-0000-4000-8000-0000000000f1'', 9900002, 30, current_date + 1)', 'policy'),
    ('update public.vendors set push_pending = null where woo_vendor_id = 9942', 'permission denied'),
    ('update public.vendors set status = ''active'' where woo_vendor_id = 9942', 'vendors.toggle')
  ) as v (stmt, needle) loop
    begin
      execute stmt;
      raise exception 'case vendors follow-up must error failed: %', stmt;
    exception when others then
      if sqlstate <> '42501' or sqlerrm not like '%' || needle || '%' then
        raise exception 'case vendors follow-up: expected 42501 mentioning %, got % (%) for %', needle, sqlstate, sqlerrm, stmt;
      end if;
    end;
  end loop;
end $$;

-- ================================================================ ops: edit P — the contact columns yes (the guard's contact rule); name no

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000073","role":"authenticated"}';
do $$ declare n int; begin
  update public.vendors
  set contact_name = 'صاحب العمليات', address_parts = '{"street_1":"شارع 3","street_2":"","city":"القاهرة","state":"EG-01","zip":"","country":"EG"}', address = 'شارع 3، القاهرة، EG-01',
      social = '{"fb":"","instagram":"","twitter":"","youtube":"","linkedin":"","pinterest":"","threads":"","flickr":""}'
  where woo_vendor_id = 9941;
  get diagnostics n = row_count;
  if not (n = 1) then raise exception 'case ops (vendors.edit P) changes contact_name / address_parts / address / social failed'; end if;
  if not ((select count(*) from public.vendor_category_rates) = 0) then
    raise exception 'case ops (commission N) reads zero vendor_category_rates rows failed';
  end if;
end $$;

do $$
declare stmt text; needle text;
begin
  for stmt, needle in select * from (values
    ('update public.vendors set contact_name = ''x'', name = ''اسم من العمليات'' where woo_vendor_id = 9941', 'vendors.edit = F'),
    ('update public.vendors set woo_synced_at = now() where woo_vendor_id = 9941', 'permission denied'),
    ('insert into public.vendor_category_rates (vendor_id, woo_category_id, rate, since) values (''00000000-0000-4000-8000-0000000000f1'', 9900002, 30, current_date + 2)', 'policy')
  ) as v (stmt, needle) loop
    begin
      execute stmt;
      raise exception 'case ops must error failed: %', stmt;
    exception when others then
      if sqlstate <> '42501' or sqlerrm not like '%' || needle || '%' then
        raise exception 'case ops: expected 42501 mentioning %, got % (%) for %', needle, sqlstate, sqlerrm, stmt;
      end if;
    end;
  end loop;
end $$;

-- ================================================================ accounts: edit N — reads the columns and the category names; writes none of the contact columns

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000074","role":"authenticated"}';
do $$ begin
  if not ((select contact_name from public.vendors where woo_vendor_id = 9941) = 'صاحب العمليات'
          and (select count(*) from public.woo_categories where id in (9900001, 9900002)) = 2
          and (select count(*) from public.vendor_category_rates) = 0) then
    raise exception 'case accounts (vendors.view F, commission N) reads the contact columns and woo_categories, zero category rates failed';
  end if;
end $$;

do $$
declare stmt text; needle text;
begin
  for stmt, needle in select * from (values
    ('update public.vendors set contact_name = ''من الحسابات'' where woo_vendor_id = 9941', 'vendors.edit (F or P)'),
    ('update public.vendors set address_parts = ''{}'' where woo_vendor_id = 9941', 'vendors.edit (F or P)'),
    ('update public.vendors set social = ''{}'' where woo_vendor_id = 9941', 'vendors.edit (F or P)')
  ) as v (stmt, needle) loop
    begin
      execute stmt;
      raise exception 'case accounts must error failed: %', stmt;
    exception when others then
      if sqlstate <> '42501' or sqlerrm not like '%' || needle || '%' then
        raise exception 'case accounts: expected 42501 mentioning %, got % (%) for %', needle, sqlstate, sqlerrm, stmt;
      end if;
    end;
  end loop;
end $$;

-- ================================================================ cs: vendors.view P — reads, writes nothing

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000075","role":"authenticated"}';
do $$ begin
  if not ((select count(*) from public.vendors where woo_vendor_id in (9941, 9942)) = 2
          and (select count(*) from public.woo_categories where id in (9900001, 9900002)) = 2
          and (select count(*) from public.vendor_category_rates) = 0) then
    raise exception 'case cs (vendors.view P) reads the makers and woo_categories, zero category rates failed';
  end if;
end $$;

do $$
declare stmt text;
begin
  foreach stmt in array array[
    'update public.vendors set contact_name = ''x'' where woo_vendor_id = 9941',
    'update public.vendors set social = ''{}'' where woo_vendor_id = 9941',
    'insert into public.vendor_category_rates (vendor_id, woo_category_id, rate, since) values (''00000000-0000-4000-8000-0000000000f1'', 9900002, 30, current_date + 3)',
    'insert into public.woo_categories (id, name) values (9900004, ''من خدمة العملاء'')'] loop
    begin
      execute stmt;
      raise exception 'case cs writes must error failed: %', stmt;
    exception when others then
      if sqlstate <> '42501' then
        raise exception 'case cs writes: expected 42501, got % (%) for %', sqlstate, sqlerrm, stmt;
      end if;
    end;
  end loop;
end $$;

-- ================================================================ suspended viewer: nothing

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000076","role":"authenticated"}';
do $$ begin
  if not ((select count(*) from public.vendors) = 0 and (select count(*) from public.vendor_category_rates) = 0 and (select count(*) from public.woo_categories) = 0) then
    raise exception 'case suspended viewer reads zero rows of vendors / vendor_category_rates / woo_categories failed';
  end if;
end $$;

-- ================================================================ anon: zero rows or permission denied

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
declare t text; n bigint;
begin
  foreach t in array array['vendors', 'vendor_category_rates', 'woo_categories'] loop
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

-- ================================================================ runner: the refused writes left the rows as they were; nothing was deleted

reset role;
set local request.jwt.claims = '';
do $$ begin
  if not ((select contact_name || '/' || (address_parts ->> 'street_1') || '/' || logo_url || '/' || coalesce(woo_snapshot ->> 'name', '∅') from public.vendors where woo_vendor_id = 9941)
          = 'صاحب العمليات/شارع 3/https://stage.example.test/g.jpg/ورشة المزامنة'
          and (select push_pending ->> 0 from public.vendors where woo_vendor_id = 9942) = 'phone'
          and (select count(*) from public.vendor_category_rates where vendor_id in ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000f2')) = 5
          and (select count(*) from public.woo_categories where id in (9900001, 9900002)) = 2
          and (select name from public.woo_categories where id = 9900001) = 'هدايا المزامنة'
          and (select count(*) from public.vendors where woo_vendor_id in (9941, 9942) or name = 'مبتكر المزامنة اليدوي') = 3) then
    raise exception 'case the refused writes changed nothing and nothing was deleted failed';
  end if;
end $$;

rollback;

do $$ begin raise notice 'rls_vendor_sync: ok'; end $$;
