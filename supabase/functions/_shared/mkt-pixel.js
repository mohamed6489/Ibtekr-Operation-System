// The media buyer looks at the Meta Pixel (the owner 17 Nov — «عايز الميديا باير يقدر يبص علي البيكسل و لو في حاجة محتاجة تتصلح يقدر
// يساعدني نصلحها»): read only — the ad account's pixels, the events of the last 7 days, Meta's own checks, the site's page (is the pixel
// there, which one, twice?) and the purchases against our orders → a list of issues, each with how to fix it. Nothing is written on Meta
// or on WordPress; the fix is the member's (the steps, the chat, «تقديم طلب» to the developer). Pure: the calls are in mkt-ads.

const GRAPH = 'https://graph.facebook.com/v23.0';
const enc = encodeURIComponent;
export const PIXEL_EVENTS = ['PageView', 'ViewContent', 'AddToCart', 'InitiateCheckout', 'Purchase'];
export const PIXEL_DAYS = 7;
export const PIXEL_MAX = 3; // pixels of one ad account read
export const SITE_MAX_BYTES = 2_000_000;
export const pixelPath = {
  pixels: (a) => GRAPH + '/act_' + a + '/adspixels?fields=' + enc('id,name,last_fired_time,is_unavailable,creation_time,enable_automatic_matching,automatic_matching_fields,first_party_cookie_status') + '&limit=10',
  stats: (id, start, end) => GRAPH + '/' + id + '/stats?aggregation=event&start_time=' + start + '&end_time=' + end,
  checks: (id) => GRAPH + '/' + id + '/da_checks?fields=' + enc('key,title,description,result'),
};
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const idOf = (v) => (/^\d{6,20}$/.test(String(v ?? '')) ? String(v) : null);
// Meta's words are data: letters, digits and plain punctuation, cut
const metaText = (v, n = 200) => (typeof v === 'string' ? v.replace(/[<>]/g, ' ').replace(/[^\p{L}\p{N} .,:;()'"%/&+-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : '');

/** The pixels of the ad account (Meta's answer) → [{ id, name, lastFired, unavailable, matching }]. */
export function pixelsOf(out) {
  const rows = isObj(out) && Array.isArray(out.data) ? out.data : [];
  return rows.filter(isObj).map((p) => ({
    id: idOf(p.id), name: metaText(p.name, 80) || null,
    lastFired: typeof p.last_fired_time === 'string' && !Number.isNaN(Date.parse(p.last_fired_time)) ? new Date(Date.parse(p.last_fired_time)).toISOString() : null,
    unavailable: p.is_unavailable === true,
    matching: p.enable_automatic_matching === true,
  })).filter((p) => p.id).slice(0, PIXEL_MAX);
}
/** The stats (aggregation=event — hourly buckets) → { PageView: n, … } summed. */
export function eventCounts(out) {
  const sum = {};
  for (const b of isObj(out) && Array.isArray(out.data) ? out.data : []) {
    for (const e of isObj(b) && Array.isArray(b.data) ? b.data : []) {
      const k = isObj(e) && typeof e.value === 'string' ? e.value.slice(0, 60) : null; const n = Number(e && e.count);
      if (k && Number.isFinite(n) && n > 0) sum[k] = (sum[k] || 0) + n;
    }
  }
  return sum;
}
/** Meta's own checks (da_checks) → [{ key, title, description, result }]. */
export function checksOf(out) {
  return (isObj(out) && Array.isArray(out.data) ? out.data : []).filter(isObj).slice(0, 20).map((c) => ({
    key: metaText(c.key, 60), title: metaText(c.title, 120), description: metaText(c.description, 300), result: metaText(c.result, 20).toLowerCase(),
  })).filter((c) => c.title || c.key);
}
/** The site's page (HTML) → the pixel ids it starts, how many times, the plugin and GTM. */
export function siteScan(html) {
  const s = typeof html === 'string' ? html.slice(0, SITE_MAX_BYTES) : '';
  const ids = []; let inits = 0;
  const add = (id) => { if (idOf(id)) ids.push(id); };
  for (const m of s.matchAll(/fbq\(\s*['"]init['"]\s*,\s*['"](\d{6,20})['"]/g)) { inits += 1; add(m[1]); }
  for (const m of s.matchAll(/pixel_?ids?["']?\s*[:=]\s*\[?\s*["'](\d{6,20})["']/gi)) add(m[1]);
  for (const m of s.matchAll(/facebook\.com\/tr\?id=(\d{6,20})/g)) add(m[1]);
  const plugins = [];
  if (/pixelyoursite|pysOptions/i.test(s)) plugins.push('PixelYourSite');
  if (/facebook-for-woocommerce|wc_facebook|facebook_for_woocommerce/i.test(s)) plugins.push('Facebook for WooCommerce');
  if (/official-facebook-pixel|fb_pxl|facebook-pixel/i.test(s)) plugins.push('Meta Pixel for WordPress');
  return { ids: [...new Set(ids)], inits, script: /connect\.facebook\.net\/[^"']*fbevents\.js/.test(s), gtm: /googletagmanager\.com\/gtm\.js/.test(s), plugins };
}

const issue = (key, level, title, detail, fix) => ({ key, level, title, detail, fix });
/**
 * The report: { pixel, pixels, events, purchases, orders, site, checks, issues, ok } — issues ordered bad → warn, each { key, level
 * (bad | warn), title, detail, fix } in Egyptian Arabic. input: { pixels, events (of the first pixel), checks, site (siteScan or null
 * when the page did not answer), orders (our orders in the same 7 days), now }.
 */
export function pixelReport(input) {
  const pixels = Array.isArray(input.pixels) ? input.pixels : [];
  const nowMs = Date.parse(input.now); const ev = isObj(input.events) ? input.events : {}; const site = isObj(input.site) ? input.site : null;
  const orders = Math.max(0, Number(input.orders) || 0); const checks = Array.isArray(input.checks) ? input.checks : [];
  const issues = [];
  const p = pixels[0] || null;
  if (!p) {
    issues.push(issue('no_pixel', 'bad', 'مفيش بيكسل على حساب الإعلانات', 'حساب ميتا المربوط مالوش أي بيكسل — الإعلانات مش هتعرف مين اشترى.',
      'من Events Manager: «Connect data sources» ← Web ← اعمل بيكسل باسم الموقع، وبعدها اربطه بالموقع من إضافة البيكسل في ووردبريس.'));
  } else {
    const hours = p.lastFired ? (nowMs - Date.parse(p.lastFired)) / 3_600_000 : null;
    if (p.unavailable) issues.push(issue('unavailable', 'bad', 'البيكسل متوقف من ميتا', 'ميتا معلّمة البيكسل «مش متاح».', 'افتح Events Manager ← البيكسل ← شوف التنبيه اللي فوق (غالبًا مخالفة سياسة أو البيكسل اتشال من الحساب) وحلّه من هناك.'));
    if (hours === null || hours > 24) issues.push(issue('silent', 'bad', 'البيكسل مابيبعتش أحداث', hours === null ? 'عمره ما بعت حدث.' : 'آخر حدث وصل من ' + Math.round(hours) + ' ساعة.',
      'افتح الموقع في متصفح وبص بـ «Meta Pixel Helper»؛ لو مش ظاهر يبقى الإضافة اتقفلت أو الكاش شالها — فعّل الإضافة وامسح الكاش.'));
    if (!p.matching) issues.push(issue('matching', 'warn', 'المطابقة التلقائية مقفولة', 'ميتا بتطابق أقل من المشترين مع حساباتهم، فنتايج الإعلانات بتبان أقل.',
      'Events Manager ← البيكسل ← Settings ← «Automatic advanced matching» ← شغّلها (الإيميل والتليفون والاسم).'));
    for (const e of PIXEL_EVENTS) {
      if (ev[e]) continue;
      const bad = e === 'Purchase' || e === 'PageView';
      issues.push(issue('event_' + e, bad ? 'bad' : 'warn', 'حدث ' + e + ' مش واصل', 'مفيش ولا ' + e + ' في آخر ' + PIXEL_DAYS + ' أيام.',
        e === 'Purchase' ? 'لازم الحدث يطلع في صفحة «شكرًا على طلبك» بقيمة الأوردر والعملة EGP — من إعدادات إضافة البيكسل فعّل أحداث ووكومرس (Purchase).'
          : 'من إعدادات إضافة البيكسل فعّل أحداث ووكومرس (' + e + ').'));
    }
    const purchases = Number(ev.Purchase) || 0;
    if (purchases && orders >= 5 && purchases > orders * 1.5) issues.push(issue('double', 'warn', 'المشتريات بتتعد أكتر من الأوردرات', purchases + ' Purchase قصاد ' + orders + ' أوردر — غالبًا الحدث بيتبعت مرتين.',
      'شوف لو فيه إضافتين بيبعتوا البيكسل، أو صفحة الشكر بتتفتح تاني؛ ولو فيه Conversions API لازم نفس الـ event_id في المتصفح والسيرفر عشان ميتا تشيل التكرار.'));
    if (orders >= 5 && purchases < orders * 0.5) issues.push(issue('missing', 'bad', 'البيكسل بيفوّت مشتريات', purchases + ' Purchase بس قصاد ' + orders + ' أوردر في نفس الأيام.',
      'شغّل Conversions API من إضافة البيكسل (بتوكن من Events Manager) عشان الأوردرات توصل حتى لو المتصفح منع البيكسل، وتأكد إن الدفع بيرجّع العميل لصفحة الشكر.'));
    if (site) {
      if (!site.ids.length && !site.script) issues.push(issue('site_missing', site.gtm ? 'warn' : 'bad', 'البيكسل مش ظاهر في صفحة الموقع', site.gtm ? 'الموقع فيه Google Tag Manager — ممكن البيكسل جواه.' : 'كود البيكسل مش موجود في الصفحة الرئيسية.',
        'ركّب إضافة البيكسل في ووردبريس (أو تاج في Tag Manager) بالرقم ' + p.id + '، وامسح الكاش.'));
      else if (site.ids.length && !site.ids.includes(p.id)) issues.push(issue('site_other', 'bad', 'رقم البيكسل على الموقع غير بتاع حساب الإعلانات', 'الموقع بيبعت لـ ' + site.ids.join('، ') + ' والإعلانات على ' + p.id + '.',
        'غيّر رقم البيكسل في إضافة ووردبريس لـ ' + p.id + ' (أو اربط البيكسل التاني بحساب الإعلانات من Business Settings).'));
      if (site.ids.length > 1 || site.inits > 1 || site.plugins.length > 1) issues.push(issue('site_twice', 'warn', 'البيكسل متركّب أكتر من مرة', (site.plugins.length > 1 ? 'فيه ' + site.plugins.join(' و') + ' شغّالين مع بعض.' : 'الصفحة بتبدأ البيكسل ' + Math.max(site.inits, site.ids.length) + ' مرات.'),
        'سيب إضافة واحدة بس للبيكسل واقفل التانية (أو شيل الكود اليدوي من الثيم) عشان الأحداث ماتتعدّش مرتين.'));
    }
  }
  for (const c of checks) {
    if (!c.result || c.result === 'passed' || c.result === 'pass') continue;
    issues.push(issue('meta_' + (c.key || c.title).slice(0, 40), c.result === 'failed' || c.result === 'fail' ? 'bad' : 'warn', c.title || c.key, c.description, 'ده فحص ميتا نفسها — افتح Events Manager ← البيكسل ← Diagnostics وهتلاقي زرار الحل جنبه.'));
  }
  issues.sort((a, b) => (a.level === b.level ? 0 : a.level === 'bad' ? -1 : 1));
  return { pixel: p, pixels, events: PIXEL_EVENTS.map((e) => ({ name: e, count: Number(ev[e]) || 0 })), purchases: Number(ev.Purchase) || 0, orders, site, checks, issues, ok: !issues.some((i) => i.level === 'bad') };
}
/** A short text of the report for the buyer's chat (<pixel>) — data, the issues with their fixes. */
export function pixelText(row) {
  if (!isObj(row) || !isObj(row.data)) return '';
  const d = row.data; const p = isObj(d.pixel) ? d.pixel : null;
  const lines = ['checked_at: ' + (row.checked_at || '-'), 'pixel: ' + (p ? p.id + (p.name ? ' (' + p.name + ')' : '') + ' last_fired ' + (p.lastFired || 'never') : 'none'),
    'events_7d: ' + (Array.isArray(d.events) ? d.events.map((e) => e.name + ' ' + e.count).join(', ') : '-'), 'orders_7d: ' + (d.orders ?? '-'),
    'site: ' + (isObj(d.site) ? 'ids ' + (d.site.ids || []).join(' ') + ' · plugins ' + ((d.site.plugins || []).join(' ') || '-') + (d.site.gtm ? ' · gtm' : '') : 'not read')];
  for (const i of Array.isArray(d.issues) ? d.issues.slice(0, 12) : []) lines.push('- [' + i.level + '] ' + i.title + ' — ' + i.detail + ' | fix: ' + i.fix);
  return lines.join('\n').slice(0, 4000);
}
