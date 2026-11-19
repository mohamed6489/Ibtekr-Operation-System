-- 0143 — every withdraw / deposit names its account and its beneficiary, all linked (the owner 19 Nov: «خلي اي سحب او ايداع من
-- السيستم يجبلي الحساب اللي هسحب منه او هعمل ايداع فيه … وف البوب دايما يبقي فيه مستفيد و كله يبقي مربوط ببعضه»; his answers:
-- one linked operation · a beneficiary list by kind · the account on a maker's withdraw only · an overdraft saves with a warning ·
-- the Dokan approval records the transfer · «المصروفات» always names a beneficiary).
--
-- 1) acc_expenses.account / acc_vendor_moves.account — the real account the money left (or came into). A row with an account owns
--    one live acc_account_moves row (expense_id / vendor_move_id): made, changed and voided with it by acc_link_sync (security
--    definer, the session flag ib.acc_link). A member never edits that child directly (42501 «linked») — the page edits its source.
-- 2) acc_account_moves.beneficiary_kind ('vendor' | 'member' | 'account' | 'other') + beneficiary (the name) + vendor_id /
--    member_id. 'account' is a transfer: the other account gets the opposite move (pair_id both ways), kept in step with it.
-- 3) acc_account_moves.withdraw_id — the transfer of an approved Dokan request (woo-sync withdraw_approve with an account; one per
--    request). The server writes it; members read it like any move.
-- No balance check on the server (the page warns; the owner: «اسمح مع تحذير»). Old rows keep account = null (not linked).

do $$
declare acc text := $a$('حساب البنك', 'حساب بوسطة', 'حساب باي موب', 'محفظة إلكترونية', 'أوبريشن')$a$;
begin
  alter table public.acc_expenses add column if not exists account text;
  alter table public.acc_vendor_moves add column if not exists account text;
  if not exists (select 1 from pg_constraint where conname = 'acc_expenses_account_check') then
    execute 'alter table public.acc_expenses add constraint acc_expenses_account_check check (account is null or account in ' || acc || ')';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'acc_vendor_moves_account_check') then
    execute 'alter table public.acc_vendor_moves add constraint acc_vendor_moves_account_check check (account is null or account in ' || acc || ')';
  end if;
end $$;

alter table public.acc_account_moves add column if not exists beneficiary_kind text;
alter table public.acc_account_moves add column if not exists beneficiary text;
alter table public.acc_account_moves add column if not exists vendor_id uuid references public.vendors on delete restrict;
alter table public.acc_account_moves add column if not exists member_id uuid references public.profiles on delete set null;
alter table public.acc_account_moves add column if not exists expense_id bigint references public.acc_expenses on delete cascade;
alter table public.acc_account_moves add column if not exists vendor_move_id bigint references public.acc_vendor_moves on delete cascade;
alter table public.acc_account_moves add column if not exists pair_id bigint references public.acc_account_moves on delete set null;
alter table public.acc_account_moves add column if not exists withdraw_id bigint;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'acc_account_moves_beneficiary_kind_check') then
    alter table public.acc_account_moves add constraint acc_account_moves_beneficiary_kind_check
      check (beneficiary_kind is null or beneficiary_kind in ('vendor', 'member', 'account', 'other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'acc_account_moves_beneficiary_check') then
    alter table public.acc_account_moves add constraint acc_account_moves_beneficiary_check check (beneficiary is null or char_length(beneficiary) <= 80);
  end if;
end $$;
create unique index if not exists acc_account_moves_expense_live on public.acc_account_moves (expense_id) where expense_id is not null and voided_at is null;
create unique index if not exists acc_account_moves_vmove_live on public.acc_account_moves (vendor_move_id) where vendor_move_id is not null and voided_at is null;
create unique index if not exists acc_account_moves_withdraw_live on public.acc_account_moves (withdraw_id) where withdraw_id is not null and voided_at is null;
create index if not exists acc_account_moves_vendor_idx on public.acc_account_moves (vendor_id);
create index if not exists acc_account_moves_member_idx on public.acc_account_moves (member_id);
create index if not exists acc_account_moves_pair_idx on public.acc_account_moves (pair_id);
create index if not exists acc_account_moves_expense_idx on public.acc_account_moves (expense_id);
create index if not exists acc_account_moves_vmove_idx on public.acc_account_moves (vendor_move_id);

-- ---------------------------------------------------------------- the members' guard on the account moves

create or replace function public.acc_account_link_guard() returns trigger
language plpgsql set search_path = public as $$
declare v_accts text[] := array['حساب البنك', 'حساب بوسطة', 'حساب باي موب', 'محفظة إلكترونية', 'أوبريشن'];
begin
  if current_user not in ('anon', 'authenticated') or coalesce(current_setting('ib.acc_link', true), '') = '1' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.expense_id := null; new.vendor_move_id := null; new.pair_id := null; new.withdraw_id := null;
  else
    if old.expense_id is not null or old.vendor_move_id is not null then
      raise exception 'linked: change it from its expense or maker move' using errcode = '42501';
    end if;
    new.expense_id := old.expense_id; new.vendor_move_id := old.vendor_move_id; new.pair_id := old.pair_id; new.withdraw_id := old.withdraw_id;
  end if;
  new.beneficiary := nullif(btrim(coalesce(new.beneficiary, '')), '');
  if new.beneficiary_kind = 'account' then
    if new.beneficiary is null or not (new.beneficiary = any (v_accts)) or new.beneficiary = new.account then
      raise exception 'invalid: beneficiary' using errcode = '22023';
    end if;
  elsif new.beneficiary_kind = 'vendor' then
    if new.vendor_id is null then raise exception 'invalid: vendor' using errcode = '22023'; end if;
    select v.name into new.beneficiary from public.vendors v where v.id = new.vendor_id;
  elsif new.beneficiary_kind = 'member' then
    if new.member_id is null then raise exception 'invalid: member' using errcode = '22023'; end if;
    select p.name into new.beneficiary from public.profiles p where p.id = new.member_id;
  end if;
  if new.beneficiary_kind is distinct from 'vendor' then new.vendor_id := null; end if;
  if new.beneficiary_kind is distinct from 'member' then new.member_id := null; end if;
  return new;
end $$;
revoke execute on function public.acc_account_link_guard() from public, anon, authenticated;
drop trigger if exists acc_account_moves_link_guard on public.acc_account_moves;
create trigger acc_account_moves_link_guard before insert or update on public.acc_account_moves
  for each row execute function public.acc_account_link_guard();

-- ---------------------------------------------------------------- the link: a source row → its account move

-- p_kind 'expense' | 'vmove'; p_live = the source still moves money (an account, not voided). Upserts / voids the one live child.
create or replace function public.acc_link_child(p_kind text, p_id bigint, p_live boolean, p_account text, p_date date, p_dir text,
  p_amount numeric, p_note text, p_bkind text, p_ben text, p_vendor uuid, p_by uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_prev text := coalesce(current_setting('ib.acc_link', true), '');
begin
  perform set_config('ib.acc_link', '1', true);
  if p_kind = 'expense' then
    select id into v_id from public.acc_account_moves where expense_id = p_id and voided_at is null;
  else
    select id into v_id from public.acc_account_moves where vendor_move_id = p_id and voided_at is null;
  end if;
  if not p_live then
    if v_id is not null then
      update public.acc_account_moves set voided_at = now(), voided_by = auth.uid() where id = v_id;
    end if;
  elsif v_id is null then
    insert into public.acc_account_moves (account, on_date, direction, amount, note, beneficiary_kind, beneficiary, vendor_id,
      expense_id, vendor_move_id, created_by, dup_ok)
    values (p_account, p_date, p_dir, p_amount, left(p_note, 500), p_bkind, left(p_ben, 80), p_vendor,
      case when p_kind = 'expense' then p_id end, case when p_kind = 'vmove' then p_id end, p_by, true);
  else
    update public.acc_account_moves set account = p_account, on_date = p_date, direction = p_dir, amount = p_amount,
      note = left(p_note, 500), beneficiary_kind = p_bkind, beneficiary = left(p_ben, 80), vendor_id = p_vendor,
      updated_at = now(), updated_by = auth.uid()
    where id = v_id;
  end if;
  perform set_config('ib.acc_link', v_prev, true);
end $$;
revoke execute on function public.acc_link_child(text, bigint, boolean, text, date, text, numeric, text, text, text, uuid, uuid) from public, anon, authenticated;

create or replace function public.acc_expense_link() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_pay boolean := new.category = 'المرتبات';
begin
  if tg_op = 'UPDATE' and new.account is not distinct from old.account and new.on_date = old.on_date and new.direction = old.direction
     and new.amount = old.amount and new.category = old.category and new.beneficiary is not distinct from old.beneficiary
     and new.voided_at is not distinct from old.voided_at then
    return new;
  end if;
  if tg_op = 'INSERT' and new.account is null then return new; end if;
  -- the salaries' names stay out of the account moves (accounts.view = P reads those, not «المرتبات» — 0019)
  perform public.acc_link_child('expense', new.id, new.account is not null and new.voided_at is null, new.account, new.on_date, new.direction,
    new.amount, new.category || case when v_pay or new.beneficiary is null then '' else ' — ' || new.beneficiary end,
    'other', case when v_pay then 'المرتبات' else new.beneficiary end, null, new.created_by);
  return new;
end $$;
revoke execute on function public.acc_expense_link() from public, anon, authenticated;
drop trigger if exists acc_expenses_link on public.acc_expenses;
create trigger acc_expenses_link after insert or update on public.acc_expenses for each row execute function public.acc_expense_link();

create or replace function public.acc_vmove_link() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if tg_op = 'UPDATE' and new.account is not distinct from old.account and new.on_date = old.on_date and new.direction = old.direction
     and new.amount = old.amount and new.kind = old.kind and new.kind_name is not distinct from old.kind_name and new.vendor_id = old.vendor_id
     and new.voided_at is not distinct from old.voided_at then
    return new;
  end if;
  if tg_op = 'INSERT' and new.account is null then return new; end if;
  select v.name into v_name from public.vendors v where v.id = new.vendor_id;
  perform public.acc_link_child('vmove', new.id, new.account is not null and new.voided_at is null, new.account, new.on_date, new.direction,
    new.amount, coalesce(nullif(new.kind_name, ''), new.kind) || ' — ' || coalesce(v_name, 'مبتكر'), 'vendor', v_name, new.vendor_id, new.created_by);
  return new;
end $$;
revoke execute on function public.acc_vmove_link() from public, anon, authenticated;
drop trigger if exists acc_vendor_moves_link on public.acc_vendor_moves;
create trigger acc_vendor_moves_link after insert or update on public.acc_vendor_moves for each row execute function public.acc_vmove_link();

-- ---------------------------------------------------------------- a transfer between two accounts (beneficiary_kind 'account')

create or replace function public.acc_transfer_link() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_prev text := coalesce(current_setting('ib.acc_link', true), ''); v_pair bigint; v_note text;
begin
  if v_prev = '1' then return new; end if;
  if tg_op = 'INSERT' and new.beneficiary_kind is distinct from 'account' then return new; end if;
  if tg_op = 'UPDATE' and new.pair_id is null and new.beneficiary_kind is distinct from 'account' then return new; end if;
  perform set_config('ib.acc_link', '1', true);
  v_pair := new.pair_id;
  v_note := case when new.direction = 'withdraw' then 'تحويل من ' || new.account else 'تحويل إلى ' || new.account end
    || coalesce(' — ' || nullif(new.note, ''), '');
  if new.beneficiary_kind = 'account' and new.voided_at is null then
    if v_pair is null then
      insert into public.acc_account_moves (account, on_date, direction, amount, note, beneficiary_kind, beneficiary, pair_id, created_by, dup_ok)
      values (new.beneficiary, new.on_date, case when new.direction = 'withdraw' then 'deposit' else 'withdraw' end, new.amount, left(v_note, 500),
        'account', new.account, new.id, new.created_by, true)
      returning id into v_pair;
      update public.acc_account_moves set pair_id = v_pair where id = new.id;
    else
      update public.acc_account_moves set account = new.beneficiary, on_date = new.on_date,
        direction = case when new.direction = 'withdraw' then 'deposit' else 'withdraw' end, amount = new.amount, note = left(v_note, 500),
        beneficiary_kind = 'account', beneficiary = new.account, voided_at = null, voided_by = null, updated_at = now(), updated_by = auth.uid()
      where id = v_pair and voided_at is null;
    end if;
  elsif v_pair is not null then
    update public.acc_account_moves set voided_at = now(), voided_by = auth.uid() where id = v_pair and voided_at is null;
    if new.voided_at is null then update public.acc_account_moves set pair_id = null where id = new.id; end if;
  end if;
  perform set_config('ib.acc_link', v_prev, true);
  return new;
end $$;
revoke execute on function public.acc_transfer_link() from public, anon, authenticated;
drop trigger if exists acc_account_moves_transfer on public.acc_account_moves;
create trigger acc_account_moves_transfer after insert or update on public.acc_account_moves for each row execute function public.acc_transfer_link();
