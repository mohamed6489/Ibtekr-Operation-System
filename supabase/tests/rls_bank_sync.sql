-- RLS / permission tests for 0017_bank_sync (vendor_bank's five Dokan columns and the field `bank` in vendor_push_pending:
-- the admin or sensitive.vendor_bank = F, whatever vendors.edit says).
-- Depends on 0001_identity … 0017_bank_sync.
-- Runs in one transaction and rolls back; prints NOTICE 'rls_bank_sync: ok' only if every case passed.
-- Live-safe: every count is scoped to the rows this file writes. Every name, number and phone is made up.

begin;

-- Test users (fixed UUIDs …b1–…b4): admin; accounts (sensitive.vendor_bank = F, vendors.edit = N by custom_perms);
-- ops (vendors.edit = P, sensitive.vendor_bank = N); a vendors.edit = F member without the bank key.
insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000000b1', 'bk-admin.dev@ibtekr.local', '010000000b1'),
  ('00000000-0000-4000-8000-0000000000b2', 'bk-acc.dev@ibtekr.local',   '010000000b2'),
  ('00000000-0000-4000-8000-0000000000b3', 'bk-ops.dev@ibtekr.local',   '010000000b3'),
  ('00000000-0000-4000-8000-0000000000b4', 'bk-edit.dev@ibtekr.local',  '010000000b4');

insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email)
from auth.users u
where u.id in ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b2',
               '00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000b4');

insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-0000000000b1', 'أدمن البنك',   'bk-admin.dev@ibtekr.local', '010000000b1', 'admin',    'active', '{}'),
  ('00000000-0000-4000-8000-0000000000b2', 'حسابات البنك', 'bk-acc.dev@ibtekr.local',   '010000000b2', 'accounts', 'active', '{"sensitive.vendor_bank":"F","vendors.edit":"N"}'),
  ('00000000-0000-4000-8000-0000000000b3', 'عمليات البنك', 'bk-ops.dev@ibtekr.local',   '010000000b3', 'ops',      'active', '{"vendors.edit":"P","sensitive.vendor_bank":"N"}'),
  ('00000000-0000-4000-8000-0000000000b4', 'متابعة البنك', 'bk-edit.dev@ibtekr.local',  '010000000b4', 'ops',      'active', '{"vendors.edit":"F","sensitive.vendor_bank":"N"}');

insert into public.vendors (id, woo_vendor_id, name, status) values
  ('00000000-0000-4000-8000-0000000000f1', 9971, 'ورشة البنك', 'active');

-- ================================================================ runner: the columns, and the move of an account number out of iban

do $$ begin
  if (select string_agg(column_name || ':' || data_type, ',' order by column_name) from information_schema.columns
      where table_schema = 'public' and table_name = 'vendor_bank' and column_name in ('account_number', 'account_type', 'bank_address', 'routing_number', 'swift'))
     <> 'account_number:text,account_type:text,bank_address:text,routing_number:text,swift:text' then
    raise exception 'case vendor_bank has the five Dokan columns (text) failed';
  end if;
  insert into public.vendor_bank (vendor_id, method, bank_name, holder, iban) values ('00000000-0000-4000-8000-0000000000f1', 'bank', 'بنك تجريبي', 'صاحب تجريبي', '1234567890123');
  -- the statement of 0017 again (re-runnable): digits only → account_number; an EG IBAN stays
  update public.vendor_bank set account_number = iban, iban = null where iban ~ '^[0-9]+$' and account_number is null and vendor_id = '00000000-0000-4000-8000-0000000000f1';
  if not ((select coalesce(iban, '∅') || '/' || account_number from public.vendor_bank where vendor_id = '00000000-0000-4000-8000-0000000000f1') = '∅/1234567890123') then
    raise exception 'case a digits-only iban moves to account_number failed';
  end if;
end $$;

-- ================================================================ accounts (sensitive.vendor_bank = F, vendors.edit = N): writes the new columns, queues `bank`

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}';
do $$ declare r jsonb; begin
  update public.vendor_bank set account_type = 'personal', swift = 'TESTEGCX', bank_address = 'عنوان تجريبي', routing_number = '000'
  where vendor_id = '00000000-0000-4000-8000-0000000000f1';
  if not ((select account_type || '/' || swift from public.vendor_bank where vendor_id = '00000000-0000-4000-8000-0000000000f1') = 'personal/TESTEGCX') then
    raise exception 'case accounts writes the new columns failed';
  end if;
  r := public.vendor_push_pending('00000000-0000-4000-8000-0000000000f1', array['bank', 'bogus']);
  if r <> '["bank"]'::jsonb then raise exception 'case accounts queues bank (an unknown name dropped) failed: %', r; end if;
  begin
    perform public.vendor_push_pending('00000000-0000-4000-8000-0000000000f1', array['bank', 'name']);
    raise exception 'case accounts with a store field must error failed';
  exception when others then
    if sqlstate <> '42501' then raise exception 'case accounts + name: expected 42501 got % (%)', sqlstate, sqlerrm; end if;
  end;
end $$;

-- ================================================================ ops (vendors.edit = P, bank N) and a vendors.edit = F member without the bank key: 42501 for bank

reset role;
set local role authenticated;
do $$ declare who text; begin
  foreach who in array array['b3', 'b4'] loop
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000' || who || '","role":"authenticated"}', true);
    begin
      perform public.vendor_push_pending('00000000-0000-4000-8000-0000000000f1', array['bank']);
      raise exception 'case user …% bank must error failed', who;
    exception when others then
      if sqlstate <> '42501' then raise exception 'case user …% bank: expected 42501, got % (%)', who, sqlstate, sqlerrm; end if;
    end;
    -- the bank row stays out of reach without the key
    if (select count(*) from public.vendor_bank where vendor_id = '00000000-0000-4000-8000-0000000000f1') <> 0 then
      raise exception 'case user …% must not read vendor_bank failed', who;
    end if;
  end loop;
  -- ops still queues a contact field alone (the 0014 rule kept)
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b3","role":"authenticated"}', true);
  if public.vendor_push_pending('00000000-0000-4000-8000-0000000000f1', array['phone']) <> '["bank", "phone"]'::jsonb then
    raise exception 'case ops queues phone (the list keeps bank) failed';
  end if;
end $$;

-- ================================================================ admin: bank with a store field and a rate field

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}';
do $$ begin
  if public.vendor_push_pending('00000000-0000-4000-8000-0000000000f1', array['bank', 'name', 'rate']) <> '["bank", "name", "phone", "rate"]'::jsonb then
    raise exception 'case admin queues bank + name + rate failed';
  end if;
end $$;

-- ================================================================ anon: no execute

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$ begin
  begin
    perform public.vendor_push_pending('00000000-0000-4000-8000-0000000000f1', array['bank']);
    raise exception 'case anon must error failed';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;

do $$ begin raise notice 'rls_bank_sync: ok'; end $$;
