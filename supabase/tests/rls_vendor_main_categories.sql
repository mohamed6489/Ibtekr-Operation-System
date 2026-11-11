-- Tests for 0080_vendor_main_categories (the owner, 11 Nov — «الفئة الأساسية» = the site's main categories, several, kept in the
-- system only). Depends on 0001_identity … 0080. Runs in one transaction and rolls back; prints NOTICE
-- 'rls_vendor_main_categories: ok' only if every case passed. Live-safe: its made-up members, makers and categories are rolled back.
-- * vendors.main_categories: members read it, never write it directly; vendor_main_categories_set(p_vendor, p_ids) — the admin or
--   vendors.edit = F — writes it with vendors.category = the picked names (none = null)
-- * a newly picked id must be a main category of the site (woo_categories without a parent) → else 22023 invalid: main_categories;
--   20 at most; a repeat kept once in the order picked; an id already on the row stays even when the category stops being a main one
-- * an unknown maker → P0002; vendors.edit P / N → 42501; the function is closed to anon
-- * vendors.category is free text now (≤ 300 characters); the prototype's seven-name check is gone

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000080a1', 'mc-vf.dev@ibtekr.local',  '010000080a1'),
  ('00000000-0000-4000-8000-0000000080a2', 'mc-ops.dev@ibtekr.local', '010000080a2'),
  ('00000000-0000-4000-8000-0000000080a3', 'mc-cs.dev@ibtekr.local',  '010000080a3');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u where u.email like 'mc-%.dev@ibtekr.local';
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-0000000080a1', 'متابعة الفئات', 'mc-vf.dev@ibtekr.local',  '010000080a1', 'vendors_followup', 'active', '{}'),
  ('00000000-0000-4000-8000-0000000080a2', 'عمليات الفئات', 'mc-ops.dev@ibtekr.local', '010000080a2', 'ops',              'active', '{}'),
  ('00000000-0000-4000-8000-0000000080a3', 'خدمة الفئات',   'mc-cs.dev@ibtekr.local',  '010000080a3', 'cs',               'active', '{}');
insert into public.woo_categories (id, name, slug, parent_id) values
  (980001, 'Test Decor', 'test-decor', null),
  (980002, 'Test Lighting', 'test-lighting', 0),
  (980003, 'Test Lamps', 'test-lamps', 980002);
insert into public.woo_categories (id, name, slug, parent_id) select 980100 + g, 'Test Top ' || g, 'test-top-' || g, null from generate_series(1, 21) g;
insert into public.vendors (id, name, category, status, lead_days, joined_at) values
  ('00000000-0000-4000-8000-0000000080d1', 'ورشة الفئات', null, 'active', 7, '2026-11-11'),
  ('00000000-0000-4000-8000-0000000080d2', 'ورشة الفئات التانية', 'ديكور منزلي', 'active', 7, '2026-11-11');

create or replace function pg_temp.as_member(p_uid text) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;

-- ================================================================ grants, the closed function, the length check (runner)

do $$ begin
  if not has_column_privilege('authenticated', 'public.vendors', 'main_categories', 'SELECT') then
    raise exception 'case the members read main_categories failed';
  end if;
  if has_column_privilege('authenticated', 'public.vendors', 'main_categories', 'UPDATE') or has_column_privilege('authenticated', 'public.vendors', 'main_categories', 'INSERT') then
    raise exception 'case the members never write main_categories directly failed';
  end if;
  if has_function_privilege('anon', 'public.vendor_main_categories_set(uuid, int[])', 'execute')
     or not has_function_privilege('authenticated', 'public.vendor_main_categories_set(uuid, int[])', 'execute') then
    raise exception 'case vendor_main_categories_set: closed to anon, open to the members failed';
  end if;
  update public.vendors set category = 'Test Decor، Test Lighting' where id = '00000000-0000-4000-8000-0000000080d1'; -- free text now
  begin
    update public.vendors set category = repeat('x', 301) where id = '00000000-0000-4000-8000-0000000080d1';
    raise exception 'case a category text over 300 characters must error failed';
  exception when check_violation then null; end;
end $$;

-- ================================================================ vendors follow-up (vendors.edit F): main categories only

select pg_temp.as_member('00000000-0000-4000-8000-0000000080a1');
do $$
declare d uuid := '00000000-0000-4000-8000-0000000080d1'; r jsonb; got int[]; cat text;
begin
  r := public.vendor_main_categories_set(d, array[980002, 980001, 980002]);
  select main_categories, category into got, cat from public.vendors where id = d;
  if got is distinct from array[980002, 980001] or cat is distinct from 'Test Lighting، Test Decor' or r ->> 'category' is distinct from cat then
    raise exception 'case two main categories (a repeat kept once, in the order picked) and their names failed: % / % / %', got, cat, r;
  end if;
  begin perform public.vendor_main_categories_set(d, array[980001, 980003]); raise exception 'case a sub-category is refused failed';
  exception when sqlstate '22023' then
    if sqlerrm <> 'invalid: main_categories' then raise exception 'case the sub-category message: %', sqlerrm; end if;
  end;
  begin perform public.vendor_main_categories_set(d, array[979999]); raise exception 'case an unknown category is refused failed';
  exception when sqlstate '22023' then null; end;
  begin perform public.vendor_main_categories_set(d, array(select 980100 + g from generate_series(1, 21) g)); raise exception 'case 21 categories are refused failed';
  exception when sqlstate '22023' then null; end;
  begin perform public.vendor_main_categories_set('00000000-0000-4000-8000-0000000080ff', array[980001]); raise exception 'case an unknown maker failed';
  exception when sqlstate 'P0002' then null; end;
  begin update public.vendors set main_categories = array[980001] where id = d; raise exception 'case a direct write of main_categories failed';
  exception when insufficient_privilege then null; end;
  if (select main_categories from public.vendors where id = d) is distinct from array[980002, 980001] then
    raise exception 'case the refused calls changed nothing failed';
  end if;
end $$;
reset role;

-- a category that stops being a main one stays on the row (and its name follows the site); a new pick of it is refused
update public.woo_categories set parent_id = 980001, name = 'Test Lighting Moved' where id = 980002;
select pg_temp.as_member('00000000-0000-4000-8000-0000000080a1');
do $$
declare got int[]; cat text;
begin
  perform public.vendor_main_categories_set('00000000-0000-4000-8000-0000000080d1', array[980002]);
  select main_categories, category into got, cat from public.vendors where id = '00000000-0000-4000-8000-0000000080d1';
  if got is distinct from array[980002] or cat is distinct from 'Test Lighting Moved' then raise exception 'case an id already on the row stays failed: % / %', got, cat; end if;
  begin perform public.vendor_main_categories_set('00000000-0000-4000-8000-0000000080d2', array[980002]); raise exception 'case a new pick of a category that is no longer main failed';
  exception when sqlstate '22023' then null; end;
  perform public.vendor_main_categories_set('00000000-0000-4000-8000-0000000080d1', '{}');
  select main_categories, category into got, cat from public.vendors where id = '00000000-0000-4000-8000-0000000080d1';
  if got is distinct from '{}'::int[] or cat is not null then raise exception 'case none picked = no main category and no text failed: % / %', got, cat; end if;
end $$;
reset role;

-- ================================================================ ops (vendors.edit P) and cs (no edit): refused

select pg_temp.as_member('00000000-0000-4000-8000-0000000080a2');
do $$ begin
  begin perform public.vendor_main_categories_set('00000000-0000-4000-8000-0000000080d2', array[980001]); raise exception 'case ops (vendors.edit P) failed';
  exception when insufficient_privilege then null; end;
  perform main_categories from public.vendors where id = '00000000-0000-4000-8000-0000000080d2'; -- reads it
end $$;
reset role;

select pg_temp.as_member('00000000-0000-4000-8000-0000000080a3');
do $$ begin
  begin perform public.vendor_main_categories_set('00000000-0000-4000-8000-0000000080d2', array[980001]); raise exception 'case cs failed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

do $$ begin
  if (select main_categories from public.vendors where id = '00000000-0000-4000-8000-0000000080d2') is distinct from '{}'::int[]
     or (select category from public.vendors where id = '00000000-0000-4000-8000-0000000080d2') is distinct from 'ديكور منزلي' then
    raise exception 'case the refused members changed nothing failed';
  end if;
  raise notice 'rls_vendor_main_categories: ok';
end $$;

rollback;
