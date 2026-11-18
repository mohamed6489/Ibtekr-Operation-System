// The assistants prepare the action themselves (docs/superpowers/plans/2026-11-17-agents-brain.md decision 7 / T7 — the owner 17 Nov:
// «بتاع خدمة العملاء يحضر رد تلقائي للعميل لو اتاخرنا في الرد و هكذا»): notify finds the case and writes the assistant's note with the
// action ready in it — here a customer conversation waiting for our reply past the SLA gets a reply written for it; the bell's click opens
// that conversation with the reply in its box (app/js/adapter/alerts.js), and a member presses «ابعت». Nothing is sent from here: the
// sending alone is a rule in «الرد الآلي» if the owner turns it on. Pure: no I/O, no AI call (no cost on the cron), no message text read.

export const DRAFT_MARK = 'الرد المقترح:'; // the line before the ready reply in the note's body (the bell takes what follows it)
export const CS_LATE_MAX = 10; // conversations in one tick (oldest first)
const WAITING = 'مستنية ردنا';
const PLATFORM_AR = { whatsapp: 'واتساب', messenger: 'ماسنجر', instagram: 'إنستجرام', tiktok: 'تيك توك', facebook: 'فيسبوك' };
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const line = (v, n) => String(v ?? '').replace(/[<>\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 45 → «45 دقيقة», 150 → «2 ساعة», 3000 → «يومين» */
export function waitLabel(min) {
  const m = Math.max(0, Math.round(Number(min) || 0));
  if (m < 120) return m + ' دقيقة';
  const h = Math.floor(m / 60); if (h < 48) return h + ' ساعة';
  const d = Math.floor(h / 24); return d === 2 ? 'يومين' : d + ' أيام';
}
/** The customer's first name for the greeting (a placeholder handle like «عميل ماسنجر» / «زائر فيسبوك» = no name). */
export function firstName(name) {
  const s = line(name, 60); if (!s || /^(عميل|زائر)(\s|$)/.test(s)) return '';
  return s.split(' ')[0].slice(0, 30);
}
/** The ready reply: warm, Egyptian, an apology for the wait and an open hand — the member edits it before «ابعت». */
export function lateReply(name, min) {
  const n = firstName(name); const long = Number(min) >= 24 * 60;
  return (n ? 'أهلًا يا ' + n + ' 🌿' : 'أهلًا بيك 🌿') + '\n'
    + (long ? 'آسفين جدًا إننا اتأخرنا عليك في الرد — حقك علينا.' : 'آسفين إننا اتأخرنا عليك شوية في الرد.') + '\n'
    + 'إحنا معاك دلوقتي، قولّي محتاج إيه وهنخلّصهولك على طول.';
}

/**
 * Customer conversations waiting for our reply past `slaMin` minutes (not snoozed into the future) → the customer-service assistant's
 * notes, oldest first, one per wait (ref cs-late:<conversation>:<waiting since> — a new wait is a new note, the same wait is updated):
 * convs: [{ id, seg, status, handle, platform, customer_id, waiting_since, snoozed_until }], names: { customer_id: name }.
 * → [{ agent: 'cs', kind: 'alert', ref, link: 'cs/<id>', title, body }]
 */
export function csLateNotes(convs, names, nowMs, slaMin) {
  const sla = Math.max(1, Number(slaMin) || 60);
  const late = (Array.isArray(convs) ? convs : []).filter((c) => isObj(c) && UUID.test(String(c.id)) && c.seg === 'customers' && c.status === WAITING && typeof c.waiting_since === 'string')
    .map((c) => ({ c, min: Math.floor((nowMs - Date.parse(c.waiting_since)) / 60_000) }))
    .filter((x) => Number.isFinite(x.min) && x.min >= sla && !(typeof x.c.snoozed_until === 'string' && Date.parse(x.c.snoozed_until) > nowMs))
    .sort((a, b) => b.min - a.min).slice(0, CS_LATE_MAX);
  return late.map(({ c, min }) => {
    const name = line((isObj(names) && names[c.customer_id]) || c.handle, 60) || 'عميل';
    const where = PLATFORM_AR[c.platform] || line(c.platform, 20);
    return { agent: 'cs', kind: 'alert', ref: 'cs-late:' + c.id + ':' + String(c.waiting_since).slice(0, 19), link: 'cs/' + c.id,
      title: 'رد جاهز لـ «' + line(name, 40) + '» — مستني ردنا من ' + waitLabel(min),
      body: line(name, 60) + ' مستني ردنا على ' + where + ' من ' + waitLabel(min) + '. جهّزت له رد — افتح المحادثة، عدّل فيه لو حابب، واضغط «ابعت».\n\n'
        + DRAFT_MARK + '\n' + lateReply(name, min) };
  });
}
