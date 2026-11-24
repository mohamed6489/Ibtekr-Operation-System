// The meeting of 23 Nov [#43] (docs/superpowers/plans/2026-11-23-meeting.md phase 8): Meta's pictures kept in our own bucket.
// A post's or an ad's picture on Meta's CDN (scontent-….cdninstagram.com / ….fbcdn.net) is a signed link that dies in a few days (its
// `oe=` — the live posts' all died on 23 Nov, so «سجل النشر» / «الخطة الإعلانية» / «تفاصيل الأعمال الفنية» showed empty frames). The server
// copies it into the bucket «marketing» the moment it reads a fresh link (mkt-publish `stats`, mkt-ads `sync`) and the page shows the
// copy by a signed link of ours (marketing.view reads the bucket). Only Meta's own CDN hosts are fetched (no redirect followed), the
// bytes decide the type (JPEG / PNG / WebP), up to PIN_MAX; nothing about the post is logged.

export const META_CDN = /^https:\/\/([a-z0-9-]+\.)*(cdninstagram\.com|fbcdn\.net)\//i;
export const PIN_MAX = 3_000_000;
export const pinUrl = (u) => (typeof u === 'string' && u.length <= 2000 && META_CDN.test(u) && !/[\s<>"\\]/.test(u) ? u : null);

// the type by the first bytes (a CDN's header is not trusted)
export function sniff(b) {
  if (!b || b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}
export const extOf = (mime) => (mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg');
const safe = (s) => String(s == null ? '' : s).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
// where a picture lives: platform/<fb|ig>/<post id>.<ext> · ads/<platform>/<ad id>.<ext>
export function postPath(platformAr, externalId, mime) {
  const p = platformAr === 'انستجرام' || platformAr === 'instagram' ? 'ig' : 'fb'; const id = safe(externalId);
  return id ? 'platform/' + p + '/' + id + '.' + extOf(mime) : null;
}
export function adPath(platform, id, mime) { const pl = safe(platform); const x = safe(id); return pl && x ? 'ads/' + pl + '/' + x + '.' + extOf(mime) : null; }

// one picture: the link's bytes (no redirect, PIN_MAX at most) → { bytes, mime } or null
export async function fetchPin(fetchFn, url, ms = 15_000) {
  const u = pinUrl(url); if (!u || typeof fetchFn !== 'function') return null;
  const ctl = typeof AbortController === 'function' ? new AbortController() : null; const timer = ctl ? setTimeout(() => ctl.abort(), ms) : null;
  try {
    const res = await fetchFn(u, { redirect: 'manual', headers: { accept: 'image/*' }, signal: ctl ? ctl.signal : undefined });
    if (!res || res.status !== 200 || !res.body) return null;
    const len = Number(res.headers && res.headers.get ? res.headers.get('content-length') : 0); if (len > PIN_MAX) return null;
    const reader = res.body.getReader(); const parts = []; let n = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; n += value.length; if (n > PIN_MAX) { try { await reader.cancel(); } catch { /* */ } return null; } parts.push(value); }
    const bytes = new Uint8Array(n); let o = 0; for (const p of parts) { bytes.set(p, o); o += p.length; }
    const mime = sniff(bytes); return mime ? { bytes, mime } : null;
  } catch { return null; } finally { if (timer) clearTimeout(timer); }
}

// fetch + keep: the bucket path when it is there, else null (the row keeps its CDN link and the page its placeholder)
export async function pin(db, bucket, fetchFn, url, pathOf) {
  const img = await fetchPin(fetchFn, url); if (!img) return null;
  const path = pathOf(img.mime); if (!path) return null;
  try { const { error } = await db.storage.from(bucket).upload(path, img.bytes, { contentType: img.mime, upsert: true }); return error ? null : path; }
  catch { return null; }
}
