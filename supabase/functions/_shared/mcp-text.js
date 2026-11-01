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

/**
 * The tables of a Spaces answer (spaces_state / spaces_get_nodes): a header `name[count]{col1,col2,…}:` followed by indented
 * CSV rows, a quoted field being a JSON string (escapes inside) → { name: [{ col: value }] }. Unquoted `null`, numbers and
 * booleans are typed; a row with too few fields keeps what it has. Never throws.
 */
export function parseTables(text) {
  const out = {};
  const lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
  let cols = null; let name = null;
  for (const l of lines) {
    const head = /^\s*([A-Za-z][\w-]*)\[\d*\]\{([^}]*)\}:\s*$/.exec(l);
    if (head) { name = head[1]; cols = head[2].split(',').map((c) => c.trim()).filter(Boolean); out[name] = out[name] || []; continue; }
    if (!cols) continue;
    if (!/^\s+\S/.test(l)) { cols = null; name = null; continue; } // the table ended
    const fields = csvRow(l.trim());
    if (!fields.length) continue;
    const row = {};
    cols.forEach((c, i) => { row[c] = i < fields.length ? fields[i] : undefined; });
    out[name].push(row);
  }
  return out;
}
/** One CSV row of the tables above → typed fields (a quoted field is read as a JSON string). */
export function csvRow(line) {
  const out = []; let i = 0; const s = String(line);
  while (i <= s.length) {
    if (s[i] === '"') {
      let j = i + 1; let buf = '"';
      while (j < s.length) { const ch = s[j]; buf += ch; if (ch === '\\' && j + 1 < s.length) { buf += s[j + 1]; j += 2; continue; } if (ch === '"') break; j++; }
      let v; try { v = JSON.parse(buf); } catch { v = buf.slice(1, -1); }
      out.push(v);
      i = j + 1;
      if (s[i] === ',') i++; else if (i >= s.length) break; else { const k = s.indexOf(',', i); if (k < 0) break; i = k + 1; }
      if (i === s.length && s[s.length - 1] === ',') { out.push(''); break; }
      continue;
    }
    const k = s.indexOf(',', i);
    const raw = (k < 0 ? s.slice(i) : s.slice(i, k)).trim();
    out.push(raw === 'null' ? null : raw === 'true' ? true : raw === 'false' ? false : /^-?\d+(\.\d+)?$/.test(raw) && raw.length < 16 ? Number(raw) : raw);
    if (k < 0) break;
    i = k + 1;
    if (i === s.length) { out.push(''); break; }
  }
  return out;
}

/** A tool result's content → data: structuredContent first, else the text as JSON, else the listing. */
export function toolData(result) {
  if (!isObj(result)) return null;
  if (isObj(result.structuredContent)) return result.structuredContent;
  const parts = Array.isArray(result.content) ? result.content : [];
  const text = parts.filter((p) => isObj(p) && p.type === 'text' && typeof p.text === 'string').map((p) => p.text).join('\n').trim();
  if (!text) return null;
  if (text.startsWith('{') || text.startsWith('[')) { try { return JSON.parse(text); } catch { /* the listing below */ } }
  // a Spaces answer carries tables (nodes[n]{…}: rows) beside plain pairs: both are kept
  if (/^\s*[A-Za-z][\w-]*\[\d*\]\{[^}]*\}:\s*$/m.test(text)) {
    const tables = parseTables(text);
    const rest = []; let inTable = false;
    for (const l of text.split('\n')) { if (/^\s*[A-Za-z][\w-]*\[\d*\]\{[^}]*\}:\s*$/.test(l)) { inTable = true; continue; } if (inTable && /^\s+\S/.test(l)) continue; inTable = false; rest.push(l); }
    const plain = parseLoose(rest.join('\n'));
    return Object.assign(isObj(plain) ? plain : {}, tables);
  }
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
