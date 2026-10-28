-- RLS / permission tests for 0020_accounts_fields (the fields per expense type, the subscription check for a deposit, the
-- lists of subscriptions and ad platforms). Depends on 0001_identity … 0020_accounts_fields. Runs in one transaction and
-- rolls back; prints NOTICE 'rls_accounts_lists: ok' only if every case passed. Live-safe: every row this file writes is
-- dated 2001 or named «… 0020 تجريبي». Every name, number and phone is made up.

begin;

-- Test users (fixed UUIDs …e1–…e3): the accountant (view F, add F), view F without add, no access.
insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000000e1', 'lists-f.dev@ibtekr.local', '010000000e1'),
  ('00000000-0000-4000-8000-0000000000e2', 'lists-v.dev@ibtekr.local', '010000000e2'),
  ('00000000-0000-4000-8000-0000000000e3', 'lists-n.dev@ibtekr.local', '010000000e3');

insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email)
from auth.users u
where u.id in ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000e3');

insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-0000000000e1', 'قوايم كامل', 'lists-f.dev@ibtekr.local', '010000000e1', 'ops', 'active', '{"accounts.view":"F","accounts.add":"F","accounts.approve":"N"}'),
  ('00000000-0000-4000-8000-0000000000e2', 'قوايم قراءة', 'lists-v.dev@ibtekr.local', '010000000e2', 'ops', 'active', '{"accounts.view":"F","accounts.add":"N","accounts.approve":"N"}'),
  ('00000000-0000-4000-8000-0000000000e3', 'قوايم بدون', 'lists-n.dev@ibtekr.local', '010000000e3', 'ops', 'active', '{"accounts.view":"N","accounts.add":"N","accounts.approve":"N"}');

-- ================================================================ runner: the grants

do $$ begin
  if has_table_privilege('authenticated', 'public.acc_list_items', 'UPDATE') or has_table_privilege('authenticated', 'public.acc_list_items', 'DELETE')
     or has_table_privilege('anon', 'public.acc_list_items', 'SELECT') or not has_table_privilege('authenticated', 'public.acc_list_items', 'INSERT')
     or not has_table_privilege('authenticated', 'public.acc_list_items', 'SELECT') then
    raise exception 'case list grants (authenticated select / insert only; anon nothing) failed';
  end if;
end $$;

-- ================================================================ the accountant (view F, add F)

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000e1","role":"authenticated"}';
do $$ declare r record; lid bigint; begin
  -- a deposit in «الاشتراكات»: money coming back, no subscription fields (decision 2)
  insert into public.acc_expenses (on_date, direction, category, beneficiary, beneficiary_other, amount, reason)
    values ('2001-03-01', 'deposit', 'الاشتراكات', 'Canva', true, 120, 'إلغاء اشتراك') returning * into r;
  if r.reason <> 'إلغاء اشتراك' or r.sub_name is not null then raise exception 'case a subscription deposit without sub fields failed'; end if;
  begin
    insert into public.acc_expenses (on_date, direction, category, amount) values ('2001-03-01', 'withdraw', 'الاشتراكات', 100);
    raise exception 'case a subscription withdraw still needs its name / end / alert failed';
  exception when check_violation then null;
  end;
  begin
    insert into public.acc_expenses (on_date, direction, category, amount, reason) values ('2001-03-01', 'deposit', 'المصروفات', 10, 'سبب من بره القايمة');
    raise exception 'case reason outside REFUND_REASONS must error failed';
  exception when check_violation then null;
  end;
  insert into public.acc_expenses (on_date, category, beneficiary, beneficiary_other, staff_kind, amount)
    values ('2001-03-02', 'المرتبات', 'فريلانسر 0020 تجريبي', true, 'freelance', 900) returning * into r;
  if r.staff_kind <> 'freelance' then raise exception 'case staff_kind is kept failed'; end if;
  begin
    insert into public.acc_expenses (on_date, category, amount, staff_kind) values ('2001-03-02', 'المرتبات', 10, 'boss');
    raise exception 'case staff_kind is staff | freelance failed';
  exception when check_violation then null;
  end;
  insert into public.acc_expenses (on_date, category, beneficiary, amount, details) values ('2001-03-03', 'الإعلانات', 'تيك توك', 500, 'حملة 0020 تجريبي') returning * into r;
  if r.details <> 'حملة 0020 تجريبي' then raise exception 'case details is kept failed'; end if;
  -- the lists
  insert into public.acc_list_items (list, name) values ('subs', 'اشتراك 0020 تجريبي') returning id into lid;
  if (select created_by from public.acc_list_items where id = lid) <> '00000000-0000-4000-8000-0000000000e1' then raise exception 'case list created_by is the caller failed'; end if;
  begin
    insert into public.acc_list_items (list, name) values ('subs', '  اشتراك 0020 تجريبي ');
    raise exception 'case a list name is unique (trim) failed';
  exception when unique_violation then null;
  end;
  insert into public.acc_list_items (list, name) values ('ads', 'اشتراك 0020 تجريبي'); -- another list: allowed
  begin
    insert into public.acc_list_items (list, name) values ('vendors', 'x 0020 تجريبي');
    raise exception 'case list is subs | ads failed';
  exception when check_violation then null;
  end;
  begin
    insert into public.acc_list_items (list, name, created_by) values ('ads', 'منصة 0020 تجريبي', '00000000-0000-4000-8000-0000000000e2');
    raise exception 'case a list row is added as oneself failed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.acc_list_items set name = 'تغيير 0020 تجريبي' where id = lid;
    raise exception 'case a member may not edit a list row failed';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.acc_list_items where id = lid;
    raise exception 'case a member may not delete a list row failed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ================================================================ view F, no add: reads the lists, adds nothing

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000e2","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.acc_list_items where name = 'اشتراك 0020 تجريبي') <> 2 then raise exception 'case accounts.view reads the lists failed'; end if;
  begin
    insert into public.acc_list_items (list, name) values ('ads', 'منصة 0020 تجريبي');
    raise exception 'case accounts.add = N may not add to a list failed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ================================================================ no access

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000e3","role":"authenticated"}';
do $$ begin
  if exists (select 1 from public.acc_list_items where name = 'اشتراك 0020 تجريبي') then raise exception 'case accounts.view = N reads no list failed'; end if;
end $$;

reset role;
do $$ begin raise notice 'rls_accounts_lists: ok'; end $$;
rollback;
