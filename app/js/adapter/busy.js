// «بيحصل إيه دلوقتي» (the owner, 11 Nov — «اي اكشن ف السيستم بيتعمله تحميل او بيقولي استني … يظهرلي popup notification يعرفني اي
// اللي بيحصل»): every Edge Function call and Storage upload the member started — a click, a key (Enter / Space), a change or a
// submit up to GESTURE_MS before, or a call chained right after one — shows the kit's busy pill (IBKit.busy, bottom centre) saying
// what is happening, once it takes longer than the delay (a quick answer never flashes). One pill per label, shared by the calls in
// flight under it (a batch of requests keeps one pill), closed when they are all answered. Background calls (polling, status reads,
// the chat panels that draw their own typing) never show one, and a page that shows its own pill (IBKit.busyCount() above the pills
// shown here) is left alone. The wrapping is on supabase-js's prototypes (FunctionsClient.invoke — `client.functions` is a new
// object at every read — and StorageFileApi.upload / uploadToSignedUrl); the adapters' calls and answers are untouched.
// labelOf(fn, body) is pure: the Arabic line for an action, or null when it shows nothing.
// From 15 Nov every other request of the client is covered too (requestLabel / IBBusy.fetch, at the end of this file).
(function () {
  'use strict';
  // woo-sync: the site / Dokan
  const WOO = {
    push_status: 'بنحدّث حالة الأوردر على الموقع…', order_trash: 'بنمسح الأوردر من الموقع…', suborder_trash: 'بنمسح الأوردر الفرعي من الموقع…',
    line_trash: 'بنشيل المنتج من الأوردر على الموقع…', line_qty: 'بنعدّل الكمية على الموقع…', line_add: 'بنضيف المنتج على الأوردر على الموقع…', suborder_status: 'بنغيّر حالة الأوردر الفرعي على الموقع…', order_create: 'بنعمل الأوردر على الموقع…',
    order_pay_link: 'بنجيب لينك الدفع من الموقع…', push_vendor: 'بنحدّث بيانات المبتكر على Dokan…', vendor_photo: 'بنرفع صورة المبتكر…',
    statement: 'بنجيب كشف الحساب من Dokan…', thumbs: 'بنجهّز صور التقرير…', withdrawals: 'بنحدّث طلبات السحب من Dokan…', withdraw_approve: 'بنوافق على طلب السحب على Dokan…',
    withdraw_create: 'بنعمل طلب السحب على Dokan…', product_get: 'بنجيب المنتج من الموقع…', product_save: 'بنحفظ المنتج على الموقع…',
    products_batch: 'بنحدّث المنتجات على الموقع…', products_trash: 'بننقل المنتجات للمهملات على الموقع…', products_restore: 'بنرجّع المنتجات من المهملات…',
    products_vendor: 'بننقل المنتجات لمبتكر تاني…', product_images_add: 'بنحط الصور على المنتج…', product_duplicate: 'بنعمل نسخة من المنتج على الموقع…',
    category_create: 'بنعمل القسم على الموقع…', category_get: 'بنجيب القسم من الموقع…', category_update: 'بنعدّل القسم على الموقع…', category_order: 'بنحفظ ترتيب الأقسام على الموقع…', category_delete: 'بنحذف القسم من الموقع…', studio_upload: 'بنرفع المنتج على الموقع…', studio_sheet: 'بنقرا الشيت…', inventory_push: 'بنحدّث الكمية على الموقع…',
    vendors: 'بنزامن المبتكرين مع الموقع…', orders: 'بنزامن الأوردرات مع الموقع…', products: 'بنزامن المنتجات مع الموقع…', all: 'بنزامن كل حاجة مع الموقع…',
    accounts: 'بنحدّث حسابات Dokan…', categories: 'بنزامن الأقسام مع الموقع…', states: 'بنزامن المحافظات…', register_webhooks: 'بنسجّل الـ webhooks على الموقع…',
    carts: 'بنجيب السلل المتروكة…', probe_store: 'بنفحص الموقع…', probe_dokan: 'بنفحص Dokan…', probe_products: 'بنفحص المنتجات على الموقع…',
  };
  const ACTIONS = {
    'ai-content': { write: 'الذكاء الاصطناعي بيكتب…', studio: 'الذكاء الاصطناعي بيملا بيانات المنتجات…', prompts: 'الذكاء الاصطناعي بيكتب البرومبتات…', marketing: 'الذكاء الاصطناعي بيكتب…' },
    'ai-images': { generate: 'بنعمل الصورة…', create: 'بنعمل الصورة…', edit: 'بنعدّل الصورة…', campaign: 'بنعمل تصميم الكامبين…', campaign_edit: 'بنعدّل التصميم…',
      import: 'بنجيب الصور…', share: 'بنبعت الصور لـ Magnific…', bridge_upload: 'بنبعت الصور لـ Magnific…', bridge_fetch: 'بنجيب النتايج من Magnific…',
      bridge_flow: 'بنجهّز الفلو على Magnific…', bridge_campaign: 'بنبعت قطع الكامبين لـ Magnific…', bridge_campaign_fetch: 'بنجيب النتايج من Magnific…', bridge_prompts_sync: 'بنحدّث البرومبتات من الـ template…', bridge_link: 'بنربط حساب Magnific…', bridge_callback: 'بنربط حساب Magnific…',
      bridge_unlink: 'بنفصل حساب Magnific…', webp: 'بنجهّز الصورة…', video_clip: 'بنعمل مشهد الفيديو…', video_voice: 'بنعمل الفويس…', video_music: 'بنعمل الموسيقى…',
      video_upload: 'بنرفع الصوت…', video_assemble: 'بنجمّع الفيديو…' },
    'cs-channel': { send: 'بنبعت الرسالة…', comment_private: 'بنبعت الرد الخاص…', comment_hide: 'بنخفي التعليق…', connect_start: 'بنربط الصفحة…', connect_callback: 'بنربط الصفحة…',
      connect_pick: 'بنربط الصفحة…', disconnect: 'بنفصل القناة…', media_url: 'بنجيب الملف…' },
    'cs-whatsapp': { send: 'بنبعت الرسالة على واتساب…', campaign_test: 'بنبعت رسالة التجربة…', sync: 'بنزامن واتساب…', connect_start: 'بنربط واتساب…',
      connect_callback: 'بنربط واتساب…', disconnect: 'بنفصل واتساب…' },
    'cs-wa': { wa_logout: 'بنفصل واتساب…' },
    'mkt-publish': { publish_now: 'بننشر البوست…', delete: 'بنمسح البوست من المنصة…', autopublish: 'بنحفظ مفتاح النشر التلقائي…' },
    'mkt-ads': { sync: 'بنزامن أرقام الإعلانات…', decide: 'بننفّذ القرار…', live: 'بنحفظ مفتاح التنفيذ…', rules_set: 'بنحفظ القواعد…', link_set: 'بنربط حساب الإعلانات…',
      link_start: 'بنربط حساب الإعلانات…', link_callback: 'بنربط حساب الإعلانات…', link_pick: 'بنربط حساب الإعلانات…', unlink: 'بنفصل حساب الإعلانات…' },
    'settings-admin': { secret_set: 'بنحفظ المفتاح…', secret_test: 'بنجرّب المفتاح…', secret_unlink: 'بنشيل المفتاح…', woo_set: 'بنجرّب الموقع ونحفظه…', member_status: 'بنغيّر حالة العضو…' },
    'team-admin': { member_create: 'بنعمل حساب العضو…', member_delete: 'بنمسح العضو…', member_invite: 'بنبعت إيميل الباسورد…', member_password: 'بنعمل باسورد جديد…' },
    'cs-auto': { tick: 'بنشغّل الرد الآلي…' },
    notify: { tick: 'بنشغّل التنبيهات…' },
  };
  const BY_FN = { 'woo-sync': 'بنكلّم الموقع…', 'ai-content': 'الذكاء الاصطناعي بيشتغل…', 'ai-images': 'بنجهّز الصور…', 'cs-channel': 'بنكلّم ماسنجر وإنستجرام…',
    'cs-whatsapp': 'بنكلّم واتساب…', 'cs-wa': 'بنكلّم واتساب…', 'cs-auto': 'بنشغّل الرد الآلي…', 'mkt-publish': 'بنكلّم المنصات…', 'mkt-ads': 'بنكلّم منصات الإعلانات…',
    'settings-admin': 'بنحفظ الإعدادات…', 'team-admin': 'بنظبط حساب العضو…', notify: 'بنشغّل التنبيهات…' };
  // reads a page makes on its own (a status, a poll) and the chat panels with their own typing — never a pill
  const SKIP = new Set(['status', 'wa_status', 'bridge_status', 'video_poll', 'assistant', 'buyer', 'probe', 'check']);
  const UPLOAD = 'بنرفع الملف…';

  function labelOf(fn, body) {
    const a = body && typeof body === 'object' && typeof body.action === 'string' ? body.action : '';
    if (SKIP.has(a)) return null;
    if (fn === 'woo-sync') return WOO[a] || BY_FN[fn];
    const per = ACTIONS[fn];
    if (per && per[a]) return per[a];
    return BY_FN[fn] || null;
  }

  const READING = 'بنحمّل…', SAVING = 'بنحفظ…', WORKING = 'ثواني…', SIGNING = 'بندخّلك…', LEAVING = 'بنخرّجك…'; // the lines of the client's own requests (requestLabel)
  let DELAY_MS = 450; const GESTURE_MS = 2500, CHAIN_MS = 1500;
  let lastGesture = 0, lastPress = 0, chainUntil = 0, autoShown = 0;
  const now = () => Date.now();
  // a press (a click, a choice, a submit, Enter / Space) or typing (`input`): typing alone never makes a read the member's — a
  // poll that lands while he writes shows nothing; a save he typed (a field's own change) still does
  const mark = (e) => { lastGesture = now(); if (!e || e.type !== 'input') lastPress = lastGesture; };
  if (typeof document !== 'undefined' && document.addEventListener) {
    ['pointerdown', 'click', 'input', 'change', 'submit'].forEach((t) => document.addEventListener(t, mark, true)); // input crosses a shadow root, change does not
    document.addEventListener('keydown', (e) => { if (e && (e.key === 'Enter' || e.key === ' ')) mark(); }, true);
  }
  const userStarted = (pressOnly) => { const n = now(); return n - (pressOnly ? lastPress : lastGesture) < GESTURE_MS || n < chainUntil; };

  const pills = new Map(); // label → { n, handle, timer, closeT }
  function begin(label) {
    const K = window.IBKit;
    if (!K || typeof K.busy !== 'function') return () => {};
    let p = pills.get(label);
    if (!p) { p = { n: 0, handle: null, timer: 0, closeT: 0 }; pills.set(label, p); }
    clearTimeout(p.closeT); p.closeT = 0; p.n += 1;
    if (p.handle && p.handle.set) p.handle.set(label); // a call joining a shown pill keeps it alive (the kit closes a silent one)
    if (!p.handle && !p.timer) {
      p.timer = setTimeout(() => {
        p.timer = 0;
        const pageOwn = K.busyCount ? K.busyCount() - autoShown : 0; // a page showing its own pill is left alone
        if (p.n > 0 && !p.handle && pageOwn <= 0) { p.handle = K.busy(label); autoShown += 1; }
      }, DELAY_MS);
    }
    let ended = false;
    return () => {
      if (ended) return; ended = true;
      p.n -= 1; chainUntil = now() + CHAIN_MS;
      if (p.n > 0) return;
      if (p.timer) { clearTimeout(p.timer); p.timer = 0; }
      p.closeT = setTimeout(() => {
        if (p.n > 0) return;
        if (p.handle) { p.handle.close(); autoShown = Math.max(0, autoShown - 1); p.handle = null; }
        pills.delete(label);
      }, 300);
    };
  }
  // hush(promise): while it is pending nothing new shows a pill — the quiet reads behind the member's back (IBLive's reload after a
  // teammate's change) are not his action even when he clicked a moment before
  let hushed = 0;
  function hush(p) { hushed += 1; const off = () => { hushed = Math.max(0, hushed - 1); }; Promise.resolve(p).then(off, off); return p; }
  // run fn (the original call) under a pill when the member started it; the original promise's answer passes through unchanged
  // pressOnly: only a press makes the call the member's (a read — typing alone does not)
  function track(label, fn, pressOnly) {
    if (!label || hushed > 0 || !userStarted(!!pressOnly)) return fn();
    const end = begin(label);
    let r;
    try { r = fn(); } catch (e) { end(); throw e; }
    return Promise.resolve(r).finally(end);
  }

  function wrapProto(obj, names, labelFor) {
    const proto = obj && Object.getPrototypeOf(obj);
    if (!proto || proto.__ibBusy) return false;
    let done = false;
    for (const name of names) {
      const orig = proto[name];
      if (typeof orig !== 'function') continue;
      proto[name] = function (...args) { return track(labelFor(args), () => orig.apply(this, args)); };
      done = true;
    }
    if (done) Object.defineProperty(proto, '__ibBusy', { value: true });
    return done;
  }
  function wrap(client) {
    if (!client) return { functions: false, storage: false };
    let functions = false, storage = false;
    try { functions = wrapProto(client.functions, ['invoke'], (args) => labelOf(args[0], args[1] && args[1].body)); } catch (e) { functions = false; }
    try { storage = wrapProto(client.storage && client.storage.from('busy'), ['upload', 'uploadToSignedUrl'], () => UPLOAD); } catch (e) { storage = false; }
    return { functions, storage };
  }

  // The owner 15 Nov (docs/superpowers/plans/2026-11-15-preloader.md — «اي اكشن يف السيستم يتعمله loading»): every other request of
  // the Supabase client the member started — a read, a save, a sign-in — shows the pill the same way (after the delay, one per line).
  // requestLabel(url, method) is pure: the line, or null for what never shows one here — the Edge Functions and the uploads (they
  // have their own lines above), the session's own refresh, the Realtime line. supabase-client.js hands the client this fetch.
  function requestLabel(url, method) {
    const u = String(url || ''); const m = String(method || 'GET').toUpperCase();
    const at = u.indexOf('/rest/v1/');
    if (at >= 0) {
      if (u.indexOf('/rest/v1/rpc/', at) === at) return WORKING; // a function of the database: a read or a save — only it knows
      return m === 'GET' || m === 'HEAD' ? READING : SAVING;
    }
    const au = u.indexOf('/auth/v1/');
    if (au >= 0) {
      const path = u.slice(au + 9);
      if (path.indexOf('token') === 0) return /[?&]grant_type=password(&|$)/.test(path) ? SIGNING : null; // the refresh is the session's own
      if (path.indexOf('logout') === 0) return LEAVING;
      if (path.indexOf('user') === 0 && m !== 'GET') return SAVING; // the password, the e-mail
      if (path.indexOf('factors') === 0 && m !== 'GET') return WORKING; // 2FA: enrol, challenge, verify
      return null;
    }
    return null; // functions, storage, anything else
  }
  function trackedFetch(input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const method = (init && init.method) || (input && typeof input === 'object' && input.method) || 'GET';
    const base = requestLabel(url, method);
    // a read and a database function side by side (a page loading) share the line that is already up — one pill, not two
    const busyWith = (l) => { const p = pills.get(l); return !!p && p.n > 0; };
    const label = base === WORKING && busyWith(READING) ? READING : base === READING && busyWith(WORKING) ? WORKING : base;
    return track(label, () => fetch(input, init), base === READING);
  }

  const wrapped = wrap(window.IBSupabase && window.IBSupabase.client);
  window.IBBusy = { labelOf, requestLabel, fetch: trackedFetch, hush, wrap, wrapped, setDelay: (ms) => { DELAY_MS = Math.max(0, Number(ms) || 0); }, userStarted, mark, SKIP };
})();
