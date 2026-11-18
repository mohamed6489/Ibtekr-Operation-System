// The warehouse assistant's products plan (the owner 17 Nov — «مساعد المخزن يقدر يضيف قسم و ينقل منتجات من مكان لمكان و يلغي منتجات من قسم و
// يتحكم في المبتكرين … يزودلهم براند … كل الاكشنز اللي ممكن تتعمل في المنتجات فردي او جماعي … هات الكراسي من مبتكر معين و حطهم في قسم
// معين و هات حاجة تانية من مبتكر تاني وحطهم في نفس القسم» و«دايما سالني علي موافقة قبل اي خطوة»): the answer names the steps in words; the
// server finds the makers, products and categories (by sound — names.js — in both languages, with the member's own client) and the page
// shows each step with its count and examples — nothing runs until the member presses that step's button, through the page's adapters
// (the same writes as the products page, the same permissions). Pure.
import { bestName, nameMatches, nameScore } from './names.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const STR = () => ({ type: 'string' });
const obj = (props) => ({ type: 'object', additionalProperties: false, required: Object.keys(props), properties: props });
const line = (v, n) => String(v ?? '').replace(/[<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
export const PLAN_OPS = ['category_create', 'category_add', 'category_set', 'category_remove', 'move_maker', 'brand_add', 'status', 'trash', 'studio'];
export const PLAN_STATUS = ['publish', 'draft', 'pending', 'private'];
export const PLAN_MAX = 10;
export const PLAN_IDS = 500;

// the owner 18 Nov («لو بقولو للمخزن ضيف منتجات يسالني … صور و شيت ولا صور و اسكرين شوتس ولا صور لشيت و اختار يبتدي يعمل هو الخطوات»):
// the studio step names the case (the studio's three), the products' type and which attached files are the WhatsApp screenshots
export const STUDIO_CASES = ['sheet', 'whatsapp', 'photos'];
export const STUDIO_CASE_LABELS = { sheet: 'شيت جاهز من المبتكر', whatsapp: 'داتا على الواتساب (صور + سكرين شوتس)', photos: 'صور وعايز شيت' };
export const PLAN_SCHEMA = () => ({ type: 'array', items: obj({ op: STR(), maker: STR(), query: { type: 'array', items: STR() }, category: STR(), to_maker: STR(), brand: STR(), status: STR(), new_en: STR(), new_ar: STR(), parent: STR(), note: STR(), kase: STR(), type: STR(), screens: { type: 'array', items: STR() } }) });
export const PLAN_RULE = `
Products plan (you change nothing yourself — each step waits for the member's button): when the member asks for work on products,
categories or makers, fill plan (up to ${PLAN_MAX} steps, in order); otherwise plan is []. Each step: op and only its fields (the rest ""):
- category_create: new_en, new_ar, parent (an existing category's name, or "" for a main one) — a later step may use the new name;
- category_add / category_set / category_remove: maker (a maker's name or ""), query (words that find the products — give each word in
  English and Arabic, e.g. ["chair", "كرسي"]; [] = all the maker's products), category (the category's name — existing or created above);
  add = keep their categories and add this one, set = this one only, remove = take this one off;
- move_maker: maker, query, to_maker; brand_add: maker, brand (a new brand for that maker);
- status: maker, query, status one of ${PLAN_STATUS.join(' | ')}; trash: maker, query (to the site's trash, never deleted);
- studio: new products (the member wants to add / upload products, or sent product photos, a maker's sheet or WhatsApp screenshots to
  add): one step at once — do NOT ask the case, the type or the maker yourself: the chat asks them with its own buttons (the case
  «${STUDIO_CASE_LABELS.photos}» · «${STUDIO_CASE_LABELS.whatsapp}» · «${STUDIO_CASE_LABELS.sheet}», Simple or Variable, the maker, then the files),
  runs the studio's steps, shows the data in a popup to edit and asks before anything goes to the site. Fill only what the member
  already said: maker (or ""), category (or ""), kase = sheet | whatsapp | photos (or ""), type = Simple | Variable (or ""), screens = the
  attached files that are WhatsApp screenshots (else []). Your text: one short line that you'll ask a few questions here in the chat.
Before a plan, ask what is unclear (which maker, which category, the words for the products) in your text instead. In text, say the plan
in short lines; never say it is done.`;

/** The answer's plan → clean steps (unknown ops dropped). */
export function cleanPlan(v) {
  return (Array.isArray(v) ? v : []).filter(isObj).filter((s) => PLAN_OPS.includes(s.op)).slice(0, PLAN_MAX).map((s) => ({
    op: s.op, maker: line(s.maker, 80), query: (Array.isArray(s.query) ? s.query : []).map((q) => line(q, 60)).filter(Boolean).slice(0, 8), category: line(s.category, 120),
    toMaker: line(s.to_maker, 80), brand: line(s.brand, 80), status: PLAN_STATUS.includes(s.status) ? s.status : '', newEn: line(s.new_en, 80), newAr: line(s.new_ar, 80), parent: line(s.parent, 120), note: line(s.note, 200),
    kase: STUDIO_CASES.includes(s.kase) ? s.kase : '', type: s.type === 'Variable' || s.type === 'Simple' ? s.type : '', // "" = the chat asks (decision 20)
    screens: (Array.isArray(s.screens) ? s.screens : []).map((x) => line(x, 120)).filter(Boolean).slice(0, 8),
  }));
}

/**
 * The steps against the system's data (the member's own reads): { vendors: [{ id, name }], products: [{ id, name, nameAr, sku, vendorId,
 * categoryIds, status }], categories: [{ id, name, nameAr, parentId }] } → [{ op, label, ids, count, sample, maker, toMaker, category,
 * brand, status, mode, newEn, newAr, parent, problem }] — `problem` (in Arabic) when a name was not found or nothing matched.
 */
export function resolvePlan(steps, data) {
  const vendors = Array.isArray(data.vendors) ? data.vendors : []; const products = Array.isArray(data.products) ? data.products : [];
  const cats = Array.isArray(data.categories) ? data.categories : []; const made = [];
  const catName = (c) => c.name + (c.nameAr ? ' / ' + c.nameAr : '');
  const findCat = (name) => {
    if (!name) return null;
    const n = made.find((m) => nameScore(name, m.newEn) >= 0.85 || nameScore(name, m.newAr) >= 0.85); if (n) return { id: null, name: n.newEn, new: true };
    const c = bestName(name, cats, (x) => x.name) || bestName(name, cats.filter((x) => x.nameAr), (x) => x.nameAr);
    return c ? { id: Number(c.id), name: catName(c) } : null;
  };
  const findMaker = (name) => (name ? bestName(name, vendors, (x) => x.name) : null);
  const pick = (s) => {
    const v = s.maker ? findMaker(s.maker) : null;
    if (s.maker && !v) { const near = nameMatches(s.maker, vendors, (x) => x.name, 3).map((m) => m.item.name); return { problem: 'مش لاقي المبتكر «' + s.maker + '»' + (near.length ? ' — تقصد ' + near.join(' أو ') + '؟' : '') }; }
    let list = v ? products.filter((p) => String(p.vendorId) === String(v.id)) : products;
    if (s.query.length) list = list.filter((p) => s.query.some((q) => { const catNames = (p.categoryIds || []).map((id) => cats.find((c) => Number(c.id) === Number(id))).filter(Boolean);
      return [p.name, p.nameAr, p.sku].some((x) => x && (String(x).toLowerCase().includes(q.toLowerCase()) || nameScore(q, x) >= 0.85)) || catNames.some((c) => nameScore(q, c.name) >= 0.85 || (c.nameAr && nameScore(q, c.nameAr) >= 0.85)); }));
    else if (!v) return { problem: 'محتاج المبتكر أو كلمات للمنتجات' };
    if (!list.length) return { maker: v, problem: 'مفيش منتجات ' + (v ? 'لـ ' + v.name + ' ' : '') + (s.query.length ? 'بالكلام ده (' + s.query.join('، ') + ')' : '') };
    return { maker: v, ids: list.slice(0, PLAN_IDS).map((p) => Number(p.id)), count: list.length, sample: list.slice(0, 5).map((p) => p.nameAr || p.name) };
  };
  return steps.map((s) => {
    const out = { op: s.op, label: '', ids: [], count: 0, sample: [], maker: null, toMaker: null, category: null, brand: s.brand, status: s.status, newEn: s.newEn, newAr: s.newAr, parent: null, problem: '' };
    if (s.op === 'category_create') {
      if (!s.newEn) out.problem = 'محتاج اسم القسم بالإنجليزي';
      const p = s.parent ? findCat(s.parent) : null; if (s.parent && !p) out.problem = 'مش لاقي القسم الأب «' + s.parent + '»';
      out.parent = p; made.push(s); out.label = 'قسم جديد «' + s.newEn + (s.newAr ? ' / ' + s.newAr : '') + '»' + (p ? ' تحت «' + p.name + '»' : ' رئيسي'); return out;
    }
    if (s.op === 'brand_add') { const v = findMaker(s.maker); out.maker = v ? { id: v.id, name: v.name } : null; if (!v) out.problem = 'مش لاقي المبتكر «' + s.maker + '»'; if (!s.brand) out.problem = 'محتاج اسم البراند'; out.label = 'براند جديد «' + s.brand + '» لـ ' + (v ? v.name : s.maker); return out; }
    if (s.op === 'studio') { const v = findMaker(s.maker); out.maker = v ? { id: v.id, name: v.name } : null; out.category = findCat(s.category); out.kase = s.kase; out.type = s.type; out.screens = s.screens;
      out.label = 'منتجات جديدة' + (s.kase ? ' — ' + STUDIO_CASE_LABELS[s.kase] : '') + (s.type ? ' · ' + s.type : '') + (v ? ' لـ ' + v.name : '') + (out.category ? ' في «' + out.category.name + '»' : ''); return out; }
    const r = pick(s); Object.assign(out, { ids: r.ids || [], count: r.count || 0, sample: r.sample || [], maker: r.maker ? { id: r.maker.id, name: r.maker.name } : null, problem: r.problem || '' });
    const what = (out.count ? out.count + ' منتج' : 'المنتجات') + (out.maker ? ' من ' + out.maker.name : '');
    if (s.op.startsWith('category_')) {
      out.category = findCat(s.category); if (!out.category && !out.problem) out.problem = 'مش لاقي القسم «' + s.category + '»';
      out.mode = s.op.slice(9); out.label = (out.mode === 'remove' ? 'شيل ' + what + ' من' : out.mode === 'set' ? 'خلّي ' + what + ' في' : 'ضيف ' + what + ' لـ') + ' «' + (out.category ? out.category.name : s.category) + '»';
    } else if (s.op === 'move_maker') {
      const t = findMaker(s.toMaker); out.toMaker = t ? { id: t.id, name: t.name } : null; if (!t && !out.problem) out.problem = 'مش لاقي المبتكر «' + s.toMaker + '»';
      out.label = 'انقل ' + what + ' لـ ' + (t ? t.name : s.toMaker);
    } else if (s.op === 'status') { if (!s.status && !out.problem) out.problem = 'محتاج الحالة'; out.label = 'غيّر حالة ' + what + ' لـ «' + ({ publish: 'منشور', draft: 'مسودة', pending: 'في انتظار المراجعة', private: 'خاص' }[s.status] || s.status) + '»'; }
    else if (s.op === 'trash') out.label = 'ودّي ' + what + ' للمهملات (بيرجع من «المهملات»)';
    return out;
  });
}
/** The products mirror (the member's rows) → the plan's products: the English record with its Arabic name (lang / translation_ids). */
export function planProducts(rows) {
  const all = (Array.isArray(rows) ? rows : []).filter(isObj).filter((r) => r.status !== 'trash'); const byId = new Map(all.map((r) => [Number(r.id), r]));
  return all.filter((r) => r.lang !== 'ar' || !(isObj(r.translation_ids) && Number(r.translation_ids.en) && byId.has(Number(r.translation_ids.en)))).map((r) => {
    const t = isObj(r.translation_ids) ? r.translation_ids : {}; const ar = r.lang === 'ar' ? r : byId.get(Number(t.ar));
    return { id: Number(r.id), name: r.name || '', nameAr: ar && ar !== r ? ar.name || '' : r.lang === 'ar' ? r.name : '', sku: r.sku || '', vendorId: r.vendor_id, categoryIds: Array.isArray(r.category_ids) ? r.category_ids.map(Number) : [], status: r.status };
  });
}
