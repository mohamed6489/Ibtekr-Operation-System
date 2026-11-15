// The site's own product photos, read by the server for a report that goes out as a file (PDF / Excel) — the browser shows them
// but cannot put them into a file: the site sends no CORS header (2026-11-15-comments.md decision 10). Pure helpers: which hosts
// are the site's, which URL is one of its uploads, the smaller copies WordPress keeps of it, and what the bytes really are.

// the hosts a photo may be read from: the site's own (WOO_URL) and the ones listed in IMAGE_HOSTS (a CDN) — exact names
export function imageHosts(env) {
  const hosts = new Set();
  try { if (env && env.WOO_URL) hosts.add(new URL(env.WOO_URL).hostname.toLowerCase()); } catch { /* no site host */ }
  for (const h of String((env && env.IMAGE_HOSTS) || '').split(',')) { const x = h.trim().toLowerCase(); if (/^[a-z0-9.-]+$/.test(x)) hosts.add(x); }
  return hosts;
}

const EXT = /\.(webp|jpe?g|png)$/i;
// one of the site's uploads: https on the usual port, no credentials, an allowed host, under /wp-content/uploads/, an image by
// its name, nothing that climbs out of the folder. The query and the fragment are dropped. → URL | null
export function siteImage(raw, hosts) {
  if (typeof raw !== 'string' || raw.length > 500) return null;
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || !hosts || !hosts.has(u.hostname.toLowerCase())) return null;
  let path;
  try { path = decodeURIComponent(u.pathname); } catch { return null; }
  if (!path.startsWith('/wp-content/uploads/') || path.includes('..') || path.includes('\\') || /[\u0000-\u001f]/.test(path) || !EXT.test(path)) return null;
  u.search = ''; u.hash = '';
  return u;
}

// the copies to try, smallest first: WordPress keeps «name-150x150.ext» and «name-300x300.ext» beside most uploads; a name
// that is already a sized copy is asked as it is. The original is the last resort.
export function thumbCandidates(u) {
  const href = u.href; const m = /^(.*?)(-\d{2,4}x\d{2,4})?(\.[a-z]+)$/i.exec(href);
  if (!m || m[2]) return [href];
  return [m[1] + '-150x150' + m[3], m[1] + '-300x300' + m[3], href];
}

// what the bytes are, by their own first bytes (never the stated type): PNG, JPEG, WebP — or null (the campaign links' check)
export { imageKind } from './ref-link.js';

// the request: 1–12 distinct strings (anything else = null → 400)
export function thumbUrls(v) {
  if (!Array.isArray(v) || v.length < 1 || v.length > 12 || v.some((x) => typeof x !== 'string' || !x || x.length > 500)) return null;
  return [...new Set(v)];
}
