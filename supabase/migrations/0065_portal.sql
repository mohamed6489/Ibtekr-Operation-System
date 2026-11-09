-- 0065_portal — phase 13 T4 (docs/superpowers/plans/2026-11-09-phase-13-leftovers.md, decision 10): the maker portal's door.
-- The maker is NOT a Supabase Auth user: the Edge Function `portal` (service_role) checks the username / e-mail and the password
-- against vendor_logins and the Vault secret vendor-login:<uuid> through these definer functions, then signs its own short JWT
-- (HS256 with the Vault secret app_portal_jwt). Everything here is service_role only (the claims' role is checked inside, like
-- cs_secret_get of 0035); a member or anon gets 42501.
-- * vendor_logins: fails / locked_until (5 wrong tries lock the login 15 minutes), own_password (the maker set their own password —
--   from then on vendor_login_reveal answers null to the team), last_login_at. The guard of 0012 already keeps the members off
--   every column it does not list, so the new columns are the server's; the members may read them (the drawer shows the state).
-- * vendor_login_resets: «نسيت الباسورد» — the sha-256 of a one-time token (30 minutes), never the token; service_role only.
-- * vendor_login_check(user, password) → jsonb { ok, vendor_id, must_change, own_password } or { ok: false, reason: wrong | locked |
--   disabled | nopw, left?, until? }: the secret and the typed password are compared through their sha-256 digests (the same work
--   whatever the match), a wrong try counts, the fifth locks; a success resets the count and writes last_login_at.
-- * vendor_login_set_own(vendor, password): the password rules of 0012, the Vault secret made or replaced, the row active with
--   must_change = false and own_password = true, the count reset.
-- * vendor_login_reset_create(user) → { vendor_id, email, name, token } (null when no login matches — the function answers «لو
--   الحساب موجود» either way); vendor_login_reset_use(token, password) → vendor_id (P0002 when the token is unknown, used or old).
-- * portal_jwt_secret() → the signing secret of the portal's tokens, made at random the first time (Vault app_portal_jwt).
-- * vendor_login_reveal (0012) re-created: null once own_password is set — the team knows temporary passwords only.
-- Every function: security definer + set search_path + revoke from public / anon (+ authenticated) + explicit grants (rule 4);
-- activity_log rows carry the maker's uuid only (portal.login / portal.locked / portal.password / portal.reset.request /
-- portal.reset) — never a password, a token or an e-mail. Re-runnable. Without Vault (a plain Postgres, CI) the functions that
-- read or write a secret raise 0A000 after their own checks, like 0012.

alter table public.vendor_logins
  add column if not exists fails integer not null default 0 check (fails >= 0 and fails <= 10),
  add column if not exists locked_until timestamptz,
  add column if not exists own_password boolean not null default false,
  add column if not exists last_login_at timestamptz;
grant select (fails, locked_until, own_password, last_login_at) on public.vendor_logins to authenticated;

create table if not exists public.vendor_login_resets (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendor_logins (vendor_id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists vendor_login_resets_vendor_idx on public.vendor_login_resets (vendor_id);
alter table public.vendor_login_resets enable row level security;
revoke all on public.vendor_login_resets from public, anon, authenticated;
grant select, insert, update, delete on public.vendor_login_resets to service_role;

-- the password rules of 0012 (the server's copy): 8–128 characters, an English letter, a digit, no whitespace → 22023
create or replace function public.portal_password_check(p_password text) returns void
language plpgsql immutable set search_path = public as $$
begin
  if p_password is null or length(p_password) < 8 then raise exception 'the password must be at least 8 characters' using errcode = '22023'; end if;
  if length(p_password) > 128 then raise exception 'the password must be at most 128 characters' using errcode = '22023'; end if;
  if p_password !~ '[A-Za-z]' then raise exception 'the password must contain an English letter' using errcode = '22023'; end if;
  if p_password !~ '[0-9]' then raise exception 'the password must contain a digit' using errcode = '22023'; end if;
  if p_password ~ ('[[:space:]' || chr(160) || ']') then raise exception 'the password must not contain spaces' using errcode = '22023'; end if;
end
$$;
revoke execute on function public.portal_password_check(text) from public, anon, authenticated;
grant execute on function public.portal_password_check(text) to service_role;

-- service_role only (the claims' role, like 0035's cs_secret_get) → 42501
create or replace function public.portal_service_only() returns void
language plpgsql stable set search_path = public as $$
begin
  if coalesce(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' is distinct from 'service_role' then
    raise exception 'service_role only' using errcode = '42501';
  end if;
end
$$;
revoke execute on function public.portal_service_only() from public, anon, authenticated;
grant execute on function public.portal_service_only() to service_role;

-- ---------------------------------------------------------------- the sign-in check
create or replace function public.vendor_login_check(p_user text, p_password text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  r record;
  v_secret text;
  v_user text := lower(btrim(coalesce(p_user, '')));
begin
  perform public.portal_service_only();
  if v_user = '' or length(v_user) > 160 or p_password is null or length(p_password) > 128 then
    return jsonb_build_object('ok', false, 'reason', 'wrong');
  end if;
  select l.vendor_id, l.status, l.must_change, l.own_password, l.secret_id, l.fails, l.locked_until, v.status as vendor_status
  into r
  from public.vendor_logins l join public.vendors v on v.id = l.vendor_id
  where lower(l.username) = v_user or lower(l.email) = v_user
  order by (lower(l.username) = v_user) desc
  limit 1
  for update of l;
  if not found then return jsonb_build_object('ok', false, 'reason', 'wrong'); end if;
  if r.status = 'disabled' or r.vendor_status = 'inactive' then return jsonb_build_object('ok', false, 'reason', 'disabled'); end if;
  if r.locked_until is not null and r.locked_until > now() then return jsonb_build_object('ok', false, 'reason', 'locked', 'until', r.locked_until); end if;
  if r.secret_id is null then return jsonb_build_object('ok', false, 'reason', 'nopw'); end if;
  if to_regclass('vault.decrypted_secrets') is null then raise exception 'vault is not available' using errcode = '0A000'; end if;
  select s.decrypted_secret into v_secret from vault.decrypted_secrets s where s.id = r.secret_id;
  -- the digests are compared, not the strings: the same work whatever the position of the first difference
  if v_secret is null or sha256(convert_to(v_secret, 'UTF8')) <> sha256(convert_to(p_password, 'UTF8')) then
    if r.fails + 1 >= 5 then
      update public.vendor_logins set fails = 0, locked_until = now() + interval '15 minutes' where vendor_id = r.vendor_id;
      insert into public.activity_log (action, entity, entity_id) values ('portal.locked', 'vendor', r.vendor_id::text);
      return jsonb_build_object('ok', false, 'reason', 'locked', 'until', now() + interval '15 minutes');
    end if;
    update public.vendor_logins set fails = fails + 1 where vendor_id = r.vendor_id;
    return jsonb_build_object('ok', false, 'reason', 'wrong', 'left', 5 - (r.fails + 1));
  end if;
  update public.vendor_logins set fails = 0, locked_until = null, last_login_at = now() where vendor_id = r.vendor_id;
  insert into public.activity_log (action, entity, entity_id) values ('portal.login', 'vendor', r.vendor_id::text);
  return jsonb_build_object('ok', true, 'vendor_id', r.vendor_id, 'must_change', r.must_change, 'own_password', r.own_password);
end
$$;

-- ---------------------------------------------------------------- the maker's own password
create or replace function public.vendor_login_set_own(p_vendor uuid, p_password text) returns timestamptz
language plpgsql volatile security definer set search_path = public as $$
declare
  v_name constant text := 'vendor-login:' || coalesce(p_vendor::text, '');
  v_secret uuid;
  v_status text;
  v_at timestamptz;
begin
  perform public.portal_service_only();
  perform public.portal_password_check(p_password);
  select l.secret_id, l.status into v_secret, v_status from public.vendor_logins l where l.vendor_id = p_vendor for update;
  if not found then raise exception 'the maker has no login row' using errcode = 'P0002'; end if;
  if v_status = 'disabled' then raise exception 'the login is disabled' using errcode = '42501'; end if;
  if to_regclass('vault.decrypted_secrets') is null then raise exception 'vault is not available' using errcode = '0A000'; end if;
  if v_secret is not null and not exists (select 1 from vault.secrets s where s.id = v_secret) then v_secret := null; end if;
  if v_secret is null then select s.id into v_secret from vault.secrets s where s.name = v_name; end if;
  if v_secret is null then
    v_secret := vault.create_secret(p_password, v_name, 'portal password of a maker (0065_portal)');
  else
    perform vault.update_secret(v_secret, p_password);
  end if;
  v_at := now();
  update public.vendor_logins
  set secret_id = v_secret, password_set_at = v_at, must_change = false, own_password = true, status = 'active', fails = 0, locked_until = null
  where vendor_id = p_vendor;
  insert into public.activity_log (action, entity, entity_id) values ('portal.password', 'vendor', p_vendor::text);
  return v_at;
end
$$;

-- ---------------------------------------------------------------- «نسيت الباسورد»: a one-time token, its hash kept 30 minutes
create or replace function public.vendor_login_reset_create(p_user text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  r record;
  v_user text := lower(btrim(coalesce(p_user, '')));
  v_token text;
begin
  perform public.portal_service_only();
  if v_user = '' or length(v_user) > 160 then return null; end if;
  select l.vendor_id, l.email, v.name
  into r
  from public.vendor_logins l join public.vendors v on v.id = l.vendor_id
  where (lower(l.username) = v_user or lower(l.email) = v_user) and l.status <> 'disabled' and v.status <> 'inactive'
  order by (lower(l.username) = v_user) desc
  limit 1;
  if not found then return null; end if;
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  update public.vendor_login_resets set used_at = now() where vendor_id = r.vendor_id and used_at is null;
  insert into public.vendor_login_resets (vendor_id, token_hash, expires_at)
  values (r.vendor_id, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), now() + interval '30 minutes');
  insert into public.activity_log (action, entity, entity_id) values ('portal.reset.request', 'vendor', r.vendor_id::text);
  return jsonb_build_object('vendor_id', r.vendor_id, 'email', r.email, 'name', r.name, 'token', v_token);
end
$$;

create or replace function public.vendor_login_reset_use(p_token text, p_password text) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  v_id uuid;
  v_vendor uuid;
begin
  perform public.portal_service_only();
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception 'reset link invalid or expired' using errcode = 'P0002'; end if;
  select t.id, t.vendor_id into v_id, v_vendor
  from public.vendor_login_resets t
  where t.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') and t.used_at is null and t.expires_at > now()
  for update;
  if not found then raise exception 'reset link invalid or expired' using errcode = 'P0002'; end if;
  perform public.vendor_login_set_own(v_vendor, p_password);
  update public.vendor_login_resets set used_at = now() where id = v_id;
  insert into public.activity_log (action, entity, entity_id) values ('portal.reset', 'vendor', v_vendor::text);
  return v_vendor;
end
$$;

-- ---------------------------------------------------------------- the portal's token secret (Vault app_portal_jwt)
create or replace function public.portal_jwt_secret() returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  v_value text;
begin
  perform public.portal_service_only();
  if to_regclass('vault.decrypted_secrets') is null then raise exception 'vault is not available' using errcode = '0A000'; end if;
  select s.decrypted_secret into v_value from vault.decrypted_secrets s where s.name = 'app_portal_jwt';
  if v_value is null then
    v_value := replace(gen_random_uuid()::text || gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    perform vault.create_secret(v_value, 'app_portal_jwt', 'signing secret of the maker portal tokens (0065_portal)');
  end if;
  return v_value;
end
$$;

revoke execute on function public.vendor_login_check(text, text) from public, anon, authenticated;
revoke execute on function public.vendor_login_set_own(uuid, text) from public, anon, authenticated;
revoke execute on function public.vendor_login_reset_create(text) from public, anon, authenticated;
revoke execute on function public.vendor_login_reset_use(text, text) from public, anon, authenticated;
revoke execute on function public.portal_jwt_secret() from public, anon, authenticated;
grant execute on function public.vendor_login_check(text, text), public.vendor_login_set_own(uuid, text), public.vendor_login_reset_create(text),
  public.vendor_login_reset_use(text, text), public.portal_jwt_secret() to service_role;

-- ---------------------------------------------------------------- vendor_login_reveal (0012): nothing once the maker set their own password
create or replace function public.vendor_login_reveal(p_vendor uuid) returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  v_secret uuid;
  v_own boolean;
  v_value text;
begin
  if not (public.is_admin() or (public.has_perm('vendors.edit') = 'F' and public.has_perm('vendors.view') <> 'N')) then
    raise exception 'vendors.edit = F (or admin) is required to reveal a maker login password' using errcode = '42501';
  end if;
  if to_regclass('vault.decrypted_secrets') is null then
    raise exception 'vault is not available' using errcode = '0A000';
  end if;

  insert into public.activity_log (action, entity, entity_id, old_value, new_value)
  values ('vendor.login.reveal', 'vendor', p_vendor::text, null, null);

  select l.secret_id, l.own_password into v_secret, v_own from public.vendor_logins l where l.vendor_id = p_vendor;
  if v_secret is null or coalesce(v_own, false) then
    return null; -- no password yet, or the maker's own: the team is told temporary passwords only
  end if;
  select s.decrypted_secret into v_value from vault.decrypted_secrets s where s.id = v_secret;
  return v_value;
end
$$;
