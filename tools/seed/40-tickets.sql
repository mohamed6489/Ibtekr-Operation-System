-- tools/seed/40-tickets.sql — تذاكر الفريق: عملاء (برقم أوردر وهمي 990xx — مش أوردر حقيقي) / مبتكرين حقيقيين / داخلية، بكل الحالات والأولويات
-- والأدوار، ومعاها الأحداث (رسايل وتغيير حالة). العلامة: «(تجريبي)» في الوصف.
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

with a as (select id, name from public.profiles where member_code = 'M01'), o as (select id, name from public.profiles where member_code = 'M03'),
t as (
  insert into public.tickets (type, title, description, priority, assignee_role, order_number, customer, cs_customer_id, cs_conversation_id, vendor_id, vendor, reason, follow_up, status,
                              created_by, created_by_name, created_by_role, created_at, last_update, resolution_outcome, resolution_note, resolved_by, resolved_by_name, resolved_at, closed_by, closed_by_name, closed_at)
  select d.type, d.title, d.descr || ' (تجريبي)', d.priority, d.role, d.ord, d.customer, d.cust::uuid, d.conv::uuid, (select id from public.vendors where name = d.vendor), d.vendor, d.reason,
         case when d.follow is null then null else current_date + d.follow end, d.status,
         (select id from a), (select name from a), 'مدير النظام', now() - (d.age || ' hours')::interval, now() - (d.upd || ' hours')::interval,
         d.outcome, case when d.outcome is null then null else 'اتقفلت في الداتا التجريبية' end,
         case when d.status in ('resolved', 'closed') then (select id from o) end, case when d.status in ('resolved', 'closed') then (select name from o) end, case when d.status in ('resolved', 'closed') then now() - (d.upd || ' hours')::interval end,
         case when d.status = 'closed' then (select id from a) end, case when d.status = 'closed' then (select name from a) end, case when d.status = 'closed' then now() - (d.upd || ' hours')::interval end
  from (values
    ('customer', 'فازة وصلت مكسورة', 'العميلة بعتت صورة — محتاجين بديل أو استرجاع', 'urgent', 'خدمة العملاء', '99001', 'ياسمين فؤاد (تجريبي)', 'dd000000-0000-4000-8000-000000000203', 'dd000000-0000-4000-8000-000000000223', null, 'منتج تالف', 1, 'open', null, 6, 5),
    ('customer', 'العميل عايز يرجّع الأوردر', 'المقاس غلط — عايز استبدال', 'high', 'خدمة العملاء', '99002', 'أحمد صلاح (تجريبي)', 'dd000000-0000-4000-8000-000000000209', 'dd000000-0000-4000-8000-000000000226', null, 'منتج مختلف عن الطلب', null, 'in_progress', null, 30, 3),
    ('customer', 'التسليم اتأخر أسبوع', 'العميل اتصل 3 مرات', 'high', 'اللوجستيك والشحن', '99003', 'كريم سامي (تجريبي)', 'dd000000-0000-4000-8000-000000000202', null, null, 'تأخير في التسليم', 2, 'waiting', null, 70, 20),
    ('customer', 'فلوس الاسترجاع ماوصلتش', 'العميلة مستنية تحويل فودافون كاش', 'normal', 'الحسابات', '99004', 'هبة مصطفى (تجريبي)', 'dd000000-0000-4000-8000-000000000205', null, null, 'مشكلة دفع أو استرجاع', null, 'resolved', 'اتحلت المشكلة', 120, 48),
    ('vendor', 'المبتكر اتأخر في التسليم', 'أوردرين متأخرين عند Art Craft', 'high', 'متابعة المبتكرين', null, null, null, null, 'Art Craft', 'تأخير تسليم', 1, 'open', null, 10, 10),
    ('vendor', 'جودة الخياطة', 'مرتجعين بنفس العيب من Crochic', 'normal', 'متابعة المبتكرين', null, null, null, null, 'Crochic', 'جودة', 3, 'in_progress', null, 50, 12),
    ('vendor', 'خلاف على العمولة', 'Decoro شايف إن النسبة اتحسبت غلط', 'normal', 'الحسابات', null, null, null, null, 'Decoro', 'خلاف على الحساب أو العمولة', null, 'closed', 'مش مشكلة', 200, 100),
    ('internal', 'الكرتون خلص', 'محتاجين كرتون شحن مقاس متوسط', 'normal', 'اللوجستيك والشحن', null, null, null, null, null, null, null, 'open', null, 4, 4),
    ('internal', 'تصوير كولكشن الشتا', 'جلسة تصوير لـ 12 منتج الأسبوع الجاي', 'low', 'المحتوى والتصوير', null, null, null, null, null, null, 5, 'in_progress', null, 26, 8),
    ('internal', 'الطابعة مابتطبعش البوالص', 'محتاجين حد يبص عليها', 'urgent', 'مدير النظام', null, null, null, null, null, null, null, 'resolved', 'اتحلت المشكلة', 40, 30)
  ) as d(type, title, descr, priority, role, ord, customer, cust, conv, vendor, reason, follow, status, outcome, age, upd)
  returning id, status, created_at)
insert into public.ticket_events (ticket_id, kind, at, actor, actor_name, actor_role, text, old_value, new_value)
select t.id, 'event', t.created_at, (select id from a), (select name from a), 'مدير النظام', 'فتح التذكرة', null, 'open' from t
union all select t.id, 'message', t.created_at + interval '20 minutes', (select id from o), (select name from o), 'اللوجستيك والشحن', 'شغال عليها دلوقتي (تجريبي)', null, null from t where t.status <> 'open'
union all select t.id, 'event', t.created_at + interval '21 minutes', (select id from o), (select name from o), 'اللوجستيك والشحن', 'غيّر الحالة', 'open', t.status from t where t.status <> 'open';

select (select count(*) from public.tickets where description like '%(تجريبي)%') as tickets,
       (select count(*) from public.ticket_events where ticket_id in (select id from public.tickets where description like '%(تجريبي)%')) as events;
