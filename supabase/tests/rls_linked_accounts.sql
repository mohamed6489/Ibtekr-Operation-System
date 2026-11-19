-- Tests for 0143 (the owner 19 Nov — every withdraw / deposit names its account and beneficiary, all linked): an expense or a
-- maker move with an account owns one live account move that follows its edits and its void; a member cannot edit that child; a
-- transfer between two accounts makes the opposite move and keeps it in step; a vendor / member beneficiary is named by the
-- server. Depends on 0001 … 0143. One transaction, rolled back; NOTICE 'rls_linked_accounts: ok' only if every case passed.
-- Live-safe: made-up member and maker; every check is scoped to the rows this file writes.

begin;

insert into auth.users (id, email, phone) values ('00000000-0000-4000-8000-000000143a01', 'link-acc.dev@ibtekr.local', '0100143a01');
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-000000143a01', 'محاسب الربط', 'link-acc.dev@ibtekr.local', '0100143a01', 'ops', 'active',
   '{"accounts.view":"F","accounts.add":"F","accounts.approve":"F"}');
insert into public.vendors (id, name) values ('00000000-0000-4000-8000-000000143b01', 'مبتكر الربط 0143');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000143a01","role":"authenticated"}';

do $$
declare e bigint; vm bigint; t bigint; p bigint; m public.acc_account_moves; n int;
begin
  -- an expense with an account → one linked withdraw
  insert into public.acc_expenses (on_date, direction, category, beneficiary, beneficiary_other, amount, account, dup_ok)
    values ('2001-03-01', 'withdraw', 'المصروفات', 'مكتبة تجريبية', true, 300, 'حساب البنك', true) returning id into e;
  select * into m from public.acc_account_moves where expense_id = e and voided_at is null;
  if m.id is null or m.account <> 'حساب البنك' or m.direction <> 'withdraw' or m.amount <> 300 or m.beneficiary <> 'مكتبة تجريبية'
     or m.created_by <> '00000000-0000-4000-8000-000000143a01' then raise exception 'case an expense makes its account move failed'; end if;
  -- the expense changes → the child follows (one live child)
  update public.acc_expenses set amount = 350, account = 'أوبريشن' where id = e;
  select count(*) into n from public.acc_account_moves where expense_id = e and voided_at is null;
  select * into m from public.acc_account_moves where expense_id = e and voided_at is null;
  if n <> 1 or m.amount <> 350 or m.account <> 'أوبريشن' then raise exception 'case the account move follows the expense failed'; end if;
  -- a member cannot edit the child directly
  begin
    update public.acc_account_moves set amount = 1 where id = m.id;
    raise exception 'case the linked move is read-only failed';
  exception when insufficient_privilege then null;
  end;
  -- a member cannot forge a link on insert
  insert into public.acc_account_moves (account, on_date, direction, amount, expense_id, dup_ok) values ('حساب البنك', '2001-03-01', 'deposit', 5, e, true) returning id into t;
  if (select expense_id from public.acc_account_moves where id = t) is not null then raise exception 'case a member cannot set expense_id failed'; end if;
  -- the expense voided → the child voided
  update public.acc_expenses set voided_at = now() where id = e;
  if exists (select 1 from public.acc_account_moves where expense_id = e and voided_at is null) then raise exception 'case the void follows the expense failed'; end if;

  -- a maker's withdraw with an account → a linked move named by the maker
  insert into public.acc_vendor_moves (vendor_id, on_date, direction, kind, amount, account, dup_ok)
    values ('00000000-0000-4000-8000-000000143b01', '2001-03-02', 'withdraw', 'عربون', 900, 'حساب البنك', true) returning id into vm;
  select * into m from public.acc_account_moves where vendor_move_id = vm and voided_at is null;
  if m.id is null or m.beneficiary_kind <> 'vendor' or m.vendor_id <> '00000000-0000-4000-8000-000000143b01' or m.beneficiary <> 'مبتكر الربط 0143' or m.amount <> 900
    then raise exception 'case a maker move makes its account move failed'; end if;
  -- no account → no child
  insert into public.acc_vendor_moves (vendor_id, on_date, direction, kind, kind_name, amount, dup_ok)
    values ('00000000-0000-4000-8000-000000143b01', '2001-03-02', 'deposit', 'أخرى', 'تصحيح', 50, true) returning id into vm;
  if exists (select 1 from public.acc_account_moves where vendor_move_id = vm) then raise exception 'case no account no child failed'; end if;

  -- a transfer: bank → أوبريشن makes the opposite deposit, kept in step and voided with it
  insert into public.acc_account_moves (account, on_date, direction, amount, beneficiary_kind, beneficiary, dup_ok)
    values ('حساب البنك', '2001-03-03', 'withdraw', 2000, 'account', 'أوبريشن', true) returning id into t;
  select pair_id into p from public.acc_account_moves where id = t;
  select * into m from public.acc_account_moves where id = p;
  if p is null or m.account <> 'أوبريشن' or m.direction <> 'deposit' or m.amount <> 2000 or m.pair_id <> t then raise exception 'case a transfer makes its pair failed'; end if;
  update public.acc_account_moves set amount = 2500 where id = t;
  if (select amount from public.acc_account_moves where id = p) <> 2500 then raise exception 'case the pair follows the transfer failed'; end if;
  update public.acc_account_moves set voided_at = now() where id = t;
  if (select voided_at from public.acc_account_moves where id = p) is null then raise exception 'case the pair voids with the transfer failed'; end if;
  begin
    insert into public.acc_account_moves (account, on_date, direction, amount, beneficiary_kind, beneficiary, dup_ok)
      values ('حساب البنك', '2001-03-03', 'withdraw', 10, 'account', 'حساب البنك', true);
    raise exception 'case a transfer to the same account is refused failed';
  exception when invalid_parameter_value then null;
  end;

  -- a member beneficiary is named by the server
  insert into public.acc_account_moves (account, on_date, direction, amount, beneficiary_kind, beneficiary, member_id, dup_ok)
    values ('حساب البنك', '2001-03-04', 'withdraw', 100, 'member', 'اسم غلط', '00000000-0000-4000-8000-000000143a01', true) returning id into t;
  if (select beneficiary from public.acc_account_moves where id = t) <> 'محاسب الربط' then raise exception 'case the member name is the server''s failed'; end if;
end $$;

reset role;
do $$ begin raise notice 'rls_linked_accounts: ok'; end $$;
rollback;
