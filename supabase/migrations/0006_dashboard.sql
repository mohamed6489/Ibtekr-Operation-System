-- 0006_dashboard: user_prefs, alert_reads; own rows in activity_log; Realtime on alerts; RLS.
-- Uses has_perm from 0001_identity and profiles / alerts / activity_log from 0002_system.
-- user_prefs: per-user UI preferences under a short key ('dashboard' = card order and hidden
--   cards), saved for the active owner only.
-- alert_reads: the single store of per-user read state for every alert, addressed to a user or
--   to a role. alerts.read_at stays for server jobs only; the front end never writes it.
--   Why: one read path instead of two. Cost if wrong: an unused column.
-- activity_log: an active user now also reads their own rows; settings.view still reads all.
-- alerts join the supabase_realtime publication so the bell updates live (RLS still decides who
--   receives which row). Guarded: the publication is absent on the local stub.
-- The policy change is an alter policy (see 0005_advisors for why it is not re-created).

-- ---------------------------------------------------------------- tables

create table public.user_prefs (
  user_id uuid not null references public.profiles on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_.-]{0,63}$'),
  data jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

create table public.alert_reads (
  alert_id bigint not null references public.alerts on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  read_at timestamptz not null default now(),
  primary key (alert_id, user_id)
);

create index alert_reads_user_id_idx on public.alert_reads (user_id);

alter table public.user_prefs enable row level security;
alter table public.alert_reads enable row level security;

-- ---------------------------------------------------------------- functions / triggers

-- user_prefs.updated_at always comes from the server.
create function public.user_prefs_stamp() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create trigger user_prefs_stamp before insert or update on public.user_prefs
  for each row execute function public.user_prefs_stamp();

revoke execute on function public.user_prefs_stamp() from public, anon, authenticated;

-- ---------------------------------------------------------------- policies

-- user_prefs: the active owner only, every operation.
create policy user_prefs_owner on public.user_prefs for all to authenticated
  using (user_id = (select auth.uid())
         and exists (select 1 from public.profiles p
                     where p.id = (select auth.uid()) and p.status = 'active'))
  with check (user_id = (select auth.uid())
              and exists (select 1 from public.profiles p
                          where p.id = (select auth.uid()) and p.status = 'active'));

-- alert_reads: a user reads their own marks and marks read only an alert they can see.
-- The exists runs under the caller's own alerts_select policy, so an alert for another user or
-- role cannot be marked, and a suspended user fails the same policy.
create policy alert_reads_select on public.alert_reads for select to authenticated
  using (user_id = (select auth.uid()));
create policy alert_reads_insert on public.alert_reads for insert to authenticated
  with check (user_id = (select auth.uid())
              and exists (select 1 from public.alerts a where a.id = alert_reads.alert_id));

-- ---------------------------------------------------------------- grants (rule 4: explicit, see 0004_grants)

grant select, insert, update, delete on public.user_prefs to authenticated, service_role;
-- a read mark is written once: select and insert only for the API.
grant select, insert on public.alert_reads to authenticated, service_role;
revoke truncate, references, trigger on public.user_prefs, public.alert_reads
  from anon, authenticated, service_role;

-- ---------------------------------------------------------------- activity_log: own rows

alter policy activity_log_select on public.activity_log
  using ((actor = (select auth.uid())
          and exists (select 1 from public.profiles p
                      where p.id = (select auth.uid()) and p.status = 'active'))
         or (select public.has_perm('settings.view')) <> 'N');

-- ---------------------------------------------------------------- Realtime on alerts (guarded)

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'alerts') then
    execute 'alter publication supabase_realtime add table public.alerts';
  end if;
end $$;
