-- Tests for 0153 (the meeting of 23 Nov [#29] — the ads expenses from the platforms' spend): acc_ad_spend gives a member who reads the
-- accounts the daily spend per platform (the campaign rows summed — the ad rows not counted twice), without the marketing page; a
-- member with accounts.view N gets nothing; a bad range is refused. Depends on 0001 … 0153. One transaction, rolled back; NOTICE
-- 'rls_acc_ad_spend: ok' only if every case passed. Live-safe: made-up members and stats on a day far from the live ones (2001).

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-000000153a01', 'ad-acc.dev@ibtekr.local', '0100153a01'),
  ('00000000-0000-4000-8000-000000153a02', 'ad-none.dev@ibtekr.local', '0100153a02');
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-000000153a01', 'حسابات إعلانات', 'ad-acc.dev@ibtekr.local', '0100153a01', 'ops', 'active', '{"accounts.view":"P","marketing.view":"N"}'),
  ('00000000-0000-4000-8000-000000153a02', 'من غير حسابات', 'ad-none.dev@ibtekr.local', '0100153a02', 'ops', 'active', '{"accounts.view":"N","marketing.view":"F"}');
insert into public.mkt_ad_stats (platform, level, object_id, campaign_id, day, spend) values
  ('meta', 'campaign', '9153001', '9153001', '2001-02-01', 700), ('meta', 'campaign', '9153002', '9153002', '2001-02-01', 550.5),
  ('meta', 'ad', '9153011', '9153001', '2001-02-01', 700), ('tiktok', 'campaign', '9153003', '9153003', '2001-02-02', 100),
  ('meta', 'campaign', '9153004', '9153004', '2001-02-03', 0);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000153a01","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.acc_ad_spend('2001-02-01', '2001-02-28')) <> 2 then raise exception 'case the days with spend, per platform failed'; end if;
  if (select spend from public.acc_ad_spend('2001-02-01', '2001-02-28') where platform = 'meta') <> 1250.5 then raise exception 'case the campaign rows summed (not the ads) failed'; end if;
  begin perform public.acc_ad_spend('2001-02-28', '2001-02-01'); raise exception 'case a bad range failed';
  exception when invalid_parameter_value then null; end;
end $$;

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000153a02","role":"authenticated"}';
do $$ begin
  begin perform public.acc_ad_spend('2001-02-01', '2001-02-28'); raise exception 'case accounts.view N reads nothing failed';
  exception when insufficient_privilege then null; end;
end $$;

do $$ begin raise notice 'rls_acc_ad_spend: ok'; end $$;
rollback;
