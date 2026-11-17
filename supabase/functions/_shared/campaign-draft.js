// «الديزاينر مؤتمن على المحتوى» (docs/superpowers/plans/2026-11-17-agents-team.md decisions 3 and 4 — the owner 17 Nov: «لو سألته عايز اعمل
// محتوي و كتبتله عن ايه ينقلني لوحده علي التسويق و يملا البيانات بناء علي اللي طلبته بعد ما يسألني»): the campaign the designer (or the
// header's assistant) fills once it asked what was missing — the page opens «كامبين جديدة» with it, nothing saved and nothing generated.
// And «اسأل المساعد المختص»: the header's assistant hands a question to one of the three. The pure part, shared by ai-content's two
// paths and the tests; the limits are the page's (marketing-domain.js GOALS / MAX / VIDEO_MAX).
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const one = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export const DRAFT_GOALS = ['منتج جديد', 'مجموعة جديدة', 'وعي بخدمة', 'عرض / خصم'];
export const DRAFT_MAX = 10; // pieces of a kind, slides of a carousel (W.MAX)
export const DRAFT_IDEA = 500;
export const DRAFT_DUR = [5, 30]; // seconds of a video (W.VIDEO_MAX)
export const AGENT_IDS = ['dev', 'designer', 'buyer'];
export const AGENT_NAME = { dev: 'المبرمج', designer: 'الديزاينر', buyer: 'الميديا باير' };
export const ASK_MAX = 1000;

const count = (v, max) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0; };

/**
 * What the model filled → { goal, idea, post, carousel, slides, video, dur } within the page's limits, or null when it says nothing to
 * make (no idea or no piece). The goal falls back to «منتج جديد»; slides only with a carousel, the video's length only with a video.
 */
export function campaignDraft(v) {
  if (!isObj(v)) return null;
  const idea = one(v.idea, DRAFT_IDEA);
  const post = count(v.post, DRAFT_MAX); const carousel = count(v.carousel, DRAFT_MAX); const video = count(v.video, DRAFT_MAX);
  if (!idea || !(post + carousel + video)) return null;
  const out = { goal: DRAFT_GOALS.includes(v.goal) ? v.goal : DRAFT_GOALS[0], idea, post, carousel, video };
  if (carousel) out.slides = Math.max(2, count(v.slides, DRAFT_MAX) || 4);
  if (video) { const d = Math.round(Number(v.dur)); out.dur = Number.isFinite(d) ? Math.min(DRAFT_DUR[1], Math.max(DRAFT_DUR[0], d)) : 15; }
  return out;
}

/** The JSON schema of a draft (the designer's structured answer). */
export const DRAFT_SCHEMA = () => ({ type: 'object', additionalProperties: false, required: ['goal', 'idea', 'post', 'carousel', 'slides', 'video', 'dur'],
  properties: { goal: { type: 'string' }, idea: { type: 'string' }, post: { type: 'integer' }, carousel: { type: 'integer' }, slides: { type: 'integer' }, video: { type: 'integer' }, dur: { type: 'integer' } } });

/** ask_agent's input → { agent, question } | null. */
export function agentAsk(v, ids = AGENT_IDS) { // 0120 + the owner 17 Nov: any assistant of the member's team (ids = the ones they see)
  if (!isObj(v) || typeof v.agent !== 'string' || !/^[a-z][a-z0-9_]{1,30}$/.test(v.agent) || !(Array.isArray(ids) ? ids : AGENT_IDS).includes(v.agent)) return null;
  const question = String(v.question ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim().slice(0, ASK_MAX);
  return question ? { agent: v.agent, question } : null;
}

/** The rules the designer follows before it fills a draft (English — the model's instructions). */
export const DRAFT_RULE = `
- You are trusted with content tasks. When the member wants content made (a post, a carousel, a reel / video, a campaign for a product, an offer, a collection), first ask in ONE short message only what is missing: what it is about (the product, the collection or the offer), the goal, and which pieces and how many — skip anything they already said. When you know enough, fill campaign: goal (one of ${DRAFT_GOALS.join(' / ')}), idea (Egyptian Arabic, the brief of the campaign in up to ${DRAFT_IDEA} characters: the product, the angle, the message, the offer), post / carousel / video (how many of each, 0–${DRAFT_MAX}), slides (per carousel, 2–${DRAFT_MAX}) and dur (seconds per video, ${DRAFT_DUR[0]}–${DRAFT_DUR[1]}); and say in your text that the campaign opens filled in «التسويق» for them to review and press generate. The page opens it by itself — nothing is generated or spent until they press. Otherwise campaign.idea is "" and the counts are 0.`;
