-- 0020_accounts_fields: the accounts changes of prototype 1793131460 (phase 4.1). Uses 0019_accounts (acc_expenses, its
-- guard and policies) and has_perm (0001). The plan: docs/superpowers/plans/2026-10-28-phase-4-1-accounts-prototype.md.
--
-- Decision 2: the fields of an expense follow its type — details (the general expenses, the ads), staff_kind (a payroll
--   paid to someone outside the team: staff | freelance) and reason (a deposit: money coming back, one of REFUND_REASONS
--   of block 02). The subscription's own fields are for a withdraw only: a deposit in «الاشتراكات» is money coming back.
-- Decision 3: acc_list_items — the names added from the popup to the subscriptions list (subs) and the ad platforms list
--   (ads). Read with accounts.view <> N, added with accounts.add = F as oneself; no update / delete for members.
--
-- Notes for readers:
-- * Re-runnable: add column if not exists, the subscription check dropped and added again (same name, relaxed for a deposit),
--   table / index if not exists, policies created only when missing. No delete / truncate.
-- * rule 4: explicit grants on acc_list_items (members select / insert; service_role everything; nothing for anon).

alter table public.acc_expenses add column if not exists details text check (details is null or char_length(details) <= 500);
alter table public.acc_expenses add column if not exists staff_kind text check (staff_kind is null or staff_kind in ('staff', 'freelance'));
alter table public.acc_expenses add column if not exists reason text
  check (reason is null or reason in ('استرجاع مبلغ مدفوع', 'إلغاء اشتراك', 'خصم من مورد', 'تصحيح تسجيل غلط', 'أخرى'));

-- a subscription (withdraw) still carries its name, its end date and at least one alert; a deposit there does not
alter table public.acc_expenses drop constraint if exists acc_expenses_subscription;
alter table public.acc_expenses add constraint acc_expenses_subscription
  check (category <> 'الاشتراكات' or direction = 'deposit' or (sub_name is not null and sub_ends is not null and cardinality(sub_alerts) > 0));

-- ---------------------------------------------------------------- the lists (decision 3)

create table if not exists public.acc_list_items (
  id bigserial primary key,
  list text not null check (list in ('subs', 'ads')),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now()
);
create unique index if not exists acc_list_items_name_key on public.acc_list_items (list, lower(btrim(name)));
create index if not exists acc_list_items_created_by_idx on public.acc_list_items (created_by);
alter table public.acc_list_items enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'acc_list_items' and policyname = 'acc_list_items_select') then
    create policy acc_list_items_select on public.acc_list_items for select to authenticated
      using ((select public.has_perm('accounts.view')) <> 'N');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'acc_list_items' and policyname = 'acc_list_items_insert') then
    create policy acc_list_items_insert on public.acc_list_items for insert to authenticated
      with check ((select public.has_perm('accounts.add')) = 'F' and created_by = (select auth.uid()));
  end if;
end $$;

grant select, insert on public.acc_list_items to authenticated;
grant select, insert, update, delete on public.acc_list_items to service_role;
revoke update, delete, truncate, references, trigger on public.acc_list_items from authenticated;
revoke truncate, references, trigger on public.acc_list_items from anon, service_role;
revoke all on public.acc_list_items from anon;
grant usage, select on sequence public.acc_list_items_id_seq to authenticated, service_role;
