-- tools/seed/30-inventory.sql — المخزن: قطع بكل الأسباب والحالات (متاح للبيع / تصوير / مرتجع) على مبتكرين حقيقيين ورفوف المخزن، حركاتها
-- (الكميات من الحركات بس)، وجرد مفتوح على رف A. مافيش «تجميع أوردر» عشان مايتربطش بأوردرات الموقع الحقيقية.
-- uuid ثابتة dd000000-0000-4000-8000-0000000003xx، والاسم فيه «(تجريبي)».
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

with m as (select id as ops from public.profiles where member_code = 'M03')
insert into public.inv_lots (id, reason, status, sku, name, vendor_id, ref, loc, mode, cost, condition, condition_note, note, since, created_by)
select d.id::uuid, d.reason, d.status, d.sku, d.name, v.id, d.ref, d.loc, d.mode, d.cost, d.cond, d.cond_note, 'تجريبي', current_date - d.age, (select ops from m)
from (values
  ('dd000000-0000-4000-8000-000000000331', 'متاح للبيع', 'متاح', 'IBT-ARBR-0999', 'سلة كروشيه كبيرة (تجريبي)', 'Art Craft', 'استلام يدوي', 'A', 'أمانة', 260, 'سليم', null, 20),
  ('dd000000-0000-4000-8000-000000000332', 'متاح للبيع', 'متاح', 'IBT-ANWH-1000', 'فازة سيراميك بيضا (تجريبي)', 'Antikiano', 'استلام يدوي', 'A', 'ملك ابتكر', 300, 'سليم', null, 18),
  ('dd000000-0000-4000-8000-000000000333', 'متاح للبيع', 'محجوز لأوردر', 'IBT-CRBE-1001', 'شنطة كروشيه بيج (تجريبي)', 'Crochic', 'استلام يدوي', 'B', 'أمانة', 420, 'سليم', null, 15),
  ('dd000000-0000-4000-8000-000000000334', 'متاح للبيع', 'متاح', 'IBT-DEGR-1002', 'مراية خشب 60×90 (تجريبي)', 'Decoro', 'استلام يدوي', 'C', 'ملك ابتكر', 720, 'تغليف متضرر', 'الكرتونة مفتوحة من جنب', 12),
  ('dd000000-0000-4000-8000-000000000335', 'تصوير', 'مستني تصوير', 'IBT-AKBL-1003', 'شال أخميمي أزرق (تجريبي)', 'Akhmim', 'عينة للتصوير', 'P', 'أمانة', 380, 'سليم', null, 5),
  ('dd000000-0000-4000-8000-000000000336', 'تصوير', 'اتصور', 'IBT-BIRD-1004', 'طقم مخدات أحمر (تجريبي)', 'Bian eg', 'عينة للتصوير', 'P', 'أمانة', 550, 'سليم', null, 9),
  ('dd000000-0000-4000-8000-000000000337', 'مرتجع', 'بانتظار الفحص', 'IBT-ARBR-0999', 'سلة كروشيه كبيرة (تجريبي)', 'Art Craft', 'مرتجع من عميل', 'R', 'أمانة', 260, null, null, 2),
  ('dd000000-0000-4000-8000-000000000338', 'مرتجع', 'تالف', 'IBT-ANWH-1000', 'فازة سيراميك بيضا (تجريبي)', 'Antikiano', 'مرتجع — اتكسرت في الشحن', 'R', 'أمانة', 300, 'تالف', 'شرخ في القاعدة', 4),
  ('dd000000-0000-4000-8000-000000000339', 'مرتجع', 'راجع للمبتكر', 'IBT-CRBE-1001', 'شنطة كروشيه بيج (تجريبي)', 'Crochic', 'مرتجع — مقاس غلط', 'R', 'أمانة', 420, 'عيب بسيط', 'خيط فالت', 7)
) as d(id, reason, status, sku, name, vendor, ref, loc, mode, cost, cond, cond_note, age)
join public.vendors v on v.name = d.vendor;

-- الحركات (in = دخول، reserve = حجز، out = خروج، adjust = تسوية، move = نقل مكان بكمية صفر)
with m as (select id as ops from public.profiles where member_code = 'M03')
insert into public.inv_moves (lot_id, type, qty, label, reason, ref, note, by, at)
select d.lot::uuid, d.type, d.qty, d.label, d.reason, d.ref, 'تجريبي', (select ops from m), now() - (d.age || ' days')::interval
from (values
  ('dd000000-0000-4000-8000-000000000331', 'in', 5, 'دخول — للبيع', 'متاح للبيع', 'استلام يدوي', 20),
  ('dd000000-0000-4000-8000-000000000331', 'out', 2, 'خروج', 'متاح للبيع', 'بيع', 8),
  ('dd000000-0000-4000-8000-000000000332', 'in', 4, 'دخول — للبيع', 'متاح للبيع', 'استلام يدوي', 18),
  ('dd000000-0000-4000-8000-000000000332', 'adjust', -1, 'تسوية جرد', 'جرد', 'CNT-تجريبي', 6),
  ('dd000000-0000-4000-8000-000000000333', 'in', 1, 'دخول — للبيع', 'متاح للبيع', 'استلام يدوي', 15),
  ('dd000000-0000-4000-8000-000000000333', 'reserve', 1, 'حجز لأوردر', 'متاح للبيع', 'حجز', 3),
  ('dd000000-0000-4000-8000-000000000334', 'in', 2, 'دخول — للبيع', 'متاح للبيع', 'استلام يدوي', 12),
  ('dd000000-0000-4000-8000-000000000334', 'move', 0, 'نقل من B لـ C', 'متاح للبيع', 'نقل', 10),
  ('dd000000-0000-4000-8000-000000000335', 'in', 1, 'دخول — تصوير', 'تصوير', 'عينة', 5),
  ('dd000000-0000-4000-8000-000000000336', 'in', 3, 'دخول — تصوير', 'تصوير', 'عينة', 9),
  ('dd000000-0000-4000-8000-000000000337', 'in', 1, 'دخول — مرتجع', 'مرتجع', 'مرتجع من عميل', 2),
  ('dd000000-0000-4000-8000-000000000338', 'in', 1, 'دخول — مرتجع', 'مرتجع', 'مرتجع من عميل', 4),
  ('dd000000-0000-4000-8000-000000000339', 'in', 1, 'دخول — مرتجع', 'مرتجع', 'مرتجع من عميل', 7)
) as d(lot, type, qty, label, reason, ref, age);

-- جرد مفتوح على رف A (المعدود مختلف عن السيستم في قطعة)
with m as (select id as ops from public.profiles where member_code = 'M03'), c as (
  insert into public.inv_counts (zone, status, note, started_by, started_at) select 'A', 'open', 'تجريبي', (select ops from m), now() - interval '2 hours' returning id)
insert into public.inv_count_lines (count_id, lot_id, system, counted, note)
select (select id from c), d.lot::uuid, d.sys, d.cnt, d.note from (values
  ('dd000000-0000-4000-8000-000000000331', 3, 3, null),
  ('dd000000-0000-4000-8000-000000000332', 3, 2, 'قطعة ناقصة (تجريبي)')
) as d(lot, sys, cnt, note);

select (select count(*) from public.inv_lots where note = 'تجريبي') as lots, (select count(*) from public.inv_moves where note = 'تجريبي') as moves, (select count(*) from public.inv_counts where note = 'تجريبي') as counts;
