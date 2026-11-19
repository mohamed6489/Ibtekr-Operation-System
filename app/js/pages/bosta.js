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

  // the pickup day (the owner 19 Nov — «اظهرلي شكل ال calendar اختار منه مع اختيارات سريعة زي النهاردة و بكرة و بعده»): today in
  // Cairo, quick days from it, and the window the server takes (today to 30 days on). Bosta's API has no endpoint for its working days
  // (the plugin 4.5.7 uses a plain date input too), so a day Bosta does not pick up on comes back as its refusal.
  const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const cairo = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Cairo' }));
  function dayAt(i) { const b = cairo(); return ymd(new Date(b.getFullYear(), b.getMonth(), b.getDate() + i)); }
  const QUICK = [[0, 'النهارده'], [1, 'بكرة'], [2, 'بعد بكرة']];
  const short = (iso) => { const [, m, d] = iso.split('-').map(Number); return d + '/' + m; };
  function dayField(f, e, set) {
    const chips = h('div', { class: 'chips-row', 'data-bp-days': '', style: 'display:flex;gap:6px;flex-wrap:wrap;margin-top:6px' },
      QUICK.map(([i, name]) => { const v = dayAt(i); return h('button', { type: 'button', class: 'chip-b', 'aria-pressed': f.date === v ? 'true' : 'false', 'data-bp-day': String(i), onClick: () => set('date', v, true) }, name + ' ' + short(v)); }));
    return h('div', null, K.field.date('date', 'يوم الاستلام', f, e, set), chips);
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
    const start = { location: last ? last.location_id : byName ? byName.id : '', warehouse: r.warehouse, date: dayAt(1), slot: SLOTS[0].value, receiver: r.receiver || '', phone: r.phone || '', n: 1, wn0: '', wp0: '1', orders: '' };
    const label = (l) => l.name + (l.city ? ' — ' + l.city + (l.district ? '، ' + l.district : '') : '');
    const whOf = (id) => locs.find((l) => l.id === id);
    const ids = (t) => [...new Set((String(t || '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).match(/\d{3,12}/g) || []))];
    // 0145 (the owner 19 Nov): several waybills in one pickup — rows to the warehouse (cash 0, a note: the order numbers coming, and the
    // cartons) and orders typed by their numbers that go to their customers straight from the maker
    const rowsOf = (f) => Array.from({ length: f.n }, (_, i) => ({ note: String(f['wn' + i] || '').trim(), parcels: f['wp' + i] }));
    const drop = (f, k, set) => { for (let i = k; i < f.n - 1; i += 1) { f['wn' + i] = f['wn' + (i + 1)]; f['wp' + i] = f['wp' + (i + 1)]; } delete f['wn' + (f.n - 1)]; delete f['wp' + (f.n - 1)]; set('n', f.n - 1, true); };
    K.form({
      title: 'بيك أب من ' + (vendorName || 'المبتكر') + ' (بوسطة)', values: start, submitLabel: 'اطلب البيك أب', wide: true,
      note: (f) => h('p', { class: 't-small', style: 'margin:0 0 8px', 'data-bp-note': '' }, 'المندوب بيروح للمبتكر مرة واحدة ويستلم كل البوليصات: اللي جاية المخزن (التحصيل 0)' + (whOf(f.warehouse) ? ' على ' + label(whOf(f.warehouse)) : '') + '، واللي رايحة للعميل على طول (التحصيل = الإجمالي − العربون). وبعدها بتطبعهم كلهم مرة واحدة.'),
      fields: (f, e, set) => {
        const rows = [];
        for (let i = 0; i < f.n; i += 1) {
          rows.push(h('div', { class: 'row', 'data-bp-row': String(i), style: 'display:grid;grid-template-columns:1fr 120px auto;gap:8px;align-items:end' },
            K.field.text('wn' + i, 'بوليصة ' + (i + 1) + ' — الملاحظة (أرقام الأوردرات اللي جاية)', f, e, set),
            K.field.text('wp' + i, 'الكراتين', f, e, set, { inputmode: 'numeric' }),
            U.Button({ label: 'شيل', type: 'text', onClick: () => drop(f, i, set) })));
        }
        return [
          K.field.select('location', 'عنوان المبتكر على بوسطة', [{ value: '', label: '— اختار —' }].concat(locs.filter((l) => l.id !== f.warehouse).map((l) => ({ value: l.id, label: label(l) }))), f, e, set),
          admin ? K.field.select('warehouse', 'المخزن (اللي بوليصات المخزن رايحاله)', locs.map((l) => ({ value: l.id, label: label(l) })), f, e, (k, v) => set(k, v, true)) : null,
          K.two(dayField(f, e, set), K.field.select('slot', 'الميعاد', SLOTS, f, e, set)),
          h('h4', { class: 't-h4', style: 'margin:12px 0 4px' }, 'بوليصات للمخزن (التحصيل 0)'),
          ...rows,
          f.n < 10 ? U.Button({ label: '+ بوليصة للمخزن', onClick: () => { f['wn' + f.n] = ''; f['wp' + f.n] = '1'; set('n', f.n + 1, true); } }) : null,
          f.n ? K.two(K.field.text('receiver', 'اسم المستلم في المخزن', f, e, set), K.field.text('phone', 'موبايل المستلم', f, e, set, { dir: 'ltr', inputmode: 'tel' })) : null,
          h('h4', { class: 't-h4', style: 'margin:12px 0 4px' }, 'بوليصات للعميل على طول'),
          K.field.text('orders', 'أرقام الأوردرات (افصل بينهم بمسافة)', f, e, set, { dir: 'ltr', placeholder: '181668 181670', help: 'كل أوردر بوليصة باسم العميل وعنوانه، والتحصيل = الإجمالي − العربون' }),
          admin && f.n ? h('label', { class: 'check', style: 'display:flex;gap:8px;align-items:center;margin-top:4px' }, h('input', { type: 'checkbox', 'data-bp-default': '', checked: !!f.asDefault, onChange: (ev) => { f.asDefault = ev.target.checked; } }), 'احفظ المخزن والمستلم كافتراضي') : null,
        ].filter(Boolean);
      },
      validate: (f) => {
        const er = {};
        if (!f.location) er.location = FIELD.location;
        rowsOf(f).forEach((rw, i) => {
          const n = Number(rw.parcels); if (!(Number.isInteger(n) && n >= 1 && n <= 99)) er['wp' + i] = FIELD.parcels;
          if (/[<>]/.test(rw.note)) er['wn' + i] = FIELD.note;
        });
        if (f.n) {
          if (String(f.receiver || '').trim().length < 2) er.receiver = FIELD.receiver;
          if (!/^(\+?20|0)?1\d{9}$/.test(String(f.phone || '').replace(/[\s-]/g, ''))) er.phone = FIELD.phone;
        }
        if (!f.date || f.date < dayAt(0) || f.date > dayAt(30)) er.date = FIELD.date;
        if (!f.n && !ids(f.orders).length) er.orders = 'زوّد بوليصة للمخزن أو اكتب رقم أوردر';
        if (ids(f.orders).length > 30) er.orders = '30 أوردر بالكتير في البيك أب';
        return er;
      },
      submit: (f, m) => {
        m._busy = true;
        (async () => {
          if (admin && f.n && (f.asDefault || f.warehouse !== r.warehouse)) {
            const sv = await S().save('bosta', { warehouse: f.warehouse, receiver: f.asDefault ? String(f.receiver).trim() : r.receiver, phone: f.asDefault ? String(f.phone).trim() : r.phone });
            if (sv && sv.ok === false) { m._busy = false; K.toast('معرفناش نحفظ المخزن — جرّب تاني', 'error'); return; }
          }
          const bb = K.busy('بنعمل البوليصات ونطلب المندوب…');
          const res = await O().bostaPickup({ vendorId, location: f.location, date: f.date, slot: f.slot, receiver: String(f.receiver || '').trim(), phone: String(f.phone || '').trim(), warehouse: rowsOf(f).map((rw) => ({ note: rw.note, parcels: Number(rw.parcels) })), orders: ids(f.orders).join(' ') });
          m._busy = false;
          if (!res || (!res.ok && !res.partial && !(res.deliveries && res.deliveries.length))) { bb.fail(res && res.field ? FIELD[res.field] || WHY.invalid : WHY[res && res.reason] || (res && res.message) || 'بوسطة رفضت الطلب'); return; }
          bb.close(); m.close(); done(res, vendorName);
        })();
        return false;
      },
    });
  }
  const WHY_ROW = { already: 'متبعت لبوسطة قبل كده', missing: 'الأوردر مش موجود', no_name: 'مفيش اسم للعميل', no_phone: 'مفيش رقم موبايل صحيح', no_address: 'مفيش عنوان', short_address: 'العنوان أقل من 10 حروف', no_city: 'مفيش محافظة ولا منطقة معروفة لبوسطة', refused: 'بوسطة رفضت', unreachable: 'بوسطة مارديتش', bad_key: 'مفتاح بوسطة غلط', no_warehouse: 'مفيش عنوان مخزن' };
  function done(res, vendorName) {
    const list = res.deliveries || []; const okN = list.filter((d) => d.delivery).length;
    const head = res.ok ? 'البيك أب اتطلب — ' + okN + ' بوليصة' : okN ? 'البوليصات اتعملت والبيك أب لأ' : 'مفيش بوليصة اتعملت';
    const line = (d) => h('li', { 'data-bp-waybill': d.kind + ':' + (d.order_id || ''), 'data-bp-ok': d.delivery ? '1' : '0' },
      d.kind === 'order' ? 'للعميل — أوردر ' + d.order_id : 'للمخزن' + (d.note ? ' — ' + d.note : ''),
      d.delivery ? h('span', null, ' · ', h('b', { dir: 'ltr' }, d.tracking || 'اتعملت'), d.kind === 'order' ? ' · التحصيل ' + (d.cod || 0) : '') : h('span', { style: 'color:var(--color-error-text,#8e0a07)' }, ' · ' + (WHY_ROW[d.error] || d.message || d.error || 'ماتعملتش')));
    const m = U.Modal({ title: head, body: [
      h('div', { 'data-bp-done': res.ok ? 'ok' : 'partial' },
        h('p', { class: 't-body' }, res.ok ? 'بوسطة هتبعت المندوب يستلم من ' + (vendorName || 'المبتكر') + ' في الميعاد.' : okN ? 'البوليصات اتعملت على بوسطة بس طلب المندوب ماتسجلش' + (res.message ? ' (' + res.message + ')' : '') + ' — اطلبه من بوسطة أو جرّب تاني.' : 'ولا بوليصة اتعملت — شوف السبب جنب كل واحدة.'),
        h('ul', { class: 'dlist' }, ...list.map(line))),
    ], footer: [U.Button({ label: 'إغلاق', onClick: () => m.close() }), okN ? U.Button({ type: 'primary', label: 'اطبع البوليصات (' + okN + ')', onClick: () => print({ pickups: [res.id] }) }) : null].filter(Boolean) });
  }

  window.IBBosta = { print, pickup, openPdf };
})();
