-- Tests for 0105_live_guards (docs/superpowers/plans/2026-11-15-live-sync.md decisions 3 and 4 — the owner 15 Nov: «عايز امنع الكتابة
-- علي بعض»). Depends on 0001 … 0105. One transaction, rolled back; NOTICE 'rls_live_guards: ok' only if every case passed.
-- Live-safe: made-up rows; every count is scoped to them.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000105a1', 'lg-one.dev@ibtekr.local', '01000001051'),
  ('00000000-0000-4000-8000-0000000105a2', 'lg-two.dev@ibtekr.local', '01000001052');
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-0000000105a1', 'عضو أول',  'lg-one.dev@ibtekr.local', '01000001051', 'ops', 'active', '{"orders.view":"F","orders.status":"F","orders.edit":"F","accounts.view":"F","accounts.add":"F"}'),
  ('00000000-0000-4000-8000-0000000105a2', 'عضو تاني', 'lg-two.dev@ibtekr.local', '01000001052', 'ops', 'active', '{"orders.view":"F","orders.status":"F","orders.edit":"F","accounts.view":"F","accounts.add":"F"}');
insert into public.vendors (id, name) values ('00000000-0000-4000-8000-0000000105f1', 'مبتكر الحراسة');
insert into public.orders (id, number, customer_name, status, placed_at) values
  (990105001, 'G1', 'عميل حراسة', 'جاري التنفيذ', now()), (990105002, 'G2', 'عميل حراسة', 'جاري التنفيذ', now()), (990105003, 'G3', 'عميل حراسة', 'جاري التنفيذ', now());

create or replace function pg_temp.as_member(p_uid text) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', 'aal2')::text, true);
end $$;

-- ================================================================ part 1 — orders
do $$
declare n int; rid bigint;
begin
  -- the page's own write: «update … where id and status = what I was looking at» — the first member's goes, the second's (still
  -- looking at the old status) writes no row
  perform pg_temp.as_member('00000000-0000-4000-8000-0000000105a1');
  update public.orders set status = 'جاهز للشحن' where id = 990105001 and status = 'جاري التنفيذ';
  get diagnostics n = row_count; if n <> 1 then raise exception 'the first member''s change was not written'; end if;
  perform pg_temp.as_member('00000000-0000-4000-8000-0000000105a2');
  update public.orders set status = 'قيد الشحن' where id = 990105001 and status = 'جاري التنفيذ';
  get diagnostics n = row_count; if n <> 0 then raise exception 'a stale change was written over the first one'; end if;
  if (select status from public.orders where id = 990105001) <> 'جاهز للشحن' then raise exception 'the first member''s status is gone'; end if;
  -- the same for a note (null on the screen) and the confirmation
  update public.orders set note = 'ملاحظة العضو التاني' where id = 990105001 and note is null;
  get diagnostics n = row_count; if n <> 1 then raise exception 'a note on an untouched order was refused'; end if;
  perform pg_temp.as_member('00000000-0000-4000-8000-0000000105a1');
  update public.orders set note = 'ملاحظة العضو الأول' where id = 990105001 and note is null;
  get diagnostics n = row_count; if n <> 0 then raise exception 'a note was written over a teammate''s'; end if;

  -- «مكتمل» with the rating: the member who still sees «جاري التنفيذ» after a teammate completed it is refused — one rating
  rid := public.order_complete(990105002, 5, 5, null, 'جاري التنفيذ');
  if rid is null or (select status from public.orders where id = 990105002) <> 'مكتمل' then raise exception 'order_complete with p_from did not complete'; end if;
  perform pg_temp.as_member('00000000-0000-4000-8000-0000000105a2');
  begin
    perform public.order_complete(990105002, 4, 4, null, 'جاري التنفيذ');
    raise exception 'a second completion of the same order went through';
  exception when sqlstate 'IBSTL' then null;
  end;
  if (select count(*) from public.customer_ratings where order_id = 990105002) <> 1 then raise exception 'two ratings for one order'; end if;
  -- an unknown order with p_from; and an older page (no p_from) as before
  begin
    perform public.order_complete(990105999, 4, 4, null, 'جاري التنفيذ');
    raise exception 'an unknown order was completed';
  exception when sqlstate 'P0002' then null;
  end;
  rid := public.order_complete(990105003, 3, 3, null);
  if (select status from public.orders where id = 990105003) <> 'مكتمل' then raise exception 'order_complete without p_from changed'; end if;
  reset role;
  -- one function only (an old 4-argument one beside it would make the API unable to choose), not for anon
  if (select count(*) from pg_proc where proname = 'order_complete' and pronamespace = 'public'::regnamespace) <> 1 then raise exception 'two order_complete functions'; end if;
  if has_function_privilege('anon', 'public.order_complete(bigint, int, int, text, text)', 'execute') or not has_function_privilege('authenticated', 'public.order_complete(bigint, int, int, text, text)', 'execute') then
    raise exception 'order_complete grants';
  end if;
end $$;

-- ================================================================ part 2 — the same money entry twice
do $$
declare n int; d text; j jsonb;
begin
  -- the owner's case: one member records «إيداع 10» for a maker, a teammate records the same a moment later
  perform pg_temp.as_member('00000000-0000-4000-8000-0000000105a1');
  insert into public.acc_vendor_moves (vendor_id, on_date, direction, kind, kind_name, amount) values ('00000000-0000-4000-8000-0000000105f1', current_date, 'deposit', 'أخرى', 'تصحيح رصيد', 10);
  perform pg_temp.as_member('00000000-0000-4000-8000-0000000105a2');
  begin
    insert into public.acc_vendor_moves (vendor_id, on_date, direction, kind, kind_name, amount) values ('00000000-0000-4000-8000-0000000105f1', current_date, 'deposit', 'أخرى', 'تصحيح رصيد', 10);
    raise exception 'the same entry was recorded twice';
  exception when sqlstate 'IBDUP' then get stacked diagnostics d = pg_exception_detail;
  end;
  j := d::jsonb;
  if j ->> 'by' <> 'عضو أول' or (j ->> 'minutes')::int <> 0 or (select count(*) from jsonb_object_keys(j)) <> 2 then raise exception 'the refusal names who recorded it and how long ago, nothing else: %', d; end if;
  -- the same member twice (a double save) is caught too
  perform pg_temp.as_member('00000000-0000-4000-8000-0000000105a1');
  begin
    insert into public.acc_vendor_moves (vendor_id, on_date, direction, kind, kind_name, amount) values ('00000000-0000-4000-8000-0000000105f1', current_date, 'deposit', 'أخرى', 'تصحيح رصيد', 10);
    raise exception 'a double save went through';
  exception when sqlstate 'IBDUP' then null;
  end;
  -- «دي حركة تانية» (dup_ok), another amount, another direction, another kind: recorded
  insert into public.acc_vendor_moves (vendor_id, on_date, direction, kind, kind_name, amount, dup_ok) values ('00000000-0000-4000-8000-0000000105f1', current_date, 'deposit', 'أخرى', 'تصحيح رصيد', 10, true);
  insert into public.acc_vendor_moves (vendor_id, on_date, direction, kind, kind_name, amount) values ('00000000-0000-4000-8000-0000000105f1', current_date, 'deposit', 'أخرى', 'تصحيح رصيد', 11);
  insert into public.acc_vendor_moves (vendor_id, on_date, direction, kind, amount) values ('00000000-0000-4000-8000-0000000105f1', current_date, 'withdraw', 'عربون', 10);
  insert into public.acc_vendor_moves (vendor_id, on_date, direction, kind, amount) values ('00000000-0000-4000-8000-0000000105f1', current_date, 'withdraw', 'مواصلات', 10);
  reset role;
  select count(*) into n from public.acc_vendor_moves where vendor_id = '00000000-0000-4000-8000-0000000105f1';
  if n <> 5 then raise exception 'vendor moves recorded: %', n; end if;

  -- an entry older than 10 minutes, or a voided one, is not «the same entry a moment ago»
  update public.acc_vendor_moves set created_at = now() - interval '11 minutes' where vendor_id = '00000000-0000-4000-8000-0000000105f1' and kind = 'عربون';
  update public.acc_vendor_moves set voided_at = now() where vendor_id = '00000000-0000-4000-8000-0000000105f1' and kind = 'مواصلات';
  perform pg_temp.as_member('00000000-0000-4000-8000-0000000105a2');
  insert into public.acc_vendor_moves (vendor_id, on_date, direction, kind, amount) values ('00000000-0000-4000-8000-0000000105f1', current_date, 'withdraw', 'عربون', 10);
  insert into public.acc_vendor_moves (vendor_id, on_date, direction, kind, amount) values ('00000000-0000-4000-8000-0000000105f1', current_date, 'withdraw', 'مواصلات', 10);

  -- expenses: the same type, beneficiary, direction and amount; another beneficiary (three salaries of the same amount) is not
  insert into public.acc_expenses (on_date, direction, category, beneficiary, amount) values (current_date, 'withdraw', 'المصروفات', 'مطبعة الحراسة', 250);
  begin
    insert into public.acc_expenses (on_date, direction, category, beneficiary, amount) values (current_date, 'withdraw', 'المصروفات', ' مطبعة الحراسة ', 250.00);
    raise exception 'the same expense was recorded twice';
  exception when sqlstate 'IBDUP' then null;
  end;
  insert into public.acc_expenses (on_date, direction, category, beneficiary, amount) values (current_date, 'withdraw', 'المصروفات', 'مطبعة تانية', 250);
  -- the real account: the same account, direction and amount
  insert into public.acc_account_moves (account, on_date, direction, amount) values ('حساب البنك', current_date, 'deposit', 777);
  begin
    insert into public.acc_account_moves (account, on_date, direction, amount) values ('حساب البنك', current_date, 'deposit', 777);
    raise exception 'the same account move was recorded twice';
  exception when sqlstate 'IBDUP' then null;
  end;
  insert into public.acc_account_moves (account, on_date, direction, amount) values ('حساب بوسطة', current_date, 'deposit', 777);
  reset role;

  -- the server's own entries are not asked (a function that runs as its owner, an import by the service role)
  insert into public.acc_account_moves (account, on_date, direction, amount) values ('حساب البنك', current_date, 'deposit', 777);
  insert into public.acc_account_moves (account, on_date, direction, amount) values ('حساب البنك', current_date, 'deposit', 777);

  -- a member who may not add entries learns nothing from the lookup; nobody outside signs in to it
  update public.profiles set custom_perms = '{"accounts.view":"F","accounts.add":"N"}' where id = '00000000-0000-4000-8000-0000000105a2';
  perform pg_temp.as_member('00000000-0000-4000-8000-0000000105a2');
  if public.acc_dup_find('acc_account_moves', 'حساب البنك', 'deposit', 777) is not null then raise exception 'the lookup answered a member without accounts.add'; end if;
  perform pg_temp.as_member('00000000-0000-4000-8000-0000000105a1');
  if public.acc_dup_find('acc_account_moves', 'حساب البنك', 'deposit', 777) is null then raise exception 'the lookup missed an entry'; end if;
  if public.acc_dup_find('profiles', 'x', 'deposit', 1) is not null then raise exception 'the lookup read another table'; end if;
  reset role;
  if has_function_privilege('anon', 'public.acc_dup_find(text, text, text, numeric)', 'execute') or has_function_privilege('authenticated', 'public.acc_dup_guard()', 'execute') then
    raise exception 'grants of the duplicate guard';
  end if;
  if (select prosecdef from pg_proc where oid = 'public.acc_dup_guard()'::regprocedure) or not (select prosecdef from pg_proc where oid = 'public.acc_dup_find(text, text, text, numeric)'::regprocedure)
     or (select provolatile from pg_proc where oid = 'public.acc_dup_find(text, text, text, numeric)'::regprocedure) <> 'v' then
    raise exception 'the guard runs as the caller, the lookup as its owner and volatile';
  end if;
end $$;

do $$ begin raise notice 'rls_live_guards: ok'; end $$;
rollback;
