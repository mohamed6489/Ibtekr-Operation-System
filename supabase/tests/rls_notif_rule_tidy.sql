-- Tests for 0164 (the bell follows «الإعدادات › التنبيهات» the moment a change is saved — Safwat 24 Nov): a rule's element changed →
-- its old element's alerts leave the bell, the new one's stay; an extra element changed → only that part's alerts leave; a role taken off
-- → that member's alerts leave; «تقرير» → the single alerts leave; switched off → all; deleted → all, never deleted from the table.
-- Depends on 0001 … 0164. One transaction, rolled back; NOTICE 'rls_notif_rule_tidy: ok' only if every case passed.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-000000164a01', 'nt-adm.dev@ibtekr.local', '0100164a01'),
  ('00000000-0000-4000-8000-000000164a02', 'nt-ops.dev@ibtekr.local', '0100164a02');
insert into public.profiles (id, name, email, phone, role_id, status) values
  ('00000000-0000-4000-8000-000000164a01', 'أدمن الجرس', 'nt-adm.dev@ibtekr.local', '0100164a01', 'admin', 'active'),
  ('00000000-0000-4000-8000-000000164a02', 'متابعة الجرس', 'nt-ops.dev@ibtekr.local', '0100164a02', 'vendors_followup', 'active');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000164a01","role":"authenticated"}';
do $$
declare m uuid; s uuid; r uuid; base jsonb; adm uuid := '00000000-0000-4000-8000-000000164a01'; fol uuid := '00000000-0000-4000-8000-000000164a02';
  shown int;
begin
  m := public.notif_section_save('{"name":"متابعة الجرس"}'::jsonb);
  s := public.notif_section_save(jsonb_build_object('name', 'متأخر', 'parent_id', m));
  base := jsonb_build_object('section_id', s, 'name', 'أوردر فرعي متأخر', 'element', 'subs', 'type', 'delay', 'state', 'late', 'roles', '["admin","vendors_followup"]'::jsonb,
    'conds', '[{"element":"orders","type":"delay","state":"late"}]'::jsonb);
  r := public.notif_rule_save(base);
  reset role;
  insert into public.alerts (at, kind, title, user_id, entity_id, rule_id, section_id) values
    (now(), 'rule:subs.delay', 'فرعي 1', adm, 's:1', r, s), (now(), 'rule:subs.delay', 'فرعي 1', fol, 's:1', r, s),
    (now(), 'rule:orders.delay', 'أوردر 1', adm, 'x1|o:1', r, s);
  set local role authenticated;

  -- the rule's own element changed (Safwat's case: sub-orders → the makers' making): the sub-order alerts out, the extra part's stay
  perform public.notif_rule_save(base || jsonb_build_object('id', r, 'element', 'makers', 'type', 'making'));
  reset role;
  if exists (select 1 from public.alerts where rule_id = r and kind = 'rule:subs.delay' and hide_at is null) then raise exception 'case the old element''s alerts leave failed'; end if;
  if not exists (select 1 from public.alerts where rule_id = r and kind = 'rule:orders.delay' and hide_at is null) then raise exception 'case the extra part''s alerts stay failed'; end if;
  if (select count(*) from public.alerts where rule_id = r) <> 3 then raise exception 'case never deleted failed'; end if;
  insert into public.alerts (at, kind, title, user_id, entity_id, rule_id, section_id) values
    (now(), 'rule:makers.making', 'مبتكر 1', adm, 'mk:1', r, s), (now(), 'rule:makers.making', 'مبتكر 1', fol, 'mk:1', r, s);
  set local role authenticated;

  -- a role taken off: that member's alerts out, the admin's stay
  perform public.notif_rule_save(base || jsonb_build_object('id', r, 'element', 'makers', 'type', 'making', 'roles', '["admin"]'::jsonb));
  reset role;
  if exists (select 1 from public.alerts where rule_id = r and user_id = fol and hide_at is null) then raise exception 'case a role taken off failed'; end if;
  if (select count(*) from public.alerts where rule_id = r and user_id = adm and hide_at is null) <> 2 then raise exception 'case the admin''s stay failed'; end if;
  set local role authenticated;

  -- the extra element changed: only its part's alerts out
  perform public.notif_rule_save(base || jsonb_build_object('id', r, 'element', 'makers', 'type', 'making', 'roles', '["admin"]'::jsonb,
    'conds', '[{"element":"inventory","type":"consolidation","state":"late","param":3}]'::jsonb));
  reset role;
  if exists (select 1 from public.alerts where rule_id = r and kind = 'rule:orders.delay' and hide_at is null) then raise exception 'case the extra part changed failed'; end if;
  if not exists (select 1 from public.alerts where rule_id = r and kind = 'rule:makers.making' and hide_at is null) then raise exception 'case the own part stays failed'; end if;
  set local role authenticated;

  -- switched off: all out
  perform public.notif_rule_save(base || jsonb_build_object('id', r, 'element', 'makers', 'type', 'making', 'roles', '["admin"]'::jsonb, 'active', false));
  reset role;
  if exists (select 1 from public.alerts where rule_id = r and hide_at is null) then raise exception 'case switched off failed'; end if;
  update public.alerts set hide_at = null where rule_id = r and kind = 'rule:makers.making' and user_id = adm;
  set local role authenticated;
  perform public.notif_rule_save(base || jsonb_build_object('id', r, 'element', 'makers', 'type', 'making', 'roles', '["admin"]'::jsonb, 'active', true));

  -- deleted: all out, the rows kept
  perform public.notif_rule_delete(r);
  reset role;
  select count(*) into shown from public.alerts where section_id = s and hide_at is null;
  if shown <> 0 then raise exception 'case deleted failed (% still shown)', shown; end if;
  if (select count(*) from public.alerts where section_id = s) <> 5 then raise exception 'case deleted keeps the rows failed'; end if;
  raise notice 'rls_notif_rule_tidy: ok';
end $$;

rollback;
