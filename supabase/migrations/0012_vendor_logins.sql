-- 0012_vendor_logins: phase 3.1 (the new «إضافة مبتكر» popup): the status `leave` on vendors (the 0007 check replaced),
-- the table vendor_logins (the maker's portal login: username, e-mail, password mode, login status) with its
-- column-list grants, its RLS and the column guard vendor_logins_guard, and the two Vault RPCs
-- vendor_login_set_password / vendor_login_reveal — the temporary password lives in Vault, never in a column the API
-- roles can read.
-- Uses has_perm / is_admin (0001, 0008), the role matrix (0003: vendors.view / vendors.edit — no new key), vendors and
-- its guard (0007 / 0011), activity_log + activity_log_actor (0002), Vault and its to_regclass guard (0008), the grant
-- rules (0004).
--
-- Decision (plan, decision 6): vendors.status gains `leave` («في إجازة»). A check constraint cannot be altered, so the
--   0007 constraint vendors_status_check is dropped and re-added with the three values inside one DO block (one
--   statement, one transaction) — the one written exception to this project's "no drop" rule: a constraint, not data,
--   and only while its definition still lacks `leave` (a re-run leaves it alone). Cost if wrong: none for the rows —
--   every stored value stays valid under the new list. The sync is unchanged (mapStore writes active / inactive on a
--   new store only); vendors_guard_update still asks vendors.toggle = F for any status change.
-- Decision (decision 3): the login data is its own table, vendor_logins (one row per maker, pk vendor_id → vendors on
--   delete cascade), not columns on vendors: it has a life cycle of its own (invited → active → disabled) and the
--   portal phase will grow it. Read with vendors.view <> N; insert / update as admin or vendors.edit = F (the same
--   people who insert makers); no delete for the members — the cascade only (an admin deleting a maker without lines).
--   The column guard vendor_logins_guard (anon / authenticated only, before update): the client may change
--   username / email / pw_mode, and status to `invited` / `disabled` only — `active` belongs to the portal (the maker
--   set their own password); must_change / invite_sent_at / password_set_at / secret_id (and vendor_id / created_by /
--   created_at) are the server's → 42501 with one clear message per rule; every row write bumps updated_at.
-- Decision (decision 4): the temporary password is a Vault secret named 'vendor-login:<vendor uuid>'; vendor_logins
--   keeps only its id (secret_id), which the API roles never read (the select grant lists every other column, so
--   PostgREST `select=*` and `select=secret_id` are refused). The two definer functions (owner: the migration runner,
--   postgres; search_path pinned) check is_admin() or vendors.edit = F themselves (42501), apply the password rules on
--   the server too (22023: 8 characters at least, an English letter, a digit, no whitespace), create the secret the
--   first time (vault.create_secret) and update it after (vault.update_secret), and write one activity_log row per
--   call — vendor.login.password / vendor.login.reveal, entity 'vendor', entity_id the maker's uuid, new_value null:
--   the password is written nowhere but Vault. activity_log_actor stamps actor = auth.uid(), i.e. the caller (the
--   request's JWT claims, not the function owner). Without Vault (a plain local Postgres, CI) both raise 0A000
--   'vault is not available' after the permission / password / row checks, so the tests see the same codes everywhere.
-- Decision (decision 5): pw_mode = 'link' records the choice only; invite_sent_at stays null until the portal phase
--   sends the e-mail (an Edge Function with the Auth admin API — not designed yet). Nothing here sends anything.
-- Decision (this file): created_by is text — the member's display name, like vendor_rates.set_by and
--   vendor_bank.updated_by (the adapter writes actor.name). username must already be lowercase (the check), and the
--   unique index on lower(username) makes a duplicate 23505 whatever the case — the client shows
--   «اسم المستخدم ده مستخدم قبل كده». email is required (the prototype's validateLogin: the activation link and the
--   password reset go to it) and capped at 120 characters like the prototype's clean(). The password is capped at
--   128 characters (not in the plan's four rules; a defensive bound on what reaches Vault).
--
-- Notes for readers:
-- * Idempotent: every statement is guarded (if not exists / a pg_policies check / the constraint's definition) or
--   re-runnable (create or replace, grant / revoke); a second run changes nothing. The only drop is the constraint of
--   decision 6, and it runs only on the pre-0012 definition. No delete / truncate statements in this file.
-- * Column-level grants on vendor_logins for authenticated: SELECT on every column but secret_id; INSERT on
--   vendor_id, username, email, pw_mode, created_by (status / must_change take their defaults; the server columns
--   cannot be planted); UPDATE on username, email, pw_mode, status (the guard narrows status). No DELETE. A PostgREST
--   upsert (`on conflict do update` of every payload column) would need UPDATE on vendor_id / created_by, so the
--   adapter inserts when the maker has no row and patches when it has one. `returning *` is refused like on vendors
--   (writers ask for vendor_id).
-- * The guard applies to anon / authenticated only (phase-0 pattern): postgres / service_role and the two definer
--   functions (they run as their owner) pass it, and it still bumps updated_at for them.
-- * vendor_login_reveal writes its activity_log row before reading Vault and whether or not a password exists (a
--   maker without a login row or without a password → null, still logged): every call is on record. A failed call
--   (42501 / 22023 / 0A000) rolls its row back with the statement. Rate limiting is on the plan's Later list.
-- * The secret is never removed here: a maker deleted by cascade leaves their Vault row behind (the plan's Later list:
--   remove the secret when the maker sets their own password in the portal). A later set_password on the same maker
--   finds the row by secret_id, or by name when secret_id is null, and updates it.
-- * rule 4: explicit grants; no truncate / references / trigger for any API role on the new table; nothing for anon.

-- ---------------------------------------------------------------- vendors.status: active / leave / inactive (decision 6)

-- 0007 declared the check inline, so it carries the default name vendors_status_check. While its definition lacks
-- `leave` it is dropped and re-added in the same DO block; once it lists the three values, nothing happens.
do $$
declare def text;
begin
  select pg_get_constraintdef(c.oid) into def
  from pg_constraint c
  where c.conrelid = 'public.vendors'::regclass and c.conname = 'vendors_status_check' and c.contype = 'c';
  if def is not null and def not like '%leave%' then
    -- decision 6: the one written drop of this phase (a constraint, not data; re-added right below)
    alter table public.vendors drop constraint vendors_status_check;
    def := null;
  end if;
  if def is null then
    alter table public.vendors add constraint vendors_status_check check (status in ('active', 'leave', 'inactive'));
  end if;
end $$;

-- ---------------------------------------------------------------- vendor_logins: the maker's portal login

create table if not exists public.vendor_logins (
  vendor_id uuid primary key references public.vendors (id) on delete cascade,
  username text not null check (username ~ '^[a-z0-9][a-z0-9._]{2,29}$'),
  email text not null check (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' and length(email) <= 120),
  pw_mode text not null default 'link' check (pw_mode in ('link', 'temp')),
  status text not null default 'invited' check (status in ('invited', 'active', 'disabled')),
  must_change boolean not null default true,
  invite_sent_at timestamptz,
  password_set_at timestamptz,
  secret_id uuid,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- one username per maker, whatever the case (23505 on a duplicate)
create unique index if not exists vendor_logins_username_key on public.vendor_logins (lower(username));

alter table public.vendor_logins enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vendor_logins' and policyname = 'vendor_logins_select') then
    create policy vendor_logins_select on public.vendor_logins for select to authenticated
      using ((select public.has_perm('vendors.view')) <> 'N');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vendor_logins' and policyname = 'vendor_logins_insert') then
    create policy vendor_logins_insert on public.vendor_logins for insert to authenticated
      with check ((select public.is_admin()) or (select public.has_perm('vendors.edit')) = 'F');
  end if;
  -- using = who may see the row (vendors.view), with check = who may change it: a member who sees a row but may not
  -- change it gets 42501, never a silent "0 rows" (the 0011 pattern on vendors).
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vendor_logins' and policyname = 'vendor_logins_update') then
    create policy vendor_logins_update on public.vendor_logins for update to authenticated
      using ((select public.has_perm('vendors.view')) <> 'N')
      with check ((select public.is_admin()) or (select public.has_perm('vendors.edit')) = 'F');
  end if;
end $$;

-- rule 4: grants by column list for the members (never secret_id), everything for the server, no delete for anyone
-- but the server, no truncate / references / trigger for any API role, nothing for anon.
grant select (vendor_id, username, email, pw_mode, status, must_change, invite_sent_at, password_set_at, created_by,
              created_at, updated_at)
  on public.vendor_logins to authenticated;
grant insert (vendor_id, username, email, pw_mode, created_by) on public.vendor_logins to authenticated;
grant update (username, email, pw_mode, status) on public.vendor_logins to authenticated;
grant all on public.vendor_logins to service_role;
revoke truncate, references, trigger on public.vendor_logins from anon, authenticated, service_role;

-- ---------------------------------------------------------------- vendor_logins: the column guard (decision 3)

-- API roles: username / email / pw_mode may change; status may become invited or disabled (active is the portal's);
-- every other column (vendor_id, must_change, invite_sent_at, password_set_at, secret_id, created_by, created_at,
-- updated_at) is the server's → 42501. One clear message per rule, in this order.
create or replace function public.vendor_logins_guard() returns trigger
language plpgsql set search_path = public as $$
declare
  client_cols constant text[] := array['username', 'email', 'pw_mode', 'status'];
begin
  if current_user in ('anon', 'authenticated') then
    if (to_jsonb(new) - client_cols) is distinct from (to_jsonb(old) - client_cols) then
      raise exception 'vendor login columns owned by the server (must_change, invite_sent_at, password_set_at, secret_id, vendor_id, created_by, created_at, updated_at) cannot be changed here' using errcode = '42501';
    end if;
    if new.status is distinct from old.status and new.status = 'active' then
      raise exception 'a vendor login becomes active through the portal only (the maker sets their own password); the client may set invited or disabled' using errcode = '42501';
    end if;
  end if;
  -- Every row write bumps updated_at (a BEFORE trigger may set a column the caller cannot update): the members, the
  -- server and the two definer functions alike; after the comparison above, so rule 1 still sees the stored value.
  new.updated_at := now();
  return new;
end
$$;

create or replace trigger vendor_logins_guard before update on public.vendor_logins
  for each row execute function public.vendor_logins_guard();

revoke execute on function public.vendor_logins_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------- the temporary password: Vault (decision 4)

-- Sets (or replaces) the maker's temporary password: admin or vendors.edit = F (else 42501); the password rules
-- (22023); the maker must have a login row (P0002); Vault must exist (0A000). The secret is created the first time
-- and updated after; the row gets secret_id, password_set_at = now(), must_change = true, pw_mode = 'temp'; one
-- activity_log row (vendor.login.password, actor = the caller, new_value null). Returns password_set_at.
create or replace function public.vendor_login_set_password(p_vendor uuid, p_password text) returns timestamptz
language plpgsql volatile security definer set search_path = public as $$
declare
  v_name constant text := 'vendor-login:' || coalesce(p_vendor::text, '');
  v_secret uuid;
  v_at timestamptz;
begin
  if not (public.is_admin() or public.has_perm('vendors.edit') = 'F') then
    raise exception 'vendors.edit = F (or admin) is required to set a maker login password' using errcode = '42501';
  end if;
  if p_password is null or length(p_password) < 8 then
    raise exception 'the password must be at least 8 characters' using errcode = '22023';
  end if;
  if length(p_password) > 128 then
    raise exception 'the password must be at most 128 characters' using errcode = '22023';
  end if;
  if p_password !~ '[A-Za-z]' then
    raise exception 'the password must contain an English letter' using errcode = '22023';
  end if;
  if p_password !~ '[0-9]' then
    raise exception 'the password must contain a digit' using errcode = '22023';
  end if;
  if p_password ~ '[[:space:]]' then
    raise exception 'the password must not contain spaces' using errcode = '22023';
  end if;
  if p_vendor is null or not exists (select 1 from public.vendor_logins l where l.vendor_id = p_vendor) then
    raise exception 'the maker has no login row' using errcode = 'P0002';
  end if;
  if to_regclass('vault.decrypted_secrets') is null then
    raise exception 'vault is not available' using errcode = '0A000';
  end if;

  select l.secret_id into v_secret from public.vendor_logins l where l.vendor_id = p_vendor for update;
  if v_secret is not null and not exists (select 1 from vault.secrets s where s.id = v_secret) then
    v_secret := null; -- the secret went away outside this file: a new one is made below
  end if;
  if v_secret is null then
    select s.id into v_secret from vault.secrets s where s.name = v_name; -- a secret of that name without a row id
  end if;
  if v_secret is null then
    v_secret := vault.create_secret(p_password, v_name, 'temporary portal password of a maker (0012_vendor_logins)');
  else
    perform vault.update_secret(v_secret, p_password);
  end if;

  v_at := now();
  update public.vendor_logins
  set secret_id = v_secret, password_set_at = v_at, must_change = true, pw_mode = 'temp'
  where vendor_id = p_vendor;

  insert into public.activity_log (action, entity, entity_id, old_value, new_value)
  values ('vendor.login.password', 'vendor', p_vendor::text, null, null);
  return v_at;
end
$$;

-- Returns the maker's temporary password from Vault (null when the maker has no login row or no password yet):
-- admin or vendors.edit = F (else 42501); Vault must exist (0A000). Every call writes one activity_log row
-- (vendor.login.reveal, actor = the caller, new_value null) — before the read, so a call is on record even when it
-- returns null. The value goes to the caller only: never into activity_log, a table column or a log line.
create or replace function public.vendor_login_reveal(p_vendor uuid) returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  v_secret uuid;
  v_value text;
begin
  if not (public.is_admin() or public.has_perm('vendors.edit') = 'F') then
    raise exception 'vendors.edit = F (or admin) is required to reveal a maker login password' using errcode = '42501';
  end if;
  if to_regclass('vault.decrypted_secrets') is null then
    raise exception 'vault is not available' using errcode = '0A000';
  end if;

  insert into public.activity_log (action, entity, entity_id, old_value, new_value)
  values ('vendor.login.reveal', 'vendor', p_vendor::text, null, null);

  select l.secret_id into v_secret from public.vendor_logins l where l.vendor_id = p_vendor;
  if v_secret is null then
    return null;
  end if;
  select s.decrypted_secret into v_value from vault.decrypted_secrets s where s.id = v_secret;
  return v_value;
end
$$;

revoke execute on function public.vendor_login_set_password(uuid, text) from public, anon;
revoke execute on function public.vendor_login_reveal(uuid) from public, anon;
grant execute on function public.vendor_login_set_password(uuid, text) to authenticated, service_role;
grant execute on function public.vendor_login_reveal(uuid) to authenticated, service_role;
