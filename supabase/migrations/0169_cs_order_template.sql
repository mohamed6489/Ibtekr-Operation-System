-- 0169 — customer service's order alerts carry the new message (Safwat 25 Nov — «… وعدلو في قالب الرسالة» · «مش شايف قالب الرسايل الجديد
-- لخدمة العملاء»; docs/superpowers/plans/2026-11-24-bell-redesign.md decision 17): «أوردر غير مؤكد» and «أوردر متأخر» get the template
-- the card in the bell, line by line (Safwat 25 Nov — «خليه قوالب التنبيهات ذكية بنفس الشكل اللي ظاهر عشان المستخدم لو عايز يعدل يقدر
-- يعدل»): the phone · the status, «محتاج متابعة», the sub-orders · the late makers (IBNotifCatalog.ORDER_TPL — the bell draws the card from
-- the template, a part whose variables come out empty left out). On every order rule now, as an exception (Safwat: «عدّله بشكل استثنائي
-- بحيث يبقا هو ده الشكل من هنا و رايح»); the admin edits it from the rule's form after. Re-runnable.

update public.notif_rules set template = E'{التليفون}\n{حالة_الأوردر} · {المتابعة} · {الأوردرات_الفرعية} أوردر فرعي\nالمتأخر: {المبتكر_المتأخر} · قابل للتأخير: {المبتكر_القابل_للتأخير}'
where element = 'orders' and type in ('confirm', 'delay', 'status');
