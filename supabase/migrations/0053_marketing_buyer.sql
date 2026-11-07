-- 0053_marketing_buyer — phase 9.5.4: the media buyer with approved execution, the designer and developer requests
-- (docs/superpowers/plans/2026-11-06-phase-9-5-marketing.md, decisions 49–56).
-- * mkt_suggestions — the buyer's suggestions, written by the server (mkt-ads after each sync) from the prototype's rules:
--   stop / budget_down / budget_up / creative / tracking, one open row a (kind × campaign); the admin decides (approve / edit / reject)
--   through mkt-ads `decide` — the server records the decision and Meta's answer; a condition gone expires the row. Read with
--   marketing.view; the members never write it.
-- * mkt_requests — the designer's and the developer's work lists: added with marketing.create (the member's own), the status
--   changed by the admin, the text by its author while it is «جديد».
-- * mkt_buyer_rules() — the rules and limits as the server reads them (settings «marketing».buyer, the prototype's defaults);
--   the execution switch is off until the admin turns it on (decision 50).
-- * ai_runs.source «buyer» — the buyer's chat (ai-content action «buyer», marketing.view; text only, no execution — decision 53).
-- * the cron mkt-ads-report (hourly; the function sends the day's report once when Cairo's hour is the rule's).
-- Re-runnable; no drop / delete / truncate of data.

-- ---------------------------------------------------------------- the suggestions (decision 49 / 50)

create table if not exists public.mkt_suggestions (
  id bigserial primary key,
  platform text not null default 'meta' check (platform in ('meta')),
  kind text not null check (kind in ('stop', 'budget_down', 'budget_up', 'creative', 'tracking')),
  campaign_id text not null check (campaign_id ~ '^[0-9]{1,30}$'),
  campaign_name text check (campaign_name is null or char_length(campaign_name) <= 300),
  ad_id text check (ad_id is null or ad_id ~ '^[0-9]{1,30}$'),
  title text not null check (char_length(title) <= 300),
  sub text check (sub is null or char_length(sub) <= 400),
  why text check (why is null or char_length(why) <= 600),
  impact text check (impact is null or char_length(impact) <= 200),
  pct int check (pct is null or (pct >= -90 and pct <= 300)), -- the suggested budget step (budget_*)
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 4000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'edited', 'rejected', 'done', 'failed', 'expired')),
  created_at timestamptz not null default now(),
  checked_at timestamptz not null default now(),
  decided_by uuid references public.profiles,
  decided_at timestamptz,
  value int check (value is null or (value >= -90 and value <= 300)), -- the step the admin edited to
  note text check (note is null or char_length(note) <= 300),
  result jsonb check (result is null or (jsonb_typeof(result) = 'object' and octet_length(result::text) <= 4000)),
  error text check (error is null or char_length(error) <= 200)
);
create unique index if not exists mkt_suggestions_open_idx on public.mkt_suggestions (platform, kind, campaign_id, coalesce(ad_id, '')) where status = 'pending';
create index if not exists mkt_suggestions_status_idx on public.mkt_suggestions (status, created_at desc);

alter table public.mkt_suggestions enable row level security;
drop policy if exists mkt_suggestions_select on public.mkt_suggestions;
create policy mkt_suggestions_select on public.mkt_suggestions for select to authenticated
  using ((select public.has_perm('marketing.view')) <> 'N');
revoke all on public.mkt_suggestions from anon, authenticated;
grant select on public.mkt_suggestions to authenticated;
grant all on public.mkt_suggestions to service_role;
grant usage on sequence public.mkt_suggestions_id_seq to service_role;

-- ---------------------------------------------------------------- the requests (decision 54)

create table if not exists public.mkt_requests (
  id bigserial primary key,
  kind text not null check (kind in ('designer', 'dev')),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  details text check (details is null or char_length(details) <= 2000),
  project text check (project is null or char_length(project) <= 60),
  status text not null default 'جديد' check (status in ('جديد', 'بيتعمل', 'جاهز للمراجعة', 'خلص')),
  created_by uuid not null default auth.uid() references public.profiles,
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles,
  updated_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists mkt_requests_kind_idx on public.mkt_requests (kind, status, created_at desc);

-- created_by / created_at are the server's; the status and done_at change only by the admin; the author edits the text while «جديد»
create or replace function public.mkt_requests_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if current_user in ('anon', 'authenticated') then
      new.created_by := auth.uid(); new.created_at := now(); new.status := 'جديد'; new.done_at := null;
      new.updated_by := auth.uid(); new.updated_at := now();
    end if;
    return new;
  end if;
  if current_user in ('anon', 'authenticated') then
    if new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at or new.kind is distinct from old.kind then
      raise exception 'the request''s author and kind cannot change' using errcode = '42501';
    end if;
    if (new.status is distinct from old.status or new.done_at is distinct from old.done_at) and not public.is_admin() then
      raise exception 'the admin changes a request''s status' using errcode = '42501';
    end if;
    if (new.title is distinct from old.title or new.details is distinct from old.details or new.project is distinct from old.project)
       and not (public.is_admin() or (old.created_by = auth.uid() and old.status = 'جديد')) then
      raise exception 'the author edits a new request only' using errcode = '42501';
    end if;
    new.updated_by := auth.uid(); new.updated_at := now();
    if new.status = 'خلص' and old.status <> 'خلص' then new.done_at := now(); elsif new.status <> 'خلص' then new.done_at := null; end if;
  end if;
  return new;
end $$;
drop trigger if exists mkt_requests_guard on public.mkt_requests;
create trigger mkt_requests_guard before insert or update on public.mkt_requests for each row execute function public.mkt_requests_guard();
revoke execute on function public.mkt_requests_guard() from public, anon, authenticated;

alter table public.mkt_requests enable row level security;
drop policy if exists mkt_requests_select on public.mkt_requests;
create policy mkt_requests_select on public.mkt_requests for select to authenticated
  using ((select public.has_perm('marketing.view')) <> 'N');
drop policy if exists mkt_requests_insert on public.mkt_requests;
create policy mkt_requests_insert on public.mkt_requests for insert to authenticated
  with check ((select public.has_perm('marketing.create')) = 'F');
drop policy if exists mkt_requests_update on public.mkt_requests;
create policy mkt_requests_update on public.mkt_requests for update to authenticated
  using ((select public.is_admin()) or (created_by = (select auth.uid()) and (select public.has_perm('marketing.create')) = 'F'))
  with check ((select public.is_admin()) or (created_by = (select auth.uid()) and (select public.has_perm('marketing.create')) = 'F'));
revoke all on public.mkt_requests from anon, authenticated;
grant select on public.mkt_requests to authenticated;
grant insert (kind, title, details, project) on public.mkt_requests to authenticated;
grant update (title, details, project, status) on public.mkt_requests to authenticated;
grant all on public.mkt_requests to service_role;
grant usage on sequence public.mkt_requests_id_seq to authenticated, service_role;

-- ---------------------------------------------------------------- the rules (decision 51)

-- the rules and limits as the members read them (marketing.view — the settings row itself is the admin's): settings «marketing».buyer over
-- the prototype's defaults; live = the execution switch. The server (service_role) reads the settings row directly.
create or replace function public.mkt_buyer_rules() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(public.has_perm('marketing.view'), 'N') = 'N' then
    raise exception 'marketing.view is needed' using errcode = '42501';
  end if;
  return jsonb_build_object('dailyCap', 5000, 'maxCpa', 450, 'autoStop', 1500, 'autoStopMode', 'suggest', 'reportHour', 9, 'live', false)
         || coalesce((select case when jsonb_typeof(s.data -> 'buyer') = 'object' then s.data -> 'buyer' else '{}'::jsonb end
                        from public.settings s where s.section = 'marketing'), '{}'::jsonb);
end $$;
revoke execute on function public.mkt_buyer_rules() from public, anon;
grant execute on function public.mkt_buyer_rules() to authenticated, service_role;

-- ---------------------------------------------------------------- ai_runs: the buyer's chat (decision 53) — action «marketing», source «buyer»

alter table public.ai_runs drop constraint if exists ai_runs_source_check;
alter table public.ai_runs add constraint ai_runs_source_check
  check (source is null or source in ('data', 'image', 'product', 'studio', 'tool', 'edit', 'import', 'campaign', 'template', 'post', 'buyer'));

-- ---------------------------------------------------------------- the cron (decision 52; guarded like 0040; the sync secret of 0008)

do $$
begin
  if to_regnamespace('cron') is null or to_regnamespace('net') is null or to_regclass('vault.decrypted_secrets') is null then
    raise notice '0053: pg_cron / pg_net / Vault not here — the report cron is not scheduled';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'mkt-ads-report') then perform cron.unschedule('mkt-ads-report'); end if;
  -- hourly at :35; the function sends the day's report once, when Cairo's hour is the rule's (reportHour)
  perform cron.schedule('mkt-ads-report', '35 * * * *', $cron$
    select net.http_post(
      url := 'https://fsynculhaupcktzkfkdd.supabase.co/functions/v1/mkt-ads',
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'X-Sync-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_secret')),
      body := '{"action":"report"}'::jsonb,
      timeout_milliseconds := 60000
    )
  $cron$);
end $$;
