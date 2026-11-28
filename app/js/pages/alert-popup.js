/* Ibtekr — an alert opened from the bell: one popup for every alert (Safwat 28 Nov — «الدوس علي اي تنبيه يفتح بوباب بالمعلومات اللي في
   التنبيه مايوديش علي صفحة تانية و يفضل كل البوب اب تطلع في نص الشاشة»; «حط زراير و خلي الاكشنز تفتح في نفس البواب و يبقا فيه زرار رجوع
   للتنبيه»; «لما ادوس علي تفاصيل الاوردر يخليه قابل للتعديل»; docs/superpowers/plans/2026-11-28-alert-popup.md). Not a block.
     IBAlertPopup.open(a, x) → the kit's Modal (centered, the page behind it untouched): the alert's head (its owner's mark, its level, its
       time), its card and what it is about — an order, a maker's late orders, a report's table, a conversation's last messages, an
       assistant's note — then its actions; an action opens INSIDE the same popup with «رجوع للتنبيه» (an order's details editable, a reply
       to the customer, the assistant's chat, the maker's order …), and a page only by «روح لصفحة …» (the member's own click).
       a = the alert (the adapter's row) or a maker's group ({ vendorLate, vendorId, kind, title, sub, chips }); x = { av, card, lv, lvWord,
       when, avEl(item), lateRows(vendor, kind), lateShare(vendor, kind), openVendor(id), showOrders(q), labelOf(hash), go(hash), report }.
   Nothing here writes but through the pages' own adapters (IBCS.send, OrdersApp.aiUpdate / patchSub, IBMarketing.agentAsk). */
(function () {
  'use strict';
  const U = () => window.IBUI; const h = (...a) => U().h(...a); const I = (n) => U().Icon(n, 'sm');
  const K = () => window.IBKit; const OA = () => window.OrdersApp;
  const toast = (t, k) => { if (K() && K().toast) K().toast(t, k); };
  const LV = { critical: ['حرج', 'c'], important: ['مهم', 'i'], normal: ['عادي', 'n'], info: ['للمعرفة', 'n'] };
  const sec = (title, ...kids) => h('section', { class: 'ap-sec' }, h('h3', null, title), h('div', { class: 'ap-in' }, ...kids.filter(Boolean)));
  const kv = (rows) => h('dl', { class: 'ap-kv' }, ...rows.filter(Boolean).flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)]));
  const chip = (t, tone) => h('span', { class: 'ap-chip ' + (tone || '') }, t);
  const DL = { late: ['متأخر', 'err'], risk: ['قابل للتأخير', 'warn'], ok: ['غير متأخر', 'ok'] };
  const digits = (p) => String(p || '').replace(/\D/g, '');
  const waOf = (p) => { const d = digits(p); return d.length >= 10 && !/•|\*/.test(String(p)) ? 'https://wa.me/' + (d.startsWith('0') ? '2' + d : d) : null; };
  const copy = (t, said) => { try { navigator.clipboard.writeText(String(t)).then(() => toast(said || 'اتنسخ', 'success'), () => toast('مقدرتش أنسخ — حدّده وانسخه', 'error')); } catch (e) { toast('مقدرتش أنسخ', 'error'); } };
  const phoneEl = (p) => (p ? h('span', { class: 'ap-ph' }, h('bdi', { dir: 'ltr' }, p),
    waOf(p) ? h('button', { type: 'button', class: 'ap-mini', 'data-ap-copy': '', onClick: () => copy(p, 'اتنسخ الرقم') }, 'نسخ') : null,
    waOf(p) ? h('a', { class: 'ap-mini', href: waOf(p), target: '_blank', rel: 'noopener' }, 'واتساب') : null) : '—');
  const orderOf = (entity) => { const m = /^orders\/([\w-]+)$/.exec(String(entity || '')); return m ? m[1].replace(/^IB-/i, '') : null; };
  const convOf = (entity) => { const m = /^cs\/([0-9a-f-]{36})$/i.exec(String(entity || '')); return m ? m[1] : null; };
  const noteOf = (a) => { const m = /^note:(\d+)$/.exec(String(a.entityId || '')); return m ? Number(m[1]) : null; };
  // «آخر التريندات» (0175 — the trends from free sources): the alert is a batch of new trends (entity_id «tr:<batch>»)
  const trendOf = (a) => { const m = /^tr:([0-9a-f-]{36})$/i.exec(String(a.entityId || '')); return m ? m[1] : null; };
  const TR_SRC = { youtube: 'يوتيوب', google: 'بحث جوجل', instagram: 'إنستجرام', tiktok: 'تيك توك', facebook: 'فيسبوك', web: 'موقع' };
  const n0 = (v) => Math.round(Number(v) || 0).toLocaleString('en-US');
  const trendList = (items, err) => (err ? [h('p', { class: 'ap-note' }, err)] : !items.length ? [h('p', { class: 'ap-note' }, 'التريندات دي مابقتش موجودة.')]
    : [h('ul', { class: 'ap-trends-l' }, items.slice(0, 20).map((r) => h('li', null, h('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer', 'data-ap-trend': r.platform }, h('b', null, r.title)),
      h('small', null, [TR_SRC[r.platform] || r.source, r.author, r.views != null ? n0(r.views) + ' مشاهدة' : r.likes != null ? n0(r.likes) + ' لايك' : '', r.kind === 'search' ? r.summary : ''].filter(Boolean).join(' · ')))))]);

  function open(a, x) {
    x = x || {}; if (U().closePopover) U().closePopover();
    const stack = []; let m = null;
    const title = String(a.title || (a.vendorLate ? a.vendorLate : 'تنبيه'));
    const lv = LV[x.lv] || null;
    const head = () => h('div', { class: 'ap-head' }, x.avEl ? x.avEl(Object.assign({ tone: 'neutral', icon: 'bell' }, x)) : null,
      h('span', { class: 'ap-ht' }, h('b', null, title), x.when ? h('small', null, x.when) : null), lv ? h('span', { class: 'ap-lv ' + lv[1] }, x.lvWord || lv[0]) : null);
    const back = () => h('button', { type: 'button', class: 'ap-back', 'data-ap-back': '', onClick: () => { stack.pop(); draw(); } }, I('chevR'), 'رجوع للتنبيه');
    const push = (name, fn) => { stack.push({ name, fn }); draw(); };
    // a page = a view saying where it goes; only its button leaves the popup
    const pageView = (hash, what) => () => [back(), h('div', { class: 'ap-go', 'data-ap-page': hash }, h('b', null, (x.labelOf && x.labelOf(hash)) || 'الصفحة'), h('span', null, what || 'هتتفتح الصفحة على الحاجة دي.'),
      h('span', { class: 'ap-note' }, 'الضغطة دي بس هي اللي بتقفل البوب أب وتفتح الصفحة.'),
      h('div', null, U().Button({ type: 'primary', label: 'روح للصفحة', attrs: { 'data-ap-goto': '' }, onClick: () => { m.close(); if (x.go) x.go(hash); } }))), null];

    // ---- an order: its facts, editable (the order page's own writes — a status that asks for a reason / a rating asks it the same way)
    const orderView = (id) => () => {
      const O = OA(); const o = O && O.get ? O.get(id) : null;
      if (!o) return [back(), U().InlineNote({ kind: 'info', children: 'الأوردر IB-' + id + ' مش في صفحة الأوردرات دلوقتي (اتقفل أو برّه الفترة).' }), null];
      const can = !!(window.IBDirectory && window.IBDirectory.perm && window.IBDirectory.perm('orders.status') === 'F');
      const sel = (id2, val, list, on) => { const s = h('select', { class: 'ap-sel', id: id2, disabled: !can }, list.map((v) => h('option', { value: v, selected: v === val }, v))); s.addEventListener('change', () => on(s.value, s)); return s; };
      const stList = (O.statuses ? O.statuses() : []).filter((s) => !['ملغي', 'استرجاع', 'فشل'].includes(s));
      if (o.st && !stList.includes(o.st)) stList.unshift(o.st);
      const stSel = sel('ap-st', o.stc || o.st, stList.includes(o.stc) ? stList : stList, (v, s) => { const r = O.aiUpdate({ id: o.id, status: v }); if (r !== true) { s.value = o.stc || o.st; } });
      const cfSel = sel('ap-cf', o.cf, O.confirms ? O.confirms() : [o.cf], (v, s) => { const r = O.aiUpdate({ id: o.id, confirm: v }); if (r !== true) s.value = o.cf; });
      const ssList = O.subStatuses ? O.subStatuses() : [];
      // Safwat 28 Nov («نحط صور المنتجات في تفاصيل الاوردرات و نراجع ان التصميم معمول بشكل منظم و احترافي»): the order's head with its
      // states, the money in one strip, the customer and the order side by side, and the products by sub-order — each with its picture
      const money = (v) => n0(v) + ' ج.م';
      const subsN = new Set(o.subs.map((s) => s.sid || s.vendor || '')).size;
      const strip = h('div', { class: 'ap-money', 'data-ap-money': '' }, [['الإجمالي', money(o.tot)], ['العربون', money(o.dep)], ['المتبقي', money(Math.max(0, (o.tot || 0) - (o.dep || 0))), 'hi'],
        ['الأوردرات الفرعية', String(subsN)]].map(([k, v, c]) => h('div', { class: 'ap-m' + (c ? ' ' + c : '') }, h('span', null, k), h('b', null, v))));
      const field = (k, v) => h('div', { class: 'ap-f' }, h('span', null, k), h('div', null, v));
      const cust = h('div', { class: 'ap-card' }, h('h4', null, I('users'), 'العميل'), field('الاسم', o.name || '—'), field('الموبايل', phoneEl(o.phone)),
        o.addr || o.city ? field('العنوان', [o.city, o.addr].filter(Boolean).join(' — ')) : null);
      const ord = h('div', { class: 'ap-card' }, h('h4', null, I('package'), 'الأوردر'), field('حالة الأوردر', stSel), field('التأكيد', cfSel),
        field('التاريخ', (o.date || '—') + ' · عمره ' + o.age + ' يوم'), can ? null : h('p', { class: 'ap-note' }, 'التعديل محتاج صلاحية تعديل حالة الأوردرات.'));
      const pic = (s) => { const u = O.thumb ? O.thumb(s.sku) : ''; return h('span', { class: 'ap-pic' }, u ? h('img', { src: u, alt: '', loading: 'lazy' }) : I('package')); };
      const line = (s) => h('div', { class: 'ap-line', 'data-ap-line': s.n }, pic(s),
        h('div', { class: 'ap-lt' }, h('b', null, s.prod || '—'), h('small', null, 'الكمية ' + s.qty + (s.tot != null ? ' · ' + money(s.tot) : '')), s.sku ? h('small', { class: 'ap-sku', dir: 'ltr' }, s.sku) : null),
        h('div', { class: 'ap-ls' }, s.open && can ? sel('ap-ss-' + s.n, s.ss, ssList.includes(s.ss) || !s.ss ? ssList : [s.ss].concat(ssList), (v) => { O.patchSub(s.sid || s.n, { ss: v }); toast('حالة المنتج اتحفظت', 'success'); })
          : h('span', { class: 'ap-ss' }, s.ss || '—')));
      const groups = []; o.subs.forEach((s) => { const k = String(s.sid || s.vendor || ''); let g = groups.find((x) => x.k === k); if (!g) groups.push(g = { k, sid: s.sid, vendor: s.vendor, rows: [] }); g.rows.push(s); });
      const worst = (rows) => { const open = rows.filter((s) => s.open); if (!open.length) return chip('مقفول', ''); const d = open.some((s) => s.delivery === 'late') ? 'late' : open.some((s) => s.delivery === 'risk') ? 'risk' : 'ok'; return chip(DL[d][0], DL[d][1]); };
      const lines = h('div', { class: 'ap-groups' }, groups.map((g) => h('div', { class: 'ap-grp', 'data-ap-sub': g.sid || '' },
        h('div', { class: 'ap-gh' }, g.sid ? h('b', { dir: 'ltr' }, '#' + g.sid) : null, h('span', null, g.vendor || '—'), h('span', { class: 'grow' }), worst(g.rows)),
        ...g.rows.map(line))));
      return [back(),
        h('div', { class: 'ap-ohead' }, h('div', { class: 'ap-ot' }, h('b', null, 'الأوردر ', h('bdi', { dir: 'ltr' }, 'IB-' + o.id)), h('span', null, o.name || '')),
          h('div', { class: 'ap-pills' }, chip(o.stc || o.st || '—', 'st'), chip(o.cf || '—', o.cf === 'غير مؤكد' ? 'warn' : ''), o.delivery && o.delivery !== 'ok' ? chip(DL[o.delivery][0], DL[o.delivery][1]) : null)),
        strip,
        h('div', { class: 'ap-two' }, cust, ord),
        sec('المنتجات (' + o.subs.length + ')', lines),
        [U().Button({ label: 'كل تفاصيل الأوردر', icon: 'external', attrs: { 'data-ap-full': '' }, onClick: () => { if (O.peek) O.peek(o.id); } }),
          U().Button({ label: 'افتح في صفحة الأوردرات', attrs: { 'data-ap-act': 'orders-page' }, onClick: () => push('page', pageView('orders', 'صفحة الأوردرات هتتفتح مفلترة على IB-' + o.id + '.')) })]];
    };

    // ---- a conversation: the last messages, a reply (the assistant's draft in it) sent through customer service's own send
    const replyView = (convId) => () => {
      const C = window.IBCS; const v = C && C.conv ? C.conv(convId) : null;
      const draft = window.IBAlerts && window.IBAlerts.draftOf ? window.IBAlerts.draftOf(a.body) : '';
      const ta = h('textarea', { class: 'input', id: 'ap-reply', rows: 4, 'aria-label': 'الرد' }); ta.value = draft;
      const send = U().Button({ type: 'primary', icon: 'send', label: 'ابعت', attrs: { 'data-ap-send': '' }, onClick: async () => {
        const t = ta.value.trim(); if (!t) { toast('اكتب الرد الأول', 'error'); return; }
        send.disabled = true; const r = await C.send(convId, t); send.disabled = false;
        if (r && r.ok !== false) { toast('الرد اتبعت', 'success'); stack.pop(); draw(); } else toast((r && r.message) || 'الرد ماتبعتش', 'error'); } });
      return [back(), sec('الرد' + (v && v.handle ? ' — ' + v.handle : ''), ta, h('div', null, send), h('p', { class: 'ap-note' }, 'مفيش حاجة بتتبعت غير بضغطتك.')), null];
    };
    const msgsEl = (convId) => {
      const C = window.IBCS; const v = C && C.conv ? C.conv(convId) : null; if (!v) return null;
      const L = (v.msgs || []).filter((y) => y.t === 'in' || y.t === 'out' || y.t === 'auto').slice(-5);
      return sec('آخر الرسايل', L.length ? h('div', { class: 'ap-bubbles' }, L.map((y) => h('span', { class: 'ap-bub ' + (y.t === 'in' ? 'in' : 'me') }, y.text || '(مرفق)', h('small', null, y.time)))) : h('p', { class: 'ap-note' }, 'مفيش رسايل.'));
    };

    // ---- an assistant's note: its chat, inside the popup (the assistant answers through its own chat on the server)
    const chatView = (noteId, agent) => () => {
      const box = h('div', { class: 'ap-bubbles', 'data-ap-chat': '' }, h('span', { class: 'ap-bub in' }, String(a.body || a.title || '')));
      const inp = h('input', { class: 'input', id: 'ap-ask', type: 'text', placeholder: 'اكتب رسالتك للمساعد…', 'aria-label': 'رسالتك للمساعد' });
      let chatId = null;
      const ask = U().Button({ type: 'primary', icon: 'send', label: 'ابعت', attrs: { 'data-ap-ask': '' }, onClick: async () => {
        const q = inp.value.trim(); const Mk = window.IBMarketing; if (!q) return;
        if (!Mk || !Mk.agentAsk) { push('page', pageView('ai-' + agent, 'شات المساعد هيتفتح في صفحته.')); return; }
        box.append(h('span', { class: 'ap-bub me' }, q)); inp.value = ''; ask.disabled = true;
        if (!chatId && window.IBAlerts && window.IBAlerts.noteChat) chatId = await window.IBAlerts.noteChat(noteId);
        const r = await Mk.agentAsk(agent, chatId, q); ask.disabled = false;
        if (r && r.ok && r.chat) chatId = r.chat.id;
        const last = r && r.ok && Array.isArray(r.turns) ? r.turns.filter((t) => t.role !== 'user').pop() : null;
        if (r && r.ok && r.need && r.need.length) box.append(h('span', { class: 'ap-bub in' }, 'محتاج موافقتك على بيانات — كمّل في شات المساعد.'));
        else box.append(h('span', { class: 'ap-bub in' }, last ? String(last.text || '') : (r && r.message) || 'المساعد ماردّش — جرّب تاني.'));
      } });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ask.click(); } });
      return [back(), sec('شات المساعد', box, inp, h('div', null, ask)), null];
    };

    // ---- the first view: the alert itself and what it is about
    const mainView = () => {
      const body = []; const acts = [];
      const card = x.card && window.IBNtfCard ? window.IBNtfCard.el(Object.assign({}, x.card, { onNum: (id) => push('order', orderView(id)) })) : null;
      const txt = String(a.body || a.sub || '').trim(); const cardOk = card && card.textContent.trim();
      if (cardOk || txt) body.push(sec('التنبيه', cardOk ? card : h('p', { class: 'ap-p' }, txt)));
      const oid = orderOf(a.entity); const cv = convOf(a.entity); const nt = noteOf(a); const tb = trendOf(a);
      if (a.vendorLate) {
        const rows = x.lateRows ? x.lateRows(a.vendorLate, a.kind || 'all') : [];
        body.push(sec('أوردراته المتأخرة والقابلة للتأخير (' + rows.length + ')', rows.length ? h('div', { class: 'scroll-x' }, h('table', { class: 'tbl ap-tbl', 'data-ap-late': '' },
          h('thead', null, h('tr', null, ['الأوردر', 'التأخير', 'المنتج', 'حالة المنتج', 'عمر الأوردر'].map((t) => h('th', null, t)))),
          h('tbody', null, rows.map((r) => h('tr', null, h('td', null, h('button', { type: 'button', class: 'ap-lnk', 'data-ap-order': r.id, onClick: () => push('order', orderView(r.id)) }, 'IB-' + r.id)),
            h('td', null, chip(DL[r.state][0], DL[r.state][1])), h('td', null, r.prod + ' × ' + r.qty), h('td', null, r.ss || '—'), h('td', null, r.age + ' يوم')))))) : h('p', { class: 'ap-note' }, 'مفيش أوردرات متأخرة له دلوقتي.')));
        if (x.lateShare) acts.push(U().Button({ type: 'primary', icon: 'share', label: 'مشاركة مع المبتكر', disabled: !rows.length, attrs: { 'data-ap-act': 'share' }, onClick: () => x.lateShare(a.vendorLate, a.kind || 'all') }));
        if (a.vendorId && x.openVendor) acts.push(U().Button({ label: 'افتح ملف المبتكر', attrs: { 'data-ap-act': 'maker' }, onClick: () => push('page', () => [back(), h('div', { class: 'ap-go' }, h('b', null, 'ملف ' + a.vendorLate), h('span', null, 'ملف المبتكر بيتفتح فوق الصفحة اللي إنت فيها.'),
          h('div', null, U().Button({ type: 'primary', label: 'افتح الملف', attrs: { 'data-ap-goto': '' }, onClick: () => { m.close(); x.openVendor(a.vendorId); } }))), null]) }));
      } else if (a.meta && a.meta.report && window.IBAlertReport && window.IBAlertReport.table) {
        body.push(window.IBAlertReport.table(a, (row) => { const o = orderOf(row.e); if (o) { push('order', orderView(o)); return; } const c = convOf(row.e); if (c) { push('reply', replyView(c)); return; } if (row.e) push('page', pageView(row.e)); }));
        acts.push(U().Button({ type: 'primary', icon: 'share', label: 'مشاركة / تحميل', attrs: { 'data-ap-act': 'share' }, onClick: () => window.IBAlertReport.share(a) }));
      } else if (oid) {
        acts.push(U().Button({ type: 'primary', label: 'تفاصيل الأوردر', attrs: { 'data-ap-act': 'order' }, onClick: () => push('order', orderView(oid)) }));
        acts.push(U().Button({ label: 'افتح في صفحة الأوردرات', attrs: { 'data-ap-act': 'orders-page' }, onClick: () => push('page', pageView('orders', 'صفحة الأوردرات هتتفتح مفلترة على IB-' + oid + '.')) }));
      } else if (cv) {
        const ms = msgsEl(cv); if (ms) body.push(ms);
        if (window.IBCS && window.IBCS.can && window.IBCS.can().reply) acts.push(U().Button({ type: 'primary', icon: 'send', label: 'رد على العميل', attrs: { 'data-ap-act': 'reply' }, onClick: () => push('reply', replyView(cv)) }));
        acts.push(U().Button({ label: 'افتح المحادثة', attrs: { 'data-ap-act': 'cs-page' }, onClick: () => push('page', pageView('cs-inbox', 'المحادثة هتتفتح في خدمة العملاء.')) }));
      } else if (tb) { // the batch's trends, each opening its post; the assistant's chat and its page from here
        const ag = /^ai-([a-z0-9_]+)$/.exec(String(a.entity || '')); const agent = ag ? ag[1] : 'designer'; const Mk = window.IBMarketing;
        const box = h('div', { class: 'ap-trends', 'data-ap-trends': tb }, h('p', { class: 'ap-note' }, 'بنحمّل التريندات…'));
        if (Mk && Mk.trendsBatch) Mk.trendsBatch(tb).then((r) => box.replaceChildren(...trendList(r && r.ok ? r.items : [], r && !r.ok ? r.message || 'ماقدرتش أجيب التريندات' : null)));
        else box.replaceChildren(h('p', { class: 'ap-note' }, 'التريندات بتظهر في صفحة المساعد.'));
        body.push(sec('التريندات', box));
        acts.push(U().Button({ type: 'primary', icon: 'sparkle', label: 'كمّل مع المساعد', attrs: { 'data-ap-act': 'chat' }, onClick: () => push('chat', chatView(null, agent)) }));
        acts.push(U().Button({ label: 'كل التريندات', attrs: { 'data-ap-act': 'page' }, onClick: () => push('page', pageView(a.entity, 'التريندات كلها في «آخر التريندات» عند المساعد.')) }));
      } else if (nt != null) {
        const ag = /^ai-([a-z0-9_]+)$/.exec(String(a.entity || '')); const agent = ag ? ag[1] : 'manager';
        acts.push(U().Button({ type: 'primary', icon: 'sparkle', label: 'كمّل مع المساعد', attrs: { 'data-ap-act': 'chat' }, onClick: () => push('chat', chatView(nt, agent)) }));
      } else if (a.entity && /^[a-z][a-z0-9/_-]{1,60}$/i.test(a.entity)) {
        acts.push(U().Button({ type: 'primary', label: 'افتح ' + ((x.labelOf && x.labelOf(a.entity)) || 'الصفحة'), attrs: { 'data-ap-act': 'page' }, onClick: () => push('page', pageView(a.entity)) }));
      }
      return [...body, acts.length ? acts : null];
    };
    function draw() {
      const top = stack.length ? stack[stack.length - 1].fn() : mainView();
      const actions = top.pop(); const close = U().Button({ type: 'text', label: 'إغلاق', onClick: () => m.close() });
      m.setBody(h('div', { class: 'ap-body', 'data-ap-view': stack.length ? stack[stack.length - 1].name : 'main' }, head(), ...top.filter(Boolean)));
      m.setFooter(...[].concat(actions || [], close));
    }
    m = U().Modal({ title: 'التنبيه', body: [], footer: [] });
    m.el.classList.add('ap-modal'); m.el.setAttribute('data-alert-popup', String(a.id || a.vendorId || ''));
    draw();
    return m;
  }
  window.IBAlertPopup = { open };
})();
