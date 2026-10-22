-- أول حساب أدمن (المرحلة 0). يتشغّل مرة واحدة على المشروع الحي بعد الـ migrations.
-- الخطوة 1 يدوية: Supabase › Authentication › Users › Invite user (أو Create new user + Auto Confirm)
--   بالإيميل owner@example.com (إيميل الدخول). بريد النظام operation-system@ibtekr.club حاجة تانية (SMTP).
-- الخطوة 2: الملف ده (execute_sql أو SQL editor). مافيش أسرار هنا.

insert into public.profiles (id, member_code, name, email, phone, role_id, title, dept, status)
select u.id, 'M01', 'محمد', u.email, '01100007039', 'admin', 'المؤسس والمدير العام', 'الإدارة', 'active'
from auth.users u
where u.email = 'owner@example.com'
on conflict (id) do nothing;
-- المتوقع: INSERT 0 1. لو 0 → الإيميل مش موجود في auth.users (راجع الخطوة 1) أو الصف موجود أصلًا.

select id, member_code, name, email, phone, role_id, status
from public.profiles
where member_code = 'M01';
-- المتوقع: صف واحد بـ role_id = 'admin' و status = 'active'.
