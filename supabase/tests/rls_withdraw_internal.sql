-- Tests for 0152 (the meeting of 23 Nov [#19] — «داخلي — اتعمل من السيستم»): a withdraw request carries `internal` (false unless the
-- server marks it), a member who reads the accounts reads it with the request, and no member writes it — only the server (woo-sync
-- withdraw_create and the hourly pull). Depends on 0001 … 0152. One transaction, rolled back; NOTICE 'rls_withdraw_internal: ok' only
-- if every case passed. Live-safe: a made-up member, maker and requests far from the site's.

begin;

insert into auth.users (id, email, phone) values ('00000000-0000-4000-8000-000000152a01', 'wd-internal.dev@ibtekr.local', '0100152a01');
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-000000152a01', 'حسابات داخلي', 'wd-internal.dev@ibtekr.local', '0100152a01', 'ops', 'active', '{"accounts.view":"F","accounts.add":"F","accounts.approve":"F"}');
insert into public.vendors (id, name) values ('00000000-0000-4000-8000-000000152b01', 'مبتكر طلب داخلي 0152');
insert into public.dokan_withdrawals (id, woo_vendor_id, vendor_id, amount, status) values
  (99915201, 99915201, '00000000-0000-4000-8000-000000152b01', 500, 'pending'),
  (99915202, 99915201, '00000000-0000-4000-8000-000000152b01', 800, 'approved');
-- the server marks the one it made
update public.dokan_withdrawals set internal = true where id = 99915202;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000152a01","role":"authenticated"}';

do $$ begin
  if (select internal from public.dokan_withdrawals where id = 99915201) is distinct from false then raise exception 'case a request is not internal by default failed'; end if;
  if (select internal from public.dokan_withdrawals where id = 99915202) is distinct from true then raise exception 'case a member reads internal failed'; end if;
  begin
    update public.dokan_withdrawals set internal = true where id = 99915201;
    if (select internal from public.dokan_withdrawals where id = 99915201) then raise exception 'case only the server marks a request failed'; end if;
  exception when insufficient_privilege then null;
  end;
end $$;

do $$ begin raise notice 'rls_withdraw_internal: ok'; end $$;
rollback;
