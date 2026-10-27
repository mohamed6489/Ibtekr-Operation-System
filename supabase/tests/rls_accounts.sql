-- RLS / permission tests for 0019_accounts (the ledgers, the guard, the Dokan mirrors, accounts_sales).
-- Depends on 0001_identity … 0019_accounts. Runs in one transaction and rolls back; prints NOTICE 'rls_accounts: ok' only
-- if every case passed. Live-safe: every count is scoped to the rows this file writes (the orders sit in 2001, the maker
-- has no store). Every name, number and phone is made up.

begin;

-- Test users (fixed UUIDs …d1–…d4): the accountant (view F, add F), view P + add F, the approver (approve F), no access.
insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000000d1', 'acc-f.dev@ibtekr.local', '010000000d1'),
  ('00000000-0000-4000-8000-0000000000d2', 'acc-p.dev@ibtekr.local', '010000000d2'),
  ('00000000-0000-4000-8000-0000000000d3', 'acc-ap.dev@ibtekr.local', '010000000d3'),
  ('00000000-0000-4000-8000-0000000000d4', 'acc-n.dev@ibtekr.local', '010000000d4');

insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email)
from auth.users u
where u.id in ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000d2',
               '00000000-0000-4000-8000-0000000000d3', '00000000-0000-4000-8000-0000000000d4');

insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-0000000000d1', 'حسابات كامل', 'acc-f.dev@ibtekr.local',  '010000000d1', 'ops', 'active', '{"accounts.view":"F","accounts.add":"F","accounts.approve":"N"}'),
  ('00000000-0000-4000-8000-0000000000d2', 'حسابات جزئي', 'acc-p.dev@ibtekr.local',  '010000000d2', 'ops', 'active', '{"accounts.view":"P","accounts.add":"F","accounts.approve":"N"}'),
  ('00000000-0000-4000-8000-0000000000d3', 'حسابات موافقة', 'acc-ap.dev@ibtekr.local', '010000000d3', 'ops', 'active', '{"accounts.view":"F","accounts.add":"F","accounts.approve":"F"}'),
  ('00000000-0000-4000-8000-0000000000d4', 'حسابات بدون', 'acc-n.dev@ibtekr.local',   '010000000d4', 'ops', 'active', '{"accounts.view":"N","accounts.add":"N","accounts.approve":"N"}');

-- A maker without a store, a Dokan mirror row for it, and two orders in 2001 for accounts_sales.
insert into public.vendors (id, name) values ('00000000-0000-4000-8000-0000000019a1', 'مبتكر حسابات تجريبي 0019');
insert into public.dokan_balances (vendor_id, woo_vendor_id, balance) values ('00000000-0000-4000-8000-0000000019a1', 99919001, 1500);
insert into public.dokan_withdrawals (id, woo_vendor_id, vendor_id, amount, status) values (99919001, 99919001, '00000000-0000-4000-8000-0000000019a1', 700, 'pending');
insert into public.vendor_rates (vendor_id, rate, since, set_by) values ('00000000-0000-4000-8000-0000000019a1', 20, '2000-01-01', 'اختبار');
insert into public.orders (id, number, customer_name, customer_phone, status, woo_status, total, placed_at) values
  (99970001, '99970001', 'عميل تجريبي', '01000000001', 'مكتمل', 'completed', 1000, '2001-01-10T09:00:00Z'),
  (99970002, '99970002', 'عميل تجريبي', '01000000002', 'قيد الشحن', 'in-shipping', 500, '2001-01-11T09:00:00Z'),
  (99970003, '99970003', 'عميل تجريبي', '01000000003', 'قيد الانتظار', 'pending', 300, '2001-01-12T09:00:00Z');
insert into public.order_items (id, order_id, name, qty, total, vendor_id, commission_rate, commission_fee) values
  (99970101, 99970001, 'منتج', 1, 1000, '00000000-0000-4000-8000-0000000019a1', 25, 10),
  (99970102, 99970002, 'منتج', 1, 500, '00000000-0000-4000-8000-0000000019a1', null, null),
  (99970103, 99970003, 'منتج', 1, 300, '00000000-0000-4000-8000-0000000019a1', 25, 0);

-- ================================================================ runner: the grants

do $$ begin
  if has_table_privilege('authenticated', 'public.acc_expenses', 'DELETE') or has_table_privilege('authenticated', 'public.acc_vendor_moves', 'DELETE')
     or has_table_privilege('authenticated', 'public.acc_account_moves', 'DELETE') or has_table_privilege('anon', 'public.acc_expenses', 'SELECT')
     or not has_table_privilege('authenticated', 'public.acc_expenses', 'UPDATE') then
    raise exception 'case ledger grants (authenticated select / insert / update, no delete; anon nothing) failed';
  end if;
  if has_table_privilege('authenticated', 'public.dokan_withdrawals', 'INSERT') or has_table_privilege('authenticated', 'public.dokan_balances', 'UPDATE')
     or not has_table_privilege('authenticated', 'public.dokan_balances', 'SELECT') then
    raise exception 'case Dokan mirrors are read-only for members failed';
  end if;
end $$;

-- ================================================================ the accountant (view F, add F)

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}';
do $$ declare eid bigint; sid bigint; mid bigint; aid bigint; r record; begin
  insert into public.acc_expenses (on_date, category, beneficiary, amount, created_by, voided_at)
    values ('2001-01-05', 'المرتبات', 'موظف', 5000, '00000000-0000-4000-8000-0000000000d3', now()) returning id into eid;
  select * into r from public.acc_expenses where id = eid;
  if r.created_by <> '00000000-0000-4000-8000-0000000000d1' or r.voided_at is not null then
    raise exception 'case insert: created_by is the caller and a row starts unvoided failed';
  end if;
  begin
    insert into public.acc_expenses (on_date, category, amount) values ('2001-01-05', 'الاشتراكات', 100);
    raise exception 'case a subscription without name / end / alert must error failed';
  exception when check_violation then null;
  end;
  insert into public.acc_expenses (on_date, category, amount, sub_name, sub_ends, sub_alerts)
    values ('2001-01-05', 'الاشتراكات', 100, 'Canva', '2001-02-05', array['week']) returning id into sid;
  insert into public.acc_vendor_moves (vendor_id, on_date, direction, kind, amount) values ('00000000-0000-4000-8000-0000000019a1', '2001-01-06', 'deposit', 'عربون', 300) returning id into mid;
  begin
    insert into public.acc_vendor_moves (vendor_id, on_date, direction, kind, amount) values ('00000000-0000-4000-8000-0000000019a1', '2001-01-06', 'withdraw', 'أخرى', 50);
    raise exception 'case «أخرى» without a name must error failed';
  exception when check_violation then null;
  end;
  insert into public.acc_account_moves (account, on_date, direction, amount) values ('حساب البنك', '2001-01-07', 'deposit', 2000) returning id into aid;
  -- edit one's own row, then void it; a voided row is final
  update public.acc_account_moves set amount = 2500 where id = aid;
  if (select updated_by from public.acc_account_moves where id = aid) <> '00000000-0000-4000-8000-0000000000d1' then raise exception 'case updated_by is stamped failed'; end if;
  update public.acc_account_moves set voided_at = '2000-01-01' where id = aid;
  if (select voided_by from public.acc_account_moves where id = aid) <> '00000000-0000-4000-8000-0000000000d1'
     or (select voided_at from public.acc_account_moves where id = aid) < now() - interval '1 minute' then
    raise exception 'case void is stamped by the server failed';
  end if;
  begin
    update public.acc_account_moves set voided_at = null where id = aid;
    raise exception 'case un-void must error failed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.acc_account_moves set created_by = '00000000-0000-4000-8000-0000000000d3' where id = aid;
    raise exception 'case created_by is fixed failed';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.acc_expenses where id = eid;
    raise exception 'case a member may not delete failed';
  exception when insufficient_privilege then null;
  end;
  -- the mirrors and the sales
  if (select count(*) from public.dokan_balances where vendor_id = '00000000-0000-4000-8000-0000000019a1') <> 1
     or (select count(*) from public.dokan_withdrawals where id = 99919001) <> 1 then
    raise exception 'case accounts.view reads the Dokan mirrors failed';
  end if;
  select * into r from public.accounts_sales('2001-01-01', '2001-01-31') where vendor_id = '00000000-0000-4000-8000-0000000019a1' and grp = 'completed';
  if r.orders <> 1 or r.sales <> 1000 or r.share <> 260 then
    raise exception 'case accounts_sales completed: 1 order, 1000, share 1000×25%%+10 = 260 (got %, %, %) failed', r.orders, r.sales, r.share;
  end if;
  select * into r from public.accounts_sales('2001-01-01', '2001-01-31') where vendor_id = '00000000-0000-4000-8000-0000000019a1' and grp = 'in_progress';
  if r.orders <> 1 or r.share <> 100 then
    raise exception 'case accounts_sales in progress: the vendor_rates fallback 500×20%% = 100 (got %) failed', r.share;
  end if;
  if exists (select 1 from public.accounts_sales('2001-01-01', '2001-01-31') where vendor_id = '00000000-0000-4000-8000-0000000019a1' and grp not in ('completed', 'in_progress')) then
    raise exception 'case «قيد الانتظار» is not counted failed';
  end if;
  begin
    perform public.accounts_sales('2001-02-01', '2001-01-01');
    raise exception 'case a reversed range must error failed';
  exception when others then
    if sqlstate <> '22023' then raise exception 'case reversed range: expected 22023, got %', sqlstate; end if;
  end;
end $$;

-- ================================================================ view P + add F: no «المرتبات», other people's rows read-only

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000d2","role":"authenticated"}';
do $$ declare n int; begin
  if exists (select 1 from public.acc_expenses where category = 'المرتبات' and on_date = '2001-01-05') then raise exception 'case view P never sees «المرتبات» failed'; end if;
  if not exists (select 1 from public.acc_expenses where category = 'الاشتراكات' and on_date = '2001-01-05') then raise exception 'case view P sees the other categories failed'; end if;
  begin
    insert into public.acc_expenses (on_date, category, amount) values ('2001-01-08', 'المرتبات', 10);
    raise exception 'case view P may not add «المرتبات» failed';
  exception when insufficient_privilege then null;
  end;
  update public.acc_vendor_moves set amount = 1 where on_date = '2001-01-06' and vendor_id = '00000000-0000-4000-8000-0000000019a1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'case add F may not edit another member''s row failed'; end if;
end $$;

-- ================================================================ the approver: edits and voids any row

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000d3","role":"authenticated"}';
do $$ declare n int; begin
  update public.acc_vendor_moves set voided_at = now() where on_date = '2001-01-06' and vendor_id = '00000000-0000-4000-8000-0000000019a1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'case approve F voids another member''s row failed'; end if;
end $$;

-- ================================================================ no access

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000d4","role":"authenticated"}';
do $$ begin
  if exists (select 1 from public.acc_expenses where on_date = '2001-01-05') or exists (select 1 from public.dokan_balances where woo_vendor_id = 99919001) then
    raise exception 'case accounts.view N sees nothing failed';
  end if;
  begin
    perform public.accounts_sales('2001-01-01', '2001-01-31');
    raise exception 'case accounts.view N may not read the sales failed';
  exception when others then
    if sqlstate <> '42501' then raise exception 'case sales N: expected 42501, got %', sqlstate; end if;
  end;
  begin
    insert into public.acc_account_moves (account, on_date, direction, amount) values ('حساب البنك', '2001-01-07', 'deposit', 1);
    raise exception 'case accounts.add N may not add failed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ================================================================ anon: nothing

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$ begin
  begin
    perform public.accounts_sales('2001-01-01', '2001-01-31');
    raise exception 'case anon must error failed';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;

do $$ begin raise notice 'rls_accounts: ok'; end $$;
