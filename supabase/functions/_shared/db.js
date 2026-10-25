// db: thin helpers over a supabase-js client (the service_role client in the Edge Functions), shared by woo-webhook
// and woo-sync. They throw a DbError on a PostgREST error carrying the table, the message and the SQLSTATE only:
// PostgREST's `details` / `hint` can echo the failing row (a phone, an address), so they are never kept. logSync is
// the exception: it never throws (a failed log write must not hide the error being logged) and redacts `detail`;
// upsertRows hands rows refused with a data error back instead of throwing (the caller logs them).
import { redactPII } from './woo-core.js';

export const BATCH = 200; // rows per upsert statement
const IN_CHUNK = 100; // values per in() filter (keeps URLs short and results under PostgREST's 1000-row cap)

export class DbError extends Error {
  constructor(table, error) {
    super(`${table}: ${error?.message ?? 'database error'}`);
    this.name = 'DbError';
    this.code = error?.code ?? null;
  }
}

const chunks = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

// Last row wins per conflict key: one statement may not touch the same row twice (Postgres 21000).
function lastPerKey(rows, keyCols) {
  const byKey = new Map();
  rows.forEach((row, i) => {
    const values = keyCols.map((c) => row[c]);
    byKey.set(values.some((v) => v === null || v === undefined) ? `#${i}` : JSON.stringify(values.map(String)), row);
  });
  return [...byKey.values()];
}

// SQLSTATE class 22 (data exception) or 23 (integrity constraint violation): the rows themselves are refused.
const isDataError = (error) => /^2[23]/.test(String(error?.code ?? ''));

/**
 * Upserts rows in statements of BATCH on `onConflict` ("col" or "a,b"). Only the columns present in the rows are
 * written, so an existing row keeps every other column. A statement refused with a data error (SQLSTATE 22xxx /
 * 23xxx) is retried row by row so one bad row does not stall the others; any other error throws a DbError.
 * → { rows: the written rows when `returning` (a select list) is given, else []; bad: [{ key, row, error }] for each
 * refused row (key = its conflict key as text, "a,b" joined by ","; error a DbError) for the caller to log }.
 */
export async function upsertRows(client, table, rows, onConflict, returning = null) {
  const keyCols = onConflict.split(',').map((c) => c.trim());
  const list = lastPerKey(rows, keyCols);
  const out = [], bad = [];
  const write = async (batch) => {
    let query = client.from(table).upsert(batch, { onConflict });
    if (returning) query = query.select(returning);
    const { data, error } = await query;
    if (!error && returning) out.push(...(data ?? []));
    return error;
  };
  for (const chunk of chunks(list, BATCH)) {
    const error = await write(chunk);
    if (!error) continue;
    if (!isDataError(error)) throw new DbError(table, error);
    for (const row of chunk) {
      const rowError = chunk.length === 1 ? error : await write([row]);
      if (!rowError) continue;
      if (!isDataError(rowError)) throw new DbError(table, rowError);
      bad.push({ key: keyCols.map((c) => String(row[c] ?? '')).join(','), row, error: new DbError(table, rowError) });
    }
  }
  return { rows: out, bad };
}

/** select `columns` from `table` where `column` in values (chunked); `narrow(query)` may add filters. */
export async function selectIn(client, table, columns, column, values, narrow = (q) => q) {
  const out = [];
  for (const chunk of chunks([...new Set(values)], IN_CHUNK)) {
    const { data, error } = await narrow(client.from(table).select(columns).in(column, chunk));
    if (error) throw new DbError(table, error);
    out.push(...(data ?? []));
  }
  return out;
}

/**
 * One woo_sync_log row ({ kind, direction, entity, entity_id, action, result, detail }); false when it failed.
 * @param {any} client @param {Record<string, any>} row
 */
export async function logSync(client, row) {
  try {
    const { error } = await client.from('woo_sync_log').insert({ ...row, detail: row.detail == null ? null : redactPII(row.detail) });
    if (error) console.error(`woo_sync_log insert failed (${error.code ?? 'error'})`);
    return !error;
  } catch {
    console.error('woo_sync_log insert failed');
    return false;
  }
}

/** sync_state[key].value, {} when absent. */
export async function getState(client, key) {
  const { data, error } = await client.from('sync_state').select('value').eq('key', key).maybeSingle();
  if (error) throw new DbError('sync_state', error);
  return data?.value ?? {};
}

/**
 * Replaces sync_state[key].value (updated_at = `at` when given).
 * @param {any} client @param {string} key @param {object} value @param {string | null} [at]
 */
export async function setState(client, key, value, at = null) {
  const { error } = await client.from('sync_state').upsert({ key, value, ...(at ? { updated_at: at } : {}) }, { onConflict: 'key' });
  if (error) throw new DbError('sync_state', error);
}
