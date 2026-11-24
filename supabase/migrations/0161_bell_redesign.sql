-- 0161 — the bell's redesign (Safwat 24 Nov — docs/superpowers/plans/2026-11-24-bell-redesign.md).
-- 1. alerts.meta: what the bell draws and groups an alert by — its level (lv: critical | important | info), who it is about
--    (g: vendor | member | agent | customer, gid, gname) and the entity's counts (n orders, pcs pieces, st the delay). The engine
--    (notify — _shared/notif-engine.js metaOf) writes it; names and numbers only. The members read it like the rest of their rows.
-- 2. The rules' «تفاصيل الظهور» by their level (decision 1, «زي الاقتراح»): critical / important stay till the state changes (a critical
--    event a fixed 72 hours), an important event till read + 6 hours, info 2 hours after read (and 24 hours at most — the engine).
-- 3. The eight new alerts (decision 5) and a sub-section per built-in assistant (decision 4), each under its main section.

alter table public.alerts add column if not exists meta jsonb;
grant select (meta) on public.alerts to authenticated;

-- ---------------------------------------------------------------- 2. the show by level (the catalogue's showOf — the same values)
update public.notif_rules r set show = v.show, hours = v.hours, updated_at = now()
  from (values
    ('daily', 'summary', 'day', 'until_read', 2),
    ('custody', 'balance', 'deposit', 'until_read', 2),
    ('custody', 'balance', 'withdraw', 'until_read', 2),
    ('custody', 'balance', 'low', 'until_state', 0),
    ('team', 'status', 'eval_due', 'fixed', 48),
    ('team', 'status', 'no_in', 'until_state', 0),
    ('team', 'status', 'ot_start', 'until_read', 2),
    ('team', 'status', 'no_out', 'until_state', 0),
    ('team', 'update', 'clock_in', 'until_read', 2),
    ('team', 'update', 'clock_out', 'until_read', 2),
    ('team', 'update', 'req_leave', 'until_read', 2),
    ('team', 'update', 'req_advance', 'until_read', 2),
    ('team', 'update', 'req_rest', 'until_read', 2),
    ('team', 'update', 'req_special', 'until_read', 2),
    ('team', 'update', 'req_ot', 'until_read', 2),
    ('orders', 'confirm', 'مؤكد بعربون', 'until_state', 0),
    ('orders', 'confirm', 'غير مؤكد', 'until_state', 0),
    ('orders', 'status', 'جاري التنفيذ', 'until_state', 0),
    ('orders', 'status', 'معلّق', 'until_state', 0),
    ('orders', 'status', 'جاهز للشحن', 'until_state', 0),
    ('orders', 'delay', 'late', 'until_state', 0),
    ('orders', 'delay', 'ok', 'until_read', 2),
    ('orders', 'delay', 'risk', 'until_state', 0),
    ('orders', 'update', 'new', 'until_read', 2),
    ('orders', 'update', 'edit', 'until_read', 2),
    ('orders', 'update', 'delete', 'until_read', 2),
    ('orders', 'shipping', 'no_bosta', 'until_state', 0),
    ('orders', 'shipping', 'cod_error', 'until_state', 0),
    ('subs', 'status', 'مؤكد', 'until_state', 0),
    ('subs', 'status', 'جاهز للشحن من المبتكر للعميل', 'until_state', 0),
    ('subs', 'status', 'جاهز للشحن من المبتكر للمخزن', 'until_state', 0),
    ('subs', 'delay', 'late', 'until_state', 0),
    ('subs', 'delay', 'ok', 'until_read', 2),
    ('subs', 'delay', 'risk', 'until_state', 0),
    ('subs', 'update', 'new', 'until_read', 2),
    ('subs', 'update', 'edit', 'until_read', 2),
    ('subs', 'update', 'delete', 'until_read', 2),
    ('products', 'stock', 'out', 'until_state', 0),
    ('products', 'stock', 'left1', 'until_state', 0),
    ('products', 'stock', 'left3', 'until_state', 0),
    ('products', 'returns', 'wait', 'until_state', 0),
    ('products', 'update', 'trash', 'until_read', 2),
    ('products', 'update', 'batch', 'until_read', 2),
    ('products', 'update', 'draft', 'until_read', 2),
    ('products', 'update', 'edit', 'until_read', 2),
    ('products', 'update', 'move', 'until_read', 2),
    ('products', 'update', 'cat_add', 'until_read', 2),
    ('products', 'update', 'cat_delete', 'until_read', 2),
    ('products', 'update', 'cat_edit', 'until_read', 2),
    ('accounts', 'expenses', 'deposit', 'until_read', 2),
    ('accounts', 'expenses', 'withdraw', 'until_read', 2),
    ('accounts', 'payroll', 'withdraw', 'until_read', 2),
    ('accounts', 'payroll', 'due', 'fixed', 48),
    ('accounts', 'subs', 'withdraw', 'until_read', 2),
    ('accounts', 'subs', 'due', 'fixed', 48),
    ('accounts', 'ads', 'deposit', 'until_read', 2),
    ('accounts', 'ads', 'withdraw', 'until_read', 2),
    ('accounts', 'makers', 'deposit', 'until_read', 2),
    ('accounts', 'makers', 'withdraw', 'until_read', 2),
    ('accounts', 'makers', 'close_due', 'fixed', 48),
    ('accounts', 'real', 'deposit', 'until_read', 2),
    ('accounts', 'real', 'withdraw', 'until_read', 2),
    ('accounts', 'real', 'negative', 'until_state', 0),
    ('accounts', 'summary', 'day', 'until_read', 2),
    ('tickets', 'type', 'new', 'until_read', 6),
    ('tickets', 'type', 'late', 'until_state', 0),
    ('tickets', 'update', 'edit', 'until_read', 2),
    ('tickets', 'update', 'in_progress', 'until_read', 2),
    ('tickets', 'update', 'waiting', 'until_read', 2),
    ('tickets', 'update', 'resolved', 'until_read', 2),
    ('messages', 'customers', 'new', 'until_read', 6),
    ('messages', 'customers', 'waiting', 'until_state', 0),
    ('messages', 'customers', 'late', 'until_state', 0),
    ('messages', 'vendors', 'new', 'until_read', 6),
    ('messages', 'vendors', 'late', 'until_state', 0),
    ('messages', 'comments', 'new', 'until_read', 2),
    ('messages', 'comments', 'late', 'until_state', 0),
    ('messages', 'ratings', 'low', 'fixed', 72),
    ('ai', 'buyer', 'campaigns', 'until_read', 2),
    ('ai', 'buyer', 'pixel', 'until_read', 2),
    ('ai', 'buyer', 'post', 'until_read', 2),
    ('ai', 'designer', 'trends', 'until_read', 2),
    ('ai', 'designer', 'campaign', 'until_read', 2),
    ('ai', 'dev', 'wp', 'until_read', 2),
    ('ai', 'dev', 'api', 'until_read', 2),
    ('ai', 'dev', 'speed', 'until_read', 2),
    ('ai', 'manager', 'summary', 'until_read', 2),
    ('ai', 'manager', 'late', 'until_read', 6),
    ('ai', 'manager', 'rules', 'until_read', 6),
    ('ai', 'stock', 'summary', 'until_read', 2),
    ('ai', 'stock', 'late', 'until_read', 6),
    ('ai', 'stock', 'rules', 'until_read', 6),
    ('ai', 'cs', 'summary', 'until_read', 2),
    ('ai', 'cs', 'late', 'until_read', 6),
    ('ai', 'cs', 'rules', 'until_read', 6),
    ('ai', 'makers', 'summary', 'until_read', 2),
    ('ai', 'makers', 'late', 'until_read', 6),
    ('ai', 'makers', 'rules', 'until_read', 6),
    ('ai', 'accountant', 'summary', 'until_read', 2),
    ('ai', 'accountant', 'late', 'until_read', 6),
    ('ai', 'accountant', 'rules', 'until_read', 6),
    ('ai', 'hr', 'summary', 'until_read', 2),
    ('ai', 'hr', 'late', 'until_read', 6),
    ('ai', 'hr', 'rules', 'until_read', 6),
    ('ai', 'content', 'summary', 'until_read', 2),
    ('ai', 'content', 'late', 'until_read', 6),
    ('ai', 'content', 'rules', 'until_read', 6),
    ('ai', 'any', 'notes', 'until_read', 2),
    ('makers', 'making', 'late', 'until_state', 0),
    ('makers', 'making', 'risk', 'until_state', 0),
    ('makers', 'making', 'confirmed', 'until_read', 2),
    ('makers', 'making', 'cancelled', 'until_read', 2),
    ('makers', 'accounts', 'withdraw', 'until_read', 6),
    ('makers', 'accounts', 'settle', 'until_read', 2),
    ('makers', 'accounts', 'withdraw_wait', 'until_state', 0),
    ('makers', 'update', 'add', 'until_read', 2),
    ('makers', 'update', 'delete', 'until_read', 2),
    ('makers', 'update', 'edit', 'until_read', 2),
    ('makers', 'update', 'brand', 'until_read', 2),
    ('makers', 'update', 'move', 'until_read', 2),
    ('makers', 'update', 'status', 'until_read', 2),
    ('inventory', 'consolidation', 'late', 'until_state', 0),
    ('inventory', 'lost', 'new', 'fixed', 72),
    ('system', 'links', 'down', 'until_state', 0)) v(element, type, state, show, hours)
 where r.element = v.element and r.type = v.type and r.state = v.state and (r.show, r.hours) is distinct from (v.show, v.hours);

-- ---------------------------------------------------------------- 3. the new sections and rules (once each, by name)
create or replace function pg_temp.sec(p_main text, p_sub text, p_icon text default null) returns uuid language plpgsql as $$
declare m uuid; s uuid;
begin
  select id into m from public.notif_sections where parent_id is null and name = p_main;
  if m is null then insert into public.notif_sections (name, icon, sort) values (p_main, p_icon, coalesce((select max(sort) + 1 from public.notif_sections where parent_id is null), 0)) returning id into m; end if;
  select id into s from public.notif_sections where parent_id = m and name = p_sub;
  if s is null then insert into public.notif_sections (parent_id, name, sort) values (m, p_sub, coalesce((select max(sort) + 1 from public.notif_sections where parent_id = m), 0)) returning id into s; end if;
  return s;
end $$;
create or replace function pg_temp.rule(p_main text, p_sub text, p_name text, p_el text, p_type text, p_state text, p_roles text[],
  p_show text, p_hours int, p_at text default '09:00', p_param numeric default null) returns void language plpgsql as $$
declare v_sec uuid := pg_temp.sec(p_main, p_sub);
begin
  if exists (select 1 from public.notif_rules where section_id = v_sec and element = p_el and type = p_type and state = p_state) then return; end if;
  insert into public.notif_rules (section_id, name, element, type, state, param, at, repeat, show, hours, roles, sort, created_by)
  values (v_sec, p_name, p_el, p_type, p_state, p_param, p_at, '24h', p_show, p_hours,
    array(select r from unnest(p_roles) r where exists (select 1 from public.roles x where x.id = r)),
    coalesce((select max(sort) + 1 from public.notif_rules where section_id = v_sec), 0), null);
end $$;

do $$
begin
  -- the sections are the admin's: a fresh database without them (the tests' before 0157 seeded) gets nothing here
  if not exists (select 1 from public.notif_sections) then return; end if;
  perform pg_temp.rule('العمليات والشحن', 'مااتبعتش لبوسطة', 'جاهز للشحن ومااتبعتش لبوسطة', 'orders', 'shipping', 'no_bosta', array['admin', 'ops'], 'until_state', 0, '10:00', 1);
  perform pg_temp.rule('العمليات والشحن', 'تحصيل بوسطة', 'تحصيل بوسطة مااتحدثش', 'orders', 'shipping', 'cod_error', array['admin', 'ops'], 'until_state', 0, '09:00');
  perform pg_temp.rule('العمليات والشحن', 'التجميع', 'تجميع أوردر عدّى مدته', 'inventory', 'consolidation', 'late', array['admin', 'ops'], 'until_state', 0, '09:00');
  perform pg_temp.rule('العمليات والشحن', 'المفقودات', 'قطعة اتعلّمت مفقود', 'inventory', 'lost', 'new', array['admin', 'ops'], 'fixed', 72, '00:00');
  perform pg_temp.rule('الحسابات', 'المفقودات', 'قطعة اتعلّمت مفقود', 'inventory', 'lost', 'new', array['admin', 'accounts'], 'fixed', 72, '00:00');
  perform pg_temp.rule('الحسابات', 'تحصيل بوسطة', 'تحصيل بوسطة مااتحدثش', 'orders', 'shipping', 'cod_error', array['admin', 'accounts'], 'until_state', 0, '09:00');
  perform pg_temp.rule('الحسابات', 'طلبات السحب', 'طلب سحب مستني أكتر من يومين', 'makers', 'accounts', 'withdraw_wait', array['admin', 'accounts'], 'until_state', 0, '10:00', 2);
  perform pg_temp.rule('الحسابات', 'حساب بالسالب', 'حساب بالسالب', 'accounts', 'real', 'negative', array['admin', 'accounts'], 'until_state', 0, '09:00');
  perform pg_temp.rule('خدمة العملاء', 'تقييم واطي', 'تقييم عميل واطي', 'messages', 'ratings', 'low', array['admin', 'cs'], 'fixed', 72, '00:00', 2);
  perform pg_temp.rule('السيستم', 'الربط بالمنصات', 'ربط منصة وقف', 'system', 'links', 'down', array['admin'], 'until_state', 0, '09:00');
  -- the main sections' icons in the bell's side list instead of a bell each (the ones the admin did not set)
  update public.notif_sections s set icon = v.icon from (values ('التقارير اليومية', 'chart'), ('مساعدين الذكاء الاصطناعي', 'sparkle'), ('خدمة العملاء', 'headset'),
    ('متابعة المبتكرين', 'users'), ('العمليات والشحن', 'truck'), ('الحسابات', 'wallet'), ('الفريق', 'briefcase'), ('الرسائل', 'msg'), ('السيستم', 'gear')) v(name, icon)
   where s.parent_id is null and s.name = v.name and s.icon is null;
  -- 4. an assistant per sub-section, its team and the admin: its daily summary (info), the work late at its team and its own rules
  perform pg_temp.rule('مساعدين الذكاء الاصطناعي', a.sub, n.name, 'ai', a.id, n.state, array['admin', a.team], n.show, n.hours, '00:00')
    from (values ('manager', 'المدير العام', 'admin'), ('stock', 'التشغيل', 'ops'), ('cs', 'خدمة العملاء', 'cs'), ('makers', 'خدمة المبتكرين', 'vendors_followup'),
                 ('accountant', 'المحاسب', 'accounts'), ('hr', 'الموارد البشرية', 'hr'), ('content', 'المحتوى', 'content')) a(id, sub, team)
    cross join (values ('summary', 'ملخص الفريق اليومي', 'until_read', 2), ('late', 'الشغل المتأخر عند الفريق', 'until_read', 6), ('rules', 'قواعد المساعد', 'until_read', 6)) n(state, name, show, hours);
end $$;
