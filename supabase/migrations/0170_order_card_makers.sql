-- 0170 — the order alert's card: the customer's name, a row per maker (Safwat 25 Nov — «انا عايز اسم العميل و شيل حالة الاوردر الرئيسي
-- بس عدد الاوردرات الفرعية و كل فيندور قداموا عدد القطع و حالة التسليم … و تكون قابلة للتعديل من قوالب الرسالة»;
-- docs/superpowers/plans/2026-11-24-bell-redesign.md decision 17 follow-up 2). The customer-service order rules take the new card as
-- their template — only where it is still the one 0169 wrote (or none): an admin's own edit stays.
-- Re-runnable.
update public.notif_rules
set template = E'{العميل} · {التليفون}\n{المتابعة} · {الأوردرات_الفرعية} أوردر فرعي\n{المبتكرين}'
where element = 'orders' and type in ('confirm', 'delay', 'status')
  and (template is null or btrim(template) = ''
       or template = E'{التليفون}\n{حالة_الأوردر} · {المتابعة} · {الأوردرات_الفرعية} أوردر فرعي\nالمتأخر: {المبتكر_المتأخر} · قابل للتأخير: {المبتكر_القابل_للتأخير}');
