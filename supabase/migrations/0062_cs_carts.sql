-- 0062_cs_carts — phase 12 T7 (docs/superpowers/plans/2026-11-08-phase-12-followups.md, decisions 7 and 13): the visitor's cart left
-- before the checkout. The shop's free «Cart Abandonment Recovery» (CartFlows) keeps the checkout fields a visitor typed before paying;
-- the WPCode snippet tools/wp-snippets/ibtekr-carts.php exposes them read-only on ibtekr/v1/carts behind the WooCommerce REST keys, and
-- woo-sync's part «carts» (cron woo-sync-carts, every 10 minutes) mirrors the last 48 hours here. The auto-reply engine reads this table
-- for the «سلة متروكة» event next to the orders that stopped at payment (6.5 decision 12).
-- * cs_carts — one row a site cart (the site's id is the key): e-mail, phone, name, total, item count, the plugin's status (normal =
--   abandoned · completed · lost), the plugin's recovery link, the site's last change, our sync stamps. The server writes it (service_role);
--   the members read it through cs_carts_v with the phone masked unless sensitive.customer_phone = F (like orders_v) — the table itself
--   grants the members no phone column. Nothing here holds the cart's contents.
-- Every table: RLS + explicit grants (rule 4); the view security_invoker; re-runnable; no drop / delete of data.

create table if not exists public.cs_carts (
  cart_id bigint primary key check (cart_id > 0),
  email text not null default '' check (char_length(email) <= 254),
  phone text not null default '' check (char_length(phone) <= 32),
  name text not null default '' check (char_length(name) <= 120),
  total numeric(12, 2) not null default 0 check (total >= 0),
  items int not null default 0 check (items between 0 and 1000),
  status text not null default 'normal' check (status in ('normal', 'completed', 'lost')),
  unsubscribed boolean not null default false,
  url text not null default '' check (url = '' or url ~ '^https://'),
  site_updated_at timestamptz not null,
  first_seen_at timestamptz not null default now(),
  synced_at timestamptz not null default now()
);
create index if not exists cs_carts_status_idx on public.cs_carts (status, site_updated_at desc);
create index if not exists cs_carts_phone_idx on public.cs_carts (public.norm_phone(phone)) where phone <> '';

alter table public.cs_carts enable row level security;
drop policy if exists cs_carts_select on public.cs_carts;
create policy cs_carts_select on public.cs_carts for select to authenticated using ((select public.has_perm('cs.view')) <> 'N');
revoke all on public.cs_carts from anon, authenticated;
-- the members: every column but the phone (the view below masks it)
grant select (cart_id, email, name, total, items, status, unsubscribed, url, site_updated_at, first_seen_at, synced_at) on public.cs_carts to authenticated;
grant all on public.cs_carts to service_role;

-- the phone of one cart as the caller may see it (definer: authenticated has no select on the column; the row already passed RLS)
create or replace function public.cs_cart_phone(p_cart_id bigint) returns text
language plpgsql stable security definer set search_path = public as $$
declare v_full boolean; v_phone text;
begin
  if public.has_perm('cs.view') = 'N' then return null; end if;
  v_full := public.has_perm('sensitive.customer_phone') = 'F';
  select c.phone into v_phone from public.cs_carts c where c.cart_id = p_cart_id;
  return case when v_phone is null or v_phone = '' then v_phone when v_full then v_phone else public.mask_phone(public.norm_phone(v_phone)) end;
end
$$;
revoke execute on function public.cs_cart_phone(bigint) from public, anon;
grant execute on function public.cs_cart_phone(bigint) to authenticated, service_role;

create or replace view public.cs_carts_v with (security_invoker = true) as
  select c.cart_id, c.email, public.cs_cart_phone(c.cart_id) as phone, c.name, c.total, c.items, c.status, c.unsubscribed, c.url, c.site_updated_at, c.first_seen_at, c.synced_at
  from public.cs_carts c;
revoke all on public.cs_carts_v from anon;
grant select on public.cs_carts_v to authenticated, service_role;

-- the cron: woo-sync part «carts» every 10 minutes (guarded like 0019; the sync secret from Vault)
do $$
begin
  if not (exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net')
          and exists (select 1 from pg_extension where extname = 'supabase_vault')) then
    raise notice '0062_cs_carts: pg_cron / pg_net / supabase_vault not installed — the carts sync job skipped';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'woo-sync-carts') then
    perform cron.unschedule('woo-sync-carts');
  end if;
  perform cron.schedule('woo-sync-carts', '*/10 * * * *', $cron$
    select net.http_post(
      url := 'https://fsynculhaupcktzkfkdd.supabase.co/functions/v1/woo-sync',
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'X-Sync-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_secret')),
      body := '{"action":"carts"}'::jsonb,
      timeout_milliseconds := 60000
    )
  $cron$);
end $$;
