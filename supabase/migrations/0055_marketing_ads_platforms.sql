-- 0055_marketing_ads_platforms — phase 9.5.6: TikTok Ads and Google Ads beside Meta, read-only, linked from the system
-- (docs/superpowers/plans/2026-11-06-phase-9-5-marketing.md, decisions 67–74).
-- * mkt_ad_objects / mkt_ad_stats / mkt_suggestions take platform meta | tiktok | google (the same rows and rules a platform).
-- * mkt_secret_get / mkt_secret_set — the function's door to Vault for a platform's link (ads_meta / ads_tiktok / ads_google: the
--   token or refresh token, the app / client secret, the account id), security definer, service_role only; a secret never leaves
--   Vault except into the function's memory. The admin writes them from the page through mkt-ads (never a Supabase secret).
-- * cs_oauth_states.channel takes ads_tiktok / ads_google (the OAuth state of a platform link, ten minutes).
-- Re-runnable; no drop / delete / truncate of data.

alter table public.mkt_ad_objects drop constraint if exists mkt_ad_objects_platform_check;
alter table public.mkt_ad_objects add constraint mkt_ad_objects_platform_check check (platform in ('meta', 'tiktok', 'google'));
alter table public.mkt_ad_stats drop constraint if exists mkt_ad_stats_platform_check;
alter table public.mkt_ad_stats add constraint mkt_ad_stats_platform_check check (platform in ('meta', 'tiktok', 'google'));
alter table public.mkt_suggestions drop constraint if exists mkt_suggestions_platform_check;
alter table public.mkt_suggestions add constraint mkt_suggestions_platform_check check (platform in ('meta', 'tiktok', 'google'));

alter table public.cs_oauth_states drop constraint if exists cs_oauth_states_channel_check;
alter table public.cs_oauth_states add constraint cs_oauth_states_channel_check check (channel in ('messenger', 'instagram', 'ads_tiktok', 'ads_google'));

-- ---------------------------------------------------------------- the platform links in Vault (decision 67)

create or replace function public.mkt_secret_get(p_name text) returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  v_value text;
begin
  if coalesce(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' is distinct from 'service_role' then
    raise exception 'service_role only' using errcode = '42501';
  end if;
  if p_name not in ('ads_meta', 'ads_tiktok', 'ads_google') then
    raise exception 'unknown secret' using errcode = '22023';
  end if;
  if to_regclass('vault.decrypted_secrets') is null then
    raise exception 'vault is not available' using errcode = '0A000';
  end if;
  select s.decrypted_secret into v_value from vault.decrypted_secrets s where s.name = 'mkt_' || p_name;
  return v_value;
end
$$;

-- p_value null = the link is removed
create or replace function public.mkt_secret_set(p_name text, p_value text) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if coalesce(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' is distinct from 'service_role' then
    raise exception 'service_role only' using errcode = '42501';
  end if;
  if p_name not in ('ads_meta', 'ads_tiktok', 'ads_google') then
    raise exception 'unknown secret' using errcode = '22023';
  end if;
  if to_regclass('vault.decrypted_secrets') is null then
    raise exception 'vault is not available' using errcode = '0A000';
  end if;
  select s.id into v_id from vault.secrets s where s.name = 'mkt_' || p_name;
  if p_value is null then
    if v_id is not null then delete from vault.secrets where id = v_id; end if;
    return;
  end if;
  if v_id is null then
    perform vault.create_secret(p_value, 'mkt_' || p_name, 'marketing ads platform link (0055_marketing_ads_platforms)');
  else
    perform vault.update_secret(v_id, p_value);
  end if;
end
$$;

revoke execute on function public.mkt_secret_get(text) from public, anon, authenticated;
revoke execute on function public.mkt_secret_set(text, text) from public, anon, authenticated;
grant execute on function public.mkt_secret_get(text) to service_role;
grant execute on function public.mkt_secret_set(text, text) to service_role;
