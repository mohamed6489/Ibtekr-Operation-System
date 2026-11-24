-- 0156 — the meeting of 23 Nov [#43] (docs/superpowers/plans/2026-11-23-meeting.md phase 8): the pictures in the marketing tabs.
-- The cause, read on the live data (24 Nov): the platform's posts and the ads keep Meta's CDN link of their picture, and those links
-- are signed for a few days (`oe=`) — every post's died on 23 Nov (never read again after its first pull), the ads' that Meta no longer
-- lists on 21 Nov. The server now keeps a copy in the bucket «marketing» the moment it reads a fresh link (_shared/meta-pin.js —
-- mkt-publish `stats`, mkt-ads `sync`): `thumb_path` = platform/<fb|ig>/<post>.<ext> · ads/<platform>/<ad>.<ext>, and the page shows the
-- copy by a signed link of ours (the bucket's select policy of 0049: marketing.view). The CDN link stays as the fallback.
-- Members read the columns with their tables (select granted in 0049 / 0052); only the server writes them. Re-runnable.

alter table public.mkt_posts add column if not exists thumb_path text
  check (thumb_path is null or thumb_path ~ '^platform/(fb|ig)/[A-Za-z0-9_-]{1,80}\.(jpg|png|webp)$');
alter table public.mkt_ad_objects add column if not exists thumb_path text
  check (thumb_path is null or thumb_path ~ '^ads/[a-z]{1,20}/[A-Za-z0-9_-]{1,80}\.(jpg|png|webp)$');
