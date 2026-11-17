// A campaign's «فايلز أو لينكات» take any public link (the owner 15 Nov: «السيستم مش قابل اي لينكات» — a Pinterest pin was refused,
// only the site's product links and SKUs were taken): an image link, or a page whose picture is named in its og:image / twitter:image
// (Pinterest, Instagram, Behance, a shop …). The server fetches it — never the browser (the CSP) — and keeps the image in the campaign's
// folder, so the rest (the references of the generation) is the same as an upload. The pure rules here; the fetching in ai-images
// (`ref_link`). SSRF rules: https only on the default port, no credentials, a DNS name (never an IP literal), no local / internal
// name, each redirect checked again (REF_HOPS at most), the resolved addresses public only (when the runtime resolves), the page read
// up to REF_PAGE_MAX, the image up to the references' limit and only PNG / JPEG / WebP by its first bytes.

export const REF_HOPS = 5;
export const REF_PAGE_MAX = 1_000_000;
export const REF_URL_MAX = 2000;
const LOCAL = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain|arpa)$/;

/** A pasted link the server may fetch → URL, else null (https, port 443, no user:password, a public DNS name). */
export function refUrl(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim(); if (!s || s.length > REF_URL_MAX) return null;
  let u; try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!/^[a-z0-9.-]+$/.test(host) || !host.includes('.') || host.startsWith('.') || host.includes('..')) return null;
  if (/^[0-9.]+$/.test(host) || /^\d+$/.test(host.split('.').pop()) || LOCAL.test(host)) return null; // an IPv4 literal (any form) or a local name
  return u;
}

const v4 = (ip) => { const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip); if (!m) return null; const p = m.slice(1).map(Number); return p.every((n) => n <= 255) ? p : null; };
/** A resolved address that is not on the public internet (loopback, private, link-local, CGNAT, reserved, multicast; IPv4 and IPv6). */
export function privateIp(ip) {
  const s = String(ip || '').trim().toLowerCase();
  const p = v4(s);
  if (p) {
    const [a, b] = p;
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 192 && b === 0 && p[2] === 0) || (a === 198 && (b === 18 || b === 19));
  }
  if (!s.includes(':')) return true; // not an address at all: never trusted
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s); if (mapped) return privateIp(mapped[1]);
  if (s === '::' || s === '::1') return true;
  const head = parseInt(s.split(':')[0] || '0', 16);
  return (head & 0xfe00) === 0xfc00 || (head & 0xffc0) === 0xfe80 || (head & 0xff00) === 0xff00 || s.startsWith('64:ff9b:') || s.startsWith('2001:db8:');
}

const ENT = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', '#39': "'", '#x27': "'", '#x2f': '/', '#47': '/' };
const unent = (v) => v.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, k) => ENT[k.toLowerCase()] ?? m);
function attrsOf(tag) {
  const out = {}; const re = /([a-z_:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/gi; let m;
  while ((m = re.exec(tag))) out[m[1].toLowerCase()] = unent(m[3] ?? m[4] ?? m[5] ?? '');
  return out;
}
const ORDER = ['og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src'];
/** The picture a page names (og:image first, then twitter:image, then <link rel=image_src>) → an absolute link, else null. */
export function pageImage(html, base) {
  if (typeof html !== 'string' || !html) return null;
  const head = html.slice(0, REF_PAGE_MAX); const found = {};
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrsOf(m[0]); const key = (a.property || a.name || '').toLowerCase();
    if (ORDER.includes(key) && a.content && !found[key]) found[key] = a.content.trim();
  }
  let pick = ORDER.map((k) => found[k]).find(Boolean) || null;
  if (!pick) for (const m of head.matchAll(/<link\b[^>]*>/gi)) { const a = attrsOf(m[0]); if ((a.rel || '').toLowerCase().split(/\s+/).includes('image_src') && a.href) { pick = a.href.trim(); break; } }
  if (!pick) return null;
  try { return new URL(pick, base).href; } catch { return null; }
}

/** A TikTok video's cover from its page (the owner 17 Nov — the trends' videos had no picture: TikTok's oEmbed stopped naming a
 *  thumbnail_url and the page has no og:image): the page's data names the item by its id, and its "cover" follows it → an https link,
 *  else null. Only the cover of that id (never the first picture of the page — another video's). */
export function tiktokCover(html, id) {
  if (typeof html !== 'string' || !/^\d{6,30}$/.test(String(id || ''))) return null;
  const at = html.indexOf('"id":"' + id + '"'); if (at < 0) return null;
  const m = /"(?:cover|originCover|dynamicCover)":"((?:[^"\\]|\\.){10,2000})"/.exec(html.slice(at, at + 40000)); if (!m) return null;
  let s; try { s = JSON.parse('"' + m[1] + '"'); } catch { return null; }
  return /^https:\/\/[^\s"<>]+$/.test(s) ? s : null;
}

/** The image type by its first bytes (PNG / JPEG / WebP — what the campaign's folder takes), else null. */
export function imageKind(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : null; if (!b || b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

/** The chip's name: «لينك — <host>» (the host the member pasted, without www.). */
export const refName = (u) => 'لينك — ' + String(u && u.hostname ? u.hostname : '').toLowerCase().replace(/^www\./, '').slice(0, 60);
