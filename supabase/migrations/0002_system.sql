-- 0002_system: settings, status_map, activity_log, alerts, notification_prefs; log_activity; RLS.
-- Uses has_perm / is_admin from 0001_identity. Seeds only settings and status_map
-- (no rows that reference roles: 0003_seed_roles runs after this file).
-- Every policy is `to authenticated`: anon has no execute on has_perm/is_admin.
-- Suspended / invited users are blocked through has_perm/is_admin ('N' / false)
-- or through an explicit status = 'active' check on their own profile.

-- ---------------------------------------------------------------- tables

create table public.settings (
  section text primary key,
  data jsonb not null default '{}',
  updated_at timestamptz,
  updated_by uuid
);

create table public.status_map (
  id serial primary key,
  system_status text not null unique,
  woo_status text,
  direction text check (direction in ('both', 'from_woo', 'from_system')) default 'both',
  sort int
);

create table public.activity_log (
  id bigserial primary key,
  at timestamptz default now(),
  actor uuid references public.profiles,
  action text not null,
  entity text,
  entity_id text,
  old_value jsonb,
  new_value jsonb
);

create table public.alerts (
  id bigserial primary key,
  at timestamptz default now(),
  kind text not null,
  title text not null,
  body text,
  role_id text references public.roles,
  user_id uuid references public.profiles,
  entity text,
  entity_id text,
  read_at timestamptz
);

create table public.notification_prefs (
  user_id uuid primary key references public.profiles,
  data jsonb default '{}'
);

create index activity_log_at_idx on public.activity_log (at desc);
create index activity_log_actor_idx on public.activity_log (actor);
create index alerts_role_id_idx on public.alerts (role_id);
create index alerts_user_id_idx on public.alerts (user_id);

alter table public.settings enable row level security;
alter table public.status_map enable row level security;
alter table public.activity_log enable row level security;
alter table public.alerts enable row level security;
alter table public.notification_prefs enable row level security;

-- ---------------------------------------------------------------- functions / triggers

-- settings.updated_at / updated_by always come from the server.
create function public.settings_stamp() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end
$$;

create trigger settings_stamp before insert or update on public.settings
  for each row execute function public.settings_stamp();

-- activity_log.actor is always the caller, whatever was passed.
create function public.activity_log_actor() returns trigger
language plpgsql set search_path = public as $$
begin
  new.actor := auth.uid();
  return new;
end
$$;

create trigger activity_log_actor before insert on public.activity_log
  for each row execute function public.activity_log_actor();

-- API roles may change only alerts.read_at (row access is decided by RLS).
-- postgres / service_role (server jobs) are trusted.
create function public.alerts_guard_update() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('anon', 'authenticated')
     and (to_jsonb(new) - 'read_at') is distinct from (to_jsonb(old) - 'read_at') then
    raise exception 'only read_at can be changed on an alert' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger alerts_guard_update before update on public.alerts
  for each row execute function public.alerts_guard_update();

-- Front end calls this over RPC. Security invoker: the insert goes through RLS,
-- so only an active signed-in user can write.
create function public.log_activity(action text, entity text, entity_id text, old_value jsonb, new_value jsonb)
returns void
language sql volatile security invoker set search_path = public as $$
  insert into public.activity_log (action, entity, entity_id, old_value, new_value)
  values (log_activity.action, log_activity.entity, log_activity.entity_id,
          log_activity.old_value, log_activity.new_value)
$$;

revoke execute on function public.settings_stamp() from public, anon, authenticated;
revoke execute on function public.activity_log_actor() from public, anon, authenticated;
revoke execute on function public.alerts_guard_update() from public, anon, authenticated;
revoke execute on function public.log_activity(text, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.log_activity(text, text, text, jsonb, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------- policies

-- settings: read with settings.view; team/integrations/security need settings.team = F,
-- every other section needs admin. with check applies the rule to the new row.
create policy settings_select on public.settings for select to authenticated
  using ((select public.has_perm('settings.view')) <> 'N');
create policy settings_insert on public.settings for insert to authenticated
  with check (case when section in ('team', 'integrations', 'security')
                   then (select public.has_perm('settings.team')) = 'F'
                   else (select public.is_admin()) end);
create policy settings_update on public.settings for update to authenticated
  using (case when section in ('team', 'integrations', 'security')
              then (select public.has_perm('settings.team')) = 'F'
              else (select public.is_admin()) end)
  with check (case when section in ('team', 'integrations', 'security')
                   then (select public.has_perm('settings.team')) = 'F'
                   else (select public.is_admin()) end);
create policy settings_delete on public.settings for delete to authenticated
  using ((select public.is_admin()));

-- status_map: any active user who can see orders reads; admin writes.
create policy status_map_select on public.status_map for select to authenticated
  using ((select public.has_perm('orders.view')) <> 'N');
create policy status_map_insert on public.status_map for insert to authenticated
  with check ((select public.is_admin()));
create policy status_map_update on public.status_map for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy status_map_delete on public.status_map for delete to authenticated
  using ((select public.is_admin()));

-- activity_log: any active user inserts (actor forced by trigger); read with
-- settings.view; no update / delete policies at all.
create policy activity_log_insert on public.activity_log for insert to authenticated
  with check (exists (select 1 from public.profiles p
                      where p.id = (select auth.uid()) and p.status = 'active'));
create policy activity_log_select on public.activity_log for select to authenticated
  using ((select public.has_perm('settings.view')) <> 'N');

-- alerts: an active user sees / marks read alerts addressed to them or to their role
-- (column limit in alerts_guard_update); insert / delete admin only for now.
create policy alerts_select on public.alerts for select to authenticated
  using (exists (select 1 from public.profiles p
                 where p.id = (select auth.uid()) and p.status = 'active'
                   and (alerts.user_id = p.id or alerts.role_id = p.role_id)));
create policy alerts_update on public.alerts for update to authenticated
  using (exists (select 1 from public.profiles p
                 where p.id = (select auth.uid()) and p.status = 'active'
                   and (alerts.user_id = p.id or alerts.role_id = p.role_id)))
  with check (exists (select 1 from public.profiles p
                      where p.id = (select auth.uid()) and p.status = 'active'
                        and (alerts.user_id = p.id or alerts.role_id = p.role_id)));
create policy alerts_insert on public.alerts for insert to authenticated
  with check ((select public.is_admin()));
create policy alerts_delete on public.alerts for delete to authenticated
  using ((select public.is_admin()));

-- notification_prefs: the active owner only, every operation.
create policy notification_prefs_owner on public.notification_prefs for all to authenticated
  using (user_id = (select auth.uid())
         and exists (select 1 from public.profiles p
                     where p.id = (select auth.uid()) and p.status = 'active'))
  with check (user_id = (select auth.uid())
              and exists (select 1 from public.profiles p
                          where p.id = (select auth.uid()) and p.status = 'active'));

-- ---------------------------------------------------------------- seeds (idempotent, never clobber)

-- general = C.general in app/js/blocks/17-page-settings.js, verbatim.
insert into public.settings (section, data) values
  ('general', '{
    "company": "إبتكر كلوب",
    "legal": "Ibtekr Club LLC",
    "email": "hello@ibtekr.club",
    "site": "https://ibtekr.club",
    "address": "القاهرة، مصر",
    "phone": "0100 000 0000",
    "tz": "(GMT+3) القاهرة",
    "lang": "العربية",
    "dateFmt": "20 أكتوبر 2026",
    "currency": "ج.م — الجنيه المصري",
    "numFmt": "1,234.56",
    "week": "السبت",
    "compact": true,
    "thumbs": true,
    "rememberFilters": true,
    "hidePhones": true
  }'),
  ('team', '{}'),
  ('integrations', '{}'),
  ('makers', '{}'),
  ('notifications', '{}'),
  ('lists', '{}'),
  ('payments', '{}'),
  ('activity', '{}'),
  ('security', '{}'),
  ('data', '{}')
on conflict (section) do nothing;

-- STATUS_ORDER in app/js/blocks/04-reports-domain.js.
insert into public.status_map (system_status, woo_status, direction, sort) values
  ('جاري التنفيذ', 'processing', 'both', 1),
  ('مكتمل',        'completed',  'both', 2),
  ('قيد الشحن',    'shipped',    'both', 3),
  ('معلّق',        'on-hold',    'both', 4),
  ('ملغي',         'cancelled',  'both', 5),
  ('مرتجع',        'refunded',   'both', 6)
on conflict (system_status) do nothing;
