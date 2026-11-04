-- 0041_cs_posts.sql — phase 6.2 decision 19: the post a comment is on (Facebook post / Instagram media).
--
-- The comments pull (0040) reads the latest posts with their comments; the same answer now carries each post's caption, link,
-- thumbnail, kind and date, kept here so a comments conversation shows which post it is on (a card at the top of the chat and
-- a line in the inbox list). The comment conversations' external_id is «<post id>:<commenter>», so the post's id is its prefix.
--
-- Notes for readers:
-- * Written by the server only (cs-channel with service_role: the pull every minute, and a webhook comment on a post not seen
--   yet). Members with cs.view ≠ N read it; nobody else.
-- * thumb is Meta's CDN link, signed and short-lived: the pull refreshes it while the post is among the latest ten; an older
--   post's picture may stop loading and the caption + link stay. caption is the first 300 characters, no more.

create table if not exists public.cs_posts (
  id text primary key check (id ~ '^[0-9_]{1,80}$'),
  platform text not null check (platform in ('facebook', 'instagram')),
  caption text check (caption is null or char_length(caption) <= 300),
  permalink text check (permalink is null or (permalink ~ '^https://' and char_length(permalink) <= 1000)),
  thumb text check (thumb is null or (thumb ~ '^https://' and char_length(thumb) <= 2000)),
  kind text check (kind is null or char_length(kind) <= 40),
  posted_at timestamptz,
  seen_at timestamptz not null default now()
);
alter table public.cs_posts enable row level security;
revoke all on public.cs_posts from anon, authenticated;
grant select on public.cs_posts to authenticated;
grant select, insert, update on public.cs_posts to service_role;

drop policy if exists cs_posts_read on public.cs_posts;
create policy cs_posts_read on public.cs_posts for select to authenticated using ((select public.has_perm('cs.view')) <> 'N');
