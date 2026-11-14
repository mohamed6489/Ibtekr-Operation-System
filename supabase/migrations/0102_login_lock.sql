-- 0102 — owner batch 2 decision 27 (docs/superpowers/plans/2026-11-14-owner-batch-2.md): the login lock — the attempts (5) and the lock
-- (15 minutes) from «الإعدادات › الأمان» (settings «security».lockAttempts 3–10 · lockMinutes 5–1440), a counter on the server before
-- the sign-in, and the admin unlocks a member.
-- * login_failures: one row per sign-in identity = sha256 of the account's email (a phone of a member counts as his email, so both
--   ways share one counter; an unknown identifier counts as itself — the same answer either way, no account oracle). No raw
--   identifier is stored. No member reads or writes the table; the RPCs below are the only way.
-- * login_gate(ident) → { locked, minutes } before the sign-in; login_failed(ident) → { locked, left, minutes } after a wrong
--   password (a failure older than the lock window starts a fresh count); both anon (the login screen) and throttled with
--   0001's login_lookups (more than 120 calls a minute → 'rate_limited').
-- * login_cleared() — the signed-in member's own counter goes back to 0.
-- * login_locks() / login_unlock(member) — the admin sees the locked members and unlocks one (activity_log settings.login.unlock).
-- Note: the lock guards the login screen; a direct call to Supabase Auth stays under its own limits.

create table if not exists public.login_failures (
  key text primary key check (key ~ '^[0-9a-f]{64}$'),
  fails int not null default 0 check (fails >= 0),
  locked_until timestamptz,
  last_at timestamptz not null default now()
);
alter table public.login_failures enable row level security;
revoke all on public.login_failures from public, anon, authenticated;
grant select, insert, update, delete on public.login_failures to service_role;

-- the policy: { attempts, minutes } from settings «security» (else 5 / 15)
create or replace function public.login_policy() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'attempts', coalesce((select case when (s.data ->> 'lockAttempts') ~ '^[0-9]{1,2}$' and (s.data ->> 'lockAttempts')::int between 3 and 10 then (s.data ->> 'lockAttempts')::int end
      from public.settings s where s.section = 'security'), 5),
    'minutes', coalesce((select case when (s.data ->> 'lockMinutes') ~ '^[0-9]{1,4}$' and (s.data ->> 'lockMinutes')::int between 5 and 1440 then (s.data ->> 'lockMinutes')::int end
      from public.settings s where s.section = 'security'), 15))
$$;

-- the counter's key: a member's phone → his email; anything else lower-cased as it is
create or replace function public.login_key(p_ident text) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v text := lower(btrim(coalesce(p_ident, '')));
  d text := regexp_replace(v, '[[:space:]-]', '', 'g');
  e text;
begin
  if char_length(v) > 200 then v := left(v, 200); end if;
  if d ~ '^[0-9]{11}$' then
    select lower(p.email) into e from public.profiles p where p.phone = d limit 1;
    if e is not null then v := e; end if;
  end if;
  return encode(sha256(convert_to(v, 'UTF8')), 'hex');
end $$;

create or replace function public.login_throttle() returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  delete from public.login_lookups where at < now() - interval '1 minute';
  insert into public.login_lookups default values;
  if (select count(*) from public.login_lookups where at >= now() - interval '1 minute') > 120 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
end $$;

create or replace function public.login_gate(p_ident text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare r public.login_failures;
begin
  perform public.login_throttle();
  select * into r from public.login_failures where key = public.login_key(p_ident);
  if found and r.locked_until is not null and r.locked_until > now() then
    return jsonb_build_object('locked', true, 'minutes', greatest(1, ceil(extract(epoch from (r.locked_until - now())) / 60)::int));
  end if;
  return jsonb_build_object('locked', false, 'minutes', 0);
end $$;

create or replace function public.login_failed(p_ident text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  k text := public.login_key(p_ident);
  pol jsonb := public.login_policy();
  n int := (pol ->> 'attempts')::int;
  mins int := (pol ->> 'minutes')::int;
  r public.login_failures;
begin
  perform public.login_throttle();
  select * into r from public.login_failures where key = k for update;
  if found and r.locked_until is not null and r.locked_until > now() then
    return jsonb_build_object('locked', true, 'left', 0, 'minutes', greatest(1, ceil(extract(epoch from (r.locked_until - now())) / 60)::int));
  end if;
  if not found then
    insert into public.login_failures (key, fails, last_at) values (k, 0, now()) returning * into r;
  elsif r.last_at < now() - make_interval(mins => mins) then
    r.fails := 0; -- an old failure: a fresh count
  end if;
  r.fails := r.fails + 1;
  if r.fails >= n then
    update public.login_failures set fails = 0, locked_until = now() + make_interval(mins => mins), last_at = now() where key = k;
    return jsonb_build_object('locked', true, 'left', 0, 'minutes', mins);
  end if;
  update public.login_failures set fails = r.fails, locked_until = null, last_at = now() where key = k;
  return jsonb_build_object('locked', false, 'left', n - r.fails, 'minutes', mins);
end $$;

-- the signed-in member's own counter (his email; his phone maps to it)
create or replace function public.login_cleared() returns void
language plpgsql volatile security definer set search_path = public as $$
declare e text;
begin
  if auth.uid() is null then return; end if;
  select lower(p.email) into e from public.profiles p where p.id = auth.uid();
  if e is not null then delete from public.login_failures where key = encode(sha256(convert_to(e, 'UTF8')), 'hex'); end if;
end $$;

-- the admin: the members locked now, and unlock one
create or replace function public.login_locks() returns table (member_id uuid, name text, locked_until timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return query select p.id, p.name, f.locked_until from public.login_failures f
    join public.profiles p on encode(sha256(convert_to(lower(p.email), 'UTF8')), 'hex') = f.key
    where f.locked_until > now() order by f.locked_until desc;
end $$;

create or replace function public.login_unlock(p_member uuid) returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare e text; n int;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select lower(p.email) into e from public.profiles p where p.id = p_member;
  if e is null then raise exception 'invalid: member' using errcode = '22023'; end if;
  delete from public.login_failures where key = encode(sha256(convert_to(e, 'UTF8')), 'hex');
  get diagnostics n = row_count;
  perform public.log_activity('settings.login.unlock', 'profile', p_member::text, null, null);
  return n > 0;
end $$;

revoke execute on function public.login_policy(), public.login_key(text), public.login_throttle() from public, anon, authenticated;
grant execute on function public.login_policy(), public.login_key(text), public.login_throttle() to service_role;
revoke execute on function public.login_gate(text), public.login_failed(text), public.login_cleared(), public.login_locks(), public.login_unlock(uuid) from public;
grant execute on function public.login_gate(text), public.login_failed(text) to anon, authenticated, service_role;
revoke execute on function public.login_cleared(), public.login_locks(), public.login_unlock(uuid) from anon;
grant execute on function public.login_cleared(), public.login_locks(), public.login_unlock(uuid) to authenticated, service_role;
