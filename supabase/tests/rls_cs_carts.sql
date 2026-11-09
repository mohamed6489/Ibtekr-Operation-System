-- RLS / permission tests for 0062_cs_carts (phase 12 T7: the visitor's abandoned carts mirror — the server writes, cs.view reads
-- through cs_carts_v with the phone masked unless sensitive.customer_phone = F, the table grants no phone column). Depends on 0001 … 0062.
-- One transaction rolled back; prints NOTICE 'rls_cs_carts: ok' only if every case passed. Live-safe (own rows only).

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000062a1', 'ct-adm.dev@ibtekr.local', '01000062a01'),
  ('00000000-0000-4000-8000-0000000062a2', 'ct-cs.dev@ibtekr.local', '01000062a02'),
  ('00000000-0000-4000-8000-0000000062a3', 'ct-acc.dev@ibtekr.local', '01000062a03');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u where u.email like 'ct-%.dev@ibtekr.local';
insert into public.profiles (id, name, email, phone, role_id, status) values
  ('00000000-0000-4000-8000-0000000062a1', 'أدمن السلة', 'ct-adm.dev@ibtekr.local', '01000062a01', 'admin', 'active'),
  ('00000000-0000-4000-8000-0000000062a2', 'خدمة عملاء', 'ct-cs.dev@ibtekr.local', '01000062a02', 'cs', 'active'),
  ('00000000-0000-4000-8000-0000000062a3', 'حسابات', 'ct-acc.dev@ibtekr.local', '01000062a03', 'accounts', 'active');

-- the server mirrors a cart (the test's own row: the site's id 962000001)
insert into public.cs_carts (cart_id, email, phone, name, total, items, status, url, site_updated_at)
values (962000001, 'noha@example.test', '+20 101 234 5678', 'نهى', 1250, 2, 'normal', 'https://staging.ibtekr.club/checkout/?wcf_ac_token=abc', now() - interval '2 hours');
do $$ begin
  begin insert into public.cs_carts (cart_id, status, site_updated_at) values (962000002, 'paid', now()); raise exception 'case a bad status failed';
  exception when check_violation then null; end;
  begin insert into public.cs_carts (cart_id, url, site_updated_at) values (962000002, 'http://x', now()); raise exception 'case a plain-http link failed';
  exception when check_violation then null; end;
end $$;

set local role authenticated;

-- cs (cs.view F, sensitive.customer_phone F): the row through the view with the phone in full; the table's phone column is not granted
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000062a2","role":"authenticated"}', true);
do $$ begin
  if (select phone from public.cs_carts_v where cart_id = 962000001) <> '+20 101 234 5678' then raise exception 'case cs reads the phone in full failed'; end if;
  if (select (name, total, items, status) from public.cs_carts_v where cart_id = 962000001) is distinct from ('نهى'::text, 1250::numeric(12, 2), 2, 'normal'::text) then raise exception 'case cs reads the cart failed'; end if;
  begin perform phone from public.cs_carts where cart_id = 962000001; raise exception 'case the table phone column failed';
  exception when insufficient_privilege then null; end;
  begin insert into public.cs_carts (cart_id, site_updated_at) values (962000003, now()); raise exception 'case a member writes a cart failed';
  exception when insufficient_privilege then null; end;
  begin update public.cs_carts set status = 'lost' where cart_id = 962000001; raise exception 'case a member updates a cart failed';
  exception when insufficient_privilege then null; end;
  begin delete from public.cs_carts where cart_id = 962000001; raise exception 'case a member deletes a cart failed';
  exception when insufficient_privilege then null; end;
end $$;

-- accounts (cs.view N): nothing through the view, and the phone function answers null
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000062a3","role":"authenticated"}', true);
do $$ begin
  if (select count(*) from public.cs_carts_v where cart_id = 962000001) <> 0 then raise exception 'case accounts reads a cart failed'; end if;
  if public.cs_cart_phone(962000001) is not null then raise exception 'case the phone function without cs.view failed'; end if;
end $$;

-- the admin without sensitive.customer_phone = F? the admin has every permission: full. A member with cs.view and the phone masked is
-- the viewer role (cs.view P, sensitive.customer_phone N) — covered by mask_phone's own test in rls_orders; here the function's branch:
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000062a1","role":"authenticated"}', true);
do $$ begin
  if (select phone from public.cs_carts_v where cart_id = 962000001) <> '+20 101 234 5678' then raise exception 'case the admin reads the phone failed'; end if;
  if public.mask_phone(public.norm_phone('+20 101 234 5678')) <> '010••••5678' then raise exception 'case the mask of a normalised phone failed: %', public.mask_phone(public.norm_phone('+20 101 234 5678')); end if;
end $$;

-- anon: nothing
set local role anon;
do $$ begin
  begin perform count(*) from public.cs_carts; raise exception 'case anon on cs_carts failed';
  exception when insufficient_privilege then null; end;
  begin perform count(*) from public.cs_carts_v; raise exception 'case anon on cs_carts_v failed';
  exception when insufficient_privilege then null; end;
  begin perform public.cs_cart_phone(962000001); raise exception 'case anon on cs_cart_phone failed';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
do $$ begin raise notice 'rls_cs_carts: ok'; end $$;
rollback;
