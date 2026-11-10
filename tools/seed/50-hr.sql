-- tools/seed/50-hr.sql — الموارد البشرية على الأعضاء الحقيقيين للـ staging (M03 / M04 / M05 — من غير الأونر M01 في الحضور):
-- حضور آخر أسبوعين (من غير الجمعة والنهارده)، طلبات بكل الأنواع والحالات، وقت إضافي، مهام، KPIs، عطلات، ميتنج، مكافأة ربع سنوية،
-- تعديلات مرتب، وتقييم الشهر اللي فات. مافيش لمس للمرتبات ولا كشف المرتبات. العلامة: «تجريبي» في الملاحظة/العنوان.
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- الحضور: دخول 9:00–9:25 وانصراف 17:00–18:10 بتوقيت القاهرة؛ يوم عن بُعد ويوم انصراف ناقص
insert into public.hr_attendance (member_id, day, in_at, out_at, remote, source, note)
select p.id, d::date,
       (d::date + time '09:00' + ((abs(hashtext(p.member_code || d::text)) % 26) || ' minutes')::interval) at time zone 'Africa/Cairo',
       case when (abs(hashtext(p.member_code || d::text || 'o')) % 9) = 0 then null
            else (d::date + time '17:00' + ((abs(hashtext(p.member_code || d::text || 'x')) % 71) || ' minutes')::interval) at time zone 'Africa/Cairo' end,
       (abs(hashtext(p.member_code || d::text || 'r')) % 7) = 0, 'clock', 'تجريبي'
from public.profiles p cross join generate_series(current_date - 14, current_date - 1, interval '1 day') d
where p.member_code in ('M03', 'M04', 'M05') and extract(isodow from d) <> 5
on conflict do nothing;

-- الطلبات
with mm as (select member_code c, id from public.profiles where member_code in ('M03', 'M04', 'M05')), adm as (select id from public.profiles where member_code = 'M01')
insert into public.hr_requests (member_id, type, from_day, to_day, at_time, hours, amount, months, note, status, decided_by, decided_at, reason, created_by, created_at)
select (select id from mm where c = d.c), d.type, current_date + d.f, current_date + d.t, d.at_time::time, d.hours, d.amount, d.months, d.note || ' (تجريبي)', d.status,
       case when d.status in ('موافق', 'مرفوض') then (select id from adm) end, case when d.status in ('موافق', 'مرفوض') then now() - interval '1 day' end, d.reason,
       (select id from mm where c = d.c), now() - (d.age || ' days')::interval
from (values
  ('M03', 'إجازة سنوية', 5, 7, null, null::numeric, null::numeric, null::int, 'سفر عائلي', 'جديد', null, 2),
  ('M04', 'إجازة مرضية', -3, -2, null, null, null, null, 'دور برد', 'موافق', null, 4),
  ('M05', 'شغل عن بُعد', 2, 2, null, null, null, null, 'شغل على الكامبين من البيت', 'قيد المراجعة', null, 1),
  ('M03', 'سُلفة', 0, 0, null, null, 3000, 3, 'مصاريف مدرسة', 'جديد', null, 1),
  ('M04', 'إذن انصراف مبكر', 1, 1, '15:00', 2, null, null, 'ميعاد دكتور', 'موافق', null, 2),
  ('M05', 'إجازة سنوية', -10, -9, null, null, null, null, 'فرح أخويا', 'مرفوض', 'ضغط شغل في الأسبوع ده', 12)
) as d(c, type, f, t, at_time, hours, amount, months, note, status, reason, age);

-- الوقت الإضافي
with mm as (select member_code c, id from public.profiles where member_code in ('M03', 'M04', 'M05')), adm as (select id from public.profiles where member_code = 'M01')
insert into public.hr_overtime (member_id, day, start_at, end_at, minutes, kind, note, status, paid_minutes, decided_by, decided_at, created_at)
select (select id from mm where c = d.c), current_date - d.ago, ((current_date - d.ago) + time '17:00') at time zone 'Africa/Cairo', ((current_date - d.ago) + time '17:00' + (d.mins || ' minutes')::interval) at time zone 'Africa/Cairo',
       d.mins, 'hours', d.note || ' (تجريبي)', d.status, case when d.status = 'اتضاف' then d.mins else 0 end,
       case when d.status <> 'مستني' then (select id from adm) end, case when d.status <> 'مستني' then now() - interval '1 day' end, now() - (d.ago || ' days')::interval
from (values ('M03', 2, 90, 'تقفيل شحنات العيد', 'مستني'), ('M05', 5, 120, 'تصوير الكولكشن', 'اتضاف'), ('M04', 8, 45, 'مراجعة الحسابات', 'اترفض')) as d(c, ago, mins, note, status);

-- المهام («ملفي › مهامي»)
with mm as (select member_code c, id from public.profiles where member_code in ('M01', 'M03', 'M04', 'M05'))
insert into public.hr_tasks (member_id, title, status, day, reason, created_by)
select (select id from mm where c = d.c), d.title || ' (تجريبي)', d.status, current_date + d.dd, d.reason, (select id from mm where c = d.by)
from (values
  ('M03', 'تجهيز شحنة أوردرات الصبح', 'جاري', 0, null, 'M03'),
  ('M03', 'جرد رف A', 'لسه', 1, null, 'M01'),
  ('M03', 'متابعة مرتجع الفازة', 'متوقفة', 0, 'مستنيين صورة العميلة', 'M03'),
  ('M04', 'مراجعة مصروفات الشهر', 'جاهزة للمراجعة', -1, null, 'M01'),
  ('M04', 'تقفيل حسابات المبتكرين', 'لسه', 2, null, 'M04'),
  ('M05', 'جدولة بوستات الأسبوع', 'خلصت', -1, null, 'M05'),
  ('M05', 'تصميم بانر العرض', 'اتأجلت', 3, 'مستنيين صور المنتجات', 'M01'),
  ('M01', 'اعتماد طلبات الإجازات', 'لسه', 0, null, 'M01')
) as d(c, title, status, dd, reason, by);

-- مؤشرات الأداء
insert into public.hr_kpis (member_id, name, src, weight, target, inverse, sort)
select p.id, d.name || ' (تجريبي)', 'يدوي', d.w, d.t, d.inv, d.s from public.profiles p join (values
  ('M03', 'أوردرات اتشحنت في ميعادها %', 60, 95, false, 0), ('M03', 'أخطاء التجميع', 40, 2, true, 1),
  ('M04', 'تقفيل اليومية في ميعادها %', 60, 100, false, 0), ('M04', 'أخطاء القيود', 40, 2, true, 1),
  ('M05', 'بوستات اتنشرت في ميعادها %', 50, 90, false, 0), ('M05', 'متوسط التفاعل %', 50, 4, false, 1)
) as d(c, name, w, t, inv, s) on d.c = p.member_code;

-- التقييم الشهري للشهر اللي فات
insert into public.hr_scores (member_id, month, score, actuals, note, rated_at)
select p.id, (date_trunc('month', current_date) - interval '1 month')::date, d.score, '{}'::jsonb, 'تجريبي', now() - interval '5 days'
from public.profiles p join (values ('M03', 88), ('M04', 93), ('M05', 76)) as d(c, score) on d.c = p.member_code
on conflict do nothing;

-- العطلات الرسمية الجاية
insert into public.hr_holidays (name, day, days, kind, status) values
  ('عيد الشرطة وثورة يناير (تجريبي)', make_date(extract(year from current_date)::int + 1, 1, 25), 1, 'رسمية', 'مؤكد'),
  ('عيد الفطر (تجريبي)', make_date(extract(year from current_date)::int + 1, 3, 20), 3, 'رسمية', 'متوقع'),
  ('شم النسيم (تجريبي)', make_date(extract(year from current_date)::int + 1, 4, 13), 1, 'رسمية', 'متوقع');

-- ميتنج فردي + مكافأة ربع سنوية مقترحة + تعديلات مرتب الشهر
with mm as (select member_code c, id from public.profiles where member_code in ('M03', 'M05'))
insert into public.hr_meetings (member_id, reason, status, day, time_text, place, goals, notes, ref)
values ((select id from mm where c = 'M05'), 'تأخير متكرر في الدخول (تجريبي)', 'اتحدد ميعاد', current_date + 2, '11:00', 'المكتب', '[]'::jsonb, null, null),
       ((select id from mm where c = 'M03'), 'خطة تطوير — مسؤول مخزن (تجريبي)', 'خطة شغالة', current_date - 7, '13:00', 'أونلاين', '["إتقان الجرد الشهري","تقليل أخطاء التجميع لأقل من 2"]'::jsonb, null, null);
insert into public.hr_extras (member_id, quarter, rule, amount, status)
select p.id, extract(year from current_date)::int || '-Q' || extract(quarter from current_date)::int, 'تقييم 90% فأكتر 3 شهور (تجريبي)', 1500, 'مقترحة' from public.profiles p where p.member_code = 'M04';
insert into public.hr_adjustments (member_id, month, amount, label, note, kind)
select p.id, date_trunc('month', current_date)::date, d.amount, d.label || ' (تجريبي)', null, d.kind from public.profiles p join (values
  ('M03', 500, 'بدل مواصلات إضافي', 'adjust'), ('M05', -300, 'خصم تأخير', 'adjust'), ('M04', 1000, 'إنجاز تقفيل السنة المالية', 'achievement')
) as d(c, amount, label, kind) on d.c = p.member_code;

select (select count(*) from public.hr_attendance where note = 'تجريبي') as attendance, (select count(*) from public.hr_requests where note like '%تجريبي%') as requests,
       (select count(*) from public.hr_overtime where note like '%تجريبي%') as overtime, (select count(*) from public.hr_tasks where title like '%تجريبي%') as tasks,
       (select count(*) from public.hr_kpis where name like '%تجريبي%') as kpis, (select count(*) from public.hr_scores where note = 'تجريبي') as scores,
       (select count(*) from public.hr_holidays where name like '%تجريبي%') as holidays, (select count(*) from public.hr_meetings where reason like '%تجريبي%') as meetings;
