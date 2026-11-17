-- Tests for 0127_store_settings (the plan 2026-11-17-stores-single.md T1): store_cfg's effective values (the same rules as
-- _shared/store/index.js storeOf — tests/functions/store.test.mjs), settings_public().store for every member, the row «store» written by
-- the admin only. One transaction, rolled back; NOTICE 'rls_store_settings: ok' only if every case passed. Live-safe.
begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000127a1', 'st-adm.dev@ibtekr.local', '01000127a01'),
  ('00000000-0000-4000-8000-0000000127a2', 'st-ops.dev@ibtekr.local', '01000127a02');
insert into public.profiles (id, name, email, phone, role_id, status) values
  ('00000000-0000-4000-8000-0000000127a1', 'أدمن المتجر', 'st-adm.dev@ibtekr.local', '01000127a01', 'admin', 'active'),
  ('00000000-0000-4000-8000-0000000127a2', 'عمليات المتجر', 'st-ops.dev@ibtekr.local', '01000127a02', 'ops', 'active');

-- the effective values (no row, then rows) — as storeOf
delete from public.settings where section = 'store';
do $$ declare c jsonb;
begin
  c := public.store_cfg();
  if c <> '{"platform":"woo","dokan":true,"mode":"marketplace","margin":30}'::jsonb then raise exception 'case no row = woo marketplace failed: %', c; end if;
  insert into public.settings (section, data) values ('store', '{"mode":"single","margin":12.345}');
  c := public.store_cfg();
  if c ->> 'mode' <> 'single' or (c ->> 'margin')::numeric <> 12.35 or c ->> 'platform' <> 'woo' then raise exception 'case woo single + margin failed: %', c; end if;
  update public.settings set data = '{"platform":"shopify","mode":"marketplace","margin":"40"}' where section = 'store';
  c := public.store_cfg();
  if c <> '{"platform":"shopify","dokan":false,"mode":"single","margin":30}'::jsonb then raise exception 'case shopify forces single, a text margin = 30 failed: %', c; end if;
  update public.settings set data = '{"platform":"woo","dokan":"false"}' where section = 'store';
  if public.store_cfg() ->> 'mode' <> 'single' or not public.store_single() then raise exception 'case woo without dokan = single failed'; end if;
  update public.settings set data = '{"platform":"nope","margin":501}' where section = 'store';
  if public.store_cfg() <> '{"platform":"woo","dokan":true,"mode":"marketplace","margin":30}'::jsonb then raise exception 'case unknown values fall back failed'; end if;
  update public.settings set data = '{"platform":"easyorders","margin":45}' where section = 'store';
end $$;

-- every member reads it in settings_public; only the admin writes the row
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000127a2","role":"authenticated"}', true);
do $$ declare s jsonb;
begin
  s := public.settings_public() -> 'store';
  if s ->> 'platform' <> 'easyorders' or s ->> 'mode' <> 'single' or (s ->> 'margin')::numeric <> 45 then raise exception 'case a member reads store failed: %', s; end if;
  update public.settings set data = '{"platform":"woo"}' where section = 'store';
  if public.store_cfg() ->> 'platform' <> 'easyorders' then raise exception 'case a member writes no store failed'; end if;
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000127a1","role":"authenticated"}', true);
do $$ begin
  update public.settings set data = '{"platform":"woo","mode":"single"}' where section = 'store';
  if public.store_cfg() ->> 'mode' <> 'single' or public.store_cfg() ->> 'platform' <> 'woo' then raise exception 'case the admin writes store failed'; end if;
end $$;

reset role;
do $$ begin
  if has_function_privilege('anon', 'public.store_cfg()', 'execute') then raise exception 'case anon has no store_cfg failed'; end if;
  raise notice 'rls_store_settings: ok';
end $$;
rollback;
