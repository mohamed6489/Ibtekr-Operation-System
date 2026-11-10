-- Tests for 0076_product_lead_days (phase 13 decision 52 — a product's own making days over the maker's). Depends on 0001 … 0076.
-- One transaction, rolled back; NOTICE 'rls_product_lead_days: ok' only if every case passed. Live-safe: made-up members and a
-- made-up product id (9_076_000_001) that no WooCommerce product carries.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000076a1', 'pl-ops.dev@ibtekr.local', '010000076a1'),
  ('00000000-0000-4000-8000-0000000076a2', 'pl-cs.dev@ibtekr.local',  '010000076a2'),
  ('00000000-0000-4000-8000-0000000076a3', 'pl-susp.dev@ibtekr.local', '010000076a3');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u where u.email like 'pl-%.dev@ibtekr.local';
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-0000000076a1', 'عمليات التصنيع', 'pl-ops.dev@ibtekr.local', '010000076a1', 'ops', 'active', '{}'),
  ('00000000-0000-4000-8000-0000000076a2', 'خدمة التصنيع',   'pl-cs.dev@ibtekr.local',  '010000076a2', 'cs',  'active', '{}'),
  ('00000000-0000-4000-8000-0000000076a3', 'موقوف التصنيع',  'pl-susp.dev@ibtekr.local', '010000076a3', 'ops', 'suspended', '{}');

create or replace function pg_temp.as_member(p_uid text) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;

-- ops (products.edit F) writes; the server stamps who and when
select pg_temp.as_member('00000000-0000-4000-8000-0000000076a1');
do $$ begin
  insert into public.product_lead_days (product_id, days, updated_by) values (9076000001, 10, '00000000-0000-4000-8000-0000000076a2');
  if (select updated_by from public.product_lead_days where product_id = 9076000001) <> '00000000-0000-4000-8000-0000000076a1' then raise exception 'case updated_by from the server failed'; end if;
  update public.product_lead_days set days = 12 where product_id = 9076000001;
  begin insert into public.product_lead_days (product_id, days) values (9076000002, 0); raise exception 'case 0 days refused failed';
  exception when check_violation then null; end;
  begin insert into public.product_lead_days (product_id, days) values (9076000002, 91); raise exception 'case 91 days refused failed';
  exception when check_violation then null; end;
end $$;
reset role;

-- cs (products.edit N) reads, never writes
select pg_temp.as_member('00000000-0000-4000-8000-0000000076a2');
do $$ declare n int; begin
  if (select days from public.product_lead_days where product_id = 9076000001) <> 12 then raise exception 'case cs reads failed'; end if;
  update public.product_lead_days set days = 3 where product_id = 9076000001; get diagnostics n = row_count;
  if n <> 0 then raise exception 'case cs cannot update failed'; end if;
  begin insert into public.product_lead_days (product_id, days) values (9076000003, 5); raise exception 'case cs cannot insert failed';
  exception when insufficient_privilege then null; end;
  delete from public.product_lead_days where product_id = 9076000001; get diagnostics n = row_count;
  if n <> 0 then raise exception 'case cs cannot delete failed'; end if;
end $$;
reset role;

-- a suspended member sees nothing
select pg_temp.as_member('00000000-0000-4000-8000-0000000076a3');
do $$ begin
  if exists (select 1 from public.product_lead_days where product_id = 9076000001) then raise exception 'case a suspended member reads nothing failed'; end if;
end $$;
reset role;

-- ops removes it (back to the maker's days)
select pg_temp.as_member('00000000-0000-4000-8000-0000000076a1');
do $$ declare n int; begin
  delete from public.product_lead_days where product_id = 9076000001; get diagnostics n = row_count;
  if n <> 1 then raise exception 'case ops deletes failed'; end if;
end $$;
reset role;

do $$ begin
  if has_table_privilege('anon', 'public.product_lead_days', 'select') then raise exception 'case anon has no grant failed'; end if;
  raise notice 'rls_product_lead_days: ok';
end $$;
rollback;
