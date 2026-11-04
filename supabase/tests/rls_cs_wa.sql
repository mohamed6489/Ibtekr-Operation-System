-- RLS / permission tests for 0042_cs_wa (the WhatsApp bridge state, the campaigns' audience frozen at scheduling). Depends on
-- 0001_identity … 0042_cs_wa. Runs in one transaction and rolls back; prints NOTICE 'rls_cs_wa: ok' only if every case passed.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000000a1', 'cswa-cs.dev@ibtekr.local', '01000000a1'),
  ('00000000-0000-4000-8000-0000000000a2', 'cswa-ops.dev@ibtekr.local', '01000000a2');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u
where u.id in ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2');
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-0000000000a1', 'حملات', 'cswa-cs.dev@ibtekr.local', '010000000a1', 'cs', 'active', '{}'),
  ('00000000-0000-4000-8000-0000000000a2', 'تشغيل', 'cswa-ops.dev@ibtekr.local', '010000000a2', 'ops', 'active', '{}');

insert into public.cs_customers (id, phone, name, consent, blocked_at, created_from) values
  ('00000000-0000-4000-8000-0000000000b1', '01011112221', 'موافقة', true, null, 'manual'),
  ('00000000-0000-4000-8000-0000000000b2', '01011112222', 'رافضة', false, null, 'manual'),
  ('00000000-0000-4000-8000-0000000000b3', '01011112223', 'محظورة', true, now(), 'manual'),
  ('00000000-0000-4000-8000-0000000000b4', null, 'من غير رقم', true, null, 'manual');
insert into public.cs_campaigns (id, name, channel, body, status) values
  ('00000000-0000-4000-8000-0000000000c1', 'حملة تجربة', 'wa1', 'أهلا {اسم_العميل}', 'مسودة'),
  ('00000000-0000-4000-8000-0000000000c2', 'حملة شغالة', 'wa1', 'x', 'مسودة');
update public.cs_campaigns set status = 'شغالة' where id = '00000000-0000-4000-8000-0000000000c2';

do $$ begin
  if (select count(*) from public.cs_wa_state) <> 2 then raise exception 'case the two WhatsApp state rows exist failed'; end if;
end $$;

-- ================================================================ cs (cs.manage F): schedules; the audience is filtered on the server

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);

do $$ declare n int; begin
  begin
    perform count(*) from public.cs_wa_state;
    raise exception 'case a member reads no bridge state failed';
  exception when insufficient_privilege then null;
  end;
  n := public.cs_campaign_schedule('00000000-0000-4000-8000-0000000000c1',
    array['00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000b4']::uuid[], now() + interval '1 hour');
  if n <> 1 then raise exception 'case only the consenting, unblocked customer with a phone is queued failed (%)', n; end if;
  if (select status from public.cs_campaigns where id = '00000000-0000-4000-8000-0000000000c1') <> 'مجدولة' then raise exception 'case the campaign is scheduled failed'; end if;
  if (select size from public.cs_campaigns where id = '00000000-0000-4000-8000-0000000000c1') <> 1 then raise exception 'case the size is the audience failed'; end if;
  begin
    perform phone from public.cs_campaign_recipients;
    raise exception 'case a member never reads a recipient phone failed';
  exception when insufficient_privilege then null;
  end;
  if (select count(*) from public.cs_campaign_recipients where campaign_id = '00000000-0000-4000-8000-0000000000c1') <> 1 then raise exception 'case the member reads the recipients (no phone) failed'; end if;
  begin
    perform public.cs_campaign_schedule('00000000-0000-4000-8000-0000000000c2', array['00000000-0000-4000-8000-0000000000b1']::uuid[], now());
    raise exception 'case a running campaign is not rescheduled failed';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.cs_campaign_schedule('00000000-0000-4000-8000-0000000000c1', array['00000000-0000-4000-8000-0000000000b1']::uuid[], now());
    raise exception 'case a scheduled campaign is not scheduled again (pause it first) failed';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- ================================================================ ops (cs.manage N): refused

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);

do $$ begin
  begin
    perform public.cs_campaign_schedule('00000000-0000-4000-8000-0000000000c1', array['00000000-0000-4000-8000-0000000000b1']::uuid[], now());
    raise exception 'case cs.manage N cannot schedule failed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ================================================================ service_role: the bridge state and the sending columns

reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

do $$ begin
  update public.cs_wa_state set status = 'qr', qr_svg = '<svg/>', updated_at = now() where channel = 'wa1';
  begin
    update public.cs_wa_state set status = 'weird' where channel = 'wa1';
    raise exception 'case a status outside the list is refused failed';
  exception when check_violation then null;
  end;
  update public.cs_campaign_recipients set claimed_at = now(), wa_id = 'ABC', status = 'sent' where campaign_id = '00000000-0000-4000-8000-0000000000c1';
end $$;

-- ================================================================ anon: nothing

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$ begin
  begin
    perform public.cs_campaign_schedule('00000000-0000-4000-8000-0000000000c1', array['00000000-0000-4000-8000-0000000000b1']::uuid[], now());
    raise exception 'case anon cannot schedule failed';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
do $$ begin raise notice 'rls_cs_wa: ok'; end $$;
rollback;
