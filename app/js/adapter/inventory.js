// The inventory hub «المخزن» (phase 7, 0044): lots, their append-only moves, the consolidations of orders' lines, the stock counts,
// the places and the settings row «inventory». load() puts everything in block 16's v2 shapes on IBKit.store (the page reads them
// there, like the prototype):
//   stock          [{ key (the lot's uuid), sku, name, vendor (a name), vendorId, reason, status, ref, sub (the sub-order's number as the
//                     orders page shows it: sub_orders.woo_order_id, else the order), itemId (order_items.id), order,
//                     since (YYYY-MM-DD), loc, cost, mode ('أمانة' | 'ملك'), condition, conditionNote, note }]
//   ledger         [{ id, at ('YYYY-MM-DD HH:MM' Cairo), key, type, qty, label, reason, ref, by (a name), note, name, sku }] newest first
//   returns        derived from the lots received as «مرتجع» (their first in-move): { key, name, vendor, mode, sub, type, reason,
//                     condition, conditionNote, at, status, effect, value }
//   consolidations [{ id, order, customer, subs: [[sid, maker, line status, product, item id]], since, zone, by }] (open ones)
//   count          the open count { id: 'CNT-n', dbId, zone, started, total, base, lines: [{ key, sku, name, loc, system, counted, cost, note }] } or null
//   counts         the approved ones { id, date, zone, by, items, value, status: 'اتعتمد' }
//   racks          [{ code, desc, kind, products, pieces }]       invSettings  DEFAULTS ∪ the settings row (cleanSettings)
// Writes return a Promise of { ok, reason? } and never throw (reason 'forbidden' 42501, 'invalid' 22/23xxx, 'notfound', 'network');
// each one the server took is logged as inventory.<x> through IBActivity (ids, names and numbers only). can(): { view, edit, approve, admin }.
// B6 (the owner, 11 Nov — «إعدادات المخزن في الإعدادات العامة، أبسط»): the settings are five — the auto-pull switch (off), three alerts
// in days (consolidation late, a photo piece too long, a return waiting too long) and one default for a return (يستنى أوردر / يرجع
// للمبتكر); the places are three fixed ones (PLACES: تجميع · مرتجعات · تصوير); the site quantity is not synced from here any more
// (the old wooSync key and the rest of the prototype's keys are dropped from the row at the next save).
(function () {
  'use strict';
  const LOT_COLS = 'id, reason, status, sku, product_id, name, vendor_id, order_id, item_id, ref, loc, mode, cost, condition, condition_note, note, since, closed_at, created_by, created_at';
  const MOVE_COLS = 'id, lot_id, type, qty, label, reason, ref, note, by, at';
  const ORDER_DONE = ['ملغي', 'مكتمل', 'استرجاع', 'فشل']; const LINE_DONE = ['تم الشحن للعميل', 'مكتمل', 'ملغي', 'مرتجع للمخزن', 'مرتجع للمبتكر']; // decision 23: a closed order / line gathers nothing
  const CONS_COLS = 'id, order_id, zone, status, carrier, since, created_by, created_at';
  const ITEM_COLS = 'id, order_id, sub_order_id, name, sku, qty, total, vendor_id, status';
  const COUNT_COLS = 'id, zone, status, note, started_by, started_at, approved_by, approved_at';
  const LINE_COLS = 'count_id, lot_id, system, counted, note';
  const LOC_COLS = 'code, label, kind, note';
  // B6: the five settings (auto-pull off until the owner opens it); the alerts in whole days, 1–90
  const DEFAULTS = Object.freeze({ firstWarehouse: false, consolidationAlert: 5, photoMax: 14, returnWait: 7, returnDefault: 'يرجع للمبتكر' });
  const SETTING_KEYS = Object.keys(DEFAULTS);
  const RETURN_DEFAULTS = ['يستنى أوردر', 'يرجع للمبتكر', 'اسألني في كل مرة']; // owner batch 14 Nov decision 5: «اسألني في كل مرة» = the inspect popup asks
  const PLACES = Object.freeze([['T', 'تجميع'], ['R', 'مرتجعات'], ['P', 'تصوير']]);
  const LIMIT = 5000;
  const c = () => (window.IBSupabase && window.IBSupabase.client) || null;
  const quiet = (fn) => { try { return fn(); } catch (e) { return undefined; } };
  const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? 0 : Number(v));
  const perm = (key) => (window.IBDirectory && window.IBDirectory.perm ? window.IBDirectory.perm(key) : 'N');
  const me = () => (window.IBDirectory && window.IBDirectory.me ? window.IBDirectory.me() : null);
  const can = () => { const admin = !!(me() && me().role_id === 'admin'); return { view: admin || perm('inventory.view') !== 'N', edit: admin || perm('inventory.edit') === 'F', approve: admin || perm('inventory.approve') === 'F', admin }; };
  const reasonOf = (err) => { const code = String((err && err.code) || ''); return code === '42501' ? 'forbidden' : code === 'P0002' ? 'notfound' : /^2[23]/.test(code) ? 'invalid' : 'network'; };
  const fail = (err) => ({ ok: false, reason: reasonOf(err) });
  const log = (action, detail, id) => { const L = window.IBActivity; if (L && L.log) quiet(() => L.log(action, detail, { entity: 'inventory', entity_id: id || null })); };
  const K = () => window.IBKit;
  const store = () => (K() && K().store) || null;
  const emit = () => quiet(() => document.dispatchEvent(new CustomEvent('ib:inventory')));
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const cairo = (iso) => { const d = iso ? new Date(iso) : new Date(); if (!Number.isFinite(d.getTime())) return ''; const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value])); return p.year + '-' + p.month + '-' + p.day + ' ' + p.hour + ':' + p.minute; };
  const today = () => cairo().slice(0, 10);
  const newKey = () => (window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16)));
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // ---------- names ----------
  const members = () => (window.IBDirectory && window.IBDirectory.members ? window.IBDirectory.members() : []) || [];
  const nameOf = (uid) => { if (!uid) return 'السيستم'; const m = members().find((x) => x.uid === uid); return m ? m.name : '—'; };
  const vstore = () => (window.IBVendors && window.IBVendors.store) || null;
  const vendorName = (id) => { const V = vstore(); const v = id && V && V.get ? quiet(() => V.get(id)) : null; return v ? v.name : ''; };
  const vendorIdOf = (name) => { const V = vstore(); const v = name && V && V.findByName ? quiet(() => V.findByName(name)) : null; return v ? v.id : null; };
  const modeIn = (m) => (m === 'ملك' || m === 'ملك ابتكر' ? 'ملك ابتكر' : 'أمانة');
  const modeOut = (m) => (m === 'ملك ابتكر' ? 'ملك' : 'أمانة');

  // ---------- shapes ----------
  const toStock = (r, sidOf) => ({ key: r.id, sku: r.sku || '', name: r.name, vendor: vendorName(r.vendor_id), vendorId: r.vendor_id || null, reason: r.reason, status: r.status,
    ref: r.ref || null, sub: r.item_id != null ? (sidOf ? sidOf(r.item_id) : String(r.item_id)) : '', itemId: r.item_id != null ? String(r.item_id) : null, order: r.order_id != null ? String(r.order_id) : null, since: r.since, loc: r.loc || '—', cost: num(r.cost),
    mode: modeOut(r.mode), condition: r.condition || undefined, conditionNote: r.condition_note || '', note: r.note || '', closed: !!r.closed_at });
  const toMove = (m, lots) => { const l = lots.get(m.lot_id) || {}; return { id: m.id, at: cairo(m.at), key: m.lot_id, type: m.type, qty: m.qty, label: m.label || '', reason: m.reason || '', ref: m.ref || '—', by: nameOf(m.by), note: m.note || '', name: l.name || '', sku: l.sku || '' }; };
  const RET_STATUS = { 'بانتظار الفحص': 'بانتظار الفحص', 'تالف': 'اتفحص — تالف', 'راجع للمبتكر': 'اتفحص — رجع للمبتكر' };
  function toReturn(l, first) {
    const status = RET_STATUS[l.status] || 'اتفحص — سليم';
    const qty = first ? first.qty : 1;
    return { key: l.key, name: l.name, vendor: l.vendor, mode: l.mode === 'ملك' ? 'ملك ابتكر' : 'أمانة', sub: l.sub ? '#' + l.sub : (l.ref || '—'), sku: l.sku,
      type: l.status === 'راجع للمبتكر' ? 'مرتجع للمبتكر' : 'مرتجع للمخزن', reason: l.note || 'مرتجع', condition: l.condition, conditionNote: l.conditionNote,
      at: K() && K().dshort ? K().dshort(l.returnedAt || l.since) : l.returnedAt || l.since, status, effect: status === 'بانتظار الفحص' ? '+ ' + qty + ' بعد الفحص' : status === 'اتفحص — تالف' ? '− تالف ' + (K() && K().money ? K().money(l.cost) : l.cost) + ' ج' : status === 'اتفحص — رجع للمبتكر' ? 'رجع لـ ' + l.vendor : '+ ' + qty + ' متاح',
      value: status === 'اتفحص — تالف' ? l.cost : 0 };
  }

  let st = 'idle'; let gen = 0; let countRow = null; let media = new Map(); const HTTPS = /^https:\/\/[^\s"'<>]+$/i;
  // a product's photo and page on the site by SKU ('' when the mirror has none): { img, link }
  const mediaOf = (sku) => media.get(String(sku || '').trim()) || { img: '', link: '' };
  const data = { settings: Object.assign({}, DEFAULTS) };

  async function rows(q) { const { data: d, error } = await q; if (error) throw error; return Array.isArray(d) ? d : []; }
  async function load(opts) {
    const cl = c(); const S = store(); if (!cl || !S) return { ok: false, reason: 'network' };
    if (!can().view) { Object.assign(S, { stock: [], ledger: [], returns: [], consolidations: [], count: null, counts: [], racks: [] }); st = 'ready'; emit(); return { ok: true }; }
    const soft = !!(opts && opts.quiet) && st === 'ready'; // IBLive (0104): a live re-read — no «loading» state, a failed read keeps what is shown
    const g = ++gen; if (!soft) st = 'loading';
    try {
      const [lots, moves, cons, counts, locs, set] = await Promise.all([
        rows(cl.from('inv_lots').select(LOT_COLS).order('created_at', { ascending: false }).limit(LIMIT)),
        rows(cl.from('inv_moves').select(MOVE_COLS).order('at', { ascending: false }).limit(LIMIT)),
        rows(cl.from('inv_consolidations').select(CONS_COLS).eq('status', 'open').order('created_at', { ascending: false })),
        rows(cl.from('inv_counts').select(COUNT_COLS).order('id', { ascending: false }).limit(30)),
        rows(cl.from('inv_locations').select(LOC_COLS).order('code')),
        cl.from('settings').select('data').eq('section', 'inventory').maybeSingle(),
      ]);
      seenL = new Map(lots.map((r) => [String(r.id), Object.fromEntries(Object.values(LOT_PATCH).map((k) => [k, r[k] === undefined ? null : r[k]]))]));
      const consIds = cons.map((x) => x.id);
      const links = consIds.length ? await rows(cl.from('inv_consolidation_items').select('consolidation_id, item_id').in('consolidation_id', consIds)) : [];
      // the lines of the consolidations and of the lots (a member without orders.view: none — the item id stands for the sub-order)
      const itemIds = [...new Set(links.map((x) => x.item_id).concat(lots.map((l) => l.item_id).filter((x) => x != null)))];
      const items = itemIds.length ? await rows(cl.from('order_items').select(ITEM_COLS).in('id', itemIds)).catch(() => []) : [];
      // comments decision 23 (the owner 15 Nov — «احيانا ف تجميع الاوردات مش بتتجمع ف صفحة التجميع ف المخزن — خلي الاوردارات تظهر»): an
      // order whose «تجميع أوردر» pieces are in the hub (on hand, from the moves) with no open consolidation — received from the orders
      // page before a consolidation was opened — is listed in «تجميع أوردرات» too: `derived`, no id (the page writes its row before it
      // acts on it). Not an order whose last consolidation the team cancelled, nor a closed order.
      const onHand = new Map(); moves.forEach((m) => { const d = m.type === 'in' || m.type === 'adjust' ? m.qty : m.type === 'out' || m.type === 'ship' ? -m.qty : 0; if (d) onHand.set(m.lot_id, (onHand.get(m.lot_id) || 0) + d); });
      const openFor = new Set(cons.map((x) => String(x.order_id)));
      const loose = lots.filter((l) => !l.closed_at && l.reason === 'تجميع أوردر' && l.order_id != null && (onHand.get(l.id) || 0) > 0 && !openFor.has(String(l.order_id)));
      const looseIds = [...new Set(loose.map((l) => Number(l.order_id)))];
      const [past, looseItems] = looseIds.length ? await Promise.all([
        rows(cl.from('inv_consolidations').select('order_id, status, created_at').in('order_id', looseIds).in('status', ['shipped', 'partial', 'cancelled'])).catch(() => []),
        rows(cl.from('order_items').select(ITEM_COLS + ', removed, pulled').in('order_id', looseIds)).catch(() => [])]) : [[], []];
      looseItems.forEach((i) => { if (!items.some((x) => String(x.id) === String(i.id))) items.push(i); });
      const subIds = [...new Set(items.map((i) => i.sub_order_id).filter((x) => x != null))];
      const subs = subIds.length ? await rows(cl.from('sub_orders').select('id, woo_order_id').in('id', subIds)).catch(() => []) : [];
      const orderIds = [...new Set(cons.map((x) => x.order_id).concat(looseIds))];
      const orders = orderIds.length ? await rows(cl.from('orders_v').select('id, customer_name, status').in('id', orderIds)) : [];
      const open = counts.find((x) => x.status === 'open') || null;
      const closedIds = counts.filter((x) => x.status === 'approved').map((x) => x.id);
      const lineIds = (open ? [open.id] : []).concat(closedIds);
      const lines = lineIds.length ? await rows(cl.from('inv_count_lines').select(LINE_COLS).in('count_id', lineIds)) : [];
      // comments decisions 18 and 19 (the owner 15 Nov — «خلي صور المنتجات تبان هنا» · «لو المنتج ليه لينك على الويبسايت حطه هنا»): the lots'
      // products on the site by SKU — the photo and the page from the mirror (https only; the English row first, as the orders page).
      // A member who cannot read the mirror gets none (the box icon stays).
      const skus = [...new Set(lots.map((l) => String(l.sku || '').trim()).filter(Boolean))]; const found = new Map();
      for (let i = 0; i < skus.length; i += 100) {
        const ps = await rows(cl.from('products').select('sku, image_url, permalink, lang').in('sku', skus.slice(i, i + 100))).catch(() => []);
        ps.slice().sort((a, b) => (a.lang === 'ar') - (b.lang === 'ar')).forEach((x) => { const k = String(x.sku || '').trim(); if (!k) return; const m = found.get(k) || { img: '', link: '' };
          if (!m.img && HTTPS.test(x.image_url || '')) m.img = x.image_url; if (!m.link && HTTPS.test(x.permalink || '')) m.link = x.permalink; found.set(k, m); });
      }
      if (g !== gen) return { ok: false, reason: 'stale' };
      media = found;
      const itemOf = new Map(items.map((i) => [String(i.id), i])); const wooOf = new Map(subs.map((x) => [String(x.id), x.woo_order_id]));
      const sidOf = (id) => { const i = itemOf.get(String(id)); if (!i) return String(id); const w = i.sub_order_id != null ? wooOf.get(String(i.sub_order_id)) : null; return w != null ? String(w) : String(i.order_id); };
      const stock = lots.map((r) => toStock(r, sidOf)); const byKey = new Map(stock.map((l) => [l.key, l]));
      const ledger = moves.map((m) => toMove(m, byKey));
      const firstIn = new Map(); for (let i = ledger.length - 1; i >= 0; i--) { const m = ledger[i]; if (m.type === 'in' && !firstIn.has(m.key)) firstIn.set(m.key, m); }
      // comments decision 31: a piece that came back as a return and was inspected sound carries the day it arrived (`returnedAt`) —
      // its `since` is the inspection's day from then on («دخل المخزن يتحسب من تاريخ الفحص»)
      stock.forEach((l) => { const f = firstIn.get(l.key); if (f && f.reason === 'مرتجع' && l.reason !== 'مرتجع' && f.at) { const d = String(f.at).slice(0, 10); if (DAY_RE.test(d) && d < String(l.since)) l.returnedAt = d; } });
      const returns = stock.filter((l) => (firstIn.get(l.key) || {}).reason === 'مرتجع' || l.reason === 'مرتجع').map((l) => toReturn(l, firstIn.get(l.key)));
      const itemById = itemOf; const custOf = new Map(orders.map((o) => [String(o.id), o.customer_name || '']));
      const consolidations = cons.map((x) => ({ id: x.id, order: String(x.order_id), customer: custOf.get(String(x.order_id)) || '', since: x.since, zone: x.zone || 'T', by: nameOf(x.created_by),
        subs: links.filter((l) => l.consolidation_id === x.id).map((l) => { const i = itemById.get(String(l.item_id)) || {};
          // a line with an open «تجميع أوردر» lot in the hub has arrived, whatever its line status says (decision 8 — received here, not from the orders page)
          const got = stock.some((s) => !s.closed && s.reason === 'تجميع أوردر' && s.itemId === String(l.item_id)) && !['تم الشحن للعميل', 'مكتمل'].includes(i.status);
          return [sidOf(l.item_id), vendorName(i.vendor_id), got ? 'وصل المخزن' : i.status || 'قيد التنفيذ', i.name || '', String(l.item_id)]; }) }));
      const lastPast = new Map(); past.slice().sort((a, b) => (String(a.created_at) < String(b.created_at) ? -1 : 1)).forEach((x) => lastPast.set(String(x.order_id), x.status));
      const stOf = new Map(orders.map((o) => [String(o.id), o.status || '']));
      looseIds.forEach((oid) => { const k = String(oid); if (lastPast.get(k) === 'cancelled' || ORDER_DONE.includes(stOf.get(k))) return;
        const mine = loose.filter((l) => String(l.order_id) === k); const got = new Set(mine.filter((l) => l.item_id != null).map((l) => String(l.item_id)));
        const lines = looseItems.filter((i) => String(i.order_id) === k && (got.has(String(i.id)) || (!i.removed && !i.pulled && !LINE_DONE.includes(i.status))));
        const rowsOf = lines.map((i) => [sidOf(i.id), vendorName(i.vendor_id), got.has(String(i.id)) ? 'وصل المخزن' : i.status || 'قيد التنفيذ', i.name || '', String(i.id)]);
        mine.forEach((l) => { if (!lines.some((i) => String(i.id) === String(l.item_id))) rowsOf.push([l.item_id != null ? sidOf(l.item_id) : k, vendorName(l.vendor_id), 'وصل المخزن', l.name || '', l.item_id != null ? String(l.item_id) : null]); });
        consolidations.push({ id: null, derived: true, order: k, customer: custOf.get(k) || '', since: mine.map((l) => l.since).sort()[0], zone: (mine.find((l) => l.loc) || {}).loc || 'T', by: '', subs: rowsOf }); });
      const lotLines = (id) => lines.filter((l) => l.count_id === id).map((l) => { const lot = byKey.get(l.lot_id) || {}; return { key: l.lot_id, sku: lot.sku || '', name: lot.name || '', loc: lot.loc || '—', system: l.system, counted: l.counted == null ? '' : String(l.counted), cost: lot.cost || 0, note: l.note || '' }; });
      countRow = open;
      // comments decision 32 (0107): the open count's pause — who and when. Read on its own and tolerantly: before the migration is
      // applied the two columns are not there, and the hub must load all the same (the count is then simply not paused)
      let pause = null;
      if (open) { try { const { data: pr, error: pe } = await cl.from('inv_counts').select('id, paused_at, paused_by').eq('id', open.id).maybeSingle(); if (!pe && pr && pr.paused_at) pause = { at: cairo(pr.paused_at), by: nameOf(pr.paused_by) }; } catch (e) { /* not paused */ } }
      if (g !== gen) return { ok: false, reason: 'stale' };
      const count = open ? { id: 'CNT-' + String(open.id).padStart(2, '0'), dbId: open.id, zone: open.zone, started: cairo(open.started_at), total: 0, base: 0, lines: lotLines(open.id), paused: pause } : null;
      if (count) count.total = count.lines.length;
      const O = window.IbtekrOps;
      const countsHist = counts.filter((x) => x.status === 'approved').map((x) => { const ls = lotLines(x.id).filter((l) => l.counted !== ''); const d = O && O.countDiff ? O.countDiff(ls.map((l) => ({ system: l.system, counted: Number(l.counted), cost: l.cost }))) : { items: 0, value: 0 };
        return { id: 'CNT-' + String(x.id).padStart(2, '0'), date: cairo(x.approved_at).slice(0, 10), zone: x.zone, by: nameOf(x.approved_by), items: d.items, value: d.value, status: 'اتعتمد' }; });
      const racks = locs.map((l) => ({ code: l.code, desc: l.label, kind: l.kind, products: 0, pieces: 0 }));
      data.settings = Object.assign({}, DEFAULTS, pick((set && set.data && set.data.data) || {}));
      Object.assign(S, { stock, ledger, returns, consolidations, count, counts: countsHist, racks, invSettings: Object.assign({}, data.settings) });
      st = 'ready'; emit(); return { ok: true };
    } catch (e) { if (soft) return fail(e); if (g === gen) st = 'error'; emit(); return fail(e); }
  }
  // the known keys with valid values only (a day count 1–90, the switch a boolean, the return default one of two)
  const pick = (o) => { const out = {}; if (!o || typeof o !== 'object') return out;
    if (typeof o.firstWarehouse === 'boolean') out.firstWarehouse = o.firstWarehouse;
    ['consolidationAlert', 'photoMax', 'returnWait'].forEach((k) => { const n = Number(o[k]); if (o[k] !== undefined && o[k] !== null && o[k] !== '' && Number.isInteger(n) && n >= 1 && n <= 90) out[k] = n; });
    if (RETURN_DEFAULTS.includes(o.returnDefault)) out.returnDefault = o.returnDefault;
    return out; };
  function clear() { gen++; st = 'idle'; countRow = null; media = new Map(); const S = store(); if (S) Object.assign(S, { stock: [], ledger: [], returns: [], consolidations: [], count: null, counts: [], racks: [] }); }

  // ---------- writes ----------
  const lotRow = (l) => ({ id: UUID.test(String(l.key)) ? l.key : newKey(), reason: l.reason, status: l.status, sku: l.sku ? String(l.sku).trim().slice(0, 80) : null, name: String(l.name || '').trim().slice(0, 200),
    vendor_id: l.vendorId || vendorIdOf(l.vendor), order_id: l.order && /^\d+$/.test(String(l.order)) ? Number(l.order) : null, item_id: l.itemId && /^\d+$/.test(String(l.itemId)) ? Number(l.itemId) : null,
    ref: l.ref ? String(l.ref).slice(0, 80) : null, loc: locCode(l.loc), mode: modeIn(l.mode), cost: num(l.cost), condition: l.condition || null, condition_note: l.conditionNote ? String(l.conditionNote).slice(0, 500) : null,
    note: l.note ? String(l.note).slice(0, 500) : null, since: /^\d{4}-\d{2}-\d{2}$/.test(String(l.since || '')) ? l.since : today() });
  // «A-02» / «رف A» / «T» → the place's code (the first letter of a known place); unknown → null
  function locCode(v) { const S = store(); const codes = ((S && S.racks) || []).map((r) => r.code); const s = String(v || '').trim(); if (!s || s === '—') return null; if (codes.includes(s)) return s; const m = /([A-Za-z])/.exec(s); return m && codes.includes(m[1].toUpperCase()) ? m[1].toUpperCase() : null; }
  const moveRow = (m) => ({ lot_id: m.key, type: m.type, qty: Math.trunc(num(m.qty)), label: m.label ? String(m.label).slice(0, 80) : null, reason: m.reason ? String(m.reason).slice(0, 80) : null, ref: m.ref && m.ref !== '—' ? String(m.ref).slice(0, 80) : null, note: m.note ? String(m.note).slice(0, 500) : null });


  // a new lot + its first move (one call from the page: receive / arrival)
  async function addLot(lot, move) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    if (!can().edit) return { ok: false, reason: 'forbidden' };
    const row = lotRow(lot); lot.key = row.id;
    try {
      const { error } = await cl.from('inv_lots').insert(row); if (error) return fail(error);
      if (move) { const r = await addMove(Object.assign({}, move, { key: row.id }), true); if (!r.ok) return r; }
      log('inventory.receive', row.reason + ' · ' + (row.sku || row.name) + (move ? ' × ' + move.qty : ''), row.id); return { ok: true, key: row.id };
    } catch (e) { return { ok: false, reason: 'network' }; }
  }
  async function addMove(m, silent) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    if (!can().edit || (m.type === 'adjust' && !can().approve)) return { ok: false, reason: 'forbidden' };
    if (!UUID.test(String(m.key))) return { ok: false, reason: 'invalid' };
    try { const { error } = await cl.from('inv_moves').insert(moveRow(m)); if (error) return fail(error); if (!silent) { log('inventory.move', m.type + ' ' + m.qty + (m.label ? ' · ' + m.label : ''), m.key); } return { ok: true }; }
    catch (e) { return { ok: false, reason: 'network' }; }
  }
  // `since` (comments decision 31): a return «enters the hub» the day it is inspected — the inspection moves the lot's day (a valid day only)
  const LOT_PATCH = { status: 'status', reason: 'reason', loc: 'loc', mode: 'mode', cost: 'cost', note: 'note', condition: 'condition', conditionNote: 'condition_note', since: 'since' };
  const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  // «لسه زي ما أنا شايفه» (live-sync plan decision 6): lot id → its editable columns as the last read had them; a piece a teammate
  // changed a moment ago (its place, its status…) is not written over — 'stale' with the message, and the hub is read again
  let seenL = new Map();
  const quietLoad = () => { const p = quiet(() => load({ quiet: true })); if (p && p.catch) p.catch(() => {}); };
  const STALE_MSG = 'حد تاني غيّر القطعة دي من شوية — اتحدّثت قدامك، راجعها وعدّل تاني لو لسه محتاج';
  async function updateLot(key, patch, action) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    if (!can().edit) return { ok: false, reason: 'forbidden' };
    if (!UUID.test(String(key))) return { ok: false, reason: 'invalid' };
    const row = {}; Object.keys(patch || {}).forEach((k) => { if (k === 'since' && !DAY_RE.test(String(patch[k] || ''))) return; if (LOT_PATCH[k]) row[LOT_PATCH[k]] = k === 'loc' ? locCode(patch[k]) : k === 'mode' ? modeIn(patch[k]) : k === 'cost' ? num(patch[k]) : patch[k]; });
    if (!Object.keys(row).length) return { ok: true };
    const L = window.IBLive; const sn = seenL.get(String(key));
    if (L && L.guarded && sn) {
      const was = {}; Object.keys(row).forEach((k) => { if (Object.prototype.hasOwnProperty.call(sn, k)) was[k] = sn[k]; });
      const r = await L.guarded(cl, 'inv_lots', { id: key }, row, was);
      if (!r.ok) { if (r.reason === 'stale' || r.reason === 'missing') { quietLoad(); return { ok: false, reason: 'stale', message: STALE_MSG }; } return { ok: false, reason: r.reason }; }
      Object.assign(sn, row);
      log(action || 'inventory.lot', Object.keys(row).map((k) => k + ': ' + (k === 'note' || k === 'condition_note' ? '…' : row[k])).join(' · '), key);
      return { ok: true };
    }
    try { const { data: d, error } = await cl.from('inv_lots').update(row).eq('id', key).select('id'); if (error) return fail(error); if (!d || !d.length) return { ok: false, reason: 'forbidden' };
      log(action || 'inventory.lot', Object.keys(row).map((k) => k + ': ' + (k === 'note' || k === 'condition_note' ? '…' : row[k])).join(' · '), key);
      return { ok: true }; }
    catch (e) { return { ok: false, reason: 'network' }; }
  }
  // a consolidation of an order's lines (block 22's «تجميع في المخزن»)
  async function consolidate(orderId, itemIds, zone) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    if (!can().edit) return { ok: false, reason: 'forbidden' };
    const ids = [...new Set((itemIds || []).map(String).filter((x) => /^\d+$/.test(x)))];
    if (!/^\d+$/.test(String(orderId)) || !ids.length) return { ok: false, reason: 'invalid' };
    const id = newKey();
    try {
      const { error } = await cl.from('inv_consolidations').insert({ id, order_id: Number(orderId), zone: locCode(zone) || 'T' }); if (error) return fail(error);
      const { error: e2 } = await cl.from('inv_consolidation_items').insert(ids.map((x) => ({ consolidation_id: id, item_id: Number(x) }))); if (e2) return fail(e2);
      log('inventory.consolidate', 'IB-' + orderId + ' · ' + ids.length, id); return { ok: true, id };
    } catch (e) { return { ok: false, reason: 'network' }; }
  }
  // more lines of the order joining its open consolidation (the server checks: the same order, the consolidation open)
  async function addToConsolidation(id, itemIds) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    if (!can().edit) return { ok: false, reason: 'forbidden' };
    const ids = [...new Set((itemIds || []).map(String).filter((x) => /^\d+$/.test(x)))];
    if (!UUID.test(String(id)) || !ids.length) return { ok: false, reason: 'invalid' };
    try { const { error } = await cl.from('inv_consolidation_items').insert(ids.map((x) => ({ consolidation_id: id, item_id: Number(x) }))); if (error) return fail(error); log('inventory.consolidate.add', ids.length + '', id); return { ok: true }; }
    catch (e) { return { ok: false, reason: 'network' }; }
  }
  async function closeConsolidation(id, status, carrier) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    if (!can().edit) return { ok: false, reason: 'forbidden' };
    if (!UUID.test(String(id)) || !['shipped', 'partial', 'cancelled'].includes(status)) return { ok: false, reason: 'invalid' };
    try { const { data: d, error } = await cl.from('inv_consolidations').update({ status, carrier: carrier ? String(carrier).slice(0, 60) : null }).eq('id', id).select('id'); if (error) return fail(error); if (!d || !d.length) return { ok: false, reason: 'forbidden' };
      log('inventory.consolidation.' + status, id, id); return { ok: true }; }
    catch (e) { return { ok: false, reason: 'network' }; }
  }
  // a count: its lines are the lots with pieces (the system quantity is the server's)
  async function startCount(zone, lotKeys) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    if (!can().edit) return { ok: false, reason: 'forbidden' };
    try {
      const { data: d, error } = await cl.from('inv_counts').insert({ zone: String(zone || '').slice(0, 80) }).select('id').single(); if (error) return fail(error);
      const keys = (lotKeys || []).filter((k) => UUID.test(String(k)));
      if (keys.length) { const { error: e2 } = await cl.from('inv_count_lines').insert(keys.map((k) => ({ count_id: d.id, lot_id: k, system: 0 }))); if (e2) return fail(e2); }
      log('inventory.count.start', zone + ' · ' + keys.length, String(d.id)); return { ok: true, id: d.id };
    } catch (e) { return { ok: false, reason: 'network' }; }
  }
  async function countLine(countId, key, counted, note) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    if (!can().edit) return { ok: false, reason: 'forbidden' };
    const v = counted === '' || counted == null ? null : Math.trunc(num(counted));
    if (v != null && v < 0) return { ok: false, reason: 'invalid' };
    try { const { error } = await cl.from('inv_count_lines').update({ counted: v, note: note ? String(note).slice(0, 300) : null }).eq('count_id', countId).eq('lot_id', key); return error ? fail(error) : { ok: true }; }
    catch (e) { return { ok: false, reason: 'network' }; }
  }
  // comments decision 34: «حفظ» in the count's popup — the lines the member changed, written together (six at a time); the first
  // refusal stops it and says how many went. Logged once, with the number only.
  async function saveCount(countId, lines) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    if (!can().edit) return { ok: false, reason: 'forbidden' };
    const list = (lines || []).filter((l) => l && UUID.test(String(l.key)));
    let done = 0;
    for (let i = 0; i < list.length; i += 6) {
      const rs = await Promise.all(list.slice(i, i + 6).map((l) => countLine(countId, l.key, l.counted, l.note)));
      const bad = rs.find((r) => !r.ok); done += rs.filter((r) => r.ok).length;
      if (bad) return Object.assign({ saved: done }, bad);
    }
    if (done) log('inventory.count.save', 'CNT-' + countId + ' · ' + done, String(countId));
    return { ok: true, saved: done };
  }
  // comments decision 32 (0107): «إيقاف مؤقت» / «كمّل الجرد» on the open count — the server stamps who and when; while it is paused
  // its lines take no write and it is not approved. `unavailable`: the columns are not there yet (the migration not applied).
  async function pauseCount(countId, on) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    if (!can().edit) return { ok: false, reason: 'forbidden' };
    if (!Number.isInteger(Number(countId))) return { ok: false, reason: 'invalid' };
    try {
      const { data: d, error } = await cl.from('inv_counts').update({ paused_at: on ? new Date().toISOString() : null }).eq('id', Number(countId)).eq('status', 'open').select('id');
      if (error) return /PGRST204|42703/.test(String(error.code || '')) ? { ok: false, reason: 'unavailable' } : fail(error);
      if (!d || !d.length) return { ok: false, reason: 'forbidden' };
      log(on ? 'inventory.count.pause' : 'inventory.count.resume', 'CNT-' + countId, String(countId)); return { ok: true };
    } catch (e) { return { ok: false, reason: 'network' }; }
  }
  async function approveCount(countId) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    if (!can().approve) return { ok: false, reason: 'forbidden' };
    try { const { data: n, error } = await cl.rpc('inv_count_approve', { p_id: Number(countId) }); if (error) return fail(error); log('inventory.count.approve', 'CNT-' + countId + ' · ' + n, String(countId));
      return { ok: true, adjusted: Number(n) || 0 }; }
    catch (e) { return { ok: false, reason: 'network' }; }
  }
  // the settings row alone (the settings page's «المخزن» section reads it without loading the hub)
  async function loadSettings() {
    const cl = c(); if (!cl) return Object.assign({}, data.settings);
    try { const { data: row } = await cl.from('settings').select('data').eq('section', 'inventory').maybeSingle();
      data.settings = Object.assign({}, DEFAULTS, pick((row && row.data) || {})); emit(); }
    catch (e) { /* keep what we had */ }
    return Object.assign({}, data.settings);
  }
  async function saveSettings(patch) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    if (!can().admin) return { ok: false, reason: 'forbidden' };
    const clean = pick(patch || {}); if (!Object.keys(clean).length) return { ok: false, reason: 'invalid' };
    const next = Object.assign({}, DEFAULTS, pick(data.settings), clean);
    try { const { error } = await cl.from('settings').upsert({ section: 'inventory', data: next }, { onConflict: 'section' }); if (error) return fail(error);
      data.settings = next; const S = store(); if (S) S.invSettings = Object.assign({}, next); log('inventory.settings', Object.keys(clean).join(', '), 'inventory'); emit(); return { ok: true }; }
    catch (e) { return { ok: false, reason: 'network' }; }
  }

  window.IBInventory = { load, clear, media: mediaOf, state: () => st, can, today, cairo, newKey, settings: () => Object.assign({}, data.settings), DEFAULTS, PLACES, RETURN_DEFAULTS, loadSettings,
    addLot, addMove, updateLot, consolidate, addToConsolidation, closeConsolidation, startCount, countLine, saveCount, pauseCount, approveCount, saveSettings, countId: () => (countRow ? countRow.id : null),
    _test: { toStock, toMove, toReturn, lotRow, moveRow, locCode, modeIn, modeOut } };
})();
