# المرحلة 5.2 — استوديو المنتجات (من غير AI) — الدفتر

الخطة: `docs/superpowers/plans/2026-10-28-phase-5-2-studio.md`.

- [x] T1 فحص `studio2` (قراءة بس) — commit d7746e9؛ الخطة f150f07.
- [x] T2 `0023_studio` + `rls_studio` — commit 3c4b5f4.
- [x] T3 الدومين (SKU، الألوان، الشيت) — commit 7ee2870.
- [x] T4 woo-sync `studio_upload` / `category_create` + `woo-studio.js` — commit d1e9d86.
- [x] T5–T6 `IBStudio` + صفحة الاستوديو + mock + e2e — commit d44119a.
- [x] المبتكر من غير snippet (صاحب المشروع: «دور كويس تاني») — commit a57f12d: من كود Dokan Lite
  (`DokanRESTController::update_post_author_if_needed`، من 3.10.3) — `PUT dokan/v1/products/{id} { post_author }` بباسورد التطبيق
  بيكتب الكاتب للأدمن لو المستخدم عنده `dokan_add_product`، وإلا بيكتب اللي بينادي → الرد بيتشيّك. للمنتج وترجمته؛
  «فشل» = «جرّب تاني» بيسأل تاني بس. `woo-api` من WordPress: `wp/v2/media` بس.
- [x] المبتكر بالاختيار (صاحب البراند افتراضي، وأي مبتكر بالطلب؛ من غير متجر على الموقع مايتختارش) + المبتكر قبل التركيبات
  (`author_failed` = مافيش تركيبات لحد «جرّب تاني») + لينك Google Sheet (`studio_sheet`، قرار 13) — commit de42e1f.
- [x] المبتكر اتغيّر بعد الرفع (bug: إعادة المحاولة كانت بتسيب المنتج وترجمته على المبتكر القديم والنتيجة `ok`) — commit 66175a0
  (قرار 9 في الخطة): `authorOwner` جنب `authorIds`؛ مبتكر تاني والتركيبات لسه ماتبعتتش = `post_author` تاني على المنتج وترجمته،
  وبعد ما اتبعتت = `maker_changed` من غير أي كتابة؛ نتيجة v32 من غير `authorOwner` = مبتكر الدفعة. الواجهة: «ارفع على الموقع»
  بيبعت تاني اللي على مبتكر تاني، وملاحظة في «البداية». مش قفل للمبتكر (كان محتاج تريجر في migration، وبيقفل حل `author_failed`).
- [ ] T7 حي:
  - [x] `0023` من SQL Editor (صاحب المشروع، 28 أكتوبر).
  - [x] `rls_studio rls_products rls_products_report` حي ok — RLS live run 40772555442.
  - [x] `woo-sync` **v31** و`woo-webhook` **v18** (متطابقين مع الريبو ما عدا سطرين `normalizePhone` المعروفين؛ v30 اتنشرت
    دقايق بالملفات القديمة — `wp/v2/product` — وv31 بدلها).
  - [x] `woo-sync` **v32** (29 أكتوبر 03:07Z، كود de42e1f: `studio_sheet` + المبتكر قبل التركيبات): الملفات التمانية متطابقة
    مع الريبو ما عدا سطرين `normalizePhone` المعروفين (`woo-core.js` نفس v31)، `verify_jwt` false. `woo-webhook` ماتغيّرش (v18).
    أول تشغيلة cron عليها (`woo-sync-backup` 03:15Z، من سجلات `function_edge_logs`): version 32 → 200 في 20 ثانية.
  - [x] main + نشر الموقع (29 أكتوبر): `main` fast-forward لـ 1c024dd (CI أخضر على de42e1f و7dcba57 و1c024dd) → Deploy run
    40812211792 أخضر 03:27Z → فرع `deploy` = 39f9d76 وشجرته = `main:app` (فيه `readSheetLink` واختيار المبتكر)؛ Hostinger بيسحبه
    لوحده. فحص المتصفح على الموقع بتاع صاحب المشروع (الـ sandbox مابيوصلش للموقع).
  - [x] `woo-sync` **v33** (29 أكتوبر 04:13Z، كود 66175a0: `authorOwner` و`maker_changed`): الملفات التمانية متطابقة مع الريبو
    (اتقارنت بايت ببايت من `get_edge_function`) ما عدا سطرين `normalizePhone` المعروفين (`woo-core.js`، نفس النتيجة على 10 أشكال
    تليفون)، `verify_jwt` false. أول تشغيلة cron عليها 04:15Z: version 33 → 200 في 21 ثانية. `woo-webhook` ماتغيّرش (v18).
    قبلها دفعة Simple واحدة اترفعت على v32 (03:45Z، منتج 182045، مبتكر 1563، `author: ok` من غير `authorOwner`) — بتتحسب على
    مبتكر الدفعة.
  - [ ] قبول: منتج Simple + منتج Variable مسودة من الاستوديو (بموافقة صاحب المشروع) — الصور، الترجمة العربي، المبتكر على Dokan، المرآة.
  - [ ] تقرير.

الاختبارات (a57f12d): unit 303، e2e 172 (اختبار سعر قرار 16 فشل مرة تحت الضغط وعدّى 5/5 لوحده)، Deno 123.
الاختبارات (66175a0): unit 305، e2e 174، Deno 126 (الاختبارات الجديدة بتفشل على كود v32). CI على 0a3d572 (نفس الكود قبل الـ rebase):
semgrep وDeno والـ db خضر؛ e2e فشل مرة في `vendors-brands.spec.mjs:260` (نقل البراند — مالوش علاقة بالاستوديو؛ عدّى 4/4 هنا بـ worker-ين).
