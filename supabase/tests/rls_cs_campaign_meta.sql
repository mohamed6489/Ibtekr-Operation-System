-- RLS / permission tests for 0063_campaigns_meta (phase 13 T1: a campaign on WhatsApp 1 carries the Meta template it sends;
-- cs.manage sets it on a draft / scheduled campaign and reads it back; a running campaign's template is not edited; the server
-- (service_role) moves the campaign along). Depends on 0001 … 0063.
-- One transaction rolled back; prints NOTICE 'rls_cs_campaign_meta: ok' only if every case passed. Live-safe (own rows only).

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000063a1', 'cm-adm.dev@ibtekr.local', '01000063a01'),
  ('00000000-0000-4000-8000-0000000063a2', 'cm-cs.dev@ibtekr.local', '01000063a02'),
  ('00000000-0000-4000-8000-0000000063a3', 'cm-ops.dev@ibtekr.local', '01000063a03');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u where u.email like 'cm-%.dev@ibtekr.local';
insert into public.profiles (id, name, email, phone, role_id, status) values
  ('00000000-0000-4000-8000-0000000063a1', 'أدمن الحملات', 'cm-adm.dev@ibtekr.local', '01000063a01', 'admin', 'active'),
  ('00000000-0000-4000-8000-0000000063a2', 'خدمة عملاء', 'cm-cs.dev@ibtekr.local', '01000063a02', 'cs', 'active'),
  ('00000000-0000-4000-8000-0000000063a3', 'عمليات', 'cm-ops.dev@ibtekr.local', '01000063a03', 'ops', 'active');

set local role authenticated;

-- cs (cs.manage F): a Meta template, a draft campaign carrying it, read back; the template moves to another on the draft
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000063a2","role":"authenticated"}', true);
do $$
declare tid uuid; tid2 uuid; kid uuid;
begin
  insert into public.cs_templates (lib, name, cat, body, trig_kind, wa_template, wa_vars)
  values ('customers', 'عرض الجمعة', 'عروض', 'أهلاً {اسم_العميل} 👋 خصم بكود {كود_الخصم}.', 'campaign', 'ibtekr_offer_v1', '{"اسم_العميل","كود_الخصم"}') returning id into tid;
  insert into public.cs_templates (lib, name, cat, body, trig_kind, wa_template, wa_vars)
  values ('customers', 'عرض العيد', 'عروض', 'كل سنة وانت طيب {اسم_العميل} 🎉', 'campaign', 'ibtekr_eid_v1', '{"اسم_العميل"}') returning id into tid2;
  insert into public.cs_campaigns (name, channel, body, discount_code, template_id, status) values ('حملة الجمعة', 'wa1', 'أهلاً {اسم_العميل} 👋 خصم بكود {كود_الخصم}.', 'FRI10', tid, 'مسودة') returning id into kid;
  if (select template_id from public.cs_campaigns where id = kid) is distinct from tid then raise exception 'case the template is read back failed'; end if;
  update public.cs_campaigns set template_id = tid2 where id = kid;
  if (select template_id from public.cs_campaigns where id = kid) is distinct from tid2 then raise exception 'case the draft changes its template failed'; end if;
  perform set_config('ibtekr.test_kid', kid::text, true);
end $$;

-- ops (cs.manage N): reads the campaign and its template id, cannot change it
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000063a3","role":"authenticated"}', true);
do $$
declare kid uuid := current_setting('ibtekr.test_kid', true)::uuid;
begin
  if (select count(*) from public.cs_campaigns where id = kid and template_id is not null) <> 1 then raise exception 'case ops reads the campaign failed'; end if;
  update public.cs_campaigns set template_id = null where id = kid;
  if (select template_id from public.cs_campaigns where id = kid) is null then raise exception 'case ops changed the template failed'; end if; -- RLS: no row matched
end $$;

-- the server runs it; then nobody but the server edits its template
reset role;
do $$
declare kid uuid := current_setting('ibtekr.test_kid', true)::uuid;
begin
  update public.cs_campaigns set status = 'شغالة' where id = kid;
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000063a2","role":"authenticated"}', true);
do $$
declare kid uuid := current_setting('ibtekr.test_kid', true)::uuid;
begin
  begin update public.cs_campaigns set template_id = null where id = kid; raise exception 'case a running campaign changes its template failed';
  exception when insufficient_privilege then null; end;
  begin update public.cs_campaigns set status = 'متوقفة' where id = kid; raise exception 'case a running campaign changes its status failed';
  exception when insufficient_privilege then null; end; -- 0034's rule, unchanged: the server moves a running campaign
end $$;

-- anon: nothing
set local role anon;
do $$ begin
  begin perform count(*) from public.cs_campaigns; raise exception 'case anon on cs_campaigns failed';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
do $$ begin raise notice 'rls_cs_campaign_meta: ok'; end $$;
rollback;
