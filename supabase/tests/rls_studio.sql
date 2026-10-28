-- RLS / permission tests for 0023_studio (products.add, sku_colors, sku_serial_take, studio_batches). Depends on 0001_identity …
-- 0023_studio. Runs in one transaction and rolls back; prints NOTICE 'rls_studio: ok' only if every case passed. Live-safe:
-- its rows (a color «Testcolor» QQ, a batch, two serials) are rolled back, the serial included. Every name is made up.

begin;

-- Test users (fixed UUIDs …e1–…e2): products.view F + products.add F; products.view F only.
insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000000e1', 'studio-a.dev@ibtekr.local', '010000000e1'),
  ('00000000-0000-4000-8000-0000000000e2', 'studio-v.dev@ibtekr.local', '010000000e2');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email)
from auth.users u where u.id in ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000e2');
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-0000000000e1', 'استوديو', 'studio-a.dev@ibtekr.local', '010000000e1', 'viewer', 'active', '{"products.view":"F","products.add":"F"}'),
  ('00000000-0000-4000-8000-0000000000e2', 'منتجات بس', 'studio-v.dev@ibtekr.local', '010000000e2', 'viewer', 'active', '{"products.view":"F","products.add":"N"}');

do $$ begin
  if (select permissions ->> 'products.add' from public.roles where id = 'ops') <> 'F'
     or (select permissions ->> 'products.add' from public.roles where id = 'cs') <> 'N' then
    raise exception 'case role defaults for products.add failed';
  end if;
  if (select count(*) from public.sku_colors where code in ('BK', 'BL', 'GY', 'GN', 'BE')) <> 5 then raise exception 'case the seeded colors failed'; end if;
  if (select count(distinct code) from public.sku_colors) <> (select count(*) from public.sku_colors) then raise exception 'case color codes unique failed'; end if;
  if has_table_privilege('anon', 'public.studio_batches', 'SELECT') or has_table_privilege('authenticated', 'public.studio_batches', 'DELETE')
     or has_column_privilege('authenticated', 'public.studio_batches', 'status', 'UPDATE') or has_column_privilege('authenticated', 'public.studio_batches', 'result', 'INSERT')
     or has_table_privilege('authenticated', 'public.sku_serial', 'UPDATE') or has_table_privilege('authenticated', 'public.sku_colors', 'DELETE')
     or has_function_privilege('anon', 'public.sku_serial_take(int)', 'EXECUTE') then
    raise exception 'case studio grants failed';
  end if;
end $$;

-- ================================================================ products.add F: colors, serial, batches

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000e1","role":"authenticated"}';
do $$ declare a bigint; b bigint; bid uuid; begin
  insert into public.sku_colors (name_en, name_ar, code) values ('Testcolor', 'لون تجريبي', 'QQ');
  begin
    insert into public.sku_colors (name_en, name_ar, code) values ('Other test', 'تاني', 'QQ');
    raise exception 'case a color code is unique failed';
  exception when unique_violation then null;
  end;
  begin
    insert into public.sku_colors (name_en, name_ar, code) values ('testcolor', 'تاني', 'QR');
    raise exception 'case a color name is unique (any case) failed';
  exception when unique_violation then null;
  end;
  begin
    insert into public.sku_colors (name_en, name_ar, code) values ('Bad code', 'غلط', 'q1');
    raise exception 'case a color code is two capital letters failed';
  exception when check_violation then null;
  end;
  a := public.sku_serial_take(3); b := public.sku_serial_take(1);
  if b <> a + 3 then raise exception 'case sku_serial_take reserves n in a row failed (% then %)', a, b; end if;
  begin
    perform public.sku_serial_take(0);
    raise exception 'case sku_serial_take(0) is refused failed';
  exception when sqlstate '22023' then null;
  end;
  insert into public.studio_batches (title, type, state, step) values ('دفعة تجريبية', 'Variable', '{"items": []}', 1) returning studio_batches.id into bid;
  update public.studio_batches set step = 3, state = '{"items": [{"name": "Lamp"}]}' where studio_batches.id = bid;
  if (select step from public.studio_batches where studio_batches.id = bid) <> 3 then raise exception 'case a batch is updated failed'; end if;
  begin
    update public.studio_batches set status = 'done' where studio_batches.id = bid;
    raise exception 'case a member may not set the status failed';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.studio_batches where studio_batches.id = bid;
    raise exception 'case a member may not delete a batch failed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ================================================================ products.view F only: colors yes, studio no

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000e2","role":"authenticated"}';
do $$ begin
  if not exists (select 1 from public.sku_colors where code = 'BK') then raise exception 'case products.view reads the colors failed'; end if;
  if exists (select 1 from public.studio_batches) then raise exception 'case no products.add reads no batch failed'; end if;
  begin
    perform public.sku_serial_take(1);
    raise exception 'case no products.add takes no serial failed';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.sku_colors (name_en, name_ar, code) values ('Nope', 'لأ', 'NQ');
    raise exception 'case no products.add adds no color failed';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.studio_batches (title) values ('لأ');
    raise exception 'case no products.add adds no batch failed';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
do $$ begin raise notice 'rls_studio: ok'; end $$;
rollback;
