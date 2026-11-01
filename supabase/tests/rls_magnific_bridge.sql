-- RLS / permission tests for 0029_magnific_bridge (the OAuth states of the Magnific bridge and the Vault doors of the Edge Function).
-- Depends on 0001_identity … 0029_magnific_bridge. Runs in one transaction and rolls back; prints NOTICE 'rls_magnific_bridge: ok'
-- only if every case passed. Live-safe: its rows (one made-up admin, one state row) are rolled back; the Vault functions are
-- exercised with a name outside the list (refused before Vault) and, as a member, refused by role — no secret is written.

begin;

insert into auth.users (id, email, phone) values ('00000000-0000-4000-8000-000000000097', 'brg-a.dev@ibtekr.local', '01000000097');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u where u.id = '00000000-0000-4000-8000-000000000097';
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-000000000097', 'جسر أ', 'brg-a.dev@ibtekr.local', '01000000097', 'admin', 'active', '{}');

-- ================================================================ the server's rows (service_role; here the owner)

do $$ begin
  insert into public.magnific_oauth_states (state, verifier, created_by) values
    ('0123456789abcdefghijklmnopqrstuvwxyzABCDEF', 'verifier-verifier-verifier-verifier-verifier-00', '00000000-0000-4000-8000-000000000097');
  begin
    insert into public.magnific_oauth_states (state, verifier, created_by) values ('short', 'verifier-verifier-verifier-verifier-verifier-00', '00000000-0000-4000-8000-000000000097');
    raise exception 'case a short state is refused failed';
  exception when check_violation then null;
  end;
  begin
    insert into public.magnific_oauth_states (state, verifier, created_by) values ('0123456789abcdefghijklmnopqrstuvwxyzABCDEG', 'short', '00000000-0000-4000-8000-000000000097');
    raise exception 'case a short verifier is refused failed';
  exception when check_violation then null;
  end;
end $$;

-- ================================================================ the admin as a member: no table, no Vault doors

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000097","role":"authenticated"}', true);

do $$ begin
  begin
    perform count(*) from public.magnific_oauth_states;
    raise exception 'case a member (even the admin) reads no state failed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.magnific_secret_get('magnific_mcp_tokens');
    raise exception 'case a member cannot call magnific_secret_get failed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.magnific_secret_set('magnific_mcp_tokens', 'x');
    raise exception 'case a member cannot call magnific_secret_set failed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ================================================================ service_role: the table; the doors refuse a name outside the list

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

do $$ begin
  if (select count(*) from public.magnific_oauth_states) <> 1 then raise exception 'case service_role reads the states failed'; end if;
  update public.magnific_oauth_states set used_at = now() where state = '0123456789abcdefghijklmnopqrstuvwxyzABCDEF';
  if (select count(*) from public.magnific_oauth_states where used_at is not null) <> 1 then raise exception 'case service_role spends a state failed'; end if;
  begin
    delete from public.magnific_oauth_states;
    raise exception 'case service_role never deletes a state failed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.magnific_secret_get('something_else');
    raise exception 'case a name outside the list is refused failed';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.magnific_secret_set('something_else', 'x');
    raise exception 'case a name outside the list is refused on set failed';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- ================================================================ anon: nothing

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$ begin
  begin
    perform count(*) from public.magnific_oauth_states;
    raise exception 'case anon reads nothing failed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.magnific_secret_get('magnific_mcp_tokens');
    raise exception 'case anon cannot call the door failed';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
do $$ begin raise notice 'rls_magnific_bridge: ok'; end $$;
rollback;
