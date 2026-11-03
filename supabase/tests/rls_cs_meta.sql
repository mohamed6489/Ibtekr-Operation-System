-- RLS / permission tests for 0035_cs_meta (the OAuth states and the webhook event log of the Meta channel, the Vault doors of
-- cs-channel). Depends on 0001_identity … 0035_cs_meta. Runs in one transaction and rolls back; prints NOTICE 'rls_cs_meta: ok'
-- only if every case passed. Live-safe: its rows (one made-up admin, one state row, one event row) are rolled back; the Vault
-- functions are exercised with a name outside the list (refused before Vault) and, as a member, refused by role — no secret is written.

begin;

insert into auth.users (id, email, phone) values ('00000000-0000-4000-8000-000000000096', 'csm-a.dev@ibtekr.local', '01000000096');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u where u.id = '00000000-0000-4000-8000-000000000096';
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-000000000096', 'قناة أ', 'csm-a.dev@ibtekr.local', '01000000096', 'admin', 'active', '{}');

-- ================================================================ the server's rows (service_role; here the owner)

do $$ begin
  insert into public.cs_oauth_states (state, verifier, channel, created_by) values
    ('0123456789abcdefghijklmnopqrstuvwxyzABCDEF', 'verifier-verifier-verifier-verifier-verifier-00', 'messenger', '00000000-0000-4000-8000-000000000096');
  begin
    insert into public.cs_oauth_states (state, verifier, channel, created_by) values ('short', 'verifier-verifier-verifier-verifier-verifier-00', 'messenger', '00000000-0000-4000-8000-000000000096');
    raise exception 'case a short state is refused failed';
  exception when check_violation then null;
  end;
  begin
    insert into public.cs_oauth_states (state, verifier, channel, created_by) values ('0123456789abcdefghijklmnopqrstuvwxyzABCDEG', 'verifier-verifier-verifier-verifier-verifier-00', 'whatsapp', '00000000-0000-4000-8000-000000000096');
    raise exception 'case a channel outside messenger / instagram is refused failed';
  exception when check_violation then null;
  end;
  insert into public.cs_channel_events (object, entry_id, status, summary) values ('page', '123', 'ok', '{"messages": 1}');
  begin
    insert into public.cs_channel_events (object, status) values ('page', 'done');
    raise exception 'case an event status outside the list is refused failed';
  exception when check_violation then null;
  end;
end $$;

-- ================================================================ the admin as a member: no tables, no Vault doors

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000096","role":"authenticated"}', true);

do $$ begin
  begin
    perform count(*) from public.cs_oauth_states;
    raise exception 'case a member (even the admin) reads no state failed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from public.cs_channel_events;
    raise exception 'case a member reads no webhook event failed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.cs_secret_get('meta_pages');
    raise exception 'case a member cannot call cs_secret_get failed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.cs_secret_set('meta_pages', 'x');
    raise exception 'case a member cannot call cs_secret_set failed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ================================================================ service_role: the tables; the doors refuse a name outside the list

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

do $$ begin
  if (select count(*) from public.cs_oauth_states) <> 1 then raise exception 'case service_role reads the states failed'; end if;
  update public.cs_oauth_states set used_at = now() where state = '0123456789abcdefghijklmnopqrstuvwxyzABCDEF';
  if (select count(*) from public.cs_oauth_states where used_at is not null) <> 1 then raise exception 'case service_role spends a state failed'; end if;
  begin
    delete from public.cs_oauth_states;
    raise exception 'case service_role never deletes a state failed';
  exception when insufficient_privilege then null;
  end;
  if (select count(*) from public.cs_channel_events where entry_id = '123') <> 1 then raise exception 'case service_role reads the events failed'; end if;
  insert into public.cs_channel_events (object, status) values ('page', 'ok'); -- 0036: the sequence is granted
  if not has_sequence_privilege('service_role', 'public.cs_channel_events_id_seq', 'USAGE') then raise exception 'case service_role uses the events sequence failed'; end if;
  begin
    perform public.cs_secret_get('something_else');
    raise exception 'case a name outside the list is refused failed';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.cs_secret_set('something_else', 'x');
    raise exception 'case a name outside the list is refused on set failed';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- ================================================================ anon: nothing

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

do $$ begin
  begin
    perform count(*) from public.cs_oauth_states;
    raise exception 'case anon reads no state failed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from public.cs_channel_events;
    raise exception 'case anon reads no event failed';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
do $$ begin raise notice 'rls_cs_meta: ok'; end $$;
rollback;
