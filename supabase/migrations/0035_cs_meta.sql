-- 0035_cs_meta — phase 6.2 (docs/superpowers/plans/2026-11-02-phase-6-customer-service.md, decisions 10–15): the Meta channel
-- (Messenger + Instagram) of customer service — the Edge Function cs-channel receives the page's webhooks, links the real
-- «Ibtekr Club» page through OAuth (the app in Dev mode until the final switch) and sends the team's replies.
-- * cs_oauth_states: the state (+ a verifier, kept for parity with 0029 — Meta's dialog needs none) of a sign-in the admin started
--   (action connect_start), spent once by connect_callback within ten minutes (used_at — never deleted); service_role only.
-- * cs_secret_get / cs_secret_set: the function's door to Vault for one secret — meta_pages (the linked page's long-lived token,
--   its Instagram account, the candidates while the admin picks a page); security definer, service_role only (the claims' role is
--   checked inside too), that one name only. The token never leaves Vault except into the function's memory.
-- * cs_channel_events: one row per webhook delivery (object, entry id, status, an error code, a summary of counts) — never a message's
--   text, a name or a token; service_role only. cs_channels.meta (0034, the server's) holds the page / Instagram ids, no token.
-- Re-runnable.

create table if not exists public.cs_oauth_states (
  state text primary key check (state ~ '^[A-Za-z0-9_-]{32,128}$'),
  verifier text not null check (length(verifier) between 43 and 128),
  channel text not null check (channel in ('messenger', 'instagram')),
  created_by uuid not null references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  used_at timestamptz
);
alter table public.cs_oauth_states enable row level security;
revoke all on public.cs_oauth_states from anon, authenticated;
grant select, insert, update on public.cs_oauth_states to service_role;

create table if not exists public.cs_channel_events (
  id bigserial primary key,
  received_at timestamptz not null default now(),
  object text not null check (char_length(object) <= 40),
  entry_id text check (entry_id is null or char_length(entry_id) <= 80),
  status text not null check (status in ('ok', 'ignored', 'error')),
  error text check (error is null or char_length(error) <= 200),
  summary jsonb not null default '{}'
);
create index if not exists cs_channel_events_received_idx on public.cs_channel_events (received_at desc);
alter table public.cs_channel_events enable row level security;
revoke all on public.cs_channel_events from anon, authenticated;
grant select, insert on public.cs_channel_events to service_role;

create or replace function public.cs_secret_get(p_name text) returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  v_value text;
begin
  if coalesce(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' is distinct from 'service_role' then
    raise exception 'service_role only' using errcode = '42501';
  end if;
  if p_name not in ('meta_pages') then
    raise exception 'unknown secret' using errcode = '22023';
  end if;
  if to_regclass('vault.decrypted_secrets') is null then
    raise exception 'vault is not available' using errcode = '0A000';
  end if;
  select s.decrypted_secret into v_value from vault.decrypted_secrets s where s.name = 'cs_' || p_name;
  return v_value;
end
$$;

-- p_value null = the secret is removed (disconnect)
create or replace function public.cs_secret_set(p_name text, p_value text) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if coalesce(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' is distinct from 'service_role' then
    raise exception 'service_role only' using errcode = '42501';
  end if;
  if p_name not in ('meta_pages') then
    raise exception 'unknown secret' using errcode = '22023';
  end if;
  if to_regclass('vault.decrypted_secrets') is null then
    raise exception 'vault is not available' using errcode = '0A000';
  end if;
  select s.id into v_id from vault.secrets s where s.name = 'cs_' || p_name;
  if p_value is null then
    if v_id is not null then delete from vault.secrets where id = v_id; end if;
    return;
  end if;
  if v_id is null then
    perform vault.create_secret(p_value, 'cs_' || p_name, 'customer service Meta channel (0035_cs_meta)');
  else
    perform vault.update_secret(v_id, p_value);
  end if;
end
$$;

revoke execute on function public.cs_secret_get(text) from public, anon, authenticated;
revoke execute on function public.cs_secret_set(text, text) from public, anon, authenticated;
grant execute on function public.cs_secret_get(text) to service_role;
grant execute on function public.cs_secret_set(text, text) to service_role;
