# WP All Import Pro / WP All Export Pro — مرجع (31 أكتوبر 2026)

صاحب المشروع بعت الإضافتين (zip) عشان نعرف إزاي البيانات بتترفع وتتنزّل على الموقع من غير السيستم. الكود اتدرس في الـ sandbox بس —
**مافيش أي حاجة منه في الريبو** (إضافات مدفوعة من Soflyy). النسخ: **WP All Import Pro 5.1.0** و**WP All Export Pro 1.9.15**.

## الخلاصة اللي تهمنا

- **الاتنين «النواة».** WP All Import Pro لوحده بيستورد Posts/Pages/أي Custom Post Type (+ taxonomies + custom fields + صور). **منتجات
  WooCommerce بسعرها وتركيباتها ومخزونها محتاجة الـ add-on المنفصل** `wpai-woocommerce-add-on` (أو النسخة المجانية
  `woocommerce-xml-csv-product-import`) — النواة نفسها بتوصي بيه لما WooCommerce شغّال؛ اتبعت بعدها وموصوف تحت. وكذلك WPML
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

## الـ WooCommerce Add-On (WP All Import – WooCommerce Import Add-On Pro 4.0.6)

صاحب المشروع بعته بعدها (31 أكتوبر) — ده اللي بيرفع المنتجات فعليًا. بيضيف قسم «WooCommerce» في قالب الاستيراد شكله زي شاشة المنتج:

- **الأنواع:** Simple / Variable / Grouped / External (+ Subscriptions). ولوحة أوردرات (`OrdersImporter`) كمان.
- **التابات والحقول:** General (SKU `single_product_sku`، سعر عادي وسعر تخفيض `single_product_regular_price` / `single_product_sale_price` مع
  تعديل بنسبة أو رقم `*_adjust` / `*_adjust_type` وجدولة التخفيض)، Inventory (`single_product_manage_stock`، `single_product_stock_qty`،
  `single_product_stock_status`، backorders، low stock، sold individually)، Shipping (وزن/أبعاد/shipping class)، Linked products،
  Attributes، Advanced (purchase note، menu order، reviews)، Variations.
- **الخصائص (Attributes):** اسم + قيم مفصولة بـ `|` (أو XPath)، مع مفاتيح **In Variations** / **Is Visible** / **Is Taxonomy** (ينشئ `pa_<name>`
  لو مش موجود، ويعمل الـ terms بـ Auto-Create Terms). ده المقابل لـ `pa_color` / `pa_size` / `pa_brand` اللي الاستوديو بيبعتهم.
- **التركيبات (Variable) — طريقة الربط `matching_parent`:**
  - `auto`: كل منتج Variable ليه SKU/معرّف فريد، وكل تركيبة بتتربط بالأب بـ **parent SKU** في عمود (`single_product_first_is_parent_id_parent_sku`)
    — **ده الشكل الأنسب لشيت من عندنا:** صف للأب + صف لكل تركيبة فيه `parent_sku`.
  - `first_is_parent_id`: قيمة مشتركة لكل تركيبات المنتج وفريدة لكل منتج.
  - `first_is_parent_title`: التركيبات بنفس عنوان الأب. · `first_is_variation`: كل الصفوف تركيبات بنفس العنوان ومافيش صف أب.
  - `xml`: التركيبات عناصر متداخلة جوه عنصر المنتج (ملف XML). · `existing`: ربط بمنتجات موجودة.
  - حقول التركيبة: `variable_sku` (+ `variable_sku_add_parent`)، `variable_regular_price` / `variable_sale_price`، `variable_stock`، `variable_image`،
    `variable_description`، وزن/أبعاد، وكل واحد ليه `*_use_parent` يورث من الأب.
- **المفتاح الفريد للتحديث:** SKU (أو ID) في خيارات WP All Import — بيحدّث المنتج والتركيبات بدل ما يكرر.
- **المبتكر (Dokan):** مافيش حقل Dokan في الـ add-on؛ المنتج بياخد **author** من قالب WP All Import العادي (`author` = user id/login
  بتاع المبتكر على WordPress)، والتركيبات بتورث `post_author` من الأب. (الاستوديو عندنا بيحط المبتكر عبر `PUT dokan/v1/products/{id}`.)
- **WPML:** مافيش ترجمات هنا — بس فلتر `wp_all_import_term_exists` عشان الـ terms تتلاقى باللغة الصح؛ الترجمة العربي للمنتج محتاجة
  **WPML Add-On** المنفصل (أو استيراد تاني بلغة ar مع ربط بالأصل). الاستوديو عندنا بيعمل الترجمة بـ WCML REST (`lang: 'ar'` + `translation_of`).
- **الصور:** من قالب WP All Import الأساسي (روابط أو مكتبة الوسائط)، وصورة التركيبة `variable_image`.

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
