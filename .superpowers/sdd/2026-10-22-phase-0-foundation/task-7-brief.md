### Task 7: أول نشر على subdomain Hostinger

**Files:**
- Create: `tools/deploy.md` (خطوات النشر وما يلزم)، `app/.htaccess` (لو احتاج: `Options -Indexes` + cache headers للـ css/js)

**Interfaces:**
- Consumes: اسم الـ subdomain من صاحب المشروع (بند مفتوح 6 في الوثيقة)، تفويض إضافة Hostinger عبر `/mcp` أو بيانات FTP.
- Produces: التطبيق شغال على `https://<subdomain>.ibtekr.club` بشاشة دخول حقيقية.

- [ ] **Step 1: جهّز إعدادات Auth في Supabase**: Site URL = `https://<subdomain>.ibtekr.club`، وRedirect URLs تشمله وتشمل `http://localhost:4173` (من لوحة Supabase › Authentication › URL Configuration، أو MCP لو متاح).

- [ ] **Step 2: انشر `app/`** بسكيل `hostinger:hosting-deploy-static-site` (أو FTP لو الإضافة مش مفوّضة)، مع `config.js` بمفتاح `anon` بتاع الإنتاج.

- [ ] **Step 3: تحقق**: افتح الرابط → `toHaveTitle('تسجيل الدخول — نظام إبتكر')`؛ سجّل دخول بحساب الأدمن الحقيقي (يتعمل بـ Supabase Auth › Users › Invite لإيميل صاحب المشروع، وصف `profiles` ليه بـ `role_id='admin'`، `member_code='M01'`)؛ `activity_log` فيه صف `auth.signin`.

- [ ] **Step 4: فحص أمني قبل الإعلان**: `/differential-review` على الفرع + semgrep نظيف + `get_advisors` نظيف.

- [ ] **Step 5: Commit وادفع**

```bash
git add tools/deploy.md app/.htaccess
git commit -m "chore: first deploy to the Hostinger subdomain"
git push
```

---

## Self-review (اتعملت قبل الحفظ)

- **تغطية الوثيقة (المرحلة 0 بس):** تقسيم الملف ✔ (T1)، Auth والأدوار ✔ (T3, T5)، الصلاحيات بيانات ✔ (T3)، settings/status_map/activity/alerts ✔ (T4)، الجرس: الجدول موجود (T4) والربط بالواجهة في خطة صفحة "لوحة التحكم" (مكتوب في الوثيقة إن اللوحة تكتمل في الآخر)، سياق المستودع ✔ (T6)، أول نشر ✔ (T7). مزامنة Woo والجسر وبقية الصفحات لخطط لاحقة بترتيب القائمة.
- **التواقيع متسقة:** `IBAuth.signIn/verifyTotp/needsTotp/signOut/session/onChange/resetPassword/updatePassword`، `IBDirectory.load/me/members`، `IBActivity.log`، `has_perm`, `email_for_identifier`, `log_activity` مستخدمة بنفس الأسماء في T3/T4/T5.
- **Review Focus:** كل سطر ليه اختبار في المهمة المالكة (T2 للقواعد، T3 للـ SQL، T5 للـ e2e).
