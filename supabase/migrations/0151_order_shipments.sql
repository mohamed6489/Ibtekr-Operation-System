-- 0151 — the meeting of 23 Nov [#15] (docs/superpowers/plans/2026-11-23-meeting.md phase 2.7): «تم الشحن».
-- A product set «تم الشحن للمخزن» asks how it went to the warehouse (بوسطة · توصيلة · المبتكر جابه بنفسه · مندوبنا), a product set
-- «تم الشحن للعميل» or the whole order set «قيد الشحن» asks how it goes to the customer (بوسطة · توصيلة). The answer is recorded here and on
-- the order's timeline (order_events kind «shipment»); nothing is written on the site. The money goes through the accounts' own tables
-- (the page writes them through IBAccounts first and passes their ids): Bosta's pickup fee and a ride to the warehouse = «مواصلات» on the
-- maker (acc_vendor_moves), a ride to the customer paid by the company = an «المصروفات» expense, paid by the customer = this row only
-- (payer «customer» — the customer's shipping charges, kept in the system; the order on the site does not change).

create table if not exists public.order_shipments (
  id bigserial primary key,
  order_id bigint not null references public.orders on delete cascade,
  item_id bigint references public.order_items on delete cascade,
  vendor_id uuid references public.vendors on delete set null,
  leg text not null check (leg in ('warehouse', 'customer')),
  method text not null check (method in ('bosta', 'ride', 'maker', 'courier')),
  app_name text check (app_name is null or char_length(app_name) between 1 and 40),
  amount numeric(12, 2) check (amount is null or amount >= 0),
  payer text check (payer is null or payer in ('maker', 'company', 'customer')),
  vendor_move_id bigint references public.acc_vendor_moves on delete set null,
  expense_id bigint references public.acc_expenses on delete set null,
  created_by uuid references public.profiles on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint order_shipments_shape check (
    (leg = 'warehouse' and method in ('bosta', 'ride', 'maker', 'courier'))
    or (leg = 'customer' and method in ('bosta', 'ride')))
);
create index if not exists order_shipments_order on public.order_shipments (order_id);

alter table public.order_shipments enable row level security;
create policy order_shipments_select on public.order_shipments for select to authenticated
  using ((select public.has_perm('orders.view')) <> 'N');
-- no direct insert / update / delete for members: order_shipment_add below
grant select on public.order_shipments to authenticated;
grant all on public.order_shipments to service_role;
grant usage, select on sequence public.order_shipments_id_seq to service_role;

-- the shipment: a member who may change the order's statuses (orders.status F or orders.edit — the rule of order_items_update in 0007)
create or replace function public.order_shipment_add(p_order bigint, p_item bigint, p_leg text, p_method text, p_app text,
  p_amount numeric, p_payer text, p_vendor_move bigint, p_expense bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_vendor uuid; v_app text := nullif(btrim(coalesce(p_app, '')), '');
  v_label text;
begin
  if (select public.has_perm('orders.view')) = 'N'
     or not ((select public.has_perm('orders.status')) = 'F' or (select public.has_perm('orders.edit')) <> 'N') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.orders where id = p_order and deleted_at is null) then raise exception 'not found' using errcode = 'P0002'; end if;
  if p_leg not in ('warehouse', 'customer') then raise exception 'invalid: leg' using errcode = '22023'; end if;
  if p_method not in ('bosta', 'ride', 'maker', 'courier') or (p_leg = 'customer' and p_method not in ('bosta', 'ride')) then
    raise exception 'invalid: method' using errcode = '22023'; end if;
  if v_app is not null and (char_length(v_app) > 40 or v_app ~ '[<>]') then raise exception 'invalid: app' using errcode = '22023'; end if;
  if p_amount is not null and p_amount < 0 then raise exception 'invalid: amount' using errcode = '22023'; end if;
  -- a ride always has its app and its amount; a pickup by Bosta to the warehouse its amount (Safwat 23 Nov: asked every time)
  if p_method = 'ride' and (v_app is null or p_amount is null or p_amount <= 0) then raise exception 'invalid: amount' using errcode = '22023'; end if;
  if p_leg = 'warehouse' and p_method = 'bosta' and (p_amount is null or p_amount <= 0) then raise exception 'invalid: amount' using errcode = '22023'; end if;
  if p_leg = 'customer' and p_method = 'ride' and coalesce(p_payer, '') not in ('company', 'customer') then raise exception 'invalid: payer' using errcode = '22023'; end if;
  if p_item is not null then
    select vendor_id into v_vendor from public.order_items where id = p_item and order_id = p_order;
    if not found then raise exception 'invalid: item' using errcode = '22023'; end if;
  end if;
  -- the money rows the page wrote must be the order's own kind: a maker's «مواصلات» / an expense
  if p_vendor_move is not null and not exists (select 1 from public.acc_vendor_moves where id = p_vendor_move and kind = 'مواصلات' and direction = 'withdraw' and voided_at is null) then
    raise exception 'invalid: vendor_move' using errcode = '22023'; end if;
  if p_expense is not null and not exists (select 1 from public.acc_expenses where id = p_expense and direction = 'withdraw' and voided_at is null) then
    raise exception 'invalid: expense' using errcode = '22023'; end if;
  insert into public.order_shipments (order_id, item_id, vendor_id, leg, method, app_name, amount, payer, vendor_move_id, expense_id)
  values (p_order, p_item, v_vendor, p_leg, p_method, case when p_method = 'ride' then v_app end,
    case when p_method in ('ride', 'bosta') then p_amount end,
    case when p_method = 'ride' and p_leg = 'customer' then p_payer when p_amount is not null then 'maker' end,
    p_vendor_move, p_expense)
  returning id into v_id;
  v_label := case p_method when 'bosta' then 'بوسطة' when 'ride' then 'توصيلة' || coalesce(' (' || v_app || ')', '') when 'maker' then 'المبتكر جابه بنفسه' else 'مندوبنا' end;
  insert into public.order_events (order_id, item_id, actor, source, kind, new_value, detail)
  values (p_order, p_item, auth.uid(), 'user', 'shipment',
    (case p_leg when 'warehouse' then 'اتشحن للمخزن — ' else 'اتشحن للعميل — ' end) || v_label,
    jsonb_build_object('shipment', v_id, 'leg', p_leg, 'method', p_method));
  return v_id;
end $$;
revoke execute on function public.order_shipment_add(bigint, bigint, text, text, text, numeric, text, bigint, bigint) from public, anon;
grant execute on function public.order_shipment_add(bigint, bigint, text, text, text, numeric, text, bigint, bigint) to authenticated, service_role;

-- the orders' data section takes it (a wipe of the orders wipes their shipments) — the map of 0150 + this one row
create or replace function public.data_wipe_map() returns table (section text, tbl text)
language sql immutable set search_path = public as $$
  select * from (values
    ('orders', 'orders'), ('orders', 'sub_orders'), ('orders', 'order_items'), ('orders', 'order_events'), ('orders', 'customer_ratings'), ('orders', 'returns'), ('orders', 'woo_webhook_events'), ('orders', 'sync_state'), ('orders', 'bosta_pickups'), ('orders', 'order_shipments'),
    ('vendors', 'vendors'), ('vendors', 'vendor_rates'), ('vendors', 'vendor_category_rates'), ('vendors', 'vendor_bank'), ('vendors', 'vendor_logins'), ('vendors', 'vendor_login_resets'), ('vendors', 'brands'), ('vendors', 'brand_owners'), ('vendors', 'brand_rates'),
    ('products', 'products'), ('products', 'woo_categories'), ('products', 'woo_brands'), ('products', 'product_commissions'), ('products', 'product_lead_days'), ('products', 'studio_batches'), ('products', 'image_imports'), ('products', 'image_shares'),
    ('accounts', 'acc_expenses'), ('accounts', 'acc_vendor_moves'), ('accounts', 'acc_account_moves'), ('accounts', 'acc_vendor_settlements'), ('accounts', 'dokan_withdrawals'), ('accounts', 'dokan_balances'),
    ('inventory', 'inv_lots'), ('inventory', 'inv_moves'), ('inventory', 'inv_consolidations'), ('inventory', 'inv_consolidation_items'), ('inventory', 'inv_counts'), ('inventory', 'inv_count_lines'),
    ('cs', 'cs_customers'), ('cs', 'cs_contacts'), ('cs', 'cs_customer_notes'), ('cs', 'cs_rating_overrides'), ('cs', 'cs_team_ratings'), ('cs', 'cs_conversations'), ('cs', 'cs_messages'), ('cs', 'cs_segments'), ('cs', 'cs_campaigns'), ('cs', 'cs_campaign_recipients'), ('cs', 'cs_posts'), ('cs', 'cs_carts'), ('cs', 'cs_auto_runs'),
    ('tickets', 'tickets'), ('tickets', 'ticket_events'),
    ('marketing', 'mkt_campaigns'), ('marketing', 'mkt_posts'), ('marketing', 'mkt_ad_objects'), ('marketing', 'mkt_ad_stats'), ('marketing', 'mkt_suggestions'), ('marketing', 'mkt_requests'), ('marketing', 'mkt_video_jobs'), ('marketing', 'mkt_agent_chats'), ('marketing', 'mkt_agent_messages'), ('marketing', 'mkt_trends'), ('marketing', 'mkt_competitors'), ('marketing', 'site_checks'),
    ('hr', 'hr_attendance'), ('hr', 'hr_overtime'), ('hr', 'hr_requests'), ('hr', 'hr_payroll'), ('hr', 'hr_payroll_lines'), ('hr', 'hr_payroll_paid'), ('hr', 'hr_adjustments'), ('hr', 'hr_evaluations'), ('hr', 'hr_scores'), ('hr', 'hr_extras'), ('hr', 'hr_meetings'), ('hr', 'hr_notes_log'), ('hr', 'hr_ot_adjust'), ('hr', 'hr_tasks'),
    ('logs', 'activity_log'), ('logs', 'alerts'), ('logs', 'alert_reads'), ('logs', 'alert_state'), ('logs', 'ai_runs'), ('logs', 'woo_sync_log'), ('logs', 'cs_channel_events'), ('logs', 'login_failures'),
    ('logs', 'ai_agent_notes'), ('logs', 'ai_agent_note_reads'), ('logs', 'ai_agent_state')
  ) v(section, tbl)
$$;
revoke execute on function public.data_wipe_map() from public, anon;
grant execute on function public.data_wipe_map() to authenticated, service_role;

-- the live signal (0104): a shipment is the order's — its id goes with «orders»
do $$
begin
  if to_regprocedure('public.live_orders()') is null then return; end if;
  drop trigger if exists order_shipments_live_ins on public.order_shipments;
  create trigger order_shipments_live_ins after insert on public.order_shipments referencing new table as live_rows
    for each statement execute function public.live_orders('order_id');
end $$;
