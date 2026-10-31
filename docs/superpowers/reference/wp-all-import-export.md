# WP All Import Pro / WP All Export Pro — مرجع (31 أكتوبر 2026)

صاحب المشروع بعت الإضافتين (zip) عشان نعرف إزاي البيانات بتترفع وتتنزّل على الموقع من غير السيستم. الكود اتدرس في الـ sandbox بس —
**مافيش أي حاجة منه في الريبو** (إضافات مدفوعة من Soflyy). النسخ: **WP All Import Pro 5.1.0** و**WP All Export Pro 1.9.15**.

## الخلاصة اللي تهمنا

- **الاتنين «النواة» بس.** WP All Import Pro لوحده بيستورد Posts/Pages/أي Custom Post Type (+ taxonomies + custom fields + صور). **منتجات
  WooCommerce بسعرها وتركيباتها ومخزونها محتاجة الـ add-on المنفصل** `wpai-woocommerce-add-on` (أو النسخة المجانية
  `woocommerce-xml-csv-product-import`) — النواة نفسها بتوصي بيه لما WooCommerce شغّال، ومش موجود في الملفات اللي اتبعتت. وكذلك WPML
  (الترجمات) ليه add-on منفصل. WP All Export Pro بالعكس بيصدّر منتجات WooCommerce (مع التركيبات) والأوردرات والكوبونات والعملاء
  والمراجعات من النواة مباشرة.
- **الصيغ:** استيراد XML / CSV / Excel (xls/xlsx عبر PhpSpreadsheet) + JSON/GZ/ZIP؛ تصدير CSV / XLS / XLSX / XML (قالب XML مخصص، وفيد
  Google Merchants جاهز).
- **مصادر الاستيراد:** رفع ملف، أو من URL (بما فيها لينك CSV منشور من Google Sheets)، أو FTP/SFTP (`ftp_host/port/username/password/private_key`)، أو ملف موجود على
  السيرفر في `wp-content/uploads/wpallimport/files`.

## فلو الاستيراد (WP All Import)

1. **المصدر** ثم اختيار العنصر المتكرر بـ XPath (الـ CSV بيتحوّل XML داخليًا؛ `records_per_request` و`chuncking` للملفات الكبيرة).
2. **القالب (Drag & drop):** العنوان، المحتوى، الـ slug، التاريخ، الحالة (`status` / `status_xpath`)، الكاتب (`author`)، الـ excerpt، **الصور**:
   `download_images` = `yes` (تنزيل من URL) / `gallery` (ملفات موجودة في مكتبة الوسائط) / `no`؛ featured + gallery بفواصل (`download_featured_delim`،
   `gallery_featured_delim`)، البحث عن صورة موجودة قبل التنزيل (`search_existing_images` + `search_existing_images_logic`)، إعادة تسمية
   (`auto_rename_images`) وامتداد (`auto_set_extension`)، وميتا الصور (title/alt/caption/description بفواصل). **Taxonomies** مفردة/متعددة/هرمية
   بفواصل (`tax_hierarchical_delim` …) أو mapping. **Custom fields** بالاسم والقيمة (serialized/mapping)، و**Nested files**.
3. **خيارات الاستيراد:** `unique_key` (المفتاح اللي بيعرّف الصف — SKU مثلًا)، إنشاء جديد (`create_new_records`)، تحديث الموجود
   (`is_update_*` لكل حقل على حدة: العنوان، المحتوى، الحالة، الأقسام، الصور بمنطق `update_images_logic`، الحقول المخصصة بقايمة
   only/except…)، وحذف/تحويل لمسودة اللي اختفى من الملف (`is_delete_missing` + `delete_missing_logic` + `status_of_removed_products`).
   «Skip if unchanged» بالـ hash (`is_selective_hashing`).
4. **التشغيل:** يدوي من اللوحة، أو **Cron URLs** بمفتاح `cron_job_key` من الإعدادات:
   `/?import_key=<KEY>&import_id=<N>&action=trigger` (يلاقي ملف جديد) ثم `&action=processing` (يعالج دفعات) — كمان `pipe` / `cancel` / `cleanup`؛
   أو خدمة **Automatic Scheduling** بتاعة Soflyy (`?action=wpai_public_api&q=...`، جدولة أسبوعية/شهرية بتوقيت).
5. **Add-on API** (`addon-api/`): الإضافات بتسجّل حقول (text, select, media, gallery, repeater…) وبتتعلّق على `wp_all_import_addon_parse` /
   `wp_all_import_addon_import` / `pmxi_saved_post` — ده الطريق اللي الـ WooCommerce add-on بيكتب بيه السعر/المخزون/التركيبات.

## فلو التصدير (WP All Export)

- اختيار النوع (منتجات — مع «export variations» وعنوان التركيبة — أوردرات بسطر لكل بند، كوبونات، عملاء، مراجعات، مستخدمين، تعليقات،
  taxonomies) أو **WP_Query مخصص**، ثم **فلاتر** (قواعد على الحقول)، ثم القالب (سحب الأعمدة؛ أعمدة مخصصة بـ PHP/SQL `cc_*`).
- خيارات: `export_only_new_stuff` / `export_only_modified_stuff` (من آخر تصدير)، تقسيم الملفات الكبيرة، BOM للإكسل، ترميز وفاصل،
  **Generate import template** (bundle يتسحب في WP All Import — «صدّر وعدّل وارجع استورد»)، فلتر لغة WPML (`wpml_lang`)،
  جدولة بـ `export_key` cron (`/?export_key=<KEY>&export_id=<N>&action=trigger|processing`)، **Real-time export** (hook على
  `wp_insert_<type>` لما العنصر يتنشر)، إرسال لـ **Zapier** و**Google Sheets** (`export_to_sheet`)، و**Client mode** (واجهة مبسطة لعميل).

## علاقته بالسيستم عندنا

- السيستم بيكتب على الموقع بـ **REST** (woo-sync: `product_save` / `products_batch` / `studio_upload` …) — مش عبر الإضافات دول، ومافيش
  نية نعتمد عليهم (القرار: الكتابة من مكان واحد مراقب بـ `woo_sync_log` و`activity_log`). دول طريق صاحب المشروع القديم للرفع الجماعي.
- لو احتجنا رفع جماعي ضخم بعدين (آلاف المنتجات): الاستوديو بيطلّع «صدّر الشيت» — ممكن نخليه بصيغة الـ WooCommerce add-on
  (SKU كمفتاح، `parent_sku` للتركيبات، روابط صور) ويترفع من WP All Import؛ قرار جديد في خطته وقتها.
- للمراجعة/المقارنة: تصدير CSV للمنتجات من WP All Export مرجع كويس لمطابقة المرآة `products` (الأعمدة: ID, SKU, الحالة، الأسعار، المخزون،
  الأقسام، الصور، `translation`/WPML lang).
- الصور في WP All Import بتيجي من URL أو من مكتبة الوسائط بالاسم؛ عندنا بتترفع من bucket `studio` على `wp/v2/media` مباشرة.
