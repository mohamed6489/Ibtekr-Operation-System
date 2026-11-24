-- 0163 — the bell by role (Safwat 24 Nov — «بأقوى سكيلز كبيزنس أونر تقسم التنبيهات على دور بالشكل الجديد والأقسام الفرعية تبقى جاهزة
-- حتى لو فيها صفر»; docs/superpowers/plans/2026-11-24-bell-redesign.md decision 11). The bell shows a member the main sections whose
-- rules go to one of his roles, with all of their sub-sections even at zero (alerts.js); here the tree each role meets:
--   «طلبات الفريق» its own main section for everyone (جديدة · حالتها ماتغيّرتش — out of «الفريق»);
--   «التسويق» a main section for the design / ads / code roles (الإعلانات · التصميم · البرمجة — out of «مساعدين الذكاء الاصطناعي»);
--   each role's sub-sections in its working order; the main sections in the order of the work.
-- By names, so a section the admin renamed or deleted is left as he made it. Re-runnable.

create or replace function pg_temp.main(p_name text, p_icon text) returns uuid language plpgsql as $$
declare m uuid;
begin
  select id into m from public.notif_sections where parent_id is null and name = p_name;
  if m is null then insert into public.notif_sections (name, icon, sort) values (p_name, p_icon, coalesce((select max(sort) + 1 from public.notif_sections where parent_id is null), 0)) returning id into m; end if;
  return m;
end $$;
create or replace function pg_temp.sub_of(p_main text, p_sub text) returns uuid language sql as $$
  select s.id from public.notif_sections s join public.notif_sections m on m.id = s.parent_id where m.parent_id is null and m.name = p_main and s.name = p_sub limit 1
$$;
-- a sub-section under a main section (made when missing)
create or replace function pg_temp.sub(p_main uuid, p_sub text) returns uuid language plpgsql as $$
declare s uuid;
begin
  select id into s from public.notif_sections where parent_id = p_main and name = p_sub;
  if s is null then insert into public.notif_sections (parent_id, name, sort) values (p_main, p_sub, coalesce((select max(sort) + 1 from public.notif_sections where parent_id = p_main), 0)) returning id into s; end if;
  return s;
end $$;
-- the order of a main section's sub-sections by name (the ones not named keep their place after them)
create or replace function pg_temp.order_subs(p_main text, p_names text[]) returns void language plpgsql as $$
declare m uuid; i int;
begin
  select id into m from public.notif_sections where parent_id is null and name = p_main; if m is null then return; end if;
  for i in 1 .. cardinality(p_names) loop update public.notif_sections set sort = i - 1 where parent_id = m and name = p_names[i]; end loop;
  update public.notif_sections set sort = sort + 100 where parent_id = m and not (name = any (p_names));
end $$;

do $$
declare m_req uuid; m_mkt uuid; old_req uuid; s uuid;
begin
  -- «طلبات الفريق»: its own main section, the requests' two rules each under its sub-section
  old_req := pg_temp.sub_of('الفريق', 'الطلبات');
  if old_req is not null then
    m_req := pg_temp.main('طلبات الفريق', 'ticket');
    update public.notif_rules set section_id = pg_temp.sub(m_req, 'جديدة') where section_id = old_req and element = 'tickets' and state = 'new';
    update public.notif_rules set section_id = pg_temp.sub(m_req, 'حالتها ماتغيّرتش') where section_id = old_req;
    update public.alerts set section_id = (select section_id from public.notif_rules r where r.id = alerts.rule_id) where section_id = old_req and rule_id is not null;
    delete from public.notif_sections where id = old_req and not exists (select 1 from public.notif_rules where section_id = old_req) and not exists (select 1 from public.alerts where section_id = old_req);
  end if;
  -- «التسويق»: the design / ads / code roles' sub-sections out of «مساعدين الذكاء الاصطناعي»
  if exists (select 1 from public.notif_sections x join public.notif_sections m on m.id = x.parent_id
      where m.parent_id is null and m.name = 'مساعدين الذكاء الاصطناعي' and x.name in ('الميديا باير', 'الديزاينر', 'المبرمج')) then
    m_mkt := pg_temp.main('التسويق', 'megaphone');
    update public.notif_sections x set parent_id = m_mkt, name = 'الإعلانات', sort = 0 from public.notif_sections m
      where m.id = x.parent_id and m.parent_id is null and m.name = 'مساعدين الذكاء الاصطناعي' and x.name = 'الميديا باير' and not exists (select 1 from public.notif_sections y where y.parent_id = m_mkt and y.name = 'الإعلانات');
    update public.notif_sections x set parent_id = m_mkt, name = 'التصميم', sort = 1 from public.notif_sections m
      where m.id = x.parent_id and m.parent_id is null and m.name = 'مساعدين الذكاء الاصطناعي' and x.name = 'الديزاينر' and not exists (select 1 from public.notif_sections y where y.parent_id = m_mkt and y.name = 'التصميم');
    update public.notif_sections x set parent_id = m_mkt, name = 'البرمجة', sort = 2 from public.notif_sections m
      where m.id = x.parent_id and m.parent_id is null and m.name = 'مساعدين الذكاء الاصطناعي' and x.name = 'المبرمج' and not exists (select 1 from public.notif_sections y where y.parent_id = m_mkt and y.name = 'البرمجة');
  end if;
  -- «خدمة العملاء › متأخر» says what it is
  update public.notif_sections x set name = 'أوردر متأخر' from public.notif_sections m
    where m.id = x.parent_id and m.parent_id is null and m.name = 'خدمة العملاء' and x.name = 'متأخر'
      and not exists (select 1 from public.notif_sections y where y.parent_id = m.id and y.name = 'أوردر متأخر');
end $$;

-- each role's sub-sections in its working order
select pg_temp.order_subs('خدمة العملاء', array['غير مؤكدة', 'في انتظار الرد', 'أوردر متأخر', 'تقييم واطي']);
select pg_temp.order_subs('متابعة المبتكرين', array['متأخر', 'قابلة للتأخير', 'مؤكد']);
select pg_temp.order_subs('العمليات والشحن', array['جاهز للشحن للمخزن', 'جاهز للشحن للعميل', 'مااتبعتش لبوسطة', 'التجميع', 'مرتجع يحتاج فحص', 'المفقودات', 'استوك قرب يخلص', 'العهدة']);
select pg_temp.order_subs('الحسابات', array['طلبات السحب', 'حساب المبتكرين', 'المصروفات', 'المرتبات', 'الاشتراكات', 'العهدة', 'تحصيل بوسطة', 'حساب بالسالب', 'المفقودات', 'الحركة المالية']);
select pg_temp.order_subs('الفريق', array['الحضور والانصراف', 'التقييم']);
select pg_temp.order_subs('الرسائل', array['من العملاء', 'تعليقات', 'من المبتكرين']);
select pg_temp.order_subs('طلبات الفريق', array['جديدة', 'حالتها ماتغيّرتش']);
select pg_temp.order_subs('التسويق', array['الإعلانات', 'التصميم', 'البرمجة']);
select pg_temp.order_subs('مساعدين الذكاء الاصطناعي', array['المدير العام', 'التشغيل', 'خدمة العملاء', 'خدمة المبتكرين', 'المحاسب', 'الموارد البشرية', 'المحتوى', 'باقي المساعدين']);

-- the main sections in the order of the work (the ones not named after them)
do $$
declare names text[] := array['خدمة العملاء', 'الرسائل', 'متابعة المبتكرين', 'العمليات والشحن', 'الحسابات', 'الفريق', 'التسويق', 'طلبات الفريق', 'التقارير اليومية', 'مساعدين الذكاء الاصطناعي', 'السيستم']; i int;
begin
  for i in 1 .. cardinality(names) loop update public.notif_sections set sort = i - 1 where parent_id is null and name = names[i]; end loop;
  update public.notif_sections set sort = sort + 100 where parent_id is null and not (name = any (names)) and sort < 100;
end $$;
