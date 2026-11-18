// The automatic clean-up every 48 hours (the owner 18 Nov — «عايز يتعمل تنظيف اتوماتيك للdatabase كل 48 ساعة للحاجة اللي ملهاش لازمة»;
// what goes is in supabase/migrations/0132_auto_cleanup.sql). The notify tick (every 15 minutes) runs it when it is due: the files go
// through the Storage API (100 at a time), then data_cleanup deletes the logs and the rows whose files went. A run that hit the
// plan's limit leaves `more` and the next tick goes on; a file that would not delete keeps its row for the next run.

export const CLEANUP_HOURS = 48;
export const CLEANUP_LIMIT = 500; // rows of each kind a run takes
export const REMOVE_CHUNK = 100;  // files in one Storage call

/** Due when it never ran, when the last run left more behind, or 48 hours after the last one. */
export function cleanupDue(nowMs, state) {
  if (!state || typeof state !== 'object') return true;
  if (state.more === true) return true;
  const last = Date.parse(String(state.last_at || ''));
  return !Number.isFinite(last) || nowMs - last >= CLEANUP_HOURS * 3600_000;
}

export const chunks = (list, n = REMOVE_CHUNK) => { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; };

const names = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x && !x.includes('..')) : []);

/**
 * The plan from cleanup_plan → the work: each bucket's files and, for the rows, which files they wait for.
 * { studio: [{ id, files }], images: [name], jobs: [{ id, file }], chats: [{ id, files }] } →
 * { buckets: { studio: [...], 'ai-images': [...], marketing: [...] }, rows: [{ kind, id, bucket, files }] , full }
 */
export function cleanupWork(plan, limit = CLEANUP_LIMIT) {
  const p = plan && typeof plan === 'object' ? plan : {};
  const list = (k) => (Array.isArray(p[k]) ? p[k].filter((x) => x && typeof x === 'object' && x.id != null) : []);
  const rows = [];
  for (const b of list('studio')) rows.push({ kind: 'studio', id: String(b.id), bucket: 'studio', files: names(b.files) });
  for (const j of list('jobs')) rows.push({ kind: 'job', id: Number(j.id), bucket: 'marketing', files: names([j.file]) });
  for (const c of list('chats')) rows.push({ kind: 'chat', id: String(c.id), bucket: 'marketing', files: names(c.files) });
  const images = names(p.images);
  const buckets = { studio: [], 'ai-images': images, marketing: [] };
  for (const r of rows) buckets[r.bucket].push(...r.files);
  const full = ['studio', 'jobs', 'chats'].some((k) => list(k).length >= limit) || images.length >= limit;
  return { buckets, rows, full };
}

/** After the removals: the ids whose files all went (a row keeps waiting for a file that would not delete). */
export function cleanupIds(rows, failed) {
  const bad = failed instanceof Set ? failed : new Set(failed || []);
  const ok = (r) => r.files.every((f) => !bad.has(r.bucket + '/' + f));
  return {
    studio: rows.filter((r) => r.kind === 'studio' && ok(r)).map((r) => r.id),
    jobs: rows.filter((r) => r.kind === 'job' && ok(r)).map((r) => r.id),
    chats: rows.filter((r) => r.kind === 'chat' && ok(r)).map((r) => r.id),
  };
}
