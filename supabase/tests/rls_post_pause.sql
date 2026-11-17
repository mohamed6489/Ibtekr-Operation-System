-- RLS / permission tests for 0122_post_pause (the owner 17 Nov — the publish step: «وقف نشر» keeps a post in the plan as «متوقف»
-- until «كمّل النشر»; «تأكيد النشر» schedules the picked pieces only). Depends on 0001 … 0122. One transaction rolled back; prints
-- NOTICE 'rls_post_pause: ok' only if every case passed. Live-safe: its made-up members and rows are rolled back.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000122c1', 'pp-ops.dev@ibtekr.local', '01000122c01'),
  ('00000000-0000-4000-8000-0000000122c2', 'pp-acc.dev@ibtekr.local', '01000122c02');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u where u.email like 'pp-%.dev@ibtekr.local';
insert into public.profiles (id, name, email, phone, role_id, status) values
  ('00000000-0000-4000-8000-0000000122c1', 'محتوى الإيقاف', 'pp-ops.dev@ibtekr.local', '01000122c01', 'ops', 'active'),
  ('00000000-0000-4000-8000-0000000122c2', 'حسابات الإيقاف', 'pp-acc.dev@ibtekr.local', '01000122c02', 'accounts', 'active');

create temp table pp_ids (k text primary key, cid uuid, pid bigint) on commit drop;
grant all on pp_ids to authenticated, service_role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000122c1","role":"authenticated"}', true);
with c as (insert into public.mkt_campaigns (name) values ('إيقاف النشر') returning id) insert into pp_ids (k, cid) select 'c', id from c;

do $$
declare
  c uuid := (select cid from pp_ids where k = 'c'); d text := (public.hr_today() + 2)::text; n int; p1 bigint; p2 bigint; r text;
  it1 jsonb; it2 jsonb;
begin
  it1 := jsonb_build_object('piece', 'P1', 'kind', 'بوست', 'name', 'أول', 'images', jsonb_build_array(c || '/p1.png'), 'platform', 'فيسبوك', 'day', d, 'time', '19:00', 'how', 'publish');
  it2 := jsonb_build_object('piece', 'P2', 'kind', 'بوست', 'name', 'تاني', 'images', jsonb_build_array(c || '/p2.png'), 'platform', 'فيسبوك', 'day', d, 'time', '20:00', 'how', 'publish');
  n := public.mkt_schedule(c, jsonb_build_array(it1, it2));
  if n <> 2 then raise exception 'case two scheduled failed: %', n; end if;
  p1 := (select id from public.mkt_posts where campaign_id = c and piece = 'P1'); p2 := (select id from public.mkt_posts where campaign_id = c and piece = 'P2');
  insert into pp_ids (k, pid) values ('p1', p1), ('p2', p2);

  -- pause: «مجدول» → «متوقف»; again = refused; resume → «مجدول»
  r := public.mkt_post_act(p1, 'pause', '{}'::jsonb);
  if r <> 'متوقف' or (select status from public.mkt_posts where id = p1) <> 'متوقف' then raise exception 'case pause failed'; end if;
  begin perform public.mkt_post_act(p1, 'pause', '{}'::jsonb); raise exception 'case a paused row is not paused again failed';
  exception when sqlstate '22023' then null; end;
  -- a paused row moves and stays paused; its caption changes
  r := public.mkt_post_act(p1, 'move', jsonb_build_object('day', d, 'time', '18:00'));
  if r <> 'متوقف' or (select time from public.mkt_posts where id = p1) <> '18:00' then raise exception 'case a paused row moves and stays paused failed'; end if;
  perform public.mkt_post_act(p1, 'caption', jsonb_build_object('text', 'جديد'));
  -- «تأكيد النشر» with the picked piece only (p_keep): P2 is not touched; P1 picked while paused → scheduled again
  n := public.mkt_schedule(c, jsonb_build_array(it2), true);
  if (select status from public.mkt_posts where id = p1) <> 'متوقف' then raise exception 'case p_keep leaves an unpicked paused row failed'; end if;
  n := public.mkt_schedule(c, jsonb_build_array(it1), true);
  if (select status from public.mkt_posts where id = p1) <> 'مجدول' or (select status from public.mkt_posts where id = p2) <> 'مجدول' then
    raise exception 'case a picked paused row is scheduled again, the other kept failed';
  end if;
  -- without p_keep (as before) the unpicked waiting rows go
  perform public.mkt_post_act(p1, 'pause', '{}'::jsonb);
  n := public.mkt_schedule(c, jsonb_build_array(it2));
  if (select status from public.mkt_posts where id = p1) <> 'متوقف' then raise exception 'case a paused row is not deleted by a schedule failed'; end if;
  r := public.mkt_post_act(p1, 'resume', '{}'::jsonb);
  if r <> 'مجدول' then raise exception 'case resume failed'; end if;
  begin perform public.mkt_post_act(p1, 'resume', '{}'::jsonb); raise exception 'case resume of a waiting row failed';
  exception when sqlstate '22023' then null; end;
  -- a paused row may be deleted
  perform public.mkt_post_act(p2, 'pause', '{}'::jsonb);
  if public.mkt_post_act(p2, 'delete', '{}'::jsonb) <> 'اتحذف' then raise exception 'case a paused row deletes failed'; end if;
end $$;

-- a paused row whose time went: resume refused (move it first) — set by the owner of the table
reset role;
update public.mkt_posts set status = 'متوقف', day = public.hr_today() - 1 where id = (select pid from pp_ids where k = 'p1');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000122c1","role":"authenticated"}', true);
do $$
begin
  begin perform public.mkt_post_act((select pid from pp_ids where k = 'p1'), 'resume', '{}'::jsonb); raise exception 'case a gone time is not resumed failed';
  exception when sqlstate '22023' then null; end;
end $$;

-- the publisher never claims a paused row (the server's claim)
reset role;
do $$
begin
  update public.mkt_posts set day = public.hr_today() - 1, how = 'publish' where id = (select pid from pp_ids where k = 'p1');
  if exists (select 1 from public.mkt_publish_claim(20) x where x.id = (select pid from pp_ids where k = 'p1')) then raise exception 'case a paused row is never claimed failed'; end if;
  if exists (select 1 from public.mkt_publish_claim(1, (select pid from pp_ids where k = 'p1'))) then raise exception 'case «انشر دلوقتي» on a paused row failed'; end if;
  if (select status from public.mkt_posts where id = (select pid from pp_ids where k = 'p1')) <> 'متوقف' then raise exception 'case it stays paused failed'; end if;
end $$;

-- accounts (marketing.publish N) pauses nothing
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000122c2","role":"authenticated"}', true);
do $$
begin
  begin perform public.mkt_post_act((select pid from pp_ids where k = 'p1'), 'resume', '{}'::jsonb); raise exception 'case accounts resumes nothing failed';
  exception when insufficient_privilege then null; end;
end $$;

do $$ begin raise notice 'rls_post_pause: ok'; end $$;
rollback;
