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
