-- 0008_mfa_cron: aal2 required inside has_perm / is_admin for members enrolled in 2FA; mark_twofa_enrolled /
-- mark_twofa_disabled; sync_secret_matches; Vault sync_secret + pg_cron backup sync every 15 minutes (guarded).
-- Uses profiles / has_perm / is_admin (0001) and the woo-sync contract of Task 4 (X-Sync-Secret → sync_secret_matches).
--
-- Decision: the aal2 rule lives inside has_perm / is_admin (one place) instead of in every policy. Why: every policy
--   and guard goes through them. Cost if wrong: one more auth.jwt() read per evaluation.
-- Decision: backup codes are out of scope (Supabase has no native ones); recovery = an admin removes the factor in the
--   Supabase dashboard (Authentication › Users › factors) and sets profiles.twofa = false.
--
-- Notes for readers:
-- * has_perm / is_admin keep their signatures, volatility, security definer, search_path and grants (create or replace
--   keeps the ACL; the grants of 0001 are restated). New branch only: profiles.twofa = true and the JWT's aal claim
--   (missing → aal1) is not aal2 → 'N' / false. A member with twofa = false is unaffected.
-- * profiles.twofa stays admin-only for direct updates (profiles_guard_update, 0001). The member flips it through the
--   two definer RPCs below, which require an aal2 session (enrolled: also a verified factor of their own in
--   auth.mfa_factors); else SQLSTATE 42501, message exactly 'aal2_required' (the client matches on it).
-- * sync_secret_matches always exists. Without Vault (the local stub) or without the secret it answers false.
--   It compares SHA-256 digests byte by byte with an XOR accumulator: the time does not depend on where a guess differs.
-- * Vault + pg_cron + pg_net run only where the three extensions are available (Supabase; the local stub skips them).
--   The secret is generated inside Postgres once (never in this file, never printed); the cron body reads it from
--   vault.decrypted_secrets at run time. A re-run unschedules the existing 'woo-sync-backup' job first, so there is
--   always one. Every 15 minutes = the prototype's default backup interval (the settings page of phase 10 changes it).
-- * The cron body posts to the project's public functions URL, written inline
--   (https://fsynculhaupcktzkfkdd.supabase.co/functions/v1/woo-sync; the project ref is public in app/config.js). Only
--   X-Sync-Secret is secret, and it stays in Vault. Ruling (T7 review): no custom database setting (app.*) — on Supabase
--   the postgres role may not `alter database … set` a placeholder parameter, and every run would fail with 42704.

-- ---------------------------------------------------------------- has_perm / is_admin (aal2 for enrolled members)

-- True when the signed-in user's profile is an active admin, at aal2 when enrolled in 2FA.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role_id = 'admin' and status = 'active'
      and not (coalesce(twofa, false) and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2')
  )
$$;

-- 'F' | 'P' | 'N' for the signed-in user: not active (suspended/invited) → 'N'; enrolled in 2FA (twofa) on a session
-- that is not aal2 → 'N'; admin → 'F'; else a custom_perms entry (when the key is present, even 'N'); else the role's
-- entry; else 'N'.
create or replace function public.has_perm(key text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when p.status <> 'active' then 'N'
      when coalesce(p.twofa, false) and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then 'N'
      when p.role_id = 'admin' then 'F'
      when p.custom_perms ? key then p.custom_perms ->> key
      else r.permissions ->> key
    end
    from public.profiles p
    left join public.roles r on r.id = p.role_id
    where p.id = auth.uid()
  ), 'N')
$$;

revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.has_perm(text) from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;
grant execute on function public.has_perm(text) to authenticated, service_role;

-- ---------------------------------------------------------------- 2FA enrolment RPCs

-- After a successful TOTP verify (the session is aal2 and the caller has a verified TOTP factor; another verified factor
-- type does not count): profiles.twofa = true for the caller.
create or replace function public.mark_twofa_enrolled() returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null
     or coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2'
     or not exists (select 1 from auth.mfa_factors f
                    where f.user_id = auth.uid() and f.factor_type = 'totp' and f.status = 'verified') then
    raise exception 'aal2_required' using errcode = '42501';
  end if;
  update public.profiles set twofa = true where id = auth.uid();
end
$$;

-- Before the factor is removed (the session is still aal2): profiles.twofa = false for the caller.
create or replace function public.mark_twofa_disabled() returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null or coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'aal2_required' using errcode = '42501';
  end if;
  update public.profiles set twofa = false where id = auth.uid();
end
$$;

revoke execute on function public.mark_twofa_enrolled() from public, anon, service_role;
revoke execute on function public.mark_twofa_disabled() from public, anon, service_role;
grant execute on function public.mark_twofa_enrolled() to authenticated;
grant execute on function public.mark_twofa_disabled() to authenticated;

-- ---------------------------------------------------------------- sync_secret_matches (woo-sync, service_role)

-- woo-sync's X-Sync-Secret check: true only when `candidate` equals Vault's sync_secret.
create or replace function public.sync_secret_matches(candidate text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  secret text; a bytea; b bytea; diff int := 0;
begin
  if candidate is null or candidate = '' or to_regclass('vault.decrypted_secrets') is null then
    return false;
  end if;
  select s.decrypted_secret into secret from vault.decrypted_secrets s where s.name = 'sync_secret';
  if secret is null or secret = '' then
    return false;
  end if;
  a := sha256(convert_to(candidate, 'UTF8'));
  b := sha256(convert_to(secret, 'UTF8'));
  for i in 0 .. 31 loop
    diff := diff | (get_byte(a, i) # get_byte(b, i));
  end loop;
  return diff = 0;
end
$$;

revoke execute on function public.sync_secret_matches(text) from public, anon, authenticated;
grant execute on function public.sync_secret_matches(text) to service_role;

-- ---------------------------------------------------------------- Vault secret + pg_cron backup sync (guarded)

do $$
declare
  rnd_schema text;
begin
  if not (exists (select 1 from pg_available_extensions where name = 'pg_cron')
          and exists (select 1 from pg_available_extensions where name = 'pg_net')
          and exists (select 1 from pg_available_extensions where name = 'supabase_vault')) then
    raise notice '0008_mfa_cron: pg_cron / pg_net / supabase_vault not available — Vault secret and backup sync skipped';
    return;
  end if;

  create extension if not exists pg_cron with schema pg_catalog;
  create extension if not exists pg_net with schema extensions;
  create extension if not exists supabase_vault with schema vault;

  -- the shared secret: 32 random bytes as hex, generated here once and kept in Vault (pgcrypto's gen_random_bytes(integer)
  -- looked up: 'extensions' on Supabase, else wherever pgcrypto is installed)
  if not exists (select 1 from vault.secrets where name = 'sync_secret') then
    select n.nspname into rnd_schema from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      join pg_extension e on e.extname = 'pgcrypto' and e.extnamespace = n.oid
      where p.proname = 'gen_random_bytes' and p.proargtypes = '23'::oidvector -- (integer)
      order by (n.nspname = 'extensions') desc limit 1;
    if rnd_schema is null then
      create extension if not exists pgcrypto with schema extensions;
      rnd_schema := 'extensions';
    end if;
    execute format($f$select vault.create_secret(encode(%I.gen_random_bytes(32), 'hex'), 'sync_secret',
                     'woo-sync X-Sync-Secret for the pg_cron backup sync (0008_mfa_cron)')$f$, rnd_schema);
  end if;

  -- every 15 minutes: woo-sync action 'all' (vendors, products, orders) with the secret read from Vault at run time
  if exists (select 1 from cron.job where jobname = 'woo-sync-backup') then
    perform cron.unschedule('woo-sync-backup');
  end if;
  perform cron.schedule('woo-sync-backup', '*/15 * * * *', $cron$
    select net.http_post(
      url := 'https://fsynculhaupcktzkfkdd.supabase.co/functions/v1/woo-sync',
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'X-Sync-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_secret')),
      body := '{"action":"all"}'::jsonb,
      timeout_milliseconds := 150000
    )
  $cron$);
end $$;
