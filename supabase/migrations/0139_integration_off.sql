-- 0139 — «المفروض الموقع مش مربوط بعد المسح ازاي جابهم تاني» (the owner 18 Nov): the site was linked before the settings page existed, by
-- the Supabase function secrets (WOO_URL / WOO_CK / WOO_CS), so its card read «غير متصل» while the sync kept pulling the staging site back
-- after «امسح كل حاجة». settings-admin now shows that link (source «server») and «فصل» on it = settings «integrations» { off: { <key>: true } }:
-- integration_paused(key) is true for an «off» key as for a pause that never ends — app_secret_env drops its keys (and the Supabase secrets of
-- the same name), WooCommerce has WOO_PUSH_ENABLED 0, cs/mkt/magnific secrets read as none. Linking again from the page clears it.
-- docs/superpowers/plans/2026-11-18-data-real.md decision 8. Re-runnable.
create or replace function public.integration_paused(p_key text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v text; t timestamptz; v_off boolean;
begin
  select coalesce((s.data -> 'off' ->> p_key)::boolean, false), s.data -> 'paused' ->> p_key into v_off, v
    from public.settings s where s.section = 'integrations';
  if coalesce(v_off, false) then return true; end if;
  if v is null or v !~ '^\d{4}-\d{2}-\d{2}' then return false; end if;
  begin t := v::timestamptz; exception when others then return false; end;
  return t > now();
exception when others then return false;
end $$;
revoke execute on function public.integration_paused(text) from public, anon;
grant execute on function public.integration_paused(text) to authenticated, service_role;
