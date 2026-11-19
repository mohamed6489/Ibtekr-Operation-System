// Bosta from the system, part 2 (the owner 19 Nov — «نعرف نعملها طباعة من السيستم علطول؟ … و لو فيه امكانية نعمل بيك اب من السيستم
// للفيندور علطول من غير ما افتح بوسطة … و نطبع بوليصة من السيستم تبقي بعنوان المخزن و باسم مدير التشغيل و ممكن اغير الاسم و اكتب
// الملاحظة»; 0144, plan docs/superpowers/plans/2026-11-19-orders-batch.md decisions 15–17). Not a block.
//   IBBosta.print({ ids, pickups })   the waybills of orders / maker pickups as one PDF (Bosta's own, Arabic) — opened to print
//   IBBosta.pickup({ vendorId, vendorName })   «بيك أب من المبتكر»: the maker's Bosta location → a delivery to the warehouse (the
//     operations manager by default, the name and the note editable, cash 0) + the courier's visit on a day; then «اطبع البوليصة»
// The writes go through IBOrders (woo-sync bosta_awb / bosta_locations / bosta_pickup); the warehouse and the receiver by default are
// the settings «bosta» (the admin saves them from this popup).
(function () {
  'use strict';
  const U = window.IBUI, K = window.IBKit; const { h } = U;
  const O = () => window.IBOrders; const S = () => window.IBSettings;
  const WHY = { no_key: 'مفتاح بوسطة مش متحط — حطه من «الإعدادات › الربط بالمنصات › بوسطة»', forbidden: 'مالكش صلاحية على بوسطة', no_delivery: 'المحدد لسه ماتبعتش لبوسطة', no_warehouse: 'مفيش عنوان مخزن على بوسطة — اختاره هنا الأول', invalid: 'البيانات ناقصة', network: 'بوسطة مارديتش — جرّب تاني' };
  const FIELD = { location: 'اختار عنوان المبتكر على بوسطة', date: 'اختار يوم من النهارده لـ 30 يوم', slot: 'اختار الميعاد', receiver: 'اكتب اسم المستلم', phone: 'رقم موبايل مصري صحيح', note: 'الملاحظة من غير < >', parcels: 'من 1 لـ 99' };
  const fold = (s) => String(s || '').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[^a-z0-9ء-ي]+/g, '');

  // the PDF in a new tab (opened on the click itself — a tab opened after the answer is blocked), else a download
  function openPdf(b64, win) {
    const bin = atob(b64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    if (win && !win.closed) { win.location.href = url; }
    else { const a = document.createElement('a'); a.href = url; a.download = 'bosta-awb.pdf'; document.body.append(a); a.click(); a.remove(); }
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  }
  async function print({ ids, pickups } = {}) {
    let win = null; try { win = window.open('', '_blank'); if (win) win.document.title = 'بوليصة بوسطة'; } catch (e) { win = null; }
    const b = K.busy('بنجيب البوليصة من بوسطة…');
    const r = await O().bostaAwb(ids || [], pickups || []);
    if (!r || !r.ok) { if (win) win.close(); b.fail(WHY[r && r.reason] || 'معرفناش نجيب البوليصة'); return r; }
    openPdf(r.pdf, win);
    b.done(r.missing && r.missing.length ? 'البوليصة جاهزة — ' + r.missing.length + ' أوردر لسه ماتبعتش لبوسطة' : 'البوليصة جاهزة');
    return r;
  }

  // the next 14 days (Cairo) as a list — today first
  function days() {
    const out = []; const base = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Cairo' }));
    for (let i = 0; i < 14; i += 1) {
      const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
      const v = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      const name = d.toLocaleDateString('ar-EG', { weekday: 'long' });
      out.push({ value: v, label: (i === 0 ? 'النهارده' : i === 1 ? 'بكرة' : name) + ' · ' + d.getDate() + '/' + (d.getMonth() + 1) });
    }
    return out;
  }
  const SLOTS = [{ value: '10:00 to 13:00', label: '10 الصبح – 1 الضهر' }, { value: '13:00 to 16:00', label: '1 الضهر – 4 العصر' }];

  async function pickup({ vendorId, vendorName } = {}) {
    const b = K.busy('بنجيب عناوين بوسطة…');
    const [r, past] = await Promise.all([O().bostaLocations(), vendorId ? O().bostaPickups(vendorId) : Promise.resolve([])]);
    if (!r || !r.ok) { b.fail(WHY[r && r.reason] || 'معرفناش نقرا عناوين بوسطة'); return; }
    b.close();
    const locs = r.locations || [];
    const admin = !!(S() && S().can && S().can().admin);
    // the maker's location: his last pickup, else his name in Bosta's location names
    const last = (past || []).find((p) => locs.some((l) => l.id === p.location_id));
    const byName = vendorName ? locs.find((l) => fold(l.name) && (fold(l.name).includes(fold(vendorName)) || fold(vendorName).includes(fold(l.name)))) : null;
    const start = { location: last ? last.location_id : byName ? byName.id : '', warehouse: r.warehouse, date: days()[1].value, slot: SLOTS[0].value, receiver: r.receiver || '', phone: r.phone || '', note: '', parcels: '1' };
    const label = (l) => l.name + (l.city ? ' — ' + l.city + (l.district ? '، ' + l.district : '') : '');
    const whOf = (id) => locs.find((l) => l.id === id);
    K.form({
      title: 'بيك أب من ' + (vendorName || 'المبتكر') + ' (بوسطة)', values: start, submitLabel: 'اطلب البيك أب',
      note: (f) => h('p', { class: 't-small', style: 'margin:0 0 8px', 'data-bp-note': '' }, 'بوسطة بتعمل شحنة من عنوان المبتكر لعنوان المخزن باسم المستلم ده وملاحظتك والتحصيل 0، وبتبعت المندوب يستلمها في اليوم والميعاد اللي هتختارهم — والبوليصة بتتطبع من هنا.' + (whOf(f.warehouse) ? ' المخزن: ' + label(whOf(f.warehouse)) + '.' : '')),
      fields: (f, e, set) => [
        K.field.select('location', 'عنوان المبتكر على بوسطة', [{ value: '', label: '— اختار —' }].concat(locs.filter((l) => l.id !== f.warehouse).map((l) => ({ value: l.id, label: label(l) }))), f, e, set),
        admin ? K.field.select('warehouse', 'المخزن (اللي الشحنة رايحاله)', locs.map((l) => ({ value: l.id, label: label(l) })), f, e, (k, v) => set(k, v, true)) : null,
        K.two(K.field.select('date', 'يوم الاستلام', days(), f, e, set), K.field.select('slot', 'الميعاد', SLOTS, f, e, set)),
        K.two(K.field.text('receiver', 'اسم المستلم في المخزن', f, e, set), K.field.text('phone', 'موبايل المستلم', f, e, set, { dir: 'ltr', inputmode: 'tel' })),
        K.two(K.field.text('parcels', 'عدد الكراتين', f, e, set, { inputmode: 'numeric' }), h('div')),
        K.field.area('note', 'ملاحظة على البوليصة', f, e, set, { rows: 2 }),
        admin ? h('label', { class: 'check', style: 'display:flex;gap:8px;align-items:center;margin-top:4px' }, h('input', { type: 'checkbox', 'data-bp-default': '', checked: !!f.asDefault, onChange: (ev) => { f.asDefault = ev.target.checked; } }), 'احفظ المخزن والمستلم كافتراضي') : null,
      ].filter(Boolean),
      validate: (f) => {
        const er = {};
        if (!f.location) er.location = FIELD.location;
        if (String(f.receiver || '').trim().length < 2) er.receiver = FIELD.receiver;
        if (!/^(\+?20|0)?1\d{9}$/.test(String(f.phone || '').replace(/[\s-]/g, ''))) er.phone = FIELD.phone;
        const n = Number(f.parcels); if (!(Number.isInteger(n) && n >= 1 && n <= 99)) er.parcels = FIELD.parcels;
        if (/[<>]/.test(f.note || '')) er.note = FIELD.note;
        return er;
      },
      submit: (f, m) => {
        m._busy = true;
        (async () => {
          if (admin && (f.asDefault || f.warehouse !== r.warehouse)) {
            const sv = await S().save('bosta', { warehouse: f.warehouse, receiver: f.asDefault ? String(f.receiver).trim() : r.receiver, phone: f.asDefault ? String(f.phone).trim() : r.phone });
            if (sv && sv.ok === false) { m._busy = false; K.toast('معرفناش نحفظ المخزن — جرّب تاني', 'error'); return; }
          }
          const bb = K.busy('بنطلب البيك أب من بوسطة…');
          const res = await O().bostaPickup({ vendorId, location: f.location, date: f.date, slot: f.slot, receiver: String(f.receiver).trim(), phone: String(f.phone).trim(), note: String(f.note || '').trim(), parcels: Number(f.parcels) });
          m._busy = false;
          if (!res || (!res.ok && !res.partial)) { bb.fail(res && res.field ? FIELD[res.field] || WHY.invalid : WHY[res && res.reason] || (res && res.message) || 'بوسطة رفضت الطلب'); return; }
          bb.close(); m.close(); done(res, vendorName);
        })();
        return false;
      },
    });
  }
  function done(res, vendorName) {
    const ok = res.ok;
    const m = U.Modal({ title: ok ? 'البيك أب اتطلب' : 'الشحنة اتعملت والبيك أب لأ', body: [
      h('div', { 'data-bp-done': ok ? 'ok' : 'partial' },
        h('p', { class: 't-body' }, ok ? 'بوسطة هتبعت المندوب يستلم من ' + (vendorName || 'المبتكر') + ' في الميعاد.' : 'الشحنة اتعملت على بوسطة بس طلب المندوب ماتسجلش' + (res.message ? ' (' + res.message + ')' : '') + ' — اطلبه من بوسطة أو جرّب تاني.'),
        res.tracking ? h('p', { class: 't-body' }, 'رقم التتبع: ', h('b', { dir: 'ltr' }, res.tracking)) : null),
    ], footer: [U.Button({ label: 'إغلاق', onClick: () => m.close() }), U.Button({ type: 'primary', label: 'اطبع البوليصة', onClick: () => print({ pickups: [res.id] }) })] });
  }

  window.IBBosta = { print, pickup, openPdf };
})();
