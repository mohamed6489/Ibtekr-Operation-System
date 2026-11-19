-- 0144 — Bosta from the system, part 2 (the owner 19 Nov, after «ابعت لبوسطة»: «نعدل البوليصة اللي بتتبعت بعد خصم مبلغ العربون …
-- و نعرف نعملها طباعة من السيستم … و لو فيه امكانية نعمل بيك اب من السيستم للفيندور … و نطبع بوليصة … بعنوان المخزن و باسم مدير
-- التشغيل و ممكن اغير الاسم و اكتب الملاحظة»; answers: the cash on the waybill follows the deposit automatically, the maker pickup is one
-- operation; plan docs/superpowers/plans/2026-11-19-orders-batch.md decisions 15–17).
--
-- 1) orders.bosta_delivery — Bosta's id of the order's delivery (printing the waybill and editing it need it): the site's plugin keeps
--    it in the order meta bosta_delivery_id (copied like the tracking number, 0140 / 0142), woo-sync bosta_send writes it for an order
--    the system sent. orders.bosta_cod — the cash Bosta holds for the order (what the system last sent); bosta_cod_due — the deposit,
--    the total or the payment method changed since, so woo-sync bosta_cod puts the new amount on Bosta (the page right after a save,
--    and the cron below every 5 minutes for anything left); bosta_cod_error — Bosta refused (the courier has the parcel already …).
--    All four are the server's (service_role writes; members read the amount and the refusal through orders_v).
-- 2) bosta_pickups — a maker pickup: a Bosta delivery from the maker's pickup location to the warehouse (receiver the operations
--    manager or whoever the member wrote, the member's note, cash 0) and the courier's pickup request there. The server writes the
--    rows (woo-sync bosta_pickup); whoever sees the orders reads them. The maker's last location comes back from here (no column on
--    vendors). In «منطقة الخطر» with the orders.
-- 3) settings «bosta» — { warehouse: <Bosta location id>, receiver, phone } (the admin, the settings policies of 0002): where a maker
--    pickup goes and to whom by default.

alter table public.orders add column if not exists bosta_delivery text;
alter table public.orders add column if not exists bosta_cod numeric(12,2);
alter table public.orders add column if not exists bosta_cod_due boolean not null default false;
alter table public.orders add column if not exists bosta_cod_error text;

-- the cash Bosta collects for an order — the same rule as _shared/bosta.js codOf (cash on delivery: the total minus the deposit, never
-- below 0; a paid order 0)
create or replace function public.bosta_cod_of(p_method text, p_total numeric, p_deposit numeric)
returns numeric language sql immutable set search_path = public as $$
  select case when p_method = 'cod' then greatest(0, round(coalesce(p_total, 0) - coalesce(p_deposit, 0), 2)) else 0 end
$$;

-- 0142's trigger + the delivery id from the site's order (the plugin's meta) when it has one
create or replace function public.orders_bosta_set() returns trigger
language plpgsql set search_path = public as $$
begin
  new.bosta_tracking := coalesce(public.order_meta_text(new.raw, 'bosta_tracking_number'), case when tg_op = 'UPDATE' then old.bosta_tracking end);
  new.bosta_state := coalesce(public.order_meta_text(new.raw, 'bosta_status'), case when tg_op = 'UPDATE' then old.bosta_state end);
  new.bosta_delivery := coalesce(public.order_meta_text(new.raw, 'bosta_delivery_id'), case when tg_op = 'UPDATE' then old.bosta_delivery end);
  return new;
end $$;

-- the deposit / the total / the payment method changed on an order Bosta has → the new cash is due on Bosta
create or replace function public.orders_bosta_cod_due() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.bosta_delivery is not null and new.deleted_at is null
     and (new.total, new.deposit, new.payment_method) is distinct from (old.total, old.deposit, old.payment_method)
     and public.bosta_cod_of(new.payment_method, new.total, new.deposit) is distinct from coalesce(new.bosta_cod, public.bosta_cod_of(old.payment_method, old.total, old.deposit)) then
    new.bosta_cod_due := true;
    new.bosta_cod_error := null;
  end if;
  return new;
end $$;
-- named to fire after orders_guard_update (triggers run by name): the guard compares the member's row before this one marks it
drop trigger if exists orders_z_bosta_cod on public.orders;
create trigger orders_z_bosta_cod before update of total, deposit, payment_method on public.orders
  for each row execute function public.orders_bosta_cod_due();

revoke execute on function public.orders_bosta_set(), public.orders_bosta_cod_due() from public, anon, authenticated;
grant execute on function public.orders_bosta_set(), public.orders_bosta_cod_due() to service_role;
revoke execute on function public.bosta_cod_of(text, numeric, numeric) from public, anon;
grant execute on function public.bosta_cod_of(text, numeric, numeric) to authenticated, service_role;

-- the orders the site's plugin sent already
update public.orders o set bosta_delivery = public.order_meta_text(o.raw, 'bosta_delivery_id')
 where o.bosta_delivery is null and public.order_meta_text(o.raw, 'bosta_delivery_id') is not null;

grant select (bosta_delivery, bosta_cod, bosta_cod_error) on public.orders to authenticated;
grant select (bosta_delivery, bosta_cod, bosta_cod_due, bosta_cod_error), insert (bosta_delivery, bosta_cod, bosta_cod_due, bosta_cod_error),
  update (bosta_delivery, bosta_cod, bosta_cod_due, bosta_cod_error) on public.orders to service_role;

-- orders_v as 0140 left it + three columns at the end
create or replace view public.orders_v with (security_invoker = true) as
select o.id, o.number, o.customer_name,
       public.order_customer_phone(o.id) as customer_phone,
       o.customer_city, o.customer_address, o.payment_method, o.payment_title, o.status, o.woo_status,
       o.confirm, o.confirm_at, o.confirm_note, o.deposit, o.total, o.currency, o.note, o.customer_note,
       o.placed_at, o.woo_updated_at, o.cancel, o.ret, o.synced_at, o.created_at, o.updated_at,
       o.customer_state, o.bosta_tracking, o.bosta_state, o.bosta_delivery, o.bosta_cod, o.bosta_cod_error
from public.orders o
where o.deleted_at is null;
grant select on public.orders_v to authenticated, service_role;

-- 2) the maker pickups
create table if not exists public.bosta_pickups (
  id bigint generated always as identity primary key,
  vendor_id uuid references public.vendors(id) on delete set null,
  vendor_name text,
  location_id text not null check (location_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  location_name text,
  scheduled_date date not null,
  slot text not null check (slot in ('10:00 to 13:00', '13:00 to 16:00')),
  receiver_name text not null check (char_length(receiver_name) between 2 and 60),
  note text check (note is null or char_length(note) <= 300),
  parcels int not null default 1 check (parcels between 1 and 99),
  delivery_id text,
  tracking text,
  pickup_id text,
  state text not null default 'new' check (state in ('new', 'sent', 'failed')),
  error text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists bosta_pickups_vendor on public.bosta_pickups (vendor_id, created_at desc);
alter table public.bosta_pickups enable row level security;
drop policy if exists bosta_pickups_select on public.bosta_pickups;
create policy bosta_pickups_select on public.bosta_pickups for select to authenticated
  using (public.is_admin() or public.has_perm('orders.view') <> 'N');
grant select on public.bosta_pickups to authenticated;
grant select, insert, update, delete on public.bosta_pickups to service_role;

-- «منطقة الخطر»: with the orders (0138 + bosta_pickups)
create or replace function public.data_wipe_map() returns table (section text, tbl text)
language sql immutable set search_path = public as $$
  select * from (values
    ('orders', 'orders'), ('orders', 'sub_orders'), ('orders', 'order_items'), ('orders', 'order_events'), ('orders', 'customer_ratings'), ('orders', 'returns'), ('orders', 'woo_webhook_events'), ('orders', 'sync_state'), ('orders', 'bosta_pickups'),
    ('vendors', 'vendors'), ('vendors', 'vendor_rates'), ('vendors', 'vendor_category_rates'), ('vendors', 'vendor_bank'), ('vendors', 'vendor_logins'), ('vendors', 'vendor_login_resets'), ('vendors', 'brands'), ('vendors', 'brand_owners'), ('vendors', 'brand_rates'),
    ('products', 'products'), ('products', 'woo_categories'), ('products', 'woo_brands'), ('products', 'product_commissions'), ('products', 'product_lead_days'), ('products', 'studio_batches'), ('products', 'image_imports'), ('products', 'image_shares'),
    ('accounts', 'acc_expenses'), ('accounts', 'acc_vendor_moves'), ('accounts', 'acc_account_moves'), ('accounts', 'acc_vendor_settlements'), ('accounts', 'dokan_withdrawals'), ('accounts', 'dokan_balances'),
    ('inventory', 'inv_lots'), ('inventory', 'inv_moves'), ('inventory', 'inv_consolidations'), ('inventory', 'inv_consolidation_items'), ('inventory', 'inv_counts'), ('inventory', 'inv_count_lines'),
    ('cs', 'cs_customers'), ('cs', 'cs_contacts'), ('cs', 'cs_customer_notes'), ('cs', 'cs_rating_overrides'), ('cs', 'cs_team_ratings'), ('cs', 'cs_conversations'), ('cs', 'cs_messages'), ('cs', 'cs_segments'), ('cs', 'cs_campaigns'), ('cs', 'cs_campaign_recipients'), ('cs', 'cs_posts'), ('cs', 'cs_carts'), ('cs', 'cs_auto_runs'),
    ('tickets', 'tickets'), ('tickets', 'ticket_events'),
    ('marketing', 'mkt_campaigns'), ('marketing', 'mkt_posts'), ('marketing', 'mkt_ad_objects'), ('marketing', 'mkt_ad_stats'), ('marketing', 'mkt_suggestions'), ('marketing', 'mkt_requests'), ('marketing', 'mkt_video_jobs'), ('marketing', 'mkt_agent_chats'), ('marketing', 'mkt_agent_messages'), ('marketing', 'mkt_trends'), ('marketing', 'mkt_competitors'), ('marketing', 'site_checks'),
    ('hr', 'hr_attendance'), ('hr', 'hr_overtime'), ('hr', 'hr_requests'), ('hr', 'hr_payroll'), ('hr', 'hr_payroll_lines'), ('hr', 'hr_payroll_paid'), ('hr', 'hr_adjustments'), ('hr', 'hr_evaluations'), ('hr', 'hr_scores'), ('hr', 'hr_extras'), ('hr', 'hr_meetings'), ('hr', 'hr_notes_log'), ('hr', 'hr_ot_adjust'), ('hr', 'hr_tasks'),
    ('logs', 'activity_log'), ('logs', 'alerts'), ('logs', 'alert_reads'), ('logs', 'alert_state'), ('logs', 'ai_runs'), ('logs', 'woo_sync_log'), ('logs', 'cs_channel_events'), ('logs', 'login_failures'),
    ('logs', 'ai_agent_notes'), ('logs', 'ai_agent_note_reads')
  ) v(section, tbl)
$$;
revoke execute on function public.data_wipe_map() from public, anon;
grant execute on function public.data_wipe_map() to authenticated, service_role;

-- the cron: every 5 minutes, only when an order's new cash is due on Bosta (no call for nothing)
do $$
begin
  if to_regnamespace('cron') is null or to_regnamespace('net') is null or to_regclass('vault.decrypted_secrets') is null then
    raise notice '0144: pg_cron / pg_net / Vault not here — the bosta-cod cron is not scheduled';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'woo-sync-bosta-cod') then perform cron.unschedule('woo-sync-bosta-cod'); end if;
  perform cron.schedule('woo-sync-bosta-cod', '*/5 * * * *', $cron$
    select net.http_post(
      url := 'https://fsynculhaupcktzkfkdd.supabase.co/functions/v1/woo-sync',
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'X-Sync-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_secret')),
      body := '{"action":"bosta_cod"}'::jsonb,
      timeout_milliseconds := 120000
    )
    where exists (select 1 from public.orders q where q.bosta_cod_due and q.deleted_at is null)
  $cron$);
end $$;
