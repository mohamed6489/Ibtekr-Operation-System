-- 0110 — a bonus / deduction on a member already paid for the month is refused
-- (docs/superpowers/plans/2026-11-15-comments.md decision 78 — the owner 15 Nov: «المرتبات لما اعمل مكافأة لعضو اتحوله المرتب يطلعلي
-- ايرور و يقولي انه اتحوله مرتبه بالفعل ف مفيش خصم و يقولي نضيفه للشهر اللي جاى»).
-- Since 0083 a member can be paid alone before the month's sheet is closed (hr_payroll_paid); his line then stays on what he
-- was paid, so an adjustment written on that month afterwards changed nothing and was lost without a word. The guard now
-- refuses it ('member paid', 22023) — the page offers the next month that is still open for him instead (the insert on that
-- month passes: no row in hr_payroll_paid, no closed sheet). A closed sheet still refuses everything ('sheet locked').
-- Same function, same owner and grants (0046: execute revoked from public / anon / authenticated — it only runs as the trigger).
-- Re-runnable.

create or replace function public.hr_adjustments_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.hr_payroll p where p.month = new.month and p.status in ('معتمد', 'مدفوع')) then
    raise exception 'sheet locked' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' then
    if (new.member_id, new.month, new.amount, new.label, new.note, new.kind, new.created_by, new.created_at)
       is distinct from (old.member_id, old.month, old.amount, old.label, old.note, old.kind, old.created_by, old.created_at)
       or old.voided_at is not null or new.voided_at is null then
      raise exception 'only a void' using errcode = '22023';
    end if;
    new.voided_by := auth.uid(); new.voided_at := now();
  else
    -- 0110: the member's pay of that month already went out — nothing more goes on it
    if exists (select 1 from public.hr_payroll_paid x where x.month = new.month and x.member_id = new.member_id) then
      raise exception 'member paid' using errcode = '22023';
    end if;
    new.created_by := auth.uid(); new.created_at := now(); new.voided_by := null; new.voided_at := null;
  end if;
  return new;
end $$;
revoke execute on function public.hr_adjustments_guard() from public, anon, authenticated;
