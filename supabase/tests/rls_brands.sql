-- RLS / permission / trigger / function tests for 0013_brands (the tables brands / brand_owners / brand_rates with
-- their column-list grants and policies, the guards brands_guard / brand_owners_guard, the automatic brand of every
-- new maker (vendors_brand_after_insert) and its backfill function, the owner lookups brand_owner_at /
-- store_owner_at, the delete rules: 23503 for a maker in another maker's brand history, the cascade for the origin).
-- Depends on 0001_identity … 0013_brands.
-- Runs in one transaction and rolls back; prints NOTICE 'rls_brands: ok' only if every case passed.
-- Each case switches role explicitly: the runner (postgres) owns the tables, bypasses RLS and plays the trusted server
-- (service_role, the sync) — the guards apply to anon / authenticated only.
-- Live-safe: every count is scoped to the rows this file writes (the live project has 56 makers and 56 brands), and
-- the only statements that remove rows are the deletes of this file's own makers, run as text like rls_vendors.sql:
-- two are expected to be refused (23503) and the third — the cascade of a maker this file created, with their own
-- brands — is undone by the rollback at the end. Every name and e-mail is made up.
-- (The delete guard vendors_brands_guard_delete of 0013 is tested here too: it is the only path through which the
-- cascade of a maker's own brands can complete — see the decision in 0013's header.)

begin;

-- Test users (fixed UUIDs …61–…66): admin, vendors follow-up (vendors.edit F / commission N), ops (vendors.edit P),
-- accounts (vendors.view F / edit N; sensitive.commission F by custom_perms — the built-in matrix of 0003 gives the
-- key to the admin only, and the override is how a non-admin reaches brand_rates), an active viewer (vendors.view P),
-- a suspended viewer. Every other value comes from the built-in matrix of 0003_seed_roles.
insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-000000000061', 'br-admin.dev@ibtekr.local',    '01000000061'),
  ('00000000-0000-4000-8000-000000000062', 'br-vf.dev@ibtekr.local',       '01000000062'),
  ('00000000-0000-4000-8000-000000000063', 'br-ops.dev@ibtekr.local',      '01000000063'),
  ('00000000-0000-4000-8000-000000000064', 'br-accounts.dev@ibtekr.local', '01000000064'),
  ('00000000-0000-4000-8000-000000000065', 'br-viewer.dev@ibtekr.local',   '01000000065'),
  ('00000000-0000-4000-8000-000000000066', 'br-susp.dev@ibtekr.local',     '01000000066');

insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email)
from auth.users u
where u.id in ('00000000-0000-4000-8000-000000000061',
               '00000000-0000-4000-8000-000000000062',
               '00000000-0000-4000-8000-000000000063',
               '00000000-0000-4000-8000-000000000064',
               '00000000-0000-4000-8000-000000000065',
               '00000000-0000-4000-8000-000000000066');

insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-000000000061', 'أدمن البراندات',        'br-admin.dev@ibtekr.local',    '01000000061', 'admin',            'active',    '{}'),
  ('00000000-0000-4000-8000-000000000062', 'متابعة البراندات',      'br-vf.dev@ibtekr.local',       '01000000062', 'vendors_followup', 'active',    '{}'),
  ('00000000-0000-4000-8000-000000000063', 'عمليات البراندات',      'br-ops.dev@ibtekr.local',      '01000000063', 'ops',              'active',    '{}'),
  ('00000000-0000-4000-8000-000000000064', 'حسابات البراندات',      'br-accounts.dev@ibtekr.local', '01000000064', 'accounts',         'active',    '{"sensitive.commission":"F"}'),
  ('00000000-0000-4000-8000-000000000065', 'مشاهد البراندات',       'br-viewer.dev@ibtekr.local',   '01000000065', 'viewer',           'active',    '{}'),
  ('00000000-0000-4000-8000-000000000066', 'مشاهد موقوف البراندات', 'br-susp.dev@ibtekr.local',     '01000000066', 'viewer',           'suspended', '{}');

-- The makers of this file (fixed UUIDs …f1–…f5), written by the runner as the sync / the server would — the
-- after-insert trigger makes their brands: f1 a store (its name padded: the brand takes the trimmed name), f2 a
-- hand-added maker without a joining date, f3 a store whose name is f1's (lower / btrim) → no automatic brand, f4 and
-- f5 hand-added makers that will receive f1's brand. woo_vendor_id 9961 / 9963 collide with nothing on the live
-- registry (Dokan ids are small).
insert into public.vendors (id, woo_vendor_id, name, aliases, status, joined_at) values
  ('00000000-0000-4000-8000-0000000000f1', 9961, ' Test Brand Store ', '{"TBS"}', 'active', '2025-03-01'),
  ('00000000-0000-4000-8000-0000000000f2', null, 'براند الاختبار',     '{}',      'active', null),
  ('00000000-0000-4000-8000-0000000000f3', 9963, 'test brand store',   '{}',      'active', '2025-04-01'),
  ('00000000-0000-4000-8000-0000000000f4', null, 'ورشة النقل',         '{}',      'active', '2025-05-01'),
  ('00000000-0000-4000-8000-0000000000f5', null, 'مبتكر الرجوع',       '{}',      'active', '2025-06-01');

-- A brand the server wrote by hand for f4 with an old updated_at (the guard's bump is checked below).
insert into public.brands (name, code, aliases, origin_vendor_id, created_by, updated_at)
values ('Test Old Brand', 'TOB', '{}', '00000000-0000-4000-8000-0000000000f4', 'السيرفر', '2020-01-01T00:00:00Z');
insert into public.brand_owners (brand_id, vendor_id, since, set_by)
values ((select id from public.brands where name = 'Test Old Brand'), '00000000-0000-4000-8000-0000000000f4', '2025-05-01', 'السيرفر');

-- The ids of the automatic brands, for the blocks that cannot read them (the suspended member, anon).
do $$ begin
  perform set_config('rls_brands.b1', (select id::text from public.brands where store_vendor_id = '00000000-0000-4000-8000-0000000000f1'), true);
  perform set_config('rls_brands.b2', (select id::text from public.brands where origin_vendor_id = '00000000-0000-4000-8000-0000000000f2'), true);
end $$;

-- ================================================================ runner: schema, keys, policies, grants, triggers, functions

do $$ begin
  -- brands: the 9 columns of decision 2 with their types, nullability and defaults
  if not ((select string_agg(column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '∅'), ',' order by ordinal_position)
           from information_schema.columns where table_schema = 'public' and table_name = 'brands')
          = 'id:uuid:NO:gen_random_uuid(),name:text:NO:∅,code:text:NO:∅,aliases:ARRAY:NO:''{}''::text[],store_vendor_id:uuid:YES:∅,'
            || 'origin_vendor_id:uuid:NO:∅,created_by:text:YES:∅,created_at:timestamp with time zone:NO:now(),updated_at:timestamp with time zone:NO:now()') then
    raise exception 'case brands has the 9 columns of decision 2 (types, nullability, defaults) failed: %',
      (select string_agg(column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '∅'), ',' order by ordinal_position)
       from information_schema.columns where table_schema = 'public' and table_name = 'brands');
  end if;
  -- brand_owners: 8 columns; brand_rates: 6 columns, rate numeric(5,2) nullable
  if not ((select string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' order by ordinal_position)
           from information_schema.columns where table_schema = 'public' and table_name = 'brand_owners')
          = 'id:bigint:NO,brand_id:uuid:NO,vendor_id:uuid:NO,since:date:NO,return_on:date:YES,reason:text:YES,set_by:text:YES,created_at:timestamp with time zone:NO') then
    raise exception 'case brand_owners has the 8 columns of decision 2 failed: %',
      (select string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' order by ordinal_position)
       from information_schema.columns where table_schema = 'public' and table_name = 'brand_owners');
  end if;
  if not ((select string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' order by ordinal_position)
           from information_schema.columns where table_schema = 'public' and table_name = 'brand_rates')
          = 'id:bigint:NO,brand_id:uuid:NO,rate:numeric:YES,since:date:NO,set_by:text:YES,created_at:timestamp with time zone:NO'
          and (select numeric_precision || ',' || numeric_scale from information_schema.columns
               where table_schema = 'public' and table_name = 'brand_rates' and column_name = 'rate') = '5,2') then
    raise exception 'case brand_rates has the 6 columns of decision 2 (rate numeric(5,2) nullable) failed';
  end if;
  -- keys: conname:contype:columns:referenced table:on delete ('c' = cascade, 'a' = no action)
  if not ((select string_agg(c.conname || ':' || c.contype::text || ':' || (select string_agg(a.attname::text, ',' order by k.ord)
                                                                           from unnest(c.conkey) with ordinality k (attnum, ord)
                                                                           join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)
                             || ':' || coalesce((select relname::text from pg_class where oid = c.confrelid), '∅') || ':' || coalesce(nullif(c.confdeltype::text, ' '), '∅'), ',' order by c.conname)
           from pg_constraint c where c.conrelid = 'public.brands'::regclass)
          = 'brands_code_check:c:code:∅:∅,brands_name_check:c:name:∅:∅,brands_origin_vendor_id_fkey:f:origin_vendor_id:vendors:c,brands_pkey:p:id:∅:∅,'
            || 'brands_store_vendor_id_fkey:f:store_vendor_id:vendors:c,brands_store_vendor_id_key:u:store_vendor_id:∅:∅') then
    raise exception 'case brands keys (pk id, store_vendor_id unique + fk vendors cascade, origin fk vendors cascade, the two checks) failed: %',
      (select string_agg(c.conname || ':' || c.contype::text || ':' || coalesce(nullif(c.confdeltype::text, ' '), '∅'), ',' order by c.conname)
       from pg_constraint c where c.conrelid = 'public.brands'::regclass);
  end if;
  if not ((select string_agg(c.conname || ':' || c.contype::text || ':' || (select string_agg(a.attname::text, ',' order by k.ord)
                                                                           from unnest(c.conkey) with ordinality k (attnum, ord)
                                                                           join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)
                             || ':' || coalesce((select relname::text from pg_class where oid = c.confrelid), '∅') || ':' || coalesce(nullif(c.confdeltype::text, ' '), '∅'), ',' order by c.conname)
           from pg_constraint c where c.conrelid = 'public.brand_owners'::regclass)
          = 'brand_owners_brand_id_fkey:f:brand_id:brands:c,brand_owners_brand_id_since_key:u:brand_id,since:∅:∅,brand_owners_pkey:p:id:∅:∅,'
            || 'brand_owners_reason_check:c:reason:∅:∅,brand_owners_return_on_check:c:return_on,since:∅:∅,brand_owners_vendor_id_fkey:f:vendor_id:vendors:a') then
    raise exception 'case brand_owners keys (pk id, unique (brand_id, since), brand fk cascade, vendor fk WITHOUT cascade, the two checks) failed: %',
      (select string_agg(c.conname || ':' || c.contype::text || ':' || coalesce(nullif(c.confdeltype::text, ' '), '∅'), ',' order by c.conname)
       from pg_constraint c where c.conrelid = 'public.brand_owners'::regclass);
  end if;
  if not ((select string_agg(c.conname || ':' || c.contype::text || ':' || (select string_agg(a.attname::text, ',' order by k.ord)
                                                                           from unnest(c.conkey) with ordinality k (attnum, ord)
                                                                           join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)
                             || ':' || coalesce((select relname::text from pg_class where oid = c.confrelid), '∅') || ':' || coalesce(nullif(c.confdeltype::text, ' '), '∅'), ',' order by c.conname)
           from pg_constraint c where c.conrelid = 'public.brand_rates'::regclass)
          = 'brand_rates_brand_id_fkey:f:brand_id:brands:c,brand_rates_brand_id_since_key:u:brand_id,since:∅:∅,brand_rates_pkey:p:id:∅:∅,brand_rates_rate_check:c:rate:∅:∅') then
    raise exception 'case brand_rates keys (pk id, unique (brand_id, since), brand fk cascade, the rate check) failed: %',
      (select string_agg(c.conname || ':' || c.contype::text || ':' || coalesce(nullif(c.confdeltype::text, ' '), '∅'), ',' order by c.conname)
       from pg_constraint c where c.conrelid = 'public.brand_rates'::regclass);
  end if;
  -- the no-cascade key is deferrable (initially immediate): the delete guard defers it for the origin's cascade
  if not ((select condeferrable and not condeferred from pg_constraint where conname = 'brand_owners_vendor_id_fkey' and conrelid = 'public.brand_owners'::regclass)
          and not (select condeferrable from pg_constraint where conname = 'brand_owners_brand_id_fkey' and conrelid = 'public.brand_owners'::regclass)) then
    raise exception 'case brand_owners_vendor_id_fkey is deferrable initially immediate (the brand key is not) failed';
  end if;
  -- the unique index on lower(btrim(name))
  if not exists (select 1 from pg_indexes
                 where schemaname = 'public' and tablename = 'brands' and indexname = 'brands_name_key'
                   and indexdef like 'CREATE UNIQUE INDEX%(lower(btrim(name)))') then
    raise exception 'case brands has a unique index on lower(btrim(name)) failed';
  end if;
  if not ((select relrowsecurity from pg_class where oid = 'public.brands'::regclass)
          and (select relrowsecurity from pg_class where oid = 'public.brand_owners'::regclass)
          and (select relrowsecurity from pg_class where oid = 'public.brand_rates'::regclass)) then
    raise exception 'case brands / brand_owners / brand_rates have RLS enabled failed';
  end if;

  -- policies: brands select / insert / update, brand_owners select / insert, brand_rates select / insert — all to
  -- authenticated; no delete, no update on the two history tables.
  if not ((select string_agg(tablename || '.' || policyname || ':' || cmd || ':' || array_to_string(roles, '|'), ',' order by tablename, policyname)
           from pg_policies where schemaname = 'public' and tablename in ('brands', 'brand_owners', 'brand_rates'))
          = 'brand_owners.brand_owners_insert:INSERT:authenticated,brand_owners.brand_owners_select:SELECT:authenticated,'
            || 'brand_rates.brand_rates_insert:INSERT:authenticated,brand_rates.brand_rates_select:SELECT:authenticated,'
            || 'brands.brands_insert:INSERT:authenticated,brands.brands_select:SELECT:authenticated,brands.brands_update:UPDATE:authenticated') then
    raise exception 'case the seven policies of 0013 (no delete, no update on brand_owners / brand_rates) failed: %',
      (select string_agg(tablename || '.' || policyname || ':' || cmd, ',' order by tablename, policyname)
       from pg_policies where schemaname = 'public' and tablename in ('brands', 'brand_owners', 'brand_rates'));
  end if;
  if not ((select qual from pg_policies where schemaname = 'public' and tablename = 'brands' and policyname = 'brands_select') like '%vendors.view%'
          and (select with_check from pg_policies where schemaname = 'public' and tablename = 'brands' and policyname = 'brands_insert') like '%is_admin%vendors.edit%''F''%'
          and (select qual from pg_policies where schemaname = 'public' and tablename = 'brands' and policyname = 'brands_update') like '%vendors.view%'
          and (select with_check from pg_policies where schemaname = 'public' and tablename = 'brands' and policyname = 'brands_update') like '%is_admin%vendors.edit%''F''%'
          and (select qual from pg_policies where schemaname = 'public' and tablename = 'brand_owners' and policyname = 'brand_owners_select') like '%vendors.view%'
          and (select with_check from pg_policies where schemaname = 'public' and tablename = 'brand_owners' and policyname = 'brand_owners_insert') like '%is_admin%vendors.edit%''F''%'
          and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'brand_rates'
               and coalesce(qual, with_check) like '%sensitive.commission%' and coalesce(qual, with_check) like '%''F''%') = 2) then
    raise exception 'case the policies read vendors.view / is_admin or vendors.edit = F / sensitive.commission = F failed';
  end if;

  -- grants for authenticated: select on every column of the three tables; insert by column list; update on brands'
  -- name / code / aliases only; nothing else; no truncate / references / trigger for anyone; anon nothing.
  if not (has_table_privilege('authenticated', 'public.brands', 'SELECT')
          and has_table_privilege('authenticated', 'public.brand_owners', 'SELECT')
          and has_table_privilege('authenticated', 'public.brand_rates', 'SELECT')
          and not has_table_privilege('authenticated', 'public.brands', 'INSERT')
          and not has_table_privilege('authenticated', 'public.brands', 'UPDATE')
          and not has_table_privilege('authenticated', 'public.brand_owners', 'INSERT')
          and not has_table_privilege('authenticated', 'public.brand_rates', 'INSERT')) then
    raise exception 'case authenticated selects the three tables whole and writes by column list only failed';
  end if;
  if not ((select string_agg(column_name, ',' order by column_name) from information_schema.column_privileges
           where grantee = 'authenticated' and table_schema = 'public' and table_name = 'brands' and privilege_type = 'INSERT')
          = 'aliases,code,created_by,name,origin_vendor_id'
          and (select string_agg(column_name, ',' order by column_name) from information_schema.column_privileges
               where grantee = 'authenticated' and table_schema = 'public' and table_name = 'brands' and privilege_type = 'UPDATE')
              = 'aliases,code,name'
          and (select string_agg(column_name, ',' order by column_name) from information_schema.column_privileges
               where grantee = 'authenticated' and table_schema = 'public' and table_name = 'brand_owners' and privilege_type = 'INSERT')
              = 'brand_id,reason,return_on,set_by,since,vendor_id'
          and (select string_agg(column_name, ',' order by column_name) from information_schema.column_privileges
               where grantee = 'authenticated' and table_schema = 'public' and table_name = 'brand_rates' and privilege_type = 'INSERT')
              = 'brand_id,rate,set_by,since'
          and (select count(*) from information_schema.column_privileges
               where grantee = 'authenticated' and table_schema = 'public' and table_name in ('brand_owners', 'brand_rates') and privilege_type = 'UPDATE') = 0) then
    raise exception 'case the insert / update column lists of decision 2 failed: brands insert %, update %, owners insert %, rates insert %',
      (select string_agg(column_name, ',' order by column_name) from information_schema.column_privileges where grantee = 'authenticated' and table_schema = 'public' and table_name = 'brands' and privilege_type = 'INSERT'),
      (select string_agg(column_name, ',' order by column_name) from information_schema.column_privileges where grantee = 'authenticated' and table_schema = 'public' and table_name = 'brands' and privilege_type = 'UPDATE'),
      (select string_agg(column_name, ',' order by column_name) from information_schema.column_privileges where grantee = 'authenticated' and table_schema = 'public' and table_name = 'brand_owners' and privilege_type = 'INSERT'),
      (select string_agg(column_name, ',' order by column_name) from information_schema.column_privileges where grantee = 'authenticated' and table_schema = 'public' and table_name = 'brand_rates' and privilege_type = 'INSERT');
  end if;
  if not (not has_column_privilege('authenticated', 'public.brands', 'store_vendor_id', 'INSERT')
          and not has_column_privilege('authenticated', 'public.brands', 'store_vendor_id', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.brands', 'origin_vendor_id', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.brands', 'id', 'INSERT')
          and not has_column_privilege('authenticated', 'public.brand_owners', 'since', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.brand_rates', 'rate', 'UPDATE')) then
    raise exception 'case the server columns (store_vendor_id, origin_vendor_id, id) and the history rows are not writable by members failed';
  end if;
  if not (not has_table_privilege('authenticated', 'public.brands', 'DELETE')
          and not has_table_privilege('authenticated', 'public.brand_owners', 'DELETE')
          and not has_table_privilege('authenticated', 'public.brand_rates', 'DELETE')
          and not has_table_privilege('authenticated', 'public.brands', 'TRUNCATE')
          and not has_table_privilege('authenticated', 'public.brands', 'REFERENCES')
          and not has_table_privilege('authenticated', 'public.brands', 'TRIGGER')
          and not has_table_privilege('authenticated', 'public.brand_owners', 'TRUNCATE')
          and not has_table_privilege('authenticated', 'public.brand_rates', 'TRUNCATE')
          and has_sequence_privilege('authenticated', 'public.brand_owners_id_seq', 'USAGE')
          and has_sequence_privilege('authenticated', 'public.brand_rates_id_seq', 'USAGE')
          and has_table_privilege('service_role', 'public.brands', 'SELECT')
          and has_table_privilege('service_role', 'public.brands', 'INSERT')
          and has_table_privilege('service_role', 'public.brands', 'UPDATE')
          and has_table_privilege('service_role', 'public.brands', 'DELETE')
          and has_table_privilege('service_role', 'public.brand_owners', 'DELETE')
          and has_table_privilege('service_role', 'public.brand_rates', 'DELETE')
          and has_sequence_privilege('service_role', 'public.brand_owners_id_seq', 'USAGE')
          and not has_table_privilege('service_role', 'public.brands', 'TRUNCATE')
          and not has_table_privilege('service_role', 'public.brands', 'REFERENCES')
          and not has_table_privilege('service_role', 'public.brands', 'TRIGGER')
          and not has_table_privilege('service_role', 'public.brand_owners', 'TRUNCATE')
          and not has_table_privilege('service_role', 'public.brand_rates', 'TRUNCATE')
          and not has_table_privilege('anon', 'public.brands', 'SELECT')
          and not has_column_privilege('anon', 'public.brands', 'name', 'SELECT')
          and not has_table_privilege('anon', 'public.brand_owners', 'SELECT')
          and not has_table_privilege('anon', 'public.brand_rates', 'SELECT')) then
    raise exception 'case grants (no delete / truncate / references / trigger for members, service_role all but truncate, sequences usable, anon none) failed';
  end if;

  -- triggers: the three guards (before, invoker, owner postgres) and the vendors insert trigger (after insert, definer)
  if not ((select string_agg(t.tgname || ':' || c.relname || ':' || p.proname || ':' || p.prosecdef::text || ':' || r.rolname || ':' || t.tgtype::text, ',' order by t.tgname)
           from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid join pg_roles r on r.oid = p.proowner
           where not t.tgisinternal and t.tgname in ('brands_guard', 'brand_owners_guard', 'vendors_brand_after_insert', 'vendors_brands_guard_delete'))
          = 'brand_owners_guard:brand_owners:brand_owners_guard:false:postgres:7,' -- 7 = row + before + insert
            || 'brands_guard:brands:brands_guard:false:postgres:19,'               -- 19 = row + before + update
            || 'vendors_brand_after_insert:vendors:vendors_brand_after_insert:true:postgres:5,' -- 5 = row + after + insert
            || 'vendors_brands_guard_delete:vendors:vendors_brands_guard_delete:false:postgres:11') then -- 11 = row + before + delete
    raise exception 'case triggers brands_guard (before update), brand_owners_guard (before insert), vendors_brand_after_insert (after insert, definer), vendors_brands_guard_delete (before delete) failed: %',
      coalesce((select string_agg(t.tgname || ':' || c.relname || ':' || p.proname || ':' || p.prosecdef::text || ':' || t.tgtype::text, ',' order by t.tgname)
                from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid
                where not t.tgisinternal and t.tgname in ('brands_guard', 'brand_owners_guard', 'vendors_brand_after_insert', 'vendors_brands_guard_delete')), '<none>');
  end if;
  if not (not has_function_privilege('authenticated', 'public.brands_guard()', 'EXECUTE')
          and not has_function_privilege('anon', 'public.brands_guard()', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.brand_owners_guard()', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.vendors_brand_after_insert()', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.vendors_brands_guard_delete()', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.vendor_brand_auto(uuid)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.vendor_brand_auto(uuid)', 'EXECUTE')) then
    raise exception 'case the API roles cannot execute the trigger functions nor vendor_brand_auto failed';
  end if;
  if not ((select string_agg(p.proname || ':' || p.prosecdef::text || ':' || r.rolname || ':' || p.provolatile::text || ':' || coalesce(array_to_string(p.proconfig, ';'), '∅'), ',' order by p.proname)
           from pg_proc p join pg_roles r on r.oid = p.proowner
           where p.proname in ('brands_guard', 'brand_owners_guard', 'vendors_brand_after_insert', 'vendors_brands_guard_delete', 'vendor_brand_auto') and p.pronamespace = 'public'::regnamespace)
          = 'brand_owners_guard:false:postgres:v:search_path=public,brands_guard:false:postgres:v:search_path=public,'
            || 'vendor_brand_auto:true:postgres:v:search_path=public,vendors_brand_after_insert:true:postgres:v:search_path=public,'
            || 'vendors_brands_guard_delete:false:postgres:v:search_path=public') then
    raise exception 'case the five trigger-side functions pin search_path = public (the two definers owned by postgres) failed';
  end if;
  -- the two lookups: stable, invoker, owned by postgres, search_path pinned, executable by authenticated / service_role only
  if not ((select string_agg(p.proname || ':' || p.prosecdef::text || ':' || r.rolname || ':' || p.provolatile::text || ':' || coalesce(array_to_string(p.proconfig, ';'), '∅'), ',' order by p.proname)
           from pg_proc p join pg_roles r on r.oid = p.proowner
           where p.oid in ('public.brand_owner_at(uuid, date)'::regprocedure, 'public.store_owner_at(uuid, date)'::regprocedure))
          = 'brand_owner_at:false:postgres:s:search_path=public,store_owner_at:false:postgres:s:search_path=public') then
    raise exception 'case brand_owner_at / store_owner_at are stable, invoker, owned by postgres, search_path = public failed: %',
      (select string_agg(p.proname || ':' || p.prosecdef::text || ':' || r.rolname || ':' || p.provolatile::text || ':' || coalesce(array_to_string(p.proconfig, ';'), '∅'), ',' order by p.proname)
       from pg_proc p join pg_roles r on r.oid = p.proowner where p.proname in ('brand_owner_at', 'store_owner_at'));
  end if;
  if not (has_function_privilege('authenticated', 'public.brand_owner_at(uuid, date)', 'EXECUTE')
          and has_function_privilege('service_role', 'public.brand_owner_at(uuid, date)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.brand_owner_at(uuid, date)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.store_owner_at(uuid, date)', 'EXECUTE')
          and has_function_privilege('service_role', 'public.store_owner_at(uuid, date)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.store_owner_at(uuid, date)', 'EXECUTE')
          and (select proacl from pg_proc where oid = 'public.brand_owner_at(uuid, date)'::regprocedure) is not null
          and (select proacl from pg_proc where oid = 'public.store_owner_at(uuid, date)'::regprocedure) is not null) then
    raise exception 'case the two lookups run for authenticated / service_role only (no public, no anon) failed';
  end if;
end $$;

-- ================================================================ runner: the automatic brands, the taken name, the backfill re-run

do $$ declare n int; begin
  -- f1 (a store): the trimmed name, code T, the maker's aliases, tied to the store, origin the store, created_by system;
  -- one owner row since the joining date, set_by system
  if not ((select b.name || '/' || b.code || '/' || array_to_string(b.aliases, '|') || '/' || coalesce(b.store_vendor_id::text, '∅') || '/' || b.origin_vendor_id::text || '/' || coalesce(b.created_by, '∅')
           from public.brands b where b.origin_vendor_id = '00000000-0000-4000-8000-0000000000f1')
          = 'Test Brand Store/T/TBS/00000000-0000-4000-8000-0000000000f1/00000000-0000-4000-8000-0000000000f1/system'
          and (select string_agg(o.vendor_id::text || '/' || o.since::text || '/' || coalesce(o.return_on::text, '∅') || '/' || coalesce(o.set_by, '∅'), ',' order by o.since)
               from public.brand_owners o where o.brand_id = current_setting('rls_brands.b1')::uuid)
              = '00000000-0000-4000-8000-0000000000f1/2025-03-01/∅/system') then
    raise exception 'case a store insert makes its brand (name, code T, aliases, store_vendor_id, origin, system) and the first owner row since joined_at failed: % / %',
      coalesce((select b.name || '/' || b.code || '/' || array_to_string(b.aliases, '|') || '/' || coalesce(b.store_vendor_id::text, '∅') || '/' || coalesce(b.created_by, '∅')
                from public.brands b where b.origin_vendor_id = '00000000-0000-4000-8000-0000000000f1'), '<no brand>'),
      coalesce((select string_agg(o.vendor_id::text || '/' || o.since::text, ',') from public.brand_owners o where o.brand_id = current_setting('rls_brands.b1')::uuid), '<no owner>');
  end if;
  -- f2 (hand-added, no joining date): code X (no Latin letter), no store, owner since today
  if not ((select b.name || '/' || b.code || '/' || array_to_string(b.aliases, '|') || '/' || coalesce(b.store_vendor_id::text, '∅') || '/' || coalesce(b.created_by, '∅')
           from public.brands b where b.origin_vendor_id = '00000000-0000-4000-8000-0000000000f2')
          = 'براند الاختبار/X//∅/system'
          and (select o.vendor_id::text || '/' || (o.since = current_date)::text from public.brand_owners o where o.brand_id = current_setting('rls_brands.b2')::uuid)
              = '00000000-0000-4000-8000-0000000000f2/true') then
    raise exception 'case a hand-added insert makes a brand without a store (code X, owner since today) failed';
  end if;
  -- f3 (a store named like f1, lower / btrim): inserted, no automatic brand
  if not ((select count(*) from public.vendors where id = '00000000-0000-4000-8000-0000000000f3') = 1
          and not exists (select 1 from public.brands b where b.origin_vendor_id = '00000000-0000-4000-8000-0000000000f3' or b.store_vendor_id = '00000000-0000-4000-8000-0000000000f3')) then
    raise exception 'case a taken name leaves the maker without an automatic brand (the insert itself goes through) failed';
  end if;
  -- f4 / f5: brands of their names, code X; f4 also has the server's hand brand
  if not ((select string_agg(b.origin_vendor_id::text || '=' || b.name || '/' || b.code || '/' || coalesce(b.store_vendor_id::text, '∅'), ',' order by b.origin_vendor_id, b.name)
           from public.brands b where b.origin_vendor_id in ('00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-0000000000f5'))
          = '00000000-0000-4000-8000-0000000000f4=Test Old Brand/TOB/∅,00000000-0000-4000-8000-0000000000f4=ورشة النقل/X/∅,00000000-0000-4000-8000-0000000000f5=مبتكر الرجوع/X/∅') then
    raise exception 'case f4 / f5 got their automatic brands next to the hand one failed: %',
      (select string_agg(b.origin_vendor_id::text || '=' || b.name || '/' || b.code, ',' order by b.origin_vendor_id, b.name)
       from public.brands b where b.origin_vendor_id in ('00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-0000000000f5'));
  end if;
  -- the backfill re-run (the migration's statement, scoped to this file's makers): nothing new — every maker with a
  -- brand is skipped, and f3's name is still taken
  if (select count(*) from (select public.vendor_brand_auto(v.id) as made from public.vendors v
                            where v.id in ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000f3',
                                           '00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-0000000000f5')
                              and not exists (select 1 from public.brands b where b.origin_vendor_id = v.id or b.store_vendor_id = v.id)) x where x.made) <> 0
     or (select public.vendor_brand_auto('00000000-0000-4000-8000-0000000000f1')) or (select public.vendor_brand_auto('00000000-0000-4000-8000-0000000000f3')) then
    raise exception 'case the backfill run again inserts nothing (makers with a brand skipped, the taken name still skipped) failed';
  end if;
  if not ((select count(*) from public.brands where origin_vendor_id in ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-0000000000f5')) = 5
          and (select count(*) from public.brand_owners o join public.brands b on b.id = o.brand_id
               where b.origin_vendor_id in ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-0000000000f5')) = 5) then
    raise exception 'case this file has 5 brands (4 automatic + 1 hand) with one owner row each failed';
  end if;
  -- the lookups as the runner: the first (and only) owner, whatever the date; a store without a brand is its own owner
  if not (public.brand_owner_at(current_setting('rls_brands.b1')::uuid, '2020-01-01') = '00000000-0000-4000-8000-0000000000f1'
          and public.brand_owner_at(current_setting('rls_brands.b1')::uuid, '2025-03-01') = '00000000-0000-4000-8000-0000000000f1'
          and public.brand_owner_at(current_setting('rls_brands.b1')::uuid, null) = '00000000-0000-4000-8000-0000000000f1'
          and public.store_owner_at('00000000-0000-4000-8000-0000000000f1', current_date) = '00000000-0000-4000-8000-0000000000f1'
          and public.store_owner_at('00000000-0000-4000-8000-0000000000f3', current_date) = '00000000-0000-4000-8000-0000000000f3'
          and public.store_owner_at('00000000-0000-4000-8000-0000000000f2', current_date) = '00000000-0000-4000-8000-0000000000f2'
          and public.store_owner_at('00000000-0000-4000-8000-0000000000ff', current_date) = '00000000-0000-4000-8000-0000000000ff'
          and public.brand_owner_at('00000000-0000-4000-8000-0000000000ff', current_date) is null) then
    raise exception 'case brand_owner_at / store_owner_at before any transfer (the first owner; a store without a brand is itself; an unknown brand is null) failed';
  end if;
end $$;

-- check constraints, the unique keys, the foreign keys (runner, bypassing RLS)
do $$
declare stmt text; code text;
begin
  for stmt, code in select * from (values
    ('insert into public.brands (name, code, origin_vendor_id) values ('''', ''A'', ''00000000-0000-4000-8000-0000000000f2'')', '23514'),
    ('insert into public.brands (name, code, origin_vendor_id) values (''   '', ''A'', ''00000000-0000-4000-8000-0000000000f2'')', '23514'),
    ('insert into public.brands (name, code, origin_vendor_id) values (repeat(''x'', 81), ''A'', ''00000000-0000-4000-8000-0000000000f2'')', '23514'),
    ('insert into public.brands (name, code, origin_vendor_id) values (''Test Code'', ''abc'', ''00000000-0000-4000-8000-0000000000f2'')', '23514'),
    ('insert into public.brands (name, code, origin_vendor_id) values (''Test Code'', ''ABCD'', ''00000000-0000-4000-8000-0000000000f2'')', '23514'),
    ('insert into public.brands (name, code, origin_vendor_id) values (''Test Code'', '''', ''00000000-0000-4000-8000-0000000000f2'')', '23514'),
    ('insert into public.brands (name, code, origin_vendor_id) values ('' TEST BRAND STORE '', ''T'', ''00000000-0000-4000-8000-0000000000f2'')', '23505'),
    ('insert into public.brands (name, code, origin_vendor_id, store_vendor_id) values (''Test Second Store Brand'', ''T'', ''00000000-0000-4000-8000-0000000000f1'', ''00000000-0000-4000-8000-0000000000f1'')', '23505'),
    ('insert into public.brands (name, code, origin_vendor_id) values (''Test Orphan'', ''T'', ''00000000-0000-4000-8000-000000000061'')', '23503'),
    ('insert into public.brand_owners (brand_id, vendor_id, since, return_on) values (current_setting(''rls_brands.b1'')::uuid, ''00000000-0000-4000-8000-0000000000f4'', ''2026-01-10'', ''2026-01-10'')', '23514'),
    ('insert into public.brand_owners (brand_id, vendor_id, since, return_on) values (current_setting(''rls_brands.b1'')::uuid, ''00000000-0000-4000-8000-0000000000f4'', ''2026-01-10'', ''2026-01-09'')', '23514'),
    ('insert into public.brand_owners (brand_id, vendor_id, since, reason) values (current_setting(''rls_brands.b1'')::uuid, ''00000000-0000-4000-8000-0000000000f4'', ''2026-01-10'', repeat(''س'', 201))', '23514'),
    ('insert into public.brand_owners (brand_id, vendor_id, since) values (current_setting(''rls_brands.b1'')::uuid, ''00000000-0000-4000-8000-000000000061'', ''2026-01-10'')', '23503'),
    ('insert into public.brand_owners (brand_id, vendor_id, since) values (''00000000-0000-4000-8000-0000000000ff'', ''00000000-0000-4000-8000-0000000000f4'', ''2026-01-10'')', '23503'),
    ('insert into public.brand_owners (brand_id, vendor_id, since) values (current_setting(''rls_brands.b1'')::uuid, ''00000000-0000-4000-8000-0000000000f4'', ''2025-03-01'')', '23505'),
    ('insert into public.brand_rates (brand_id, rate, since) values (current_setting(''rls_brands.b1'')::uuid, 66, current_date)', '23514'),
    ('insert into public.brand_rates (brand_id, rate, since) values (current_setting(''rls_brands.b1'')::uuid, -1, current_date)', '23514'),
    ('insert into public.brand_rates (brand_id, rate, since) values (''00000000-0000-4000-8000-0000000000ff'', 10, current_date)', '23503')
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

-- ================================================================ admin: a hand brand, rates, the first transfer, the guards, the server columns

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated"}';
do $$ declare n int; b1 uuid := current_setting('rls_brands.b1')::uuid; b2 uuid := current_setting('rls_brands.b2')::uuid; b6 uuid; begin
  -- the list, by column list (what the adapter selects), scoped to this file's makers
  if not ((select count(*) from (select id, name, code, aliases, store_vendor_id, origin_vendor_id, created_by, created_at, updated_at from public.brands
                                 where origin_vendor_id in ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-0000000000f5')) b) = 5
          and (select count(*) from (select id, brand_id, vendor_id, since, return_on, reason, set_by, created_at from public.brand_owners where brand_id in (b1, b2)) o) = 2
          and (select count(*) from (select id, brand_id, rate, since, set_by, created_at from public.brand_rates where brand_id in (b1, b2)) r) = 0) then
    raise exception 'case admin reads brands / brand_owners / brand_rates by column list failed';
  end if;
  -- a hand brand for f2 (the popup): name, code, aliases, origin, created_by — then its first owner row and a rate
  insert into public.brands (name, code, aliases, origin_vendor_id, created_by)
  values ('Test Brand', 'TB', '{"TB alias"}', '00000000-0000-4000-8000-0000000000f2', 'أدمن البراندات')
  returning id into b6;
  insert into public.brand_owners (brand_id, vendor_id, since, set_by) values (b6, '00000000-0000-4000-8000-0000000000f2', '2026-01-01', 'أدمن البراندات');
  insert into public.brand_rates (brand_id, rate, since, set_by) values (b6, 30, '2026-01-01', 'أدمن البراندات');
  -- a special rate on the automatic brand of f2 from January, withdrawn (null) from today; one on f1's brand
  insert into public.brand_rates (brand_id, rate, since, set_by) values
    (b2, 40, '2026-01-01', 'أدمن البراندات'),
    (b2, null, current_date, 'أدمن البراندات'),
    (b1, 20, '2026-02-01', 'أدمن البراندات');
  if not ((select string_agg(coalesce(rate::text, '∅'), ',' order by since) from public.brand_rates where brand_id = b2) = '40.00,∅'
          and (select coalesce(created_by, '∅') || '/' || coalesce(store_vendor_id::text, '∅') || '/' || (created_at = updated_at)::text from public.brands where id = b6) = 'أدمن البراندات/∅/true') then
    raise exception 'case admin adds a hand brand (no store), its owner row and rates (a null rate withdraws the special one) failed';
  end if;
  -- the client columns of a brand; the guard bumps updated_at (the server wrote Test Old Brand with 2020-01-01)
  update public.brands set name = 'Test Brand 2', code = 'TB2', aliases = '{"TB2 alias"}' where id = b6;
  get diagnostics n = row_count;
  if not (n = 1) then raise exception 'case admin changes a brand name / code / aliases failed'; end if;
  update public.brands set aliases = '{"old"}' where name = 'Test Old Brand';
  get diagnostics n = row_count;
  if not (n = 1 and (select updated_at = now() and updated_at > '2021-01-01' from public.brands where name = 'Test Old Brand')) then
    raise exception 'case a member''s brand update bumps updated_at failed';
  end if;
  -- the first transfer: f1's brand to f4 from 2026-01-10, for good
  insert into public.brand_owners (brand_id, vendor_id, since, reason, set_by)
  values (b1, '00000000-0000-4000-8000-0000000000f4', '2026-01-10', 'نقل دائم للاختبار', 'أدمن البراندات');
  if not (public.brand_owner_at(b1, '2026-01-09') = '00000000-0000-4000-8000-0000000000f1'
          and public.brand_owner_at(b1, '2026-01-10') = '00000000-0000-4000-8000-0000000000f4'
          and public.brand_owner_at(b1, '2020-01-01') = '00000000-0000-4000-8000-0000000000f1'
          and public.brand_owner_at(b1, null) = '00000000-0000-4000-8000-0000000000f4'
          and public.store_owner_at('00000000-0000-4000-8000-0000000000f1', '2026-01-09') = '00000000-0000-4000-8000-0000000000f1'
          and public.store_owner_at('00000000-0000-4000-8000-0000000000f1', '2026-01-10') = '00000000-0000-4000-8000-0000000000f4'
          and public.store_owner_at('00000000-0000-4000-8000-0000000000f1', null) = '00000000-0000-4000-8000-0000000000f4'
          and public.store_owner_at('00000000-0000-4000-8000-0000000000f3', '2026-01-10') = '00000000-0000-4000-8000-0000000000f3') then
    raise exception 'case after a transfer from 2026-01-10: the day before → f1, from that day → f4 (brand_owner_at / store_owner_at) failed: % / %',
      public.brand_owner_at(b1, '2026-01-09'), public.brand_owner_at(b1, '2026-01-10');
  end if;
end $$;

-- The owners guard (22023), the unique date (23505), the server columns and the history rows (42501 from the column
-- grants — the guards are the layer beneath), delete (42501) — admin included.
do $$
declare stmt text; code text; needle text;
begin
  for stmt, code, needle in select * from (values
    ('insert into public.brand_owners (brand_id, vendor_id, since) values (current_setting(''rls_brands.b1'')::uuid, ''00000000-0000-4000-8000-0000000000f5'', ''2026-01-05'')', '22023', 'since before the last transfer'),
    ('insert into public.brand_owners (brand_id, vendor_id, since) values (current_setting(''rls_brands.b1'')::uuid, ''00000000-0000-4000-8000-0000000000f4'', ''2026-02-01'')', '22023', 'same vendor'),
    ('insert into public.brand_owners (brand_id, vendor_id, since) values (current_setting(''rls_brands.b1'')::uuid, ''00000000-0000-4000-8000-0000000000f1'', ''2026-01-10'')', '23505', 'brand_owners_brand_id_since_key'),
    ('insert into public.brand_owners (brand_id, vendor_id, since, return_on) values (current_setting(''rls_brands.b1'')::uuid, ''00000000-0000-4000-8000-0000000000f5'', ''2026-02-01'', ''2026-02-01'')', '23514', 'brand_owners_return_on_check'),
    ('insert into public.brands (name, code, origin_vendor_id) values (''test brand store'', ''T'', ''00000000-0000-4000-8000-0000000000f2'')', '23505', 'brands_name_key'),
    ('update public.brands set store_vendor_id = ''00000000-0000-4000-8000-0000000000f3'' where id = current_setting(''rls_brands.b2'')::uuid', '42501', 'permission denied'),
    ('update public.brands set store_vendor_id = null where id = current_setting(''rls_brands.b1'')::uuid', '42501', 'permission denied'),
    ('update public.brands set origin_vendor_id = ''00000000-0000-4000-8000-0000000000f4'' where id = current_setting(''rls_brands.b2'')::uuid', '42501', 'permission denied'),
    ('update public.brands set created_by = ''x'' where id = current_setting(''rls_brands.b2'')::uuid', '42501', 'permission denied'),
    ('update public.brands set created_at = now() where id = current_setting(''rls_brands.b2'')::uuid', '42501', 'permission denied'),
    ('update public.brands set updated_at = now() where id = current_setting(''rls_brands.b2'')::uuid', '42501', 'permission denied'),
    ('update public.brands set id = gen_random_uuid() where id = current_setting(''rls_brands.b2'')::uuid', '42501', 'permission denied'),
    ('insert into public.brands (name, code, origin_vendor_id, store_vendor_id) values (''Test Planted Store'', ''T'', ''00000000-0000-4000-8000-0000000000f2'', ''00000000-0000-4000-8000-0000000000f3'')', '42501', 'permission denied'),
    ('insert into public.brands (id, name, code, origin_vendor_id) values (gen_random_uuid(), ''Test Planted Id'', ''T'', ''00000000-0000-4000-8000-0000000000f2'')', '42501', 'permission denied'),
    ('update public.brand_owners set since = ''2026-01-11'' where brand_id = current_setting(''rls_brands.b1'')::uuid', '42501', 'permission denied'),
    ('update public.brand_owners set vendor_id = ''00000000-0000-4000-8000-0000000000f5'' where brand_id = current_setting(''rls_brands.b1'')::uuid', '42501', 'permission denied'),
    ('update public.brand_rates set rate = 1 where brand_id = current_setting(''rls_brands.b1'')::uuid', '42501', 'permission denied'),
    ('delete from public.brands where id = current_setting(''rls_brands.b2'')::uuid', '42501', 'permission denied'),
    ('delete from public.brand_owners where brand_id = current_setting(''rls_brands.b1'')::uuid', '42501', 'permission denied'),
    ('delete from public.brand_rates where brand_id = current_setting(''rls_brands.b1'')::uuid', '42501', 'permission denied')
  ) as v (stmt, code, needle) loop
    begin
      execute stmt;
      raise exception 'case admin must error failed: %', stmt;
    exception when others then
      if sqlstate <> code or sqlerrm not like '%' || needle || '%' then -- expected: the guard's rule, the key or the column grant
        raise exception 'case admin: expected % mentioning %, got % (%) for %', code, needle, sqlstate, sqlerrm, stmt;
      end if;
    end;
  end loop;
end $$;

-- Delete: the admin reaches the maker (the policy lets them), and the brand history of another maker refuses it
-- (the delete guard, 23503, naming the key) — f4 holds f1's brand now; its own brands would cascade.
do $$ begin
  begin
    execute 'delete from public.vendors where id = ''00000000-0000-4000-8000-0000000000f4''';
    raise exception 'case admin deletes a maker holding another maker''s brand must error failed';
  exception when others then
    if sqlstate <> '23503' or sqlerrm not like '%brand_owners_vendor_id_fkey%' then
      raise exception 'case admin deletes a maker holding another maker''s brand: expected 23503 on brand_owners_vendor_id_fkey, got % (%)', sqlstate, sqlerrm;
    end if;
  end;
  if not ((select count(*) from public.vendors where id = '00000000-0000-4000-8000-0000000000f4') = 1
          and (select count(*) from public.brands where origin_vendor_id = '00000000-0000-4000-8000-0000000000f4') = 2) then
    raise exception 'case the refused delete left the maker and their own brands as they were failed';
  end if;
end $$;

-- ================================================================ vendors follow-up: edit F — transfers, the popup path of the trigger; no rates

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000062","role":"authenticated"}';
do $$ declare n int; b1 uuid := current_setting('rls_brands.b1')::uuid; b2 uuid := current_setting('rls_brands.b2')::uuid; begin
  if not ((select count(*) from public.brands where origin_vendor_id in ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-0000000000f5')) = 6
          and (select count(*) from public.brand_owners where brand_id = b1) = 2
          and (select count(*) from public.brand_rates where brand_id in (b1, b2)) = 0) then
    raise exception 'case vendors follow-up (vendors.view F, commission N) reads brands / owners and zero brand_rates rows failed';
  end if;
  -- a temporary transfer: f1's brand to f5 from 2026-03-01, back on 2026-04-01
  insert into public.brand_owners (brand_id, vendor_id, since, return_on, reason, set_by)
  values (b1, '00000000-0000-4000-8000-0000000000f5', '2026-03-01', '2026-04-01', 'إجازة', 'متابعة البراندات');
  get diagnostics n = row_count;
  if not (n = 1 and public.brand_owner_at(b1, '2026-03-15') = '00000000-0000-4000-8000-0000000000f5'
          and public.brand_owner_at(b1, '2026-02-28') = '00000000-0000-4000-8000-0000000000f4'
          and public.store_owner_at('00000000-0000-4000-8000-0000000000f1', '2026-03-15') = '00000000-0000-4000-8000-0000000000f5') then
    raise exception 'case a temporary transfer (with return_on) makes the receiver the owner from its date failed';
  end if;
  -- the return, on the return date, to the maker who held it before (f4)
  insert into public.brand_owners (brand_id, vendor_id, since, reason, set_by)
  values (b1, '00000000-0000-4000-8000-0000000000f4', '2026-04-01', 'رجوع', 'متابعة البراندات');
  if not (public.brand_owner_at(b1, '2026-03-31') = '00000000-0000-4000-8000-0000000000f5'
          and public.brand_owner_at(b1, '2026-04-01') = '00000000-0000-4000-8000-0000000000f4'
          and public.brand_owner_at(b1, '2026-09-01') = '00000000-0000-4000-8000-0000000000f4'
          and public.store_owner_at('00000000-0000-4000-8000-0000000000f1', '2026-04-01') = '00000000-0000-4000-8000-0000000000f4') then
    raise exception 'case the return row gives the brand back from its date failed';
  end if;
  -- the popup path of the trigger (authenticated insert): a brand of the maker's name, owner since joined_at
  insert into public.vendors (name, aliases, category, lead_days, joined_at) values ('Test Popup Maker', '{"TPM"}', 'هدايا', 7, '2026-10-01');
  get diagnostics n = row_count;
  if not (n = 1 and (select b.name || '/' || b.code || '/' || array_to_string(b.aliases, '|') || '/' || coalesce(b.store_vendor_id::text, '∅') || '/' || coalesce(b.created_by, '∅') || '/' || o.since::text || '/' || coalesce(o.set_by, '∅')
                     from public.vendors v join public.brands b on b.origin_vendor_id = v.id join public.brand_owners o on o.brand_id = b.id and o.vendor_id = v.id
                     where v.name = 'Test Popup Maker' and v.woo_vendor_id is null) = 'Test Popup Maker/T/TPM/∅/system/2026-10-01/system') then
    raise exception 'case a maker inserted from the popup gets an automatic brand (the trigger runs as its owner) failed: %',
      coalesce((select b.name || '/' || b.code || '/' || coalesce(o.since::text, '∅') from public.vendors v left join public.brands b on b.origin_vendor_id = v.id
                left join public.brand_owners o on o.brand_id = b.id where v.name = 'Test Popup Maker' and v.woo_vendor_id is null), '<no brand>');
  end if;
  -- a maker whose name is taken by a brand (f4's): inserted, no brand, no error
  insert into public.vendors (name, category) values ('ورشة النقل', 'هدايا');
  get diagnostics n = row_count;
  if not (n = 1 and (select count(*) from public.vendors where name = 'ورشة النقل' and woo_vendor_id is null) = 2
          and (select count(*) from public.brands b join public.vendors v on v.id = b.origin_vendor_id where v.name = 'ورشة النقل') = 2) then -- f4's two, nothing for the new one
    raise exception 'case a popup maker with a taken name is inserted without a brand failed';
  end if;
  -- edit F: a brand's client columns
  update public.brands set aliases = '{"الاختبار"}' where id = b2;
  get diagnostics n = row_count;
  if not (n = 1) then raise exception 'case vendors follow-up (vendors.edit F) changes a brand''s aliases failed'; end if;
end $$;

do $$
declare stmt text; code text; needle text;
begin
  for stmt, code, needle in select * from (values
    ('insert into public.brand_owners (brand_id, vendor_id, since) values (current_setting(''rls_brands.b1'')::uuid, ''00000000-0000-4000-8000-0000000000f5'', ''2026-03-15'')', '22023', 'since before the last transfer'),
    ('insert into public.brand_owners (brand_id, vendor_id, since) values (current_setting(''rls_brands.b1'')::uuid, ''00000000-0000-4000-8000-0000000000f4'', ''2026-05-01'')', '22023', 'same vendor'),
    ('insert into public.brand_rates (brand_id, rate, since) values (current_setting(''rls_brands.b1'')::uuid, 25, current_date)', '42501', 'policy'),
    ('update public.brands set store_vendor_id = null where id = current_setting(''rls_brands.b1'')::uuid', '42501', 'permission denied'),
    ('update public.brand_owners set return_on = null where brand_id = current_setting(''rls_brands.b1'')::uuid', '42501', 'permission denied'),
    ('delete from public.brands where id = current_setting(''rls_brands.b2'')::uuid', '42501', 'permission denied')
  ) as v (stmt, code, needle) loop
    begin
      execute stmt;
      raise exception 'case vendors follow-up must error failed: %', stmt;
    exception when others then
      if sqlstate <> code or sqlerrm not like '%' || needle || '%' then
        raise exception 'case vendors follow-up: expected % mentioning %, got % (%) for %', code, needle, sqlstate, sqlerrm, stmt;
      end if;
    end;
  end loop;
end $$;

-- ================================================================ ops: edit P — reads brands / owners, writes nothing, no rates

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000063","role":"authenticated"}';
do $$
declare stmt text; needle text; b1 uuid := current_setting('rls_brands.b1')::uuid; b2 uuid := current_setting('rls_brands.b2')::uuid;
begin
  if not ((select count(*) from public.brands where origin_vendor_id in ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-0000000000f5')) = 6
          and (select string_agg(vendor_id::text || '/' || since::text || '/' || coalesce(return_on::text, '∅'), ',' order by since) from public.brand_owners where brand_id = b1)
              = '00000000-0000-4000-8000-0000000000f1/2025-03-01/∅,00000000-0000-4000-8000-0000000000f4/2026-01-10/∅,00000000-0000-4000-8000-0000000000f5/2026-03-01/2026-04-01,00000000-0000-4000-8000-0000000000f4/2026-04-01/∅'
          and (select count(*) from public.brand_rates where brand_id in (b1, b2)) = 0
          and public.brand_owner_at(b1, '2026-03-15') = '00000000-0000-4000-8000-0000000000f5'
          and public.store_owner_at('00000000-0000-4000-8000-0000000000f1', current_date) = '00000000-0000-4000-8000-0000000000f4') then
    raise exception 'case ops (vendors.view F, edit P, commission N) reads brands, the full history and the lookups, zero brand_rates rows failed';
  end if;
  for stmt, needle in select * from (values
    ('insert into public.brands (name, code, origin_vendor_id) values (''Test Ops Brand'', ''T'', ''00000000-0000-4000-8000-0000000000f2'')', 'policy'),
    ('insert into public.brand_owners (brand_id, vendor_id, since) values (current_setting(''rls_brands.b1'')::uuid, ''00000000-0000-4000-8000-0000000000f5'', ''2026-06-01'')', 'policy'),
    ('update public.brands set name = ''Test Ops Rename'' where id = current_setting(''rls_brands.b2'')::uuid', 'policy'),
    ('update public.brands set aliases = ''{"ops"}'' where id = current_setting(''rls_brands.b2'')::uuid', 'policy'),
    ('insert into public.brand_rates (brand_id, rate, since) values (current_setting(''rls_brands.b1'')::uuid, 25, current_date)', 'policy'),
    ('delete from public.brand_owners where brand_id = current_setting(''rls_brands.b1'')::uuid', 'permission denied')
  ) as v (stmt, needle) loop
    begin
      execute stmt;
      raise exception 'case ops must error failed: %', stmt;
    exception when others then
      if sqlstate <> '42501' or sqlerrm not like '%' || needle || '%' then -- expected: the policy (with check) or the grant
        raise exception 'case ops: expected 42501 mentioning %, got % (%) for %', needle, sqlstate, sqlerrm, stmt;
      end if;
    end;
  end loop;
end $$;

-- ================================================================ accounts: view F, edit N, sensitive.commission F (custom) — the rates only

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000064","role":"authenticated"}';
do $$
declare stmt text; code text; needle text; n int; b1 uuid := current_setting('rls_brands.b1')::uuid; b2 uuid := current_setting('rls_brands.b2')::uuid; b6 uuid;
begin
  select id into b6 from public.brands where name = 'Test Brand 2';
  if not ((select count(*) from public.brands where origin_vendor_id in ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-0000000000f5')) = 6
          and (select string_agg(coalesce(rate::text, '∅') || '@' || since::text, ',' order by brand_id = b6 desc, since) from public.brand_rates where brand_id in (b1, b2, b6))
              = '30.00@2026-01-01,40.00@2026-01-01,20.00@2026-02-01,∅@' || current_date::text) then -- the hand brand's row first, then by date
    raise exception 'case accounts (sensitive.commission F) reads the rates of this file''s brands failed: %',
      coalesce((select string_agg(coalesce(rate::text, '∅') || '@' || since::text, ',' order by brand_id = b6 desc, since) from public.brand_rates where brand_id in (b1, b2, b6)), '<none>');
  end if;
  insert into public.brand_rates (brand_id, rate, since, set_by) values (b6, null, current_date, 'حسابات البراندات');
  get diagnostics n = row_count;
  if not (n = 1 and (select count(*) from public.brand_rates where brand_id = b6) = 2) then
    raise exception 'case accounts (sensitive.commission F) withdraws a special rate from today failed';
  end if;
  for stmt, code, needle in select * from (values
    ('insert into public.brand_rates (brand_id, rate, since) values ((select id from public.brands where name = ''Test Brand 2''), 31, ''2026-01-01'')', '23505', 'brand_rates_brand_id_since_key'),
    ('insert into public.brands (name, code, origin_vendor_id) values (''Test Accounts Brand'', ''T'', ''00000000-0000-4000-8000-0000000000f2'')', '42501', 'policy'),
    ('insert into public.brand_owners (brand_id, vendor_id, since) values (current_setting(''rls_brands.b1'')::uuid, ''00000000-0000-4000-8000-0000000000f5'', ''2026-06-01'')', '42501', 'policy'),
    ('update public.brands set name = ''Test Accounts Rename'' where id = current_setting(''rls_brands.b2'')::uuid', '42501', 'policy'),
    ('update public.brand_rates set rate = 1 where brand_id = current_setting(''rls_brands.b1'')::uuid', '42501', 'permission denied'),
    ('delete from public.brand_rates where brand_id = current_setting(''rls_brands.b1'')::uuid', '42501', 'permission denied')
  ) as v (stmt, code, needle) loop
    begin
      execute stmt;
      raise exception 'case accounts must error failed: %', stmt;
    exception when others then
      if sqlstate <> code or sqlerrm not like '%' || needle || '%' then
        raise exception 'case accounts: expected % mentioning %, got % (%) for %', code, needle, sqlstate, sqlerrm, stmt;
      end if;
    end;
  end loop;
end $$;

-- ================================================================ viewer: vendors.view P — reads brands / owners, nothing else

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000065","role":"authenticated"}';
do $$
declare stmt text; n int; b1 uuid := current_setting('rls_brands.b1')::uuid; b2 uuid := current_setting('rls_brands.b2')::uuid;
begin
  if not ((select count(*) from public.brands where origin_vendor_id in ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-0000000000f5')) = 6
          and (select count(*) from public.brand_owners where brand_id = b1) = 4
          and (select count(*) from public.brand_rates where brand_id in (b1, b2)) = 0
          and public.brand_owner_at(b1, '2026-01-09') = '00000000-0000-4000-8000-0000000000f1'
          and public.store_owner_at('00000000-0000-4000-8000-0000000000f1', '2026-03-15') = '00000000-0000-4000-8000-0000000000f5') then
    raise exception 'case viewer (vendors.view P) reads brands, owners and the lookups, zero brand_rates rows failed';
  end if;
  foreach stmt in array array[
    'insert into public.brands (name, code, origin_vendor_id) values (''Test Viewer Brand'', ''T'', ''00000000-0000-4000-8000-0000000000f2'')',
    'insert into public.brand_owners (brand_id, vendor_id, since) values (current_setting(''rls_brands.b1'')::uuid, ''00000000-0000-4000-8000-0000000000f5'', ''2026-06-01'')',
    'insert into public.brand_rates (brand_id, rate, since) values (current_setting(''rls_brands.b1'')::uuid, 25, current_date)',
    'update public.brands set name = ''Test Viewer Rename'' where id = current_setting(''rls_brands.b2'')::uuid',
    'delete from public.brands where id = current_setting(''rls_brands.b2'')::uuid'] loop
    begin
      execute stmt;
      raise exception 'case viewer writes must error failed: %', stmt;
    exception when others then
      if sqlstate <> '42501' then -- expected: the policy or the grant
        raise exception 'case viewer writes: expected 42501, got % (%) for %', sqlstate, sqlerrm, stmt;
      end if;
    end;
  end loop;
end $$;

-- ================================================================ suspended viewer: nothing

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000066","role":"authenticated"}';
do $$ declare n int; stmt text; b1 uuid := current_setting('rls_brands.b1')::uuid; begin
  if not ((select count(*) from public.brands) = 0 and (select count(*) from public.brand_owners) = 0 and (select count(*) from public.brand_rates) = 0) then
    raise exception 'case suspended viewer reads zero rows of brands / brand_owners / brand_rates failed';
  end if;
  update public.brands set name = 'Test Suspended Rename' where id = b1;
  get diagnostics n = row_count;
  if not (n = 0) then raise exception 'case suspended viewer updates zero brands failed'; end if;
  -- the lookups see nothing: null for the brand, the store itself for the store
  if not (public.brand_owner_at(b1, current_date) is null
          and public.store_owner_at('00000000-0000-4000-8000-0000000000f1', current_date) = '00000000-0000-4000-8000-0000000000f1') then
    raise exception 'case the lookups under RLS answer null / the store itself to a member who sees no history failed';
  end if;
  foreach stmt in array array[
    'insert into public.brands (name, code, origin_vendor_id) values (''Test Suspended Brand'', ''T'', ''00000000-0000-4000-8000-0000000000f2'')',
    'insert into public.brand_owners (brand_id, vendor_id, since) values (current_setting(''rls_brands.b1'')::uuid, ''00000000-0000-4000-8000-0000000000f5'', ''2026-06-01'')',
    'insert into public.brand_rates (brand_id, rate, since) values (current_setting(''rls_brands.b1'')::uuid, 25, current_date)'] loop
    begin
      execute stmt;
      raise exception 'case suspended viewer must error failed: %', stmt;
    exception when others then
      if sqlstate <> '42501' then -- expected: has_perm answers N for a suspended member
        raise exception 'case suspended viewer: expected 42501, got % (%) for %', sqlstate, sqlerrm, stmt;
      end if;
    end;
  end loop;
end $$;

-- ================================================================ anon: zero rows or permission denied; no execute on the lookups

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
declare t text; n bigint; stmt text;
begin
  foreach t in array array['brands', 'brand_owners', 'brand_rates'] loop
    begin
      execute format('select count(*) from public.%I', t) into strict n;
      if n <> 0 then raise exception 'case anon reads zero rows (%) failed', t; end if;
    exception when insufficient_privilege then
      if sqlerrm ilike '%function%' then
        raise exception 'case anon on % hit a policy function: %', t, sqlerrm;
      end if; -- else: table-level permission denied is acceptable
    end;
  end loop;
  foreach stmt in array array[
    'select public.brand_owner_at(current_setting(''rls_brands.b1'')::uuid, current_date)',
    'select public.store_owner_at(''00000000-0000-4000-8000-0000000000f1'', current_date)'] loop
    begin
      execute stmt;
      raise exception 'case anon on a lookup must error failed: %', stmt;
    exception when others then
      if sqlstate <> '42501' or sqlerrm not ilike '%permission denied for function%' then -- expected: no execute
        raise exception 'case anon on a lookup: expected 42501 permission denied for function, got % (%) for %', sqlstate, sqlerrm, stmt;
      end if;
    end;
  end loop;
end $$;

-- ================================================================ admin: a past holder cannot be deleted either; the origin's cascade

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated"}';
do $$ begin
  -- f5 held f1's brand for a month: still in its history → 23503 (the history is never rewritten)
  begin
    execute 'delete from public.vendors where id = ''00000000-0000-4000-8000-0000000000f5''';
    raise exception 'case admin deletes a past holder of another maker''s brand must error failed';
  exception when others then
    if sqlstate <> '23503' or sqlerrm not like '%brand_owners_vendor_id_fkey%' then
      raise exception 'case admin deletes a past holder: expected 23503 on brand_owners_vendor_id_fkey, got % (%)', sqlstate, sqlerrm;
    end if;
  end;
  -- f2 (hand-added, the origin of two brands, in nobody else's history): the delete cascades its brands with their
  -- owner and rate rows — the one delete of this file that goes through, undone by the rollback below. The guard
  -- deferred the vendor key for this transaction; checking it now (as a commit would) must pass.
  execute 'delete from public.vendors where id = ''00000000-0000-4000-8000-0000000000f2''';
  set constraints all immediate;
end $$;

-- ================================================================ runner: what the cascade removed, what stayed

reset role;
set local request.jwt.claims = '';
do $$ declare b1 uuid := current_setting('rls_brands.b1')::uuid; b2 uuid := current_setting('rls_brands.b2')::uuid; begin
  if not ((select count(*) from public.vendors where id = '00000000-0000-4000-8000-0000000000f2') = 0
          and (select count(*) from public.brands where origin_vendor_id = '00000000-0000-4000-8000-0000000000f2') = 0
          and (select count(*) from public.brands where id = b2 or name in ('Test Brand 2', 'Test Brand')) = 0
          and (select count(*) from public.brand_owners where vendor_id = '00000000-0000-4000-8000-0000000000f2') = 0
          and (select count(*) from public.brand_owners o where not exists (select 1 from public.brands b where b.id = o.brand_id)) = 0
          and (select count(*) from public.brand_rates r where not exists (select 1 from public.brands b where b.id = r.brand_id)) = 0) then
    raise exception 'case deleting the origin maker cascades their brands, owner rows and rates (nothing orphaned) failed';
  end if;
  -- the rest of this file's rows are as the accepted writes left them
  if not ((select string_agg(v.id::text || '=' || b.name || '/' || b.code || '/' || coalesce(b.store_vendor_id::text, '∅'), ',' order by v.id, b.name)
           from public.brands b join public.vendors v on v.id = b.origin_vendor_id
           where v.id in ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-0000000000f5')
              or (v.woo_vendor_id is null and v.name = 'Test Popup Maker'))
          = '00000000-0000-4000-8000-0000000000f1=Test Brand Store/T/00000000-0000-4000-8000-0000000000f1,'
            || '00000000-0000-4000-8000-0000000000f4=Test Old Brand/TOB/∅,00000000-0000-4000-8000-0000000000f4=ورشة النقل/X/∅,'
            || '00000000-0000-4000-8000-0000000000f5=مبتكر الرجوع/X/∅,'
            || (select id::text from public.vendors where woo_vendor_id is null and name = 'Test Popup Maker') || '=Test Popup Maker/T/∅'
          and (select count(*) from public.brand_owners where brand_id = b1) = 4
          and (select string_agg(coalesce(rate::text, '∅') || '@' || since::text, ',' order by since) from public.brand_rates where brand_id = b1) = '20.00@2026-02-01'
          and (select count(*) from public.vendors where id in ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-0000000000f5')) = 4
          and (select count(*) from public.vendors where woo_vendor_id is null and name in ('Test Popup Maker', 'ورشة النقل')) = 3) then
    raise exception 'case the final rows match the accepted writes only failed: %',
      coalesce((select string_agg(v.id::text || '=' || b.name || '/' || b.code, ',' order by v.id, b.name) from public.brands b join public.vendors v on v.id = b.origin_vendor_id
                where v.id in ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-0000000000f5')
                   or (v.woo_vendor_id is null and v.name = 'Test Popup Maker')), '<none>');
  end if;
end $$;

rollback;

do $$ begin raise notice 'rls_brands: ok'; end $$;
