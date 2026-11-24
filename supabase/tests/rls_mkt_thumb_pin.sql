-- Tests for 0156 (the meeting of 23 Nov [#43] — the marketing pictures): mkt_posts.thumb_path / mkt_ad_objects.thumb_path hold the
-- server's copy of Meta's picture in the bucket «marketing» (platform/<fb|ig>/<post>.<ext> · ads/<platform>/<ad>.<ext> only); a member
-- who reads marketing reads them with the rows and never writes them. Depends on 0001 … 0156. One transaction, rolled back; NOTICE
-- 'rls_mkt_thumb_pin: ok' only if every case passed. Live-safe: made-up rows far from the live ids.

begin;

insert into auth.users (id, email, phone) values ('00000000-0000-4000-8000-000000156a01', 'mkt-pin.dev@ibtekr.local', '0100156a01');
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-000000156a01', 'تسويق الصور', 'mkt-pin.dev@ibtekr.local', '0100156a01', 'ops', 'active', '{"marketing.view":"F","marketing.create":"F","marketing.publish":"F"}');
insert into public.mkt_posts (src, kind, name, platform, day, time, how, status, external_id, thumb_path)
values ('platform', 'بوست', 'بوست الصور', 'انستجرام', current_date, '10:00', 'publish', 'اتنشر', '9915601', 'platform/ig/9915601.jpg');
insert into public.mkt_ad_objects (platform, kind, id, name, thumb_path) values ('meta', 'ad', '9915601', 'إعلان الصور', 'ads/meta/9915601.jpg');

do $$ begin
  begin update public.mkt_posts set thumb_path = '../secret/x.jpg' where external_id = '9915601' and src = 'platform'; raise exception 'case a path outside platform/ failed';
  exception when check_violation then null; end;
  begin update public.mkt_ad_objects set thumb_path = 'platform/ig/x.jpg' where id = '9915601'; raise exception 'case an ad''s path under ads/ failed';
  exception when check_violation then null; end;
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000156a01","role":"authenticated"}';
do $$ begin
  if (select thumb_path from public.mkt_posts where external_id = '9915601' and src = 'platform') is distinct from 'platform/ig/9915601.jpg' then raise exception 'case a member reads the post''s copy failed'; end if;
  if (select thumb_path from public.mkt_ad_objects where id = '9915601') is distinct from 'ads/meta/9915601.jpg' then raise exception 'case a member reads the ad''s copy failed'; end if;
  begin update public.mkt_posts set thumb_path = null where external_id = '9915601' and src = 'platform'; raise exception 'case only the server writes it failed';
  exception when insufficient_privilege then null; end;
end $$;

do $$ begin raise notice 'rls_mkt_thumb_pin: ok'; end $$;
rollback;
