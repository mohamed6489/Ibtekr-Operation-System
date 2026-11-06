-- 0052_marketing_ads — phase 9.5.3: Meta Ads numbers next to WooCommerce's own orders
-- (docs/superpowers/plans/2026-11-06-phase-9-5-marketing.md, decisions 42–48). Read-only numbers: nothing is written on Meta.
-- * The order's source: WooCommerce's Order Attribution (_wc_order_attribution_* in orders.raw, kept by the sync already) → the
--   columns attr_type / utm_source / utm_medium / utm_campaign / utm_content and ad_platform (meta | google | tiktok: an ad = a
--   «utm» source of an ad platform with a paid medium or a campaign id). A doubled parameter («ig,ig») keeps its first part; a
--   campaign starting with an id keeps the id. A trigger keeps them with the raw (no change in the sync), and the old orders are
--   filled here. Not granted to the members — mkt_ads_orders reads them.
-- * mkt_ad_objects (the ad account, its campaigns and ads: name, status, the creative's picture) and mkt_ad_stats (a day × a
--   campaign or an ad: spend, impressions, reach, clicks, link clicks, frequency, Meta's purchases and their value): read with
--   marketing.view, written by the server only (the Edge Function mkt-ads, the account's System User token).
-- * mkt_ads_orders(p_from, p_to) — marketing.view: the ad-sourced orders by day × platform × source × campaign × group
--   (completed / in_progress / pending / cancelled): their count and sales (the lines, as «الحسابات»), and Ibtekr's share for
--   accounts.view only (accounts_sales's own rule; null otherwise). A deleted order is out.
-- * The cron mkt-ads-sync (hourly, the sync secret of 0008, guarded like 0040).
-- Re-runnable; no drop / delete / truncate of data.

-- ---------------------------------------------------------------- the order's source

alter table public.orders add column if not exists attr_type text;
alter table public.orders add column if not exists utm_source text;
alter table public.orders add column if not exists utm_medium text;
alter table public.orders add column if not exists utm_campaign text;
alter table public.orders add column if not exists utm_content text;
alter table public.orders add column if not exists ad_platform text;
alter table public.orders drop constraint if exists orders_ad_platform_check;
alter table public.orders add constraint orders_ad_platform_check check (ad_platform is null or ad_platform in ('meta', 'google', 'tiktok'));
create index if not exists orders_ad_idx on public.orders (ad_platform, placed_at) where ad_platform is not null;

-- one attribution value: the first part of a doubled parameter («ig,ig»), trimmed, 120 characters; '' → null
create or replace function public.order_attr_part(p text) returns text
language sql immutable set search_path = public as $$
  select nullif(left(btrim(split_part(coalesce(p, ''), ',', 1)), 120), '')
$$;

-- an order's raw (Woo's _wc_order_attribution_* meta) → its source; an ad = «utm» from an ad platform with a paid medium or a
-- campaign id (Meta's dynamic {{campaign.id}})
create or replace function public.order_attribution(p_raw jsonb, out attr_type text, out utm_source text, out utm_medium text,
  out utm_campaign text, out utm_content text, out ad_platform text)
language plpgsql immutable set search_path = public as $$
declare
  m jsonb := case when jsonb_typeof(p_raw -> 'meta_data') = 'array' then p_raw -> 'meta_data' else '[]'::jsonb end;
  src text; med text;
begin
  select public.order_attr_part(max(case when e ->> 'key' = '_wc_order_attribution_source_type' then e ->> 'value' end)),
         public.order_attr_part(max(case when e ->> 'key' = '_wc_order_attribution_utm_source' then e ->> 'value' end)),
         public.order_attr_part(max(case when e ->> 'key' = '_wc_order_attribution_utm_medium' then e ->> 'value' end)),
         public.order_attr_part(max(case when e ->> 'key' = '_wc_order_attribution_utm_campaign' then e ->> 'value' end)),
         public.order_attr_part(max(case when e ->> 'key' = '_wc_order_attribution_utm_content' then e ->> 'value' end))
    into attr_type, utm_source, utm_medium, utm_campaign, utm_content
    from jsonb_array_elements(m) e
   where jsonb_typeof(e) = 'object';
  if utm_campaign ~ '^[0-9]{6,}' then utm_campaign := substring(utm_campaign from '^[0-9]+'); end if;
  if utm_content ~ '^[0-9]{6,}' then utm_content := substring(utm_content from '^[0-9]+'); end if;
  src := lower(coalesce(utm_source, '')); med := lower(coalesce(utm_medium, ''));
  ad_platform := case
    when lower(coalesce(attr_type, '')) <> 'utm' then null
    when not (med in ('paid', 'cpc', 'ppc', 'paid_social', 'paidsocial', 'paid-social', 'social_paid', 'ads', 'ad', 'cpm') or coalesce(utm_campaign, '') ~ '^[0-9]{6,}$') then null
    when src in ('fb', 'facebook', 'ig', 'instagram', 'an', 'msg', 'messenger', 'th', 'threads', 'meta') then 'meta'
    when src in ('google', 'googleads', 'adwords', 'gads', 'youtube', 'yt') then 'google'
    when src in ('tiktok', 'tt', 'tiktokads') then 'tiktok'
  end;
end $$;

create or replace function public.orders_attribution_set() returns trigger
language plpgsql set search_path = public as $$
begin
  select a.attr_type, a.utm_source, a.utm_medium, a.utm_campaign, a.utm_content, a.ad_platform
    into new.attr_type, new.utm_source, new.utm_medium, new.utm_campaign, new.utm_content, new.ad_platform
    from public.order_attribution(new.raw) a;
  return new;
end $$;
create or replace trigger orders_attribution before insert or update of raw on public.orders
  for each row execute function public.orders_attribution_set();

-- the orders synced before this migration
with a as (
  select x.id, s.attr_type, s.utm_source, s.utm_medium, s.utm_campaign, s.utm_content, s.ad_platform
    from public.orders x cross join lateral public.order_attribution(x.raw) s
   where x.raw ? 'meta_data'
)
update public.orders o
   set attr_type = a.attr_type, utm_source = a.utm_source, utm_medium = a.utm_medium, utm_campaign = a.utm_campaign,
       utm_content = a.utm_content, ad_platform = a.ad_platform
  from a
 where a.id = o.id
   and (o.attr_type, o.utm_source, o.utm_medium, o.utm_campaign, o.utm_content, o.ad_platform) is distinct from
       (a.attr_type, a.utm_source, a.utm_medium, a.utm_campaign, a.utm_content, a.ad_platform);

revoke execute on function public.order_attr_part(text), public.order_attribution(jsonb), public.orders_attribution_set() from public, anon, authenticated;
grant execute on function public.order_attr_part(text), public.order_attribution(jsonb), public.orders_attribution_set() to service_role;

-- ---------------------------------------------------------------- the ad account's objects and their daily numbers

create table if not exists public.mkt_ad_objects (
  platform text not null default 'meta' check (platform in ('meta')),
  kind text not null check (kind in ('account', 'campaign', 'ad')),
  id text not null check (id ~ '^[0-9]{1,30}$'),
  parent_id text check (parent_id is null or parent_id ~ '^[0-9]{1,30}$'),
  name text check (name is null or char_length(name) <= 300),
  status text check (status is null or status ~ '^[A-Z_]{1,40}$'),
  thumb text check (thumb is null or (thumb ~ '^https://' and char_length(thumb) <= 2000)),
  meta jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object' and octet_length(meta::text) <= 4000),
  updated_at timestamptz not null default now(),
  primary key (platform, kind, id)
);

create table if not exists public.mkt_ad_stats (
  platform text not null default 'meta' check (platform in ('meta')),
  level text not null check (level in ('campaign', 'ad')),
  object_id text not null check (object_id ~ '^[0-9]{1,30}$'),
  campaign_id text not null check (campaign_id ~ '^[0-9]{1,30}$'),
  day date not null,
  spend numeric(14,2) not null default 0 check (spend >= 0),
  impressions bigint not null default 0 check (impressions >= 0),
  reach bigint check (reach is null or reach >= 0),
  clicks bigint not null default 0 check (clicks >= 0),
  link_clicks bigint check (link_clicks is null or link_clicks >= 0),
  frequency numeric(10,3) check (frequency is null or frequency >= 0),
  purchases numeric(12,2) not null default 0 check (purchases >= 0),
  purchase_value numeric(14,2) not null default 0 check (purchase_value >= 0),
  updated_at timestamptz not null default now(),
  primary key (platform, level, object_id, day)
);
create index if not exists mkt_ad_stats_day_idx on public.mkt_ad_stats (day, level);

alter table public.mkt_ad_objects enable row level security;
drop policy if exists mkt_ad_objects_select on public.mkt_ad_objects;
create policy mkt_ad_objects_select on public.mkt_ad_objects for select to authenticated
  using ((select public.has_perm('marketing.view')) <> 'N');
revoke all on public.mkt_ad_objects from anon, authenticated;
grant select on public.mkt_ad_objects to authenticated;
grant all on public.mkt_ad_objects to service_role;

alter table public.mkt_ad_stats enable row level security;
drop policy if exists mkt_ad_stats_select on public.mkt_ad_stats;
create policy mkt_ad_stats_select on public.mkt_ad_stats for select to authenticated
  using ((select public.has_perm('marketing.view')) <> 'N');
revoke all on public.mkt_ad_stats from anon, authenticated;
grant select on public.mkt_ad_stats to authenticated;
grant all on public.mkt_ad_stats to service_role;

-- ---------------------------------------------------------------- the ad-sourced orders (decision 44)

create or replace function public.mkt_ads_orders(p_from date, p_to date)
returns table (day date, platform text, source text, campaign text, grp text, orders bigint, sales numeric, share numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  v_money boolean := public.is_admin() or coalesce(public.has_perm('accounts.view'), 'N') <> 'N';
  v_rates boolean := public.is_admin() or coalesce(public.has_perm('sensitive.commission'), 'N') = 'F'; -- accounts_sales's rule
begin
  if coalesce(public.has_perm('marketing.view'), 'N') = 'N' then
    raise exception 'marketing.view is needed' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'the range is from <= to, at most 400 days' using errcode = '22023';
  end if;
  return query
  with o as (
    select x.id, (x.placed_at at time zone 'Africa/Cairo')::date as d, x.ad_platform as pl, lower(coalesce(x.utm_source, '')) as src,
           coalesce(x.utm_campaign, '') as camp,
           case when x.status = 'مكتمل' then 'completed'
                when x.status in ('جاري التنفيذ', 'جاهز للشحن', 'قيد الشحن') then 'in_progress'
                when x.status in ('ملغي', 'استرجاع', 'فشل') then 'cancelled'
                else 'pending' end as g
      from public.orders x
     where x.ad_platform is not null and x.deleted_at is null
       and (x.placed_at at time zone 'Africa/Cairo')::date between p_from and p_to
  ), l as (
    select o.id, o.d, o.pl, o.src, o.camp, o.g, i.total,
           coalesce(i.commission_rate,
                    case when v_rates then (select r.rate from public.vendor_rates r where r.vendor_id = i.vendor_id and r.since <= o.d order by r.since desc, r.id desc limit 1) end,
                    0) as rate,
           coalesce(i.commission_fee, 0) as fee
      from o left join public.order_items i on i.order_id = o.id and not i.removed
  )
  select l.d, l.pl, l.src, l.camp, l.g, count(distinct l.id), round(coalesce(sum(l.total), 0), 2),
         case when v_money then round(coalesce(sum(l.total * l.rate / 100 + l.fee), 0), 2) end
    from l
   group by l.d, l.pl, l.src, l.camp, l.g;
end $$;
revoke execute on function public.mkt_ads_orders(date, date) from public, anon;
grant execute on function public.mkt_ads_orders(date, date) to authenticated, service_role;

-- ---------------------------------------------------------------- the cron (guarded like 0040; the sync secret of 0008)

do $$
begin
  if to_regnamespace('cron') is null or to_regnamespace('net') is null or to_regclass('vault.decrypted_secrets') is null then
    raise notice '0052: pg_cron / pg_net / Vault not here — the ads sync cron is not scheduled';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'mkt-ads-sync') then perform cron.unschedule('mkt-ads-sync'); end if;
  -- hourly at :23 (the other jobs run at :00 / :07 / every 15 minutes); mkt-ads answers not_configured until the owner's token is set
  perform cron.schedule('mkt-ads-sync', '23 * * * *', $cron$
    select net.http_post(
      url := 'https://fsynculhaupcktzkfkdd.supabase.co/functions/v1/mkt-ads',
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'X-Sync-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_secret')),
      body := '{"action":"sync"}'::jsonb,
      timeout_milliseconds := 120000
    )
  $cron$);
end $$;
