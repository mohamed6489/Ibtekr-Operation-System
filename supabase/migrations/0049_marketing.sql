-- 0049_marketing — phase 9.5.1 «التسويق» on our data (docs/superpowers/plans/2026-11-06-phase-9-5-marketing.md). The v5's
-- campaign (four steps), its schedule and publishing log, and the design templates:
-- * Permissions (decision 6 — the v5's matrix has no marketing row): marketing.view (the page, reading) · marketing.create
--   (campaigns, the AI generation with credits and the AI writing, templates) · marketing.publish (confirming the schedule, moving a
--   post, a scheduled post's caption, «علّمه اتنشر», deleting). Admin and ops (content and photography) F/F/F, everyone else N.
-- * mkt_campaigns (decision 7): the campaign's whole state as the v5 keeps it (the pieces and their fields, the bucket paths of their
--   images, the approvals, the times) in `state`; members with marketing.create F write name / goal / step / state and archive it
--   («حذف» = archived_at — an archived campaign takes no change); scheduled_at is the server's (mkt_schedule).
-- * mkt_posts — the schedule and the publishing log: a row per piece × platform. No direct write: mkt_schedule(p_campaign, p_items)
--   and mkt_post_act(p_id, p_action, p_args) (move / caption / published / delete) with the time and status rules, Cairo's day and
--   hour. Publishing is a download in 9.5.1 (decision 14): «اتنشر» is marked by a member («علّمه اتنشر»).
-- * mkt_templates — the design templates (name, kind, image, description, times used); «حذف» = deleted_at; «اتستخدم» through
--   mkt_template_used.
-- * mkt_credits() — the month's image credit cap (settings «ai» image_monthly_credits) and what the whole team spent this Cairo month
--   (decision 11), for marketing.create F.
-- * Storage: the private bucket «marketing» — <campaign id>/… (the member's uploads and the server's generated images) and
--   templates/…; read with marketing.view ≠ N, upload with marketing.create F (into an open campaign's folder or templates/).
-- * ai_runs: action «marketing» (the AI writing), sources «campaign» / «template» / «post» (decisions 8–10).
-- * Live: every write on the three tables sends one private Realtime broadcast «marketing» / «changed» with { at } only.
-- Re-runnable; no drop / delete / truncate of data.

update public.roles r set permissions = r.permissions || d.perms
from (values
  ('admin',            '{"marketing.view":"F","marketing.create":"F","marketing.publish":"F"}'::jsonb),
  ('ops',              '{"marketing.view":"F","marketing.create":"F","marketing.publish":"F"}'::jsonb),
  ('cs',               '{"marketing.view":"N","marketing.create":"N","marketing.publish":"N"}'::jsonb),
  ('vendors_followup', '{"marketing.view":"N","marketing.create":"N","marketing.publish":"N"}'::jsonb),
  ('accounts',         '{"marketing.view":"N","marketing.create":"N","marketing.publish":"N"}'::jsonb),
  ('viewer',           '{"marketing.view":"N","marketing.create":"N","marketing.publish":"N"}'::jsonb)
) as d(id, perms)
where r.id = d.id
  and (r.permissions -> 'marketing.view', r.permissions -> 'marketing.create', r.permissions -> 'marketing.publish')
      is distinct from (d.perms -> 'marketing.view', d.perms -> 'marketing.create', d.perms -> 'marketing.publish');

-- ---------------------------------------------------------------- ai_runs: the marketing runs (decisions 8–10)

alter table public.ai_runs drop constraint if exists ai_runs_action_check;
alter table public.ai_runs add constraint ai_runs_action_check check (action in ('write', 'studio', 'image', 'marketing'));
alter table public.ai_runs drop constraint if exists ai_runs_source_check;
alter table public.ai_runs add constraint ai_runs_source_check
  check (source is null or source in ('data', 'image', 'product', 'studio', 'tool', 'edit', 'import', 'campaign', 'template', 'post'));

-- ---------------------------------------------------------------- the campaigns

create table if not exists public.mkt_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'كامبين من غير اسم' check (char_length(btrim(name)) between 1 and 120),
  goal text check (goal is null or goal in ('منتج جديد', 'مجموعة جديدة', 'وعي بخدمة', 'عرض / خصم')),
  step int not null default 1 check (step between 1 and 4),
  state jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object' and octet_length(state::text) <= 1000000),
  scheduled_at timestamptz,
  created_by uuid references public.profiles on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles on delete set null default auth.uid(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references public.profiles on delete set null
);
create index if not exists mkt_campaigns_updated_idx on public.mkt_campaigns (updated_at desc) where archived_at is null;

-- the server's stamp: who and when (never the browser's clock); an archived campaign takes no change
create or replace function public.mkt_campaigns_stamp() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now(); new.updated_at := now();
    if auth.uid() is not null then new.created_by := auth.uid(); new.updated_by := auth.uid(); end if;
    new.archived_at := null; new.archived_by := null;
    if current_user = 'authenticated' then new.scheduled_at := null; end if;
    return new;
  end if;
  if old.archived_at is not null then raise exception 'archived' using errcode = '22023'; end if;
  new.updated_at := now();
  if auth.uid() is not null then new.updated_by := auth.uid(); end if;
  if new.archived_at is not null then new.archived_at := now(); new.archived_by := auth.uid(); end if;
  return new;
end $$;
drop trigger if exists mkt_campaigns_stamp on public.mkt_campaigns;
create trigger mkt_campaigns_stamp before insert or update on public.mkt_campaigns for each row execute function public.mkt_campaigns_stamp();

alter table public.mkt_campaigns enable row level security;
drop policy if exists mkt_campaigns_select on public.mkt_campaigns;
create policy mkt_campaigns_select on public.mkt_campaigns for select to authenticated
  using ((select public.has_perm('marketing.view')) <> 'N');
drop policy if exists mkt_campaigns_insert on public.mkt_campaigns;
create policy mkt_campaigns_insert on public.mkt_campaigns for insert to authenticated
  with check ((select public.has_perm('marketing.create')) = 'F');
drop policy if exists mkt_campaigns_update on public.mkt_campaigns;
create policy mkt_campaigns_update on public.mkt_campaigns for update to authenticated
  using ((select public.has_perm('marketing.create')) = 'F' and archived_at is null)
  with check ((select public.has_perm('marketing.create')) = 'F');
revoke all on public.mkt_campaigns from anon, authenticated;
grant select on public.mkt_campaigns to authenticated;
grant insert (name, goal, step, state) on public.mkt_campaigns to authenticated;
grant update (name, goal, step, state, archived_at) on public.mkt_campaigns to authenticated;
grant all on public.mkt_campaigns to service_role;

-- an open (not archived) campaign of this id — the storage policy's folder check
create or replace function public.mkt_campaign_open(p_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and exists (select 1 from public.mkt_campaigns c where c.id = p_id::uuid and c.archived_at is null)
$$;

-- ---------------------------------------------------------------- the design templates

create table if not exists public.mkt_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  kind text not null check (kind in ('post', 'carousel', 'video')),
  image text check (image is null or image ~ '^templates/[A-Za-z0-9._-]{1,120}$'),
  descr text not null default '' check (char_length(descr) <= 1000),
  used int not null default 0 check (used >= 0),
  created_by uuid references public.profiles on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles on delete set null default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles on delete set null
);

create or replace function public.mkt_templates_stamp() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now(); new.updated_at := now(); new.used := 0; new.deleted_at := null; new.deleted_by := null;
    if auth.uid() is not null then new.created_by := auth.uid(); new.updated_by := auth.uid(); end if;
    return new;
  end if;
  if old.deleted_at is not null then raise exception 'deleted' using errcode = '22023'; end if;
  new.updated_at := now();
  if auth.uid() is not null then new.updated_by := auth.uid(); end if;
  if new.deleted_at is not null then new.deleted_at := now(); new.deleted_by := auth.uid(); end if;
  return new;
end $$;
drop trigger if exists mkt_templates_stamp on public.mkt_templates;
create trigger mkt_templates_stamp before insert or update on public.mkt_templates for each row execute function public.mkt_templates_stamp();

alter table public.mkt_templates enable row level security;
drop policy if exists mkt_templates_select on public.mkt_templates;
create policy mkt_templates_select on public.mkt_templates for select to authenticated
  using ((select public.has_perm('marketing.view')) <> 'N');
drop policy if exists mkt_templates_insert on public.mkt_templates;
create policy mkt_templates_insert on public.mkt_templates for insert to authenticated
  with check ((select public.has_perm('marketing.create')) = 'F');
drop policy if exists mkt_templates_update on public.mkt_templates;
create policy mkt_templates_update on public.mkt_templates for update to authenticated
  using ((select public.has_perm('marketing.create')) = 'F' and deleted_at is null)
  with check ((select public.has_perm('marketing.create')) = 'F');
revoke all on public.mkt_templates from anon, authenticated;
grant select on public.mkt_templates to authenticated;
grant insert (name, kind, image, descr) on public.mkt_templates to authenticated;
grant update (name, kind, image, descr, deleted_at) on public.mkt_templates to authenticated;
grant all on public.mkt_templates to service_role;

-- «اتستخدم»: picking a template in «أمثلة للمطابقة» counts it
create or replace function public.mkt_template_used(p_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v int;
begin
  if public.has_perm('marketing.create') <> 'F' then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.mkt_templates set used = used + 1 where id = p_id and deleted_at is null returning used into v;
  if v is null then raise exception 'not found' using errcode = 'P0002'; end if;
  return v;
end $$;

-- ---------------------------------------------------------------- the schedule and the publishing log

create table if not exists public.mkt_posts (
  id bigint generated always as identity primary key,
  campaign_id uuid references public.mkt_campaigns on delete set null,
  piece text check (piece is null or piece ~ '^[A-Z][0-9]{1,2}$'),
  kind text not null check (kind in ('بوست', 'كاروسيل', 'ريل', 'ستوري')),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  caption text not null default '' check (char_length(caption) <= 2200),
  caption_orig text not null default '' check (char_length(caption_orig) <= 2200),
  tags text not null default '' check (char_length(tags) <= 300),
  images text[] not null default '{}' check (cardinality(images) <= 11),
  platform text not null check (platform in ('انستجرام', 'فيسبوك', 'تيك توك')),
  day date not null,
  time text not null check (time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  how text not null default 'download' check (how in ('download', 'publish')),
  status text not null default 'مجدول' check (status in ('مجدول', 'اتنشر', 'فشل', 'اتحذف')),
  was_live boolean not null default false,
  post_url text check (post_url is null or (post_url ~ '^https://[^\s<>"]+$' and char_length(post_url) <= 500)),
  published_at timestamptz,
  published_by uuid references public.profiles on delete set null,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles on delete set null,
  created_by uuid references public.profiles on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);
create index if not exists mkt_posts_day_idx on public.mkt_posts (day, time);
create index if not exists mkt_posts_campaign_idx on public.mkt_posts (campaign_id);
-- one live row per piece and platform of a campaign (a deleted one may be scheduled again)
create unique index if not exists mkt_posts_piece_uq on public.mkt_posts (campaign_id, piece, platform)
  where campaign_id is not null and status <> 'اتحذف';

alter table public.mkt_posts enable row level security;
drop policy if exists mkt_posts_select on public.mkt_posts;
create policy mkt_posts_select on public.mkt_posts for select to authenticated
  using ((select public.has_perm('marketing.view')) <> 'N');
revoke all on public.mkt_posts from anon, authenticated;
grant select on public.mkt_posts to authenticated;
grant all on public.mkt_posts to service_role;

-- Cairo's hour now ('HH24:MI'); the day is hr_today() (0046)
create or replace function public.mkt_now() returns text
language sql stable set search_path = public as $$ select to_char(now() at time zone 'Africa/Cairo', 'HH24:MI') $$;

-- a text for a row: control characters out (a caption keeps its new lines), trimmed
create or replace function public.mkt_clean(p text, p_lines boolean default false) returns text
language sql immutable set search_path = public as $$
  select btrim(case when p_lines then regexp_replace(regexp_replace(coalesce(p, ''), E'\r\n?', E'\n', 'g'), E'[\\x01-\\x09\\x0b-\\x1f\\x7f]', ' ', 'g')
                    else regexp_replace(regexp_replace(coalesce(p, ''), '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g') end)
$$;

-- «تأكيد النشر» (decision 14): the campaign's step 4 → a row per piece × platform «مجدول». Each item:
-- { piece, kind, name, caption, tags, images: [paths of this campaign], platform, day, time } — a day from today (≤ a year), an hour
-- not past in Cairo. Confirming again updates the waiting rows (مجدول / فشل), leaves a published one as it is, inserts the new ones,
-- and marks «اتحذف» the waiting rows of pieces or platforms no longer in the list. Returns the campaign's waiting rows.
create or replace function public.mkt_schedule(p_campaign uuid, p_items jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  c public.mkt_campaigns; it jsonb; v_today date := public.hr_today(); v_now text := public.mkt_now();
  v_piece text; v_kind text; v_name text; v_caption text; v_tags text; v_images text[]; v_platform text; v_day date; v_time text;
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
    v_key := v_piece || '|' || v_platform;
    if v_key = any (v_keys) then raise exception 'invalid: items' using errcode = '22023'; end if;
    v_keys := v_keys || v_key;
    select * into v_row from public.mkt_posts p
      where p.campaign_id = p_campaign and p.piece = v_piece and p.platform = v_platform and p.status <> 'اتحذف' for update;
    if found then
      if v_row.status in ('مجدول', 'فشل') then
        update public.mkt_posts set kind = v_kind, name = v_name, caption = v_caption, caption_orig = v_caption, tags = v_tags, images = v_images,
            day = v_day, time = v_time, status = 'مجدول', updated_by = auth.uid(), updated_at = now()
          where id = v_row.id;
      end if; -- a published one stays as it is
    else
      insert into public.mkt_posts (campaign_id, piece, kind, name, caption, caption_orig, tags, images, platform, day, time, how, status, created_by, updated_by)
      values (p_campaign, v_piece, v_kind, v_name, v_caption, v_caption, v_tags, v_images, v_platform, v_day, v_time, 'download', 'مجدول', auth.uid(), auth.uid());
    end if;
  end loop;
  update public.mkt_posts set status = 'اتحذف', deleted_at = now(), deleted_by = auth.uid(), updated_by = auth.uid(), updated_at = now()
    where campaign_id = p_campaign and status in ('مجدول', 'فشل') and not ((piece || '|' || platform) = any (v_keys));
  update public.mkt_campaigns set scheduled_at = now(), step = 4 where id = p_campaign;
  select count(*) into v_n from public.mkt_posts where campaign_id = p_campaign and status in ('مجدول', 'فشل');
  return v_n;
end $$;

-- a post of the log (decision 15): move { day, time } · caption { text } (a waiting one) · published { url? } («علّمه اتنشر») ·
-- delete (a waiting one won't be posted; a published one is marked, was_live). Returns the new status.
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
  if p_action = 'move' then
    if v.status not in ('مجدول', 'فشل') then raise exception 'invalid: status' using errcode = '22023'; end if;
    begin v_day := (a ->> 'day')::date; exception when others then v_day := null; end;
    if v_day is null or v_day < v_today or v_day > v_today + 365 then raise exception 'invalid: day' using errcode = '22023'; end if;
    v_time := a ->> 'time';
    if v_time is null or v_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or (v_day = v_today and v_time <= v_now) then
      raise exception 'invalid: time' using errcode = '22023';
    end if;
    if v_day = v.day and v_time = v.time then raise exception 'invalid: same' using errcode = '22023'; end if;
    update public.mkt_posts set day = v_day, time = v_time, status = 'مجدول', updated_by = auth.uid(), updated_at = now() where id = p_id;
    return 'مجدول';
  elsif p_action = 'caption' then
    if v.status not in ('مجدول', 'فشل') then raise exception 'invalid: status' using errcode = '22023'; end if;
    v_text := public.mkt_clean(a ->> 'text', true);
    if char_length(v_text) > 2200 then raise exception 'invalid: caption' using errcode = '22023'; end if;
    update public.mkt_posts set caption = v_text, updated_by = auth.uid(), updated_at = now() where id = p_id;
    return v.status;
  elsif p_action = 'published' then
    if v.status not in ('مجدول', 'فشل') then raise exception 'invalid: status' using errcode = '22023'; end if;
    v_url := nullif(btrim(coalesce(a ->> 'url', '')), '');
    if v_url is not null and (v_url !~ '^https://[^\s<>"]+$' or char_length(v_url) > 500) then raise exception 'invalid: url' using errcode = '22023'; end if;
    update public.mkt_posts set status = 'اتنشر', published_at = now(), published_by = auth.uid(), post_url = v_url, updated_by = auth.uid(), updated_at = now()
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

-- ---------------------------------------------------------------- the wallet (decision 11)

-- { cap, used }: the month's image credit cap of the settings row «ai» (null = none set there) and every member's image credits this
-- Cairo month (what ai_image_run_start counts) — for marketing.create F; null for anyone else
create or replace function public.mkt_credits() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.has_perm('marketing.create') = 'F' then jsonb_build_object(
    'cap', (select case when (s.data ->> 'image_monthly_credits') ~ '^[0-9]{1,9}$' and (s.data ->> 'image_monthly_credits')::int > 0
                        then (s.data ->> 'image_monthly_credits')::int end
            from public.settings s where s.section = 'ai'),
    'used', (select coalesce(sum(r.credits), 0)::bigint from public.ai_runs r
             where r.action = 'image' and r.created_at >= (date_trunc('month', now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo'))
  ) end
$$;

revoke execute on function public.mkt_campaigns_stamp(), public.mkt_templates_stamp() from public, anon, authenticated;
revoke execute on function public.mkt_campaign_open(text), public.mkt_template_used(uuid), public.mkt_now(), public.mkt_clean(text, boolean),
  public.mkt_schedule(uuid, jsonb), public.mkt_post_act(bigint, text, jsonb), public.mkt_credits() from public, anon;
grant execute on function public.mkt_campaign_open(text), public.mkt_template_used(uuid), public.mkt_now(), public.mkt_clean(text, boolean),
  public.mkt_schedule(uuid, jsonb), public.mkt_post_act(bigint, text, jsonb), public.mkt_credits() to authenticated, service_role;

-- ---------------------------------------------------------------- live line: private broadcast «marketing» / «changed», { at } only

create or replace function public.mkt_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if to_regprocedure('realtime.send(jsonb, text, text, boolean)') is not null then
    begin
      execute 'select realtime.send($1, $2, $3, $4)' using jsonb_build_object('at', now()), 'changed', 'marketing', true;
    exception when others then null; -- the write goes on; the page's periodic check picks it up
    end;
  end if;
  return null;
end $$;
revoke execute on function public.mkt_notify() from public, anon, authenticated;
drop trigger if exists mkt_campaigns_notify on public.mkt_campaigns;
create trigger mkt_campaigns_notify after insert or update on public.mkt_campaigns for each statement execute function public.mkt_notify();
drop trigger if exists mkt_posts_notify on public.mkt_posts;
create trigger mkt_posts_notify after insert or update on public.mkt_posts for each statement execute function public.mkt_notify();
drop trigger if exists mkt_templates_notify on public.mkt_templates;
create trigger mkt_templates_notify after insert or update on public.mkt_templates for each statement execute function public.mkt_notify();

do $$
begin
  if to_regclass('realtime.messages') is not null and to_regprocedure('realtime.topic()') is not null then
    execute 'drop policy if exists marketing_receive on realtime.messages';
    execute $p$create policy marketing_receive on realtime.messages for select to authenticated
      using (realtime.topic() = 'marketing' and extension = 'broadcast' and (select public.has_perm('marketing.view')) <> 'N')$p$;
  end if;
end $$;

-- ---------------------------------------------------------------- Storage: bucket «marketing» (guarded)

do $storage$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') and to_regclass('storage.buckets') is not null then
    execute $s$insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
               values ('marketing', 'marketing', false, 15728640, '{image/png,image/jpeg,image/webp}')
               on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types$s$;
    execute $s$drop policy if exists marketing_files_select on storage.objects$s$;
    execute $s$create policy marketing_files_select on storage.objects for select to authenticated
               using (bucket_id = 'marketing' and (select public.has_perm('marketing.view')) <> 'N')$s$;
    execute $s$drop policy if exists marketing_files_insert on storage.objects$s$;
    execute $s$create policy marketing_files_insert on storage.objects for insert to authenticated
               with check (bucket_id = 'marketing' and (select public.has_perm('marketing.create')) = 'F'
                           and ((storage.foldername(name))[1] = 'templates' or public.mkt_campaign_open((storage.foldername(name))[1])))$s$;
  end if;
end $storage$;
