-- RLS / permission tests for 0049_marketing (phase 9.5.1 «التسويق»: the campaigns, the templates, the schedule and its log, the
-- wallet). Depends on 0001_identity … 0049_marketing. Runs in one transaction and rolls back; prints NOTICE 'rls_marketing: ok'
-- only if every case passed. Live-safe: its made-up members and rows are rolled back.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000049b1', 'mk-adm.dev@ibtekr.local', '01000049b01'),
  ('00000000-0000-4000-8000-0000000049b2', 'mk-ops.dev@ibtekr.local', '01000049b02'),
  ('00000000-0000-4000-8000-0000000049b3', 'mk-cs.dev@ibtekr.local', '01000049b03'),
  ('00000000-0000-4000-8000-0000000049b4', 'mk-view.dev@ibtekr.local', '01000049b04'),
  ('00000000-0000-4000-8000-0000000049b5', 'mk-off.dev@ibtekr.local', '01000049b05');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u where u.email like 'mk-%.dev@ibtekr.local';
insert into public.profiles (id, name, email, phone, role_id, status) values
  ('00000000-0000-4000-8000-0000000049b1', 'أدمن التسويق', 'mk-adm.dev@ibtekr.local', '01000049b01', 'admin', 'active'),
  ('00000000-0000-4000-8000-0000000049b2', 'المحتوى', 'mk-ops.dev@ibtekr.local', '01000049b02', 'ops', 'active'),
  ('00000000-0000-4000-8000-0000000049b3', 'خدمة العملاء', 'mk-cs.dev@ibtekr.local', '01000049b03', 'cs', 'active'),
  ('00000000-0000-4000-8000-0000000049b4', 'مشاهد', 'mk-view.dev@ibtekr.local', '01000049b04', 'viewer', 'active'),
  ('00000000-0000-4000-8000-0000000049b5', 'موقوف', 'mk-off.dev@ibtekr.local', '01000049b05', 'ops', 'suspended');

create temp table mk_ids (k text primary key, cid uuid, pid bigint) on commit drop;
grant all on mk_ids to authenticated;

-- ================================================================ the permissions (decision 6)

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000049b2","role":"authenticated"}', true);
do $$
begin
  if (public.has_perm('marketing.view'), public.has_perm('marketing.create'), public.has_perm('marketing.publish')) is distinct from ('F', 'F', 'F') then
    raise exception 'case ops marketing.* = F/F/F failed';
  end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000049b3","role":"authenticated"}', true);
do $$
begin
  if (public.has_perm('marketing.view'), public.has_perm('marketing.create'), public.has_perm('marketing.publish')) is distinct from ('N', 'N', 'N') then
    raise exception 'case cs marketing.* = N/N/N failed';
  end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000049b4","role":"authenticated"}', true);
do $$ begin if public.has_perm('marketing.view') <> 'N' then raise exception 'case viewer marketing.view = N failed'; end if; end $$;

-- ================================================================ the campaigns (ops)

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000049b2","role":"authenticated"}', true);
with c as (insert into public.mkt_campaigns (name, goal, step, state) values ('كولكشن الشتا', 'منتج جديد', 1, '{"w":{"idea":"كولكشن الشتا"}}') returning id)
insert into mk_ids (k, cid) select 'c1', id from c;
with c as (insert into public.mkt_campaigns (name) values ('تانية') returning id)
insert into mk_ids (k, cid) select 'c2', id from c;
do $$
declare v public.mkt_campaigns;
begin
  select * into v from public.mkt_campaigns where id = (select cid from mk_ids where k = 'c1');
  if v.created_by <> '00000000-0000-4000-8000-0000000049b2' or v.scheduled_at is not null or v.archived_at is not null or v.step <> 1 then
    raise exception 'case a new campaign is the member''s, not scheduled, step 1 failed';
  end if;
  update public.mkt_campaigns set step = 2, state = '{"w":{"idea":"كولكشن الشتا"},"pieces":[{"id":"P1"}]}' where id = (select cid from mk_ids where k = 'c1');
  select * into v from public.mkt_campaigns where id = (select cid from mk_ids where k = 'c1');
  if v.step <> 2 or v.state -> 'pieces' is null or v.updated_by <> '00000000-0000-4000-8000-0000000049b2' then raise exception 'case the member saves the state and the step failed'; end if;
  begin update public.mkt_campaigns set scheduled_at = now(); raise exception 'case no direct scheduled_at failed';
  exception when insufficient_privilege then null; end;
  begin insert into public.mkt_campaigns (name, scheduled_at) values ('x', now()); raise exception 'case no scheduled_at on insert failed';
  exception when insufficient_privilege then null; end;
  begin update public.mkt_campaigns set step = 5 where id = (select cid from mk_ids where k = 'c1'); raise exception 'case a step over 4 is refused failed';
  exception when check_violation then null; end;
  begin delete from public.mkt_campaigns; raise exception 'case no delete failed';
  exception when insufficient_privilege then null; end;
  if not public.mkt_campaign_open((select cid from mk_ids where k = 'c1')::text) or public.mkt_campaign_open('templates') then
    raise exception 'case mkt_campaign_open (an open campaign id only) failed';
  end if;
end $$;

-- cs reads nothing and writes nothing
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000049b3","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.mkt_campaigns) <> 0 or (select count(*) from public.mkt_posts) <> 0 or (select count(*) from public.mkt_templates) <> 0 then
    raise exception 'case cs reads no campaign / post / template failed';
  end if;
  begin insert into public.mkt_campaigns (name) values ('من خدمة العملاء'); raise exception 'case cs inserts no campaign failed';
  exception when insufficient_privilege then null; end;
  begin perform public.mkt_schedule((select cid from mk_ids where k = 'c1'), '[]'); raise exception 'case cs schedules nothing failed';
  exception when insufficient_privilege then null; end;
  if public.mkt_credits() is not null then raise exception 'case cs reads no wallet failed'; end if;
end $$;

-- ================================================================ the templates (ops)

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000049b2","role":"authenticated"}', true);
with t as (insert into public.mkt_templates (name, kind, image, descr) values ('منتج على كريمي', 'post', 'templates/a1.png', 'المنتج في النص') returning id)
insert into mk_ids (k, cid) select 't1', id from t;
do $$
declare v public.mkt_templates; n int;
begin
  select * into v from public.mkt_templates where id = (select cid from mk_ids where k = 't1');
  if v.used <> 0 or v.created_by <> '00000000-0000-4000-8000-0000000049b2' then raise exception 'case a new template (used 0, the member''s) failed'; end if;
  n := public.mkt_template_used((select cid from mk_ids where k = 't1'));
  if n <> 1 then raise exception 'case mkt_template_used counts failed'; end if;
  begin update public.mkt_templates set used = 9; raise exception 'case no direct used failed';
  exception when insufficient_privilege then null; end;
  begin insert into public.mkt_templates (name, kind, image) values ('x', 'post', '../evil.png'); raise exception 'case a template image outside templates/ is refused failed';
  exception when check_violation then null; end;
  update public.mkt_templates set deleted_at = now() where id = (select cid from mk_ids where k = 't1');
  select * into v from public.mkt_templates where id = (select cid from mk_ids where k = 't1');
  if v.deleted_at is null or v.deleted_by <> '00000000-0000-4000-8000-0000000049b2' then raise exception 'case «حذف» marks the template failed'; end if;
  update public.mkt_templates set name = 'بعد الحذف' where id = (select cid from mk_ids where k = 't1');
  if (select name from public.mkt_templates where id = (select cid from mk_ids where k = 't1')) <> 'منتج على كريمي' then raise exception 'case a deleted template takes no change failed'; end if;
  begin perform public.mkt_template_used((select cid from mk_ids where k = 't1')); raise exception 'case a deleted template is not counted failed';
  exception when no_data_found then null; end;
end $$;

-- ================================================================ the schedule (ops)

do $$
declare c uuid := (select cid from mk_ids where k = 'c1'); c2 uuid := (select cid from mk_ids where k = 'c2'); d text := (public.hr_today() + 2)::text; n int;
begin
  n := public.mkt_schedule(c, jsonb_build_array(
    jsonb_build_object('piece', 'P1', 'kind', 'بوست', 'name', 'دفا الشتا', 'caption', E'كولكشن الشتا\nوصل', 'tags', '#إبتكر', 'images', jsonb_build_array(c::text || '/gen-P1-a.png'), 'platform', 'فيسبوك', 'day', d, 'time', '19:00'),
    jsonb_build_object('piece', 'P1', 'kind', 'بوست', 'name', 'دفا الشتا', 'caption', 'كولكشن الشتا', 'images', jsonb_build_array(c::text || '/gen-P1-a.png'), 'platform', 'انستجرام', 'day', d, 'time', '20:00')));
  if n <> 2 then raise exception 'case mkt_schedule makes a row per piece × platform failed: %', n; end if;
  if (select count(*) from public.mkt_posts where campaign_id = c and status = 'مجدول') <> 2 then raise exception 'case the rows are «مجدول» failed'; end if;
  if (select caption from public.mkt_posts where campaign_id = c and platform = 'فيسبوك') <> E'كولكشن الشتا\nوصل'
     or (select caption_orig from public.mkt_posts where campaign_id = c and platform = 'فيسبوك') <> E'كولكشن الشتا\nوصل' then
    raise exception 'case the caption keeps its new line and its original failed';
  end if;
  if (select scheduled_at from public.mkt_campaigns where id = c) is null or (select step from public.mkt_campaigns where id = c) <> 4 then
    raise exception 'case the campaign is scheduled at step 4 failed';
  end if;
  insert into mk_ids (k, pid) select 'fb', id from public.mkt_posts where campaign_id = c and platform = 'فيسبوك';
  insert into mk_ids (k, pid) select 'ig', id from public.mkt_posts where campaign_id = c and platform = 'انستجرام';
  -- the refusals
  begin perform public.mkt_schedule(c, jsonb_build_array(jsonb_build_object('piece', 'P1', 'kind', 'بوست', 'name', 'x', 'platform', 'X', 'day', d, 'time', '19:00')));
    raise exception 'case an unknown platform is refused failed'; exception when invalid_parameter_value then null; end;
  begin perform public.mkt_schedule(c, jsonb_build_array(jsonb_build_object('piece', 'P1', 'kind', 'بوست', 'name', 'x', 'platform', 'فيسبوك', 'day', (public.hr_today() - 1)::text, 'time', '19:00')));
    raise exception 'case a past day is refused failed'; exception when invalid_parameter_value then null; end;
  begin perform public.mkt_schedule(c, jsonb_build_array(jsonb_build_object('piece', 'P1', 'kind', 'بوست', 'name', 'x', 'platform', 'فيسبوك', 'day', public.hr_today()::text, 'time', '00:00')));
    raise exception 'case a past hour today is refused failed'; exception when invalid_parameter_value then null; end;
  begin perform public.mkt_schedule(c, jsonb_build_array(jsonb_build_object('piece', 'P1', 'kind', 'بوست', 'name', 'x', 'platform', 'فيسبوك', 'day', d, 'time', '19:00', 'images', jsonb_build_array(c2::text || '/gen.png'))));
    raise exception 'case an image of another campaign is refused failed'; exception when invalid_parameter_value then null; end;
  begin perform public.mkt_schedule(c, jsonb_build_array(jsonb_build_object('piece', 'P1', 'kind', 'بوست', 'name', 'x', 'platform', 'فيسبوك', 'day', d, 'time', '19:00', 'images', jsonb_build_array(c::text || '/../x.png'))));
    raise exception 'case a path out of the folder is refused failed'; exception when invalid_parameter_value then null; end;
  begin perform public.mkt_schedule(c, jsonb_build_array(
      jsonb_build_object('piece', 'P1', 'kind', 'بوست', 'name', 'x', 'platform', 'فيسبوك', 'day', d, 'time', '19:00'),
      jsonb_build_object('piece', 'P1', 'kind', 'بوست', 'name', 'x', 'platform', 'فيسبوك', 'day', d, 'time', '20:00')));
    raise exception 'case a twice-listed piece and platform is refused failed'; exception when invalid_parameter_value then null; end;
  begin perform public.mkt_schedule(c, jsonb_build_array(jsonb_build_object('piece', 'P1', 'kind', 'بوست', 'name', 'x', 'caption', repeat('ك', 2201), 'platform', 'فيسبوك', 'day', d, 'time', '19:00')));
    raise exception 'case a caption over 2200 is refused failed'; exception when invalid_parameter_value then null; end;
  begin perform public.mkt_schedule(gen_random_uuid(), jsonb_build_array(jsonb_build_object('piece', 'P1')));
    raise exception 'case an unknown campaign is not found failed'; exception when no_data_found then null; end;
  -- no direct write on the log
  begin insert into public.mkt_posts (kind, name, platform, day, time) values ('بوست', 'x', 'فيسبوك', current_date, '19:00'); raise exception 'case no direct post insert failed';
  exception when insufficient_privilege then null; end;
  begin update public.mkt_posts set status = 'اتنشر'; raise exception 'case no direct post update failed';
  exception when insufficient_privilege then null; end;
end $$;

-- ================================================================ the log's actions (ops)

do $$
declare fb bigint := (select pid from mk_ids where k = 'fb'); ig bigint := (select pid from mk_ids where k = 'ig'); d3 text := (public.hr_today() + 3)::text; s text;
begin
  s := public.mkt_post_act(fb, 'move', jsonb_build_object('day', d3, 'time', '21:00'));
  if s <> 'مجدول' or (select day::text || ' ' || time from public.mkt_posts where id = fb) <> d3 || ' 21:00' then raise exception 'case «أجّل» moves the post failed'; end if;
  begin perform public.mkt_post_act(fb, 'move', jsonb_build_object('day', d3, 'time', '21:00')); raise exception 'case the same time is refused failed';
  exception when invalid_parameter_value then null; end;
  begin perform public.mkt_post_act(fb, 'move', jsonb_build_object('day', (public.hr_today() - 1)::text, 'time', '21:00')); raise exception 'case a past day is refused failed';
  exception when invalid_parameter_value then null; end;
  perform public.mkt_post_act(fb, 'caption', jsonb_build_object('text', E'كابشن\nجديد'));
  if (select caption from public.mkt_posts where id = fb) <> E'كابشن\nجديد' or (select caption_orig from public.mkt_posts where id = fb) <> E'كولكشن الشتا\nوصل' then
    raise exception 'case the caption changes and its original stays failed';
  end if;
  begin perform public.mkt_post_act(fb, 'published', jsonb_build_object('url', 'javascript:alert(1)')); raise exception 'case a bad link is refused failed';
  exception when invalid_parameter_value then null; end;
  s := public.mkt_post_act(fb, 'published', jsonb_build_object('url', 'https://facebook.com/ibtekr/posts/1'));
  if s <> 'اتنشر' or (select published_by from public.mkt_posts where id = fb) <> '00000000-0000-4000-8000-0000000049b2' then raise exception 'case «علّمه اتنشر» failed'; end if;
  begin perform public.mkt_post_act(fb, 'move', jsonb_build_object('day', d3, 'time', '22:00')); raise exception 'case a published post does not move failed';
  exception when invalid_parameter_value then null; end;
  begin perform public.mkt_post_act(fb, 'caption', jsonb_build_object('text', 'x')); raise exception 'case a published post keeps its caption failed';
  exception when invalid_parameter_value then null; end;
  begin perform public.mkt_post_act(fb, 'nope', '{}'); raise exception 'case an unknown action is refused failed';
  exception when invalid_parameter_value then null; end;
end $$;

-- confirming again: the published one stays, the waiting one of a removed platform is deleted, the new one is added
do $$
declare c uuid := (select cid from mk_ids where k = 'c1'); d text := (public.hr_today() + 2)::text; n int;
begin
  n := public.mkt_schedule(c, jsonb_build_array(
    jsonb_build_object('piece', 'P1', 'kind', 'بوست', 'name', 'تاني', 'caption', 'بعد التعديل', 'platform', 'فيسبوك', 'day', d, 'time', '18:00'),
    jsonb_build_object('piece', 'P2', 'kind', 'بوست', 'name', 'بوست 2', 'platform', 'انستجرام', 'day', d, 'time', '18:00')));
  if n <> 1 then raise exception 'case confirming again leaves one waiting failed: %', n; end if;
  if (select status || '|' || caption from public.mkt_posts where id = (select pid from mk_ids where k = 'fb')) <> 'اتنشر|كابشن' || E'\n' || 'جديد' then
    raise exception 'case a published post stays as it is failed';
  end if;
  if (select status from public.mkt_posts where id = (select pid from mk_ids where k = 'ig')) <> 'اتحذف' then raise exception 'case the removed platform''s waiting post is deleted failed'; end if;
  if (select count(*) from public.mkt_posts where campaign_id = c and piece = 'P2' and status = 'مجدول') <> 1 then raise exception 'case the new piece is added failed'; end if;
end $$;

-- delete: a published one is marked (was_live), a waiting one won't be posted
do $$
declare fb bigint := (select pid from mk_ids where k = 'fb'); p2 bigint;
begin
  select id into p2 from public.mkt_posts where campaign_id = (select cid from mk_ids where k = 'c1') and piece = 'P2';
  perform public.mkt_post_act(fb, 'delete', '{}');
  perform public.mkt_post_act(p2, 'delete', '{}');
  if (select status || '|' || was_live::text from public.mkt_posts where id = fb) <> 'اتحذف|true'
     or (select status || '|' || was_live::text from public.mkt_posts where id = p2) <> 'اتحذف|false' then
    raise exception 'case delete marks the published one live and the waiting one not failed';
  end if;
  begin perform public.mkt_post_act(fb, 'delete', '{}'); raise exception 'case a deleted post is not deleted again failed';
  exception when invalid_parameter_value then null; end;
end $$;

-- the wallet: the cap of the settings row and the month's credits
do $$
declare w jsonb;
begin
  w := public.mkt_credits();
  if w is null or not (w ? 'cap') or not (w ? 'used') then raise exception 'case ops reads the wallet { cap, used } failed: %', w; end if;
end $$;

-- archive: «حذف» marks the campaign; an archived one takes no change and no schedule
do $$
declare c uuid := (select cid from mk_ids where k = 'c2'); v public.mkt_campaigns;
begin
  update public.mkt_campaigns set archived_at = '2000-01-01' where id = c;
  select * into v from public.mkt_campaigns where id = c;
  if v.archived_at is null or v.archived_at < now() - interval '1 minute' or v.archived_by <> '00000000-0000-4000-8000-0000000049b2' then
    raise exception 'case «حذف» archives with the server''s time and the member failed';
  end if;
  update public.mkt_campaigns set name = 'بعد الحذف' where id = c;
  if (select name from public.mkt_campaigns where id = c) <> 'تانية' then raise exception 'case an archived campaign takes no change failed'; end if;
  begin perform public.mkt_schedule(c, jsonb_build_array(jsonb_build_object('piece', 'P1'))); raise exception 'case an archived campaign is not scheduled failed';
  exception when no_data_found then null; end;
  if public.mkt_campaign_open(c::text) then raise exception 'case an archived campaign''s folder is closed failed'; end if;
end $$;

-- a suspended member reads nothing
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000049b5","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.mkt_campaigns) <> 0 or (select count(*) from public.mkt_posts) <> 0 then raise exception 'case a suspended member reads nothing failed'; end if;
end $$;

-- the admin reads everything
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000049b1","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.mkt_campaigns where id in (select cid from mk_ids)) <> 2 then raise exception 'case the admin reads the campaigns failed'; end if;
end $$;

-- ai_runs takes the marketing runs (the server writes them)
reset role;
do $$
begin
  insert into public.ai_runs (created_by, action, source, label, status) values ('00000000-0000-4000-8000-0000000049b2', 'marketing', 'campaign', 'بوست 1', 'ok');
  insert into public.ai_runs (created_by, action, source, label, status, credits) values ('00000000-0000-4000-8000-0000000049b2', 'image', 'campaign', 'بوست 1', 'ok', 75);
  insert into public.ai_runs (created_by, action, source, label, status) values ('00000000-0000-4000-8000-0000000049b2', 'marketing', 'template', 'قالب', 'ok');
end $$;

do $$ begin raise notice 'rls_marketing: ok'; end $$;
rollback;
