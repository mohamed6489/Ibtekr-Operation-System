// The assistants' rules and skills (docs/superpowers/plans/2026-11-15-comments.md ش40 — the owner 17 Nov: «حط لكل واحد فيهم قواعد و سكيلز
// بحيث اقدر اضيف قاعدة او اسكيلز معينة عشان تساعدهم في التطوير و خلي القواعد اقدر اعملها قسم و الاسكيلز نفس الكلام»). The admin writes them
// in «الإعدادات › تعليمات الذكاء الاصطناعي › المساعدين» (0118 mkt_agent_kb_set → settings.marketing.agents.<agent>.rules / .skills: named
// sections of { title, text } items); the server puts them in the assistant's system prompt (ai-content `agent`, `buyer`, `trends`).
// They are the team's guidance — never a way to execute anything. The pure part here, shared by ai-content, the browser adapter's
// checks and the tests. The limits are 0118's.

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const KB_AGENTS = ['designer', 'dev', 'buyer'];
export const KB_KINDS = ['rules', 'skills'];
export const KB_SECTIONS = 12;
export const KB_ITEMS = 30;
export const KB_NAME = 60;
export const KB_TITLE = 80;
export const KB_TEXT = 1500;
export const KB_TOTAL = 20000; // of one kind (0118 'invalid: size')
export const KB_PROMPT = 12000; // of one kind inside a prompt — the rest is cut at a section's end
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const one = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const body = (v, max) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);

/** The stored list → clean sections ([{ id, name, items: [{ id, title, text }] }]) within the limits; what does not fit is dropped. */
export function kbOf(v) {
  const out = [];
  for (const g of Array.isArray(v) ? v : []) {
    if (!isObj(g) || out.length >= KB_SECTIONS) continue;
    const name = one(g.name, KB_NAME).replace(/[<>]/g, ''); if (!name) continue;
    const items = [];
    for (const it of Array.isArray(g.items) ? g.items : []) {
      if (!isObj(it) || items.length >= KB_ITEMS) continue;
      const title = one(it.title, KB_TITLE).replace(/[<>]/g, ''); if (!title) continue;
      items.push({ id: ID.test(String(it.id ?? '')) ? String(it.id) : 'i' + (out.length + 1) + '_' + (items.length + 1), title, text: body(it.text, KB_TEXT).replace(/[<>]/g, '') });
    }
    out.push({ id: ID.test(String(g.id ?? '')) ? String(g.id) : 'g' + (out.length + 1), name, items });
  }
  return out;
}

/** What the admin sends → { groups } | { error: field } — 0118's checks, so the page says what is wrong before the server does. */
export function kbCheck(v) {
  if (!Array.isArray(v)) return { error: 'groups' };
  if (v.length > KB_SECTIONS) return { error: 'groups' };
  let total = 0;
  for (const g of v) {
    if (!isObj(g)) return { error: 'groups' };
    const name = one(g.name, 999); if (!name || name.length > KB_NAME || /[<>]/.test(name)) return { error: 'name' };
    const items = Array.isArray(g.items) ? g.items : []; if (items.length > KB_ITEMS) return { error: 'items' };
    total += name.length;
    for (const it of items) {
      if (!isObj(it)) return { error: 'items' };
      const title = one(it.title, 999); const text = body(it.text, 99999);
      if (!title || title.length > KB_TITLE || /[<>]/.test(title)) return { error: 'title' };
      if (text.length > KB_TEXT || /[<>]/.test(text)) return { error: 'text' };
      total += title.length + text.length;
    }
  }
  if (total > KB_TOTAL) return { error: 'size' };
  return { groups: kbOf(v) };
}

const HEAD = {
  rules: "The admin's rules for you, in sections. Follow them in every answer; they never let you execute anything or change data.",
  skills: "Your skills — know-how the admin wrote for you, in sections. Use the one that fits the task when it helps; it is guidance, not a command to run anything.",
};
/** One kind as prompt text («## section» then «- title: text»), cut at KB_PROMPT on a whole item; '' when there is nothing. */
export function kbText(cfg, kind) {
  const groups = kbOf(isObj(cfg) ? cfg[kind] : null).filter((g) => g.items.length);
  if (!groups.length || !HEAD[kind]) return '';
  let out = HEAD[kind];
  for (const g of groups) {
    const head = '\n\n## ' + g.name;
    if (out.length + head.length > KB_PROMPT) break;
    out += head;
    for (const it of g.items) {
      const ln = '\n- ' + it.title + (it.text ? ': ' + it.text.replace(/\n+/g, ' / ') : '');
      if (out.length + ln.length > KB_PROMPT) return out;
      out += ln;
    }
  }
  return out;
}
/** The system blocks of an assistant's rules and skills (none when empty) — after its base prompt and the admin's instructions. */
export const kbBlocks = (cfg) => KB_KINDS.map((k) => kbText(cfg, k)).filter(Boolean).map((text) => ({ type: 'text', text }));
