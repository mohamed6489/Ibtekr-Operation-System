// The developer's daily check (docs/superpowers/plans/2026-11-17-agents-brain.md decision 5, «طريقة أ» — the owner 18 Nov: «المبرمج يكتشف
// المشكلة ويشرحها ويقولك الحل، والتصليح نفسه بيتعمل هنا معايا»): once a day notify reads the system's health and this module turns it into
// the developer assistant's notes — one per problem, each with what happened, since when and how often, the likely cause, the fix, and
// whether it needs a change in the code (copy it to the Claude Code session) or something the owner does himself (and where). Under the
// line «للجلسة:» a short technical summary — places in our code, counts and times, never a customer's data — that the chat's
// «انسخ للجلسة» button copies. Pure: no I/O, no AI call (the check costs nothing). A problem that is gone loses its note (notify clears
// the «dev:» refs this run did not write — a source that could not be read keeps its notes).

import { waitLabel } from './agent-actions.js';
import { COMMANDS, COMMAND_KEYS, LIST_DATE, OTHER_PROVIDERS, PROVIDER_TIERS, TIER_MODEL, modelNews, otherNews, otherText, tierFor } from './ai-routing.js';

export const SESSION_MARK = 'للجلسة:'; // the line before the technical summary (the chat's copy button takes what follows it)
export const DEV_PREFIX = 'dev:';
export const DEV_HOUR = 9; // the check runs once a day from 9 in the morning, Cairo
export const DEV_MAX = 15; // notes in one run (the worst first)
export const SPEED_MIN = 50; // the lowest mobile PageSpeed score that is not a problem
export const SYNC_IN_MIN = 3; // failures of one sync part from the site before it is a problem (one failed write by the team is one)
export const HTTP_MIN = 5; // the scheduler's failed calls to our functions before it is a problem

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const line = (v, n) => String(v ?? '').replace(/[<>\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const key = (v) => String(v ?? '').replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 80);
const ms = (v) => { const t = Date.parse(String(v || '')); return Number.isFinite(t) ? t : null; };
const ago = (at, now) => { const t = ms(at); return t == null ? '' : 'من ' + waitLabel((now - t) / 60000); };
const iso = (at) => { const t = ms(at); return t == null ? '' : new Date(t).toISOString().slice(0, 16) + 'Z'; };
const times = (n) => (n === 1 ? 'مرة واحدة' : n === 2 ? 'مرتين' : n + ' مرات');

/** Is the check due now? From DEV_HOUR Cairo, once a day (`last` = the day of the last run). */
export function devDue(cairo, last) {
  const day = String(cairo && cairo.day || '').slice(0, 10); const hour = Number(String(cairo && cairo.time || '00:00').slice(0, 2));
  return !!day && hour >= DEV_HOUR && String(last || '') !== day;
}

/** The text after «للجلسة:» in a note (empty when it has none) — what «انسخ للجلسة» copies. */
export function sessionOf(text) {
  const s = String(text || ''); const i = s.indexOf(SESSION_MARK); return i < 0 ? '' : s.slice(i + SESSION_MARK.length).trim();
}

// one note: the parts in the owner's words, then the technical lines
function note(kind, ref, title, p, rank) {
  const body = [
    'إيه اللي حصل: ' + p.what,
    p.when ? 'إمتى: ' + p.when : '',
    'السبب المتوقع: ' + p.cause,
    'الحل: ' + p.fix,
    p.code ? '← ده محتاج تعديل في الكود: دوس «انسخ للجلسة» وابعته في جلسة Claude Code.' : '← دي حاجة تعملها إنت' + (p.where ? ': ' + p.where : '') + '.',
  ].filter(Boolean).join('\n') + '\n\n' + SESSION_MARK + '\n' + p.tech.filter(Boolean).map((t) => line(t, 300)).join('\n');
  return { agent: 'dev', kind, ref: DEV_PREFIX + ref, link: null, title: line(title, 118), body: body.slice(0, 3900), rank };
}

const CRASH = {
  TypeError: ['حاجة في الصفحة اتقرت وهي فاضية أو مش من النوع المتوقع (غالبًا بيانات ناقصة جت من السيرفر).', 'نشوف السطر ده ونخلّيه يستحمل البيانات الناقصة.'],
  ReferenceError: ['الكود بينادي حاجة مش موجودة (اسم غلط أو ملف ماتحمّلش).', 'نصلّح الاسم أو ترتيب تحميل الملفات.'],
  SyntaxError: ['ملف اتنشر فيه غلط في الكتابة أو داتا مش مفهومة.', 'نصلّح الملف وننشره تاني.'],
  RangeError: ['رقم أو تاريخ برّه الحدود اللي الكود مستنيها.', 'نحط حد للقيمة دي في الكود.'],
  blank: ['الصفحة فضيت — حاجة وقّفت الرسم قبل ما يخلص.', 'نشوف سجل الأخطاء ساعتها والصفحة اللي كان فيها.'],
};
const crashOf = (kind) => CRASH[kind] || ['خطأ في الكود وهو شغّال على الشاشة.', 'نشوف السطر ده ونصلّحه.'];

// a site error's text → its cause and who fixes it
function syncCause(text) {
  const t = String(text || '');
  if (/\b(401|403)\b|unauthor|forbidden|invalid_username|consumer/i.test(t)) return { cause: 'مفاتيح الموقع (WooCommerce) اتغيّرت أو اتلغت، أو الصلاحية بتاعتها اتقللت.', fix: 'اعمل مفاتيح جديدة من ووكومرس وحطها في الإعدادات › الربط بالمنصات › WooCommerce.', code: false, where: 'الإعدادات › الربط بالمنصات' };
  if (/\b(5\d\d)\b|timeout|timed out|network|ECONN|fetch failed|gateway/i.test(t)) return { cause: 'الموقع كان واقع أو بطيء جدًا وقت المحاولة (مشكلة في الاستضافة غالبًا).', fix: 'المزامنة بتعيد لوحدها في التشغيلة الجاية. لو فضلت تتكرر بص على الاستضافة (Hostinger) — الضغط على السيرفر أو إضافة بتقيّل الموقع.', code: false, where: 'لوحة الاستضافة' };
  if (/\b(400|404|409|422)\b|invalid|rest_/i.test(t)) return { cause: 'الموقع رفض البيانات اللي اتبعتت — شكلها مش زي ما هو مستنيه.', fix: 'نشوف الحقل اللي اترفض ونظبط الكود اللي بيبعته.', code: true };
  return { cause: 'خطأ من السيستم نفسه وهو بيكلّم الموقع.', fix: 'نقرا نص الخطأ ونصلّح مكانه.', code: true };
}
const SYNC_AR = { order: 'الأوردرات', sub_order: 'الأوردرات الفرعية', vendor: 'المبتكرين', vendors: 'المبتكرين', product: 'المنتجات', products: 'المنتجات', categories: 'الأقسام', accounts: 'حسابات المبتكرين', webhook: 'رسايل الموقع (webhooks)', brands: 'البراندات', carts: 'السلال' };

const CHANNEL_FIX = { meta: 'اربط صفحة الفيسبوك تاني من الإعدادات › الربط بالمنصات › Meta.', wa1: 'اربط واتساب 1 تاني من الإعدادات › الربط بالمنصات › واتساب.' };
const AD_PLAT = { meta: 'ميتا', tiktok: 'تيك توك', google: 'جوجل' };
const OTHER_NAME = { openai: 'ChatGPT (OpenAI)', gemini: 'Gemini (Google)' };
const AD_BAD = { DISABLED: 'الحساب متوقف من المنصة', UNSETTLED: 'فيه فلوس مستحقة على الحساب', PENDING_RISK_REVIEW: 'الحساب تحت مراجعة من المنصة', PENDING_SETTLEMENT: 'الحساب مستني سداد', CLOSED: 'الحساب اتقفل', PENDING_CLOSURE: 'الحساب بيتقفل' };

/**
 * The day's problems → the developer's notes (the worst first, DEV_MAX at most) and the refs to keep.
 * input: { now: ms, crashes: [{ at, actor, new_value: { kind, at: 'file.js:L:C' } }] | null, sync: [{ at, kind, direction, entity, action,
 *   detail }] | null, cron: { jobs: [{ name, runs, failed, last_failed_at, msg }], http: { failed, codes, msg } } | null,
 *   checks: { pagespeed?: { data, checked_at }, wp_updates?: { data, checked_at } } | null, channels: [{ id, name, kind, status }] | null,
 *   ads: [{ platform, id, name, status, meta }] | null, models: ['claude-…'] (the ids Anthropic serves the linked key; [] = Claude is not
 *   linked) | null } — a source that could not be read is null.
 * → { notes: [{ agent, kind, ref, link, title, body }], keep: ['dev:crash:', …] (the prefixes of the sources not read — their notes stay) }
 */
export function devNotes(input) {
  const x = isObj(input) ? input : {}; const now = Number(x.now) || Date.now();
  const out = []; const keep = [];
  // 1) the screen's errors (app.crash — kind and file:line only)
  if (Array.isArray(x.crashes)) {
    const g = new Map();
    for (const r of x.crashes) {
      // the row is written by a member's browser (log_activity): only the shapes the crash guard writes are taken — an Error name and
      // «file.js:line:col» — so nothing free-form reaches the summary copied to the Claude Code session (security review)
      const v = isObj(r && r.new_value) ? r.new_value : {};
      const kind = /^(blank|[A-Z][A-Za-z]{0,30}Error|Error)$/.test(String(v.kind || '')) ? String(v.kind) : 'Error';
      const where = /^[\w.-]{1,80}\.js:\d{1,6}(:\d{1,6})?$/.test(String(v.at || '')) ? String(v.at).replace(/:\d+$/, '') : ''; const k = kind + '@' + (where || '-');
      const e = g.get(k) || { kind, where, n: 0, people: new Set(), first: r.at, last: r.at };
      e.n++; if (r.actor) e.people.add(String(r.actor)); if (String(r.at) < String(e.first)) e.first = r.at; if (String(r.at) > String(e.last)) e.last = r.at; g.set(k, e);
    }
    for (const e of g.values()) {
      const [cause, fix] = crashOf(e.kind); const file = e.where ? e.where.split(':')[0] : '';
      out.push(note('problem', 'crash:' + key(e.kind + '@' + e.where),
        (e.kind === 'blank' ? 'صفحة فضيت على الشاشة' : 'خطأ على الشاشة' + (file ? ' في «' + file + '»' : '')) + ' — ' + times(e.n),
        { what: (e.kind === 'blank' ? 'الشاشة فضيت' : 'طلع خطأ ' + e.kind) + ' لـ ' + (e.people.size || 1) + ' من الفريق، ' + times(e.n) + ' في آخر 24 ساعة.',
          when: ago(e.first, now) + ' — آخر مرة ' + ago(e.last, now), cause, fix, code: true,
          tech: ['app.crash · ' + e.kind + (e.where ? ' at ' + e.where : ' (blank page)') + ' · ' + e.n + 'x · ' + (e.people.size || 1) + ' member(s)',
            'first ' + iso(e.first) + ' · last ' + iso(e.last), 'source: activity_log action=app.crash (new_value.kind / new_value.at)'] }, 10 + e.n));
    }
  } else keep.push(DEV_PREFIX + 'crash:');
  // 2) the sync with the site (woo_sync_log result=error)
  if (Array.isArray(x.sync)) {
    const g = new Map();
    for (const r of x.sync) {
      const k = [r.kind, r.direction, r.entity, r.action].map((v) => line(v, 30)).join('/');
      const e = g.get(k) || { r, n: 0, first: r.at, last: r.at, err: '' };
      e.n++; if (String(r.at) < String(e.first)) e.first = r.at; if (String(r.at) >= String(e.last)) { e.last = r.at; const d = isObj(r.detail) ? r.detail : {}; e.err = line(d.error || d.reason || d.code || '', 160); e.step = line(d.step, 30); }
      g.set(k, e);
    }
    for (const [k, e] of g) {
      const out_ = e.r.direction === 'out'; if (e.n < (out_ ? 1 : SYNC_IN_MIN)) continue;
      const what = SYNC_AR[e.r.entity] || line(e.r.entity, 30) || 'المزامنة'; const c = syncCause(e.err);
      out.push(note('problem', 'sync:' + key(k),
        (out_ ? 'كتابة على الموقع فشلت — ' : 'مزامنة ') + what + (out_ ? '' : ' مع الموقع فشلت') + ' ' + times(e.n),
        { what: (out_ ? 'السيستم حاول يكتب ' + what + ' على الموقع وفشل' : 'السيستم حاول يجيب ' + what + ' من الموقع وفشل') + ' ' + times(e.n) + ' في آخر 24 ساعة' + (e.err ? ' — آخر رسالة: «' + line(e.err, 100) + '»' : '') + '.',
          when: ago(e.first, now) + ' — آخر مرة ' + ago(e.last, now), cause: c.cause, fix: c.fix, code: c.code, where: c.where,
          tech: ['woo_sync_log result=error · ' + k + (e.step ? ' · step ' + e.step : '') + ' · ' + e.n + 'x', 'first ' + iso(e.first) + ' · last ' + iso(e.last), e.err ? 'last error: ' + e.err : ''].filter(Boolean) }, (out_ ? 30 : 20) + e.n));
    }
  } else keep.push(DEV_PREFIX + 'sync:');
  // 3) the scheduled jobs (pg_cron) and the scheduler's calls to our functions (pg_net)
  if (isObj(x.cron)) {
    for (const j of Array.isArray(x.cron.jobs) ? x.cron.jobs : []) {
      if (!isObj(j) || !(Number(j.failed) > 0)) continue; const name = line(j.name, 60);
      out.push(note('problem', 'cron:' + key(name), 'مهمة «' + name + '» اللي بتشتغل لوحدها فشلت ' + times(Number(j.failed)),
        { what: 'المهمة المجدولة «' + name + '» فشلت ' + times(Number(j.failed)) + ' من ' + Number(j.runs || 0) + ' تشغيلة في آخر 24 ساعة' + (j.msg ? ' — «' + line(j.msg, 100) + '»' : '') + '.',
          when: j.last_failed_at ? 'آخر مرة ' + ago(j.last_failed_at, now) : '', cause: 'المهمة نفسها بترجع خطأ — غالبًا دالة اتغيّرت أو سر ناقص.', fix: 'نشوف رسالة الخطأ ونصلّح الدالة أو المهمة.', code: true,
          tech: ['pg_cron job ' + name + ' · failed ' + Number(j.failed) + '/' + Number(j.runs || 0) + ' in 24h · last failed ' + iso(j.last_failed_at), j.msg ? 'return_message: ' + line(j.msg, 160) : '', 'source: dev_cron_health() (cron.job_run_details)'].filter(Boolean) }, 40 + Number(j.failed)));
    }
    const http = isObj(x.cron.http) ? x.cron.http : {}; const n = Number(http.failed) || 0;
    if (n >= HTTP_MIN) {
      const codes = isObj(http.codes) ? Object.entries(http.codes).map(([c, v]) => c + '×' + v).join(', ') : '';
      out.push(note('problem', 'http:functions', 'نداءات المهام المجدولة لدوال السيستم رجعت بخطأ ' + times(n),
        { what: 'المهام اللي بتشتغل لوحدها نادت دوال السيستم ورجعت بخطأ ' + times(n) + ' في آخر 24 ساعة' + (codes ? ' (' + codes + ')' : '') + '.', when: '',
          cause: '500 = الدالة نفسها وقعت؛ «network» = الدالة ماردتش في الوقت.', fix: 'نشوف سجلات الدوال على Supabase في نفس الوقت ونصلّح الدالة اللي بتقع.', code: true,
          tech: ['pg_net net._http_response · status>=500 or error · ' + n + 'x in 24h' + (codes ? ' · ' + codes : ''), http.msg ? 'last error_msg: ' + line(http.msg, 160) : '', 'next: Supabase function logs (query_logs edge-function) around these times'].filter(Boolean) }, 35 + n));
    }
  } else keep.push(DEV_PREFIX + 'cron:', DEV_PREFIX + 'http:');
  // 4) the site's speed and 5) the WordPress updates (site_checks)
  if (isObj(x.checks)) {
    const ps = isObj(x.checks.pagespeed) && isObj(x.checks.pagespeed.data) ? x.checks.pagespeed.data : null;
    if (ps && Number.isFinite(Number(ps.score)) && ps.score !== null && Number(ps.score) < SPEED_MIN) {
      const pages = Array.isArray(ps.pages) ? ps.pages : []; const worst = pages.filter((p) => p && p.mobile && p.mobile.score != null).sort((a, b) => a.mobile.score - b.mobile.score)[0];
      const opps = worst && Array.isArray(worst.mobile.opps) ? worst.mobile.opps.slice(0, 3) : [];
      out.push(note('alert', 'speed:mobile', 'الموقع بطيء على الموبايل — الدرجة ' + Number(ps.score) + '/100',
        { what: 'أقل درجة سرعة على الموبايل ' + Number(ps.score) + ' من 100' + (worst ? ' في «' + line(worst.path, 60) + '»' : '') + ' (Google PageSpeed).', when: 'آخر فحص ' + ago(x.checks.pagespeed.checked_at, now),
          cause: opps.length ? 'أكتر حاجات بتقيّل: ' + opps.map((o) => line(o.title, 60)).join('، ') + '.' : 'صور كبيرة أو إضافات كتير على ووردبريس غالبًا.',
          fix: 'ضغط الصور وكاش الصفحات وتقليل الإضافات من ووردبريس — والتفاصيل اسألني عليها هنا.', code: false, where: 'لوحة ووردبريس (إضافة الكاش والصور)',
          tech: ['site_checks pagespeed · lowest mobile ' + Number(ps.score) + (worst ? ' at ' + line(worst.path, 80) : '') + ' · checked ' + iso(x.checks.pagespeed.checked_at), ...opps.map((o) => '- ' + line(o.title, 80) + (o.ms ? ' (' + Math.round(o.ms / 100) / 10 + 's)' : ''))] }, 8));
    }
    const wp = isObj(x.checks.wp_updates) && isObj(x.checks.wp_updates.data) ? x.checks.wp_updates.data : null;
    if (wp && Number(wp.updates) > 0) {
      const list = [wp.core && wp.core.update ? 'ووردبريس ' + line(wp.core.version, 12) + ' ← ' + line(wp.core.latest, 12) : '',
        wp.theme && wp.theme.update ? 'الثيم ' + line(wp.theme.name, 40) : '',
        ...(Array.isArray(wp.plugins) ? wp.plugins.filter((p) => p && p.update).slice(0, 8).map((p) => line(p.name, 40) + ' ' + line(p.version, 12) + ' ← ' + line(p.latest, 12)) : [])].filter(Boolean);
      out.push(note('update', 'wp:updates', Number(wp.updates) + ' تحديث مستني على ووردبريس',
        { what: 'فيه ' + Number(wp.updates) + ' تحديث مستني: ' + list.slice(0, 4).join('، ') + (list.length > 4 ? '…' : '') + '.', when: 'آخر فحص ' + ago(x.checks.wp_updates.checked_at, now),
          cause: 'نسخ أحدث نزلت من ووردبريس أو الإضافات — فيها إصلاحات أمان غالبًا.', fix: 'خد نسخة احتياطية الأول، وحدّث من لوحة ووردبريس على الـ staging، وجرّب الأوردرات والدفع، وبعدين على الموقع.', code: false, where: 'لوحة ووردبريس',
          tech: ['site_checks wp_updates · ' + Number(wp.updates) + ' pending · checked ' + iso(x.checks.wp_updates.checked_at), ...list.map((s) => '- ' + s)] }, 5));
    }
  } else keep.push(DEV_PREFIX + 'speed:', DEV_PREFIX + 'wp:');
  // 6) the links that fell (the channels, the ad accounts)
  if (Array.isArray(x.channels)) {
    for (const c of x.channels) {
      if (!isObj(c) || c.status !== 'error') continue; const name = line(c.name || c.id, 40); const fixKey = c.id === 'wa1' ? 'wa1' : 'meta';
      out.push(note('problem', 'link:' + key(c.id), 'الربط وقع: ' + name,
        { what: 'قناة «' + name + '» حالتها «خطأ» — الرسايل مش هتوصل ولا هتتبعت منها.', when: '', cause: 'التوكن انتهى أو الصلاحية اتشالت من ميتا، أو الصفحة اتفصلت.', fix: CHANNEL_FIX[fixKey], code: false, where: 'الإعدادات › الربط بالمنصات',
          tech: ['cs_channels id=' + key(c.id) + ' kind=' + key(c.kind) + ' status=error'] }, 25));
    }
  } else keep.push(DEV_PREFIX + 'link:');
  if (Array.isArray(x.ads)) {
    for (const a of x.ads) {
      if (!isObj(a)) continue; const m = isObj(a.meta) ? a.meta : {}; const bad = AD_BAD[a.status]; const err = line(m.error, 40);
      if (!bad && !err) continue; const plat = AD_PLAT[a.platform] || line(a.platform, 20);
      out.push(note('problem', 'ads:' + key(a.platform + '-' + a.id), 'حساب إعلانات ' + plat + ': ' + (bad || 'أرقامه مابتتسحبش'),
        { what: bad ? 'حساب الإعلانات «' + line(a.name || a.id, 40) + '» على ' + plat + ': ' + bad + '.' : 'أرقام حساب الإعلانات «' + line(a.name || a.id, 40) + '» على ' + plat + ' مابتتسحبش — الكود «' + err + '».',
          when: m.synced_at ? 'آخر سحب ناجح ' + ago(m.synced_at, now) : '',
          cause: bad ? 'حاجة على حساب الإعلانات نفسه عند المنصة.' : 'التوكن انتهى أو الصلاحية اتشالت، أو المنصة واقعة.', fix: bad ? 'افتح مدير الإعلانات على ' + plat + ' وشوف التنبيه اللي هناك.' : 'اربط الحساب تاني من الإعدادات › الربط بالمنصات › الإعلانات.', code: false, where: bad ? 'مدير الإعلانات على ' + plat : 'الإعدادات › الربط بالمنصات',
          tech: ['mkt_ad_objects kind=account platform=' + key(a.platform) + ' id=' + key(a.id) + ' status=' + key(a.status) + (err ? ' meta.error=' + err : '') + ' · checked ' + iso(m.checked_at)] }, 22));
    }
  } else keep.push(DEV_PREFIX + 'ads:');
  // 7) Claude's models (the owner 22 Nov — «تعرفني لو فيه تحديثات عن طريق المبرمج عشان نعمل تحديث للسيستم»): the list Anthropic serves the
  // linked key against the one this system knows (ai-routing.js) — a new model is an update to look at, a routed model that is no
  // longer served is a problem (its commands fail). Model ids only; [] = Claude is not linked (nothing to say)
  if (Array.isArray(x.models)) {
    const news = modelNews(x.models); const TIER_AR = { light: 'الضعيف', mid: 'المتوسط', heavy: 'القوي' };
    if (news.fresh.length) {
      const ids = news.fresh.map((m) => line(m, 60));
      out.push(note('update', 'model:new:' + key(ids.join('+')), ids.length === 1 ? 'موديل جديد من Claude: ' + ids[0] : ids.length + ' موديلات جديدة من Claude',
        { what: 'Anthropic بقت بتقدّم ' + (ids.length === 1 ? 'موديل' : 'موديلات') + ' مش في قايمة السيستم: ' + ids.join('، ') + '.', when: '',
          cause: 'قايمة الموديلات وأسعارها وتوزيع الأوامر عليها في السيستم مكتوبين على قايمة Anthropic بتاريخ ' + LIST_DATE + '.',
          fix: 'نراجع الموديل الجديد وسعره، ولو أحسن أو أرخص لمستوى من التلاتة نحدّث القايمة والأسعار والتوزيع. لحد كده السيستم شغّال زي ما هو على موديلاته الحالية.', code: true,
          tech: ['Claude models: served but not in KNOWN_MODELS (supabase/functions/_shared/ai-routing.js, LIST_DATE ' + LIST_DATE + '): ' + ids.join(', '),
            'routed now: light=' + TIER_MODEL.light + ' mid=' + TIER_MODEL.mid + ' heavy=' + TIER_MODEL.heavy,
            'to update: KNOWN_MODELS / TIER_MODEL / TIER_USD / LIST_DATE (ai-routing.js), PRICES (ai-content.js), the page copy app/js/pages/ai-routing.js, tests/functions/ai-routing.test.mjs — from Anthropic\'s models and pricing pages'] }, 6));
    }
    for (const m of news.gone) {
      const tier = Object.keys(TIER_MODEL).find((t) => TIER_MODEL[t] === m); const cmds = COMMAND_KEYS.filter((c) => tierFor(c) === tier);
      out.push(note('problem', 'model:gone:' + key(m), 'موديل Claude اللي السيستم بيستخدمه مابقاش متاح: ' + m,
        { what: 'الموديل «' + m + '» (المستوى ' + (TIER_AR[tier] || tier) + ') مش في القايمة اللي Anthropic بتقدّمها للمفتاح المربوط — الأوامر اللي عليه هتفشل.', when: '',
          cause: 'Anthropic وقّفت الموديل ده أو المفتاح المربوط مالوش صلاحية عليه.',
          fix: 'نحدّث السيستم على الموديل اللي حل محله. ولحد ما يتحدّث: من الإعدادات › الذكاء الاصطناعي › المزوّدين غيّر مستوى الأوامر دي، أو اقفل «اختيار الموديل تلقائي» واختار موديل شغّال.', code: true,
          tech: ['Claude models: ' + m + ' (TIER_MODEL.' + tier + ', supabase/functions/_shared/ai-routing.js) is not in GET /v1/models for the linked key',
            'commands recommended on it: ' + cmds.join(', '), 'served: ' + x.models.map((s) => line(s, 60)).filter((s) => /^claude-/.test(s)).slice(0, 30).join(', ')] }, 30));
    }
  } else keep.push(DEV_PREFIX + 'model:');
  // 8) the other linked text companies (the owner 22 Nov — «المبرمج علي حسب الشركات المتركبة هيبعت لو في موديلات جديدة»): OpenAI's and
  // Gemini's served lists against the first read of each (x.others[company] = { served, baseline }) — a model that came after it
  // is an update, a level's model that is no longer served is a problem. served [] = not linked; null = the read failed
  for (const p of OTHER_PROVIDERS) {
    const o = isObj(x.others) ? x.others[p] : undefined; const name = OTHER_NAME[p];
    if (!isObj(o) || !Array.isArray(o.served)) { keep.push(DEV_PREFIX + 'model:new:' + p + ':', DEV_PREFIX + 'model:gone:' + p + ':'); continue; }
    const news = otherNews(p, o.served, Array.isArray(o.baseline) ? o.baseline : null); const T = PROVIDER_TIERS[p];
    if (news.fresh.length) {
      const ids = news.fresh.map((m) => line(m, 60));
      out.push(note('update', 'model:new:' + p + ':' + key(ids.join('+')), ids.length === 1 ? 'موديل جديد من ' + name + ': ' + ids[0] : ids.length + ' موديلات جديدة من ' + name,
        { what: name + ' بقت بتقدّم ' + (ids.length === 1 ? 'موديل' : 'موديلات') + ' ماكانتش موجودة لما اتربطت: ' + ids.join('، ') + '.', when: '',
          cause: 'تقسيم موديلات ' + name + ' (ضعيف / متوسط / قوي) وأسعارها في السيستم مكتوبين على موديلاتها وقت الربط.',
          fix: 'نراجع الموديل الجديد وسعره، ولو أحسن أو أرخص لمستوى نضيفه للاختيارات وللتقسيم التلقائي. لحد كده السيستم شغّال على موديلاته الحالية.', code: true,
          tech: [name + ' models: served now, not in the first read (sync_state dev_models.' + p + ') nor in OTHER_KNOWN.' + p + ' (supabase/functions/_shared/ai-routing.js): ' + ids.join(', '),
            'levels now: light=' + T.light + ' mid=' + T.mid + ' heavy=' + T.heavy,
            'to update: PROVIDER_TIERS / OTHER_KNOWN (ai-routing.js), TEXT_PROVIDERS.' + p + '.models and TEXT_PRICES (ai-providers.js), the page copy app/js/pages/ai-routing.js, tests/functions/ai-routing.test.mjs — from the company\'s models and pricing pages'] }, 6));
    }
    for (const m of news.gone) {
      out.push(note('problem', 'model:gone:' + p + ':' + key(m), 'موديل ' + name + ' اللي السيستم بيستخدمه مابقاش متاح: ' + m,
        { what: 'الموديل «' + m + '» مش في القايمة اللي ' + name + ' بتقدّمها للمفتاح المربوط — الأوامر اللي عليه هتفشل.', when: '',
          cause: name + ' وقّفت الموديل ده أو المفتاح المربوط مالوش صلاحية عليه.',
          fix: 'نحدّث السيستم على الموديل اللي حل محله. ولحد ما يتحدّث: من الإعدادات › الذكاء الاصطناعي › المزوّدين اقفل «اختيار الموديل تلقائي» واختار موديل شغّال، أو غيّر الشركة.', code: true,
          tech: [name + ' models: ' + m + ' (PROVIDER_TIERS.' + p + ', supabase/functions/_shared/ai-routing.js) is not served for the linked key',
            'served text models: ' + otherText(p, o.served).slice(0, 30).join(', ')] }, 30));
    }
  }
  out.sort((a, b) => b.rank - a.rank);
  return { notes: out.slice(0, DEV_MAX).map(({ rank: _r, ...n }) => n), refs: out.map((n) => n.ref), keep };
}
