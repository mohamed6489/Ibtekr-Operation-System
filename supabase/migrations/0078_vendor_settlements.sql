-- 0078_vendor_settlements: the makers' accounts settle with Dokan's withdraw requests (the owner, 11 Nov 2026 — the plan
-- docs/superpowers/plans/2026-11-11-makers-settlement.md). Uses 0019 (acc_vendor_moves, dokan_withdrawals, acc_guard, has_perm).
--
-- Decision 1 («إجراء»): a maker move is «سحب» (direction 'withdraw' — عربون / مواصلات / أخرى, always deducted from the net, the
--   net may go below zero) or «إيداع» (direction 'deposit' — a balance correction only, kind «أخرى» with its title in kind_name,
--   added to the net). A deposit of another kind is refused (the check below; every live row satisfies it).
-- Decision 2 (the settlement): Dokan counts the maker's earnings only, not what we paid him (عربون / مواصلات / أخرى), so a request
--   for his whole Dokan balance is the net plus those moves (the owner: net 20,000 + عربون 4,000 + مواصلات 1,000 → a request of
--   25,000). When such a request is approved — by the system (woo-sync withdraw_approve) or seen approved by the sync — the
--   maker's open moves are settled against it: every move not voided and not settled, dated up to that day (Cairo), gets
--   settled_by = the request; open = their net (deductions − corrections) + the last settlement's carry; consumed = min(request,
--   open) when open > 0, else open (the credits are paid with it); carry_out = open − consumed (a request smaller than the
--   deductions leaves the rest on the maker); cash = request − consumed = what is transferred to the maker. One row per request
--   (acc_vendor_settlements, unique withdraw_id) — written by acc_settle_withdrawal (service_role) only; idempotent.
-- A settled move is final for members — no edit, no void (the settlement counted it); settled_by / settled_at are the server's.
--
-- Re-runnable: if not exists / create or replace / guarded constraint, trigger and policy. No drop / delete / truncate.

-- ---------------------------------------------------------------- the moves: settled_by / settled_at, a deposit is a correction

alter table public.acc_vendor_moves add column if not exists settled_by bigint;
alter table public.acc_vendor_moves add column if not exists settled_at timestamptz;
create index if not exists acc_vendor_moves_settled_by_idx on public.acc_vendor_moves (settled_by);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'acc_vendor_moves_deposit_correction' and conrelid = 'public.acc_vendor_moves'::regclass) then
    alter table public.acc_vendor_moves add constraint acc_vendor_moves_deposit_correction check (direction <> 'deposit' or kind = 'أخرى');
  end if;
end $$;

-- Members (anon / authenticated): a new move is never settled; settled_by / settled_at never change from the page; a settled move
-- is final. postgres / service_role pass (acc_settle_withdrawal runs as the owner).
create or replace function public.acc_vendor_moves_settle_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.settled_by := null; new.settled_at := null;
    return new;
  end if;
  if old.settled_by is not null then
    raise exception 'a settled move is final' using errcode = '42501';
  end if;
  new.settled_by := old.settled_by; new.settled_at := old.settled_at;
  return new;
end $$;
revoke execute on function public.acc_vendor_moves_settle_guard() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'acc_vendor_moves_settle_guard' and tgrelid = 'public.acc_vendor_moves'::regclass) then
    create trigger acc_vendor_moves_settle_guard before insert or update on public.acc_vendor_moves for each row execute function public.acc_vendor_moves_settle_guard();
  end if;
end $$;

-- ---------------------------------------------------------------- the settlements

create table if not exists public.acc_vendor_settlements (
  id bigserial primary key,
  withdraw_id bigint not null unique, -- Dokan's withdraw id (dokan_withdrawals.id; the mirror is upserted, so no foreign key)
  vendor_id uuid not null references public.vendors on delete restrict,
  amount numeric(12,2) not null,           -- the request Dokan approved
  moves_net numeric(14,2) not null default 0, -- the moves it settled: deductions − corrections
  carry_in numeric(14,2) not null default 0,  -- the previous settlement's carry_out
  consumed numeric(14,2) not null,         -- what the request covered of them
  carry_out numeric(14,2) not null default 0, -- left on the maker: the request was smaller than the deductions
  cash numeric(14,2) not null,             -- transferred to the maker = amount − consumed
  moves integer not null default 0,
  source text not null check (source in ('system', 'dokan')), -- approved through the system, or seen approved on Dokan
  approved_by uuid references public.profiles,
  settled_on date not null,                -- the Cairo day the moves were counted up to
  created_at timestamptz not null default now()
);
create index if not exists acc_vendor_settlements_vendor_idx on public.acc_vendor_settlements (vendor_id);
create index if not exists acc_vendor_settlements_approved_by_idx on public.acc_vendor_settlements (approved_by);

alter table public.acc_vendor_settlements enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'acc_vendor_settlements' and policyname = 'acc_vendor_settlements_select') then
    create policy acc_vendor_settlements_select on public.acc_vendor_settlements for select to authenticated using ((select public.has_perm('accounts.view')) <> 'N');
  end if;
end $$;

-- rule 4: members read; the server writes (through the function below)
grant select on public.acc_vendor_settlements to authenticated;
grant select, insert, update, delete on public.acc_vendor_settlements to service_role;
revoke truncate, references, trigger on public.acc_vendor_settlements from anon, authenticated, service_role;
revoke all on public.acc_vendor_settlements from anon;
grant usage, select on sequence public.acc_vendor_settlements_id_seq to service_role;

-- ---------------------------------------------------------------- acc_settle_withdrawal (decision 2)

-- The request must be approved in the mirror and belong to a maker; one settlement per request (a second call returns the first);
-- one at a time per maker (an advisory lock). 22023 invalid: source / not approved; P0002 withdraw not found.
create or replace function public.acc_settle_withdrawal(p_withdraw bigint, p_source text, p_by uuid default null)
returns public.acc_vendor_settlements
language plpgsql security definer set search_path = public as $$
declare
  w record; s public.acc_vendor_settlements;
  d date := (now() at time zone 'Africa/Cairo')::date;
  net numeric(14,2) := 0; n integer := 0; cin numeric(14,2); open_amt numeric(14,2); cons numeric(14,2);
begin
  if p_source is null or p_source not in ('system', 'dokan') then
    raise exception 'invalid: source' using errcode = '22023';
  end if;
  select id, vendor_id, amount, status into w from public.dokan_withdrawals where id = p_withdraw;
  if not found then
    raise exception 'withdraw not found' using errcode = 'P0002';
  end if;
  if w.status is distinct from 'approved' or w.vendor_id is null or w.amount is null then
    raise exception 'invalid: not approved' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('acc_settle:' || w.vendor_id::text, 0));
  select * into s from public.acc_vendor_settlements where withdraw_id = p_withdraw;
  if found then
    return s;
  end if;
  select x.carry_out into cin from public.acc_vendor_settlements x where x.vendor_id = w.vendor_id order by x.created_at desc, x.id desc limit 1;
  cin := coalesce(cin, 0);
  with m as (
    update public.acc_vendor_moves set settled_by = p_withdraw, settled_at = now()
    where vendor_id = w.vendor_id and voided_at is null and settled_by is null and on_date <= d
    returning direction, amount
  )
  select coalesce(sum(case when m.direction = 'withdraw' then m.amount else -m.amount end), 0), count(*) into net, n from m;
  open_amt := net + cin;
  cons := case when open_amt > 0 then least(w.amount, open_amt) else open_amt end;
  insert into public.acc_vendor_settlements (withdraw_id, vendor_id, amount, moves_net, carry_in, consumed, carry_out, cash, moves, source, approved_by, settled_on)
  values (p_withdraw, w.vendor_id, w.amount, net, cin, cons, open_amt - cons, w.amount - cons, n, p_source, p_by, d)
  returning * into s;
  return s;
end $$;
revoke execute on function public.acc_settle_withdrawal(bigint, text, uuid) from public, anon, authenticated;
grant execute on function public.acc_settle_withdrawal(bigint, text, uuid) to service_role;
