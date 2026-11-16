// ============================================================
// IBShare — one way to share a report anywhere in the system (not a block).
// The owner 15 Nov (2026-11-15-comments.md decisions 10 and 30): «زر المشاركة يفتحلي بوب أب يبقى فيه نوع الملف — إكسيل ولا PDF —
// وطريقة الإرسال — واتس ولا إيميل ولا تحميل على الجهاز»، «ونفس الشكل اللي هعمله إكسبورت أو إرسال».
//
// IBShare.open(spec) opens that popup. spec:
//   { title, sub, name (the file's name), phone, email (who it goes to — optional), text (the message — else built),
//     summary: [{ label, value }], headers: [..], rows: [[cell..]], total: [..], note,
//     link (a page to share instead of a file — optional; with no table the popup offers the link only),
//     excel (optional: () => Blob — the caller's own workbook as the Excel file, the PDF still drawn from the table),
//     onDone({ type, via }) (called once the share went — the caller's activity log) }
//   a cell is a string / number, or { text, img, n } — img: the photo shown beside the text (a product's https photo, or a
//   data: picture the page already holds); n: the cell's
//   number for the sheet (the text is what the screen and the PDF show: «1,002.00»)
// The file is built in the browser: the Excel by the sheet writer of the studio (IbtekrFlow.xlsx — a photo inside its cell), the
// PDF from the same report drawn as A4 pages (html2canvas → one JPEG a page → a small PDF written here), so Arabic reads as it
// does on the screen. The products' photos come through IBOrders.thumbs (the site sends no CORS header, the browser alone cannot
// read them into a file); a photo that cannot be read leaves its box empty.
// Sending: «تحميل» saves the file; «واتساب» / «إيميل» hand the file to the device's own share sheet where it exists (a phone),
// else the file is saved and the chat / the mail opens with the message — the member attaches it. Nothing is sent by a server.
// ============================================================
(() => {
  'use strict';
  const U = () => window.IBUI; const K = () => window.IBKit;
  const h = (...a) => U().h(...a);
  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  // ---------------------------------------------------------------- pure
  const cellText = (c) => (c == null ? '' : typeof c === 'object' ? String(c.text == null ? '' : c.text) : String(c));
  // a cell's photo: a https one (the site's — read through IBOrders.thumbs) or a picture the page already holds as a data: URL
  // (JPEG / PNG / WebP only — never an SVG)
  const cellImg = (c) => (c && typeof c === 'object' && typeof c.img === 'string' && /^(https:\/\/|data:image\/(jpeg|png|webp);base64,)/.test(c.img) ? c.img : '');
  const hasImgCell = (rows, i) => (rows || []).some((r) => r && r[i] && typeof r[i] === 'object' && 'img' in r[i]);
  // a file name the device accepts: no path or reserved characters, one space between words, 80 characters
  const fileBase = (name) => (String(name == null ? '' : name).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'تقرير');
  const digits = (v) => String(v == null ? '' : v).replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660));
  // an Egyptian mobile → the number WhatsApp takes (20…); nothing usable → ''
  const waNumber = (p) => { const d = digits(p).replace(/\D/g, ''); return d ? '20' + d.replace(/^0020/, '').replace(/^20/, '').replace(/^0/, '') : ''; };
  // the message that goes with the file: the title, the line under it, the numbers — the table is in the file
  function messageText(spec) {
    const s = spec || {}; const lines = [String(s.title || '').trim()];
    if (s.sub) lines.push(String(s.sub).trim());
    (s.summary || []).forEach((x) => { if (x && x.label) lines.push(x.label + ': ' + cellText(x.value)); });
    if (s.link) lines.push(String(s.link));
    return lines.filter(Boolean).join('\n');
  }
  const shareHref = (via, o) => (via === 'whatsapp' ? 'https://wa.me/' + waNumber(o.phone) + '?text=' + encodeURIComponent(o.text || '')
    : 'mailto:' + encodeURIComponent(String(o.email || '').trim()).replace(/%40/g, '@') + '?subject=' + encodeURIComponent(o.title || '') + '&body=' + encodeURIComponent(o.text || ''));
  // a cell that starts like a formula gets a leading apostrophe, so a spreadsheet never runs it
  const safeCell = (v) => (typeof v === 'number' ? v : /^[=+\-@\t\r]/.test(String(v)) ? "'" + String(v) : String(v));
  // the sheet: the photo column first when the table has photos, then the table, the total, and the numbers under it
  function sheetOf(spec) {
    const s = spec || {}; const headers = (s.headers || []).map(String); const rows = s.rows || [];
    const imgCol = headers.findIndex((_, i) => hasImgCell(rows, i)); const withImg = imgCol >= 0;
    const head = (withImg ? ['الصورة'] : []).concat(headers);
    const val = (c) => (typeof c === 'number' ? c : c && typeof c === 'object' && typeof c.n === 'number' && Number.isFinite(c.n) ? c.n : safeCell(cellText(c)));
    const line = (r) => (withImg ? [''] : []).concat(headers.map((_, i) => val(r[i])));
    const body = rows.map(line); const images = withImg ? rows.map((r) => cellImg(r[imgCol])) : [];
    const tail = [];
    if (s.total && rows.length) tail.push((withImg ? [''] : []).concat(headers.map((_, i) => val(s.total[i]))));
    const sum = (s.summary || []).filter((x) => x && x.label);
    if (sum.length) { tail.push([]); sum.forEach((x) => tail.push((withImg ? [''] : []).concat([safeCell(x.label), val(x.value)]))); }
    const widths = head.map((t, i) => (withImg && i === 0 ? 10 : Math.max(12, Math.min(46, Math.max(String(t).length, ...body.slice(0, 200).map((r) => String(r[i] == null ? '' : r[i]).length)) + 4))));
    return { head, rows: body.concat(tail), widths, images, dataRows: body.length, withImg };
  }
  // a PDF of pictures, a page each: pages = [{ jpeg: Uint8Array, w, h }] (pixels) → the file's bytes. A4, the picture across the
  // page's width from its top.
  function pdfBytes(pages) {
    const W = 595.28, H = 841.89; const enc = new TextEncoder(); const chunks = []; let off = 0; const offs = [];
    const put = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; chunks.push(b); off += b.length; };
    const obj = (n, body) => { offs[n] = off; put(n + ' 0 obj\n'); body(); put('\nendobj\n'); };
    const list = (pages || []).filter((p) => p && p.jpeg && p.jpeg.length && p.w > 0 && p.h > 0);
    put('%PDF-1.4\n'); put(Uint8Array.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // the comment that marks the file as binary
    obj(1, () => put('<< /Type /Catalog /Pages 2 0 R >>'));
    obj(2, () => put('<< /Type /Pages /Count ' + list.length + ' /Kids [' + list.map((_, i) => (3 + 3 * i) + ' 0 R').join(' ') + '] >>'));
    list.forEach((p, i) => {
      const a = 3 + 3 * i; const dh = Math.min(H, p.h * W / p.w); const dw = dh * p.w / p.h;
      const content = 'q ' + dw.toFixed(2) + ' 0 0 ' + dh.toFixed(2) + ' ' + ((W - dw) / 2).toFixed(2) + ' ' + (H - dh).toFixed(2) + ' cm /Im0 Do Q';
      obj(a, () => put('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Resources << /XObject << /Im0 ' + (a + 1) + ' 0 R >> >> /Contents ' + (a + 2) + ' 0 R >>'));
      obj(a + 1, () => { put('<< /Type /XObject /Subtype /Image /Width ' + Math.round(p.w) + ' /Height ' + Math.round(p.h) + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + p.jpeg.length + ' >>\nstream\n'); put(p.jpeg); put('\nendstream'); });
      obj(a + 2, () => put('<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream'));
    });
    const count = 3 + 3 * list.length; const xref = off;
    put('xref\n0 ' + count + '\n0000000000 65535 f \n');
    for (let k = 1; k < count; k++) put(String(offs[k]).padStart(10, '0') + ' 00000 n \n');
    put('trailer\n<< /Size ' + count + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    const out = new Uint8Array(off); let at = 0; chunks.forEach((c) => { out.set(c, at); at += c.length; });
    return out;
  }
  const pure = { cellText, cellImg, fileBase, waNumber, messageText, shareHref, sheetOf, pdfBytes, safeCell };

  // ---------------------------------------------------------------- the photos
  const dataUrlBytes = (u) => { const m = /^data:([^;,]+);base64,(.*)$/.exec(u || ''); if (!m) return null; const bin = atob(m[2]); const b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return { type: m[1], bytes: b }; };
  // the photos of the table's cells as data: URLs (IBOrders.thumbs); none readable → an empty map
  async function photosOf(spec) {
    const urls = [...new Set((spec.rows || []).flatMap((r) => (r || []).map(cellImg)).filter(Boolean))];
    const out = new Map(); const far = [];
    urls.forEach((u) => { if (u.startsWith('data:')) out.set(u, u); else far.push(u); }); // a picture the page holds is its own data
    if (!far.length || !window.IBOrders || !window.IBOrders.thumbs) return out;
    try { (await window.IBOrders.thumbs(far.slice(0, 600))).forEach((v, k) => out.set(k, v)); } catch (e) { /* the boxes stay empty */ }
    return out;
  }
  // a photo for the sheet's cell: a JPEG of 96 px a side at most (Excel reads neither WebP nor a huge picture)
  async function cellJpeg(dataUrl) {
    try {
      const img = new Image(); img.src = dataUrl; await img.decode();
      const k = Math.min(1, 96 / Math.max(img.naturalWidth, img.naturalHeight)); const w = Math.max(1, Math.round(img.naturalWidth * k)); const hh = Math.max(1, Math.round(img.naturalHeight * k));
      const cv = document.createElement('canvas'); cv.width = w; cv.height = hh; const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, hh); ctx.drawImage(img, 0, 0, w, hh);
      const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.85));
      return blob ? { bytes: new Uint8Array(await blob.arrayBuffer()), w, h: hh } : null;
    } catch (e) { return null; }
  }

  // ---------------------------------------------------------------- the Excel
  async function excelBlob(spec, photos) {
    const sh = sheetOf(spec); const FD = window.IbtekrFlow; const PD = window.IbtekrProducts;
    if (FD && FD.xlsxParts && PD && PD.zip) {
      const images = [];
      if (sh.withImg) for (let i = 0; i < sh.dataRows; i++) { const d = photos.get(sh.images[i]); const j = d ? await cellJpeg(d) : null; if (j) images.push({ row: i, col: 0, bytes: j.bytes, ext: 'jpeg', w: Math.round(j.w * 0.6), h: Math.round(j.h * 0.6) }); }
      const files = FD.xlsxParts({ sheet: fileBase(spec.name || spec.title).replace(/[\[\]]/g, ' ').slice(0, 31), head: sh.head, rows: sh.rows, widths: sh.widths, fill: 'FF005642', freeze: 'A2', rowHeight: sh.withImg ? 48 : 22, images });
      // an Arabic report reads from the right: the sheet opens right-to-left
      const sheet = files.find((f) => f.name === 'xl/worksheets/sheet1.xml'); if (sheet && typeof sheet.data === 'string') sheet.data = sheet.data.replace('<sheetView workbookViewId="0">', '<sheetView rightToLeft="1" workbookViewId="0">');
      return new Blob([PD.zip(files)], { type: XLSX_MIME });
    }
    // no sheet writer (a page without the studio's files): the plain workbook, no photos
    const XL = window.XLSX || await new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'js/vendor/xlsx.full.min.js'; sc.onload = () => res(window.XLSX); sc.onerror = rej; document.head.appendChild(sc); });
    const wb = XL.utils.book_new(); const ws = XL.utils.aoa_to_sheet([sh.head].concat(sh.rows)); ws['!views'] = [{ RTL: true }];
    XL.utils.book_append_sheet(wb, ws, fileBase(spec.name || spec.title).slice(0, 31).replace(/[\\/?*[\]:]/g, ' '));
    return new Blob([XL.write(wb, { bookType: 'xlsx', type: 'array' })], { type: XLSX_MIME });
  }

  // ---------------------------------------------------------------- the PDF: the report as A4 pages
  const PAGE_W = 794, PAGE_H = 1123, MAX_PAGES = 60;
  const todayText = () => { try { return new Intl.DateTimeFormat('ar-EG-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Cairo' }).format(new Date()); } catch (e) { return new Date().toISOString().slice(0, 10); } };
  const tdOf = (c, photos) => {
    const img = cellImg(c); const t = cellText(c);
    if (c && typeof c === 'object' && 'img' in c) return h('td', { class: 'sh-prod' }, h('span', { class: 'sh-ph' }, img && photos.get(img) ? h('img', { src: photos.get(img), alt: '' }) : null), h('span', { class: 'sh-pt', dir: 'auto' }, t));
    return h('td', { dir: 'auto' }, t);
  };
  // the pages, filled row by row: a row that does not fit starts the next page (with the table's head again)
  function layout(spec, photos, host) {
    const title = String(spec.title || ''); const headers = (spec.headers || []).map(String); const rows = spec.rows || []; const pages = [];
    const logo = window.IBLoader && window.IBLoader.mark ? window.IBLoader.mark(26) : null;
    const page = () => {
      const body = h('div', { class: 'sh-body' });
      const pg = h('div', { class: 'sh-page', dir: 'rtl' }, h('div', { class: 'sh-top' }, h('span', { class: 'sh-brand' }, logo ? logo.cloneNode(true) : null, h('b', null, 'إبتكر')), h('span', { class: 'sh-date' }, todayText())), body,
        h('div', { class: 'sh-foot' }, h('span', { dir: 'auto' }, title), h('span', { class: 'sh-pn' })));
      host.append(pg); pages.push({ el: pg, body }); return pages[pages.length - 1];
    };
    const fits = (p) => p.body.scrollHeight <= p.body.clientHeight + 1;
    let cur = page();
    cur.body.append(h('h1', { class: 'sh-title', dir: 'auto' }, title));
    if (spec.sub) cur.body.append(h('p', { class: 'sh-sub', dir: 'auto' }, String(spec.sub)));
    const sum = (spec.summary || []).filter((x) => x && x.label);
    if (sum.length) cur.body.append(h('div', { class: 'sh-sum' }, sum.map((x) => h('div', { class: 'sh-tile' }, h('span', null, x.label), h('b', { dir: 'auto' }, cellText(x.value))))));
    let dropped = 0;
    if (headers.length) {
      const table = () => { const tb = h('tbody'); const t = h('table', { class: 'sh-table' }, h('thead', null, h('tr', null, headers.map((x) => h('th', null, x)))), tb); return { t, tb }; };
      let tbl = table(); cur.body.append(tbl.t);
      if (!rows.length) tbl.tb.append(h('tr', null, h('td', { colspan: String(headers.length), class: 'sh-none' }, spec.empty || 'مفيش بيانات.')));
      const add = (tr) => {
        tbl.tb.append(tr);
        if (fits(cur)) return true;
        tr.remove();
        if (pages.length >= MAX_PAGES) return false;
        if (!tbl.tb.children.length) tbl.t.remove(); // a head alone at the foot of a page
        cur = page(); tbl = table(); cur.body.append(tbl.t); tbl.tb.append(tr);
        return true;
      };
      for (let i = 0; i < rows.length; i++) { if (!add(h('tr', null, headers.map((_, k) => tdOf(rows[i][k], photos))))) { dropped = rows.length - i; break; } }
      if (spec.total && rows.length && !dropped) add(h('tr', { class: 'sh-total' }, headers.map((_, k) => h('td', { dir: 'auto' }, cellText(spec.total[k])))));
    }
    const tail = [dropped ? h('p', { class: 'sh-note' }, '… و' + dropped + ' صف كمان — الجدول كله في ملف Excel.') : null, spec.note ? h('p', { class: 'sh-note', dir: 'auto' }, String(spec.note)) : null].filter(Boolean);
    tail.forEach((n) => { cur.body.append(n); if (!fits(cur) && pages.length < MAX_PAGES) { n.remove(); cur = page(); cur.body.append(n); } });
    pages.forEach((p, i) => { p.el.querySelector('.sh-pn').textContent = 'صفحة ' + (i + 1) + ' من ' + pages.length; });
    return pages.map((p) => p.el);
  }
  const loadCanvas = () => (window.html2canvas ? Promise.resolve(window.html2canvas) : new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'js/vendor/html2canvas.min.js'; sc.onload = () => res(window.html2canvas); sc.onerror = rej; document.head.appendChild(sc); }));
  async function pdfBlob(spec, photos, onStep) {
    const host = h('div', { class: 'sh-host', 'aria-hidden': 'true' }); document.body.append(host);
    try {
      const els = layout(spec, photos, host);
      await Promise.all([...host.querySelectorAll('img')].map((im) => (im.decode ? im.decode().catch(() => {}) : null)));
      if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) { /* the fallback font */ } }
      const draw = await loadCanvas(); const out = [];
      for (let i = 0; i < els.length; i++) {
        if (onStep) onStep(i + 1, els.length);
        const cv = await draw(els[i], { backgroundColor: '#ffffff', scale: 2, logging: false, width: PAGE_W, height: PAGE_H, windowWidth: PAGE_W });
        const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.9));
        out.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), w: cv.width, h: cv.height });
      }
      return { blob: new Blob([pdfBytes(out)], { type: 'application/pdf' }), pages: out.length };
    } finally { host.remove(); }
  }

  // ---------------------------------------------------------------- sending
  const openTab = (href) => { const a = document.createElement('a'); a.href = href; a.target = '_blank'; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove(); };
  async function send(spec, type, via, onStep) {
    const title = String(spec.title || ''); const text = spec.text ? String(spec.text) : messageText(spec);
    const toast = (m, k) => { if (K() && K().toast) K().toast(m, k); };
    const done = (o) => { window.__lastShare = Object.assign({ type, via, title, text }, o); return o; };
    if (type === 'link') {
      const body = (text ? text + '\n' : '') + (text.includes(spec.link) ? '' : spec.link);
      if (via === 'copy') { try { await navigator.clipboard.writeText(String(spec.link)); toast('اللينك اتنسخ', 'success'); } catch (e) { toast('المتصفح ما سمحش بالنسخ — انسخه بإيدك: ' + spec.link, 'warning'); } return done({ ok: true, href: String(spec.link) }); }
      const href = shareHref(via, { phone: spec.phone, email: spec.email, title, text: body.trim() }); openTab(href);
      toast('اتفتح ' + (via === 'whatsapp' ? 'واتساب' : 'الإيميل') + ' باللينك', 'success'); return done({ ok: true, href });
    }
    const photos = await photosOf(spec);
    // spec.excel: the caller's own workbook (the studio's sheet — the file its maker fills and returns) instead of the report's
    const made = type === 'pdf' ? await pdfBlob(spec, photos, onStep) : { blob: typeof spec.excel === 'function' ? await spec.excel() : await excelBlob(spec, photos), pages: 0 };
    const name = fileBase(spec.name || title) + (type === 'pdf' ? '.pdf' : '.xlsx');
    const info = { ok: true, name, size: made.blob.size, pages: made.pages, photos: photos.size };
    if (via === 'download') { await K().saveFile(name, made.blob); toast('الملف اتنزل على جهازك: ' + name, 'success'); return done(info); }
    // a phone: the device's own share sheet takes the file itself (WhatsApp, mail, …)
    const file = typeof File === 'function' ? new File([made.blob], name, { type: made.blob.type }) : null;
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title, text }); return done(Object.assign(info, { native: true })); } catch (e) { if (e && e.name === 'AbortError') return done(Object.assign(info, { ok: false, cancelled: true })); }
    }
    // a computer: the file is saved and the chat / the mail opens with the message — the member attaches the file
    await K().saveFile(name, made.blob);
    const href = shareHref(via, { phone: spec.phone, email: spec.email, title, text: text + '\n(الملف مرفق: ' + name + ')' }); openTab(href);
    toast('الملف اتنزل (' + name + ') واتفتح ' + (via === 'whatsapp' ? 'واتساب' : 'الإيميل') + ' — ارفقه في الرسالة.', 'success');
    return done(Object.assign(info, { href }));
  }

  // ---------------------------------------------------------------- the popup
  const TYPES = [['excel', 'Excel', 'جدول يتفتح ويتعدّل', 'sheet'], ['pdf', 'PDF', 'نفس شكل التقرير — للقراية والطباعة', 'file'], ['link', 'لينك', 'لينك الصفحة من غير ملف', 'link']];
  const VIAS = [['whatsapp', 'واتساب', 'whatsapp'], ['email', 'إيميل', 'mail'], ['download', 'تحميل على الجهاز', 'download'], ['copy', 'نسخ اللينك', 'copy']];
  function open(spec0) {
    const spec = Object.assign({}, spec0 || {}); const hasTable = (spec.headers || []).length > 0 || (spec.summary || []).length > 0; const hasLink = typeof spec.link === 'string' && /^https:\/\//.test(spec.link);
    if (!hasLink) delete spec.link;
    const types = TYPES.filter((t) => (t[0] === 'link' ? hasLink : hasTable));
    const st = { type: types[0] ? types[0][0] : 'excel', via: 'whatsapp', busy: false, step: '' };
    let m = null;
    const icon = (n) => { try { return U().Icon(n, 'md'); } catch (e) { return null; } };
    const opt = (kind, id, label, desc, ic) => h('button', { type: 'button', class: 'sh-opt' + (st[kind] === id ? ' on' : ''), role: 'radio', 'aria-checked': String(st[kind] === id), ['data-sh-' + kind]: id, disabled: st.busy ? '' : false,
      onClick: () => { st[kind] = id; if (kind === 'type') { const ok = viasOf().map((v) => v[0]); if (!ok.includes(st.via)) st.via = ok[0]; } draw(); } }, icon(ic), h('span', { class: 'sh-opt-t' }, h('b', null, label), desc ? h('small', null, desc) : null));
    const viasOf = () => VIAS.filter((v) => (st.type === 'link' ? v[0] !== 'download' : v[0] !== 'copy'));
    const who = () => (st.via === 'whatsapp' ? (waNumber(spec.phone) ? 'هيتفتح واتساب على رقم ' + digits(spec.phone) + '.' : 'هيتفتح واتساب وتختار المحادثة.')
      : st.via === 'email' ? (spec.email ? 'هيتفتح الإيميل لـ ' + spec.email + '.' : 'هيتفتح الإيميل وتكتب المرسل له.') : '');
    const hint = () => (st.type === 'link' ? who() : st.via === 'download' ? 'الملف هينزل على جهازك.' : who() + ' على الموبايل الملف بيتبعت مع الرسالة، وعلى الكمبيوتر بينزل على جهازك وترفقه في الرسالة.');
    const go = async () => {
      if (st.busy) return; st.busy = true; st.step = 'بنجهّز الملف…'; draw();
      try {
        const r = await send(spec, st.type, st.via, (i, n) => { st.step = 'بنجهّز الملف… صفحة ' + i + ' من ' + n; const b = m && m.el.querySelector('[data-sh-step]'); if (b) b.textContent = st.step; });
        st.busy = false;
        if (r && r.cancelled) { draw(); return; }
        // the caller's own record of the share (the activity log) — what went and how, never the file
        if (typeof spec.onDone === 'function') { try { spec.onDone({ type: st.type, via: st.via }); } catch (e) { /* the share itself went */ } }
        m.close();
      } catch (e) { st.busy = false; st.step = ''; draw(); if (K() && K().toast) K().toast('الملف ما اتجهّزش — جرّب تاني أو اختار النوع التاني.', 'error'); }
    };
    function draw() {
      const body = [
        types.length > 1 || st.type !== 'link' ? h('div', { class: 'sh-sec' }, h('div', { class: 'sh-h' }, 'نوع الملف'), h('div', { class: 'sh-opts', role: 'radiogroup', 'aria-label': 'نوع الملف' }, types.map((t) => opt('type', t[0], t[1], t[2], t[3])))) : null,
        h('div', { class: 'sh-sec' }, h('div', { class: 'sh-h' }, 'طريقة الإرسال'), h('div', { class: 'sh-opts', role: 'radiogroup', 'aria-label': 'طريقة الإرسال' }, viasOf().map((v) => opt('via', v[0], v[1], '', v[2])))),
        h('p', { class: 'sh-hint t-small', 'data-sh-hint': '' }, hint()),
        st.busy ? h('p', { class: 'sh-step t-small', 'data-sh-step': '', role: 'status' }, st.step) : null,
      ].filter(Boolean);
      const label = st.type === 'link' && st.via === 'copy' ? 'نسخ اللينك' : st.via === 'download' ? 'تحميل' : 'مشاركة';
      const foot = [U().Button({ type: 'primary', label: st.busy ? 'ثواني…' : label, disabled: st.busy, attrs: { 'data-sh-go': '' }, onClick: go }), U().Button({ type: 'text', label: 'إلغاء', disabled: st.busy, onClick: () => m.close() })];
      if (!m) { m = U().Modal({ title: 'مشاركة — ' + String(spec.title || ''), body, footer: foot, share: false }); m.el.classList.add('sh-modal'); m.el.dataset.shareModal = ''; }
      else { m.setBody(...body); m.setFooter(...foot); }
    }
    draw();
    return m;
  }

  window.IBShare = { open, send, pure };
})();
