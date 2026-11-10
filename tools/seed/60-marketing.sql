-- tools/seed/60-marketing.sql — التسويق: 3 كامبينات (خطوة 1 / 2 / 4) بقطع من غير صور، قالبين تصميم، بوستات في «الخطة الإعلانية» و«سجل النشر»
-- (كلها how = download — عمرها ما تتنشر على الصفحة الحقيقية، والمنشور منها أرقامه وهمية)، طلبات للديزاينر والمبرمج، واقتراحات ميديا باير مستنية
-- (أرقام حملات وهمية 9900000x — قرار عليها والمفتاح مقفول = بيتسجل بس). uuid ثابتة dd000000-0000-4000-8000-0000000006xx.
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

with m as (select id as owner from public.profiles where member_code = 'M01')
insert into public.mkt_campaigns (id, name, goal, step, state, created_by, created_at, updated_at)
select d.id::uuid, d.name, d.goal, d.step, jsonb_build_object(
    'w', jsonb_build_object('goal', d.goal, 'idea', d.idea, 'mediaTab', 'post', 'media', jsonb_build_object(
      'video', jsonb_build_object('count', 0, 'size', '9:16', 'dur', 15, 'model', 'seedance-2.5', 'notes', '', 'use', '[]'::jsonb, 'ref', '[]'::jsonb),
      'post', jsonb_build_object('count', d.posts, 'size', '1080x1350', 'model', 'seedream-5-pro', 'notes', '', 'use', '[]'::jsonb, 'ref', '[]'::jsonb),
      'carousel', jsonb_build_object('count', d.car, 'slides', 4, 'size', '1080x1350', 'model', 'seedream-5-pro', 'notes', '', 'use', '[]'::jsonb, 'ref', '[]'::jsonb)),
      'extra', jsonb_build_object('count', 0, 'model', 'seedream-5-pro', 'notes', '', 'use', '[]'::jsonb, 'ref', '[]'::jsonb)),
    'pieces', d.pieces::jsonb), (select owner from m), now() - (d.age || ' days')::interval, now() - (d.age || ' days')::interval + interval '2 hours'
from (values
  ('dd000000-0000-4000-8000-000000000601', 'كولكشن الشتا (تجريبي)', 'منتج جديد', 4, 'شالات وبطاطين هاند ميد للشتا', 2, 0, 12,
   '[{"id":"P1","kind":"بوست","n":1,"size":"1080x1350","model":"seedream-5-pro","idea":"شال أخميمي على كنبة","caption":"دفا الشتا من إيد مبتكرين أخميم 🧣","title":"دفا","sub":"هاند ميد","badge":"جديد","ref":[],"use":[],"img":null,"gen":0,"approved":true},{"id":"P2","kind":"بوست","n":2,"size":"1080x1350","model":"seedream-5-pro","idea":"بطانية كروشيه","caption":"كل غرزة معمولة بحب ❤️","title":"كروشيه","sub":"","badge":"","ref":[],"use":[],"img":null,"gen":0,"approved":true}]'),
  ('dd000000-0000-4000-8000-000000000602', 'عرض الجمعة البيضا (تجريبي)', 'عرض / خصم', 2, 'خصم 20% على الديكور', 1, 1, 3,
   '[{"id":"P1","kind":"بوست","n":1,"size":"1080x1350","model":"seedream-5-pro","idea":"مراية خشب بخصم","caption":"خصم 20% لحد الجمعة 🔥","title":"20%","sub":"على الديكور","badge":"عرض","ref":[],"use":[],"img":null,"gen":0,"approved":false},{"id":"C1","kind":"كاروسيل","n":1,"size":"1080x1350","model":"seedream-5-pro","idea":"4 منتجات ديكور","caption":"اختار المفضل عندك 👇","title":"","sub":"","badge":"","ref":[],"use":[],"img":null,"gen":0,"approved":false}]'),
  ('dd000000-0000-4000-8000-000000000603', 'هدايا رأس السنة (تجريبي)', 'مجموعة جديدة', 1, 'أفكار هدايا هاند ميد تحت 500 ج.م', 3, 0, 0, '[]')
) as d(id, name, goal, step, idea, posts, car, age, pieces);

with m as (select id as owner from public.profiles where member_code = 'M01')
insert into public.mkt_templates (id, name, kind, image, descr, used, created_by) values
  ('dd000000-0000-4000-8000-000000000611', 'منتج على خلفية كريمي (تجريبي)', 'post', null, 'المنتج في النص على كريمي فاتح، لوجو صغير تحت يمين', 4, (select owner from m)),
  ('dd000000-0000-4000-8000-000000000612', 'كاروسيل 4 منتجات (تجريبي)', 'carousel', null, 'كل شريحة منتج + السعر في شريط أخضر', 1, (select owner from m));

-- البوستات: مجدول (الأسبوعين الجايين) ومنشور (بأرقام) — download بس
with m as (select id as owner from public.profiles where member_code = 'M01')
insert into public.mkt_posts (campaign_id, piece, kind, name, caption, caption_orig, tags, images, platform, day, time, how, status, src, published_at, published_by, views, reach, likes, comments, shares, saves, eng, stats_at, created_by)
select d.camp::uuid, d.piece, d.kind, d.name || ' (تجريبي)', d.caption, d.caption, '#إبتكر #هاند_ميد', '{}', d.platform, current_date + d.dd, d.t, 'download', d.status, 'system',
       case when d.status = 'اتنشر' then (current_date + d.dd + d.t::time) at time zone 'Africa/Cairo' end, case when d.status = 'اتنشر' then (select owner from m) end,
       d.views, d.reach, d.likes, d.comments, d.shares, d.saves, d.likes + d.comments + d.shares + d.saves, case when d.status = 'اتنشر' then now() - interval '1 hour' end, (select owner from m)
from (values
  ('dd000000-0000-4000-8000-000000000601', 'P1', 'بوست', 'دفا', 'دفا الشتا من إيد مبتكرين أخميم 🧣', 'فيسبوك', -6, '19:00', 'اتنشر', 4200, 3100, 180, 22, 9, 31),
  ('dd000000-0000-4000-8000-000000000601', 'P1', 'بوست', 'دفا', 'دفا الشتا من إيد مبتكرين أخميم 🧣', 'انستجرام', -6, '20:00', 'اتنشر', 6900, 5200, 410, 37, 15, 88),
  ('dd000000-0000-4000-8000-000000000601', 'P2', 'بوست', 'كروشيه', 'كل غرزة معمولة بحب ❤️', 'انستجرام', -2, '20:30', 'اتنشر', 2500, 1900, 140, 11, 4, 26),
  ('dd000000-0000-4000-8000-000000000601', 'P2', 'بوست', 'كروشيه', 'كل غرزة معمولة بحب ❤️', 'فيسبوك', 1, '19:00', 'مجدول', null, null, 0, 0, 0, 0),
  ('dd000000-0000-4000-8000-000000000602', 'P1', 'بوست', '20%', 'خصم 20% لحد الجمعة 🔥', 'فيسبوك', 3, '18:00', 'مجدول', null, null, 0, 0, 0, 0),
  ('dd000000-0000-4000-8000-000000000602', 'P1', 'بوست', '20%', 'خصم 20% لحد الجمعة 🔥', 'انستجرام', 3, '20:00', 'مجدول', null, null, 0, 0, 0, 0),
  ('dd000000-0000-4000-8000-000000000602', 'C1', 'كاروسيل', 'اختار المفضل', 'اختار المفضل عندك 👇', 'انستجرام', 5, '21:00', 'مجدول', null, null, 0, 0, 0, 0),
  ('dd000000-0000-4000-8000-000000000602', 'C1', 'كاروسيل', 'اختار المفضل', 'اختار المفضل عندك 👇', 'تيك توك', 6, '22:00', 'مجدول', null, null, 0, 0, 0, 0)
) as d(camp, piece, kind, name, caption, platform, dd, t, status, views, reach, likes, comments, shares, saves);

-- طلبات الديزاينر والمبرمج
with m as (select id as owner from public.profiles where member_code = 'M01'), s as (select id from public.profiles where member_code = 'M05')
insert into public.mkt_requests (kind, title, details, project, status, created_by, created_at, done_at) values
  ('designer', 'بانر عرض الجمعة البيضا', 'مقاس 1200×628 لفيسبوك وستوري 1080×1920', 'تجريبي', 'بيتعمل', (select id from s), now() - interval '2 days', null),
  ('designer', 'تعديل لوجو الستوري', 'نسخة أبيض على شفاف', 'تجريبي', 'خلص', (select owner from m), now() - interval '9 days', now() - interval '6 days'),
  ('dev', 'زرار واتساب في صفحة المنتج', 'يفتح محادثة واتساب 1 برسالة فيها اسم المنتج', 'تجريبي', 'جديد', (select owner from m), now() - interval '1 days', null),
  ('dev', 'UTM ثابت على لينكات البايو', 'utm_source=instagram&utm_medium=bio', 'تجريبي', 'جاهز للمراجعة', (select id from s), now() - interval '4 days', null);

-- اقتراحات الميديا باير (حملات وهمية) — مستنية قرار الأدمن
insert into public.mkt_suggestions (platform, kind, campaign_id, campaign_name, title, sub, why, impact, pct, data, status) values
  ('meta', 'stop', '99000001', 'شتا — ريتارجتنج (تجريبي)', 'وقّف الحملة؟', 'صرفت 1,650 ج.م في 5 أيام من غير أوردر', 'مافيش ولا أوردر من الإعلان ده في ووكومرس آخر 5 أيام', 'توفير ≈ 330 ج.م في اليوم', null, '{}', 'pending'),
  ('meta', 'budget_up', '99000002', 'كروشيه — اهتمامات (تجريبي)', 'زوّد الميزانية 20%؟', 'العائد الحقيقي 5.1× من 7 أوردرات مؤكدة', 'العائد فوق 4× والأوردرات مؤكدة أو مكتملة', '+ ≈ 2 أوردر في الأسبوع', 20, '{}', 'pending'),
  ('meta', 'budget_down', '99000003', 'ديكور — واسع (تجريبي)', 'قلّل الميزانية 30%؟', 'تكلفة الأوردر 520 ج.م', 'أعلى من الحد (450 ج.م) مع 3 أوردرات', 'توفير ≈ 150 ج.م في اليوم', -30, '{}', 'pending'),
  ('tiktok', 'creative', '99000004', 'تيك توك — ريل الشال (تجريبي)', 'غيّر الإعلان؟', 'التكرار وصل 4.6', 'الناس شافته كتير والنقرات نزلت 40%', 'طلب تصميم جديد', null, '{}', 'pending');

select (select count(*) from public.mkt_campaigns where id::text like 'dd000000-%') as campaigns, (select count(*) from public.mkt_templates where id::text like 'dd000000-%') as templates,
       (select count(*) from public.mkt_posts where campaign_id::text like 'dd000000-%') as posts, (select count(*) from public.mkt_requests where project = 'تجريبي') as requests,
       (select count(*) from public.mkt_suggestions where campaign_id like '9900000%') as suggestions;
