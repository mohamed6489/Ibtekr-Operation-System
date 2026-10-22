-- 0001_identity: roles, profiles, invites; is_admin / has_perm / email_for_identifier; RLS.
-- Permissions are data: roles.permissions and profiles.custom_perms map a key
-- (e.g. 'orders.edit') to 'F' (full) | 'P' (partial) | 'N' (none).

-- ---------------------------------------------------------------- tables

create table public.roles (
  id text primary key,
  name text unique not null,
  description text,
  is_system boolean default false,
  permissions jsonb not null default '{}',
  sort int
);

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  member_code text unique,
  name text not null,
  email text unique not null,
  phone text unique,
  role_id text references public.roles,
  title text,
  dept text,
  manager_id uuid references public.profiles,
  status text not null default 'active' check (status in ('active', 'suspended', 'invited')),
  twofa boolean default false,
  custom_perms jsonb default '{}',
  created_at timestamptz default now()
);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  email text,
  role_id text references public.roles,
  token text unique,
  expires_at timestamptz default now() + interval '7 days',
  accepted_at timestamptz,
  created_by uuid
);

alter table public.roles enable row level security;
alter table public.profiles enable row level security;
alter table public.invites enable row level security;

-- ---------------------------------------------------------------- functions

-- Global throttle for email_for_identifier. Only that definer function touches it:
-- RLS on with no policies, and no grants to the API roles.
create table public.login_lookups (
  at timestamptz not null default now()
);
alter table public.login_lookups enable row level security;
revoke all on public.login_lookups from public, anon, authenticated;

-- True when the signed-in user's profile is an active admin.
create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role_id = 'admin' and status = 'active'
  )
$$;

-- 'F' | 'P' | 'N' for the signed-in user: not active (suspended/invited) → 'N';
-- admin → 'F'; else a custom_perms entry (when the key is present, even 'N');
-- else the role's entry; else 'N'.
create function public.has_perm(key text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when p.status <> 'active' then 'N'
      when p.role_id = 'admin' then 'F'
      when p.custom_perms ? key then p.custom_perms ->> key
      else r.permissions ->> key
    end
    from public.profiles p
    left join public.roles r on r.id = p.role_id
    where p.id = auth.uid()
  ), 'N')
$$;

-- Login lookup (called with the anon key): an email or an 11-digit mobile number
-- → that account's email and status only. Exact match on the normalized value:
-- email = lower(btrim(ident)); phone = ident without spaces and '-'.
-- Throttled globally: more than 60 calls in one minute raises
--   SQLSTATE P0001, message exactly 'rate_limited'  (the client matches on this).
-- Volatile because it writes to login_lookups.
create function public.email_for_identifier(ident text)
returns table (email text, status text)
language plpgsql volatile security definer set search_path = public as $$
declare
  e text := lower(btrim(coalesce(ident, '')));
  d text := regexp_replace(coalesce(ident, ''), '[[:space:]-]', '', 'g');
begin
  delete from public.login_lookups where at < now() - interval '1 minute';
  insert into public.login_lookups default values;
  if (select count(*) from public.login_lookups where at >= now() - interval '1 minute') > 60 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  if position('@' in e) > 0 then
    return query select p.email, p.status from public.profiles p where lower(p.email) = e limit 1;
  elsif d ~ '^[0-9]{11}$' then
    return query select p.email, p.status from public.profiles p where p.phone = d limit 1;
  end if;
end
$$;

-- Non-admins may change only name, phone and twofa on a profile (their own, per RLS).
-- Enforced only for API roles; postgres / service_role (migrations, server jobs) are trusted.
create function public.profiles_guard_update() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('anon', 'authenticated') and not public.is_admin()
     and (to_jsonb(new) - 'name' - 'phone' - 'twofa') is distinct from (to_jsonb(old) - 'name' - 'phone' - 'twofa') then
    raise exception 'only an admin can change this profile field' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger profiles_guard_update before update on public.profiles
  for each row execute function public.profiles_guard_update();

-- Function grants: anon gets only the login lookup.
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.has_perm(text) from public, anon;
revoke execute on function public.profiles_guard_update() from public, anon, authenticated;
revoke execute on function public.email_for_identifier(text) from public;
grant execute on function public.is_admin() to authenticated, service_role;
grant execute on function public.has_perm(text) to authenticated, service_role;
grant execute on function public.email_for_identifier(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------- policies

-- profiles: read own row, or all rows with settings.view; update own row (column
-- limits in the trigger) or any row as admin; insert/delete admin only.
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.has_perm('settings.view') <> 'N');
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());
create policy profiles_insert on public.profiles for insert to authenticated
  with check (public.is_admin());
create policy profiles_delete on public.profiles for delete to authenticated
  using (public.is_admin());

-- roles: any signed-in user reads; admin writes.
create policy roles_select on public.roles for select to authenticated using (true);
create policy roles_insert on public.roles for insert to authenticated with check (public.is_admin());
create policy roles_update on public.roles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy roles_delete on public.roles for delete to authenticated using (public.is_admin());

-- invites: admin only.
create policy invites_admin on public.invites for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
