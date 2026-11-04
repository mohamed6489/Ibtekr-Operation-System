-- RLS / permission tests for 0043_cs_wa_cloud (WhatsApp 1 on the Cloud API: wa1 is a Meta channel, the sign-in state takes wa1,
-- the Vault doors take meta_wa). Depends on 0001_identity … 0043_cs_wa_cloud. Runs in one transaction and rolls back; prints
-- NOTICE 'rls_cs_wa_cloud: ok' only if every case passed. Live-safe: its rows (one made-up admin, one state row) are rolled back;
-- the Vault doors are exercised with a name outside the list (refused before Vault) and, as a member, refused by role.

begin;

insert into auth.users (id, email, phone) values ('00000000-0000-4000-8000-000000000097', 'cswc-a.dev@ibtekr.local', '01000000097');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u where u.id = '00000000-0000-4000-8000-000000000097';
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-000000000097', 'واتساب أ', 'cswc-a.dev@ibtekr.local', '01000000097', 'admin', 'active', '{}');

do $$ begin
  if (select kind from public.cs_channels where id = 'wa1') is distinct from 'meta' then raise exception 'case wa1 is a Meta channel failed'; end if;
  if (select kind from public.cs_channels where id = 'wa2') is distinct from 'qr' then raise exception 'case wa2 stays on the QR bridge failed'; end if;
  insert into public.cs_oauth_states (state, verifier, channel, created_by) values
    ('wa_0123456789abcdefghijklmnopqrstuvwxyzABCD', 'verifier-verifier-verifier-verifier-verifier-00', 'wa1', '00000000-0000-4000-8000-000000000097');
  begin
    insert into public.cs_oauth_states (state, verifier, channel, created_by) values ('wa_0123456789abcdefghijklmnopqrstuvwxyzABCE', 'verifier-verifier-verifier-verifier-verifier-00', 'wa2', '00000000-0000-4000-8000-000000000097');
    raise exception 'case a sign-in state for wa2 is refused failed';
  exception when check_violation then null;
  end;
end $$;

-- a history message moves its conversation to its own time (not now), with no unread / waiting; a live one still stamps now
do $$
declare v uuid; c uuid; r record;
begin
  insert into public.cs_customers (name, phone, created_from) values ('تاريخ', '01099990097', 'channel') returning id into c;
  insert into public.cs_conversations (seg, platform, channel, customer_id, external_id, status, created_at, updated_at)
    values ('customers', 'whatsapp', 'wa1', c, '01099990097', 'اتحلت', now(), '2026-05-01 10:00+00') returning id into v;
  insert into public.cs_messages (conversation_id, kind, text, external_id, delivery, meta, created_at)
    values (v, 'in', 'قديمة', 'wamid.hist.0097a', null, '{"history": true}', '2026-05-02 10:00+00'),
           (v, 'out', 'رد قديم', 'wamid.hist.0097b', 'sent', '{"history": true}', '2026-05-02 11:00+00'),
           (v, 'in', 'أقدم', 'wamid.hist.0097c', null, '{"history": true}', '2026-04-01 10:00+00');
  select * into r from public.cs_conversations where id = v;
  if r.updated_at <> '2026-05-02 11:00+00' then raise exception 'case history keeps the latest message time (%) failed', r.updated_at; end if;
  if r.last_in_at <> '2026-05-02 10:00+00' or r.last_out_at <> '2026-05-02 11:00+00' then raise exception 'case history last in / out failed'; end if;
  if r.unread <> 0 or r.waiting_since is not null then raise exception 'case history adds no unread / waiting failed'; end if;
  if r.status <> 'اتحلت' then raise exception 'case history leaves the status failed'; end if;
  insert into public.cs_messages (conversation_id, kind, text, external_id, meta) values (v, 'in', 'جديدة', 'wamid.live.0097', '{}');
  select * into r from public.cs_conversations where id = v;
  if r.unread <> 1 or r.updated_at < now() - interval '1 minute' then raise exception 'case a live message still stamps now and counts unread failed'; end if;
  update public.cs_conversations set tags = '{x}' where id = v;
  if (select updated_at from public.cs_conversations where id = v) < now() - interval '1 minute' then raise exception 'case another update still stamps now failed'; end if;
end $$;

-- the Vault doors: a name outside the list is refused (as the server), and a member cannot open them at all
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$ begin
  begin
    perform public.cs_secret_get('meta_other');
    raise exception 'case an unknown secret name is refused failed';
  exception when invalid_parameter_value then null;
  end;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000097","role":"authenticated"}', true);
do $$ begin
  begin
    perform public.cs_secret_get('meta_wa');
    raise exception 'case a member (even the admin) cannot read meta_wa failed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.cs_secret_set('meta_wa', 'x');
    raise exception 'case a member cannot write meta_wa failed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from public.cs_oauth_states;
    raise exception 'case a member reads no sign-in state failed';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
do $$ begin raise notice 'rls_cs_wa_cloud: ok'; end $$;
rollback;
