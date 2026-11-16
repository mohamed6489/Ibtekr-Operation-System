-- Tests for 0110_adjust_after_pay (comments decision 78 — the owner 15 Nov: a bonus / deduction for a member whose pay of the month
-- already went out is refused, and goes on the next month instead). Depends on 0001_identity … 0110. Runs in one transaction and
-- rolls back; prints NOTICE 'rls_adjust_after_pay: ok' only if every case passed. Live-safe: its made-up members and rows are rolled back.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-000000110a01', 'aap-adm.dev@ibtekr.local', '01000110a01'),
  ('00000000-0000-4000-8000-000000110a02', 'aap-one.dev@ibtekr.local', '01000110a02'),
  ('00000000-0000-4000-8000-000000110a03', 'aap-two.dev@ibtekr.local', '01000110a03');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u where u.email like 'aap-%.dev@ibtekr.local';
insert into public.profiles (id, name, email, phone, role_id, status) values
  ('00000000-0000-4000-8000-000000110a01', 'أدمن البند', 'aap-adm.dev@ibtekr.local', '01000110a01', 'admin', 'active'),
  ('00000000-0000-4000-8000-000000110a02', 'عضو اتحوّله', 'aap-one.dev@ibtekr.local', '01000110a02', 'cs', 'active'),
  ('00000000-0000-4000-8000-000000110a03', 'عضو لسه', 'aap-two.dev@ibtekr.local', '01000110a03', 'cs', 'active');
insert into public.hr_pay (member_id, salary, holdback, allowances) values
  ('00000000-0000-4000-8000-000000110a02', 9000, 0, 0), ('00000000-0000-4000-8000-000000110a03', 8000, 0, 0);
insert into public.hr_members (member_id, leave_days, hire_date) values
  ('00000000-0000-4000-8000-000000110a02', 21, '2025-01-01'), ('00000000-0000-4000-8000-000000110a03', 21, '2025-01-01');
insert into public.settings (section, data) values ('hr', '{}') on conflict (section) do nothing;

create or replace function pg_temp.as_member(p_uid text) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;

-- the guard only runs as the trigger
do $$ begin
  if has_function_privilege('authenticated', 'public.hr_adjustments_guard()', 'EXECUTE') or has_function_privilege('anon', 'public.hr_adjustments_guard()', 'EXECUTE') then
    raise exception 'case the guard is not callable failed';
  end if;
end $$;

select pg_temp.as_member('00000000-0000-4000-8000-000000110a01');
do $$
declare v_msg text; v_id bigint;
begin
  -- before the pay: a bonus on the month passes
  insert into public.hr_adjustments (member_id, month, amount, label) values ('00000000-0000-4000-8000-000000110a02', '2026-02-01', 300, 'مكافأة قبل التحويل') returning id into v_id;
  if v_id is null then raise exception 'case an adjustment before the pay failed'; end if;

  -- the member is paid alone; the month's sheet is still open
  perform public.hr_pay_member('2026-02-01', '00000000-0000-4000-8000-000000110a02', 'حساب البنك');
  if (select count(*) from public.hr_payroll_paid where month = '2026-02-01' and member_id = '00000000-0000-4000-8000-000000110a02') <> 1 then raise exception 'case the member is paid failed'; end if;
  if exists (select 1 from public.hr_payroll where month = '2026-02-01' and status in ('معتمد', 'مدفوع')) then raise exception 'case the sheet stays open after one pay failed'; end if;

  -- after it: a bonus or a deduction on that month is refused by its own reason
  begin insert into public.hr_adjustments (member_id, month, amount, label) values ('00000000-0000-4000-8000-000000110a02', '2026-02-01', 200, 'مكافأة بعد التحويل'); raise exception 'case a bonus after the pay is refused failed';
  exception when invalid_parameter_value then get stacked diagnostics v_msg = message_text; if v_msg <> 'member paid' then raise exception 'case the refusal says member paid failed: %', v_msg; end if; end;
  begin insert into public.hr_adjustments (member_id, month, amount, label) values ('00000000-0000-4000-8000-000000110a02', '2026-02-01', -150, 'خصم بعد التحويل'); raise exception 'case a deduction after the pay is refused failed';
  exception when invalid_parameter_value then get stacked diagnostics v_msg = message_text; if v_msg <> 'member paid' then raise exception 'case the deduction refusal says member paid failed: %', v_msg; end if; end;
  if (select count(*) from public.hr_adjustments where member_id = '00000000-0000-4000-8000-000000110a02' and month = '2026-02-01') <> 1 then raise exception 'case nothing was written after the pay failed'; end if;

  -- the month after is open for him: that is where it goes
  insert into public.hr_adjustments (member_id, month, amount, label) values ('00000000-0000-4000-8000-000000110a02', '2026-03-01', 200, 'مكافأة على الشهر الجاي');
  if (select coalesce(sum(amount), 0) from public.hr_adjustments where member_id = '00000000-0000-4000-8000-000000110a02' and month = '2026-03-01' and voided_at is null) <> 200 then raise exception 'case the next month takes it failed'; end if;

  -- a member who is not paid yet is not touched by the other's pay
  insert into public.hr_adjustments (member_id, month, amount, label) values ('00000000-0000-4000-8000-000000110a03', '2026-02-01', 100, 'مكافأة لسه');

  -- the sheet closed: everything on it is refused as before
  perform public.hr_payroll_transfer('2026-02-01', 'حساب البنك');
  if (select status from public.hr_payroll where month = '2026-02-01') <> 'مدفوع' then raise exception 'case the transfer closes the sheet failed'; end if;
  begin insert into public.hr_adjustments (member_id, month, amount, label) values ('00000000-0000-4000-8000-000000110a03', '2026-02-01', 50, 'بعد القفل'); raise exception 'case a closed sheet refuses failed';
  exception when invalid_parameter_value then get stacked diagnostics v_msg = message_text; if v_msg <> 'sheet locked' then raise exception 'case the closed sheet says sheet locked failed: %', v_msg; end if; end;

  raise notice 'rls_adjust_after_pay: ok';
end $$;

rollback;
