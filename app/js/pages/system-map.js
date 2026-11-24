/* Ibtekr — «العقل الذكي» (Safwat 24 Nov — the pinned mockup made real; the admin only; renamed from «عقل السيستم» and moved the same day:
   «حطها جوة صفحة الذكاء الاصطناعي جمب زرار مساعد جديد … وفيها زرار رجوع»). Not a block: registered here (IBPages.register('brain'),
   navPage «ai») and opened from the «العقل الذكي» button on the AI page (marketing.js) — not in block 28's NAV. Everything the system is linked to, around the brain:
   each group's state from the system's own reads (the keys' status — settings-admin, the pauses — settings «integrations», the CS
   channels, the ads' accounts — mkt-ads, the Magnific bridge, the site's plugins and checks — site_checks), today's events from the
   activity log (a pulse runs on the wire for each new one — read again every 30 s), a sheet per group (its parts, what stops if it
   stops, «إيقاف مؤقت» / «كمّل» on the settings row «integrations» as «الربط بالمنصات» does, «اربطه» and «بدّل» open the settings), and
   the full list of the software and plugins. The pure part is system-map-domain.js (IbtekrSysMap). Reads only — the pause is the one
   write, the admin's, the same as the settings page's. */
(function () {
  'use strict';
  const D = () => window.IbtekrSysMap; const S = () => window.IBSettings; const K = () => window.IBKit; const U = () => window.IBUI;
  const cl = () => (window.IBSupabase && window.IBSupabase.client) || null;
  const isAdmin = () => { const me = window.IBDirectory && window.IBDirectory.me ? window.IBDirectory.me() : null; return !!(me && me.role_id === 'admin'); };
  // the groups' icons (the mockup's own)
const IC = {
    store: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l1.5-5h15L21 9"/><path d="M4 9v11h16V9"/><path d="M3 9h18"/><path d="M9 20v-6h6v6"/></svg>',
    text: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4z"/><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/></svg>',
    image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></svg>',
    video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="13" height="12" rx="3"/><path d="M16 10l5-3v10l-5-3z"/></svg>',
    meta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/><path d="M8 10h8M8 13h5"/></svg>',
    wa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l1.3-4A8 8 0 1 1 8.5 19z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 .8a4 4 0 0 1-2-2l.8-1-1-2z"/></svg>',
    ads: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/></svg>',
    ship: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h11v9H3z"/><path d="M14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/></svg>',
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
    db: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5.5" rx="7.5" ry="2.8"/><path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13"/><path d="M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8"/></svg>',
    code: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 4l-3 16"/></svg>',
    tool: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 6.5a4 4 0 0 0 5 5L12 19a2.1 2.1 0 0 1-3-3z"/><path d="M14.5 6.5L17 4l3 3-2.5 2.5"/></svg>',
    voice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  };
  const NS = 'http://www.w3.org/2000/svg';
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const el = (t, a, html) => { const e = document.createElement(t); for (const k in (a || {})) e.setAttribute(k, a[k]); if (html != null) e.innerHTML = html; return e; };
  const hm = (d) => new Date(d).toLocaleTimeString('ar-EG-u-nu-latn', { hour: 'numeric', minute: '2-digit' });
  // midnight in Cairo as an instant (the day's events)
  const cairoMidnight = () => { const now = new Date(); const day = now.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
    const off = (() => { const p = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', timeZoneName: 'shortOffset' }).formatToParts(now).find((x) => x.type === 'timeZoneName'); const m = /GMT([+-]\d+)/.exec(p ? p.value : ''); return m ? Number(m[1]) : 2; })();
    return new Date(Date.parse(day + 'T00:00:00Z') - off * 3600000).toISOString(); };

  const st = { sys: null, events: [], lastAt: null, loading: false, failed: false, sheet: null, q: '', g: '', checking: false, dom: null, timer: null, raw: null };

  // ---------- the reads (each on its own: a failure leaves its group «مش مربوط» / unknown, never the page)
  const fn = async (name, body) => { try { const c = cl(); if (!c) return null; const { data, error } = await c.functions.invoke(name, { body }); return error || !data || data.error ? null : data; } catch (e) { return null; } };
  const sel = async (q) => { try { const { data, error } = await q; return error ? null : data; } catch (e) { return null; } };
  async function load(quiet) {
    const c = cl(); if (!c) return;
    if (!quiet) { st.loading = true; draw(); }
    // one read for any member (settings-admin «map» — connected or not only, never a value); the pauses are written by the admin only
    const m = await fn('settings-admin', { action: 'map', since: cairoMidnight() });
    const ck = (k) => { const r = ((m && m.checks) || []).find((x) => x.kind === k); return r && r.data && typeof r.data === 'object' ? Object.assign({ at: r.checked_at }, r.data) : null; };
    const adsOf = (k) => { const x = m && m.ads && m.ads[k] && typeof m.ads[k] === 'object' ? m.ads[k] : null; return x ? { linked: x.configured === true, error: typeof x.error === 'string' && x.error ? x.error : null } : null; };
    const sync = (m && m.sync) || []; const ev = (m && m.events) || [];
    st.raw = { links: m && m.links && typeof m.links === 'object' ? m.links : {}, paused: m && m.paused && typeof m.paused === 'object' ? m.paused : {}, providers: m && m.providers && typeof m.providers === 'object' ? m.providers : {},
      channels: (m && m.channels) || [], ads: { meta: adsOf('meta'), tiktok: adsOf('tiktok'), google: adsOf('google') }, bridge: m && m.bridge ? { linked: !!m.bridge.linked } : null,
      wp: ck('wp_updates'), speed: ck('pagespeed'), pixel: ck('pixel'), syncErrors: sync.length === 3 && sync.every((x) => String(x.result) === 'error') ? 3 : 0, events: ev, now: Date.now() };
    st.failed = !m; st.loading = false;
    const before = st.events.length ? st.events[0].id : null;
    st.events = ev || []; st.sys = D().systemsOf(st.raw);
    st.lastAt = st.events.length ? st.events[0].at : null;
    draw();
    if (quiet && before != null) { const fresh = st.events.filter((x) => x.id > before).slice(0, 8).reverse(); fresh.forEach((x, i) => setTimeout(() => pulse(D().eventOf(x.action)), i * 450)); }
  }
  const tick = () => { if (!st.dom || !st.dom.isConnected || document.hidden) return; load(true); };

  // ---------- the page
  function view() {
    if (!st.dom) build();
    if (!st.sys && !st.loading) load();
    if (!st.timer) st.timer = setInterval(tick, 30000);
    requestAnimationFrame(() => { layout(); if (!loopOn) { loopOn = true; requestAnimationFrame(frame); } });
    return [st.dom];
  }
  let map, svg, core, feed, cards = {}, paths = {}, BP = {}, cv, cx2;
  function build() {
    const d = el('div', { class: 'sm-page', 'data-sysmap': '' });
    d.innerHTML = '<div class="sm-head"><button type="button" class="sm-btn sm-back" data-sm-back title="رجوع لـ «الذكاء الاصطناعي»">→ رجوع</button><div><h1>العقل الذكي</h1><p>كل اللي السيستم متوصّل بيه وبيشتغل معاه دلوقتي — السيرفر وبلاجنز الموقع والذكاء الاصطناعي والقنوات. النقطة اللي بتمشي على الخط = حاجة حصلت فعلًا. دوس على أي سيستم تشوف تفاصيله، توقفه مؤقتًا أو تبدّله.</p></div><span class="sm-sp"></span>'
      + '<div class="sm-kpis"><div class="sm-kpi"><small>متصلين</small><b data-sm-k="on">—</b></div><div class="sm-kpi"><small>أحداث النهارده</small><b data-sm-k="ev">—</b></div><div class="sm-kpi"><small>آخر حركة</small><b data-sm-k="last">—</b></div></div>'
      + '<button type="button" class="sm-btn" data-sm-refresh>حدّث</button></div>'
      + '<section class="sm-map" data-sm-map><svg class="sm-wires" aria-hidden="true"></svg>'
      + '<div class="sm-core"><div class="sm-bb"><div class="sm-bfill"></div><div class="sm-bglow"><div class="sm-blines"></div></div><canvas width="587" height="550" aria-hidden="true"></canvas><div class="sm-chip">عقل<br>إبتكر</div></div><small class="sm-sub" data-sm-core>بنقرا الحالة…</small></div></section>'
      + '<div class="sm-legend" aria-hidden="true"><span><i class="on"></i>شغّال</span><span><i class="paused"></i>موقوف مؤقتًا</span><span><i class="unlinked"></i>مش مربوط</span><span><i class="err"></i>فيه مشكلة</span></div>'
      + '<div class="sm-below"><section class="sm-feed" aria-label="اللي بيحصل النهارده"><h2>اللي بيحصل النهارده</h2><ul data-sm-feed></ul></section>'
      + '<div class="sm-all" data-sm-all></div></div>';
    st.dom = d; map = d.querySelector('[data-sm-map]'); svg = d.querySelector('.sm-wires'); core = d.querySelector('.sm-core'); feed = d.querySelector('[data-sm-feed]');
    cv = d.querySelector('canvas'); cx2 = cv.getContext('2d');
    d.querySelector('[data-sm-refresh]').addEventListener('click', () => load());
    d.querySelector('[data-sm-back]').addEventListener('click', () => { location.hash = 'ai'; });
    if ('ResizeObserver' in window) new ResizeObserver(() => layout()).observe(map);
    window.addEventListener('resize', layout);
  }
  async function checkSite() {
    if (st.checking) return; st.checking = true; table();
    const r = await fn('woo-sync', { action: 'wp_updates' }); st.checking = false;
    if (!r || r.result !== 'ok') K().toast('الموقع ماردش على الفحص — جرّب تاني', 'error'); else K().toast('اتفحصت بلاجنز الموقع');
    load(true);
  }
  // ---------- drawing the groups
  function draw() {
    if (!st.dom) return;
    const sub = st.dom.querySelector('[data-sm-core]');
    if (!st.sys) { sub.textContent = st.loading ? 'بنقرا الحالة…' : 'ماقدرناش نقرا الحالة'; return; }
    const sys = st.sys; const ids = new Set(sys.map((s) => s.id));
    Object.keys(cards).forEach((k) => { if (!ids.has(k)) { cards[k].remove(); delete cards[k]; } });
    sys.forEach((s) => {
      let b = cards[s.id];
      if (!b) { b = el('button', { type: 'button', class: 'sm-node', 'data-sm-node': s.id }); b.addEventListener('click', () => openSheet(s.id)); map.appendChild(b); cards[s.id] = b; }
      b.dataset.state = s.state;
      const n = s.parts.length; const sub2 = (s.state === 'on' ? s.today + ' النهارده · ' : s.state === 'paused' ? 'موقوف · ' : s.state === 'err' ? '⚠ ' : s.state === 'unlinked' ? 'مش مربوط · ' : '') + n + (n > 10 ? ' جزء' : n > 2 ? ' أجزاء' : n === 2 ? ' جزأين' : ' جزء');
      b.innerHTML = '<span class="sm-ic">' + (IC[s.glyph] || '') + '</span><span class="sm-t"><b>' + esc(s.name) + '</b><small>' + esc(sub2) + '</small></span><span class="sm-dot" aria-hidden="true"></span>';
      b.setAttribute('aria-label', s.name + ' — ' + D().STATE_TXT[s.state] + ' — ' + s.now);
    });
    sub.textContent = D().coreLine(sys);
    const on = sys.filter((s) => s.state === 'on').length;
    st.dom.querySelector('[data-sm-k="on"]').textContent = on + ' من ' + sys.length;
    st.dom.querySelector('[data-sm-k="ev"]').textContent = String(st.events.length >= 1000 ? '+1000' : st.events.length);
    st.dom.querySelector('[data-sm-k="last"]').textContent = st.lastAt ? hm(st.lastAt) : '—';
    feed.innerHTML = st.events.slice(0, 30).map((x) => { const e = D().eventOf(x.action); const g = sys.find((s) => s.id === e.sys); return '<li><time>' + esc(hm(x.at)) + '</time><span><b>' + esc(g ? g.name : '') + '</b> — ' + esc(e.text) + '</span></li>'; }).join('') || '<li class="sm-empty">مفيش حركة النهارده لسه.</li>';
    layout(); table(); if (st.sheet) paint();
  }
  // the software and plugins list (Safwat 24 Nov — «ظبط الجدول عشان يبقا نفس شكل بقيت جداول السيستم»): the kit's standard table card —
  // its title and count, «بحث» / «فلتر» / «ترتيب» / the columns in its head like every table, «افحص بلاجنز الموقع» beside them (the admin)
  function table() {
    if (!st.dom || !st.sys) return;
    const host = st.dom.querySelector('[data-sm-all]'); if (!host || !K() || !U()) return;
    const h = U().h; const T = D().STATE_TXT; const all = st.sys.reduce((n, g) => n + g.parts.length, 0);
    const rows = []; st.sys.forEach((g) => g.parts.forEach((x) => rows.push([g, x])));
    const ver = (g, x) => (x.ver ? h('span', null, x.ver, x.upd ? h('span', { class: 'sm-upd', title: 'فيه نسخة أحدث' }, ' ← ' + x.upd) : null) : h('small', { class: 'sm-muted' }, g.id === 'site' ? 'من الموقع' : '—'));
    const body = U().Table({ cls: 'dt sm-tbl', headers: ['الاسم', 'النوع', 'الجروب', 'بيعمل إيه مع السيستم', 'الاتجاه', 'الإصدار', 'الحالة'],
      rows: rows.map(([g, x]) => [h('b', null, x.name), x.kind, g.name, x.err || x.role, x.dir, ver(g, x), h('span', { class: 'sm-st', 'data-st': x.state }, h('i'), T[x.state] || '')]) });
    const tb = body.querySelector('tbody'); if (tb) { tb.setAttribute('data-sm-rows', ''); tb.querySelectorAll('tr').forEach((r) => r.setAttribute('data-sm-row', '')); }
    const site = st.sys.find((s) => s.id === 'site');
    const check = isAdmin() ? U().Button({ size: 'sm', icon: 'refresh', label: st.checking ? 'بنفحص…' : 'افحص بلاجنز الموقع', disabled: !!st.checking, attrs: { 'data-sm-check': '' }, onClick: checkSite }) : null;
    const card = K().TableSection({ title: 'كل السوفتوير والبلاجنز', sub: all + ' سيستم وبلاجن', actions: check, body, noun: ['سيستم', 'السيستمات'], count: [rows.length, all], rerender: table });
    const note = h('p', { class: 'source t-small help', 'data-sm-checked': '' }, site && site.checkedAt ? 'بلاجنز الموقع ونسخها من آخر فحص ' + new Date(site.checkedAt).toLocaleString('ar-EG-u-nu-latn', { day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }) + ' — بيتفحص لوحده كل يوم' : 'بلاجنز الموقع بتتقري من آخر فحص للموقع');
    host.replaceChildren(card, note);
    if (K().sweepColumns) K().sweepColumns(host); // «بحث» and the head's order like every table (the kit's pass on a page render)
  }
  // ---------- the layout (the mockup's): a ring around the brain — an ellipse on wide screens, the wires quadratic curves that start
  // where each side's path meets the brain's edge; on a phone the brain on top and the groups in a grid, no wires
  const BW = 587, BH = 550; const GOLD = '#e6ba65';
  const BPATHS = (window.IbtekrSysMapPaths || []).map((x) => ({ a: x.a, pts: x.p.reduce((o, v, i) => (i % 2 ? (o[o.length - 1].push(v), o) : (o.push([v]), o)), []) })).filter((x) => x.pts.length >= 16);
  const pathFor = (an) => (BPATHS.length ? BPATHS.reduce((best, x) => { const d = Math.abs(Math.atan2(Math.sin(x.a - an), Math.cos(x.a - an))); return d < best.d ? { d, pts: x.pts } : best; }, { d: 9, pts: BPATHS[0].pts }).pts : null);
  const narrow = () => window.matchMedia('(max-width: 760px)').matches;
  function layout() {
    if (!map || !st.sys || !map.isConnected) return;
    svg.replaceChildren(); paths = {};
    if (narrow()) { Object.values(cards).forEach((c) => { c.style.right = ''; c.style.top = ''; }); core.style.right = ''; core.style.top = ''; return; }
    const W = map.clientWidth, H = map.clientHeight; const cx = W / 2, cy = H / 2; if (!W || !H) return;
    core.style.right = (W - cx) + 'px'; core.style.top = cy + 'px';
    const rx = Math.min(W / 2 - 120, 430), ry = H / 2 - 64; const n = st.sys.length;
    st.sys.forEach((s, i) => {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2; const x = cx + rx * Math.cos(a), y = cy + ry * Math.sin(a);
      const c = cards[s.id]; if (!c) return; c.style.right = (W - x) + 'px'; c.style.top = y + 'px';
      const mx = (cx + x) / 2 + (y - cy) * 0.12, my = (cy + y) / 2 - (x - cx) * 0.12;
      const p = document.createElementNS(NS, 'path'); const bp = pathFor(Math.atan2(y - cy, x - cx)); BP[s.id] = bp;
      const sc = core.clientWidth / BW; const sx = bp ? cx + (bp[0][0] - BW / 2) * sc : cx, sy = bp ? cy + (bp[0][1] - BH / 2) * sc : cy;
      p.setAttribute('d', 'M' + sx + ' ' + sy + ' Q' + mx + ' ' + my + ' ' + x + ' ' + y);
      p.setAttribute('class', 'sm-wire ' + s.state); svg.appendChild(p); paths[s.id] = p;
    });
  }
  // ---------- the brain: its lines as a mask in Ibtekr's green, a pulse runs inside it along the picture's own lines to the chip
  // (and the other way for what goes out); it beats — a lub-dub and a ring. One loop, stopped when the page leaves
  const runs = []; function run(pts, rev, done) { if (pts) runs.push({ pts, rev, t0: performance.now(), dur: 450 + pts.length * 9, done }); else if (done) done(); }
  const BEAT = 1600; const bump = (p, s0, w) => (p >= s0 && p <= s0 + w ? Math.sin(Math.PI * (p - s0) / w) : 0);
  const beatOf = (t) => { const p = (t % BEAT) / BEAT; return bump(p, 0, .14) + .6 * bump(p, .2, .14); };
  let lastBeat = -1; const rings = [];
  function ring(gold) { if (reduce || !svg || !svg.isConnected || narrow()) return; const c = document.createElementNS(NS, 'circle'); c.setAttribute('class', 'sm-ring' + (gold ? ' gold' : '')); svg.insertBefore(c, svg.firstChild); rings.push({ c, t0: performance.now(), gold }); }
  function brain(t) {
    const b = reduce ? 0 : beatOf(t); core.style.setProperty('--k', (1 + .025 * b).toFixed(4));
    const n = Math.floor(t / BEAT); if (!reduce && n !== lastBeat) { lastBeat = n; ring(false); }
    cx2.clearRect(0, 0, BW, BH);
    for (let i = runs.length - 1; i >= 0; i--) { const R1 = runs[i]; const k = Math.min(1, (t - R1.t0) / R1.dur); const e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const N1 = R1.pts.length - 1; const at = (R1.rev ? 1 - e : e) * N1;
      const pt = (q) => { const i0 = Math.max(0, Math.min(N1, Math.floor(q))), i1 = Math.min(N1, i0 + 1), f = q - i0; return [R1.pts[i0][0] + (R1.pts[i1][0] - R1.pts[i0][0]) * f, R1.pts[i0][1] + (R1.pts[i1][1] - R1.pts[i0][1]) * f]; };
      cx2.lineCap = 'round'; for (let s2 = 1; s2 <= 10; s2++) { const q0 = at + (R1.rev ? s2 - 1 : 1 - s2), q1 = at + (R1.rev ? s2 : -s2); if (q1 < 0 || q1 > N1) break;
        const [x0, y0] = pt(q0), [x1, y1] = pt(q1); cx2.strokeStyle = GOLD; cx2.globalAlpha = (1 - s2 / 11) * .9; cx2.lineWidth = 4.5 - s2 * .3; cx2.beginPath(); cx2.moveTo(x0, y0); cx2.lineTo(x1, y1); cx2.stroke(); }
      cx2.globalAlpha = 1; const [x, y] = pt(at); cx2.fillStyle = '#fff8e8'; cx2.shadowColor = GOLD; cx2.shadowBlur = 14; cx2.beginPath(); cx2.arc(x, y, 4.2, 0, Math.PI * 2); cx2.fill(); cx2.shadowBlur = 0;
      if (k >= 1) { runs.splice(i, 1); if (R1.done) R1.done(); else if (!R1.rev) ring(true); } }
    if (!reduce && Math.random() < .02 && BPATHS.length) run(BPATHS[Math.floor(Math.random() * BPATHS.length)].pts, Math.random() < .5);
    const cxm = map.clientWidth / 2, cym = map.clientHeight / 2;
    for (let i = rings.length - 1; i >= 0; i--) { const R2 = rings[i]; const u = (t - R2.t0) / (R2.gold ? 1100 : 1800); if (u >= 1) { R2.c.remove(); rings.splice(i, 1); continue; }
      R2.c.setAttribute('cx', cxm); R2.c.setAttribute('cy', cym); R2.c.setAttribute('r', 175 + u * (R2.gold ? 120 : 200)); R2.c.setAttribute('stroke-opacity', ((1 - u) * (R2.gold ? .7 : .35)).toFixed(3)); }
  }
  // ---------- a pulse: a dot along a group's wire (in = to the brain, out = from it) for each new event
  const live = []; let loopOn = false;
  function pulse(e) {
    const id = e.sys; const card = cards[id]; if (!card) return;
    card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash');
    const p = paths[id]; if (!p || reduce) return;
    const wire = () => { const c = document.createElementNS(NS, 'circle'); c.setAttribute('r', '5'); c.setAttribute('class', 'sm-pulse' + (e.out ? ' out' : '')); svg.appendChild(c); live.push({ c, p, len: p.getTotalLength(), t0: performance.now(), out: e.out, id }); };
    if (e.out && BP[id]) run(BP[id], true, wire); else wire();
  }
  function frame(t) {
    if (!st.dom || !st.dom.isConnected) { loopOn = false; return; }
    if (!document.hidden && st.sys) brain(t);
    for (let i = live.length - 1; i >= 0; i--) { const L = live[i]; const k = Math.min(1, (t - L.t0) / 1400); const e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const pt = L.p.getPointAtLength(L.len * (L.out ? e : 1 - e)); L.c.setAttribute('cx', pt.x); L.c.setAttribute('cy', pt.y); if (k >= 1) { L.c.remove(); live.splice(i, 1); if (!L.out && BP[L.id]) run(BP[L.id], false); } }
    requestAnimationFrame(frame);
  }
  // ---------- the sheet: state, importance, the parts, what stops; pause / resume (the settings row «integrations»), link / swap in the settings
  function openSheet(id) { st.sheet = { id, ask: null, busy: false, last: document.activeElement }; paint(); }
  function closeSheet() { const s = st.sheet; if (!s) return; if (s.scrim) s.scrim.remove(); st.sheet = null; if (s.last && s.last.focus) s.last.focus(); }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && st.sheet) closeSheet(); });
  function paint() {
    const sh = st.sheet; const s = st.sys && st.sys.find((x) => x.id === sh.id); if (!s) return closeSheet();
    if (!sh.scrim) { sh.scrim = el('div', { class: 'sm-scrim', role: 'dialog', 'aria-modal': 'true', 'aria-label': s.name, 'data-sm-sheet': s.id }); sh.scrim.addEventListener('click', (e) => { if (e.target === sh.scrim) closeSheet(); }); sh.box = el('div', { class: 'sm-sheet' }); sh.scrim.appendChild(sh.box); document.body.appendChild(sh.scrim); }
    const imp = [1, 2, 3].map((i) => '<i class="' + (i <= s.imp ? 'on' : '') + '"></i>').join(''); const T = D().STATE_TXT;
    let acts = '';
    if (!isAdmin()) acts = '<p class="sm-note" data-sm-view>إنت شايف الحالة بس — الإيقاف والربط والتبديل للأدمن.</p>';
    else if (s.locked) acts = '<p class="sm-note">' + esc(s.note || '') + '</p>';
    else if (s.state === 'paused') acts = '<div class="sm-btns"><button type="button" class="sm-btn pri" data-act="resume">كمّل</button></div>';
    else if (s.state === 'unlinked') acts = '<div class="sm-btns"><button type="button" class="sm-btn pri" data-act="link">اربطه من الإعدادات</button></div>';
    else if (s.state === 'err') acts = '<div class="sm-btns"><button type="button" class="sm-btn pri" data-act="link">' + (s.swap ? 'افتح المزوّدين' : 'اربطه تاني') + '</button><button type="button" class="sm-btn" data-act="ask-pause">إيقاف مؤقت</button></div>';
    else acts = '<div class="sm-btns"><button type="button" class="sm-btn gold" data-act="ask-pause">إيقاف مؤقت</button><button type="button" class="sm-btn" data-act="link">' + (s.swap ? 'المزوّدين' : 'الربط بالمنصات') + '</button></div>';
    const ask = sh.ask ? '<div class="sm-confirm" role="alert"><b>' + esc(sh.ask.title) + '</b><span class="sm-note">' + esc(sh.ask.text) + '</span><div class="sm-btns">' + sh.ask.btns + '<button type="button" class="sm-btn" data-act="cancel">إلغاء</button></div></div>' : '';
    const alts = s.alts && s.alts.length > 1 ? '<div class="sm-box"><h3>البدائل</h3><div class="sm-alts">' + s.alts.map((a) => '<div class="sm-alt" aria-current="' + (a.id === s.cur) + '"><span><b>' + esc(a.name) + '</b><small>' + esc(a.sub) + '</small></span><span class="sm-tag">' + (a.id === s.cur ? 'المستخدم دلوقتي' : a.linked ? 'جاهز' : 'محتاج ربط') + '</span></div>').join('') + '</div>'
      + (isAdmin() ? '<div class="sm-btns"><button type="button" class="sm-btn" data-act="swap">بدّله من «المزوّدين»</button></div>' : '') + '<p class="sm-note">التبديل بيتعمل من «الإعدادات › الذكاء الاصطناعي › المزوّدين» — لكل أداة مزوّدها، والسيستم بيستخدم الجديد من الطلب الجاي.</p></div>' : '';
    const parts = '<div class="sm-box"><h3>الأجزاء (' + s.parts.length + ')</h3><ul class="sm-parts">' + s.parts.map((x) => '<li data-st="' + x.state + '"><span class="sm-pd" aria-hidden="true"></span><span class="sm-pn"><b>' + esc(x.name) + '</b><small>' + esc(x.kind) + (x.ver ? ' · ' + esc(x.ver) : '') + (x.upd ? ' · فيه ' + esc(x.upd) : '') + ' · ' + esc(T[x.state]) + '</small><small>' + esc(x.err || x.role) + '</small></span><span class="sm-pdir">' + esc(x.dir) + '</span></li>').join('') + '</ul>' + (s.note && !s.locked ? '<p class="sm-note">' + esc(s.note) + '</p>' : '') + '</div>';
    sh.box.innerHTML = '<header><span class="sm-ic">' + (IC[s.glyph] || '') + '</span><div><h2>' + esc(s.name) + '</h2><span class="sm-pill ' + s.state + '">● ' + esc(T[s.state]) + (s.pausedTill && s.state === 'paused' ? ' ' + esc(s.pausedTill) : '') + '</span></div><button type="button" class="sm-x" aria-label="إغلاق" data-act="close">✕</button></header>'
      + (s.state === 'err' && s.err ? '<div class="sm-confirm"><b>' + esc(s.err) + '</b></div>' : '')
      + '<div class="sm-box"><h3>عن السيستم</h3><div class="sm-kv"><span>المستخدم</span><b>' + esc(s.now) + '</b></div><div class="sm-kv"><span>بيعمل إيه</span><b>' + esc(s.job) + '</b></div><div class="sm-kv"><span>الأهمية</span><b><span class="sm-imp" aria-label="' + D().IMP_TXT[s.imp] + '">' + imp + '</span> ' + D().IMP_TXT[s.imp] + '</b></div><div class="sm-kv"><span>أحداث النهارده</span><b>' + s.today + '</b></div></div>'
      + parts + (s.locked ? '' : '<div class="sm-box"><h3>لو وقف</h3><p class="sm-note" style="margin:0">هيقف: ' + esc(s.stops) + '. باقي السيستم شغّال عادي.</p></div>') + alts + ask + acts;
    sh.box.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => act(b.dataset.act, b.dataset)));
    const x = sh.box.querySelector('.sm-x'); if (x && !sh.box.contains(document.activeElement)) x.focus();
  }
  const settingsApi = () => { const p = window.IBPages && window.IBPages.all ? window.IBPages.all().settings : null; return p && p.api ? p.api : null; };
  function goSettings(s) { closeSheet(); if (s.swap) { location.hash = '#settings-ai'; return; } const a = settingsApi(); if (a && a.openIntegrations) a.openIntegrations(s.link || 'site'); else location.hash = '#settings-integrations'; }
  const FOR = { 'ساعة': 3600000, 'يوم': 86400000, 'أسبوع': 7 * 86400000 };
  async function setPause(s, ms) {
    const sh = st.sheet; if (sh.busy) return; sh.busy = true;
    const cur = S().section('integrations') || {}; const m = Object.assign({}, cur.paused && typeof cur.paused === 'object' ? cur.paused : {});
    (s.pauseKeys || []).forEach((k) => { if (ms) m[k] = new Date(Date.now() + ms).toISOString(); else delete m[k]; });
    const r = await S().save('integrations', { paused: m }); sh.busy = false; sh.ask = null;
    if (!r || !r.ok) { K().toast((r && r.message) || 'ماتحفظش — جرّب تاني', 'error'); paint(); return; }
    K().toast(ms ? 'اتوقف «' + s.name + '» مؤقتًا — السيستم بيتعامل معاه كأنه مش مربوط' : 'رجع «' + s.name + '» يشتغل');
    await load(true);
  }
  function act(a, d) {
    const s = st.sys.find((x) => x.id === st.sheet.id);
    if (a === 'close') return closeSheet();
    if (a === 'cancel') { st.sheet.ask = null; return paint(); }
    if (a === 'link' || a === 'swap') return goSettings(s);
    if (a === 'ask-pause') { st.sheet.ask = { title: 'توقف «' + s.name + '» لحد إمتى؟', text: 'هيقف: ' + s.stops + '. السيستم هيتعامل معاه كأنه مش مربوط لحد الميعاد أو لحد ما تدوس «كمّل».', btns: Object.keys(FOR).map((x) => '<button type="button" class="sm-btn gold" data-act="pause" data-for="' + x + '">' + x + '</button>').join('') }; return paint(); }
    if (a === 'pause') return setPause(s, FOR[d.for] || FOR['يوم']);
    if (a === 'resume') return setPause(s, 0);
  }

  window.IBPages.register('brain', { title: 'العقل الذكي', hash: (hs) => hs === 'brain', navPage: () => 'ai', view });
  window.IBSysMap = { load, state: () => st };
})();
