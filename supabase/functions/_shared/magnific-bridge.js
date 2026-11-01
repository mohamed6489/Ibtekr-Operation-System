// The pure part of the Magnific bridge (phase 5.4 decision 11): what the site's MCP tools answer, read as data — the creations of a
// project (creations_search), the ancestry of one (creations_lineage), the identifier of an upload — and the matching of the site's
// results to the studio photos they were made from. Shared by the ai-images Edge Function (Deno) and its node tests. Nothing here
// talks to the network.
import { pick } from './mcp-text.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const REF = /^[A-Za-z0-9_-]{1,80}$/;
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const https = (v) => (typeof v === 'string' && /^https:\/\/[^\s]{1,1900}$/.test(v) ? v : null);

/** creations_search's answer → [{ id, name, family, tool, url, prompt }] (items with an identifier and an https link only). */
export function creationsOf(data) {
  const items = pick(data, 'items', 'creations', 'results');
  if (!Array.isArray(items)) return [];
  return items.filter(isObj).map((x) => ({
    id: REF.test(text(x.identifier, 80)) ? text(x.identifier, 80) : null, name: text(x.name, 200), family: text(x.family, 80), tool: text(x.tool, 60).toLowerCase(),
    url: https(x.url) || https(x.large_preview) || null, prompt: text(isObj(x.metadata) ? x.metadata.prompt : x.prompt, 300),
  })).filter((x) => x.id);
}
/** creations_search's answer → the last page number (1 when unknown). */
export function lastPageOf(data) {
  const p = pick(data, 'pagination');
  const n = isObj(p) ? Number(p.lastPage ?? p.last_page) : NaN;
  return Number.isInteger(n) && n > 0 ? Math.min(n, 20) : 1;
}
/** creations_lineage's answer → the identifiers in the ancestry (nodes), the root included. */
export function lineageIds(data) {
  const nodes = pick(data, 'nodes') ?? (isObj(pick(data, 'data')) ? pick(data, 'data').nodes : undefined);
  const out = new Set();
  const root = pick(data, 'root') ?? (isObj(pick(data, 'data')) ? pick(data, 'data').root : undefined);
  if (REF.test(text(root, 80))) out.add(text(root, 80));
  if (Array.isArray(nodes)) for (const n of nodes) { const id = isObj(n) ? text(n.identifier, 80) : ''; if (REF.test(id)) out.add(id); }
  return [...out];
}
/** creations_upload_image's answer → the new creation's identifier (null when none). */
export function uploadedId(data) {
  const id = pick(data, 'identifier') ?? (isObj(pick(data, 'creation')) ? pick(data, 'creation').identifier : undefined) ?? (isObj(pick(data, 'data')) ? pick(data, 'data').identifier : undefined);
  const s = text(id, 80);
  return REF.test(s) ? s : null;
}
/** creations_get's answer → the family of the creation (empty when none). */
export function familyOf(data) {
  const f = pick(data, 'family') ?? (isObj(pick(data, 'data')) ? pick(data, 'data').family : undefined);
  return text(f, 80);
}

/**
 * The site's results matched to the sources (the batch's sent photos: { ref, index, name, family }): a result whose ancestry
 * (lineage, by its id) holds a source's ref → that source; else the same family; else a name / prompt carrying the source's name
 * stem. Uploads and the sources themselves are never results. → { matched: [{ result, index }], unmatched: [result] }.
 */
export function matchResults(sources, results, lineages = {}) {
  const byRef = new Map(sources.filter((s) => REF.test(String(s.ref || ''))).map((s) => [s.ref, s]));
  const byFamily = new Map(sources.filter((s) => s.family).map((s) => [s.family, s]));
  const stems = sources.map((s) => ({ s, stem: String(s.name || '').replace(/\.[a-z0-9]+$/i, '').trim().toLowerCase() })).filter((x) => x.stem.length >= 3);
  const matched = []; const unmatched = [];
  for (const r of results) {
    if (!r || !r.id || byRef.has(r.id) || r.tool === 'upload' || !r.url) continue;
    const anc = Array.isArray(lineages[r.id]) ? lineages[r.id] : [];
    let src = anc.map((id) => byRef.get(id)).find(Boolean) || null;
    if (!src && r.family) src = byFamily.get(r.family) || null;
    if (!src) { const hay = (r.name + ' ' + r.prompt).toLowerCase(); src = (stems.find((x) => hay.includes(x.stem)) || {}).s || null; }
    if (src) matched.push({ result: r, index: src.index }); else unmatched.push(r);
  }
  return { matched, unmatched };
}
// ---------------------------------------------------------------- decision 12: the category flows of one Space

export const SHOT_LABELS = ['تركيز على المنتج', 'المنتج في بيئة محيطة', 'Closeup للتفاصيل']; // the owner's three shots, in order
export const FLOW_MODEL = 'imagen-nano-banana-2'; // Google Nano Banana Pro — the one model of every flow generator (the owner, 1 Nov)
// decision 14 (the owner, 1 Nov): every result is center-cropped to 7:8 (700×800) afterwards — every generator is told to keep the
// product in the middle with room above and below (the same words as _shared/ai-images.js FRAME_NOTE and the page's slotPrompt)
export const FRAME_NOTE = 'Framing for a later center crop to 7:8: the whole product sits in the middle of the frame with clear empty margins above and below it (at least 12% of the height each), nothing important near the top or bottom edges.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A Spaces answer (spaces_state / spaces_get_nodes) → its node rows [{ id, type, name, x, y, pageId }]. */
export function nodesOf(data) {
  const rows = pick(data, 'nodes');
  if (!Array.isArray(rows)) return [];
  return rows.filter(isObj).map((n) => ({ id: text(n.id, 40), type: text(n.type, 40), name: text(n.name, 200), x: Number(n.x) || 0, y: Number(n.y) || 0, pageId: n.pageId == null ? '' : String(n.pageId) })).filter((n) => UUID.test(n.id));
}
/** A Spaces answer → { nodeId: { key: value } } from its nodeData rows (a JSON-looking value is read as JSON). */
export function nodeDataOf(data) {
  const rows = pick(data, 'nodeData');
  const out = {};
  if (!Array.isArray(rows)) return out;
  for (const r of rows) {
    if (!isObj(r) || !UUID.test(text(r.elementId, 40)) || typeof r.key !== 'string') continue;
    let v = r.value;
    if (typeof v === 'string' && /^\s*[[{]/.test(v)) { try { v = JSON.parse(v); } catch { /* text */ } }
    (out[r.elementId] = out[r.elementId] || {})[r.key] = v;
  }
  return out;
}
/**
 * The owner's template: an image-generator named «<category> <n> — <shot label>» (a trailing « #k» copy mark dropped; the number
 * may touch the category or be missing — then the shots follow the nodes' vertical order) → one entry a category and shot:
 * { category, shot, name, prompt, negative, model, aspect, resolution, node }. Nodes without a prompt are left out.
 */
export function templatePrompts(nodes, nodeData) {
  const gens = nodes.filter((n) => n.type === 'image-generator');
  const parsed = gens.map((n) => {
    const name = n.name.replace(/\s*#\d+$/, '').trim();
    const m = /^(.*?)\s*(\d)?\s*[—–-]+\s*(.+)$/u.exec(name);
    if (!m) return null;
    const category = m[1].replace(/\s*\d$/, '').replace(/\s+/g, ' ').trim();
    if (!category) return null;
    return { node: n, name, category, shot: m[2] ? Number(m[2]) : null, label: m[3].trim() };
  }).filter(Boolean);
  // the unnumbered ones take their shot from the vertical order inside their category
  const byCat = new Map();
  for (const p of parsed) { if (!byCat.has(p.category)) byCat.set(p.category, []); byCat.get(p.category).push(p); }
  const out = new Map();
  for (const list of byCat.values()) {
    const unnumbered = list.filter((p) => !p.shot).sort((a, b) => a.node.y - b.node.y || a.node.x - b.node.x);
    unnumbered.forEach((p, i) => { p.shot = i + 1; });
    for (const p of list) {
      if (!(p.shot >= 1 && p.shot <= 3)) continue;
      const d = nodeData[p.node.id] || {};
      const prompt = text(d.prompt, 6000);
      if (!prompt) continue;
      const key = p.category + '\u0001' + p.shot;
      if (out.has(key)) continue; // the first node of a category and shot wins (copies « #k» come after)
      out.set(key, { category: p.category, shot: p.shot, name: p.name.slice(0, 160), prompt, negative: text(d.negativePrompt, 1000) || null, model: /^[a-z0-9-]{1,60}$/.test(text(d.mode, 60)) ? text(d.mode, 60) : null, aspect: /^(auto|\d{1,2}:\d{1,2})$/.test(text(d.aspectRatio, 10)) ? text(d.aspectRatio, 10) : null, resolution: ['1k', '2k', '4k'].includes(text(d.resolution, 2)) ? text(d.resolution, 2) : null, node: p.node.id });
    }
  }
  return [...out.values()].sort((a, b) => a.category.localeCompare(b.category, 'ar') || a.shot - b.shot);
}
/**
 * The nodes of one batch's flow for spaces_create_node: a panel, the input list (the batch's photos as creation items, in product
 * order), one image generator a shot with the category's prompt (the generic words when the category has none) and one output
 * list a shot; `refs` name them for the connections (list → generator.reference, generator → out.images).
 */
export function flowNodes({ title, category, photos, prompts, model = FLOW_MODEL }) {
  // the owner (1 Nov, decision 13): every generator runs Nano Banana Pro — a template row's own model is not carried over
  const byShot = new Map((prompts || []).map((p) => [Number(p.shot), p]));
  const items = photos.map((id) => ({ type: 'image', creationIdentifier: id }));
  const nodes = [
    { nodeType: 'panel', ref: 'panel', name: title, data: { name: title } },
    { nodeType: 'list', ref: 'list', name: 'قائمة ' + category + ' — ' + title, data: { itemType: 'image', mode: 'replace', items }, layout: { groupId: 'panel' } },
  ];
  const generic = [
    'A professional product photograph of the provided product, the product kept completely identical to the original (design, shape, proportions, colours, materials, textures, every detail), centered, on a clean warm cream studio background, soft natural window light, gentle shadow. No text, no logos, no people. 3:4 aspect ratio, photorealistic.',
    'A lifestyle photograph of the exact same product from the reference, kept completely identical, in its natural place in a warm modern Egyptian home interior, styled scene, afternoon daylight, nothing covering the product. No text, no logos, no people. 3:4 aspect ratio, photorealistic.',
    'A close-up detail photograph of the exact same product from the reference, kept completely identical: the material, the handmade craft and texture, shallow depth of field, softly blurred real environment behind it. No text, no logos. 3:4 aspect ratio, photorealistic.',
  ];
  const connections = [];
  for (let shot = 1; shot <= 3; shot++) {
    const p = byShot.get(shot);
    const data = { prompt: (p ? p.prompt : generic[shot - 1]) + ' ' + FRAME_NOTE, mode: model, aspectRatio: (p && p.aspect) || '3:4', resolution: (p && p.resolution) || '1k', numberOfGenerations: 1 };
    if (p && p.negative) data.negativePrompt = p.negative;
    const name = (p && p.name) || (category + ' ' + shot + ' — ' + SHOT_LABELS[shot - 1]);
    nodes.push({ nodeType: 'image-generator', ref: 'gen' + shot, name, data, layout: { groupId: 'panel', relativeToNodeId: shot === 1 ? 'list' : 'gen' + (shot - 1), direction: shot === 1 ? 'right' : 'below' } });
    nodes.push({ nodeType: 'list', ref: 'out' + shot, name: 'مخرجات ' + shot + ' — ' + (p ? p.name : SHOT_LABELS[shot - 1]), data: { itemType: 'image', mode: 'accumulate' }, layout: { groupId: 'panel', relativeToNodeId: 'gen' + shot, direction: 'right' } });
    connections.push({ from: 'list', fromPort: 'output-images', to: 'gen' + shot, toPort: 'reference' }, { from: 'gen' + shot, fromPort: 'output', to: 'out' + shot, toPort: 'images' });
  }
  return { nodes, connections };
}
/** An output list's items (spaces_get_nodes nodeData) → the creation identifiers in order. */
export function listIdsOf(nodeData, nodeId) {
  const items = nodeData && nodeData[nodeId] ? nodeData[nodeId].items : null;
  if (!Array.isArray(items)) return [];
  return items.filter(isObj).map((x) => text(x.creationIdentifier, 80)).filter((id) => REF.test(id));
}
/** creations_get's answer (several) → { identifier: url }. */
export function urlsById(data) {
  const list = pick(data, 'creations', 'items', 'results') ?? (Array.isArray(data) ? data : null);
  const out = {};
  if (Array.isArray(list)) for (const c of list) { if (isObj(c) && REF.test(text(c.identifier, 80))) { const u = https(c.url) || https(c.large_preview); if (u) out[c.identifier] = u; } }
  else if (isObj(data) && REF.test(text(data.identifier, 80))) { const u = https(data.url); if (u) out[data.identifier] = u; }
  return out;
}

/** The matched results as an image_imports row's urls / refs / items (one item per product index, the images by their place). */
export function importShape(matched) {
  const urls = []; const refs = []; const byIndex = new Map();
  for (const m of matched) {
    if (urls.length >= 50) break;
    urls.push(m.result.url); refs.push(m.result.id);
    if (!byIndex.has(m.index)) byIndex.set(m.index, []);
    byIndex.get(m.index).push(urls.length - 1);
  }
  return { urls, refs, items: [...byIndex.entries()].map(([index, images]) => ({ index, images })) };
}
