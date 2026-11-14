-- RLS / rule tests for 0093_settings_lists_editable (docs/superpowers/plans/2026-11-14-settings-lists.md, decision 1): the expense
-- type is a base type or one the admin added in the settings row «lists» (`expenseKinds`); a row keeps a type later removed;
-- settings_public() hands the added types to every active member. Depends on 0001 … 0093. Runs in one transaction and rolls
-- back; prints NOTICE 'rls_settings_lists: ok' only if every case passed. Live-safe: every row is dated 2001 or named «… 0093 تجريبي».

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000093a1', 'sl-acc.dev@ibtekr.local', '01000093a01');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u where u.id = '00000000-0000-4000-8000-0000000093a1';
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-0000000093a1', 'محاسب 0093 تجريبي', 'sl-acc.dev@ibtekr.local', '01000093a01', 'ops', 'active', '{"accounts.view":"F","accounts.add":"F","accounts.approve":"F"}');

-- the admin's list (as the database owner — the 0002 policies are the admin's; this file only reads it back)
insert into public.settings (section, data) values ('lists', '{"expenseKinds":["إيجار 0093 تجريبي"]}'::jsonb)
  on conflict (section) do update set data = public.settings.data || jsonb_build_object('expenseKinds', coalesce(public.settings.data -> 'expenseKinds', '[]'::jsonb) || '["إيجار 0093 تجريبي"]'::jsonb);

do $$ begin
  if has_function_privilege('anon', 'public.acc_expense_kind_ok(text)', 'EXECUTE') or not has_function_privilege('authenticated', 'public.acc_expense_kind_ok(text)', 'EXECUTE') then
    raise exception 'case acc_expense_kind_ok grants (authenticated, never anon) failed';
  end if;
  if has_function_privilege('authenticated', 'public.acc_expenses_category_guard()', 'EXECUTE') then raise exception 'case the guard is the trigger''s only failed'; end if;
  if exists (select 1 from pg_constraint where conname = 'acc_expenses_category_check') then raise exception 'case the fixed check is gone failed'; end if;
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000093a1","role":"authenticated"}';
do $$ declare r record; begin
  -- the member reads the added types with the sign-in
  if not ((public.settings_public() -> 'lists' -> 'expenseKinds') ? 'إيجار 0093 تجريبي') then raise exception 'case settings_public hands expenseKinds failed'; end if;
  -- a base type and an added one go in
  insert into public.acc_expenses (on_date, category, amount, details) values ('2001-04-01', 'المصروفات', 50, 'أساسي 0093 تجريبي') returning * into r;
  insert into public.acc_expenses (on_date, category, amount, details) values ('2001-04-01', 'إيجار 0093 تجريبي', 70, 'مضاف 0093 تجريبي') returning * into r;
  if r.category <> 'إيجار 0093 تجريبي' then raise exception 'case an added type is kept failed'; end if;
  -- a type nobody added is refused, on insert and on a change
  begin
    insert into public.acc_expenses (on_date, category, amount, details) values ('2001-04-01', 'نوع 0093 مش موجود', 10, 'x');
    raise exception 'case an unknown type is refused failed';
  exception when check_violation then null;
  end;
  begin
    update public.acc_expenses set category = 'نوع 0093 مش موجود' where id = r.id;
    raise exception 'case a change to an unknown type is refused failed';
  exception when check_violation then null;
  end;
end $$;

-- the admin removes the added type: the row keeps it and still takes other edits
reset role;
update public.settings set data = data || jsonb_build_object('expenseKinds', '[]'::jsonb) where section = 'lists';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000093a1","role":"authenticated"}';
do $$ declare n int; begin
  update public.acc_expenses set amount = 75 where category = 'إيجار 0093 تجريبي' and on_date = '2001-04-01';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'case a row keeps a removed type and takes other edits failed (%)', n; end if;
  begin
    insert into public.acc_expenses (on_date, category, amount, details) values ('2001-04-02', 'إيجار 0093 تجريبي', 10, 'x');
    raise exception 'case a removed type takes no new row failed';
  exception when check_violation then null;
  end;
end $$;

reset role;
do $$ begin raise notice 'rls_settings_lists: ok'; end $$;
rollback;
