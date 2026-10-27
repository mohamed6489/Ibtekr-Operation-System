-- 0019_accounts: the accounts page on real data (phase 4). Uses has_perm / is_admin (0001), the role matrix (0003:
-- accounts.view / accounts.add / accounts.approve — no new key), profiles, vendors / vendor_rates (0011), orders /
-- order_items (0007), sync_state and the Vault sync_secret + pg_cron / pg_net (0008). The plan:
-- docs/superpowers/plans/2026-10-27-phase-4-accounts.md.
--
-- Decision 2: three ledgers of the team — acc_expenses (with the subscription fields of the prototype), acc_vendor_moves
--   (عربون / مواصلات / أخرى per maker), acc_account_moves (the four accounts). «حذف» on the screen is a void (voided_at /
--   voided_by): no delete for members, and none in this file.
-- Decision 3: read with accounts.view <> N; accounts.view = P never sees the «المرتبات» rows of acc_expenses (nor adds
--   them); add with accounts.add = F as oneself; edit / void one's own row with accounts.add = F, any row with
--   accounts.approve = F. A guard keeps created_by / created_at, refuses an edit of a voided row and un-voiding, and stamps
--   updated_* / voided_by from the server.
-- Decision 4: accounts_sales(p_from, p_to) — our own orders (placed_at as a Cairo date), grouped completed / in_progress /
--   cancelled per maker: distinct parent orders, the lines' sum, Ibtekr's share = line × the line's site commission rate
--   (else the maker's vendor_rates row of that day) / 100 + the line's fee. Security definer behind accounts.view <> N.
-- Decision 5: dokan_withdrawals / dokan_balances — read-only mirrors of Dokan written by woo-sync (part `accounts`, as
--   service_role) — never the bank details, the IP or the note of a request. Read with accounts.view <> N. pg_cron
--   'woo-sync-accounts' runs the part hourly (guarded like 0008).
--
-- Notes for readers:
-- * Re-runnable: create table / index if not exists, create or replace, policies created only when missing, the cron job
--   unscheduled before it is scheduled again. No drop / delete / truncate.
-- * rule 4: explicit grants; members get select / insert / update on the ledgers (no delete) and select on the mirrors;
--   no truncate / references / trigger for any API role; nothing for anon.
-- * Amounts are numeric(12,2) > 0 (the domain's MAX_AMOUNT is 1e9); the direction is the prototype's: for a maker move,
--   'deposit' = money paid to the maker in advance (it lowers what we owe him), 'withdraw' = the reverse; a transport
--   move ('مواصلات', 'withdraw') is deducted from his balance (block 02: deriveVendors / deductTransport).

-- ---------------------------------------------------------------- the ledgers

create table if not exists public.acc_expenses (
  id bigserial primary key,
  on_date date not null,
  direction text not null default 'withdraw' check (direction in ('withdraw', 'deposit')),
  category text not null check (category in ('المرتبات', 'المصروفات', 'الاشتراكات', 'الإعلانات')),
  beneficiary text check (beneficiary is null or char_length(beneficiary) <= 80),
  beneficiary_other boolean not null default false,
  amount numeric(12,2) not null check (amount > 0 and amount <= 1000000000),
  note text check (note is null or char_length(note) <= 500),
  sub_name text check (sub_name is null or char_length(sub_name) <= 80),
  sub_is_other boolean not null default false,
  sub_ends date,
  sub_alerts text[] not null default '{}' check (sub_alerts <@ array['month', 'week', 'day']::text[]),
  sub_note text check (sub_note is null or char_length(sub_note) <= 500),
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles,
  updated_at timestamptz,
  voided_by uuid references public.profiles,
  voided_at timestamptz,
  -- a subscription (decision 10) carries its name, its end date and at least one alert
  constraint acc_expenses_subscription check (category <> 'الاشتراكات' or (sub_name is not null and sub_ends is not null and cardinality(sub_alerts) > 0))
);
create index if not exists acc_expenses_on_date_idx on public.acc_expenses (on_date);

create table if not exists public.acc_vendor_moves (
  id bigserial primary key,
  vendor_id uuid not null references public.vendors on delete restrict,
  on_date date not null,
  direction text not null check (direction in ('withdraw', 'deposit')),
  kind text not null check (kind in ('مواصلات', 'عربون', 'أخرى')),
  kind_name text check (kind_name is null or char_length(kind_name) <= 80),
  amount numeric(12,2) not null check (amount > 0 and amount <= 1000000000),
  note text check (note is null or char_length(note) <= 500),
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles,
  updated_at timestamptz,
  voided_by uuid references public.profiles,
  voided_at timestamptz,
  constraint acc_vendor_moves_other_named check (kind <> 'أخرى' or coalesce(btrim(kind_name), '') <> '')
);
create index if not exists acc_vendor_moves_vendor_idx on public.acc_vendor_moves (vendor_id);
create index if not exists acc_vendor_moves_on_date_idx on public.acc_vendor_moves (on_date);

create table if not exists public.acc_account_moves (
  id bigserial primary key,
  account text not null check (account in ('حساب البنك', 'حساب بوسطة', 'حساب باي موب', 'محفظة إلكترونية')),
  on_date date not null,
  direction text not null check (direction in ('withdraw', 'deposit')),
  amount numeric(12,2) not null check (amount > 0 and amount <= 1000000000),
  note text check (note is null or char_length(note) <= 500),
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles,
  updated_at timestamptz,
  voided_by uuid references public.profiles,
  voided_at timestamptz
);
create index if not exists acc_account_moves_on_date_idx on public.acc_account_moves (on_date);

-- the profiles foreign keys (advisor 0001_unindexed_foreign_keys)
create index if not exists acc_expenses_created_by_idx on public.acc_expenses (created_by);
create index if not exists acc_expenses_updated_by_idx on public.acc_expenses (updated_by);
create index if not exists acc_expenses_voided_by_idx on public.acc_expenses (voided_by);
create index if not exists acc_vendor_moves_created_by_idx on public.acc_vendor_moves (created_by);
create index if not exists acc_vendor_moves_updated_by_idx on public.acc_vendor_moves (updated_by);
create index if not exists acc_vendor_moves_voided_by_idx on public.acc_vendor_moves (voided_by);
create index if not exists acc_account_moves_created_by_idx on public.acc_account_moves (created_by);
create index if not exists acc_account_moves_updated_by_idx on public.acc_account_moves (updated_by);
create index if not exists acc_account_moves_voided_by_idx on public.acc_account_moves (voided_by);

alter table public.acc_expenses enable row level security;
alter table public.acc_vendor_moves enable row level security;
alter table public.acc_account_moves enable row level security;

-- ---------------------------------------------------------------- the guard (decision 3)

-- Members (anon / authenticated): created_by / created_at never change; a voided row is final (no edit, no un-void);
-- updated_* and voided_by come from the server. postgres / service_role pass (the phase-0 pattern).
create or replace function public.acc_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.updated_by := null; new.updated_at := null; new.voided_by := null; new.voided_at := null;
    return new;
  end if;
  if new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'created_by / created_at are fixed' using errcode = '42501';
  end if;
  if old.voided_at is not null then
    raise exception 'a voided row is final' using errcode = '42501';
  end if;
  if new.voided_at is not null then
    new.voided_at := now();
    new.voided_by := auth.uid();
  else
    new.voided_by := null;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
revoke execute on function public.acc_guard() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['acc_expenses', 'acc_vendor_moves', 'acc_account_moves'] loop
    if not exists (select 1 from pg_trigger where tgname = t || '_guard' and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger %I before insert or update on public.%I for each row execute function public.acc_guard()', t || '_guard', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- policies (decision 3)

do $$
declare t text;
begin
  foreach t in array array['acc_expenses', 'acc_vendor_moves', 'acc_account_moves'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_select') then
      execute format($p$create policy %I on public.%I for select to authenticated using (
        (select public.has_perm('accounts.view')) <> 'N'
        %s)$p$, t || '_select', t,
        case when t = 'acc_expenses' then $c$and (category <> 'المرتبات' or (select public.has_perm('accounts.view')) = 'F')$c$ else '' end);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_insert') then
      execute format($p$create policy %I on public.%I for insert to authenticated with check (
        (select public.has_perm('accounts.add')) = 'F' and created_by = (select auth.uid())
        %s)$p$, t || '_insert', t,
        case when t = 'acc_expenses' then $c$and (category <> 'المرتبات' or (select public.has_perm('accounts.view')) = 'F')$c$ else '' end);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_update') then
      execute format($p$create policy %I on public.%I for update to authenticated
        using ((select public.has_perm('accounts.view')) <> 'N'
               and ((created_by = (select auth.uid()) and (select public.has_perm('accounts.add')) = 'F')
                    or (select public.has_perm('accounts.approve')) = 'F')
               %s)
        with check ((select public.has_perm('accounts.view')) <> 'N'
               and ((created_by = (select auth.uid()) and (select public.has_perm('accounts.add')) = 'F')
                    or (select public.has_perm('accounts.approve')) = 'F')
               %s)$p$, t || '_update', t,
        case when t = 'acc_expenses' then $c$and (category <> 'المرتبات' or (select public.has_perm('accounts.view')) = 'F')$c$ else '' end,
        case when t = 'acc_expenses' then $c$and (category <> 'المرتبات' or (select public.has_perm('accounts.view')) = 'F')$c$ else '' end);
    end if;
  end loop;
end $$;

-- rule 4: members select / insert / update (no delete); the server everything
grant select, insert, update on public.acc_expenses, public.acc_vendor_moves, public.acc_account_moves to authenticated;
grant select, insert, update, delete on public.acc_expenses, public.acc_vendor_moves, public.acc_account_moves to service_role;
revoke truncate, references, trigger on public.acc_expenses, public.acc_vendor_moves, public.acc_account_moves from anon, authenticated, service_role;
revoke all on public.acc_expenses, public.acc_vendor_moves, public.acc_account_moves from anon;
grant usage, select on sequence public.acc_expenses_id_seq, public.acc_vendor_moves_id_seq, public.acc_account_moves_id_seq to authenticated, service_role;

-- ---------------------------------------------------------------- the Dokan mirrors (decision 5)

create table if not exists public.dokan_withdrawals (
  id bigint primary key, -- Dokan's withdraw id
  woo_vendor_id bigint not null,
  vendor_id uuid references public.vendors on delete set null,
  amount numeric(12,2),
  charge numeric(12,2),
  receivable numeric(12,2),
  status text not null,
  method text,
  requested_at timestamp, -- Dokan's `created`: the site's local time, as Dokan shows it
  synced_at timestamptz not null default now()
);
create index if not exists dokan_withdrawals_vendor_idx on public.dokan_withdrawals (vendor_id);
create index if not exists dokan_withdrawals_woo_vendor_idx on public.dokan_withdrawals (woo_vendor_id);

create table if not exists public.dokan_balances (
  vendor_id uuid primary key references public.vendors on delete cascade,
  woo_vendor_id bigint not null,
  balance numeric(14,2),
  earning numeric(14,2),
  sales numeric(14,2),
  orders integer,
  synced_at timestamptz not null default now()
);

alter table public.dokan_withdrawals enable row level security;
alter table public.dokan_balances enable row level security;
do $$
declare t text;
begin
  foreach t in array array['dokan_withdrawals', 'dokan_balances'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_select') then
      execute format($p$create policy %I on public.%I for select to authenticated using ((select public.has_perm('accounts.view')) <> 'N')$p$, t || '_select', t);
    end if;
  end loop;
end $$;
grant select on public.dokan_withdrawals, public.dokan_balances to authenticated;
grant select, insert, update, delete on public.dokan_withdrawals, public.dokan_balances to service_role;
revoke truncate, references, trigger on public.dokan_withdrawals, public.dokan_balances from anon, authenticated, service_role;
revoke all on public.dokan_withdrawals, public.dokan_balances from anon;

-- ---------------------------------------------------------------- accounts_sales (decision 4)

create or replace function public.accounts_sales(p_from date, p_to date)
returns table (vendor_id uuid, grp text, orders bigint, sales numeric, share numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(public.has_perm('accounts.view'), 'N') = 'N' then
    raise exception 'accounts.view is needed' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 3700 then
    raise exception 'the range is from <= to, at most ten years' using errcode = '22023';
  end if;
  return query
  with o as (
    select x.id,
           case when x.status = 'مكتمل' then 'completed'
                when x.status in ('جاري التنفيذ', 'جاهز للشحن', 'قيد الشحن') then 'in_progress'
                when x.status in ('ملغي', 'استرجاع', 'فشل') then 'cancelled' end as g,
           (x.placed_at at time zone 'Africa/Cairo')::date as d
    from public.orders x
    where (x.placed_at at time zone 'Africa/Cairo')::date between p_from and p_to
  ), l as (
    select i.vendor_id as v, o.g, o.id as order_id, i.total,
           coalesce(i.commission_rate,
                    (select r.rate from public.vendor_rates r where r.vendor_id = i.vendor_id and r.since <= o.d order by r.since desc, r.id desc limit 1),
                    0) as rate,
           coalesce(i.commission_fee, 0) as fee
    from o join public.order_items i on i.order_id = o.id and not i.removed
    where o.g is not null
  )
  select l.v, l.g, count(distinct l.order_id), round(sum(l.total), 2), round(sum(l.total * l.rate / 100 + l.fee), 2)
  from l group by l.v, l.g;
end $$;
revoke execute on function public.accounts_sales(date, date) from public, anon;
grant execute on function public.accounts_sales(date, date) to authenticated, service_role;

-- ---------------------------------------------------------------- pg_cron: woo-sync part `accounts` hourly (guarded)

do $$
begin
  if not (exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net')
          and exists (select 1 from pg_extension where extname = 'supabase_vault')) then
    raise notice '0019_accounts: pg_cron / pg_net / supabase_vault not installed — the accounts sync job skipped';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'woo-sync-accounts') then
    perform cron.unschedule('woo-sync-accounts');
  end if;
  perform cron.schedule('woo-sync-accounts', '7 * * * *', $cron$
    select net.http_post(
      url := 'https://fsynculhaupcktzkfkdd.supabase.co/functions/v1/woo-sync',
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'X-Sync-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_secret')),
      body := '{"action":"accounts"}'::jsonb,
      timeout_milliseconds := 150000
    )
  $cron$);
end $$;
