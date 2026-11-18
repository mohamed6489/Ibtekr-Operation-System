// The automatic clean-up every 48 hours (the owner 18 Nov — «عايز يتعمل تنظيف اتوماتيك للdatabase كل 48 ساعة للحاجة اللي ملهاش لازمة»;
// the rules in supabase/migrations/0132_auto_cleanup.sql): when it is due, which files go per bucket, and that a row waits for a file
// that would not delete.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CLEANUP_HOURS, chunks, cleanupDue, cleanupIds, cleanupWork } from '../../supabase/functions/_shared/cleanup.js';

const NOW = Date.parse('2026-11-18T12:00:00Z');
const ago = (h) => new Date(NOW - h * 3600_000).toISOString();

test('due when it never ran, 48 hours after the last run, or at once when the last run left more', () => {
  assert.equal(CLEANUP_HOURS, 48);
  assert.equal(cleanupDue(NOW, null), true);
  assert.equal(cleanupDue(NOW, { last_at: ago(47) }), false);
  assert.equal(cleanupDue(NOW, { last_at: ago(48) }), true);
  assert.equal(cleanupDue(NOW, { last_at: ago(1), more: true }), true);
  assert.equal(cleanupDue(NOW, { last_at: 'x' }), true);
});

test('the plan → each bucket\'s files and the rows that wait for them; a path with «..» never goes', () => {
  const w = cleanupWork({
    studio: [{ id: 'b1', files: ['b1/a.webp', 'b1/b.webp'] }],
    images: ['m1/x.webp', '../etc', null],
    jobs: [{ id: 7, file: 'c1/vid-V1-clip.mp4' }, { id: 8, file: null }],
    chats: [{ id: 'c9', files: ['agents/m1/c9/img.png'] }],
  }, 500);
  assert.deepEqual(w.buckets, { studio: ['b1/a.webp', 'b1/b.webp'], 'ai-images': ['m1/x.webp'], marketing: ['c1/vid-V1-clip.mp4', 'agents/m1/c9/img.png'] });
  assert.deepEqual(w.rows.map((r) => [r.kind, r.id, r.files.length]), [['studio', 'b1', 2], ['job', 7, 1], ['job', 8, 0], ['chat', 'c9', 1]]);
  assert.equal(w.full, false);
  assert.equal(cleanupWork({ images: Array.from({ length: 3 }, (_, i) => 'm/' + i) }, 3).full, true, 'a run at the limit goes on at the next tick');
  assert.deepEqual(cleanupWork(null, 5), { buckets: { studio: [], 'ai-images': [], marketing: [] }, rows: [], full: false });
});

test('a file that would not delete keeps its row for the next run', () => {
  const w = cleanupWork({ studio: [{ id: 'b1', files: ['b1/a'] }, { id: 'b2', files: ['b2/a'] }], jobs: [{ id: 7, file: 'j/7' }, { id: 8, file: null }], chats: [{ id: 'c1', files: [] }] });
  assert.deepEqual(cleanupIds(w.rows, new Set(['studio/b2/a', 'marketing/j/7'])), { studio: ['b1'], jobs: [8], chats: ['c1'] });
  assert.deepEqual(chunks([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test('0132: what goes and what never does; both functions the server\'s only; notify runs it', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/0132_auto_cleanup.sql', import.meta.url), 'utf8');
  for (const t of ['woo_sync_log', 'woo_webhook_events', 'cron.job_run_details', 'cs_oauth_states', 'vendor_login_resets', 'login_failures', 'cs_channel_events', 'alerts', 'ai_agent_notes', 'mkt_agent_chats', 'studio_batches', 'mkt_video_jobs'])
    assert.match(sql, new RegExp('delete from (public\\.)?' + t.replace('.', '\\.')), t);
  for (const t of ['activity_log', 'ai_runs', 'orders', 'acc_', 'vendors', 'products', 'cs_customers', 'hr_', 'tickets', 'mkt_campaigns'])
    assert.doesNotMatch(sql, new RegExp('delete from public\\.' + t), 'never ' + t);
  assert.match(sql, /revoke execute on function public\.cleanup_plan\(int\) from public, anon, authenticated/);
  assert.match(sql, /revoke execute on function public\.data_cleanup\(uuid\[\], bigint\[\], uuid\[\]\) from public, anon, authenticated/);
  const src = readFileSync(new URL('../../supabase/functions/notify/index.ts', import.meta.url), 'utf8');
  assert.match(src, /autoCleanup\(deps, ctx\)/);
});
