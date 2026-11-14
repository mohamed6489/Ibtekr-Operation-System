-- Tests for 0090_role_scope (owner batch 14 Nov decision 15 — each role sees its own work). Depends on 0001_identity … 0090_role_scope.
-- Runs in one transaction and rolls back; prints NOTICE 'rls_role_scope: ok' only if every case passed. Live-safe: read-only checks
-- plus made-up members that are rolled back.

begin;

-- ================================================================ the three marketing roles: their work only
do $$
declare v jsonb;
begin
  for v in select permissions from public.roles where id in ('designer', 'developer') loop
    if v ->> 'orders.view' = 'P' or v ->> 'vendors.view' = 'P' or v ->> 'inventory.view' = 'F' or v ->> 'cs.view' = 'P' or v ->> 'reports.view' = 'P' then
      raise exception 'case the designer / developer keep their work only failed (%)', v;
    end if;
    if v ->> 'marketing.view' <> 'F' or v ->> 'products.view' <> 'F' or v ->> 'tickets.manage' <> 'F' then raise exception 'case the designer / developer keep marketing, products, requests failed (%)', v; end if;
  end loop;
  select permissions into v from public.roles where id = 'media_buyer';
  if v ->> 'orders.view' = 'P' or v ->> 'cs.view' = 'P' or v ->> 'inventory.view' = 'F' or v ->> 'reports.view' <> 'F' or v ->> 'marketing.publish' <> 'F' then
    raise exception 'case the media buyer keeps the marketing and the reports only failed (%)', v;
  end if;
  -- the sensitive keys stay closed for every role but the ones whose job it is
  if exists (select 1 from public.roles where id <> 'admin' and permissions ->> 'sensitive.salaries' is distinct from 'N') then raise exception 'case the salaries are the admin''s only failed'; end if;
  if exists (select 1 from public.roles where id in ('designer', 'developer', 'media_buyer', 'viewer')
             and (permissions ->> 'sensitive.customer_phone' = 'F' or permissions ->> 'sensitive.commission' = 'F' or permissions ->> 'sensitive.vendor_bank' = 'F')) then
    raise exception 'case no sensitive key on the marketing roles or the viewer failed';
  end if;
end $$;

-- ================================================================ has_perm: a designer reads no orders; the admin has every key
insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000090a1', 'rs-des.dev@ibtekr.local', '010000090a1'),
  ('00000000-0000-4000-8000-0000000090a2', 'rs-adm.dev@ibtekr.local', '010000090a2');
insert into public.profiles (id, name, email, phone, role_id, status) values
  ('00000000-0000-4000-8000-0000000090a1', 'ديزاينر النطاق', 'rs-des.dev@ibtekr.local', '010000090a1', 'designer', 'active'),
  ('00000000-0000-4000-8000-0000000090a2', 'أدمن النطاق', 'rs-adm.dev@ibtekr.local', '010000090a2', 'admin', 'active');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000090a1","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  if public.has_perm('orders.view') <> 'N' or public.has_perm('cs.view') <> 'N' or public.has_perm('marketing.view') <> 'F' then raise exception 'case has_perm for the designer failed'; end if;
  if exists (select 1 from public.orders_v) then raise exception 'case the designer reads no order failed'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000090a2","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  if public.has_perm('sensitive.salaries') <> 'F' or public.has_perm('any.key.at.all') <> 'F' then raise exception 'case the admin has every key failed'; end if;
end $$;
reset role;

do $$ begin raise notice 'rls_role_scope: ok'; end $$;
rollback;
