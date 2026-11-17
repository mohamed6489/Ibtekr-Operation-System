// «أداء الموقع» for the developer (docs/superpowers/plans/2026-11-17-agents-team.md decision 1 — the owner 17 Nov: «خلي المبرمج يقدر
// يعرف البيرفورمانس بتاع الموقع عندي»): the pure part of woo-sync's `site_speed`. Google PageSpeed Insights (v5, performance only) on
// the linked site's pages, mobile and desktop — read only. What leaves here: the score, the lab metrics, the real users' numbers when
// Google has them (CrUX) and the biggest chances to save time (their English titles) — numbers and titles only, no URL of a resource,
// no HTML, no screenshot. The pages are the linked site's own (its host only), so the call can never be pointed elsewhere.
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v, max) => (typeof v === 'string' ? v.replace(/<[^>]*>/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[\u0000-\u001f\u007f<>`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export const PSI = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
export const STRATEGIES = ['mobile', 'desktop'];
export const PAGE_KINDS = ['home', 'product', 'shop'];
export const PAGE_LABEL = { home: 'الصفحة الرئيسية', product: 'صفحة منتج', shop: 'صفحة المتجر' };
export const OPPS_MAX = 5;

/**
 * The site's address (WOO_URL) + the newest published product's link → [{ kind, url }]: the home page, the product (only when it is
 * on the same host — the mirror's link is the site's) and /shop/. https only; anything else is left out.
 */
export function speedPages(site, productLink) {
  let base;
  try { base = new URL(String(site || '').trim()); } catch { return []; }
  if (base.protocol !== 'https:' || base.username || base.password) return [];
  const root = base.origin + '/';
  const out = [{ kind: 'home', url: root }];
  try {
    const p = new URL(String(productLink || '').trim());
    if (p.protocol === 'https:' && p.host === base.host && !p.username && !p.password) out.push({ kind: 'product', url: p.origin + p.pathname });
  } catch { /* no product link */ }
  out.push({ kind: 'shop', url: base.origin + '/shop/' });
  return out;
}

/** One PageSpeed call's address (performance only; the key when there is one). */
export function psiUrl(page, strategy, key) {
  const q = new URLSearchParams({ url: page, strategy, category: 'performance' });
  if (key) q.set('key', key);
  return PSI + '?' + q.toString();
}

const ms = (a) => { const v = isObj(a) ? num(a.numericValue) : null; return v == null ? null : Math.round(v); };
const FIELD = { LARGEST_CONTENTFUL_PAINT_MS: 'lcp', INTERACTION_TO_NEXT_PAINT: 'inp', CUMULATIVE_LAYOUT_SHIFT_SCORE: 'cls' };
const RATING = { FAST: 'good', AVERAGE: 'average', SLOW: 'poor' };

/**
 * One PageSpeed answer → { score, lab: { lcp, cls, tbt, fcp, si, bytes }, field: { lcp, inp, cls, rating } | null, opps: [{ title, ms }] }
 * — null when it carries no performance score. The CLS of the real users comes ×100 from Google and goes back to its plain value.
 */
export function speedOf(body) {
  const lr = isObj(body) && isObj(body.lighthouseResult) ? body.lighthouseResult : null;
  const perf = lr && isObj(lr.categories) && isObj(lr.categories.performance) ? num(lr.categories.performance.score) : null;
  if (perf == null) return null;
  const a = isObj(lr.audits) ? lr.audits : {};
  const cls = isObj(a['cumulative-layout-shift']) ? num(a['cumulative-layout-shift'].numericValue) : null;
  const lab = { lcp: ms(a['largest-contentful-paint']), cls: cls == null ? null : Math.round(cls * 1000) / 1000, tbt: ms(a['total-blocking-time']),
    fcp: ms(a['first-contentful-paint']), si: ms(a['speed-index']), bytes: ms(a['total-byte-weight']) };
  let field = null;
  const le = isObj(body.loadingExperience) && isObj(body.loadingExperience.metrics) ? body.loadingExperience : null;
  if (le) {
    const f = {};
    for (const [k, key] of Object.entries(FIELD)) { const m = le.metrics[k]; const p = isObj(m) ? num(m.percentile) : null; if (p != null) f[key] = key === 'cls' ? Math.round(p) / 100 : Math.round(p); }
    if (Object.keys(f).length) field = Object.assign(f, { rating: RATING[le.overall_category] || null });
  }
  const opps = [];
  for (const x of Object.values(a)) {
    if (!isObj(x) || !isObj(x.details)) continue;
    const save = num(x.details.overallSavingsMs) ?? (isObj(x.metricSavings) ? Math.max(num(x.metricSavings.LCP) || 0, num(x.metricSavings.FCP) || 0) : null);
    const passed = num(x.score) != null && x.score >= 0.9;
    if (!save || save < 100 || passed) continue;
    const title = text(x.title, 120); if (!title) continue;
    if (opps.some((o) => o.title === title)) continue;
    opps.push({ title, ms: Math.round(save) });
  }
  opps.sort((p, q) => q.ms - p.ms);
  return { score: Math.round(perf * 100), lab, field, opps: opps.slice(0, OPPS_MAX) };
}

/**
 * The runs ([{ kind, url, strategy, body | null, error? }]) → the row kept for the developer: { pages: [{ kind, path, mobile, desktop }],
 * score: the lowest mobile score (what to watch), ok: how many runs answered }. A run without an answer keeps its error code only.
 */
export function speedReport(runs) {
  const pages = [];
  for (const r of Array.isArray(runs) ? runs : []) {
    if (!isObj(r) || !PAGE_KINDS.includes(r.kind) || !STRATEGIES.includes(r.strategy)) continue;
    let p = pages.find((x) => x.kind === r.kind);
    if (!p) { let path = '/'; try { path = new URL(r.url).pathname.slice(0, 160); } catch { /* keep / */ } p = { kind: r.kind, path, mobile: null, desktop: null }; pages.push(p); }
    const s = r.body ? speedOf(r.body) : null;
    p[r.strategy] = s || { error: text(r.error || 'no_score', 40) || 'no_score' };
  }
  pages.sort((x, y) => PAGE_KINDS.indexOf(x.kind) - PAGE_KINDS.indexOf(y.kind));
  const mob = pages.map((p) => (p.mobile && p.mobile.score != null ? p.mobile.score : null)).filter((v) => v != null);
  const ok = pages.reduce((n, p) => n + STRATEGIES.filter((s) => p[s] && p[s].score != null).length, 0);
  return { pages, score: mob.length ? Math.min(...mob) : null, ok };
}

/** A short status line for the developer's prompt (numbers only). */
export function speedLine(data) {
  if (!isObj(data) || !Array.isArray(data.pages)) return '';
  const part = (s) => (s && s.score != null ? s.score + '/100' + (s.lab && s.lab.lcp != null ? ' LCP ' + (s.lab.lcp / 1000).toFixed(1) + 's' : '') + (s.lab && s.lab.tbt != null ? ' TBT ' + s.lab.tbt + 'ms' : '') + (s.lab && s.lab.cls != null ? ' CLS ' + s.lab.cls : '') : 'no answer');
  return data.pages.map((p) => (PAGE_LABEL[p.kind] || p.kind) + ' (' + p.path + '): mobile ' + part(p.mobile) + ' · desktop ' + part(p.desktop)
    + (p.mobile && Array.isArray(p.mobile.opps) && p.mobile.opps.length ? ' · fixes: ' + p.mobile.opps.slice(0, 3).map((o) => o.title + ' (' + Math.round(o.ms / 100) / 10 + 's)').join('; ') : '')).join('\n');
}
