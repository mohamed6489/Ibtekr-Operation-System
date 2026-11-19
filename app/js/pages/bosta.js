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
  const FIELD = { location: 'اختار عنوان المبتكر على بوسطة', date: 'اختار يوم من التلات أيام الجاية', slot: 'اختار الميعاد', receiver: 'اكتب اسم المستلم', phone: 'رقم موبايل مصري صحيح', note: 'الملاحظة من غير < >', parcels: 'من 1 لـ 99' };
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

  // the pickup day — Bosta's own way (the owner 19 Nov, with Bosta's «جدولة استلام» screen: «البيك اب بيتعمل ل 3 ايام بس و الجمعة اجازة
  // دايما و مفيش الميعاد»): the next three days from tomorrow (Cairo), Friday never, as three buttons; no time slot is asked (the request
  // keeps the plugin's first slot). Bosta's API has no working-days endpoint, so a holiday it refuses comes back as its message.
  const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const cairo = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Cairo' }));
  function pickDays() {
    const b = cairo(); const out = [];
    for (let i = 1; out.length < 3 && i < 10; i += 1) {
      const d = new Date(b.getFullYear(), b.getMonth(), b.getDate() + i);
      if (d.getDay() === 5) continue; // Friday — Bosta's day off
      out.push({ value: ymd(d), label: d.toLocaleDateString('ar-EG', { weekday: 'long' }) + '، ' + d.getDate() + '/' + (d.getMonth() + 1) });
    }
    return out;
  }
  function dayField(f, e, set) {
    return h('div', { class: 'field' }, h('label', { class: 't-label' }, 'يوم الاستلام'),
      h('div', { role: 'radiogroup', 'aria-label': 'يوم الاستلام', 'data-bp-days': '', style: 'display:grid;grid-template-columns:repeat(3,1fr);border:1px solid var(--color-border-subtle);border-radius:8px;overflow:hidden;margin-top:6px' },
        pickDays().map((d, i) => h('button', { type: 'button', role: 'radio', class: 'bp-day', 'aria-checked': f.date === d.value ? 'true' : 'false', 'data-bp-day': String(i), 'data-day': d.value, onClick: () => set('date', d.value, true),
          style: 'min-height:44px;border:0;' + (i ? 'border-inline-start:1px solid var(--color-border-subtle);' : '') + 'font:inherit;cursor:pointer;' + (f.date === d.value ? 'background:var(--color-brand-subtle-bg);color:var(--color-brand-default);font-weight:700' : 'background:var(--color-bg-base);color:var(--color-text-primary)') }, d.label))),
      e.date ? h('div', { class: 'err', role: 'alert' }, e.date) : null);
  }
  // the orders going to their customers as tags (the owner 19 Nov — «لما اكتب اول كام رقم يجبلي اقتراحات + لما ادوس enter يكتبلي الاوردر
  // ف شكل تاب خضرا و جمبها اكس اقدر اشيله»): f.orders stays the numbers with spaces (what the server reads); what is typed and not
  // turned into a tag yet (f.ordersDraft) counts too. Suggestions: the loaded orders still open and not on Bosta, the maker's first.
  const CLOSED = ['مكتمل', 'ملغي', 'استرجاع', 'فشل'];
  const digits = (t) => String(t || '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  function suggestions(q, taken, vendorId) {
    const d = O() && O().data && O().data(); if (!d || !q) return [];
    return (d.orders || []).filter((o) => o.id.includes(q) && !taken.includes(o.id) && !o.trk && !o.bdl && !CLOSED.includes(o.st))
      .map((o) => ({ o, mine: !!vendorId && (o.subs || []).some((x) => x.vendorId === String(vendorId)), pre: o.id.startsWith(q) }))
      .sort((a, b) => (b.mine - a.mine) || (b.pre - a.pre) || (Number(b.o.id) - Number(a.o.id))).slice(0, 6).map((x) => x.o);
  }
  function ordersField(f, e, set, vendorId, idsOf) {
    const tags = idsOf(f.orders);
    const put = (list) => { f.ordersDraft = ''; set('orders', list.join(' '), true); };
    const add = (id) => { if (/^\d{3,12}$/.test(id) && !tags.includes(id)) put(tags.concat(id)); else put(tags); };
    const input = h('input', { id: 'orders', type: 'text', inputmode: 'numeric', dir: 'ltr', autocomplete: 'off', value: f.ordersDraft || '', placeholder: tags.length ? '' : 'اكتب رقم الأوردر واضغط Enter', 'aria-invalid': e.orders ? 'true' : false,
      style: 'flex:1;min-width:120px;border:0;outline:0;background:transparent;font:inherit;padding:4px 0' });
    const list = h('div', { role: 'listbox', 'data-bp-sug': '', hidden: '', style: 'border:1px solid var(--color-border-subtle);border-radius:8px;background:var(--color-bg-base);margin-top:4px;overflow:hidden' });
    const draw = () => {
      const q = digits(input.value).replace(/\D/g, '');
      const sug = q.length >= 2 ? suggestions(q, tags, vendorId) : [];
      list.replaceChildren(...sug.map((o) => h('button', { type: 'button', role: 'option', 'data-bp-sug-id': o.id, onMousedown: (ev) => { ev.preventDefault(); add(o.id); },
        style: 'display:flex;justify-content:space-between;gap:12px;width:100%;padding:8px 12px;border:0;background:transparent;font:inherit;cursor:pointer;text-align:start' },
        h('b', { dir: 'ltr' }, o.id), h('span', { class: 't-small', style: 'color:var(--color-text-secondary)' }, (o.name || '') + (o.stateName ? ' · ' + o.stateName : '')))));
      list.hidden = !sug.length;
    };
    input.addEventListener('input', () => {
      const v = digits(input.value);
      if (/[\s,،]/.test(v)) { const parts = v.split(/[\s,،]+/); const last = parts.pop(); const more = parts.map((x) => x.replace(/\D/g, '')).filter((x) => /^\d{3,12}$/.test(x) && !tags.includes(x)); f.ordersDraft = last; if (more.length) { set('orders', [...new Set(tags.concat(more))].join(' '), true); return; } input.value = last; }
      f.ordersDraft = input.value; draw();
    });
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); const first = list.hidden ? null : list.querySelector('[data-bp-sug-id]'); const v = digits(input.value).replace(/\D/g, ''); add(first && !tags.includes(v) && !/^\d{3,12}$/.test(v) ? first.dataset.bpSugId : v); }
      else if (ev.key === 'Backspace' && !input.value && tags.length) { ev.preventDefault(); put(tags.slice(0, -1)); }
      else if (ev.key === 'Escape' && !list.hidden) { ev.stopPropagation(); list.hidden = true; }
    });
    input.addEventListener('blur', () => { list.hidden = true; });
    if (!O().data || !O().data()) { try { Promise.resolve(O().load({ quiet: true })).then(draw, () => {}); } catch (err) { /* the suggestions wait for the orders */ } }
    const chips = tags.map((id) => h('span', { class: 'bp-tag', 'data-bp-tag': id, style: 'display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 4px 0 10px;border-radius:999px;background:var(--color-brand-default);color:var(--color-text-on-brand);font-weight:600' },
      h('span', { dir: 'ltr' }, id), h('button', { type: 'button', 'aria-label': 'شيل ' + id, 'data-bp-untag': id, onClick: () => put(tags.filter((x) => x !== id)), style: 'width:22px;height:22px;border:0;border-radius:999px;background:transparent;color:inherit;cursor:pointer;font-size:16px;line-height:1' }, '×')));
    const box = h('div', { class: 'input' + (e.orders ? ' err' : ''), style: 'display:flex;flex-wrap:wrap;gap:6px;align-items:center;height:auto;min-height:44px;padding:6px 8px', onClick: () => input.focus() }, ...chips, input);
    return h('div', { class: 'field', 'data-bp-orders': '' }, h('label', { class: 't-label', for: 'orders' }, 'أرقام الأوردرات'), box, list,
      e.orders ? h('div', { class: 'err', role: 'alert' }, e.orders) : h('div', { class: 'help t-small' }, 'اكتب أول كام رقم واختار من الاقتراحات أو اضغط Enter — كل أوردر بوليصة باسم العميل وعنوانه، والتحصيل = الإجمالي − العربون'));
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
    const start = { location: last ? last.location_id : byName ? byName.id : '', warehouse: r.warehouse, date: pickDays()[0].value, slot: SLOTS[0].value, receiver: r.receiver || '', phone: r.phone || '', n: 1, wn0: '', wp0: '1', orders: '', ordersDraft: '' };
    const label = (l) => l.name + (l.city ? ' — ' + l.city + (l.district ? '، ' + l.district : '') : '');
    const whOf = (id) => locs.find((l) => l.id === id);
    const allOrders = (f) => String(f.orders || '') + ' ' + String(f.ordersDraft || '');
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
          dayField(f, e, set),
          h('h4', { class: 't-h4', style: 'margin:12px 0 4px' }, 'بوليصات للمخزن (التحصيل 0)'),
          ...rows,
          f.n < 10 ? U.Button({ label: '+ بوليصة للمخزن', onClick: () => { f['wn' + f.n] = ''; f['wp' + f.n] = '1'; set('n', f.n + 1, true); } }) : null,
          f.n ? K.two(K.field.text('receiver', 'اسم المستلم في المخزن', f, e, set), K.field.text('phone', 'موبايل المستلم', f, e, set, { dir: 'ltr', inputmode: 'tel' })) : null,
          h('h4', { class: 't-h4', style: 'margin:12px 0 4px' }, 'بوليصات للعميل على طول'),
          ordersField(f, e, set, vendorId, ids),
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
        if (!pickDays().some((d) => d.value === f.date)) er.date = FIELD.date;
        if (!f.n && !ids(allOrders(f)).length) er.orders = 'زوّد بوليصة للمخزن أو اكتب رقم أوردر';
        if (ids(allOrders(f)).length > 30) er.orders = '30 أوردر بالكتير في البيك أب';
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
          const res = await O().bostaPickup({ vendorId, location: f.location, date: f.date, slot: f.slot, receiver: String(f.receiver || '').trim(), phone: String(f.phone || '').trim(), warehouse: rowsOf(f).map((rw) => ({ note: rw.note, parcels: Number(rw.parcels) })), orders: ids(allOrders(f)).join(' ') });
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
      d.delivery ? h('span', null, ' · ', h('b', { dir: 'ltr' }, d.tracking || 'اتعملت'), d.existing ? h('span', { 'data-bp-existing': '' }, ' · متبعتة قبل كده — نفس البوليصة') : d.kind === 'order' ? ' · التحصيل ' + (d.cod || 0) : '') : h('span', { style: 'color:var(--color-error-text,#8e0a07)' }, ' · ' + (WHY_ROW[d.error] || d.message || d.error || 'ماتعملتش')));
    const m = U.Modal({ title: head, body: [
      h('div', { 'data-bp-done': res.ok ? 'ok' : 'partial' },
        h('p', { class: 't-body' }, res.ok ? 'بوسطة هتبعت المندوب يستلم من ' + (vendorName || 'المبتكر') + ' في الميعاد.' : okN ? 'البوليصات اتعملت على بوسطة بس طلب المندوب ماتسجلش' + (res.message ? ' (' + res.message + ')' : '') + ' — اطلبه من بوسطة أو جرّب تاني.' : 'ولا بوليصة اتعملت — شوف السبب جنب كل واحدة.'),
        h('ul', { class: 'dlist' }, ...list.map(line))),
    ], footer: [U.Button({ label: 'إغلاق', onClick: () => m.close() }), okN ? U.Button({ type: 'primary', label: 'اطبع البوليصات (' + okN + ')', onClick: () => print({ pickups: [res.id] }) }) : null].filter(Boolean) });
  }

  window.IBBosta = { print, pickup, openPdf };
})();
