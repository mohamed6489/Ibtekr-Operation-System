-- 0141 — the owner's batch of 19 Nov (plan docs/superpowers/plans/2026-11-19-orders-batch.md decisions 5 and 6).
--
-- 1) «أوبريشن» — a fifth real account (the owner's expenses sheet pays the office and Uber rides from it; «أضيف «أوبريشن» حساب
--    جديد»). Only the account moves ledger takes it; the payroll transfer stays on the four (salaries are not paid from it).
-- 2) The leave already used this year before the system (the owner's sheet «المستخدمة»): hr_members.leave_used_open for the year
--    leave_used_open_year — the balance left = the year's days + carried − used in the system − this opening figure. Written by the
--    owner's data load (service role / SQL) only; members read it next to leave_carry.

alter table public.acc_account_moves drop constraint if exists acc_account_moves_account_check;
alter table public.acc_account_moves add constraint acc_account_moves_account_check
  check (account in ('حساب البنك', 'حساب بوسطة', 'حساب باي موب', 'محفظة إلكترونية', 'أوبريشن'));

alter table public.hr_members add column if not exists leave_used_open numeric(5,1) not null default 0;
alter table public.hr_members add column if not exists leave_used_open_year int;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'hr_members_leave_used_open_check') then
    alter table public.hr_members add constraint hr_members_leave_used_open_check check (leave_used_open >= 0 and leave_used_open <= 365);
  end if;
end $$;

grant select (leave_used_open, leave_used_open_year) on public.hr_members to authenticated;

-- 0083's balance + the opening used of the same year
create or replace function public.hr_leave_left(p_member uuid, p_year int) returns numeric
language sql stable security definer set search_path = public as $$
  select greatest(0, coalesce(m.leave_days, 21)
    + case when m.leave_carry_year = p_year then m.leave_carry else 0 end
    - case when m.leave_used_open_year = p_year then m.leave_used_open else 0 end
    - public.hr_leave_used(p_member, p_year))
  from public.profiles p left join public.hr_members m on m.member_id = p.id where p.id = p_member
$$;
revoke execute on function public.hr_leave_left(uuid, int) from public, anon, authenticated;
grant execute on function public.hr_leave_left(uuid, int) to service_role;
