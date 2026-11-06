-- RLS / permission tests for 0051_marketing_publish (phase 9.5.2: the auto-publishing's rows — how publish in the schedule, the busy
-- rows, the server's claim and numbers, the platform's own rows, the master switch). Depends on 0001 … 0051. One transaction rolled
-- back; prints NOTICE 'rls_marketing_publish: ok' only if every case passed. Live-safe: its made-up members and rows are rolled back.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000051c1', 'mp-adm.dev@ibtekr.local', '01000051c01'),
  ('00000000-0000-4000-8000-0000000051c2', 'mp-ops.dev@ibtekr.local', '01000051c02');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u where u.email like 'mp-%.dev@ibtekr.local';
insert into public.profiles (id, name, email, phone, role_id, status) values
  ('00000000-0000-4000-8000-0000000051c1', 'أدمن النشر', 'mp-adm.dev@ibtekr.local', '01000051c01', 'admin', 'active'),
  ('00000000-0000-4000-8000-0000000051c2', 'محتوى النشر', 'mp-ops.dev@ibtekr.local', '01000051c02', 'ops', 'active');

create temp table mp_ids (k text primary key, cid uuid, pid bigint) on commit drop;
grant all on mp_ids to authenticated, service_role;

-- the master switch: no row = off
do $$
begin
  if exists (select 1 from public.settings where section = 'marketing') then raise exception 'case no switch row as shipped failed'; end if;
  if public.mkt_autopublish() then raise exception 'case mkt_autopublish() is false failed'; end if;
end $$;

-- ================================================================ the schedule with how (ops)

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000051c2","role":"authenticated"}', true);
with c as (insert into public.mkt_campaigns (name) values ('نشر تلقائي') returning id) insert into mp_ids (k, cid) select 'c', id from c;

do $$
declare
  c uuid := (select cid from mp_ids where k = 'c'); d text := (public.hr_today() + 1)::text; n int; it jsonb;
  bad text;
begin
  -- one bad item at a time → the reason
  foreach it in array array[
    jsonb_build_object('piece', 'P1', 'kind', 'بوست', 'images', jsonb_build_array(c || '/p1.jpg'), 'platform', 'تيك توك', 'day', d, 'time', '19:00', 'how', 'publish'),
    jsonb_build_object('piece', 'V1', 'kind', 'ريل', 'images', jsonb_build_array(c || '/v1.jpg'), 'platform', 'انستجرام', 'day', d, 'time', '19:00', 'how', 'publish'),
    jsonb_build_object('piece', 'P1', 'kind', 'بوست', 'images', jsonb_build_array(c || '/p1.png'), 'platform', 'انستجرام', 'day', d, 'time', '19:00', 'how', 'publish'),
    jsonb_build_object('piece', 'C1', 'kind', 'كاروسيل', 'images', jsonb_build_array(c || '/c1.jpg'), 'platform', 'فيسبوك', 'day', d, 'time', '19:00', 'how', 'publish'),
    jsonb_build_object('piece', 'P1', 'kind', 'بوست', 'images', jsonb_build_array(c || '/a.jpg', c || '/b.jpg'), 'platform', 'فيسبوك', 'day', d, 'time', '19:00', 'how', 'publish'),
    jsonb_build_object('piece', 'P1', 'kind', 'بوست', 'images', jsonb_build_array(c || '/p1.jpg'), 'platform', 'انستجرام', 'day', d, 'time', '19:00', 'how', 'publish',
                       'caption', repeat('ك', 2190), 'tags', '#إبتكر #هاندميد'),
    jsonb_build_object('piece', 'P1', 'kind', 'بوست', 'images', jsonb_build_array(c || '/p1.jpg'), 'platform', 'فيسبوك', 'day', d, 'time', '19:00', 'how', 'later')
  ] loop
    begin
      perform public.mkt_schedule(c, jsonb_build_array(it));
      raise exception 'case a bad publish item is refused failed: %', it ->> 'piece';
    exception when sqlstate '22023' then null; end;
  end loop;
  -- the good ones: Instagram JPEG, Facebook PNG, a Facebook carousel, a TikTok download, a story on Instagram
  n := public.mkt_schedule(c, jsonb_build_array(
    jsonb_build_object('piece', 'P1', 'kind', 'بوست', 'name', 'أول بوست', 'caption', 'دفا الشتا', 'tags', '#إبتكر', 'images', jsonb_build_array(c || '/pub-a1.jpg'), 'platform', 'انستجرام', 'day', d, 'time', '19:00', 'how', 'publish'),
    jsonb_build_object('piece', 'P1', 'kind', 'بوست', 'name', 'أول بوست', 'caption', 'دفا الشتا', 'images', jsonb_build_array(c || '/p1.png'), 'platform', 'فيسبوك', 'day', d, 'time', '19:00', 'how', 'publish'),
    jsonb_build_object('piece', 'C1', 'kind', 'كاروسيل', 'name', 'كاروسيل', 'images', jsonb_build_array(c || '/c0.jpg', c || '/c1.jpg', c || '/c2.jpg'), 'platform', 'فيسبوك', 'day', d, 'time', '21:00', 'how', 'publish'),
    jsonb_build_object('piece', 'P2', 'kind', 'بوست', 'name', 'تاني', 'images', jsonb_build_array(c || '/p2.png'), 'platform', 'تيك توك', 'day', d, 'time', '20:00'),
    jsonb_build_object('piece', 'X1', 'kind', 'ستوري', 'name', 'ستوري', 'caption', repeat('ك', 2200), 'tags', '#x', 'images', jsonb_build_array(c || '/x1.JPEG'), 'platform', 'انستجرام', 'day', d, 'time', '22:00', 'how', 'publish')));
  if n <> 5 then raise exception 'case five waiting rows failed: %', n; end if;
  if (select string_agg(piece || ':' || platform || ':' || how, ',' order by piece, platform) from public.mkt_posts where campaign_id = c)
     <> 'C1:فيسبوك:publish,P1:انستجرام:publish,P1:فيسبوك:publish,P2:تيك توك:download,X1:انستجرام:publish' then
    raise exception 'case the rows carry their how failed';
  end if;
  insert into mp_ids (k, pid) select 'ig', id from public.mkt_posts where campaign_id = c and piece = 'P1' and platform = 'انستجرام';
  insert into mp_ids (k, pid) select 'fb', id from public.mkt_posts where campaign_id = c and piece = 'P1' and platform = 'فيسبوك';
  insert into mp_ids (k, pid) select 'car', id from public.mkt_posts where campaign_id = c and piece = 'C1';
  -- the new columns are read, none written by a member
  if (select src || coalesce(external_id, '-') || attempts from public.mkt_posts where id = (select pid from mp_ids where k = 'ig')) <> 'system-0' then
    raise exception 'case a new row is the system''s, no id, no attempt failed';
  end if;
  begin update public.mkt_posts set views = 1 where id = (select pid from mp_ids where k = 'ig'); raise exception 'case a member writes no numbers failed';
  exception when insufficient_privilege then null; end;
  -- Instagram's text on a caption of a row to publish
  begin perform public.mkt_post_act((select pid from mp_ids where k = 'ig'), 'caption', jsonb_build_object('text', repeat('ك', 2195)));
    raise exception 'case Instagram''s 2200 with the tags on a caption failed';
  exception when sqlstate '22023' then null; end;
  perform public.mkt_post_act((select pid from mp_ids where k = 'fb'), 'caption', jsonb_build_object('text', repeat('ك', 2200))); -- Facebook: the caption alone
  -- the server's functions are not a member's
  begin perform public.mkt_publish_claim(5); raise exception 'case a member claims nothing failed'; exception when insufficient_privilege then null; end;
  begin perform public.mkt_stats_put('[]'::jsonb); raise exception 'case a member puts no numbers failed'; exception when insufficient_privilege then null; end;
  begin perform public.mkt_autopublish(); raise exception 'case a member reads the switch through the server''s function failed'; exception when insufficient_privilege then null; end;
end $$;

-- ================================================================ the server's claim (service_role)

reset role;
-- the Instagram row comes due (its day yesterday)
update public.mkt_posts set day = public.hr_today() - 1 where id = (select pid from mp_ids where k = 'ig');
set local role service_role;
do $$
declare r public.mkt_posts; n int;
begin
  select * into r from public.mkt_publish_claim(5);
  if r.id is distinct from (select pid from mp_ids where k = 'ig') or r.attempts <> 1 or r.claimed_at is null then raise exception 'case the due row is claimed failed'; end if;
  select count(*) into n from public.mkt_publish_claim(5);
  if n <> 0 then raise exception 'case a claimed row is not taken twice failed'; end if;
  -- «انشر دلوقتي» on a row not due: taken, a publish row
  select * into r from public.mkt_publish_claim(1, (select pid from mp_ids where k = 'car'));
  if r.id is distinct from (select pid from mp_ids where k = 'car') or r.how <> 'publish' then raise exception 'case one row claimed by id failed'; end if;
  select count(*) into n from public.mkt_publish_claim(1, (select pid from mp_ids where k = 'car'));
  if n <> 0 then raise exception 'case a busy row is not claimed by id failed'; end if;
end $$;

-- a member can't touch a row being published
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000051c2","role":"authenticated"}', true);
do $$
declare id bigint := (select pid from mp_ids where k = 'ig'); a text;
begin
  foreach a in array array['caption', 'published', 'delete'] loop
    begin perform public.mkt_post_act(id, a, '{"text":"x"}'::jsonb); raise exception 'case a busy row takes no % failed', a;
    exception when sqlstate '22023' then if sqlerrm <> 'invalid: busy' then raise; end if; end;
  end loop;
end $$;

-- a run that died in its last step: the row is failed «uncertain», never taken again
reset role;
update public.mkt_posts set work = '{"stage":"publishing"}', claimed_at = now() - interval '6 minutes' where id = (select pid from mp_ids where k = 'ig');
set local role service_role;
do $$
declare n int; r public.mkt_posts;
begin
  select count(*) into n from public.mkt_publish_claim(5);
  select * into r from public.mkt_posts where id = (select pid from mp_ids where k = 'ig');
  if n <> 0 or r.status <> 'فشل' or r.error <> 'uncertain' or r.claimed_at is not null then raise exception 'case a dead last step is failed uncertain failed'; end if;
  -- the member's «انشر دلوقتي» takes it again, cleared
  select * into r from public.mkt_publish_claim(1, r.id);
  if r.status <> 'مجدول' or r.error is not null or r.work is not null or r.attempts <> 2 then raise exception 'case «انشر دلوقتي» retries an uncertain row failed'; end if;
end $$;

-- ================================================================ the numbers and the platform's rows (service_role)

do $$
declare n int; r public.mkt_posts;
begin
  n := public.mkt_stats_put(jsonb_build_array(jsonb_build_object('id', (select pid from mp_ids where k = 'fb'), 'views', 1200, 'likes', 40, 'eng', 51, 'comments', 'x', 'shares', -3),
                                              jsonb_build_object('id', 'not a number', 'views', 5)));
  select * into r from public.mkt_posts where id = (select pid from mp_ids where k = 'fb');
  if n <> 1 or r.views <> 1200 or r.likes <> 40 or r.eng <> 51 or r.comments is not null or r.shares is not null or r.stats_at is null then
    raise exception 'case the numbers are put, a bad value kept out failed';
  end if;
  -- a platform row: no campaign, an id once per platform
  insert into public.mkt_posts (src, kind, name, caption, platform, day, time, status, external_id, thumb, post_url, published_at)
    values ('platform', 'بوست', 'بوست من الصفحة', 'كلام', 'فيسبوك', public.hr_today(), '10:00', 'اتنشر', '1111_2222', 'https://scontent.example/a.jpg', 'https://www.facebook.com/x', now());
  begin
    insert into public.mkt_posts (src, kind, name, platform, day, time, status, external_id) values ('platform', 'بوست', 'تاني', 'فيسبوك', public.hr_today(), '10:00', 'اتنشر', '1111_2222');
    raise exception 'case one row per platform id failed';
  exception when unique_violation then null; end;
  begin
    insert into public.mkt_posts (src, campaign_id, piece, kind, name, platform, day, time, status) values ('platform', (select cid from mp_ids where k = 'c'), 'P9', 'بوست', 'غلط', 'فيسبوك', public.hr_today(), '10:00', 'اتنشر');
    raise exception 'case a platform row has no campaign failed';
  exception when check_violation then null; end;
  begin update public.mkt_posts set thumb = 'http://x' where external_id = '1111_2222'; raise exception 'case a thumb is https failed'; exception when check_violation then null; end;
end $$;

-- the member reads the platform's row (marketing.view)
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000051c2","role":"authenticated"}', true);
do $$ begin if not exists (select 1 from public.mkt_posts where src = 'platform' and external_id = '1111_2222') then raise exception 'case a member reads a platform row failed'; end if; end $$;

-- the switch: the admin turns it on (0002's settings policies)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000051c1","role":"authenticated"}', true);
insert into public.settings (section, data) values ('marketing', '{"autopublish": true}'::jsonb)
  on conflict (section) do update set data = public.settings.data || excluded.data;
reset role;
do $$ begin if not public.mkt_autopublish() then raise exception 'case the admin turns the switch on failed'; end if; end $$;

do $$ begin raise notice 'rls_marketing_publish: ok'; end $$;
rollback;
