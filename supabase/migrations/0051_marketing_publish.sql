-- 0051_marketing_publish — phase 9.5.2: auto-publishing to Facebook and Instagram, the posts' numbers and the platform's own posts
-- (docs/superpowers/plans/2026-11-06-phase-9-5-marketing.md, decisions 29–39). The Edge Function mkt-publish does the publishing;
-- this is what it needs in the database:
-- * mkt_posts: src (system | platform — «من المنصة مباشرة»), external_id (the post's id on the platform), thumb (a platform post's
--   picture), the numbers (views, reach, likes, comments, shares, saves, eng + stats_at), error (a failed post's code), attempts,
--   claimed_at and work (the publishing in progress — the server's). Members read them; only the server writes them.
-- * mkt_schedule: an item may say how = 'publish' (Facebook / Instagram, a post, a carousel or a story, 1–10 images; Instagram's
--   images JPEG and its text with the tags ≤ 2200); a row being published is left as it is.
-- * mkt_post_act: a row being published (claimed in the last five minutes) takes no move / caption / mark / delete ('invalid: busy');
--   a move clears a failure's code; Instagram's text limit on a caption of a row to publish.
-- * mkt_publish_claim(p_limit, p_id) — the server's: the due rows to publish (how publish, «مجدول», Cairo's day and hour come) or one
--   row for «انشر دلوقتي» (مجدول / فشل), claimed (for update skip locked) so two runs never take the same row; a row a run left in its
--   last step is failed `uncertain` (it may be live — never published twice).
-- * mkt_stats_put(p_rows) — the server's: the numbers of many posts in one statement (one live broadcast).
-- * settings «marketing».autopublish — the master switch (decision 31), the admin's (0002's policies); no row = off.
-- * The crons (guarded like 0040, the sync secret of 0008): mkt-publish-due every minute — only when a post is due and the switch is
--   on —, mkt-publish-stats every 30 minutes.
-- Re-runnable; no drop / delete / truncate of data.

alter table public.mkt_posts add column if not exists src text not null default 'system';
alter table public.mkt_posts add column if not exists external_id text;
alter table public.mkt_posts add column if not exists thumb text;
alter table public.mkt_posts add column if not exists views int;
alter table public.mkt_posts add column if not exists reach int;
alter table public.mkt_posts add column if not exists likes int;
alter table public.mkt_posts add column if not exists comments int;
alter table public.mkt_posts add column if not exists shares int;
alter table public.mkt_posts add column if not exists saves int;
alter table public.mkt_posts add column if not exists eng int;
alter table public.mkt_posts add column if not exists stats_at timestamptz;
alter table public.mkt_posts add column if not exists error text;
alter table public.mkt_posts add column if not exists attempts int not null default 0;
alter table public.mkt_posts add column if not exists claimed_at timestamptz;
alter table public.mkt_posts add column if not exists work jsonb;

alter table public.mkt_posts drop constraint if exists mkt_posts_src_check;
alter table public.mkt_posts add constraint mkt_posts_src_check check (src in ('system', 'platform'));
alter table public.mkt_posts drop constraint if exists mkt_posts_external_id_check;
alter table public.mkt_posts add constraint mkt_posts_external_id_check check (external_id is null or external_id ~ '^[0-9_]{1,80}$');
alter table public.mkt_posts drop constraint if exists mkt_posts_thumb_check;
alter table public.mkt_posts add constraint mkt_posts_thumb_check check (thumb is null or (thumb ~ '^https://' and char_length(thumb) <= 2000));
alter table public.mkt_posts drop constraint if exists mkt_posts_numbers_check;
alter table public.mkt_posts add constraint mkt_posts_numbers_check
  check (coalesce(views, 0) >= 0 and coalesce(reach, 0) >= 0 and coalesce(likes, 0) >= 0 and coalesce(comments, 0) >= 0
         and coalesce(shares, 0) >= 0 and coalesce(saves, 0) >= 0 and coalesce(eng, 0) >= 0 and attempts >= 0);
alter table public.mkt_posts drop constraint if exists mkt_posts_error_check;
alter table public.mkt_posts add constraint mkt_posts_error_check check (error is null or error ~ '^[a-z0-9_:]{1,60}$');
alter table public.mkt_posts drop constraint if exists mkt_posts_work_check;
alter table public.mkt_posts add constraint mkt_posts_work_check check (work is null or (jsonb_typeof(work) = 'object' and octet_length(work::text) <= 4000));
-- a platform row: no campaign, the server's
alter table public.mkt_posts drop constraint if exists mkt_posts_platform_row_check;
alter table public.mkt_posts add constraint mkt_posts_platform_row_check check (src = 'system' or (campaign_id is null and piece is null));

-- one row per post on a platform (NULLs distinct: the rows not published yet)
create unique index if not exists mkt_posts_external_uq on public.mkt_posts (platform, external_id);
create index if not exists mkt_posts_due_idx on public.mkt_posts (day, time) where status = 'مجدول' and how = 'publish';

-- the master switch (decision 31) as the server reads it (cron and function): settings «marketing».autopublish — no row (as
-- shipped: the admin's switch writes it, like the other sections) = off
create or replace function public.mkt_autopublish() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (s.data ->> 'autopublish') = 'true' from public.settings s where s.section = 'marketing'), false)
$$;

-- a row the server is publishing now (claimed in the last five minutes)
create or replace function public.mkt_busy(p public.mkt_posts) returns boolean
language sql stable set search_path = public as $$ select p.claimed_at is not null and p.claimed_at > now() - interval '5 minutes' $$;

-- «تأكيد النشر» (decision 14, 9.5.2's how): as 0049, an item may also carry how = 'publish' | 'download' (default download).
-- Publish: Facebook / Instagram, a post or a story with one image or a carousel with 2–10, Instagram's images JPEG and its text
-- (caption + blank line + tags) ≤ 2200. A row being published right now is left as it is.
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
      if v_platform not in ('انستجرام', 'فيسبوك') or v_kind not in ('بوست', 'كاروسيل', 'ستوري') then raise exception 'invalid: how' using errcode = '22023'; end if;
      if cardinality(v_images) = 0 or cardinality(v_images) > 10 or (v_kind = 'كاروسيل' and cardinality(v_images) < 2)
         or (v_kind <> 'كاروسيل' and cardinality(v_images) <> 1) then
        raise exception 'invalid: images' using errcode = '22023';
      end if;
      if v_platform = 'انستجرام' then
        if exists (select 1 from unnest(v_images) p where p !~* '\.jpe?g$') then raise exception 'invalid: images' using errcode = '22023'; end if;
        if v_kind <> 'ستوري' and char_length(v_caption) + (case when v_tags = '' then 0 else char_length(v_tags) + 2 end) > 2200 then
          raise exception 'invalid: caption' using errcode = '22023';
        end if;
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

-- a post of the log (decision 15): as 0049, and a row being published takes nothing ('invalid: busy'); a move clears a failure's
-- code; Instagram's text limit on a caption of a row to publish
create or replace function public.mkt_post_act(p_id bigint, p_action text, p_args jsonb default '{}'::jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  v public.mkt_posts; a jsonb := coalesce(p_args, '{}'::jsonb); v_today date := public.hr_today(); v_now text := public.mkt_now();
  v_day date; v_time text; v_text text; v_url text;
begin
  if jsonb_typeof(a) <> 'object' then raise exception 'invalid: args' using errcode = '22023'; end if;
  if public.has_perm('marketing.publish') <> 'F' then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v from public.mkt_posts where id = p_id for update;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  if public.mkt_busy(v) then raise exception 'invalid: busy' using errcode = '22023'; end if;
  if p_action = 'move' then
    if v.status not in ('مجدول', 'فشل') then raise exception 'invalid: status' using errcode = '22023'; end if;
    begin v_day := (a ->> 'day')::date; exception when others then v_day := null; end;
    if v_day is null or v_day < v_today or v_day > v_today + 365 then raise exception 'invalid: day' using errcode = '22023'; end if;
    v_time := a ->> 'time';
    if v_time is null or v_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or (v_day = v_today and v_time <= v_now) then
      raise exception 'invalid: time' using errcode = '22023';
    end if;
    if v_day = v.day and v_time = v.time then raise exception 'invalid: same' using errcode = '22023'; end if;
    update public.mkt_posts set day = v_day, time = v_time, status = 'مجدول', error = null, work = null, updated_by = auth.uid(), updated_at = now() where id = p_id;
    return 'مجدول';
  elsif p_action = 'caption' then
    if v.status not in ('مجدول', 'فشل') then raise exception 'invalid: status' using errcode = '22023'; end if;
    v_text := public.mkt_clean(a ->> 'text', true);
    if char_length(v_text) > 2200 then raise exception 'invalid: caption' using errcode = '22023'; end if;
    if v.how = 'publish' and v.platform = 'انستجرام' and v.kind <> 'ستوري'
       and char_length(v_text) + (case when v.tags = '' then 0 else char_length(v.tags) + 2 end) > 2200 then
      raise exception 'invalid: caption' using errcode = '22023';
    end if;
    update public.mkt_posts set caption = v_text, updated_by = auth.uid(), updated_at = now() where id = p_id;
    return v.status;
  elsif p_action = 'published' then
    if v.status not in ('مجدول', 'فشل') then raise exception 'invalid: status' using errcode = '22023'; end if;
    v_url := nullif(btrim(coalesce(a ->> 'url', '')), '');
    if v_url is not null and (v_url !~ '^https://[^\s<>"]+$' or char_length(v_url) > 500) then raise exception 'invalid: url' using errcode = '22023'; end if;
    update public.mkt_posts set status = 'اتنشر', published_at = now(), published_by = auth.uid(), post_url = v_url, error = null, work = null,
        updated_by = auth.uid(), updated_at = now()
      where id = p_id;
    return 'اتنشر';
  elsif p_action = 'delete' then
    if v.status not in ('مجدول', 'فشل', 'اتنشر') then raise exception 'invalid: status' using errcode = '22023'; end if;
    update public.mkt_posts set status = 'اتحذف', was_live = (v.status = 'اتنشر'), deleted_at = now(), deleted_by = auth.uid(), updated_by = auth.uid(), updated_at = now()
      where id = p_id;
    return 'اتحذف';
  end if;
  raise exception 'invalid: action' using errcode = '22023';
end $$;

-- the server's claim (decision 34): with p_id — «انشر دلوقتي» on one system row (مجدول / فشل, not being published; it becomes a publish
-- row, a failure's leftovers cleared); without — the due rows (how publish, «مجدول», Cairo's day and hour come), the oldest first, at
-- most p_limit (1–20). A row a run left in its last step (work.stage = publishing, claimed over five minutes ago) may be live: it is
-- failed `uncertain` instead of taken again. Every row taken gets claimed_at = now() and one more attempt.
create or replace function public.mkt_publish_claim(p_limit int default 5, p_id bigint default null) returns setof public.mkt_posts
language plpgsql security definer set search_path = public as $$
begin
  update public.mkt_posts p set status = 'فشل', error = 'uncertain', claimed_at = null, updated_at = now()
    where p.src = 'system' and p.status = 'مجدول' and p.work ->> 'stage' = 'publishing' and p.claimed_at < now() - interval '5 minutes'
      and (p_id is null or p.id = p_id);
  if p_id is not null then
    return query
    update public.mkt_posts p set claimed_at = now(), attempts = p.attempts + 1, how = 'publish', error = null,
        work = case when p.status = 'فشل' then null else p.work end, status = 'مجدول'
      where p.id = p_id and p.src = 'system' and p.status in ('مجدول', 'فشل') and not public.mkt_busy(p)
      returning p.*;
    return;
  end if;
  return query
  update public.mkt_posts p set claimed_at = now(), attempts = p.attempts + 1
    where p.id in (
      select q.id from public.mkt_posts q
      where q.src = 'system' and q.status = 'مجدول' and q.how = 'publish'
        and (q.day + q.time::time) at time zone 'Africa/Cairo' <= now()
        and not public.mkt_busy(q)
      order by q.day, q.time, q.id
      limit greatest(1, least(coalesce(p_limit, 5), 20))
      for update skip locked)
    returning p.*;
end $$;

-- the server's numbers (decision 36): [{ id, views, reach, likes, comments, shares, saves, eng }] in one statement
create or replace function public.mkt_stats_put(p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then return 0; end if;
  -- a count is a whole number (capped at int's top); anything else (missing, negative, text) keeps what the row has. The cap is
  -- taken once here: least() skips a NULL, so a missing count must stay NULL before coalesce
  with r as (
    select (x ->> 'id')::bigint as id,
      case when (x ->> 'views') ~ '^[0-9]{1,12}$' then least((x ->> 'views')::bigint, 2147483647)::int end as views,
      case when (x ->> 'reach') ~ '^[0-9]{1,12}$' then least((x ->> 'reach')::bigint, 2147483647)::int end as reach,
      case when (x ->> 'likes') ~ '^[0-9]{1,12}$' then least((x ->> 'likes')::bigint, 2147483647)::int end as likes,
      case when (x ->> 'comments') ~ '^[0-9]{1,12}$' then least((x ->> 'comments')::bigint, 2147483647)::int end as comments,
      case when (x ->> 'shares') ~ '^[0-9]{1,12}$' then least((x ->> 'shares')::bigint, 2147483647)::int end as shares,
      case when (x ->> 'saves') ~ '^[0-9]{1,12}$' then least((x ->> 'saves')::bigint, 2147483647)::int end as saves,
      case when (x ->> 'eng') ~ '^[0-9]{1,12}$' then least((x ->> 'eng')::bigint, 2147483647)::int end as eng
    from jsonb_array_elements(p_rows) x
    where jsonb_typeof(x) = 'object' and (x ->> 'id') ~ '^[0-9]{1,18}$'
  )
  update public.mkt_posts p set
      views = coalesce(r.views, p.views), reach = coalesce(r.reach, p.reach), likes = coalesce(r.likes, p.likes),
      comments = coalesce(r.comments, p.comments), shares = coalesce(r.shares, p.shares), saves = coalesce(r.saves, p.saves),
      eng = coalesce(r.eng, p.eng), stats_at = now()
    from r where p.id = r.id;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke execute on function public.mkt_autopublish(), public.mkt_busy(public.mkt_posts), public.mkt_publish_claim(int, bigint), public.mkt_stats_put(jsonb)
  from public, anon, authenticated;
grant execute on function public.mkt_autopublish(), public.mkt_busy(public.mkt_posts), public.mkt_publish_claim(int, bigint), public.mkt_stats_put(jsonb) to service_role;
revoke execute on function public.mkt_schedule(uuid, jsonb), public.mkt_post_act(bigint, text, jsonb) from public, anon;
grant execute on function public.mkt_schedule(uuid, jsonb), public.mkt_post_act(bigint, text, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------- the crons (guarded like 0040; the sync secret of 0008)

do $$
begin
  if to_regnamespace('cron') is null or to_regnamespace('net') is null or to_regclass('vault.decrypted_secrets') is null then
    raise notice '0051: pg_cron / pg_net / Vault not here — the publishing crons are not scheduled';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'mkt-publish-due') then perform cron.unschedule('mkt-publish-due'); end if;
  -- every minute, and only when a post is due and the switch is on (no call for nothing)
  perform cron.schedule('mkt-publish-due', '* * * * *', $cron$
    select net.http_post(
      url := 'https://fsynculhaupcktzkfkdd.supabase.co/functions/v1/mkt-publish',
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'X-Sync-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_secret')),
      body := '{"action":"due"}'::jsonb,
      timeout_milliseconds := 120000
    )
    where public.mkt_autopublish()
      and exists (select 1 from public.mkt_posts q where q.src = 'system' and q.status = 'مجدول' and q.how = 'publish'
                  and (q.day + q.time::time) at time zone 'Africa/Cairo' <= now())
  $cron$);
  if exists (select 1 from cron.job where jobname = 'mkt-publish-stats') then perform cron.unschedule('mkt-publish-stats'); end if;
  perform cron.schedule('mkt-publish-stats', '*/30 * * * *', $cron$
    select net.http_post(
      url := 'https://fsynculhaupcktzkfkdd.supabase.co/functions/v1/mkt-publish',
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'X-Sync-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_secret')),
      body := '{"action":"stats"}'::jsonb,
      timeout_milliseconds := 120000
    )
  $cron$);
end $$;
