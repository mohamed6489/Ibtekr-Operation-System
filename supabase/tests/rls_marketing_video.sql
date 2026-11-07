-- RLS / permission tests for 0054_marketing_video (phase 9.5.5): the video jobs are the server's rows — read with marketing.view
-- without the Magnific link, never written by a member; the bucket takes video. Depends on 0001 … 0054. One transaction rolled back;
-- prints NOTICE 'rls_marketing_video: ok' only if every case passed. Live-safe.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000054a1', 'mv-adm.dev@ibtekr.local', '01000054a01'),
  ('00000000-0000-4000-8000-0000000054a2', 'mv-ops.dev@ibtekr.local', '01000054a02'),
  ('00000000-0000-4000-8000-0000000054a3', 'mv-cs.dev@ibtekr.local', '01000054a03');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u where u.email like 'mv-%.dev@ibtekr.local';
insert into public.profiles (id, name, email, phone, role_id, status) values
  ('00000000-0000-4000-8000-0000000054a1', 'أدمن الفيديو', 'mv-adm.dev@ibtekr.local', '01000054a01', 'admin', 'active'),
  ('00000000-0000-4000-8000-0000000054a2', 'محتوى الفيديو', 'mv-ops.dev@ibtekr.local', '01000054a02', 'ops', 'active'),
  ('00000000-0000-4000-8000-0000000054a3', 'خدمة عملاء', 'mv-cs.dev@ibtekr.local', '01000054a03', 'cs', 'active');

create temporary table mv_ids (k text primary key, cid uuid) on commit drop;
with c as (insert into public.mkt_campaigns (name, goal, step, state, created_by) values ('فيديو الشتا', 'منتج جديد', 2, '{"pieces":[{"id":"V1","kind":"فيديو"}]}', '00000000-0000-4000-8000-0000000054a2') returning id)
insert into mv_ids (k, cid) select 'c1', id from c;

-- the server's rows: a clip a scene, a voice, the mix (with the Magnific link and the stored path)
insert into public.mkt_video_jobs (campaign_id, piece, kind, scene, creation_ref, status, url, created_by, data) values
  ((select cid from mv_ids where k = 'c1'), 'V1', 'clip', 0, 'abc123', 'running', 'https://pikaso.cdnpk.net/x/one.mp4', '00000000-0000-4000-8000-0000000054a2', '{"model":"bytedance-seedance-pro-2.5","duration":5}'),
  ((select cid from mv_ids where k = 'c1'), 'V1', 'voice', null, 'vo1', 'done', 'https://pikaso.cdnpk.net/x/vo.mp3', '00000000-0000-4000-8000-0000000054a2', '{}');
update public.mkt_video_jobs set path = (select cid from mv_ids where k = 'c1') || '/vid-V1-vo-1.mp3', bytes = 12345, done_at = now() where kind = 'voice';
do $$ begin
  begin insert into public.mkt_video_jobs (campaign_id, piece, kind, scene, created_by) values ((select cid from mv_ids where k = 'c1'), 'V1', 'clip', 9, '00000000-0000-4000-8000-0000000054a2'); raise exception 'case scene under 8 failed';
  exception when check_violation then null; end;
  begin insert into public.mkt_video_jobs (campaign_id, piece, kind, created_by) values ((select cid from mv_ids where k = 'c1'), 'P1', 'clip', '00000000-0000-4000-8000-0000000054a2'); raise exception 'case a video piece id failed';
  exception when check_violation then null; end;
  if (select pg_get_constraintdef(oid) from pg_constraint where conname = 'ai_runs_source_check') not like '%''video''%' then raise exception 'case ai_runs source video failed'; end if;
end $$;

set local role authenticated;
-- ops (marketing.view F): reads the jobs without the link; never writes
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000054a2","role":"authenticated"}', true);
do $$ begin
  if (select count(*) from public.mkt_video_jobs) <> 2 then raise exception 'case ops reads the jobs failed'; end if;
  if (select (kind, status, scene, creation_ref, path is not null)::text from public.mkt_video_jobs where kind = 'voice') <> ('voice', 'done', null::int, 'vo1', true)::text then raise exception 'case the job columns failed'; end if;
  begin perform url from public.mkt_video_jobs; raise exception 'case the link is the server''s failed';
  exception when insufficient_privilege then null; end;
  begin insert into public.mkt_video_jobs (campaign_id, piece, kind, created_by) values ((select cid from mv_ids where k = 'c1'), 'V1', 'music', '00000000-0000-4000-8000-0000000054a2'); raise exception 'case a member writes a job failed';
  exception when insufficient_privilege then null; end;
  begin update public.mkt_video_jobs set status = 'done' where kind = 'clip'; raise exception 'case a member updates a job failed';
  exception when insufficient_privilege then null; end;
  begin delete from public.mkt_video_jobs where kind = 'clip'; raise exception 'case a member deletes a job failed';
  exception when insufficient_privilege then null; end;
end $$;
-- the admin reads them too (never the link)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000054a1","role":"authenticated"}', true);
do $$ begin
  if (select count(*) from public.mkt_video_jobs where status = 'running') <> 1 then raise exception 'case the admin reads the jobs failed'; end if;
  begin perform url from public.mkt_video_jobs; raise exception 'case the link is the server''s (admin) failed';
  exception when insufficient_privilege then null; end;
end $$;
-- cs (marketing N): nothing
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000054a3","role":"authenticated"}', true);
do $$ begin
  if (select count(*) from public.mkt_video_jobs) <> 0 then raise exception 'case cs sees nothing failed'; end if;
end $$;
-- anon: nothing
set local role anon;
do $$ begin
  begin perform count(*) from public.mkt_video_jobs; raise exception 'case anon on mkt_video_jobs failed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- the bucket (where storage is here)
do $$ begin
  if to_regclass('storage.buckets') is not null then
    if not exists (select 1 from storage.buckets where id = 'marketing' and file_size_limit = 209715200 and 'video/mp4' = any (allowed_mime_types) and 'audio/mpeg' = any (allowed_mime_types)) then raise exception 'case the bucket takes video failed'; end if;
  end if;
end $$;

do $$ begin raise notice 'rls_marketing_video: ok'; end $$;
rollback;
