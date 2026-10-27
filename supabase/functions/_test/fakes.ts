// deno-lint-ignore-file no-explicit-any
// Test doubles for the Woo Edge Functions (never deployed: nothing outside this folder imports it).
// fakeDb: an in-memory stand-in for the supabase-js client with the surface the functions use — from(t).select /
//   insert / upsert({onConflict}) / update, the filters eq / in / not('in') / is, select-after-write, single /
//   maybeSingle, and rpc(). It knows the 0007 columns (+ products.permalink of 0009, orders.customer_state and woo_states
//   of 0010, the team columns of vendors, vendor_rates and order_items.commission_rate / commission_fee of 0011, `leave`
//   of 0012, the phase-3.3 columns of vendors, vendor_rates.flat, vendor_category_rates and woo_categories of 0014, and
//   activity_log of 0002), not-null columns, checks, unique keys and the foreign keys the sync relies on, so a wrong column, a bad
//   value or a missing parent fails like PostgREST would ({ data, error }, 23505 for a duplicate key). A statement is
//   atomic. Every call is recorded in `calls` in order.
// fakeWoo: a fetch that routes "METHOD path" (path after /wp-json/) to a reply (or a network error) and records every
//   request.

type Row = Record<string, any>;
type DbErr = { code: string; message: string; details?: string };

const COLUMNS: Record<string, string[]> = {
  status_map: ['id', 'system_status', 'woo_status', 'direction', 'sort'],
  vendors: ['id', 'woo_vendor_id', 'name', 'aliases', 'phone', 'email', 'status', 'commission_pct', 'raw', 'created_at', 'updated_at',
    'legal_name', 'category', 'alt_phone', 'address', 'instagram', 'store_url', 'lead_days', 'deposit_policy', 'notes', 'joined_at', 'contract', 'opening_balance',
    'contact_name', 'address_parts', 'social', 'logo_url', 'banner_url', 'woo_payment_methods', 'woo_snapshot', 'push_pending', 'woo_synced_at'],
  vendor_rates: ['id', 'vendor_id', 'rate', 'flat', 'since', 'set_by', 'created_at'],
  vendor_category_rates: ['id', 'vendor_id', 'woo_category_id', 'rate', 'flat', 'since', 'set_by', 'created_at'],
  woo_categories: ['id', 'name', 'slug', 'parent_id', 'updated_at'],
  activity_log: ['id', 'at', 'actor', 'action', 'entity', 'entity_id', 'old_value', 'new_value'],
  products: ['id', 'sku', 'name', 'image_url', 'vendor_id', 'price', 'status', 'raw', 'updated_at', 'permalink'],
  orders: ['id', 'number', 'customer_name', 'customer_phone', 'customer_city', 'customer_address', 'payment_method',
    'payment_title', 'status', 'woo_status', 'confirm', 'confirm_at', 'confirm_note', 'deposit', 'total', 'currency', 'note',
    'customer_note', 'placed_at', 'woo_updated_at', 'cancel', 'ret', 'raw', 'synced_at', 'created_at', 'updated_at', 'customer_state'],
  sub_orders: ['id', 'order_id', 'vendor_id', 'woo_order_id', 'woo_status', 'total', 'dokan_earning', 'commission', 'raw', 'updated_at'],
  order_items: ['id', 'order_id', 'sub_order_id', 'product_id', 'sku', 'name', 'qty', 'total', 'vendor_id', 'status',
    'expected_at', 'comment', 'ready_at', 'waybill', 'pulled', 'ret', 'store', 'removed', 'raw', 'updated_at', 'commission_rate', 'commission_fee'],
  woo_webhook_events: ['id', 'received_at', 'delivery_id', 'webhook_id', 'topic', 'resource_id', 'status', 'error', 'payload'],
  woo_sync_log: ['id', 'at', 'kind', 'direction', 'entity', 'entity_id', 'action', 'result', 'detail'],
  sync_state: ['key', 'value', 'updated_at'],
  woo_states: ['code', 'name', 'updated_at'],
};
const DEFAULTS: Record<string, Row> = {
  status_map: { direction: 'both' },
  vendors: { aliases: [], status: 'active', lead_days: 7, opening_balance: 0 },
  orders: { confirm: 'غير مؤكد', deposit: 0, total: 0, currency: 'EGP' },
  order_items: { qty: 1, total: 0, status: '', pulled: false, removed: false },
  sync_state: { value: {} },
};
const SERIAL: Record<string, 'int' | 'uuid'> = { status_map: 'int', vendors: 'uuid', sub_orders: 'int', woo_webhook_events: 'int', woo_sync_log: 'int',
  vendor_rates: 'int', vendor_category_rates: 'int', activity_log: 'int' };
const UNIQUE: Record<string, string[][]> = {
  status_map: [['id'], ['system_status']], vendors: [['id'], ['woo_vendor_id']], products: [['id']], orders: [['id']],
  sub_orders: [['id'], ['woo_order_id'], ['order_id', 'vendor_id']], order_items: [['id']],
  woo_webhook_events: [['id'], ['delivery_id']], woo_sync_log: [['id']], sync_state: [['key']], woo_states: [['code']],
  vendor_rates: [['id'], ['vendor_id', 'since']], vendor_category_rates: [['id'], ['vendor_id', 'woo_category_id', 'since']], woo_categories: [['id']], activity_log: [['id']],
};
const NOT_NULL: Record<string, string[]> = {
  status_map: ['system_status'], vendors: ['name', 'aliases', 'status'], products: ['name'],
  orders: ['number', 'customer_name', 'status', 'confirm', 'deposit', 'total', 'placed_at'],
  order_items: ['order_id', 'name', 'qty', 'total', 'status', 'pulled', 'removed'], sub_orders: ['order_id'],
  woo_webhook_events: ['topic', 'status'], woo_sync_log: ['kind', 'result'], sync_state: ['value'], woo_states: ['code', 'name'],
  vendor_rates: ['vendor_id', 'rate', 'since'], vendor_category_rates: ['vendor_id', 'woo_category_id', 'since'], woo_categories: ['name'], activity_log: ['action'],
};
const CHECK: Record<string, Record<string, unknown[]>> = {
  vendors: { status: ['active', 'leave', 'inactive'] },
  woo_webhook_events: { status: ['ok', 'ignored', 'duplicate', 'error'] },
  woo_sync_log: { kind: ['webhook', 'sync', 'push', 'manual', 'cron'], direction: [null, 'in', 'out'], result: ['ok', 'error', 'conflict', 'skipped'] },
};
// numeric checks of 0011 / 0014: rate 0–65, flat ≥ 0 (null passes)
const RANGE: Record<string, Record<string, [number, number]>> = {
  vendor_rates: { rate: [0, 65], flat: [0, Infinity] }, vendor_category_rates: { rate: [0, 65], flat: [0, Infinity], woo_category_id: [1, Infinity] },
};
// [column, referenced table, referenced column]
const FK: Record<string, [string, string, string][]> = {
  orders: [['status', 'status_map', 'system_status']],
  products: [['vendor_id', 'vendors', 'id']],
  vendor_rates: [['vendor_id', 'vendors', 'id']], vendor_category_rates: [['vendor_id', 'vendors', 'id']],
  sub_orders: [['order_id', 'orders', 'id'], ['vendor_id', 'vendors', 'id']],
  order_items: [['order_id', 'orders', 'id'], ['sub_order_id', 'sub_orders', 'id'], ['vendor_id', 'vendors', 'id']],
};

const same = (a: unknown, b: unknown) => a !== null && a !== undefined && b !== null && b !== undefined && String(a) === String(b);
const clone = <T>(v: T): T => structuredClone(v);
const err = (code: string, message: string, details?: string): DbErr => ({ code, message, ...(details ? { details } : {}) });
const colsOf = (spec: string) => spec.split(',').map((c) => c.trim()).filter(Boolean);

export type Call = { table?: string; op: string; rows?: Row[]; patch?: Row; filters?: unknown[]; onConflict?: string; returning?: string | null; name?: string; args?: unknown; error?: DbErr | null };

export function fakeDb(seed: Record<string, Row[]> = {}, opts: { rpc?: Record<string, (args: any) => unknown>; fail?: (call: Call) => DbErr | null } = {}) {
  const tables: Record<string, Row[]> = Object.fromEntries(Object.keys(COLUMNS).map((t) => [t, []]));
  const calls: Call[] = [];
  let serial = 1000;

  function complete(table: string, row: Row): Row {
    const full: Row = Object.fromEntries(COLUMNS[table].map((c) => [c, null]));
    Object.assign(full, clone(DEFAULTS[table] ?? {}), clone(row));
    if (SERIAL[table] && full.id == null) {
      serial += 1;
      full.id = SERIAL[table] === 'uuid' ? `00000000-0000-4000-8000-${String(serial).padStart(12, '0')}` : serial;
    }
    return full;
  }

  function validate(table: string, rows: Row[], all: Record<string, Row[]>): DbErr | null {
    for (const row of rows) {
      for (const c of NOT_NULL[table] ?? []) if (row[c] === null || row[c] === undefined) return err('23502', `null value in column "${c}" of relation "${table}" violates not-null constraint`, `Failing row contains (${Object.values(row).join(', ')})`);
      for (const [c, allowed] of Object.entries(CHECK[table] ?? {})) if (!allowed.includes(row[c] ?? null)) return err('23514', `new row for relation "${table}" violates check constraint "${table}_${c}_check"`);
      for (const [c, [lo, hi]] of Object.entries(RANGE[table] ?? {})) if (row[c] != null && (Number(row[c]) < lo || Number(row[c]) > hi)) return err('23514', `new row for relation "${table}" violates check constraint "${table}_${c}_check"`);
      for (const [c, ref, refCol] of FK[table] ?? []) {
        if (row[c] !== null && row[c] !== undefined && !all[ref].some((r) => same(r[refCol], row[c]))) return err('23503', `insert or update on table "${table}" violates foreign key constraint "${table}_${c}_fkey"`);
      }
    }
    for (const key of UNIQUE[table] ?? []) {
      const seen = new Set<string>();
      for (const row of all[table]) {
        if (key.some((c) => row[c] === null || row[c] === undefined)) continue;
        const k = key.map((c) => String(row[c])).join('|');
        if (seen.has(k)) return err('23505', `duplicate key value violates unique constraint "${table}_${key.join('_')}_key"`);
        seen.add(k);
      }
    }
    return null;
  }

  function checkColumns(table: string, names: string[]): DbErr | null {
    if (!COLUMNS[table]) return err('42P01', `relation "public.${table}" does not exist`);
    const bad = names.find((c) => c !== '*' && !COLUMNS[table].includes(c));
    return bad ? err('42703', `column "${bad}" of relation "${table}" does not exist`) : null;
  }

  function matches(row: Row, filters: any[]): boolean {
    return filters.every(([kind, col, value]) => {
      if (kind === 'eq') return same(row[col], value);
      if (kind === 'in') return (value as unknown[]).some((v) => same(row[col], v));
      if (kind === 'is') return value === null ? row[col] === null || row[col] === undefined : row[col] === value;
      if (kind === 'not.in') return !String(value).replace(/^\(|\)$/g, '').split(',').some((v) => same(row[col], v.trim()));
      throw new Error(`fakeDb: unsupported filter ${kind}`);
    });
  }

  const project = (rows: Row[], spec: string) => rows.map((r) => (spec.trim() === '*' ? clone(r) : Object.fromEntries(colsOf(spec).map((c) => [c, clone(r[c])]))));

  function run(q: any): { data: any; error: DbErr | null } {
    const call: Call = { table: q.table, op: q.op, filters: q.filters, ...(q.rows ? { rows: clone(q.rows) } : {}), ...(q.patch ? { patch: clone(q.patch) } : {}), ...(q.onConflict ? { onConflict: q.onConflict } : {}), returning: q.returning };
    calls.push(call);
    const done = (data: any, error: DbErr | null = null) => { call.error = error; return { data: error ? null : data, error }; };
    const injected = opts.fail?.(call);
    if (injected) return done(null, injected);
    const table = q.table as string;
    const names = [...(q.rows ?? []).flatMap((r: Row) => Object.keys(r)), ...Object.keys(q.patch ?? {}), ...q.filters.map((f: any) => f[1]),
      ...(q.op === 'select' ? colsOf(q.columns) : []), ...(q.returning ? colsOf(q.returning) : []), ...(q.onConflict ? colsOf(q.onConflict) : [])];
    const colErr = checkColumns(table, names);
    if (colErr) return done(null, colErr);

    if (q.op === 'select') {
      let rows = tables[table].filter((r) => matches(r, q.filters));
      if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
      return finish(done, project(rows, q.columns), q.single);
    }
    const next = clone(tables);
    let touched: Row[] = [];
    if (q.op === 'insert') {
      touched = q.rows.map((r: Row) => complete(table, r));
      next[table].push(...touched);
    } else if (q.op === 'upsert') {
      const key = colsOf(q.onConflict ?? 'id');
      const hit = new Set<Row>();
      for (const r of q.rows) {
        const found = next[table].find((x) => key.every((c) => same(x[c], r[c])));
        // Postgres forms the proposed tuple before `on conflict`: a not-null column without a default that is missing from the
        // upserted row fails even when the conflicting row carries it (seen live on vendors.name, 26 Oct)
        for (const c of NOT_NULL[table] ?? []) if ((!(c in r) && !(c in (DEFAULTS[table] ?? {}))) || r[c] === null) return done(null, err('23502', `null value in column "${c}" of relation "${table}" violates not-null constraint`));
        if (found && hit.has(found)) return done(null, err('21000', 'ON CONFLICT DO UPDATE command cannot affect row a second time'));
        if (found) { Object.assign(found, clone(r)); hit.add(found); touched.push(found); } else { const row = complete(table, r); next[table].push(row); hit.add(row); touched.push(row); }
      }
    } else if (q.op === 'update') {
      touched = next[table].filter((r) => matches(r, q.filters));
      for (const r of touched) Object.assign(r, clone(q.patch));
    }
    const bad = validate(table, touched, next);
    if (bad) return done(null, bad);
    for (const t of Object.keys(next)) tables[t] = next[t];
    return finish(done, q.returning ? project(touched, q.returning) : null, q.single);
  }

  function finish(done: (d: any, e?: DbErr | null) => any, data: any, single: string | null) {
    if (!single) return done(data);
    const rows = data ?? [];
    if (rows.length > 1 || (single === 'one' && rows.length !== 1)) return done(null, err('PGRST116', 'JSON object requested, multiple (or no) rows returned'));
    return done(rows[0] ?? null);
  }

  function from(table: string) {
    const q: any = { table, op: 'select', columns: '*', filters: [], returning: null, single: null, range: null };
    const b: any = {
      select(columns = '*') { if (q.op === 'select') q.columns = columns; else q.returning = columns; return b; },
      insert(rows: Row | Row[]) { q.op = 'insert'; q.rows = Array.isArray(rows) ? rows : [rows]; return b; },
      upsert(rows: Row | Row[], o: { onConflict?: string } = {}) { q.op = 'upsert'; q.rows = Array.isArray(rows) ? rows : [rows]; q.onConflict = o.onConflict ?? 'id'; return b; },
      update(patch: Row) { q.op = 'update'; q.patch = patch; return b; },
      delete() { throw new Error('fakeDb: the functions must never delete'); },
      eq(col: string, v: unknown) { q.filters.push(['eq', col, v]); return b; },
      in(col: string, v: unknown[]) { q.filters.push(['in', col, v]); return b; },
      is(col: string, v: unknown) { q.filters.push(['is', col, v]); return b; },
      not(col: string, op: string, v: unknown) { if (op !== 'in') throw new Error(`fakeDb: unsupported not.${op}`); q.filters.push(['not.in', col, v]); return b; },
      range(a: number, z: number) { q.range = [a, z]; return b; },
      single() { q.single = 'one'; return b; },
      maybeSingle() { q.single = 'maybe'; return b; },
      then(ok: (v: any) => unknown, ko?: (e: unknown) => unknown) { return Promise.resolve().then(() => run(q)).then(ok, ko); },
    };
    return b;
  }

  async function rpc(name: string, args: unknown = {}) {
    const call: Call = { op: 'rpc', name, args: clone(args) };
    calls.push(call);
    const fn = opts.rpc?.[name];
    if (!fn) { call.error = err('PGRST202', `Could not find the function public.${name}`); return { data: null, error: call.error }; }
    return { data: await fn(args), error: null };
  }

  for (const [t, rows] of Object.entries(seed)) tables[t] = rows.map((r) => complete(t, r));
  const seeded = calls.length;
  return {
    from, rpc, calls,
    rows: (t: string): any[] => clone(tables[t]),
    row: (t: string, id: unknown, key = 'id'): any => clone(tables[t].find((r) => same(r[key], id)) ?? null),
    writes: (t?: string): any[] => calls.slice(seeded).filter((c) => ['insert', 'upsert', 'update'].includes(c.op) && (!t || c.table === t)),
  };
}

export type WooCall = { method: string; path: string; query: Record<string, string>; headers: Record<string, string>; body: any; timed: boolean; redirect?: string };
export type Reply = { status?: number; body?: unknown; text?: string; headers?: Record<string, string>; error?: Error };

export function fakeWoo(routes: Record<string, Reply | ((call: WooCall) => Reply | undefined)> = {}) {
  const calls: WooCall[] = [];
  const fetch = (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const call: WooCall = {
      method: init.method ?? 'GET', path: url.pathname.replace(/^\/wp-json\//, ''), query: Object.fromEntries(url.searchParams),
      headers: Object.fromEntries(new Headers(init.headers).entries()), body: init.body ? JSON.parse(String(init.body)) : undefined,
      timed: init.signal instanceof AbortSignal, redirect: init.redirect,
    };
    calls.push(call);
    const route = routes[`${call.method} ${call.path}`];
    const reply = typeof route === 'function' ? route(call) : route;
    if (!reply) return Promise.resolve(new Response(JSON.stringify({ code: 'rest_no_route', message: 'No route' }), { status: 404 }));
    if (reply.error) return Promise.reject(reply.error);
    return Promise.resolve(new Response(reply.text ?? JSON.stringify(reply.body ?? null), { status: reply.status ?? 200, headers: { 'content-type': 'application/json', ...reply.headers } }));
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

// ---------------------------------------------------------------- fixtures (fake values only)

export const ENV: Record<string, string> = {
  SUPABASE_URL: 'https://proj.supabase.test', SUPABASE_ANON_KEY: 'anon-test-key', SUPABASE_SERVICE_ROLE_KEY: 'service-test-key',
  WOO_URL: 'https://woo.test', WOO_CK: 'ck_test_0001', WOO_CS: 'cs_test_0002', WOO_WEBHOOK_SECRET: 'test-secret',
};
export const WC_AUTH = 'Basic ' + btoa('ck_test_0001:cs_test_0002');
export const NOW = '2026-10-25T12:00:00.000Z';
export const PHONE = '01012345678';

// The nine rows of 0007 as 0009 leaves them: «تم RTC» (sort 6) became «فشل» = failed, from_woo (sort 10) on the same row.
export const STATUS_MAP: Row[] = [
  ['قيد الانتظار', 'pending', 'both', 1], ['جاري التنفيذ', 'processing', 'both', 2], ['معلّق', 'on-hold', 'both', 3],
  ['جاهز للشحن', 'ready-shipping', 'both', 4], ['قيد الشحن', 'in-shipping', 'both', 5], ['فشل', 'failed', 'from_woo', 10],
  ['مكتمل', 'completed', 'both', 7], ['استرجاع', 'refunded', 'both', 8], ['ملغي', 'cancelled', 'both', 9],
].map(([system_status, woo_status, direction, sort], i) => ({ id: i + 1, system_status, woo_status, direction, sort }));

export const vendorId = (wooId: number) => `00000000-0000-4000-8000-${String(wooId).padStart(12, '0')}`;
export const vendorRow = (wooId: number, extra: Row = {}): Row => ({ id: vendorId(wooId), woo_vendor_id: wooId, name: `متجر ${wooId}`, ...extra });
const vendorMeta = (v: number) => [{ id: v, key: '_dokan_vendor_id', value: String(v) }];

/** A Woo parent order with two lines (makers 44 and 2376) and a customer phone. */
export function wooOrder(extra: Row = {}): Row {
  return {
    id: 1001, number: '1001', parent_id: 0, status: 'processing', currency: 'EGP', total: '450.00', created_via: 'checkout',
    date_created_gmt: '2026-10-20T10:00:00', date_modified_gmt: '2026-10-20T11:00:00',
    payment_method: 'cod', payment_method_title: 'الدفع عند الاستلام', customer_note: '',
    billing: { first_name: 'سلوى', last_name: 'زيتوني', phone: PHONE, email: 'rasha@example.test', city: 'القاهرة', address_1: 'شارع 9' },
    shipping: { first_name: 'سلوى', last_name: 'زيتوني', city: 'القاهرة', address_1: 'شارع 9', phone: '' },
    meta_data: [{ id: 7, key: 'bosta_customer_phone', value: PHONE }],
    line_items: [
      { id: 1, product_id: 501, name: 'كوباية', sku: 'CUP-1', quantity: 2, total: '200.00', meta_data: vendorMeta(44) },
      { id: 2, product_id: 502, name: 'شنطة', sku: 'BAG-1', quantity: 1, total: '250.00', meta_data: vendorMeta(2376) },
    ],
    ...extra,
  };
}

/** A Dokan sub-order of `parentId` for maker `vendor`. */
export function wooSub(id: number, parentId: number, vendor: number, extra: Row = {}): Row {
  return {
    id, number: String(id), parent_id: parentId, status: 'processing', currency: 'EGP', total: '200.00', created_via: 'dokan',
    date_created_gmt: '2026-10-20T10:00:05', date_modified_gmt: '2026-10-20T11:00:05',
    billing: { first_name: 'سلوى', phone: PHONE }, meta_data: vendorMeta(vendor), line_items: [{ id: id * 10, product_id: 501, quantity: 1, meta_data: [] }],
    ...extra,
  };
}

export const wooStore = (id: number, extra: Row = {}): Row => ({
  id, store_name: `Store ${id}`, enabled: true, phone: '01000000000', email: 'store@example.test', show_email: false,
  shop_url: `https://woo.test/store/${id}/`, registered: '2025-01-02 10:00:00', ...extra,
});

/** A dokan/v1/stores item with the whole phase-3.3 payload (the 37 fields' shapes; every value made up). */
export const wooStoreFull = (id: number, extra: Row = {}): Row => ({
  ...wooStore(id), first_name: 'Maker', last_name: `Owner ${id}`, featured: false, trusted: false, banner: `https://woo.test/b/${id}.jpg`, banner_id: 1,
  gravatar: `https://woo.test/g/${id}.jpg`, gravatar_id: 2, location: '', store_toc: '', toc_enabled: false, rating: { rating: '0', count: 0 },
  address: { street_1: `شارع ${id}`, street_2: '', city: 'القاهرة', state: 'EG-01', zip: '', country: 'EG' },
  social: { fb: `https://fb.test/${id}`, instagram: '', twitter: '', youtube: '', linkedin: '', pinterest: '', threads: '', flickr: '' },
  payment: { bank: { ac_name: 'x', ac_number: '1', ac_type: '', bank_name: '', bank_addr: '', iban: 'EG00TEST', swift: '', routing_number: '' }, paypal: { email: 'p@example.test' } },
  withdraw_options: [], active_payment_methods: { bank: {} }, admin_commission_type: 'fixed', admin_commission: '30', admin_additional_fee: '',
  admin_category_commission: [], ...extra,
});

export function wooProduct(id: number, vendor: number | null, extra: Row = {}): Row {
  return {
    id, name: `منتج ${id}`, sku: `SKU-${id}`, status: 'publish', type: 'simple', price: '120', regular_price: '150',
    date_modified_gmt: '2026-10-21T09:00:00', permalink: `https://woo.test/p/${id}`,
    images: [{ id: 1, src: `https://woo.test/img/${id}-a.jpg` }, { id: 2, src: `https://woo.test/img/${id}-b.jpg` }],
    ...(vendor === null ? {} : { store: { id: vendor, name: 'Owner Name', shop_name: `Store ${vendor}`, address: { street_1: 'x' } } }),
    ...extra,
  };
}

/** Base64(HMAC-SHA256(body, secret)) — the X-WC-Webhook-Signature value. */
export async function sign(body: string | Uint8Array, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, typeof body === 'string' ? enc.encode(body) : (body as BufferSource)));
  return btoa(String.fromCharCode(...mac));
}

/** Every text written to woo_sync_log.detail / woo_webhook_events.error, for "no secret, no phone" checks. */
export const writtenText = (db: ReturnType<typeof fakeDb>) => JSON.stringify([db.rows('woo_sync_log'), db.rows('woo_webhook_events')]);
