-- 0154 — the meeting of 23 Nov #39 (docs/superpowers/plans/2026-11-23-meeting.md, phase 6), as Safwat described it on 24 Nov:
-- «فقد». A returned product that is lost is still a return: its stock lot is «مرتجع» with the new status «مفقود» and the value the
-- member wrote (the maker's price by default) in `cost` — from the orders page (a product set «مرتجع للمخزن / للمبتكر» and «فقد»: a lot
-- with no move, nothing in the hub) or from the inspection of a return in the hub (an «out» move takes it out). The maker's «مفقودات» tab
-- and its column in the makers' accounts read these lots — shown only: they change neither the maker's balance nor ours.
-- «فقد» opens the decision: «حوّلها لحساب المبتكر» (a deposit — an «إيداع خارجي» on his account; the piece is «مفقود محسوب») or
-- «حوّلها مفقودات» (recorded only, no account moves — «مفقود غير محسوب»), with the amount and the reason (فقد المنتج · تلف المنتج في
-- المخزن · أخرى + text). Both go in the accounts' «مفقودات» tab (acc_bad_debts — Safwat first called it «ديون معدومة»; the screens'
-- names changed, the table's did not), not an expense.
alter table public.inv_lots drop constraint if exists inv_lots_status_check;
alter table public.inv_lots add constraint inv_lots_status_check
  check (status in ('وصل المخزن', 'جاهز يطلع كامل', 'بانتظار الفحص', 'مستني تصوير', 'اتصور', 'متاح', 'محجوز لأوردر', 'راجع للمبتكر', 'تالف', 'مفقود'));

create table if not exists public.acc_bad_debts (
  id bigserial primary key,
  lot_id uuid references public.inv_lots on delete set null,
  vendor_id uuid references public.vendors on delete restrict,
  kind text not null check (kind in ('deposit', 'writeoff')),
  amount numeric(12, 2) not null check (amount > 0 and amount <= 1000000000),
  reason text not null check (reason in ('فقد المنتج', 'تلف المنتج في المخزن', 'أخرى')),
  note text check (note is null or char_length(note) <= 300),
  on_date date not null default (now() at time zone 'Africa/Cairo')::date,
  vendor_move_id bigint references public.acc_vendor_moves on delete set null,
  created_by uuid references public.profiles on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint acc_bad_debts_other check (reason <> 'أخرى' or coalesce(btrim(note), '') <> ''),
  constraint acc_bad_debts_deposit check (kind <> 'deposit' or vendor_id is not null)
);
create unique index if not exists acc_bad_debts_lot on public.acc_bad_debts (lot_id) where lot_id is not null;
create index if not exists acc_bad_debts_vendor on public.acc_bad_debts (vendor_id);

alter table public.acc_bad_debts enable row level security;
create policy acc_bad_debts_select on public.acc_bad_debts for select to authenticated
  using ((select public.has_perm('accounts.view')) <> 'N');
-- no direct writes for members: acc_bad_debt_add below
grant select on public.acc_bad_debts to authenticated;
grant all on public.acc_bad_debts to service_role;
grant usage, select on sequence public.acc_bad_debts_id_seq to service_role;

-- the decision on a lost piece: a member who adds to the accounts (accounts.add F); once per lot
create or replace function public.acc_bad_debt_add(p_lot uuid, p_kind text, p_amount numeric, p_reason text, p_note text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_lot record; v_id bigint; v_move bigint; v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_day date := (now() at time zone 'Africa/Cairo')::date; v_ref text;
begin
  if (select public.has_perm('accounts.add')) <> 'F' then raise exception 'forbidden' using errcode = '42501'; end if;
  select id, vendor_id, status, order_id, name into v_lot from public.inv_lots where id = p_lot for update;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  if v_lot.status <> 'مفقود' then raise exception 'invalid: lot' using errcode = '22023'; end if;
  if exists (select 1 from public.acc_bad_debts where lot_id = p_lot) then raise exception 'invalid: decided' using errcode = '22023'; end if;
  if p_kind not in ('deposit', 'writeoff') then raise exception 'invalid: kind' using errcode = '22023'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000000000 then raise exception 'invalid: amount' using errcode = '22023'; end if;
  if p_reason not in ('فقد المنتج', 'تلف المنتج في المخزن', 'أخرى') then raise exception 'invalid: reason' using errcode = '22023'; end if;
  if v_note is not null and (char_length(v_note) > 300 or v_note ~ '[<>]') then raise exception 'invalid: note' using errcode = '22023'; end if;
  if p_reason = 'أخرى' and v_note is null then raise exception 'invalid: note' using errcode = '22023'; end if;
  if p_kind = 'deposit' and v_lot.vendor_id is null then raise exception 'invalid: vendor' using errcode = '22023'; end if;
  v_ref := 'فقد' || coalesce(' — IB-' || v_lot.order_id, '');
  if p_kind = 'deposit' then
    insert into public.acc_vendor_moves (vendor_id, on_date, direction, kind, kind_name, amount, note, created_by)
    values (v_lot.vendor_id, v_day, 'deposit', 'أخرى', left('تعويض ' || v_ref, 80), p_amount,
      left(p_reason || coalesce(': ' || v_note, '') || ' · ' || v_lot.name, 500), auth.uid())
    returning id into v_move;
  end if;
  insert into public.acc_bad_debts (lot_id, vendor_id, kind, amount, reason, note, on_date, vendor_move_id)
  values (p_lot, v_lot.vendor_id, p_kind, p_amount, p_reason, v_note, v_day, v_move)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.acc_bad_debt_add(uuid, text, numeric, text, text) from public, anon;
grant execute on function public.acc_bad_debt_add(uuid, text, numeric, text, text) to authenticated, service_role;

-- the accounts' data section takes it
create or replace function public.data_wipe_map() returns table (section text, tbl text)
language sql immutable set search_path = public as $$
  select * from (values
    ('orders', 'orders'), ('orders', 'sub_orders'), ('orders', 'order_items'), ('orders', 'order_events'), ('orders', 'customer_ratings'), ('orders', 'returns'), ('orders', 'woo_webhook_events'), ('orders', 'sync_state'), ('orders', 'bosta_pickups'), ('orders', 'order_shipments'),
    ('vendors', 'vendors'), ('vendors', 'vendor_rates'), ('vendors', 'vendor_category_rates'), ('vendors', 'vendor_bank'), ('vendors', 'vendor_logins'), ('vendors', 'vendor_login_resets'), ('vendors', 'brands'), ('vendors', 'brand_owners'), ('vendors', 'brand_rates'),
    ('products', 'products'), ('products', 'woo_categories'), ('products', 'woo_brands'), ('products', 'product_commissions'), ('products', 'product_lead_days'), ('products', 'studio_batches'), ('products', 'image_imports'), ('products', 'image_shares'),
    ('accounts', 'acc_expenses'), ('accounts', 'acc_vendor_moves'), ('accounts', 'acc_account_moves'), ('accounts', 'acc_vendor_settlements'), ('accounts', 'dokan_withdrawals'), ('accounts', 'dokan_balances'), ('accounts', 'acc_bad_debts'),
    ('inventory', 'inv_lots'), ('inventory', 'inv_moves'), ('inventory', 'inv_consolidations'), ('inventory', 'inv_consolidation_items'), ('inventory', 'inv_counts'), ('inventory', 'inv_count_lines'),
    ('cs', 'cs_customers'), ('cs', 'cs_contacts'), ('cs', 'cs_customer_notes'), ('cs', 'cs_rating_overrides'), ('cs', 'cs_team_ratings'), ('cs', 'cs_conversations'), ('cs', 'cs_messages'), ('cs', 'cs_segments'), ('cs', 'cs_campaigns'), ('cs', 'cs_campaign_recipients'), ('cs', 'cs_posts'), ('cs', 'cs_carts'), ('cs', 'cs_auto_runs'),
    ('tickets', 'tickets'), ('tickets', 'ticket_events'),
    ('marketing', 'mkt_campaigns'), ('marketing', 'mkt_posts'), ('marketing', 'mkt_ad_objects'), ('marketing', 'mkt_ad_stats'), ('marketing', 'mkt_suggestions'), ('marketing', 'mkt_requests'), ('marketing', 'mkt_video_jobs'), ('marketing', 'mkt_agent_chats'), ('marketing', 'mkt_agent_messages'), ('marketing', 'mkt_trends'), ('marketing', 'mkt_competitors'), ('marketing', 'site_checks'),
    ('hr', 'hr_attendance'), ('hr', 'hr_overtime'), ('hr', 'hr_requests'), ('hr', 'hr_payroll'), ('hr', 'hr_payroll_lines'), ('hr', 'hr_payroll_paid'), ('hr', 'hr_adjustments'), ('hr', 'hr_evaluations'), ('hr', 'hr_scores'), ('hr', 'hr_extras'), ('hr', 'hr_meetings'), ('hr', 'hr_notes_log'), ('hr', 'hr_ot_adjust'), ('hr', 'hr_tasks'),
    ('logs', 'activity_log'), ('logs', 'alerts'), ('logs', 'alert_reads'), ('logs', 'alert_state'), ('logs', 'ai_runs'), ('logs', 'woo_sync_log'), ('logs', 'cs_channel_events'), ('logs', 'login_failures'),
    ('logs', 'ai_agent_notes'), ('logs', 'ai_agent_note_reads'), ('logs', 'ai_agent_state')
  ) v(section, tbl)
$$;

-- the live signal (0104): «ديون معدومة» is the accounts'
do $$
begin
  if to_regprocedure('public.live_changed()') is null then return; end if;
  drop trigger if exists acc_bad_debts_live on public.acc_bad_debts;
  create trigger acc_bad_debts_live after insert or update or delete on public.acc_bad_debts for each statement execute function public.live_changed('accounts');
end $$;
