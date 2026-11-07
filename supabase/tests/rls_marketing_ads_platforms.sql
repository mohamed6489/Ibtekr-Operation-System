-- RLS / permission tests for 0055_marketing_ads_platforms (phase 9.5.6): the ads tables take tiktok / google rows (the server's),
-- read with marketing.view; the platform links in Vault are the server's only; the OAuth state takes an ads channel.
-- Depends on 0001 … 0055. One transaction rolled back; prints NOTICE 'rls_marketing_ads_platforms: ok' only if every case passed. Live-safe.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000055a1', 'ap-adm.dev@ibtekr.local', '01000055a01'),
  ('00000000-0000-4000-8000-0000000055a2', 'ap-ops.dev@ibtekr.local', '01000055a02'),
  ('00000000-0000-4000-8000-0000000055a3', 'ap-cs.dev@ibtekr.local', '01000055a03');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u where u.email like 'ap-%.dev@ibtekr.local';
insert into public.profiles (id, name, email, phone, role_id, status) values
  ('00000000-0000-4000-8000-0000000055a1', 'أدمن الإعلانات', 'ap-adm.dev@ibtekr.local', '01000055a01', 'admin', 'active'),
  ('00000000-0000-4000-8000-0000000055a2', 'محتوى الإعلانات', 'ap-ops.dev@ibtekr.local', '01000055a02', 'ops', 'active'),
  ('00000000-0000-4000-8000-0000000055a3', 'خدمة عملاء', 'ap-cs.dev@ibtekr.local', '01000055a03', 'cs', 'active');

-- the server's rows: a TikTok account and campaign with a day's numbers, a Google campaign, a TikTok suggestion
insert into public.mkt_ad_objects (platform, kind, id, name, status, meta) values
  ('tiktok', 'account', '7000000000000000001', 'Ibtekr TikTok', 'STATUS_ENABLE', '{"currency":"EGP"}'),
  ('tiktok', 'campaign', '1800000000000000001', 'Macrame TT', 'ENABLE', '{"daily_budget":300}'),
  ('google', 'campaign', '21000000001', 'Macrame G', 'ENABLED', '{"daily_budget":250}');
insert into public.mkt_ad_stats (platform, level, object_id, campaign_id, day, spend, impressions, clicks, purchases, purchase_value) values
  ('tiktok', 'campaign', '1800000000000000001', '1800000000000000001', current_date - 1, 120.50, 9000, 210, 2, 1800),
  ('google', 'campaign', '21000000001', '21000000001', current_date - 1, 80.00, 3000, 140, 1, 900);
insert into public.mkt_suggestions (platform, kind, campaign_id, campaign_name, title, status) values ('tiktok', 'stop', '1800000000000000001', 'Macrame TT', 'وقّف «Macrame TT»', 'pending');
insert into public.cs_oauth_states (state, verifier, channel, created_by) values ('a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6', 'v1234567890123456789012345678901234567890123', 'ads_tiktok', '00000000-0000-4000-8000-0000000055a1');
do $$ begin
  begin insert into public.mkt_ad_objects (platform, kind, id) values ('snap', 'campaign', '1'); raise exception 'case an unknown platform is refused failed';
  exception when check_violation then null; end;
  begin insert into public.cs_oauth_states (state, verifier, channel, created_by) values ('b1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6', 'v1234567890123456789012345678901234567890123', 'ads_snap', '00000000-0000-4000-8000-0000000055a1');
    raise exception 'case an unknown oauth channel is refused failed';
  exception when check_violation then null; end;
end $$;

set local role authenticated;
-- ops (marketing.view F): reads every platform's rows; never writes; the Vault door is shut
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000055a2","role":"authenticated"}', true);
do $$ begin
  if (select count(*) from public.mkt_ad_objects where platform in ('tiktok', 'google')) <> 3 then raise exception 'case ops reads the platforms'' objects failed'; end if;
  if (select sum(spend) from public.mkt_ad_stats where platform in ('tiktok', 'google')) <> 200.50 then raise exception 'case ops reads the platforms'' numbers failed'; end if;
  if (select count(*) from public.mkt_suggestions where platform = 'tiktok') <> 1 then raise exception 'case ops reads a tiktok suggestion failed'; end if;
  begin insert into public.mkt_ad_objects (platform, kind, id) values ('tiktok', 'campaign', '1800000000000000002'); raise exception 'case a member writes an object failed';
  exception when insufficient_privilege then null; end;
  begin perform public.mkt_secret_set('ads_tiktok', 'x'); raise exception 'case a member sets a link failed';
  exception when insufficient_privilege then null; end;
  begin perform public.mkt_secret_get('ads_tiktok'); raise exception 'case a member reads a link failed';
  exception when insufficient_privilege then null; end;
  begin perform count(*) from public.cs_oauth_states; raise exception 'case a member reads the oauth states failed';
  exception when insufficient_privilege then null; end;
end $$;
-- cs (marketing N): nothing
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000055a3","role":"authenticated"}', true);
do $$ begin
  if (select count(*) from public.mkt_ad_objects where platform = 'tiktok') <> 0 then raise exception 'case cs sees nothing failed'; end if;
end $$;
-- anon: no execute on the Vault door
set local role anon;
do $$ begin
  begin perform public.mkt_secret_get('ads_tiktok'); raise exception 'case anon on mkt_secret_get failed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
-- the server (service_role claims): an unknown name is refused; a known one reaches Vault (or says Vault is not here)
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$ begin
  begin perform public.mkt_secret_set('ads_snap', 'x'); raise exception 'case an unknown secret name is refused failed';
  exception when invalid_parameter_value then null; end;
  begin perform public.mkt_secret_set('ads_tiktok', '{"t":1}');
    if public.mkt_secret_get('ads_tiktok') <> '{"t":1}' then raise exception 'case the server reads what it wrote failed'; end if;
    perform public.mkt_secret_set('ads_tiktok', null);
    if public.mkt_secret_get('ads_tiktok') is not null then raise exception 'case null removes the link failed'; end if;
  exception when feature_not_supported then null; end; -- no Vault on this database
end $$;
select set_config('request.jwt.claims', '', true);

do $$ begin raise notice 'rls_marketing_ads_platforms: ok'; end $$;
rollback;
