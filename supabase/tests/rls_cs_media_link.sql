-- RLS / permission tests for 0064_cs_media_link (phase 13 T3: cs_link_contact ties a channel conversation to an existing customer — cs.reply
-- on a conversation the member sees; the contact row follows; an event line is written; the bucket cs-media exists private). Depends on
-- 0001 … 0064. One transaction rolled back; prints NOTICE 'rls_cs_media_link: ok' only if every case passed. Live-safe (own rows only).

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000064a1', 'ml-adm.dev@ibtekr.local', '01000064a01'),
  ('00000000-0000-4000-8000-0000000064a2', 'ml-cs.dev@ibtekr.local', '01000064a02'),
  ('00000000-0000-4000-8000-0000000064a3', 'ml-view.dev@ibtekr.local', '01000064a03'),
  ('00000000-0000-4000-8000-0000000064a4', 'ml-acc.dev@ibtekr.local', '01000064a04');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u where u.email like 'ml-%.dev@ibtekr.local';
insert into public.profiles (id, name, email, phone, role_id, status) values
  ('00000000-0000-4000-8000-0000000064a1', 'أدمن الربط', 'ml-adm.dev@ibtekr.local', '01000064a01', 'admin', 'active'),
  ('00000000-0000-4000-8000-0000000064a2', 'خدمة عملاء', 'ml-cs.dev@ibtekr.local', '01000064a02', 'cs', 'active'),
  ('00000000-0000-4000-8000-0000000064a3', 'مشاهد', 'ml-view.dev@ibtekr.local', '01000064a03', 'viewer', 'active'),
  ('00000000-0000-4000-8000-0000000064a4', 'حسابات', 'ml-acc.dev@ibtekr.local', '01000064a04', 'accounts', 'active');

-- the server's rows: a customer, a Messenger conversation whose user is not a customer yet, a second customer to re-link to
insert into public.cs_customers (id, phone, name, created_from, source) values
  ('00000000-0000-4000-8000-0000000064c1', '01000064001', 'نهى الربط', 'manual', 'test'),
  ('00000000-0000-4000-8000-0000000064c2', '01000064002', 'كريم الربط', 'manual', 'test');
insert into public.cs_conversations (id, seg, platform, channel, customer_id, external_id, handle, status) values
  ('00000000-0000-4000-8000-0000000064d1', 'customers', 'messenger', 'messenger', null, 'psid-64-1', 'Noha FB', 'جديدة');

set local role authenticated;

-- cs (cs.reply F, cs.view F): links the thread → the conversation's customer, the contact row, an event
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000064a2","role":"authenticated"}', true);
do $$ begin
  if public.cs_link_contact('00000000-0000-4000-8000-0000000064d1', '00000000-0000-4000-8000-0000000064c1') <> '00000000-0000-4000-8000-0000000064c1' then raise exception 'case link failed'; end if;
  if (select customer_id from public.cs_conversations where id = '00000000-0000-4000-8000-0000000064d1') <> '00000000-0000-4000-8000-0000000064c1' then raise exception 'case the conversation customer failed'; end if;
  if (select customer_id from public.cs_contacts where platform = 'messenger' and external_id = 'psid-64-1') <> '00000000-0000-4000-8000-0000000064c1' then raise exception 'case the contact row failed'; end if;
  if (select count(*) from public.cs_messages where conversation_id = '00000000-0000-4000-8000-0000000064d1' and kind = 'event' and text like '%نهى الربط%') <> 1 then raise exception 'case the event line failed'; end if;
  -- re-linked to another customer: the contact follows, the event names the old one
  perform public.cs_link_contact('00000000-0000-4000-8000-0000000064d1', '00000000-0000-4000-8000-0000000064c2');
  if (select customer_id from public.cs_contacts where platform = 'messenger' and external_id = 'psid-64-1') <> '00000000-0000-4000-8000-0000000064c2' then raise exception 'case the contact re-link failed'; end if;
  if (select count(*) from public.cs_messages where conversation_id = '00000000-0000-4000-8000-0000000064d1' and kind = 'event' and text like '%كانت على «نهى الربط»%') <> 1 then raise exception 'case the re-link event failed'; end if;
  -- the same customer again: nothing more
  perform public.cs_link_contact('00000000-0000-4000-8000-0000000064d1', '00000000-0000-4000-8000-0000000064c2');
  if (select count(*) from public.cs_messages where conversation_id = '00000000-0000-4000-8000-0000000064d1' and kind = 'event') <> 2 then raise exception 'case an idempotent link failed'; end if;
  begin perform public.cs_link_contact('00000000-0000-4000-8000-0000000064d9', '00000000-0000-4000-8000-0000000064c1'); raise exception 'case an unknown conversation failed';
  exception when no_data_found then null; end;
  begin perform public.cs_link_contact('00000000-0000-4000-8000-0000000064d1', '00000000-0000-4000-8000-0000000064c9'); raise exception 'case an unknown customer failed';
  exception when no_data_found then null; end;
  -- a member never writes customer_id straight (0034's guard)
  begin update public.cs_conversations set customer_id = '00000000-0000-4000-8000-0000000064c1' where id = '00000000-0000-4000-8000-0000000064d1'; raise exception 'case a direct customer_id write failed';
  exception when insufficient_privilege then null; end;
end $$;

-- the viewer (cs.view P, cs.reply N): refused; accounts (cs.view N): refused before anything is read
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000064a3","role":"authenticated"}', true);
do $$ begin
  begin perform public.cs_link_contact('00000000-0000-4000-8000-0000000064d1', '00000000-0000-4000-8000-0000000064c1'); raise exception 'case the viewer links failed';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000064a4","role":"authenticated"}', true);
do $$ begin
  begin perform public.cs_link_contact('00000000-0000-4000-8000-0000000064d1', '00000000-0000-4000-8000-0000000064c1'); raise exception 'case accounts links failed';
  exception when insufficient_privilege then null; end;
end $$;

-- anon: nothing
set local role anon;
do $$ begin
  begin perform public.cs_link_contact('00000000-0000-4000-8000-0000000064d1', '00000000-0000-4000-8000-0000000064c1'); raise exception 'case anon on cs_link_contact failed';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
-- the bucket, where Storage exists (the live project): private, 10 MB, images + PDF
do $$ begin
  if to_regclass('storage.buckets') is not null then
    if not exists (select 1 from storage.buckets where id = 'cs-media' and public = false and file_size_limit = 10485760) then raise exception 'case the cs-media bucket failed'; end if;
  end if;
end $$;
do $$ begin raise notice 'rls_cs_media_link: ok'; end $$;
rollback;
