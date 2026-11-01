-- 0029_magnific_bridge — phase 5.4 decision 11 (docs/superpowers/plans/2026-10-31-phase-5-4-images.md): the system itself is an
-- MCP client of the Magnific site (mcp.magnific.com, OAuth 2.1 on auth.magnific.com), so the studio's photos go up and the site's
-- results come back without a Claude session.
-- * magnific_oauth_states: the PKCE verifier of a sign-in the admin started (ai-images action bridge_link), spent once by
--   bridge_callback within ten minutes (used_at — the functions never delete); service_role only — members never read or write
--   it (rule 4: no grant to anon / authenticated, RLS on with no policy).
-- * magnific_secret_get / magnific_secret_set: the Edge Function's door to Vault for its two secrets — magnific_mcp_client (the
--   OAuth client the system registered) and magnific_mcp_tokens (the linked account's tokens); security definer, callable by
--   service_role only (the claims' role is checked inside too, so a mistaken grant still refuses), and only those two names.
--   The values never leave Vault except into the function's memory. Re-runnable.

create table if not exists public.magnific_oauth_states (
  state text primary key check (state ~ '^[A-Za-z0-9_-]{32,128}$'),
  verifier text not null check (length(verifier) between 43 and 128),
  created_by uuid not null references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  used_at timestamptz
);
alter table public.magnific_oauth_states enable row level security;
revoke all on public.magnific_oauth_states from anon, authenticated;
grant select, insert, update on public.magnific_oauth_states to service_role;

create or replace function public.magnific_secret_get(p_name text) returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  v_value text;
begin
  if coalesce(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' is distinct from 'service_role' then
    raise exception 'service_role only' using errcode = '42501';
  end if;
  if p_name not in ('magnific_mcp_client', 'magnific_mcp_tokens') then
    raise exception 'unknown secret' using errcode = '22023';
  end if;
  if to_regclass('vault.decrypted_secrets') is null then
    raise exception 'vault is not available' using errcode = '0A000';
  end if;
  select s.decrypted_secret into v_value from vault.decrypted_secrets s where s.name = p_name;
  return v_value;
end
$$;

-- p_value null = the secret is removed (bridge_unlink)
create or replace function public.magnific_secret_set(p_name text, p_value text) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if coalesce(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' is distinct from 'service_role' then
    raise exception 'service_role only' using errcode = '42501';
  end if;
  if p_name not in ('magnific_mcp_client', 'magnific_mcp_tokens') then
    raise exception 'unknown secret' using errcode = '22023';
  end if;
  if to_regclass('vault.decrypted_secrets') is null then
    raise exception 'vault is not available' using errcode = '0A000';
  end if;
  select s.id into v_id from vault.secrets s where s.name = p_name;
  if p_value is null then
    if v_id is not null then delete from vault.secrets where id = v_id; end if;
    return;
  end if;
  if v_id is null then
    perform vault.create_secret(p_value, p_name, 'Magnific MCP bridge (0029_magnific_bridge)');
  else
    perform vault.update_secret(v_id, p_value);
  end if;
end
$$;

revoke execute on function public.magnific_secret_get(text) from public, anon, authenticated;
revoke execute on function public.magnific_secret_set(text, text) from public, anon, authenticated;
grant execute on function public.magnific_secret_get(text) to service_role;
grant execute on function public.magnific_secret_set(text, text) to service_role;
