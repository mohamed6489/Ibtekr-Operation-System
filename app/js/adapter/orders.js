// Orders (phase 2): the last 12 months of orders_v (its customer_phone is already masked for a role without
// sensitive.customer_phone) with their lines (order_items; removed ones are never shown), the Dokan sub-orders, the
// vendors' names, the shown products' images and status_map → block 29's screen shape (toScreen, pure), handed to
// OrdersApp.hydrate (block 29 may also read data() when it starts after the load). data() is null until a load succeeded;
// state() is 'idle' | 'loading' | 'ready' | 'error' (each change dispatches ib:orders; data() keeps the last good load, and
// load() may be called again to retry). A row that repeats across two pages (an order placed mid-load) is kept once.
// `age` counts days from the order's local date to today() — the real local date, never IBKit.TODAY (the prototype's
// fixed date); never below 0.
// Grants are column lists (0007): every read names its columns (select('*') on orders / order_items / sub_orders is
// refused) and every write is an update of granted columns without .select() (return=minimal). The base table orders
// is never read: its phone column is not granted.
// Writes are write-through (block 29 changes its own copy first, then calls IBOrdersStore = IBOrders): 42501 →
// { ok:false, reason:'forbidden' }, any other failure → { ok:false, reason:'network' }, never thrown; a success is
// logged with K.logEvent, ids and statuses only. setOrderStatus then asks woo-sync to push the status to WooCommerce and
// answers its result in `push` ('ok' | 'skipped' | 'error') without failing the write.
// A sub's `n` is its order_items id (block 29 finds a sub by n across every order: allSub/editSub), `itemId` the same
// as text — the id the item writes take. subscribe() adds Realtime INSERT/UPDATE on orders / order_items / sub_orders
// (skipped with IB_CONFIG.realtime === false): each event re-reads that order from orders_v (a payload from orders
// never carries the phone) with its lines and sub-orders, rebuilds it, hands it to OrdersApp.applyOrder and
// dispatches ib:notify; an order the screen does not have and placed before the 12-month window is left out.
// clear() (IBDirectory.clear) unsubscribes and drops everything (state 'idle'); a load in flight is abandoned.
(function () {
  'use strict';
  const PAGE = 1000, CAP = 5000, IDS = 200, SKUS = 100; // PostgREST max_rows; ids / skus per in.(…) keep the URL short
  const COLS = {
    order: 'id, customer_name, customer_phone, customer_city, customer_address, payment_method, payment_title, status, woo_status, confirm, confirm_at, deposit, total, note, placed_at, cancel, ret',
    item: 'id, order_id, sub_order_id, sku, name, qty, total, vendor_id, status, expected_at, comment, ready_at, waybill, pulled, ret, store, removed',
    sub: 'id, order_id, vendor_id, woo_order_id, woo_status',
  };
  let orders = null; let vendorRows = []; let images = {}; let statuses = []; let names = []; let channel = null; let gen = 0; let st = 'idle';
  const asked = new Set(); // skus already asked of products
  const busy = new Map(); // order id → its running Realtime refetch
  const c = () => (window.IBSupabase && window.IBSupabase.client) || null;
  const uid = () => { const s = window.IBAuth && window.IBAuth.session(); return (s && s.user && s.user.id) || null; };
  const quiet = (fn) => { try { return fn(); } catch (e) { return undefined; } };
  // block 29's hooks: an error there must not stop the load or the ib:notify, but it is not hidden either (thrown later)
  const report = (fn) => { try { fn(); } catch (e) { if (typeof window.setTimeout === 'function') window.setTimeout(() => { throw e; }, 0); } };
  const notify = () => { document.dispatchEvent(new Event('ib:notify')); };
  const setState = (v) => { if (st === v) return; st = v; document.dispatchEvent(new Event('ib:orders')); };
  const has = (o, k) => !!o && o[k] !== undefined;

  // ---------- the screen shape (pure) ----------
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const local = (iso) => { const d = new Date(iso || NaN); return isNaN(d) ? null : d; }; // the browser's clock (Africa/Cairo)
  const today = () => ymd(new Date()); // the real local date, 'YYYY-MM-DD'
  const windowStart = () => { const d = new Date(); d.setMonth(d.getMonth() - 12); return d; }; // the oldest placed_at shown
  const localDate = (iso) => { const d = local(iso); return d ? ymd(d) : ''; };
  const localStamp = (iso) => { const d = local(iso); return d ? ymd(d) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) : ''; };
  // block 29's 'YYYY-MM-DD HH:MM' (local clock) → ISO; '' / null → null
  const toIso = (s) => { if (!s) return null; const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(s); const d = m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5]) : new Date(s); return isNaN(d) ? null : d.toISOString(); };
  const utc = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? Date.UTC(+m[1], m[2] - 1, +m[3]) : NaN; };
  const days = (from, to) => { const n = Math.round((utc(to) - utc(from)) / 864e5); return Number.isFinite(n) ? Math.max(0, n) : 0; };
  const byName = (a, b) => { const x = a.toLowerCase(), y = b.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; };
  function sub(it, o, subById, vname) {
    const so = it.sub_order_id == null ? null : subById.get(String(it.sub_order_id)) || null;
    const vid = it.vendor_id || (so && so.vendor_id);
    return { n: Number(it.id), itemId: String(it.id), sid: so && so.woo_order_id != null ? String(so.woo_order_id) : String(it.id), oid: String(o.id), prod: it.name || '', qty: Number(it.qty) || 0, tot: Number(it.total) || 0,
      raw: (so && so.woo_status) || o.woo_status || '', vendor: (vid && vname.get(String(vid))) || '', cm: it.comment || '', ss: it.status || '', exp: it.expected_at || '', sku: it.sku || '',
      readyAt: localStamp(it.ready_at), waybill: it.waybill || null, pulled: !!it.pulled, ret: it.ret || null, store: it.store || null };
  }
  // orders_v rows + their order_items / sub_orders rows + vendors ({ id, name }) → the orders of block 29; ages up to
  // opts.today ('YYYY-MM-DD'), by default today()
  function toScreen(rows, items, subs, vendors, opts = {}) {
    const T = (opts && opts.today) || today();
    const vname = new Map((vendors || []).map((v) => [String(v.id), v.name || '']));
    const subById = new Map((subs || []).map((s) => [String(s.id), s]));
    const lines = new Map();
    (items || []).filter((it) => !it.removed).sort((a, b) => Number(a.id) - Number(b.id)).forEach((it) => { const k = String(it.order_id); if (!lines.has(k)) lines.set(k, []); lines.get(k).push(it); });
    return (rows || []).map((r) => {
      const id = String(r.id); const date = localDate(r.placed_at);
      return { id, name: r.customer_name || '', phone: r.customer_phone || '', pay: r.payment_title || r.payment_method || '', date, st: r.status, cf: r.confirm, dep: Number(r.deposit) || 0, tot: Number(r.total) || 0,
        age: days(date, T), note: r.note || '', cdate: r.confirm_at || '', confAt: r.confirm_at || '', city: r.customer_city || '', addr: r.customer_address || '', cancel: r.cancel || null, ret: r.ret || null,
        subs: (lines.get(id) || []).map((it) => sub(it, r, subById, vname)) };
    });
  }
  const vendorNames = (list) => [...new Set(list.flatMap((o) => o.subs.map((s) => s.vendor)).filter(Boolean))].sort(byName);

  // ---------- load ----------
  const data = () => (orders ? { orders, vendors: names, images, statuses } : null);
  const stale = (g) => { if (g !== gen) throw new Error('stale'); };
  const uniq = (rows) => { const seen = new Set(); return rows.filter((r) => { const k = String(r.id); if (seen.has(k)) return false; seen.add(k); return true; }); };
  // every page of one query (PostgREST answers at most max_rows); throws the first error, or once clear() ran
  async function pages(build, g, cap = Infinity) {
    const rows = [];
    for (let from = 0; from < cap; from += PAGE) {
      if (from) stale(g);
      const { data: d, error } = await build().range(from, from + PAGE - 1);
      if (error) throw error;
      rows.push(...(d || []));
      if (!d || d.length < PAGE) break;
    }
    return rows;
  }
  // rows of `table` whose `col` is in `list`, asked in chunks of `size`
  function within(cl, table, cols, col, list, size, g) {
    const parts = []; for (let i = 0; i < list.length; i += size) parts.push(list.slice(i, i + size));
    return Promise.all(parts.map((p) => pages(() => cl.from(table).select(cols).in(col, p).order('id', { ascending: true }), g))).then((r) => r.flat());
  }
  async function load() {
    const cl = c();
    if (!cl || !uid()) return;
    const g = ++gen;
    setState('loading');
    try {
      const [found, vs, sm] = await Promise.all([
        pages(() => cl.from('orders_v').select(COLS.order).gte('placed_at', windowStart().toISOString()).order('placed_at', { ascending: false }).order('id', { ascending: false }), g, CAP),
        pages(() => cl.from('vendors').select('id, name').order('id', { ascending: true }), g),
        cl.from('status_map').select('system_status, woo_status, direction, sort').order('sort', { ascending: true }),
      ]);
      if (sm.error) throw sm.error;
      stale(g);
      const rows = uniq(found); // an order placed while paging shifts the next page by one
      const ids = rows.map((r) => r.id);
      const [items, subs] = await Promise.all([within(cl, 'order_items', COLS.item, 'order_id', ids, IDS, g), within(cl, 'sub_orders', COLS.sub, 'order_id', ids, IDS, g)]);
      stale(g);
      const skus = [...new Set(items.filter((it) => !it.removed && it.sku).map((it) => it.sku))];
      const ps = await within(cl, 'products', 'sku, image_url', 'sku', skus, SKUS, g);
      stale(g);
      vendorRows = vs; statuses = sm.data || []; images = {}; asked.clear();
      skus.forEach((s) => asked.add(s)); ps.forEach((p) => { if (p.image_url) images[p.sku] = p.image_url; });
      orders = toScreen(rows, items, subs, vendorRows); names = vendorNames(orders);
      setState('ready');
      const app = window.OrdersApp; if (app && app.hydrate) report(() => app.hydrate(data()));
      notify(); // the bell and the dashboard read the orders
    } catch (e) { if (g === gen) setState('error'); /* offline or refused: the screen keeps what it had; cleared: 'idle' */ }
  }

  // ---------- writes ----------
  const fail = (reason) => ({ ok: false, reason });
  async function update(table, id, patch) {
    const cl = c();
    if (!cl || !uid()) return fail('network');
    try { const { error } = await cl.from(table).update(patch).eq('id', id); return error ? fail(error.code === '42501' ? 'forbidden' : 'network') : { ok: true }; } catch (e) { return fail('network'); }
  }
  const log = (action, detail) => { const K = window.IBKit; if (K && K.logEvent) quiet(() => K.logEvent(action, detail)); };
  const itemRef = (itemId) => { const o = (orders || []).find((x) => x.subs.some((s) => s.itemId === String(itemId))); return (o ? 'IB-' + o.id + ' · ' : '') + '#' + itemId; };
  async function invoke(body) {
    const cl = c();
    if (!cl || !uid()) return fail('network');
    try {
      const { data: d, error } = await cl.functions.invoke('woo-sync', { body });
      if (error) { const st = error.context && error.context.status; return fail(st === 401 || st === 403 ? 'forbidden' : 'network'); }
      return { ok: true, data: d || {} };
    } catch (e) { return fail('network'); }
  }
  async function setOrderStatus(id, status, extra) {
    const patch = { status };
    if (extra && extra.cancel) patch.cancel = extra.cancel;
    if (extra && extra.ret) patch.ret = extra.ret;
    const r = await update('orders', id, patch);
    if (!r.ok) return r;
    log('order.status', 'IB-' + id + ' · ' + status);
    const p = await invoke({ action: 'push_status', order_id: Number(id), status }); // after the row: woo-sync pushes the stored status only
    return { ok: true, push: (p.ok && p.data.result) || 'error' };
  }
  async function setConfirm(id, cf, opts) {
    const patch = {};
    if (cf !== undefined && cf !== null) patch.confirm = cf;
    if (has(opts, 'confAt')) patch.confirm_at = opts.confAt || null;
    if (has(opts, 'note')) patch.confirm_note = opts.note;
    if (!Object.keys(patch).length) return { ok: true };
    const r = await update('orders', id, patch);
    if (r.ok) log('order.confirm', 'IB-' + id + (patch.confirm !== undefined ? ' · ' + cf : ''));
    return r;
  }
  const FIELDS = { note: 'note', city: 'customer_city', addr: 'customer_address', dep: 'deposit' };
  async function patchOrder(id, f) {
    const keys = Object.keys(FIELDS).filter((k) => has(f, k));
    if (!keys.length) return { ok: true };
    const dep = !has(f, 'dep') ? 0 : typeof f.dep === 'number' ? f.dep : typeof f.dep === 'string' && f.dep.trim() ? Number(f.dep) : NaN;
    if (!Number.isFinite(dep)) return fail('invalid'); // never a silent 0
    const patch = {}; keys.forEach((k) => { patch[FIELDS[k]] = k === 'dep' ? dep : f[k]; });
    const r = await update('orders', id, patch);
    if (r.ok) log('order.patch', 'IB-' + id + ' · ' + keys.join(', ')); // which fields, never their text
    return r;
  }
  async function setItemStatus(itemId, ss, extra) {
    const patch = {};
    if (ss !== undefined && ss !== null) patch.status = ss;
    if (has(extra, 'exp')) patch.expected_at = extra.exp || null;
    if (has(extra, 'cm')) patch.comment = extra.cm;
    if (has(extra, 'ret')) patch.ret = extra.ret || null;
    if (has(extra, 'store')) patch.store = extra.store || null;
    if (has(extra, 'readyAt')) patch.ready_at = toIso(extra.readyAt);
    if (!Object.keys(patch).length) return { ok: true };
    const r = await update('order_items', itemId, patch);
    if (r.ok) log('suborder.status', itemRef(itemId) + (patch.status !== undefined ? ' · ' + ss : ''));
    return r;
  }
  async function setWaybill(itemId, w) {
    const r = await update('order_items', itemId, { waybill: w == null ? null : w });
    if (r.ok) log('suborder.waybill', itemRef(itemId));
    return r;
  }
  async function setPulled(itemId, on) {
    const r = await update('order_items', itemId, { pulled: !!on });
    if (r.ok) log('suborder.pulled', itemRef(itemId) + ' · ' + (on ? 'سحب من المتاح' : 'إلغاء السحب'));
    return r;
  }
  async function syncNow() { const r = await invoke({ action: 'all' }); return r.ok ? { ok: true, counts: r.data.counts || {} } : r; }
  async function registerWebhooks() {
    const cfg = window.IB_CONFIG || {};
    const r = await invoke({ action: 'register_webhooks', delivery_url: String(cfg.supabaseUrl || '').replace(/\/+$/, '') + '/functions/v1/woo-webhook' });
    return r.ok ? { ok: true, list: r.data.webhooks || [] } : r;
  }

  // ---------- Realtime ----------
  // vendors and product images the maps do not know yet (a maker or a product new since the load)
  async function fill(cl, items, subs, g) {
    const known = new Set(vendorRows.map((v) => String(v.id)));
    const vids = [...new Set(items.concat(subs).map((x) => x.vendor_id).filter((v) => v && !known.has(String(v))))];
    const skus = [...new Set(items.filter((x) => !x.removed && x.sku && !asked.has(x.sku)).map((x) => x.sku))];
    const none = { data: [], error: null };
    const [v, p] = await Promise.all([vids.length ? cl.from('vendors').select('id, name').in('id', vids) : none, skus.length ? cl.from('products').select('sku, image_url').in('sku', skus) : none]);
    stale(g);
    if (!v.error) vendorRows = vendorRows.concat(v.data || []);
    if (!p.error) { skus.forEach((s) => asked.add(s)); (p.data || []).forEach((x) => { if (x.image_url) images[x.sku] = x.image_url; }); }
  }
  async function refresh(id) {
    const cl = c(); const g = gen;
    if (!cl || !orders) return;
    try {
      const [o, it, so] = await Promise.all([cl.from('orders_v').select(COLS.order).eq('id', id), cl.from('order_items').select(COLS.item).eq('order_id', id), cl.from('sub_orders').select(COLS.sub).eq('order_id', id)]);
      if (o.error || it.error || so.error || !(o.data || []).length) return;
      const known = orders.some((x) => x.id === String(o.data[0].id));
      if (!known && !(Date.parse(o.data[0].placed_at) >= windowStart().getTime())) return; // older than the screen's 12 months
      await fill(cl, it.data || [], so.data || [], g);
      if (!orders) return;
      const next = toScreen(o.data.slice(0, 1), it.data || [], so.data || [], vendorRows)[0];
      const i = orders.findIndex((x) => x.id === next.id);
      if (i >= 0) orders[i] = next; else orders.unshift(next);
      names = vendorNames(orders);
      const app = window.OrdersApp; if (app && app.applyOrder) report(() => app.applyOrder(next));
      notify();
    } catch (e) { /* the next event or load brings it */ }
  }
  // one refetch per order at a time; events that arrive meanwhile ask for one more round
  function refetch(id) {
    const run = busy.get(id);
    if (run) { run.again = true; return run.done; }
    const st = { again: true };
    st.done = (async () => { try { while (st.again) { st.again = false; await refresh(id); } } finally { if (busy.get(id) === st) busy.delete(id); } })();
    busy.set(id, st);
    return st.done;
  }
  function onChange(p) {
    const row = p && p.new; if (!row) return undefined;
    const id = p.table === 'orders' ? row.id : row.order_id;
    return id == null ? undefined : refetch(String(id));
  }
  function subscribe() {
    const cl = c(); const cfg = window.IB_CONFIG || {};
    if (channel || !cl || !uid() || cfg.realtime === false) return;
    try {
      let ch = cl.channel('orders');
      ['orders', 'order_items', 'sub_orders'].forEach((table) => ['INSERT', 'UPDATE'].forEach((event) => { ch = ch.on('postgres_changes', { event, schema: 'public', table }, onChange); }));
      channel = ch.subscribe();
    } catch (e) { channel = null; /* no live updates; load() still works */ }
  }
  function unsubscribe() {
    const ch = channel; channel = null;
    if (ch && c()) { try { Promise.resolve(c().removeChannel(ch)).catch(() => {}); } catch (e) { /* already closed */ } }
  }
  function clear() { gen += 1; unsubscribe(); orders = null; vendorRows = []; images = {}; statuses = []; names = []; asked.clear(); busy.clear(); setState('idle'); }
  window.IBOrders = { load, data, state: () => st, today, setOrderStatus, setConfirm, patchOrder, setItemStatus, setWaybill, setPulled, syncNow, registerWebhooks, subscribe, unsubscribe, clear, toScreen };
  window.IBOrdersStore = window.IBOrders; // the name block 29's write hooks call
})();
