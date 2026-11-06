-- RLS / permission tests for 0052_marketing_ads (phase 9.5.3: the order's source from WooCommerce's Order Attribution, Meta's
-- ad objects and daily numbers, the ad-sourced orders with Ibtekr's share for accounts.view only). Depends on 0001 … 0052. One
-- transaction rolled back; prints NOTICE 'rls_marketing_ads: ok' only if every case passed. Live-safe: its made-up members, role,
-- orders and rows are rolled back.

begin;

insert into public.roles (id, name, description, is_system, permissions, sort) values
  ('mka_only', 'تسويق بس (اختبار)', 'test', false, '{"marketing.view": "F", "accounts.view": "N"}'::jsonb, 99);
insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000052a1', 'ma-adm.dev@ibtekr.local', '01000052a01'),
  ('00000000-0000-4000-8000-0000000052a2', 'ma-ops.dev@ibtekr.local', '01000052a02'),
  ('00000000-0000-4000-8000-0000000052a3', 'ma-cs.dev@ibtekr.local', '01000052a03'),
  ('00000000-0000-4000-8000-0000000052a4', 'ma-mkt.dev@ibtekr.local', '01000052a04');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u where u.email like 'ma-%.dev@ibtekr.local';
insert into public.profiles (id, name, email, phone, role_id, status) values
  ('00000000-0000-4000-8000-0000000052a1', 'أدمن الإعلانات', 'ma-adm.dev@ibtekr.local', '01000052a01', 'admin', 'active'),
  ('00000000-0000-4000-8000-0000000052a2', 'محتوى الإعلانات', 'ma-ops.dev@ibtekr.local', '01000052a02', 'ops', 'active'),
  ('00000000-0000-4000-8000-0000000052a3', 'خدمة عملاء', 'ma-cs.dev@ibtekr.local', '01000052a03', 'cs', 'active'),
  ('00000000-0000-4000-8000-0000000052a4', 'تسويق بس', 'ma-mkt.dev@ibtekr.local', '01000052a04', 'mka_only', 'active');

-- an order's raw with Woo's attribution meta
create function pg_temp.raw_attr(st text, src text, med text, camp text, content text default null) returns jsonb language sql as $$
  select jsonb_build_object('meta_data', jsonb_build_array(
    jsonb_build_object('id', 1, 'key', '_wc_order_attribution_source_type', 'value', st),
    jsonb_build_object('id', 2, 'key', '_wc_order_attribution_utm_source', 'value', src),
    jsonb_build_object('id', 3, 'key', '_wc_order_attribution_utm_medium', 'value', med),
    jsonb_build_object('id', 4, 'key', '_wc_order_attribution_utm_campaign', 'value', camp),
    jsonb_build_object('id', 5, 'key', '_wc_order_attribution_utm_content', 'value', content),
    jsonb_build_object('id', 6, 'key', '_dokan_vendor_id', 'value', '7')))
$$;

-- ================================================================ the source, from the raw (the trigger), the shapes met on the site

insert into public.orders (id, number, customer_name, status, placed_at, raw) values
  (95200001, '95200001', 'أ', 'مكتمل', '2026-11-02 10:00+02', pg_temp.raw_attr('utm', 'fb', 'paid', '120252323303340228')),
  (95200002, '95200002', 'ب', 'جاري التنفيذ', '2026-11-02 12:00+02', pg_temp.raw_attr('utm', 'ig,ig', 'paid,paid', '120252323303340228https://stage.ibtekr.club/x', '120260000000000001')),
  (95200003, '95200003', 'ج', 'ملغي', '2026-11-03 09:00+02', pg_temp.raw_attr('utm', 'fb', 'paid', '120251977233530228')),
  (95200004, '95200004', 'د', 'مكتمل', '2026-11-03 11:00+02', pg_temp.raw_attr('typein', '(direct)', null, null)),
  (95200005, '95200005', 'ه', 'مكتمل', '2026-11-03 13:00+02', pg_temp.raw_attr('referral', 'm.facebook.com', 'referral', null)),
  (95200006, '95200006', 'و', 'قيد الانتظار', '2026-11-04 15:00+02', pg_temp.raw_attr('utm', 'google', 'cpc', 'winter-sale')),
  (95200007, '95200007', 'ز', 'مكتمل', '2026-11-04 16:00+02', pg_temp.raw_attr('utm', 'fb', 'social', 'free-post')),
  (95200008, '95200008', 'ح', 'مكتمل', '2026-11-04 17:00+02', pg_temp.raw_attr('utm', 'tiktok', 'paid', '1799999999')),
  (95200009, '95200009', 'ط', 'مكتمل', '2026-11-05 10:00+02', '{"id": 9}'::jsonb),
  (95200010, '95200010', 'ي', 'مكتمل', '2026-11-05 11:00+02', pg_temp.raw_attr('utm', 'fb', 'paid', '120252323303340228'));
insert into public.order_items (id, order_id, name, qty, total, commission_rate, commission_fee) values
  (95210001, 95200001, 'مخدة', 1, 1000, 10, 5),
  (95210002, 95200001, 'لمبة', 1, 500, 20, 0),
  (95210003, 95200002, 'سجادة', 1, 2000, 15, 0),
  (95210004, 95200003, 'ملغي', 1, 700, 10, 0),
  (95210005, 95200006, 'جوجل', 1, 300, 10, 0),
  (95210006, 95200010, 'ممسوح', 1, 900, 10, 0);
update public.orders set deleted_at = now() where id = 95200010; -- a deleted order is out of every number

do $$
declare r record;
begin
  select attr_type, utm_source, utm_medium, utm_campaign, utm_content, ad_platform into r from public.orders where id = 95200001;
  if (r.attr_type, r.utm_source, r.utm_medium, r.utm_campaign, r.ad_platform) is distinct from ('utm', 'fb', 'paid', '120252323303340228', 'meta') or r.utm_content is not null then
    raise exception 'case a Meta ad order failed: %', r;
  end if;
  -- the doubled parameters and a campaign glued to a link: the first part, the id
  select utm_source, utm_medium, utm_campaign, utm_content, ad_platform into r from public.orders where id = 95200002;
  if (r.utm_source, r.utm_medium, r.utm_campaign, r.utm_content, r.ad_platform) is distinct from ('ig', 'paid', '120252323303340228', '120260000000000001', 'meta') then
    raise exception 'case «ig,ig» / a campaign glued to a link failed: %', r;
  end if;
  -- not ads: a direct visit, a referral, an unpaid utm with a name, no attribution at all
  if exists (select 1 from public.orders where id in (95200004, 95200005, 95200007, 95200009) and ad_platform is not null) then
    raise exception 'case direct / referral / unpaid / none are not ads failed';
  end if;
  if (select attr_type from public.orders where id = 95200004) <> 'typein' or (select utm_source from public.orders where id = 95200005) <> 'm.facebook.com'
     or (select attr_type from public.orders where id = 95200009) is not null then
    raise exception 'case the source kept for the non-ads failed';
  end if;
  if (select ad_platform from public.orders where id = 95200006) <> 'google' or (select ad_platform from public.orders where id = 95200008) <> 'tiktok' then
    raise exception 'case Google and TikTok ads failed';
  end if;
  -- the raw changes (the sync) → the source follows; another column's update leaves it
  update public.orders set raw = pg_temp.raw_attr('utm', 'instagram', 'paid', '120251297405730228') where id = 95200007;
  if (select (ad_platform, utm_campaign) from public.orders where id = 95200007) is distinct from ('meta'::text, '120251297405730228'::text) then
    raise exception 'case the source follows the raw failed';
  end if;
  update public.orders set note = 'ملاحظة' where id = 95200007;
  if (select ad_platform from public.orders where id = 95200007) <> 'meta' then raise exception 'case another column keeps the source failed'; end if;
  update public.orders set raw = pg_temp.raw_attr('utm', 'fb', 'social', 'free-post') where id = 95200007; -- back to not an ad
end $$;

-- ================================================================ who reads what

-- the server writes the ad account's numbers
insert into public.mkt_ad_objects (kind, id, parent_id, name, status, thumb) values
  ('account', '1122334455', null, 'Ibtekr Club', 'ACTIVE', null),
  ('campaign', '120252323303340228', '1122334455', 'Macrame — Retargeting', 'ACTIVE', null),
  ('ad', '120260000000000001', '120252323303340228', 'Macrame — carousel', 'ACTIVE', 'https://scontent.example/t.jpg');
insert into public.mkt_ad_stats (level, object_id, campaign_id, day, spend, impressions, reach, clicks, link_clicks, frequency, purchases, purchase_value) values
  ('campaign', '120252323303340228', '120252323303340228', '2026-11-02', 800.50, 12000, 9000, 300, 210, 1.333, 3, 4200),
  ('ad', '120260000000000001', '120252323303340228', '2026-11-02', 800.50, 12000, 9000, 300, 210, 1.333, 3, 4200);

set local role authenticated;
-- ops (marketing F, accounts P): reads the numbers and the share (the line's own rate — no commission permission)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000052a2","role":"authenticated"}', true);
do $$
declare n int; s numeric; c numeric;
begin
  if (select count(*) from public.mkt_ad_objects) <> 3 or (select count(*) from public.mkt_ad_stats) <> 2 then raise exception 'case ops reads the ad numbers failed'; end if;
  begin insert into public.mkt_ad_stats (level, object_id, campaign_id, day) values ('campaign', '1', '1', '2026-11-01'); raise exception 'case a member writes numbers failed';
  exception when insufficient_privilege then null; end;
  begin update public.mkt_ad_objects set name = 'x' where id = '1122334455'; raise exception 'case a member edits an ad object failed';
  exception when insufficient_privilege then null; end;
  begin perform utm_campaign from public.orders limit 1; raise exception 'case the source columns are not granted failed';
  exception when insufficient_privilege then null; end;
  begin perform public.order_attribution('{}'::jsonb); raise exception 'case order_attribution is the server''s failed';
  exception when insufficient_privilege then null; end;
  -- the ad orders of 2–4 November: Meta 1 (2 lines) + Meta 2 + Meta 3 (cancelled) + Google 6 (pending) + TikTok 8; not 4 / 5 / 7 / 9 / 10
  select count(*), sum(orders) into n, s from public.mkt_ads_orders('2026-11-01', '2026-11-05');
  if n <> 5 or s <> 5 then raise exception 'case the ad orders of the period failed: % rows, % orders', n, s; end if;
  select sales, share into s, c from public.mkt_ads_orders('2026-11-01', '2026-11-05') where campaign = '120252323303340228' and source = 'fb';
  if s <> 1500 or c <> 205 then raise exception 'case Meta fb: the lines and the share (1000×10%%+5 + 500×20%%) failed: % / %', s, c; end if;
  if (select grp from public.mkt_ads_orders('2026-11-01', '2026-11-05') where campaign = '120252323303340228' and source = 'ig') <> 'in_progress'
     or (select grp from public.mkt_ads_orders('2026-11-01', '2026-11-05') where campaign = '120251977233530228') <> 'cancelled'
     or (select grp from public.mkt_ads_orders('2026-11-01', '2026-11-05') where platform = 'google') <> 'pending' then
    raise exception 'case the groups failed';
  end if;
  if (select count(*) from public.mkt_ads_orders('2026-11-03', '2026-11-03')) <> 1 then raise exception 'case the day is Cairo''s failed'; end if;
  -- an order of TikTok without lines: counted, sales 0
  if (select (orders, sales) from public.mkt_ads_orders('2026-11-04', '2026-11-04') where platform = 'tiktok') is distinct from (1::bigint, 0::numeric) then
    raise exception 'case an order without lines failed';
  end if;
  begin perform public.mkt_ads_orders('2026-11-05', '2026-11-01'); raise exception 'case the range is checked failed';
  exception when sqlstate '22023' then null; end;
  begin perform public.mkt_ads_orders('2025-01-01', '2026-11-05'); raise exception 'case 400 days at most failed';
  exception when sqlstate '22023' then null; end;
end $$;

-- marketing without accounts: the numbers, no share
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000052a4","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.mkt_ad_stats) <> 2 then raise exception 'case marketing reads the numbers failed'; end if;
  if (select sum(sales) from public.mkt_ads_orders('2026-11-01', '2026-11-05')) <> 4500 then raise exception 'case marketing reads the sales failed'; end if;
  if exists (select 1 from public.mkt_ads_orders('2026-11-01', '2026-11-05') where share is not null) then raise exception 'case no share without accounts.view failed'; end if;
end $$;

-- cs (marketing N): nothing
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000052a3","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.mkt_ad_objects) <> 0 or (select count(*) from public.mkt_ad_stats) <> 0 then raise exception 'case cs reads no ad numbers failed'; end if;
  begin perform public.mkt_ads_orders('2026-11-01', '2026-11-05'); raise exception 'case cs is refused the ad orders failed';
  exception when insufficient_privilege then null; end;
end $$;

-- the admin: the share with the agreements
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000052a1","role":"authenticated"}', true);
do $$
begin
  if (select share from public.mkt_ads_orders('2026-11-01', '2026-11-05') where campaign = '120252323303340228' and source = 'ig') <> 300 then
    raise exception 'case the admin''s share (2000×15%%) failed';
  end if;
end $$;
reset role;

-- anon: nothing at all
set local role anon;
do $$
begin
  begin perform public.mkt_ads_orders('2026-11-01', '2026-11-05'); raise exception 'case anon is refused failed';
  exception when insufficient_privilege then null; end;
  begin perform count(*) from public.mkt_ad_stats; raise exception 'case anon reads no table failed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

do $$ begin raise notice 'rls_marketing_ads: ok'; end $$;
rollback;
