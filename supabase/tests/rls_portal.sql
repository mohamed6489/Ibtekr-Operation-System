-- RLS / permission tests for 0065_portal (phase 13 T4: the maker portal's door — vendor_login_check / set_own / reset_create /
-- reset_use / portal_jwt_secret are service_role only; vendor_login_resets is the server's; the new vendor_logins columns are the
-- server's; a wrong try counts and the fifth locks; the maker's own password hides the temporary one from the team). Depends on
-- 0001 … 0065. One transaction rolled back; prints NOTICE 'rls_portal: ok' only if every case passed. Live-safe (own rows only;
-- the Vault secrets it makes roll back with the transaction). With Vault (the live project) the password path runs end to end;
-- without it (a plain local Postgres, CI) the functions that touch a secret raise 0A000 after their own checks.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000065a1', 'pt-adm.dev@ibtekr.local', '01000065a01'),
  ('00000000-0000-4000-8000-0000000065a2', 'pt-vf.dev@ibtekr.local', '01000065a02');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u where u.email like 'pt-%.dev@ibtekr.local';
insert into public.profiles (id, name, email, phone, role_id, status) values
  ('00000000-0000-4000-8000-0000000065a1', 'أدمن البوابة', 'pt-adm.dev@ibtekr.local', '01000065a01', 'admin', 'active'),
  ('00000000-0000-4000-8000-0000000065a2', 'متابعة البوابة', 'pt-vf.dev@ibtekr.local', '01000065a02', 'vendors_followup', 'active');

-- the server's rows: two makers with a login (one with a secret already, one without), a disabled login, an inactive maker
insert into public.vendors (id, name, category, status, lead_days, joined_at) values
  ('00000000-0000-4000-8000-0000000065d1', 'ورشة البوابة', 'هدايا', 'active', 7, '2026-11-01'),
  ('00000000-0000-4000-8000-0000000065d2', 'ورشة من غير باسورد', 'هدايا', 'active', 7, '2026-11-01'),
  ('00000000-0000-4000-8000-0000000065d3', 'ورشة موقوفة', 'هدايا', 'active', 7, '2026-11-01'),
  ('00000000-0000-4000-8000-0000000065d4', 'ورشة اتشالت', 'هدايا', 'inactive', 7, '2026-11-01');
insert into public.vendor_logins (vendor_id, username, email, pw_mode, status, created_by) values
  ('00000000-0000-4000-8000-0000000065d1', 'portal.one', 'portal-one.dev@ibtekr.local', 'temp', 'invited', 'test'),
  ('00000000-0000-4000-8000-0000000065d2', 'portal.two', 'portal-two.dev@ibtekr.local', 'temp', 'invited', 'test'),
  ('00000000-0000-4000-8000-0000000065d3', 'portal.off', 'portal-off.dev@ibtekr.local', 'temp', 'disabled', 'test'),
  ('00000000-0000-4000-8000-0000000065d4', 'portal.gone', 'portal-gone.dev@ibtekr.local', 'temp', 'invited', 'test');
do $$ begin
  perform set_config('rls_portal.has_vault', (to_regclass('vault.decrypted_secrets') is not null)::text, true);
end $$;

-- ================================================================ the schema
do $$ begin
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'vendor_logins' and column_name in ('fails', 'locked_until', 'own_password', 'last_login_at')) <> 4 then raise exception 'case the new columns failed'; end if;
  if to_regclass('public.vendor_login_resets') is null then raise exception 'case the resets table failed'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.vendor_login_resets'::regclass) then raise exception 'case RLS on the resets table failed'; end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'vendor_login_resets' and grantee in ('anon', 'authenticated')) then raise exception 'case members granted on the resets table failed'; end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('vendor_login_check', 'vendor_login_set_own', 'vendor_login_reset_create', 'vendor_login_reset_use', 'portal_jwt_secret') and p.prosecdef) <> 5 then raise exception 'case the five definer functions failed'; end if;
end $$;

-- ================================================================ a member (admin) and anon: every portal door is shut; the new columns are the server's
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000065a1","role":"authenticated"}', true);
do $$ begin
  begin perform public.vendor_login_check('portal.one', 'Test1234'); raise exception 'case a member calls check failed'; exception when insufficient_privilege then null; end;
  begin perform public.vendor_login_set_own('00000000-0000-4000-8000-0000000065d1', 'Test1234'); raise exception 'case a member calls set_own failed'; exception when insufficient_privilege then null; end;
  begin perform public.vendor_login_reset_create('portal.one'); raise exception 'case a member calls reset_create failed'; exception when insufficient_privilege then null; end;
  begin perform public.vendor_login_reset_use(repeat('a', 64), 'Test1234'); raise exception 'case a member calls reset_use failed'; exception when insufficient_privilege then null; end;
  begin perform public.portal_jwt_secret(); raise exception 'case a member reads the token secret failed'; exception when insufficient_privilege then null; end;
  begin perform count(*) from public.vendor_login_resets; raise exception 'case a member reads the resets failed'; exception when insufficient_privilege then null; end;
  begin update public.vendor_logins set fails = 3 where vendor_id = '00000000-0000-4000-8000-0000000065d1'; raise exception 'case a member writes fails failed'; exception when insufficient_privilege then null; end;
  begin update public.vendor_logins set own_password = true where vendor_id = '00000000-0000-4000-8000-0000000065d1'; raise exception 'case a member writes own_password failed'; exception when insufficient_privilege then null; end;
  -- reading the state is fine (vendors.view)
  if (select own_password from public.vendor_logins where vendor_id = '00000000-0000-4000-8000-0000000065d1') is not false then raise exception 'case a member reads own_password failed'; end if;
end $$;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$ begin
  begin perform public.vendor_login_check('portal.one', 'Test1234'); raise exception 'case anon calls check failed'; exception when insufficient_privilege then null; end;
  begin perform public.portal_jwt_secret(); raise exception 'case anon reads the token secret failed'; exception when insufficient_privilege then null; end;
end $$;

-- ================================================================ the server (service_role): the sign-in rules without a secret
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$ declare r jsonb; begin
  r := public.vendor_login_check('nobody', 'Test1234'); if r ->> 'reason' <> 'wrong' or (r ->> 'ok')::boolean then raise exception 'case an unknown user failed: %', r; end if;
  r := public.vendor_login_check('', 'Test1234'); if r ->> 'reason' <> 'wrong' then raise exception 'case an empty user failed'; end if;
  r := public.vendor_login_check('portal.off', 'Test1234'); if r ->> 'reason' <> 'disabled' then raise exception 'case a disabled login failed: %', r; end if;
  r := public.vendor_login_check('portal.gone', 'Test1234'); if r ->> 'reason' <> 'disabled' then raise exception 'case an inactive maker failed: %', r; end if;
  r := public.vendor_login_check('PORTAL-TWO.DEV@ibtekr.local', 'Test1234'); if r ->> 'reason' <> 'nopw' then raise exception 'case a login without a password (by e-mail, any case) failed: %', r; end if;
  -- reset_create: a token for a live login, null for a stranger / a disabled one; the hash kept, never the token
  r := public.vendor_login_reset_create('portal.two');
  if r is null or (r ->> 'vendor_id') <> '00000000-0000-4000-8000-0000000065d2' or (r ->> 'email') <> 'portal-two.dev@ibtekr.local' or length(r ->> 'token') <> 64 then raise exception 'case reset_create failed: %', r; end if;
  if (select count(*) from public.vendor_login_resets where vendor_id = '00000000-0000-4000-8000-0000000065d2' and used_at is null and expires_at > now()) <> 1 then raise exception 'case the reset row failed'; end if;
  if exists (select 1 from public.vendor_login_resets where token_hash = (r ->> 'token')) then raise exception 'case the token stored in clear failed'; end if;
  if (select token_hash from public.vendor_login_resets where vendor_id = '00000000-0000-4000-8000-0000000065d2' and used_at is null) <> encode(sha256(convert_to(r ->> 'token', 'UTF8')), 'hex') then raise exception 'case the hash failed'; end if;
  perform set_config('rls_portal.token2', r ->> 'token', true);
  -- a second request retires the first token
  perform public.vendor_login_reset_create('portal-two.dev@ibtekr.local');
  if (select count(*) from public.vendor_login_resets where vendor_id = '00000000-0000-4000-8000-0000000065d2' and used_at is null) <> 1 then raise exception 'case the older token retired failed'; end if;
  if public.vendor_login_reset_create('portal.off') is not null then raise exception 'case reset for a disabled login failed'; end if;
  if public.vendor_login_reset_create('nobody') is not null then raise exception 'case reset for a stranger failed'; end if;
  begin perform public.vendor_login_reset_use(current_setting('rls_portal.token2'), 'Test1234'); raise exception 'case a retired token failed';
  exception when no_data_found then null; when feature_not_supported then raise exception 'case a retired token must be refused before Vault'; end;
  begin perform public.vendor_login_reset_use('zz', 'Test1234'); raise exception 'case a malformed token failed'; exception when no_data_found then null; end;
  -- set_own: the password rules before anything else; a disabled login; an unknown maker
  begin perform public.vendor_login_set_own('00000000-0000-4000-8000-0000000065d1', 'short'); raise exception 'case a weak password failed'; exception when invalid_parameter_value then null; end;
  begin perform public.vendor_login_set_own('00000000-0000-4000-8000-0000000065d1', 'Test 1234'); raise exception 'case a spaced password failed'; exception when invalid_parameter_value then null; end;
  begin perform public.vendor_login_set_own('00000000-0000-4000-8000-0000000065d3', 'Test1234'); raise exception 'case set_own on a disabled login failed'; exception when insufficient_privilege then null; end;
  begin perform public.vendor_login_set_own('00000000-0000-4000-8000-0000000065ff', 'Test1234'); raise exception 'case set_own on a stranger failed'; exception when no_data_found then null; end;
  if (select count(*) from public.activity_log where action in ('portal.reset.request') and entity_id = '00000000-0000-4000-8000-0000000065d2') <> 2 then raise exception 'case the reset request rows failed'; end if;
end $$;

-- ================================================================ the server: the password path — with Vault end to end, without it 0A000
do $$ declare has_vault boolean := current_setting('rls_portal.has_vault') = 'true'; r jsonb; v_tok text; v_vendor uuid; v_cnt int; begin
  if not has_vault then
    begin perform public.vendor_login_set_own('00000000-0000-4000-8000-0000000065d1', 'Test1234'); raise exception 'case set_own without Vault failed';
    exception when feature_not_supported then null; end;
    begin perform public.portal_jwt_secret(); raise exception 'case the token secret without Vault failed';
    exception when feature_not_supported then null; end;
    -- a login that points at a secret: the check reaches Vault and stops there (after the disabled / locked / nopw rules)
    update public.vendor_logins set secret_id = '00000000-0000-4000-8000-0000000065ee' where vendor_id = '00000000-0000-4000-8000-0000000065d1';
    begin perform public.vendor_login_check('portal.one', 'Test1234'); raise exception 'case check without Vault failed';
    exception when feature_not_supported then null; end;
    return;
  end if;
  -- the maker's own password: the secret, the row, the log
  perform public.vendor_login_set_own('00000000-0000-4000-8000-0000000065d1', 'Test1234');
  if not exists (select 1 from public.vendor_logins l join vault.secrets s on s.id = l.secret_id where l.vendor_id = '00000000-0000-4000-8000-0000000065d1' and s.name = 'vendor-login:00000000-0000-4000-8000-0000000065d1'
                 and l.own_password and not l.must_change and l.status = 'active' and l.password_set_at is not null) then raise exception 'case set_own row failed'; end if;
  -- the sign-in: wrong tries count, the fifth locks for 15 minutes, a success resets
  r := public.vendor_login_check('portal.one', 'Wrong1234'); if r ->> 'reason' <> 'wrong' or (r ->> 'left')::int <> 4 then raise exception 'case the first wrong try failed: %', r; end if;
  perform public.vendor_login_check('portal.one', 'Wrong1234'); perform public.vendor_login_check('portal.one', 'Wrong1234'); perform public.vendor_login_check('portal.one', 'Wrong1234');
  r := public.vendor_login_check('portal.one', 'Wrong1234'); if r ->> 'reason' <> 'locked' or (r ->> 'until') is null then raise exception 'case the fifth try locks failed: %', r; end if;
  r := public.vendor_login_check('portal.one', 'Test1234'); if r ->> 'reason' <> 'locked' then raise exception 'case a right password while locked failed: %', r; end if;
  update public.vendor_logins set locked_until = null where vendor_id = '00000000-0000-4000-8000-0000000065d1'; -- the 15 minutes passed
  r := public.vendor_login_check('Portal.One', 'Test1234');
  if not (r ->> 'ok')::boolean or (r ->> 'vendor_id') <> '00000000-0000-4000-8000-0000000065d1' or (r ->> 'must_change')::boolean or not (r ->> 'own_password')::boolean then raise exception 'case a right sign-in failed: %', r; end if;
  if (select fails from public.vendor_logins where vendor_id = '00000000-0000-4000-8000-0000000065d1') <> 0 or (select last_login_at from public.vendor_logins where vendor_id = '00000000-0000-4000-8000-0000000065d1') is null then raise exception 'case the success reset failed'; end if;
  -- the reset link end to end: a fresh token sets the password and is spent
  r := public.vendor_login_reset_create('portal.one'); v_tok := r ->> 'token';
  v_vendor := public.vendor_login_reset_use(v_tok, 'Fresh5678');
  if v_vendor <> '00000000-0000-4000-8000-0000000065d1' then raise exception 'case reset_use failed'; end if;
  if (select used_at from public.vendor_login_resets where token_hash = encode(sha256(convert_to(v_tok, 'UTF8')), 'hex')) is null then raise exception 'case the token spent failed'; end if;
  begin perform public.vendor_login_reset_use(v_tok, 'Fresh5678'); raise exception 'case a spent token failed'; exception when no_data_found then null; end;
  if not (public.vendor_login_check('portal.one', 'Fresh5678') ->> 'ok')::boolean then raise exception 'case the new password signs in failed'; end if;
  if (public.vendor_login_check('portal.one', 'Test1234') ->> 'reason') <> 'wrong' then raise exception 'case the old password refused failed'; end if;
  -- the token secret: made once, the same after
  if length(public.portal_jwt_secret()) < 64 or public.portal_jwt_secret() <> public.portal_jwt_secret() then raise exception 'case the token secret failed'; end if;
  select count(*) into v_cnt from public.activity_log where entity_id = '00000000-0000-4000-8000-0000000065d1' and action in ('portal.password', 'portal.locked', 'portal.login', 'portal.reset.request', 'portal.reset');
  if v_cnt < 6 then raise exception 'case the portal log rows failed: %', v_cnt; end if;
  if exists (select 1 from public.activity_log where entity_id like '00000000-0000-4000-8000-0000000065d%' and (coalesce(new_value::text, '') like '%Test1234%' or coalesce(new_value::text, '') like '%Fresh5678%' or coalesce(new_value::text, '') like '%' || v_tok || '%')) then raise exception 'case a secret in the log failed'; end if;
end $$;

-- ================================================================ the team: vendor_login_reveal answers null once the maker set their own password (with Vault)
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000065a2","role":"authenticated"}', true);
do $$ declare has_vault boolean := current_setting('rls_portal.has_vault') = 'true'; begin
  if has_vault then
    if public.vendor_login_reveal('00000000-0000-4000-8000-0000000065d1') is not null then raise exception 'case reveal after own password failed'; end if;
    if public.vendor_login_reveal('00000000-0000-4000-8000-0000000065d2') is not null then raise exception 'case reveal without a password failed'; end if;
  else
    begin perform public.vendor_login_reveal('00000000-0000-4000-8000-0000000065d1'); raise exception 'case reveal without Vault failed'; exception when feature_not_supported then null; end;
  end if;
end $$;

reset role;
do $$ begin raise notice 'rls_portal: ok'; end $$;
rollback;
