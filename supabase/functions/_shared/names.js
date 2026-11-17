// Names that match however they are written (the owner 17 Nov — «لو كتبتلوا اسم فيندور مثلا بالعربي و هو مكتوب بالانجليزي يقدر يعرفوا
// ميبقاش محدود التفكير … ليهم كلهم و كمان المدير»): a maker, a customer or a product written in Arabic letters for a Latin name (or the
// reverse), with or without hamzas, vowels or a space — compared by a consonant skeleton of the sound. Pure; used by the assistants' reads.

const AR_LATIN = {
  'ا': 'a', 'أ': 'a', 'إ': 'i', 'آ': 'a', 'ء': '', 'ؤ': 'o', 'ئ': 'i', 'ب': 'b', 'ت': 't', 'ث': 's', 'ج': 'g', 'ح': 'h', 'خ': 'kh', 'د': 'd', 'ذ': 'z',
  'ر': 'r', 'ز': 'z', 'س': 's', 'ش': 'sh', 'ص': 's', 'ض': 'd', 'ط': 't', 'ظ': 'z', 'ع': 'a', 'غ': 'gh', 'ف': 'f', 'ق': 'k', 'ك': 'k', 'ل': 'l', 'م': 'm',
  'ن': 'n', 'ه': 'h', 'ة': 'a', 'و': 'o', 'ي': 'i', 'ى': 'a', 'پ': 'b', 'ڤ': 'v', 'چ': 'ch', 'گ': 'g',
};
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
/** Lower case, Arabic digits as Latin, the Arabic marks and tatweel gone, the hamza forms and ى / ة folded, one space. */
export function fold(s) {
  return String(s ?? '').toLowerCase().replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)))
    .replace(/[ً-ٰٟـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
/** Arabic letters spelled in Latin (the rest as it is). */
export const arLatin = (s) => [...String(s ?? '')].map((c) => (c in AR_LATIN ? AR_LATIN[c] : c)).join('');
/**
 * The sound's skeleton: Latin, the letters that sound alike as one (c/k/q/ck → k, ph/f/v → f, p → b, j/g → g, th/s/c(e) → s, x → ks,
 * dh/z → z), the vowels and h out (Arabic drops the short ones), doubles as one, no spaces — «Art Craft» and «ارت كرافت» are both «rtkrft».
 */
export function skeleton(s) {
  let t = arLatin(fold(s)).toLowerCase();
  t = t.replace(/ph/g, 'f').replace(/th/g, 's').replace(/dh/g, 'z').replace(/kh/g, 'k').replace(/gh/g, 'g').replace(/sh/g, 's').replace(/ch/g, 's').replace(/ck/g, 'k')
    .replace(/c(?=[eiy])/g, 's').replace(/[cq]/g, 'k').replace(/x/g, 'ks').replace(/[vw]/g, (m) => (m === 'v' ? 'f' : 'o')).replace(/p/g, 'b').replace(/j/g, 'g');
  return t.replace(/[aeiouyh\s]/g, '').replace(/(.)\1+/g, '$1');
}
const bigrams = (s) => { const out = []; for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2)); return out; };
/** Dice on the two strings' pairs of letters (0–1). */
export function dice(a, b) {
  if (!a || !b) return 0; if (a === b) return 1; if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a); const B = bigrams(b); const m = new Map(); for (const x of A) m.set(x, (m.get(x) || 0) + 1);
  let hit = 0; for (const x of B) { const n = m.get(x) || 0; if (n) { hit++; m.set(x, n - 1); } }
  return (2 * hit) / (A.length + B.length);
}
/** How well q names `name` (0–1): the words as written, then the sound — inside it, or alike. */
export function nameScore(q, name) {
  const fq = fold(q); const fn = fold(name); if (!fq || !fn) return 0;
  if (fq === fn) return 1;
  if (fn.includes(fq) || fq.includes(fn)) return 0.95;
  const sq = skeleton(q); const sn = skeleton(name);
  if (sq.length >= 2 && sn.length >= 2) {
    if (sq === sn) return 0.92;
    if (sn.includes(sq) && sq.length >= 3) return 0.88;
    if (fn.split(' ').some((w) => skeleton(w) === sq)) return 0.86; // one word of the name («نور» → «Noor Handmade»)
    return Math.round(Math.max(dice(sq, sn), dice(fq.replace(/ /g, ''), fn.replace(/ /g, ''))) * 100) / 100;
  }
  return 0;
}
/** q is in one of the values, written either way (the assistants' text filters). */
export const nameHas = (q, ...vals) => !q || vals.some((v) => nameScore(q, v) >= 0.85);
/** The closest of `items` (by `nameOf`) to q: [{ item, score }] best first, at least `min`, `n` at most. */
export function nameMatches(q, items, nameOf = (x) => x, n = 8, min = 0.5) {
  return (Array.isArray(items) ? items : []).map((item) => ({ item, score: nameScore(q, nameOf(item)) })).filter((x) => x.score >= min).sort((a, b) => b.score - a.score).slice(0, n);
}
/** The one q clearly means: the best at ≥ 0.8 and ahead of the next by 0.08 — else null (ask which). */
export function bestName(q, items, nameOf = (x) => x) {
  const m = nameMatches(q, items, nameOf, 2, 0.8);
  return m.length && (m.length === 1 || m[0].score - m[1].score >= 0.08 || m[0].score === 1) ? m[0].item : null;
}
/** The rule every assistant reads (the header's and each team's): names are matched by sound, never «مش لاقيه» at the first try. */
export const NAME_RULE = `
Names (makers, customers, products, brands, members): the member may write a name in Arabic letters that is stored in Latin letters (or the
reverse), misspelt, without hamzas or spaces, or only one word of it — «ارت كرافت» is «Art Craft», «جلاستورا» is «Glastora». Match by sound and
meaning, never by the exact letters only. When the data says didYouMean / otherMatches, take the one that is clearly meant (say which name you
used); when two are close, ask which one with both names. Never answer «مش موجود» before trying the name the other way round.`;
