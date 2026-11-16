-- Tests for 0115_accounts_salaries: a member of «الحسابات» has sensitive.salaries = F (the payroll), «عمليات» does not.
begin;
insert into auth.users (id, email, phone) values ('00000000-0000-4000-8000-000000115a01', 'acs.dev@ibtekr.local', '0100000115a1'), ('00000000-0000-4000-8000-000000115a02', 'ops-s.dev@ibtekr.local', '0100000115a2');
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms, extra_roles) values
  ('00000000-0000-4000-8000-000000115a01', 'حسابات المرتبات', 'acs.dev@ibtekr.local', '0100000115a1', 'accounts', 'active', '{}', '{}'),
  ('00000000-0000-4000-8000-000000115a02', 'عمليات المرتبات', 'ops-s.dev@ibtekr.local', '0100000115a2', 'ops', 'active', '{}', '{}');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000115a01', 'role', 'authenticated', 'aal', 'aal2')::text, true);
do $$ begin if public.has_perm('sensitive.salaries') <> 'F' or not public.hr_salaries() then raise exception 'case accounts reads the payroll failed'; end if; end $$;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000115a02', 'role', 'authenticated', 'aal', 'aal2')::text, true);
do $$ begin if public.has_perm('sensitive.salaries') = 'F' then raise exception 'case ops does not read the payroll failed'; end if; end $$;
reset role;
do $$ begin raise notice 'rls_accounts_salaries: ok'; end $$;
rollback;
