-- 0172 — the sub-orders' alerts that were added come out (Safwat 25 Nov — «نشيل التنبيهات القديمة اللي كانت بعنصر الاوردر الفرعي و نخلي
-- المبتكرين بدلها» · «امسحها» · «بس ده مالوش علاقة بالاساسيات انا قصدي بس تشيلهم من التنبيهات المتضافة حاليا» · «القواعد خلي بس المبتكرين
-- زي ما انا حاططهم»; docs/superpowers/plans/2026-11-24-bell-redesign.md decision 19). The rules of the «الأوردرات الفرعية» element the
-- team added are deleted, and an extra part of that element in another rule leaves it; the element itself stays in the catalogue (a
-- rule the admin adds later is his), the sections stay as they are, and the makers' rules are not touched. The deleted rules' alerts
-- leave the bell at once (notif_rules_tidy_delete — 0164). Re-runnable; on a fresh database it changes nothing.

update public.notif_rules r
   set conds = coalesce((select jsonb_agg(c order by o) from jsonb_array_elements(r.conds) with ordinality as x(c, o) where c ->> 'element' is distinct from 'subs'), '[]'::jsonb)
 where jsonb_typeof(r.conds) = 'array'
   and exists (select 1 from jsonb_array_elements(r.conds) c where c ->> 'element' = 'subs');

delete from public.notif_rules where element = 'subs';
