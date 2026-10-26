-- 0010_state_names: phase 2.2 (the owner's requests after 2.1): orders.customer_state (the site's governorate code:
-- column, backfill from raw, column grants, orders_v) and woo_states (the site's governorate names, read by members,
-- written by the sync).
-- Uses orders / orders_v and the column-list grants of 0007, the raw allow-list of woo-core (billing / shipping keep
-- city / state / postcode / country), the grant rules (0004).
--
-- Decision (plan, phase 2.2 item 3): the governorate is stored as the site's code (orders.customer_state, e.g.
--   'EG-01') and shown by name from woo_states, which the sync fills from the site itself (woo-sync part `states`:
--   GET wc/v3/data/countries/EG → states[] { code, name }). Why: the codes are the site's own list (EG-01 … EG-25,
--   14 in use on 26 Oct), not WooCommerce's standard EGALX …, so a fixed list in the code would drift from the site;
--   a change there reaches us on the next sync, without a deploy. Cost if wrong: while the site returns no names, the
--   screen shows the code as it is.
-- Decision: customer_state is display only. Members get SELECT on it (the column list of 0007 grows by one), never
--   UPDATE: the code comes from the site's list, there is nothing to correct by hand. The sync writes it on a new
--   order only (woo-write TEAM_EDITED, with customer_city / customer_address / note), so the address snapshot the
--   team works from stays one piece. Cost if wrong: a customer who changes the governorate on the site after the
--   order was created keeps the old one here.
--
-- Notes for readers:
-- * Idempotent: every statement is guarded (if not exists / where … is null / a pg_policies check) or re-runnable
--   (create or replace view, enable row level security, grant, revoke); a second run changes nothing. No drop /
--   delete / truncate statements in this file.
-- * orders_v keeps its 25 columns in the same order and gets customer_state as the 26th: `create or replace view` may
--   only append columns (anything else would need a drop). security_invoker stays on, the masked phone accessor is
--   untouched, and the view still references only columns authenticated may select, so `select *` keeps working.
--   create or replace keeps the view's grants; they are restated (rule 4).
-- * orders: authenticated gets `select (customer_state)` only; it has no table-wide UPDATE (0007 grants a column list),
--   so the new column is not writable by members (42501) whatever the policies say. The guard trigger
--   (orders_guard_update) needs no change: a column outside its status / edit lists is sync-only for anon /
--   authenticated already. service_role holds the table-wide grants of 0007, which cover the new column; the
--   column-level grant below only states it. Realtime checks column privileges: members receive customer_state.
-- * The backfill reads raw->shipping->state, else raw->billing->state (woo-core kept both in raw since 0007), trimmed,
--   blank = missing — the same rule as mapOrder (orNull(s.state) ?? orNull(b.state)). Only rows whose customer_state is
--   still null are filled, so a value the new sync wrote is never overwritten. orders_log_events does not track the
--   column: the backfill writes no order_events rows. The guard trigger applies to anon / authenticated only; the
--   migration runs as postgres.
-- * woo_states: RLS on; one select policy for authenticated (using true: the names are the site's public checkout
--   list, any signed-in member may read them); no insert / update / delete policy, so members write nothing even
--   with a grant; the sync writes as service_role (bypasses RLS on Supabase). Rows are never deleted: a state the
--   site drops keeps its row (an old order may still carry the code).

-- ---------------------------------------------------------------- orders.customer_state

alter table public.orders add column if not exists customer_state text;

update public.orders
set customer_state = coalesce(nullif(btrim(raw -> 'shipping' ->> 'state'), ''), nullif(btrim(raw -> 'billing' ->> 'state'), ''))
where customer_state is null and raw is not null;

-- rule 4: explicit grants. Members read it (select only); the sync owns it.
grant select (customer_state) on public.orders to authenticated;
grant select (customer_state), insert (customer_state), update (customer_state) on public.orders to service_role;

-- ---------------------------------------------------------------- orders_v + customer_state

-- The 0007 view, column for column, with customer_state appended.
create or replace view public.orders_v with (security_invoker = true) as
select o.id, o.number, o.customer_name,
       public.order_customer_phone(o.id) as customer_phone,
       o.customer_city, o.customer_address, o.payment_method, o.payment_title, o.status, o.woo_status,
       o.confirm, o.confirm_at, o.confirm_note, o.deposit, o.total, o.currency, o.note, o.customer_note,
       o.placed_at, o.woo_updated_at, o.cancel, o.ret, o.synced_at, o.created_at, o.updated_at,
       o.customer_state
from public.orders o;

grant select on public.orders_v to authenticated, service_role;

-- ---------------------------------------------------------------- woo_states

create table if not exists public.woo_states (
  code text primary key,
  name text not null,
  updated_at timestamptz not null default now()
);

alter table public.woo_states enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'woo_states' and policyname = 'woo_states_select') then
    create policy woo_states_select on public.woo_states for select to authenticated using (true);
  end if;
end $$;

-- rule 4: members read, service_role writes; nothing for anon (and no truncate / references / trigger for anyone,
-- like 0004 / 0007: the live project's defaults hand those out on a new table).
grant select on public.woo_states to authenticated;
grant select, insert, update, delete on public.woo_states to service_role;
revoke truncate, references, trigger on public.woo_states from anon, authenticated, service_role;
