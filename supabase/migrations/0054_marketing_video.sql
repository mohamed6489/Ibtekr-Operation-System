-- 0054_marketing_video — phase 9.5.5: AI video through the Magnific bridge (docs/superpowers/plans/2026-11-06-phase-9-5-marketing.md,
-- decisions 57–66).
-- * mkt_video_jobs — the asynchronous work of a campaign's video piece (a clip a scene, the voice-over, the music, the cut, the mix,
--   an upload): written by the server (ai-images), read with marketing.view; the Magnific link (url) is the server's only.
-- * bucket marketing takes MP4 / audio up to 200 MB (the finished video and its tracks).
-- * ai_runs.source «video» (a run row a generation call, credits 0 — the bridge account pays).
-- Re-runnable; no drop / delete / truncate of data.

create table if not exists public.mkt_video_jobs (
  id bigserial primary key,
  campaign_id uuid not null references public.mkt_campaigns on delete cascade,
  piece text not null check (piece ~ '^V[0-9]{1,2}$'),
  kind text not null check (kind in ('clip', 'voice', 'music', 'assemble', 'mix', 'upload')),
  scene int check (scene is null or (scene >= 0 and scene < 8)),
  creation_ref text check (creation_ref is null or creation_ref ~ '^[A-Za-z0-9_-]{1,80}$'),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  url text check (url is null or (url ~ '^https://' and char_length(url) <= 2000)),
  path text check (path is null or char_length(path) <= 300),
  bytes bigint check (bytes is null or bytes >= 0),
  duration numeric check (duration is null or duration >= 0),
  error text check (error is null or char_length(error) <= 200),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 4000),
  created_by uuid not null references public.profiles,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists mkt_video_jobs_piece_idx on public.mkt_video_jobs (campaign_id, piece, created_at desc);
create index if not exists mkt_video_jobs_open_idx on public.mkt_video_jobs (status) where status in ('queued', 'running');

alter table public.mkt_video_jobs enable row level security;
drop policy if exists mkt_video_jobs_select on public.mkt_video_jobs;
create policy mkt_video_jobs_select on public.mkt_video_jobs for select to authenticated
  using ((select public.has_perm('marketing.view')) <> 'N');
revoke all on public.mkt_video_jobs from anon, authenticated;
grant select (id, campaign_id, piece, kind, scene, creation_ref, status, path, bytes, duration, error, data, created_by, created_at, updated_at, done_at) on public.mkt_video_jobs to authenticated;
grant all on public.mkt_video_jobs to service_role;
grant usage on sequence public.mkt_video_jobs_id_seq to service_role;

-- ai_runs: the video runs (decision 64)
alter table public.ai_runs drop constraint if exists ai_runs_source_check;
alter table public.ai_runs add constraint ai_runs_source_check
  check (source is null or source in ('data', 'image', 'product', 'studio', 'tool', 'edit', 'import', 'campaign', 'template', 'post', 'buyer', 'video'));

-- the bucket: video and audio, 200 MB (decision 58) — the policies of 0049 stay
do $storage$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') and to_regclass('storage.buckets') is not null then
    execute $s$update storage.buckets set file_size_limit = 209715200,
               allowed_mime_types = '{image/png,image/jpeg,image/webp,video/mp4,audio/mpeg,audio/mp4,audio/wav,audio/x-m4a}' where id = 'marketing'$s$;
  end if;
end $storage$;

-- ---------------------------------------------------------------- mkt_schedule: the reel is published too (decision 63)
-- As 0051, plus: how = 'publish' with kind «ريل» on Facebook / Instagram takes the assembled MP4 as the first file (the key frames may
-- follow it for the log's thumbnail); Instagram's text rule holds for it; the JPEG rule is for the image kinds only.
create or replace function public.mkt_schedule(p_campaign uuid, p_items jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  c public.mkt_campaigns; it jsonb; v_today date := public.hr_today(); v_now text := public.mkt_now();
  v_piece text; v_kind text; v_name text; v_caption text; v_tags text; v_images text[]; v_platform text; v_day date; v_time text; v_how text;
  v_keys text[] := '{}'; v_key text; v_row public.mkt_posts; v_n int;
begin
  if public.has_perm('marketing.publish') <> 'F' then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into c from public.mkt_campaigns where id = p_campaign for update;
  if not found or c.archived_at is not null then raise exception 'not found' using errcode = 'P0002'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 100 then
    raise exception 'invalid: items' using errcode = '22023';
  end if;
  for it in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(it) <> 'object' then raise exception 'invalid: items' using errcode = '22023'; end if;
    v_piece := it ->> 'piece';
    if v_piece is null or v_piece !~ '^[A-Z][0-9]{1,2}$' then raise exception 'invalid: piece' using errcode = '22023'; end if;
    v_kind := it ->> 'kind';
    if v_kind is null or v_kind not in ('بوست', 'كاروسيل', 'ريل', 'ستوري') then raise exception 'invalid: kind' using errcode = '22023'; end if;
    v_name := left(public.mkt_clean(it ->> 'name'), 200);
    if v_name = '' then v_name := v_kind; end if;
    v_caption := public.mkt_clean(it ->> 'caption', true);
    if char_length(v_caption) > 2200 then raise exception 'invalid: caption' using errcode = '22023'; end if;
    v_tags := public.mkt_clean(it ->> 'tags');
    if char_length(v_tags) > 300 then raise exception 'invalid: tags' using errcode = '22023'; end if;
    if jsonb_typeof(coalesce(it -> 'images', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(it -> 'images', '[]'::jsonb)) > 11 then
      raise exception 'invalid: images' using errcode = '22023';
    end if;
    select coalesce(array_agg(x), '{}') into v_images from jsonb_array_elements_text(coalesce(it -> 'images', '[]'::jsonb)) as x;
    if exists (select 1 from unnest(v_images) p where p !~ ('^' || p_campaign::text || '/[A-Za-z0-9._-]{1,120}$')) then
      raise exception 'invalid: images' using errcode = '22023';
    end if;
    v_platform := it ->> 'platform';
    if v_platform is null or v_platform not in ('انستجرام', 'فيسبوك', 'تيك توك') then raise exception 'invalid: platform' using errcode = '22023'; end if;
    begin v_day := (it ->> 'day')::date; exception when others then v_day := null; end;
    if v_day is null or v_day < v_today or v_day > v_today + 365 then raise exception 'invalid: day' using errcode = '22023'; end if;
    v_time := it ->> 'time';
    if v_time is null or v_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or (v_day = v_today and v_time <= v_now) then
      raise exception 'invalid: time' using errcode = '22023';
    end if;
    v_how := coalesce(it ->> 'how', 'download');
    if v_how not in ('download', 'publish') then raise exception 'invalid: how' using errcode = '22023'; end if;
    if v_how = 'publish' then
      if v_platform not in ('انستجرام', 'فيسبوك') or v_kind not in ('بوست', 'كاروسيل', 'ستوري', 'ريل') then raise exception 'invalid: how' using errcode = '22023'; end if;
      if v_kind = 'ريل' then -- 9.5.5 (decision 63): the assembled MP4 first, its key frames may follow (the log's thumbnail)
        if cardinality(v_images) = 0 or v_images[1] !~* '\.mp4$' then raise exception 'invalid: images' using errcode = '22023'; end if;
      else
        if cardinality(v_images) = 0 or cardinality(v_images) > 10 or (v_kind = 'كاروسيل' and cardinality(v_images) < 2)
           or (v_kind <> 'كاروسيل' and cardinality(v_images) <> 1) then
          raise exception 'invalid: images' using errcode = '22023';
        end if;
        if v_platform = 'انستجرام' and exists (select 1 from unnest(v_images) p where p !~* '\.jpe?g$') then raise exception 'invalid: images' using errcode = '22023'; end if;
      end if;
      if v_platform = 'انستجرام' and v_kind <> 'ستوري' and char_length(v_caption) + (case when v_tags = '' then 0 else char_length(v_tags) + 2 end) > 2200 then
        raise exception 'invalid: caption' using errcode = '22023';
      end if;
    end if;
    v_key := v_piece || '|' || v_platform;
    if v_key = any (v_keys) then raise exception 'invalid: items' using errcode = '22023'; end if;
    v_keys := v_keys || v_key;
    select * into v_row from public.mkt_posts p
      where p.campaign_id = p_campaign and p.piece = v_piece and p.platform = v_platform and p.status <> 'اتحذف' for update;
    if found then
      if v_row.status in ('مجدول', 'فشل') and not public.mkt_busy(v_row) then
        update public.mkt_posts set kind = v_kind, name = v_name, caption = v_caption, caption_orig = v_caption, tags = v_tags, images = v_images,
            day = v_day, time = v_time, how = v_how, status = 'مجدول', error = null, work = null, updated_by = auth.uid(), updated_at = now()
          where id = v_row.id;
      end if; -- a published one, or one being published now, stays as it is
    else
      insert into public.mkt_posts (campaign_id, piece, kind, name, caption, caption_orig, tags, images, platform, day, time, how, status, created_by, updated_by)
      values (p_campaign, v_piece, v_kind, v_name, v_caption, v_caption, v_tags, v_images, v_platform, v_day, v_time, v_how, 'مجدول', auth.uid(), auth.uid());
    end if;
  end loop;
  update public.mkt_posts p set status = 'اتحذف', deleted_at = now(), deleted_by = auth.uid(), updated_by = auth.uid(), updated_at = now()
    where p.campaign_id = p_campaign and p.status in ('مجدول', 'فشل') and not public.mkt_busy(p) and not ((p.piece || '|' || p.platform) = any (v_keys));
  update public.mkt_campaigns set scheduled_at = now(), step = 4 where id = p_campaign;
  select count(*) into v_n from public.mkt_posts where campaign_id = p_campaign and status in ('مجدول', 'فشل');
  return v_n;
end $$;
