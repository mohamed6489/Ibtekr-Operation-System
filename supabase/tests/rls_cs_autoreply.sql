-- RLS / permission tests for 0058_cs_autoreply (phase 6.5: templates · quick replies · auto rules written with cs.manage = F and
-- read with cs.view; the engine's run log is the server's; the sending settings function). Depends on 0001 … 0058.
-- One transaction rolled back; prints NOTICE 'rls_cs_autoreply: ok' only if every case passed. Live-safe (own rows only).

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000058a1', 'ar-adm.dev@ibtekr.local', '01000058a01'),
  ('00000000-0000-4000-8000-0000000058a2', 'ar-cs.dev@ibtekr.local', '01000058a02'),
  ('00000000-0000-4000-8000-0000000058a3', 'ar-ops.dev@ibtekr.local', '01000058a03'),
  ('00000000-0000-4000-8000-0000000058a4', 'ar-view.dev@ibtekr.local', '01000058a04');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u where u.email like 'ar-%.dev@ibtekr.local';
insert into public.profiles (id, name, email, phone, role_id, status) values
  ('00000000-0000-4000-8000-0000000058a1', 'أدمن الرد الآلي', 'ar-adm.dev@ibtekr.local', '01000058a01', 'admin', 'active'),
  ('00000000-0000-4000-8000-0000000058a2', 'خدمة عملاء', 'ar-cs.dev@ibtekr.local', '01000058a02', 'cs', 'active'),
  ('00000000-0000-4000-8000-0000000058a3', 'عمليات', 'ar-ops.dev@ibtekr.local', '01000058a03', 'ops', 'active'),
  ('00000000-0000-4000-8000-0000000058a4', 'مشاهد', 'ar-view.dev@ibtekr.local', '01000058a04', 'viewer', 'active');

set local role authenticated;

-- cs (cs.manage F): adds a template, a quick reply and a rule; the stamps are the server's; used / runs cannot be written
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000058a2","role":"authenticated"}', true);
do $$
declare tid uuid; rid uuid;
begin
  insert into public.cs_templates (lib, name, cat, body, trig_kind, trig_on, quick_key, wa_template, wa_vars)
  values ('customers', 'تأكيد الأوردر', 'حالة الأوردر', 'أهلاً {اسم_العميل} 👋 أوردرك {رقم_الأوردر} اتأكد.', 'auto', '{"جاري التنفيذ"}', '/تأكيد', 'order_confirmed_v1', '{"اسم_العميل","رقم_الأوردر"}')
  returning id into tid;
  if (select (created_by, used, active) from public.cs_templates where id = tid) is distinct from ('00000000-0000-4000-8000-0000000058a2'::uuid, 0, true) then
    raise exception 'case the template''s stamps failed';
  end if;
  begin insert into public.cs_templates (name, body, used) values ('x', 'y', 5); raise exception 'case a member writes used failed';
  exception when insufficient_privilege then null; end;
  begin update public.cs_templates set used = 9 where id = tid; raise exception 'case a member changes used failed';
  exception when insufficient_privilege then null; end;
  begin insert into public.cs_templates (name, body, quick_key) values ('x', 'y', 'تأكيد'); raise exception 'case a quick key without / failed';
  exception when check_violation then null; end;
  begin insert into public.cs_templates (name, body, quick_key) values ('x', 'y', '/تأكيد'); raise exception 'case a duplicate quick key failed';
  exception when unique_violation then null; end;
  begin insert into public.cs_templates (name, body, wa_template) values ('x', 'y', 'Order Confirmed'); raise exception 'case a bad Meta template name failed';
  exception when check_violation then null; end;
  update public.cs_templates set body = body || ' هنبعتلك أول ما يتشحن.', tone = 'brand' where id = tid;
  if (select updated_by from public.cs_templates where id = tid) <> '00000000-0000-4000-8000-0000000058a2'::uuid then raise exception 'case the update stamp failed'; end if;

  insert into public.cs_quick_replies (key, label, text) values ('/شحن', 'مواعيد الشحن', 'الشحن 2–3 أيام جوه القاهرة.');
  begin insert into public.cs_quick_replies (key, label, text) values ('شحن', 'x', 'y'); raise exception 'case a quick reply key without / failed';
  exception when check_violation then null; end;
  begin insert into public.cs_quick_replies (key, label, text) values ('/شحن', 'x', 'y'); raise exception 'case a duplicate quick reply failed';
  exception when unique_violation then null; end;

  insert into public.cs_auto_rules (name, grp, event, event_to, conds, action, template_id, delay_min, once, enabled)
  values ('تأكيد الأوردر', 'العملاء — حالة الأوردر', 'status', 'جاري التنفيذ', '[["القناة","=","واتساب 1"]]', 'send', tid, 5, true, true)
  returning id into rid;
  if (select (runs, last_run_at, created_by) from public.cs_auto_rules where id = rid) is distinct from (0, null::timestamptz, '00000000-0000-4000-8000-0000000058a2'::uuid) then
    raise exception 'case the rule''s stamps failed';
  end if;
  begin update public.cs_auto_rules set runs = 3 where id = rid; raise exception 'case a member changes runs failed';
  exception when insufficient_privilege then null; end;
  begin insert into public.cs_auto_rules (name, event, action) values ('x', 'status', 'ticket'); raise exception 'case a status rule without a status failed';
  exception when check_violation then null; end;
  begin insert into public.cs_auto_rules (name, event, action) values ('x', 'first', 'send'); raise exception 'case a send rule without a template failed';
  exception when check_violation then null; end;
  begin insert into public.cs_auto_rules (name, event, action, tag) values ('x', 'first', 'tag', null); raise exception 'case a tag rule without a tag failed';
  exception when check_violation then null; end;
  begin insert into public.cs_auto_rules (name, event, action, conds) values ('x', 'first', 'ticket', '[["a","="]]'); raise exception 'case a bad condition failed';
  exception when check_violation then null; end;
  begin insert into public.cs_auto_rules (name, event, action, conds) values ('x', 'first', 'ticket', '{"a":1}'); raise exception 'case conditions not an array failed';
  exception when check_violation then null; end;
  insert into public.cs_auto_rules (name, event, action, role_id) values ('تعيين للمتابعة', 'first', 'assign', 'cs');
  insert into public.cs_auto_rules (name, event, action) values ('خارج المواعيد', 'afterhours', 'send'); -- the settings' after-hours text, no template needed
  -- a template a rule sends cannot be deleted (the page says so)
  begin delete from public.cs_templates where id = tid; raise exception 'case deleting a used template failed';
  exception when foreign_key_violation then null; end;
  -- the run log is the server's
  begin insert into public.cs_auto_runs (rule_id, entity, result) values (rid, 'order:1', 'sent'); raise exception 'case a member writes the run log failed';
  exception when insufficient_privilege then null; end;
  -- the settings: the defaults (live off, 250 / 150)
  if (select public.cs_auto_settings() ->> 'live') <> 'false' or (select public.cs_auto_settings() -> 'daily' ->> 'wa1') <> '250'
     or (select public.cs_auto_settings() -> 'cart' ->> 'afterMin') <> '60' then
    raise exception 'case the default sending settings failed: %', public.cs_auto_settings();
  end if;
end $$;

-- ops (cs.view F, cs.manage N): reads everything, writes nothing
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000058a3","role":"authenticated"}', true);
do $$ begin
  if (select count(*) from public.cs_templates where name = 'تأكيد الأوردر') <> 1 or (select count(*) from public.cs_quick_replies where key = '/شحن') <> 1
     or (select count(*) from public.cs_auto_rules where name = 'تأكيد الأوردر') <> 1 then raise exception 'case ops reads the auto-reply tables failed'; end if;
  begin insert into public.cs_templates (name, body) values ('x', 'y'); raise exception 'case ops writes a template failed';
  exception when insufficient_privilege then null; end;
  -- an update / delete the policy hides touches no row (RLS filters, it does not raise)
  update public.cs_auto_rules set enabled = false where name = 'تأكيد الأوردر';
  if (select enabled from public.cs_auto_rules where name = 'تأكيد الأوردر') is distinct from true then raise exception 'case ops toggles a rule failed'; end if;
  delete from public.cs_quick_replies where key = '/شحن';
  if (select count(*) from public.cs_quick_replies where key = '/شحن') <> 1 then raise exception 'case ops deletes a quick reply failed'; end if;
end $$;

-- viewer (cs.view P): reads; the settings function answers
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000058a4","role":"authenticated"}', true);
do $$ begin
  if (select count(*) from public.cs_auto_rules where name = 'تأكيد الأوردر') <> 1 then raise exception 'case viewer reads the rules failed'; end if;
  if (select public.cs_auto_settings() ->> 'delayMin') <> '20' then raise exception 'case viewer reads the settings failed'; end if;
end $$;

-- admin: the settings row over the defaults; deletes a rule (its runs go with it)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000058a1","role":"authenticated"}', true);
insert into public.settings (section, data) values ('cs', '{"auto": {"live": true, "daily": {"wa1": 300, "wa2": 150}}}')
  on conflict (section) do update set data = public.settings.data || excluded.data;
do $$ begin
  if (select public.cs_auto_settings() ->> 'live') <> 'true' or (select public.cs_auto_settings() -> 'daily' ->> 'wa1') <> '300'
     or (select public.cs_auto_settings() ->> 'delayMax') <> '60' then
    raise exception 'case the settings row over the defaults failed: %', public.cs_auto_settings();
  end if;
end $$;

-- the server: the run log — one live row a (rule × entity), a failed attempt may be retried, a held row waits with its due time
reset role;
do $$
declare rid uuid;
begin
  select id into rid from public.cs_auto_rules where name = 'تأكيد الأوردر';
  insert into public.cs_auto_runs (rule_id, entity, result, code) values (rid, 'order:177702', 'failed', 'window');
  insert into public.cs_auto_runs (rule_id, entity, result, due_at) values (rid, 'order:177702', 'held', now() + interval '5 minutes');
  begin insert into public.cs_auto_runs (rule_id, entity, result) values (rid, 'order:177702', 'sent'); raise exception 'case one live run a rule and entity failed';
  exception when unique_violation then null; end;
  update public.cs_auto_runs set result = 'sent', due_at = null where rule_id = rid and entity = 'order:177702' and result = 'held';
  begin insert into public.cs_auto_runs (rule_id, entity, result) values (rid, 'ticket:5', 'sent'); raise exception 'case a bad entity failed';
  exception when check_violation then null; end;
  begin insert into public.cs_auto_runs (rule_id, entity, result, code) values (rid, 'order:1', 'skipped', 'Bad Code'); raise exception 'case a bad code failed';
  exception when check_violation then null; end;
  update public.cs_auto_rules set runs = 1, last_run_at = now() where id = rid; -- the server's columns
  delete from public.cs_auto_rules where id = rid;
  if (select count(*) from public.cs_auto_runs where entity = 'order:177702') <> 0 then raise exception 'case the runs go with the rule failed'; end if;
end $$;

-- anon: nothing
set local role anon;
do $$ begin
  begin perform count(*) from public.cs_templates; raise exception 'case anon on cs_templates failed';
  exception when insufficient_privilege then null; end;
  begin perform count(*) from public.cs_auto_runs; raise exception 'case anon on cs_auto_runs failed';
  exception when insufficient_privilege then null; end;
  begin perform public.cs_auto_settings(); raise exception 'case anon on cs_auto_settings failed';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
do $$ begin raise notice 'rls_cs_autoreply: ok'; end $$;
rollback;
