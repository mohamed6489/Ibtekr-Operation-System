-- tools/seed/20-cs.sql — خدمة العملاء + الرد الآلي: عملاء (leads) بأرقام وهمية 2011999xxxx، محادثات على واتساب 1 / ماسنجر / إنستجرام /
-- واتساب 2 (مبتكر) / تعليقات، رسايل بكل الأنواع، ملاحظات، تقييمات، شريحتين، حملتين مسودة، قوالب، ردود سريعة، قواعد رد آلي (كلها متوقفة).
-- uuid ثابتة dd000000-0000-4000-8000-0000000002xx. لا إرسال حقيقي: مافيش صف out بـ queued.
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- العملاء (manual = lead من غير أوردر؛ created_from manual)
with m as (select id as owner from public.profiles where member_code = 'M01')
insert into public.cs_customers (id, phone, name, ig, city, province, address, mood, tags, consent, source, created_from, created_by, created_at)
select d.id::uuid, d.phone, d.name, d.ig, d.city, d.province, d.address, d.mood, d.tags, d.consent, 'تجريبي', 'manual', (select owner from m), now() - (d.age || ' days')::interval from (values
  ('dd000000-0000-4000-8000-000000000201', '201199900001', 'نهى عادل (تجريبي)', null, 'القاهرة', 'القاهرة', 'المعادي — شارع 9', 'سعيد', array['vip','هدايا'], true, 35),
  ('dd000000-0000-4000-8000-000000000202', '201199900002', 'كريم سامي (تجريبي)', 'karim.s', 'الجيزة', 'الجيزة', 'الدقي', 'متوسط', array['ديكور'], true, 30),
  ('dd000000-0000-4000-8000-000000000203', '201199900003', 'ياسمين فؤاد (تجريبي)', 'yasmin.f', 'الإسكندرية', 'الإسكندرية', 'سموحة', 'متضايق', array['شكوى'], true, 28),
  ('dd000000-0000-4000-8000-000000000204', '201199900004', 'عمر خالد (تجريبي)', null, 'المنصورة', 'الدقهلية', null, null, array[]::text[], false, 25),
  ('dd000000-0000-4000-8000-000000000205', '201199900005', 'هبة مصطفى (تجريبي)', 'heba.m', 'القاهرة', 'القاهرة', 'مدينة نصر', 'سعيد', array['vip'], true, 20),
  ('dd000000-0000-4000-8000-000000000206', '201199900006', 'طارق حسين (تجريبي)', null, 'طنطا', 'الغربية', null, 'متوسط', array[]::text[], true, 15),
  ('dd000000-0000-4000-8000-000000000207', '201199900007', 'دينا رمزي (تجريبي)', 'dina.r', 'القاهرة', 'القاهرة', 'التجمع الخامس', 'سعيد', array['كروشيه'], true, 10),
  ('dd000000-0000-4000-8000-000000000208', null, 'زائر إنستجرام (تجريبي)', 'ig_visitor_77', null, null, null, null, array[]::text[], true, 6),
  ('dd000000-0000-4000-8000-000000000209', '201199900009', 'أحمد صلاح (تجريبي)', null, 'أسيوط', 'أسيوط', null, 'متضايق', array['مرتجع'], true, 4),
  ('dd000000-0000-4000-8000-000000000210', '201199900010', 'سلمى نبيل (تجريبي)', 'salma.n', 'الجيزة', 'الجيزة', '6 أكتوبر', null, array[]::text[], true, 2)
) as d(id, phone, name, ig, city, province, address, mood, tags, consent, age);

-- جهات الاتصال على القنوات
insert into public.cs_contacts (customer_id, platform, external_id, handle) values
  ('dd000000-0000-4000-8000-000000000201', 'whatsapp', '201199900001', null),
  ('dd000000-0000-4000-8000-000000000202', 'messenger', 'psid-seed-202', 'كريم سامي'),
  ('dd000000-0000-4000-8000-000000000203', 'instagram', 'igsid-seed-203', 'yasmin.f'),
  ('dd000000-0000-4000-8000-000000000205', 'whatsapp', '201199900005', null),
  ('dd000000-0000-4000-8000-000000000207', 'whatsapp', '201199900007', null),
  ('dd000000-0000-4000-8000-000000000208', 'instagram', 'igsid-seed-208', 'ig_visitor_77'),
  ('dd000000-0000-4000-8000-000000000209', 'whatsapp', '201199900009', null);

-- المحادثات (seg customers على القنوات، واحدة vendors على واتساب 2، واحدة comments)
with m as (select id as owner from public.profiles where member_code = 'M01'), o as (select id as ops from public.profiles where member_code = 'M03')
insert into public.cs_conversations (id, seg, platform, channel, customer_id, vendor_id, handle, external_id, status, assignee, outcome, tags, last_in_at, last_out_at, waiting_since, unread, snoozed_until, closed_at, created_by, created_at)
select d.id::uuid, d.seg, d.platform, d.channel, d.customer_id::uuid, (select id from public.vendors where name = d.vendor), d.handle, d.external_id, d.status,
       case d.assignee when 'M01' then (select owner from m) when 'M03' then (select ops from o) end, d.outcome, d.tags,
       now() - (d.in_min || ' minutes')::interval, case when d.out_min is null then null else now() - (d.out_min || ' minutes')::interval end,
       case when d.status in ('جديدة', 'مستنية ردنا') then now() - (d.in_min || ' minutes')::interval end, d.unread,
       case when d.status = 'مؤجلة' then now() + interval '1 day' end, case when d.status = 'اتحلت' then now() - (d.out_min || ' minutes')::interval end,
       (select owner from m), now() - (d.in_min + 30 || ' minutes')::interval
from (values
  ('dd000000-0000-4000-8000-000000000221', 'customers', 'whatsapp', 'wa1', 'dd000000-0000-4000-8000-000000000201', null, null, '201199900001', 'مستنية ردنا', 'M03', null, array['استفسار'], 25, 1500, 1),
  ('dd000000-0000-4000-8000-000000000222', 'customers', 'messenger', 'messenger', 'dd000000-0000-4000-8000-000000000202', null, 'كريم سامي', 'psid-seed-202', 'جديدة', null, null, array[]::text[], 12, null, 2),
  ('dd000000-0000-4000-8000-000000000223', 'customers', 'instagram', 'instagram', 'dd000000-0000-4000-8000-000000000203', null, 'yasmin.f', 'igsid-seed-203', 'مستنية العميل', 'M01', null, array['شكوى','مرتجع'], 300, 240, 0),
  ('dd000000-0000-4000-8000-000000000224', 'customers', 'whatsapp', 'wa1', 'dd000000-0000-4000-8000-000000000205', null, null, '201199900005', 'اتحلت', 'M03', 'اتحلت المشكلة', array['vip'], 2900, 2800, 0),
  ('dd000000-0000-4000-8000-000000000225', 'customers', 'whatsapp', 'wa1', 'dd000000-0000-4000-8000-000000000207', null, null, '201199900007', 'مؤجلة', 'M01', null, array['طلب خاص'], 1400, 1300, 0),
  ('dd000000-0000-4000-8000-000000000226', 'customers', 'whatsapp', 'wa1', 'dd000000-0000-4000-8000-000000000209', null, null, '201199900009', 'مستنية ردنا', null, null, array['مرتجع'], 90, null, 3),
  ('dd000000-0000-4000-8000-000000000227', 'vendors', 'whatsapp', 'wa2', null, 'Art Craft', 'Art Craft', '201000000001', 'مستنية العميل', 'M03', null, array['تسليم'], 600, 500, 0),
  ('dd000000-0000-4000-8000-000000000228', 'comments', 'instagram', 'instagram', 'dd000000-0000-4000-8000-000000000208', null, 'ig_visitor_77', 'seedpost1_c1', 'جديدة', null, null, array[]::text[], 45, null, 1)
) as d(id, seg, platform, channel, customer_id, vendor, handle, external_id, status, assignee, outcome, tags, in_min, out_min, unread);

-- الرسايل: in / out / note / auto / event
with m as (select id as owner from public.profiles where member_code = 'M01'), o as (select id as ops from public.profiles where member_code = 'M03')
insert into public.cs_messages (id, conversation_id, kind, text, author, external_id, delivery, meta, created_at)
select d.id::uuid, d.conv::uuid, d.kind, d.text, case d.author when 'M01' then (select owner from m) when 'M03' then (select ops from o) end, d.ext, d.delivery, coalesce(d.meta, '{}')::jsonb, now() - (d.min || ' minutes')::interval
from (values
  ('dd000000-0000-4000-8000-000000000241', 'dd000000-0000-4000-8000-000000000221', 'in', 'السلام عليكم، عندكم المراية الخشب دي بمقاس أكبر؟', null, 'wamid.seed.1', null, null, 1560),
  ('dd000000-0000-4000-8000-000000000242', 'dd000000-0000-4000-8000-000000000221', 'auto', 'أهلاً نهى 👋 وصلتنا رسالتك وهنرد عليكي في أقرب وقت.', null, null, 'delivered', '{"tpl":"أول رسالة"}', 1559),
  ('dd000000-0000-4000-8000-000000000243', 'dd000000-0000-4000-8000-000000000221', 'out', 'أيوه متاحة 60×90 بـ 950 ج.م، تحبي أعملك أوردر؟', 'M03', 'wamid.seed.2', 'read', null, 1500),
  ('dd000000-0000-4000-8000-000000000244', 'dd000000-0000-4000-8000-000000000221', 'in', 'تمام، والشحن للمعادي كام؟', null, 'wamid.seed.3', null, null, 25),
  ('dd000000-0000-4000-8000-000000000245', 'dd000000-0000-4000-8000-000000000221', 'note', 'عميلة متكررة — اديها كود خصم 10%', 'M01', null, null, null, 20),
  ('dd000000-0000-4000-8000-000000000246', 'dd000000-0000-4000-8000-000000000222', 'in', 'السعر كام للطقم الكامل؟', null, 'm.seed.22a', null, null, 14),
  ('dd000000-0000-4000-8000-000000000247', 'dd000000-0000-4000-8000-000000000222', 'in', 'وفي توصيل للجيزة؟', null, 'm.seed.22b', null, null, 12),
  ('dd000000-0000-4000-8000-000000000248', 'dd000000-0000-4000-8000-000000000223', 'in', 'الفازة وصلت مكسورة 😡', null, 'ig.seed.23a', null, null, 330),
  ('dd000000-0000-4000-8000-000000000249', 'dd000000-0000-4000-8000-000000000223', 'out', 'آسفين جدًا يا ياسمين، ابعتيلنا صورة وهنبدّلها فورًا.', 'M01', 'ig.seed.23b', 'read', null, 300),
  ('dd000000-0000-4000-8000-000000000250', 'dd000000-0000-4000-8000-000000000223', 'in', 'تمام هبعت دلوقتي', null, 'ig.seed.23c', null, null, 290),
  ('dd000000-0000-4000-8000-000000000251', 'dd000000-0000-4000-8000-000000000223', 'out', 'في انتظار الصورة وهنفتح تذكرة مرتجع.', 'M01', 'ig.seed.23d', 'delivered', null, 240),
  ('dd000000-0000-4000-8000-000000000252', 'dd000000-0000-4000-8000-000000000224', 'in', 'شكرًا، الأوردر وصل وجميل جدًا ❤️', null, 'wamid.seed.24a', null, null, 2900),
  ('dd000000-0000-4000-8000-000000000253', 'dd000000-0000-4000-8000-000000000224', 'out', 'يسعدنا يا هبة! منوّرانا دايمًا.', 'M03', 'wamid.seed.24b', 'read', null, 2800),
  ('dd000000-0000-4000-8000-000000000254', 'dd000000-0000-4000-8000-000000000224', 'event', 'اتقفلت المحادثة — اتحلت المشكلة', 'M03', null, null, null, 2790),
  ('dd000000-0000-4000-8000-000000000255', 'dd000000-0000-4000-8000-000000000225', 'in', 'عايزة أطلب 20 قطعة كروشيه لحفلة، ينفع خصم؟', null, 'wamid.seed.25a', null, null, 1400),
  ('dd000000-0000-4000-8000-000000000256', 'dd000000-0000-4000-8000-000000000225', 'out', 'أكيد، هنكلم المبتكرة ونرد عليكي بكرة بالسعر.', 'M01', 'wamid.seed.25b', 'read', null, 1300),
  ('dd000000-0000-4000-8000-000000000257', 'dd000000-0000-4000-8000-000000000225', 'event', 'اتأجلت لبكرة', 'M01', null, null, null, 1290),
  ('dd000000-0000-4000-8000-000000000258', 'dd000000-0000-4000-8000-000000000226', 'in', 'عايز أرجّع الأوردر، المقاس غلط', null, 'wamid.seed.26a', null, null, 95),
  ('dd000000-0000-4000-8000-000000000259', 'dd000000-0000-4000-8000-000000000226', 'in', 'رقم الأوردر 10234', null, 'wamid.seed.26b', null, null, 92),
  ('dd000000-0000-4000-8000-000000000260', 'dd000000-0000-4000-8000-000000000226', 'in', 'حد يرد؟', null, 'wamid.seed.26c', null, null, 90),
  ('dd000000-0000-4000-8000-000000000261', 'dd000000-0000-4000-8000-000000000227', 'out', 'إمتى تقدر تسلّم أوردر 10198؟', 'M03', 'wamid.seed.27a', 'read', null, 600),
  ('dd000000-0000-4000-8000-000000000262', 'dd000000-0000-4000-8000-000000000227', 'in', 'بكرة بإذن الله', null, 'wamid.seed.27b', null, null, 560),
  ('dd000000-0000-4000-8000-000000000263', 'dd000000-0000-4000-8000-000000000227', 'out', 'تمام، ابعتلنا صورة قبل الشحن.', 'M03', 'wamid.seed.27c', 'delivered', null, 500),
  ('dd000000-0000-4000-8000-000000000264', 'dd000000-0000-4000-8000-000000000228', 'in', 'السعر كام؟ 😍', null, 'seedpost1_c1', null, '{"post_id":"seedpost1","comment_id":"seedpost1_c1"}', 45)
) as d(id, conv, kind, text, author, ext, delivery, meta, min);

-- ملاحظات داخلية على العملاء + تقييمات الفريق للعميل عند الإنهاء
with m as (select id as owner from public.profiles where member_code = 'M01')
insert into public.cs_customer_notes (customer_id, text, author, at) values
  ('dd000000-0000-4000-8000-000000000201', 'بتحب الخشب الطبيعي — اعرض عليها كولكشن الخريف (تجريبي)', (select owner from m), now() - interval '20 days'),
  ('dd000000-0000-4000-8000-000000000203', 'الفازة اتكسرت في الشحن — نتابع التعويض (تجريبي)', (select owner from m), now() - interval '5 hours'),
  ('dd000000-0000-4000-8000-000000000205', 'عميلة VIP — أول أوردر من إعلان ميتا (تجريبي)', (select owner from m), now() - interval '2 days');
with o as (select id as ops from public.profiles where member_code = 'M03')
insert into public.cs_team_ratings (customer_id, conversation_id, sat, manners, note, by_user, at) values
  ('dd000000-0000-4000-8000-000000000205', 'dd000000-0000-4000-8000-000000000224', 5, 5, 'تجريبي', (select ops from o), now() - interval '2 days'),
  ('dd000000-0000-4000-8000-000000000201', null, 4, 5, 'تجريبي', (select ops from o), now() - interval '10 days'),
  ('dd000000-0000-4000-8000-000000000209', null, 2, 3, 'تجريبي', (select ops from o), now() - interval '1 days');

-- شرايح وحملات (مسودة — مافيش إرسال)
with m as (select id as owner from public.profiles where member_code = 'M01')
insert into public.cs_segments (id, name, min_total, min_orders, moods, last_kind, ranges, include_unrated, add_ids, remove_ids, created_by)
values ('dd000000-0000-4000-8000-000000000271', 'VIP راضيين (تجريبي)', 1000, 1, array['سعيد'], 'in90', '{"sat":[4,5]}', false, array['dd000000-0000-4000-8000-000000000201'::uuid], array[]::uuid[], (select owner from m)),
       ('dd000000-0000-4000-8000-000000000272', 'متضايقين آخر شهر (تجريبي)', null, null, array['متضايق'], 'in30', '{}', true, array[]::uuid[], array[]::uuid[], (select owner from m));
with m as (select id as owner from public.profiles where member_code = 'M01')
insert into public.cs_campaigns (id, name, segment_id, channel, body, discount_code, cap_per_day, min_delay_s, status, size, stats, created_by)
values ('dd000000-0000-4000-8000-000000000281', 'عرض العملاء المتكررين — نوفمبر (تجريبي)', 'dd000000-0000-4000-8000-000000000271', 'wa1', 'أهلاً {اسم_العميل} 👋 خصم 10% على كل الكولكشن بالكود {كود_الخصم} لحد آخر الأسبوع.', 'NOV10', 250, 30, 'مسودة', 0, '{}', (select owner from m)),
       ('dd000000-0000-4000-8000-000000000282', 'اعتذار ومتابعة (تجريبي)', 'dd000000-0000-4000-8000-000000000272', 'wa1', 'يا {اسم_العميل}، آسفين على أي تجربة مش كويسة — كلمنا وهنظبطها.', null, 100, 60, 'مسودة', 0, '{}', (select owner from m));

-- القوالب (العملاء + المبتكرين)، الردود السريعة، قواعد الرد الآلي (متوقفة)
with m as (select id as owner from public.profiles where member_code = 'M01')
insert into public.cs_templates (id, lib, name, cat, tone, body, trig_kind, trig_on, trig_when, channels, quick_key, wa_template, wa_vars, used, active, created_by)
select d.id::uuid, d.lib, d.name, d.cat, d.tone, d.body, d.trig_kind, d.trig_on, d.trig_when, d.channels, d.quick_key, d.wa_template, d.wa_vars, d.used, true, (select owner from m) from (values
  ('dd000000-0000-4000-8000-000000000291', 'customers', 'تأكيد الأوردر (تجريبي)', 'حالة الأوردر', 'brand', 'أهلاً {اسم_العميل} 👋 أوردرك {رقم_الأوردر} اتأكد بإجمالي {الإجمالي} ج.م وهيتجهز خلال 3–5 أيام.', 'auto', array['جاري التنفيذ'], 'فورًا', 'كل القنوات', '/تأكيد', 'order_confirmed_v1', array['اسم_العميل','رقم_الأوردر','الإجمالي'], 12),
  ('dd000000-0000-4000-8000-000000000292', 'customers', 'الأوردر اتشحن (تجريبي)', 'حالة الأوردر', 'success', 'أوردرك {رقم_الأوردر} اتشحن 🚚 رقم البوليصة {رقم_البوليصة}. هيوصلك خلال 2–4 أيام.', 'auto', array['قيد الشحن'], 'فورًا', 'واتساب 1', null, 'order_shipped_v1', array['رقم_الأوردر','رقم_البوليصة'], 30),
  ('dd000000-0000-4000-8000-000000000293', 'customers', 'أول رسالة — ترحيب (تجريبي)', 'ترحيب', 'info', 'أهلاً بيك في إبتكر 👋 بيت لكل مبتكر. قولنا محتاج إيه وهنرد عليك في أقرب وقت.', 'auto', array['أول رسالة'], 'فورًا', 'كل القنوات', null, null, array[]::text[], 40),
  ('dd000000-0000-4000-8000-000000000294', 'customers', 'طلب تقييم بعد التسليم (تجريبي)', 'بعد البيع', 'gold', 'يا {اسم_العميل}، الأوردر وصلك؟ قيّم تجربتك من 1 لـ 5 وده بيساعد المبتكرين كتير 🙏', 'auto', array['مكتمل'], 'بعد يومين', 'واتساب 1', '/تقييم', 'order_review_v1', array['اسم_العميل'], 8),
  ('dd000000-0000-4000-8000-000000000295', 'vendors', 'أوردر جديد ليك (تجريبي)', 'أوردرات', 'brand', 'عندك أوردر فرعي جديد {رقم_الأوردر} — المنتج {المنتج}. جهّزه خلال {مدة_التجهيز} يوم وابعتلنا صورة قبل الشحن.', 'auto', array['أوردر فرعي جديد'], 'فورًا', 'واتساب 2', null, null, array[]::text[], 15),
  ('dd000000-0000-4000-8000-000000000296', 'vendors', 'تذكير تأخير (تجريبي)', 'متابعة', 'orange', 'الأوردر {رقم_الأوردر} اتأخر عن ميعاده. محتاجين تحديث النهارده لو سمحت.', 'auto', array['متأخر'], 'فورًا', 'واتساب 2', null, null, array[]::text[], 3)
) as d(id, lib, name, cat, tone, body, trig_kind, trig_on, trig_when, channels, quick_key, wa_template, wa_vars, used);
with m as (select id as owner from public.profiles where member_code = 'M01')
insert into public.cs_quick_replies (id, key, label, text, created_by) values
  ('dd000000-0000-4000-8000-000000000301', '/شحن', 'مواعيد ومصاريف الشحن (تجريبي)', 'الشحن جوه القاهرة والجيزة 2–3 أيام بعد التصنيع (65 ج.م)، وباقي المحافظات 3–5 أيام (85 ج.م).', (select owner from m)),
  ('dd000000-0000-4000-8000-000000000302', '/استبدال', 'سياسة الاستبدال (تجريبي)', 'الاستبدال خلال 14 يوم من الاستلام لو المنتج بحالته، ومصاريف الشحن على العميل إلا لو فيه عيب صناعة.', (select owner from m)),
  ('dd000000-0000-4000-8000-000000000303', '/دفع', 'طرق الدفع (تجريبي)', 'الدفع عند الاستلام أو فودافون كاش أو تحويل بنكي أو كارت.', (select owner from m)),
  ('dd000000-0000-4000-8000-000000000304', '/تخصيص', 'طلبات التخصيص (تجريبي)', 'أغلب منتجاتنا هاند ميد وبتتخصص (مقاس/لون/اسم). ابعتلنا التفاصيل وهنرد عليك بالسعر والمدة.', (select owner from m)),
  ('dd000000-0000-4000-8000-000000000305', '/مواعيد', 'مواعيد الرد (تجريبي)', 'بنرد يوميًا من 9 صباحًا لـ 10 مساءً. برّه المواعيد سيب رسالتك وهنرد أول ما نرجع.', (select owner from m));
with m as (select id as owner from public.profiles where member_code = 'M01')
insert into public.cs_auto_rules (id, name, grp, event, event_to, conds, action, template_id, role_id, tag, delay_min, once, ticket_if_silent, enabled, runs, created_by) values
  ('dd000000-0000-4000-8000-000000000311', 'تأكيد الأوردر (تجريبي)', 'العملاء — حالة الأوردر', 'status', 'جاري التنفيذ', '[["القناة","=","واتساب 1"]]', 'send', 'dd000000-0000-4000-8000-000000000291', null, null, 5, true, false, false, 0, (select owner from m)),
  ('dd000000-0000-4000-8000-000000000312', 'إشعار الشحن (تجريبي)', 'العملاء — حالة الأوردر', 'status', 'قيد الشحن', '[]', 'send', 'dd000000-0000-4000-8000-000000000292', null, null, 0, true, false, false, 0, (select owner from m)),
  ('dd000000-0000-4000-8000-000000000313', 'ترحيب أول رسالة (تجريبي)', 'العملاء — الوارد', 'first', null, '[]', 'send', 'dd000000-0000-4000-8000-000000000293', null, null, 0, true, true, false, 0, (select owner from m)),
  ('dd000000-0000-4000-8000-000000000314', 'أوردر فرعي جديد للمبتكر (تجريبي)', 'المبتكرين', 'sub', null, '[]', 'send', 'dd000000-0000-4000-8000-000000000295', null, null, 0, true, false, false, 0, (select owner from m)),
  ('dd000000-0000-4000-8000-000000000315', 'تاج مرتجع لو العميل متضايق (تجريبي)', 'العملاء — الوارد', 'first', null, '[["المزاج","=","متضايق"]]', 'tag', null, null, 'متابعة', 0, false, false, false, 0, (select owner from m)),
  ('dd000000-0000-4000-8000-000000000316', 'تحويل الشكاوى لخدمة العملاء (تجريبي)', 'العملاء — الوارد', 'transfer', null, '[]', 'assign', null, 'cs', null, 0, false, false, false, 0, (select owner from m));

select (select count(*) from public.cs_customers where source = 'تجريبي') as customers, (select count(*) from public.cs_conversations where id::text like 'dd000000-%') as conversations,
       (select count(*) from public.cs_messages where conversation_id::text like 'dd000000-%') as messages, (select count(*) from public.cs_templates where id::text like 'dd000000-%') as templates,
       (select count(*) from public.cs_quick_replies where id::text like 'dd000000-%') as quick, (select count(*) from public.cs_auto_rules where id::text like 'dd000000-%') as rules;
