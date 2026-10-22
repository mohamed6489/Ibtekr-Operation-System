-- 0004_grants: explicit privileges for the API roles.
-- The live project grants NO DML on new tables by default (only truncate/references/trigger),
-- so every table needs its grants spelled out. RLS stays the row gate; these are the table gate.
-- anon gets no table access at all (its only entry point is the email_for_identifier RPC).

grant usage on schema public to anon, authenticated, service_role;

-- Drop the privileges the defaults hand out that nothing should have (TRUNCATE ignores RLS).
revoke truncate, references, trigger on all tables in schema public from anon, authenticated, service_role;

grant select, insert, update, delete on
  public.roles, public.profiles, public.invites,
  public.settings, public.status_map, public.alerts, public.notification_prefs
  to authenticated, service_role;

-- append-only log: no update/delete (0002 revoked them at the grant level too).
grant select, insert on public.activity_log to authenticated, service_role;

-- serial / bigserial ids (status_map, activity_log, alerts).
grant usage, select on all sequences in schema public to authenticated, service_role;

-- throttle table: the definer function alone touches it.
revoke all on public.login_lookups from anon, authenticated, service_role;
