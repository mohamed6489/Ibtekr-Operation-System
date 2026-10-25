-- LOCAL ONLY. NEVER run this on Supabase.
-- A minimal stand-in for what a fresh Supabase project already has (API roles,
-- the auth schema, auth.users/auth.identities/auth.mfa_factors, auth.uid()/role()/jwt() (claims may carry "aal") and the
-- default grants), so supabase/migrations and supabase/tests run unchanged on a
-- plain local Postgres via `tools/db-test.sh --stub`.

do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin', r);
    end if;
  end loop;
end $$;

create schema if not exists auth;

create table auth.users (
  id uuid primary key,
  email text,
  encrypted_password text,
  phone text,
  raw_user_meta_data jsonb,
  created_at timestamptz default now()
);

create table auth.identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade,
  provider text not null,
  provider_id text not null,
  identity_data jsonb not null
);

-- MFA factors (0008_mfa_cron reads the verified ones). Live: factor_type / status are enums (auth.factor_type,
-- auth.factor_status) plus more columns; text here, the literals 'totp' / 'verified' compare the same on both.
create table auth.mfa_factors (
  id uuid primary key,
  user_id uuid not null references auth.users on delete cascade,
  friendly_name text,
  factor_type text not null,
  status text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;

create function auth.role() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  )::text
$$;

create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

grant usage on schema public, auth to anon, authenticated, service_role;

-- Default privileges as observed on the live project (fsynculhaupcktzkfkdd, 2026-10-22): new tables
-- give the API roles only TRUNCATE/REFERENCES/TRIGGER, no DML — every migration must grant DML
-- explicitly (see 0004_grants.sql). Functions default to EXECUTE for PUBLIC (plain Postgres).
alter default privileges in schema public grant truncate, references, trigger on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
