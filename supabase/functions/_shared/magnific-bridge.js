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
