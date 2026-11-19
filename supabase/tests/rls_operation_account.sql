-- Tests for 0141 (the owner 19 Nov): the «أوبريشن» account takes account moves (an unknown account is still refused), and the
-- opening used leave of a year comes off that year's balance only. Depends on 0001 … 0141. One transaction, rolled back;
-- NOTICE 'rls_operation_account: ok' only if every case passed. Live-safe: a made-up member; nothing else is written.

begin;

insert into auth.users (id, email, phone) values ('00000000-0000-4000-8000-000000141a01', 'op-acc.dev@ibtekr.local', '0100141a01');
insert into public.profiles (id, name, email, phone, role_id, status) values
  ('00000000-0000-4000-8000-000000141a01', 'عضو أوبريشن', 'op-acc.dev@ibtekr.local', '0100141a01', 'viewer', 'active');
insert into public.hr_members (member_id, leave_days, leave_used_open, leave_used_open_year)
  values ('00000000-0000-4000-8000-000000141a01', 24, 19, 2026);

insert into public.acc_account_moves (account, on_date, direction, amount, note, dup_ok)
  values ('أوبريشن', '2026-11-11', 'deposit', 2000, 'تغذية خزنة', true);

do $$ begin
  begin
    insert into public.acc_account_moves (account, on_date, direction, amount, dup_ok) values ('حساب تاني', '2026-11-11', 'deposit', 10, true);
    raise exception 'case an unknown account is refused failed';
  exception when check_violation then null;
  end;
  if public.hr_leave_left('00000000-0000-4000-8000-000000141a01', 2026) <> 5 then raise exception 'case the opening used comes off this year failed'; end if;
  if public.hr_leave_left('00000000-0000-4000-8000-000000141a01', 2027) <> 24 then raise exception 'case the opening used stays in its year failed'; end if;
  if not has_column_privilege('authenticated', 'public.hr_members', 'leave_used_open', 'SELECT') then raise exception 'case members read the opening used failed'; end if;
  if has_column_privilege('authenticated', 'public.hr_members', 'leave_used_open', 'UPDATE') then raise exception 'case members cannot write the opening used failed'; end if;
end $$;

do $$ begin raise notice 'rls_operation_account: ok'; end $$;
rollback;
