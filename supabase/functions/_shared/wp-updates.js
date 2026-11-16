// «تحديثات ووردبريس» (docs/superpowers/plans/2026-11-15-comments.md decision 71 — the owner 15 Nov: «زودلي قسم المبرمج يجيبله
// ابديتس للوردر بريس») — the pure part of woo-sync's `wp_updates`: what WooCommerce's own system status report says about the
// site (GET wc/v3/system_status — the site's WordPress, WooCommerce and PHP versions, the theme and every plugin with the
// version installed and the newest one the site itself knows of) and WordPress.org's newest release, turned into the list the
// developer's section shows. Names and versions only: no path, no URL, no key and no server detail leaves this function.
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v, max) => (typeof v === 'string' || typeof v === 'number' ? String(v).replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const VERSION = /^[0-9][0-9A-Za-z.+_-]{0,39}$/;
export const version = (v) => { const s = text(v, 40); return VERSION.test(s) ? s : ''; };
export const SYSTEM_FIELDS = 'environment,active_plugins,inactive_plugins,theme';
export const CORE_CHECK = 'https://api.wordpress.org/core/version-check/1.7/';
export const PLUGINS_MAX = 150;

/** a newer than b? — the numbers of each compared in turn («6.8.1» > «6.8», «10.0» > «9.9.5»); a pre-release tail is ignored. */
export function newer(a, b) {
  const parts = (v) => (version(v).split(/[-+_]/)[0].match(/[0-9]+/g) || []).map(Number);
  const x = parts(a), y = parts(b);
  if (!x.length || !y.length) return false;
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0; }
  return false;
}

/** WordPress.org's answer → the newest stable release («6.8.1»), or '' when it says nothing usable. */
export function coreLatest(body) {
  const offers = isObj(body) && Array.isArray(body.offers) ? body.offers : [];
  let best = '';
  for (const o of offers) { const v = isObj(o) ? version(o.current ?? o.version) : ''; if (v && /^[0-9.]+$/.test(v) && (!best || newer(v, best))) best = v; }
  return best;
}

const item = (p, active) => {
  const name = text(isObj(p) ? p.name : '', 120); const v = version(isObj(p) ? p.version : '');
  if (!name) return null;
  const latest = version(isObj(p) ? p.version_latest : '');
  return { name, version: v, latest: latest && newer(latest, v) ? latest : '', active, update: !!(latest && v && newer(latest, v)) };
};

/**
 * The system status report (+ WordPress.org's newest release, '' when it could not be read) → { core, woo, php, theme, plugins,
 * updates }: every part by its name and versions; `update` where a newer version is known; `updates` = how many wait.
 * The plugins: the ones waiting first, then the active ones, by name; PLUGINS_MAX at most.
 */
export function wpStatus(sys, latestCore) {
  const env = isObj(sys) && isObj(sys.environment) ? sys.environment : {};
  const wp = version(env.wp_version); const lc = version(latestCore);
  const core = { version: wp, latest: lc && wp && newer(lc, wp) ? lc : '', update: !!(lc && wp && newer(lc, wp)), known: !!lc };
  const th = isObj(sys) && isObj(sys.theme) ? sys.theme : null;
  const theme = th ? item({ name: th.name, version: th.version, version_latest: th.version_latest }, true) : null;
  const seen = new Set(); const plugins = [];
  const add = (list, active) => { for (const p of Array.isArray(list) ? list : []) { const x = item(p, active); if (!x) continue; const k = x.name.toLowerCase(); if (seen.has(k)) continue; seen.add(k); plugins.push(x); } };
  add(isObj(sys) ? sys.active_plugins : null, true); add(isObj(sys) ? sys.inactive_plugins : null, false);
  plugins.sort((a, b) => (Number(b.update) - Number(a.update)) || (Number(b.active) - Number(a.active)) || a.name.localeCompare(b.name, 'en'));
  const list = plugins.slice(0, PLUGINS_MAX);
  return { core, woo: { version: version(env.version) }, php: version(env.php_version), theme, plugins: list,
    updates: (core.update ? 1 : 0) + (theme && theme.update ? 1 : 0) + list.filter((p) => p.update).length };
}
