-- Tests for 0154 (the meeting of 23 Nov #39 — «فقد»): a lot may be «مفقود»; the decision on it goes through acc_bad_debt_add only —
-- a deposit to the maker (an «إيداع» on his account, linked) or a write-off (no money row), once per lot, with its reason; a member
-- without accounts.add F decides nothing; a member without accounts.view reads no «مفقودات» (acc_bad_debts); nobody inserts directly.
-- Depends on 0001 … 0154. One transaction, rolled back; NOTICE 'rls_inv_lost: ok' only if every case passed.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-000000154a01', 'lost-acc.dev@ibtekr.local', '0100154a01'),
  ('00000000-0000-4000-8000-000000154a02', 'lost-ops.dev@ibtekr.local', '0100154a02');
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-000000154a01', 'حسابات الفقد', 'lost-acc.dev@ibtekr.local', '0100154a01', 'accounts', 'active', '{"accounts.view":"F","accounts.add":"F","inventory.view":"F"}'),
  ('00000000-0000-4000-8000-000000154a02', 'عمليات الفقد', 'lost-ops.dev@ibtekr.local', '0100154a02', 'ops', 'active', '{"accounts.view":"N","accounts.add":"N","inventory.view":"F","inventory.edit":"F"}');
insert into public.vendors (id, woo_vendor_id, name, status) values ('00000000-0000-4000-8000-000000154b01', 915401, 'مبتكر الفقد', 'active');
insert into public.inv_lots (id, reason, status, name, vendor_id, cost) values
  ('00000000-0000-4000-8000-000000154c01', 'مرتجع', 'مفقود', 'قطعة مفقودة 1', '00000000-0000-4000-8000-000000154b01', 300),
  ('00000000-0000-4000-8000-000000154c02', 'مرتجع', 'مفقود', 'قطعة مفقودة 2', '00000000-0000-4000-8000-000000154b01', 200),
  ('00000000-0000-4000-8000-000000154c03', 'مرتجع', 'بانتظار الفحص', 'قطعة لسه', '00000000-0000-4000-8000-000000154b01', 100);

do $$ begin
  begin update public.inv_lots set status = 'ضايع' where id = '00000000-0000-4000-8000-000000154c03'; raise exception 'case an unknown status refused failed';
  exception when check_violation then null; end;
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000154a02","role":"authenticated"}';
do $$ begin
  begin perform public.acc_bad_debt_add('00000000-0000-4000-8000-000000154c01', 'writeoff', 300, 'فقد المنتج', null); raise exception 'case ops cannot decide failed';
  exception when insufficient_privilege then null; end;
  if (select count(*) from public.acc_bad_debts) <> 0 then raise exception 'case ops reads no bad debts failed'; end if;
  begin insert into public.acc_bad_debts (kind, amount, reason) values ('writeoff', 1, 'فقد المنتج'); raise exception 'case no direct insert failed';
  exception when insufficient_privilege then null; end;
end $$;

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000154a01","role":"authenticated"}';
do $$ declare n bigint; m bigint; begin
  -- a deposit: the maker's account gets an «إيداع» of the amount, linked to the row
  n := public.acc_bad_debt_add('00000000-0000-4000-8000-000000154c01', 'deposit', 300, 'فقد المنتج', null);
  m := (select vendor_move_id from public.acc_bad_debts where id = n);
  if m is null then raise exception 'case the deposit is linked failed'; end if;
  if not exists (select 1 from public.acc_vendor_moves where id = m and direction = 'deposit' and kind = 'أخرى' and amount = 300 and vendor_id = '00000000-0000-4000-8000-000000154b01') then
    raise exception 'case the deposit is on the maker''s account failed'; end if;
  -- once per lot
  begin perform public.acc_bad_debt_add('00000000-0000-4000-8000-000000154c01', 'writeoff', 300, 'فقد المنتج', null); raise exception 'case once per lot failed';
  exception when invalid_parameter_value then null; end;
  -- a write-off: no money row; «أخرى» needs its text
  begin perform public.acc_bad_debt_add('00000000-0000-4000-8000-000000154c02', 'writeoff', 200, 'أخرى', ''); raise exception 'case «أخرى» needs a text failed';
  exception when invalid_parameter_value then null; end;
  n := public.acc_bad_debt_add('00000000-0000-4000-8000-000000154c02', 'writeoff', 150, 'تلف المنتج في المخزن', null);
  if (select vendor_move_id from public.acc_bad_debts where id = n) is not null then raise exception 'case the write-off moves no money failed'; end if;
  -- a lot that is not lost; a wrong amount; a wrong reason
  begin perform public.acc_bad_debt_add('00000000-0000-4000-8000-000000154c03', 'writeoff', 100, 'فقد المنتج', null); raise exception 'case only a lost lot failed';
  exception when invalid_parameter_value then null; end;
  if (select count(*) from public.acc_bad_debts) <> 2 then raise exception 'case accounts reads the bad debts failed'; end if;
  raise notice 'rls_inv_lost: ok';
end $$;
rollback;
