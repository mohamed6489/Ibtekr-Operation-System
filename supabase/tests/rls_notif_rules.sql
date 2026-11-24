-- Tests for 0157 (the notifications' new structure — Safwat 24 Nov): the seed (main sections, sub-sections, rules); every active member
-- reads the tree, nobody writes it directly; the admin's functions add / rename / order / delete a section and save / delete a rule;
-- a rule sits under a sub-section only, with roles that exist and a visibility that matches its hours; a non-admin writes nothing;
-- the alerts carry their rule / sub-section / hide_at, and a deleted rule leaves its alerts with the sub-section and no rule.
-- Depends on 0001 … 0157. One transaction, rolled back; NOTICE 'rls_notif_rules: ok' only if every case passed.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-000000157a01', 'nr-adm.dev@ibtekr.local', '0100157a01'),
  ('00000000-0000-4000-8000-000000157a02', 'nr-ops.dev@ibtekr.local', '0100157a02');
insert into public.profiles (id, name, email, phone, role_id, status) values
  ('00000000-0000-4000-8000-000000157a01', 'أدمن التنبيهات', 'nr-adm.dev@ibtekr.local', '0100157a01', 'admin', 'active'),
  ('00000000-0000-4000-8000-000000157a02', 'عمليات التنبيهات', 'nr-ops.dev@ibtekr.local', '0100157a02', 'ops', 'active');

do $$ begin
  if (select count(*) from public.notif_sections where parent_id is null) < 8 then raise exception 'case the seed''s main sections failed'; end if;
  if not exists (select 1 from public.notif_sections s join public.notif_sections m on m.id = s.parent_id where m.name = 'مساعدين الذكاء الاصطناعي' and s.name = 'باقي المساعدين') then raise exception 'case the assistants'' sub-sections failed'; end if;
  if (select count(*) from public.notif_rules) < 30 then raise exception 'case the seed''s rules failed'; end if;
  if exists (select 1 from public.notif_rules r join public.notif_sections s on s.id = r.section_id where s.parent_id is null) then raise exception 'case rules under sub-sections only failed'; end if;
end $$;

-- a member reads, writes nothing
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000157a02","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.notif_sections) = 0 or (select count(*) from public.notif_rules) = 0 then raise exception 'case an active member reads the tree failed'; end if;
  begin insert into public.notif_sections (name) values ('x'); raise exception 'case no direct insert failed'; exception when insufficient_privilege then null; end;
  begin perform public.notif_section_save('{"name":"قسم"}'::jsonb); raise exception 'case a non-admin saves no section failed'; exception when insufficient_privilege then null; end;
  begin perform public.notif_rule_delete((select id from public.notif_rules limit 1)); raise exception 'case a non-admin deletes no rule failed'; exception when insufficient_privilege then null; end;
end $$;

-- the admin
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000157a01","role":"authenticated"}';
do $$ declare m uuid; s uuid; s2 uuid; r uuid; n int; begin
  m := public.notif_section_save('{"name":"قسم تجربة"}'::jsonb);
  s := public.notif_section_save(jsonb_build_object('name', 'فرعي', 'parent_id', m));
  s2 := public.notif_section_save(jsonb_build_object('name', 'فرعي 2', 'parent_id', m));
  begin perform public.notif_section_save(jsonb_build_object('name', 'تحت فرعي', 'parent_id', s)); raise exception 'case two levels only failed'; exception when invalid_parameter_value then null; end;
  begin perform public.notif_section_save('{"name":"<b>"}'::jsonb); raise exception 'case a name without <> failed'; exception when invalid_parameter_value then null; end;
  perform public.notif_section_order(array[s2, s]);
  if (select sort from public.notif_sections where id = s2) > (select sort from public.notif_sections where id = s) then raise exception 'case the order failed'; end if;
  begin perform public.notif_section_order(array[m, s]); raise exception 'case one level at a time failed'; exception when invalid_parameter_value then null; end;
  r := public.notif_rule_save(jsonb_build_object('section_id', s, 'name', 'العهدة', 'element', 'custody', 'type', 'balance', 'state', 'low', 'param', 200,
    'at', '09:00', 'repeat', '24h', 'show', 'until_state', 'hours', 0, 'roles', '["admin","ops"]'::jsonb, 'channels', '["bell"]'::jsonb));
  if (select param from public.notif_rules where id = r) <> 200 then raise exception 'case the rule is saved failed'; end if;
  begin perform public.notif_rule_save(jsonb_build_object('section_id', m, 'name', 'x', 'element', 'orders', 'type', 'confirm', 'state', 'غير مؤكد', 'roles', '["admin"]'::jsonb)); raise exception 'case a rule under a main section failed'; exception when invalid_parameter_value then null; end;
  begin perform public.notif_rule_save(jsonb_build_object('section_id', s, 'name', 'x', 'element', 'orders', 'type', 'confirm', 'state', 'غير مؤكد', 'roles', '["nope"]'::jsonb)); raise exception 'case unknown roles failed'; exception when invalid_parameter_value then null; end;
  begin perform public.notif_rule_save(jsonb_build_object('section_id', s, 'name', 'x', 'element', 'orders', 'type', 'confirm', 'state', 'غير مؤكد', 'roles', '["admin"]'::jsonb, 'show', 'fixed', 'hours', 5)); raise exception 'case the hours of the visibility failed'; exception when invalid_parameter_value then null; end;
  -- an alert of the rule; the rule deleted → the alert keeps its sub-section and loses the rule
  reset role;
  insert into public.alerts (kind, title, user_id, entity_id, rule_id, section_id) values ('rule:custody.balance', 'تجربة', '00000000-0000-4000-8000-000000157a01', 'custody:low', r, s);
  set local role authenticated;
  perform public.notif_rule_delete(r);
  if exists (select 1 from public.alerts where entity_id = 'custody:low' and (rule_id is not null or section_id is distinct from s)) then raise exception 'case a deleted rule''s alert failed'; end if;
  perform public.notif_section_delete(m);
  if exists (select 1 from public.notif_sections where id in (m, s, s2)) then raise exception 'case a main section goes with its sub-sections failed'; end if;
  raise notice 'rls_notif_rules: ok';
end $$;
rollback;
