-- Tests for 0072_hr_bank (phase 13 decision 39 — the member's bank account in «ملفي › بيانات الحساب»: typed by the member, shown
-- masked, revealed by the member or an admin / sensitive.salaries with every reveal logged without the number; the table itself is closed
-- to the members; it goes with the member on member_delete). Depends on 0001_identity … 0072. Runs in one transaction and rolls back;
-- prints NOTICE 'rls_hr_bank: ok' only if every case passed. Live-safe: its made-up members and rows are rolled back.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000072a1', 'bk-adm.dev@ibtekr.local', '01000072a01'),
  ('00000000-0000-4000-8000-0000000072a2', 'bk-mgr.dev@ibtekr.local', '01000072a02'),
  ('00000000-0000-4000-8000-0000000072a3', 'bk-rep.dev@ibtekr.local', '01000072a03'),
  ('00000000-0000-4000-8000-0000000072a4', 'bk-new.dev@ibtekr.local', '01000072a04');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u where u.email like 'bk-%.dev@ibtekr.local';
insert into public.profiles (id, name, email, phone, role_id, status, manager_id) values
  ('00000000-0000-4000-8000-0000000072a1', 'أدمن البنك', 'bk-adm.dev@ibtekr.local', '01000072a01', 'admin', 'active', null),
  ('00000000-0000-4000-8000-0000000072a2', 'مدير البنك', 'bk-mgr.dev@ibtekr.local', '01000072a02', 'ops', 'active', null),
  ('00000000-0000-4000-8000-0000000072a3', 'عضو البنك', 'bk-rep.dev@ibtekr.local', '01000072a03', 'cs', 'active', '00000000-0000-4000-8000-0000000072a2'),
  ('00000000-0000-4000-8000-0000000072a4', 'عضو جديد', 'bk-new.dev@ibtekr.local', '01000072a04', 'cs', 'active', null);

create or replace function pg_temp.as_member(p_uid text) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;

-- ================================================================ the member types it; the answer is masked; bad input refused

select pg_temp.as_member('00000000-0000-4000-8000-0000000072a3');
do $$
declare r jsonb;
begin
  if public.hr_bank_get() is not null then raise exception 'case nothing yet = null failed'; end if;
  begin perform public.hr_bank_set(jsonb_build_object('bank_name', 'بنك مصر', 'holder', 'عضو البنك', 'account_number', '12ab'));
    raise exception 'case a number with letters is refused failed';
  exception when sqlstate '22023' then if sqlerrm <> 'invalid: number' then raise; end if; end;
  begin perform public.hr_bank_set(jsonb_build_object('bank_name', '', 'holder', 'عضو البنك', 'account_number', '1234567890'));
    raise exception 'case the bank is required failed';
  exception when sqlstate '22023' then null; end;
  begin perform public.hr_bank_set(jsonb_build_object('bank_name', 'بنك مصر', 'holder', 'عضو البنك', 'account_number', '1234567890', 'iban', 'xx'));
    raise exception 'case a bad IBAN is refused failed';
  exception when sqlstate '22023' then if sqlerrm <> 'invalid: iban' then raise; end if; end;
  r := public.hr_bank_set(jsonb_build_object('bank_name', 'بنك مصر', 'holder', 'عضو البنك', 'account_number', '1000 2000-3000 4321', 'iban', 'eg38 0019 0005 0000 0000 2631 8000 2'));
  if r ->> 'account' <> '•••• 4321' or r ->> 'iban' <> 'EG •••• 0002' or r::text like '%10002000%' or r::text like '%0019%' then raise exception 'case the answer is masked failed (%)', r; end if;
  -- the member reveals their own
  r := public.hr_bank_reveal(null);
  if r ->> 'account_number' <> '1000200030004321' or r ->> 'iban' <> 'EG380019000500000000263180002' then raise exception 'case the member reveals their own failed (%)', r; end if;
  -- the table itself is closed
  begin perform 1 from public.hr_bank; raise exception 'case the table is closed to the members failed';
  exception when insufficient_privilege then null; end;
end $$;

-- ================================================================ the direct manager does not see it; an admin sees it masked and reveals it

select pg_temp.as_member('00000000-0000-4000-8000-0000000072a2');
do $$ begin
  begin perform public.hr_bank_get('00000000-0000-4000-8000-0000000072a3'); raise exception 'case the manager does not read it failed';
  exception when insufficient_privilege then null; end;
  begin perform public.hr_bank_reveal('00000000-0000-4000-8000-0000000072a3'); raise exception 'case the manager does not reveal it failed';
  exception when insufficient_privilege then null; end;
  -- nor writes it for someone else: hr_bank_set writes the caller's own row only
  perform public.hr_bank_set(jsonb_build_object('member', '00000000-0000-4000-8000-0000000072a3', 'bank_name', 'بنك تاني', 'holder', 'حد', 'account_number', '999999999'));
end $$;
reset role;
do $$ begin
  if (select bank_name from public.hr_bank where member_id = '00000000-0000-4000-8000-0000000072a3') <> 'بنك مصر' then raise exception 'case nobody writes another member''s row failed'; end if;
  if not exists (select 1 from public.hr_bank where member_id = '00000000-0000-4000-8000-0000000072a2') then raise exception 'case the manager''s own row failed'; end if;
end $$;

select pg_temp.as_member('00000000-0000-4000-8000-0000000072a1');
do $$
declare r jsonb;
begin
  r := public.hr_bank_get('00000000-0000-4000-8000-0000000072a3');
  if r ->> 'account' <> '•••• 4321' or r ->> 'bank_name' <> 'بنك مصر' then raise exception 'case the admin reads it masked failed (%)', r; end if;
  r := public.hr_bank_reveal('00000000-0000-4000-8000-0000000072a3');
  if r ->> 'account_number' <> '1000200030004321' then raise exception 'case the admin reveals it failed'; end if;
end $$;
reset role;

-- ================================================================ the log: who set and who revealed, never the number

do $$
declare v_txt text;
begin
  if (select count(*) from public.activity_log where action = 'hr.bank.reveal' and entity_id = '00000000-0000-4000-8000-0000000072a3') <> 2
     or not exists (select 1 from public.activity_log where action = 'hr.bank.reveal' and entity_id = '00000000-0000-4000-8000-0000000072a3' and actor = '00000000-0000-4000-8000-0000000072a1')
     or not exists (select 1 from public.activity_log where action = 'hr.bank.set' and actor = '00000000-0000-4000-8000-0000000072a3') then
    raise exception 'case every set and reveal is logged with its actor failed';
  end if;
  select string_agg(coalesce(old_value::text, '') || coalesce(new_value::text, ''), ' ') into v_txt from public.activity_log where action like 'hr.bank.%';
  if coalesce(v_txt, '') ~ '[0-9]{4}' then raise exception 'case the log carries no number failed (%)', v_txt; end if;
end $$;

-- ================================================================ the grants; the row goes with the member

do $$ begin
  if has_table_privilege('authenticated', 'public.hr_bank', 'select') or has_table_privilege('anon', 'public.hr_bank', 'select')
     or has_function_privilege('anon', 'public.hr_bank_reveal(uuid)', 'execute') or has_function_privilege('anon', 'public.hr_bank_get(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.hr_bank_set(jsonb)', 'execute') then
    raise exception 'case the grants of 0072 failed';
  end if;
end $$;
-- a member with nothing but personal rows (a bank account written as the server, so no log row of theirs) can still be deleted
insert into public.hr_bank (member_id, bank_name, holder, account_number) values ('00000000-0000-4000-8000-0000000072a4', 'بنك', 'عضو جديد', '11112222');
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
do $$ begin
  perform public.member_delete('00000000-0000-4000-8000-0000000072a4', '00000000-0000-4000-8000-0000000072a1');
  if exists (select 1 from public.hr_bank where member_id = '00000000-0000-4000-8000-0000000072a4') then raise exception 'case the bank row goes with the member failed'; end if;
  raise notice 'rls_hr_bank: ok';
end $$;
rollback;
