-- 0109 — the marketing assistants' new sections (docs/superpowers/plans/2026-11-15-comments.md decisions 69–71).
-- The owner 15 Nov: «حطلي قسم … اخر التريندات … في جدول منظم و يبقي في عمود للموقع ال source و خانة للنوع ده صورة ولا فيديو» ·
-- «اعملي قسم تاني يبقي فيه اعلانات اللي المنافسين في الميديا باير» · «زودلي قسم المبرمج يجيبله ابديتس للوردر بريس».
--   * mkt_trends      — «آخر التريندات» (the designer): rows the server writes (ai-content `trends` — Claude with the web search
--                       tool; a row's link is one the search really returned), read with marketing.view. Never written by a member.
--   * mkt_competitors — «إعلانات المنافسين» (the media buyer): the competitors' list — a member with marketing.create adds, edits
--                       and archives; read with marketing.view. Their ads open in Meta's Ad Library (its API gives commercial ads
--                       for the EU / UK only), so no ad is stored here.
--   * site_checks     — the last «تحديثات ووردبريس» check (the developer): one row per kind, written by the server
--                       (woo-sync `wp_updates`), read with marketing.view. Versions and names only — no key, no path.
-- Explicit grants (the live project grants no DML by default); RLS on the three. Re-runnable.

-- ---------------------------------------------------------------- the trends (decision 69)

create table if not exists public.mkt_trends (
  id bigserial primary key,
  batch uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  summary text check (summary is null or char_length(summary) <= 600),
  source text not null check (char_length(btrim(source)) between 1 and 80),
  url text not null check (char_length(url) <= 500 and url ~ '^https://[^\s<>"]+$'),
  kind text not null check (kind in ('image', 'video')),
  found_at timestamptz not null default now(),
  created_by uuid references public.profiles on delete set null
);
create index if not exists mkt_trends_found_idx on public.mkt_trends (found_at desc);

alter table public.mkt_trends enable row level security;
drop policy if exists mkt_trends_select on public.mkt_trends;
create policy mkt_trends_select on public.mkt_trends for select to authenticated
  using ((select public.has_perm('marketing.view')) <> 'N');
revoke all on public.mkt_trends from anon, authenticated;
grant select on public.mkt_trends to authenticated;
grant all on public.mkt_trends to service_role;
grant usage on sequence public.mkt_trends_id_seq to service_role;

-- a refresh is one ai_runs row (action 'marketing', source 'trends' — the tokens of its calls and the searches)
alter table public.ai_runs drop constraint if exists ai_runs_source_check;
alter table public.ai_runs add constraint ai_runs_source_check
  check (source is null or source in ('data', 'image', 'product', 'studio', 'tool', 'edit', 'import', 'campaign', 'template', 'post', 'buyer', 'video', 'chat', 'filter', 'agent', 'trends'));

drop trigger if exists mkt_trends_notify on public.mkt_trends;
create trigger mkt_trends_notify after insert on public.mkt_trends for each statement execute function public.mkt_notify();

-- ---------------------------------------------------------------- the competitors (decision 70)

create table if not exists public.mkt_competitors (
  id bigserial primary key,
  name text not null check (char_length(btrim(name)) between 1 and 80 and name !~ '[<>]'),
  -- the Facebook page's number (Page transparency › Page ID): the Ad Library opens on that page's ads; without it, by the name
  page_id text check (page_id is null or page_id ~ '^[0-9]{5,20}$'),
  page_url text check (page_url is null or (char_length(page_url) <= 320 and page_url ~ '^https://([a-z0-9-]+\.)?(facebook|instagram)\.com/[^\s<>"]+$')),
  keyword text check (keyword is null or (char_length(keyword) <= 80 and keyword !~ '[<>]')),
  note text check (note is null or (char_length(note) <= 300 and note !~ '[<>]')),
  created_by uuid not null default auth.uid() references public.profiles,
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles,
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists mkt_competitors_live_idx on public.mkt_competitors (created_at desc) where archived_at is null;

-- who added it and when are the server's; an archived row stays archived (the list never deletes)
create or replace function public.mkt_competitors_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user not in ('anon', 'authenticated') then return new; end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.created_at := now(); new.updated_by := auth.uid(); new.updated_at := now(); new.archived_at := null;
    return new;
  end if;
  if new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'who added the competitor cannot change' using errcode = '42501';
  end if;
  if old.archived_at is not null then raise exception 'an archived competitor is not edited' using errcode = '42501'; end if;
  if new.archived_at is not null then new.archived_at := now(); end if;
  new.updated_by := auth.uid(); new.updated_at := now();
  return new;
end $$;
drop trigger if exists mkt_competitors_guard on public.mkt_competitors;
create trigger mkt_competitors_guard before insert or update on public.mkt_competitors for each row execute function public.mkt_competitors_guard();
revoke execute on function public.mkt_competitors_guard() from public, anon, authenticated;

alter table public.mkt_competitors enable row level security;
drop policy if exists mkt_competitors_select on public.mkt_competitors;
create policy mkt_competitors_select on public.mkt_competitors for select to authenticated
  using ((select public.has_perm('marketing.view')) <> 'N');
drop policy if exists mkt_competitors_insert on public.mkt_competitors;
create policy mkt_competitors_insert on public.mkt_competitors for insert to authenticated
  with check ((select public.has_perm('marketing.create')) = 'F');
drop policy if exists mkt_competitors_update on public.mkt_competitors;
create policy mkt_competitors_update on public.mkt_competitors for update to authenticated
  using ((select public.has_perm('marketing.create')) = 'F') with check ((select public.has_perm('marketing.create')) = 'F');
revoke all on public.mkt_competitors from anon, authenticated;
grant select on public.mkt_competitors to authenticated;
grant insert (name, page_id, page_url, keyword, note) on public.mkt_competitors to authenticated;
grant update (name, page_id, page_url, keyword, note, archived_at) on public.mkt_competitors to authenticated;
grant all on public.mkt_competitors to service_role;
grant usage on sequence public.mkt_competitors_id_seq to authenticated, service_role;

drop trigger if exists mkt_competitors_notify on public.mkt_competitors;
create trigger mkt_competitors_notify after insert or update on public.mkt_competitors for each statement execute function public.mkt_notify();

-- ---------------------------------------------------------------- the site's last check (decision 71)

create table if not exists public.site_checks (
  kind text primary key check (kind in ('wp_updates')),
  data jsonb not null default '{}'::jsonb,
  checked_at timestamptz not null default now(),
  checked_by uuid references public.profiles on delete set null
);
alter table public.site_checks enable row level security;
drop policy if exists site_checks_select on public.site_checks;
create policy site_checks_select on public.site_checks for select to authenticated
  using ((select public.has_perm('marketing.view')) <> 'N');
revoke all on public.site_checks from anon, authenticated;
grant select on public.site_checks to authenticated;
grant all on public.site_checks to service_role;
