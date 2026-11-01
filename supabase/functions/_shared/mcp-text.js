// The text of an MCP tool result as data (phase 5.4 decision 11 — the Magnific MCP server answers its tools as text: sometimes
// JSON, sometimes an indented "key: value" listing like
//   from: project-root
//   items[3]:
//     - identifier: Lwpw4IEswO
//       name: شنطة جلد
//       url: "https://pikaso.cdnpk.net/x.jpg?token=a~b"
//   pagination:
//     currentPage: 1
// ). `parseLoose` reads either into plain objects / arrays / strings / numbers / booleans; it never throws, never evaluates
// anything, and a line it cannot place becomes a string value. Shared by the Edge Function (Deno) and its node tests.

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** A scalar of the listing: quoted → unquoted; true / false / null; a number; else the text as it is. */
export function scalar(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (s === '') return '';
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    if (s.startsWith('"')) { try { return JSON.parse(s); } catch { return s.slice(1, -1); } }
    return s.slice(1, -1);
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(s) && s.length < 16) return Number(s);
  return s;
}
const keyOf = (k) => k.replace(/\[\d*\]$/, '').trim();

/** The indented listing → data. Keys lose a trailing "[n]" (a list's count); "- " starts an item of a list. */
export function parseLoose(text) {
  const lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim() !== '');
  let i = 0;
  const indentOf = (l) => l.length - l.replace(/^ */, '').length;
  // a block starting at line i with every line indented at least `min`; returns an object, a list or a scalar
  function block(min) {
    if (i >= lines.length) return '';
    const first = lines[i]; const ind = indentOf(first);
    if (ind < min) return '';
    if (first.trim().startsWith('- ')) return list(ind);
    return object(ind);
  }
  function object(ind) {
    const out = {};
    while (i < lines.length) {
      const l = lines[i]; const li = indentOf(l);
      if (li < ind || l.trim().startsWith('- ')) break;
      if (li > ind) { i++; continue; } // a stray deeper line
      const m = /^([^:]+?):(.*)$/.exec(l.trim());
      if (!m) { i++; continue; }
      const key = keyOf(m[1]); const rest = m[2];
      i++;
      if (rest.trim() === '') {
        const next = i < lines.length ? indentOf(lines[i]) : -1;
        out[key] = next > ind ? block(ind + 1) : (/\[\d+\]$/.test(m[1].trim()) ? [] : '');
      } else out[key] = scalar(rest);
    }
    return out;
  }
  function list(ind) {
    const out = [];
    while (i < lines.length) {
      const l = lines[i]; const li = indentOf(l);
      if (li < ind) break;
      if (li > ind) { i++; continue; }
      const t = l.trim();
      if (!t.startsWith('- ')) break;
      const body = t.slice(2);
      const m = /^([^:]+?):(.*)$/.exec(body);
      if (m) {
        // an object item: the first pair on this line, the rest on the following deeper lines (indented past the dash)
        const inner = ind + 2;
        lines[i] = ' '.repeat(inner) + body; // re-read the first pair as a line of the item's object
        out.push(object(inner));
      } else { out.push(scalar(body)); i++; }
    }
    return out;
  }
  const v = block(0);
  // nothing placed (plain words): the text itself
  return isObj(v) && !Object.keys(v).length && lines.length ? lines.join('\n').trim() : v;
}

/** A tool result's content → data: structuredContent first, else the text as JSON, else the listing. */
export function toolData(result) {
  if (!isObj(result)) return null;
  if (isObj(result.structuredContent)) return result.structuredContent;
  const parts = Array.isArray(result.content) ? result.content : [];
  const text = parts.filter((p) => isObj(p) && p.type === 'text' && typeof p.text === 'string').map((p) => p.text).join('\n').trim();
  if (!text) return null;
  if (text.startsWith('{') || text.startsWith('[')) { try { return JSON.parse(text); } catch { /* the listing below */ } }
  const v = parseLoose(text);
  return isObj(v) || Array.isArray(v) ? v : { text: v };
}

/** The first value found under any of `keys`, at the top or one level down (a `data` wrapper). */
export function pick(data, ...keys) {
  if (!isObj(data)) return undefined;
  for (const k of keys) if (data[k] !== undefined) return data[k];
  const d = isObj(data.data) ? data.data : null;
  if (d) for (const k of keys) if (d[k] !== undefined) return d[k];
  return undefined;
}
