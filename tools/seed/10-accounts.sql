-- tools/seed/10-accounts.sql — الحسابات: المصروفات (والاشتراكات جواها) · حركات المبتكرين · حركات الحسابات. note = 'تجريبي' هي العلامة.
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- المصروفات: المرتبات (أعضاء + فريلانسر) · المصروفات بتفاصيل · الإعلانات بالمنصة · الاشتراكات بتاريخ انتهاء وتنبيه · وإيداع مرتجع
with m as (select id as owner from public.profiles where member_code = 'M01')
insert into public.acc_expenses (on_date, direction, category, beneficiary, beneficiary_other, amount, note, details, staff_kind, reason, sub_name, sub_is_other, sub_ends, sub_alerts, sub_note, created_by)
select d.on_date, d.direction, d.category, d.beneficiary, coalesce(d.beneficiary_other, false), d.amount, d.note, d.details, d.staff_kind, d.reason, d.sub_name, coalesce(d.sub_is_other, false), d.sub_ends, coalesce(d.sub_alerts, '{}'), d.sub_note, (select owner from m) from (values
  (current_date - 40, 'withdraw', 'المرتبات', 'mohamed', false, 8000, 'تجريبي', null, 'staff', null, null, null, null::date, null::text[], null),
  (current_date - 40, 'withdraw', 'المرتبات', 'safwat', false, 10000, 'تجريبي', null, 'staff', null, null, null, null, null, null),
  (current_date - 40, 'withdraw', 'المرتبات', 'أحمد مصوّر فريلانسر', true, 2500, 'تجريبي', null, 'freelance', null, null, null, null, null, null),
  (current_date - 38, 'withdraw', 'المصروفات', null, null, 850, 'تجريبي', 'كرتون وتغليف 200 علبة', null, null, null, null, null, null, null),
  (current_date - 36, 'withdraw', 'المصروفات', null, null, 1200, 'تجريبي', 'طباعة ستيكرات وشكر كارد', null, null, null, null, null, null, null),
  (current_date - 34, 'withdraw', 'المصروفات', null, null, 2300, 'تجريبي', 'إيجار المخزن — الشهر', null, null, null, null, null, null, null),
  (current_date - 33, 'withdraw', 'الإعلانات', 'ميتا (فيسبوك وإنستجرام)', false, 3500, 'تجريبي', 'حملة كولكشن الخريف', null, null, null, null, null, null, null),
  (current_date - 29, 'withdraw', 'الإعلانات', 'تيك توك', false, 1500, 'تجريبي', 'تجربة فيديو ريل', null, null, null, null, null, null, null),
  (current_date - 26, 'withdraw', 'الإعلانات', 'جوجل', false, 900, 'تجريبي', 'كلمات بحث هدايا', null, null, null, null, null, null, null),
  (current_date - 31, 'withdraw', 'الاشتراكات', null, null, 450, 'تجريبي', null, null, null, 'Canva', false, current_date + 20, array['week','day'], 'تجريبي'),
  (current_date - 31, 'withdraw', 'الاشتراكات', null, null, 1100, 'تجريبي', null, null, null, 'استضافة الموقع (Hostinger)', false, current_date + 5, array['month','week','day'], 'تجريبي'),
  (current_date - 27, 'withdraw', 'الاشتراكات', null, null, 600, 'تجريبي', null, null, null, 'Google Workspace', false, current_date + 48, array['month'], 'تجريبي'),
  (current_date - 25, 'withdraw', 'الاشتراكات', null, null, 1800, 'تجريبي', null, null, null, 'أداة جدولة بوستات', true, current_date - 2, array['week'], 'تجريبي'),
  (current_date - 23, 'withdraw', 'المصروفات', null, null, 320, 'تجريبي', 'مواصلات تشغيل — البوسطة', null, null, null, null, null, null, null),
  (current_date - 21, 'deposit', 'المصروفات', 'مطبعة النور', true, 500, 'تجريبي', null, null, 'استرجاع مبلغ مدفوع', null, null, null, null, null),
  (current_date - 19, 'withdraw', 'الإعلانات', 'ميتا (فيسبوك وإنستجرام)', false, 4200, 'تجريبي', 'ريتارجتنج العملاء', null, null, null, null, null, null, null),
  (current_date - 16, 'withdraw', 'المصروفات', null, null, 760, 'تجريبي', 'كهربا ونت المخزن', null, null, null, null, null, null, null),
  (current_date - 13, 'withdraw', 'المرتبات', 'ليلى مونتاج فريلانسر', true, 2000, 'تجريبي', null, 'freelance', null, null, null, null, null, null),
  (current_date - 10, 'withdraw', 'المرتبات', 'mohamed', false, 8000, 'تجريبي', null, 'staff', null, null, null, null, null, null),
  (current_date - 10, 'withdraw', 'المرتبات', 'safwat', false, 10000, 'تجريبي', null, 'staff', null, null, null, null, null, null),
  (current_date - 8, 'withdraw', 'الإعلانات', 'ميتا (فيسبوك وإنستجرام)', false, 1800, 'تجريبي', 'بوست الهدايا', null, null, null, null, null, null, null),
  (current_date - 6, 'withdraw', 'المصروفات', null, null, 640, 'تجريبي', 'أكياس شحن', null, null, null, null, null, null, null),
  (current_date - 4, 'deposit', 'الاشتراكات', 'Canva', true, 450, 'تجريبي', null, null, 'إلغاء اشتراك', null, null, null, null, null),
  (current_date - 2, 'withdraw', 'المصروفات', null, null, 410, 'تجريبي', 'شريط لاصق وبابل راب', null, null, null, null, null, null, null)
) as d(on_date, direction, category, beneficiary, beneficiary_other, amount, note, details, staff_kind, reason, sub_name, sub_is_other, sub_ends, sub_alerts, sub_note);

-- حركات المبتكرين: عربون / مواصلات / أخرى، سحب وإيداع، على 6 مبتكرين حقيقيين
with m as (select id as owner from public.profiles where member_code = 'M01')
insert into public.acc_vendor_moves (vendor_id, on_date, direction, kind, kind_name, amount, note, created_by)
select v.id, d.on_date, d.direction, d.kind, d.kind_name, d.amount, 'تجريبي', (select owner from m)
from (values
  ('Art Craft', current_date - 39, 'withdraw', 'عربون', null, 1500), ('Antikiano', current_date - 37, 'withdraw', 'عربون', null, 800),
  ('Art Craft', current_date - 35, 'withdraw', 'مواصلات', null, 120), ('Crochic', current_date - 32, 'withdraw', 'عربون', null, 2000),
  ('Decoro', current_date - 30, 'withdraw', 'مواصلات', null, 95), ('Antikiano', current_date - 28, 'withdraw', 'أخرى', 'خامات اتشرت له', 650),
  ('Art Craft', current_date - 25, 'deposit', 'أخرى', 'تسوية مرتجع', 300), ('Akhmim', current_date - 22, 'withdraw', 'عربون', null, 1000),
  ('Crochic', current_date - 20, 'withdraw', 'مواصلات', null, 140), ('Bian eg', current_date - 17, 'withdraw', 'عربون', null, 500),
  ('Decoro', current_date - 14, 'withdraw', 'أخرى', 'عينات تصوير', 250), ('Antikiano', current_date - 11, 'withdraw', 'مواصلات', null, 110),
  ('Art Craft', current_date - 8, 'withdraw', 'عربون', null, 2200), ('Akhmim', current_date - 6, 'withdraw', 'مواصلات', null, 130),
  ('Crochic', current_date - 4, 'deposit', 'أخرى', 'رد عربون', 500), ('Bian eg', current_date - 2, 'withdraw', 'مواصلات', null, 90)
) as d(vendor, on_date, direction, kind, kind_name, amount)
join public.vendors v on v.name = d.vendor;

-- حركات الحسابات الأربعة (الإيداعات قبل السحوبات بالتاريخ — الأرصدة بتبدأ صفر)
with m as (select id as owner from public.profiles where member_code = 'M01')
insert into public.acc_account_moves (account, on_date, direction, amount, note, created_by)
select d.account, d.on_date, d.direction, d.amount, 'تجريبي', (select owner from m) from (values
  ('حساب البنك', current_date - 40, 'deposit', 85000), ('حساب بوسطة', current_date - 40, 'deposit', 12000), ('حساب باي موب', current_date - 39, 'deposit', 18500), ('محفظة إلكترونية', current_date - 39, 'deposit', 4000),
  ('حساب البنك', current_date - 38, 'withdraw', 28500), ('محفظة إلكترونية', current_date - 35, 'withdraw', 1500), ('حساب بوسطة', current_date - 31, 'deposit', 9300),
  ('حساب البنك', current_date - 29, 'withdraw', 5000), ('حساب باي موب', current_date - 26, 'deposit', 7200), ('حساب بوسطة', current_date - 23, 'withdraw', 4000),
  ('حساب البنك', current_date - 21, 'deposit', 26000), ('حساب باي موب', current_date - 19, 'withdraw', 3000), ('حساب البنك', current_date - 12, 'withdraw', 9200),
  ('حساب بوسطة', current_date - 10, 'deposit', 11800), ('محفظة إلكترونية', current_date - 7, 'withdraw', 700), ('حساب باي موب', current_date - 5, 'deposit', 6400), ('حساب البنك', current_date - 3, 'withdraw', 21500)
) as d(account, on_date, direction, amount);

select (select count(*) from public.acc_expenses where note = 'تجريبي') as expenses, (select count(*) from public.acc_vendor_moves where note = 'تجريبي') as vendor_moves, (select count(*) from public.acc_account_moves where note = 'تجريبي') as account_moves;
