// IBChatFiles — files and voice in the assistants' chat (the owner 17 Nov: «اقدر ارفع فايل سواء كان شيت او صورة او اين كان نوع الملف
// فيديو او بوست» و«اقدر ابعتلهم فويس»). Not a block.
//   read(file) → { ok, file: { name, kind: 'image' | 'pdf' | 'text', data | text, note, thumb } } | { ok: false, message }:
//     an image (a post, a screenshot) shrunk to 1568px JPEG; a PDF as it is (≤ 8 MB); a sheet (xlsx / xls / ods / csv) read to CSV text
//     per sheet, and any text file as text (≤ 40,000 characters); a video → one frame from its middle as an image (the assistant reads
//     images, not video) with its length in the note. Everything is read here in the browser — the server checks the bytes again.
//   dictation({ onText, onEnd }) → { stop() } | null: the browser's speech-to-text in Egyptian Arabic, the words typed into the box as
//     they are heard (Chrome / Edge / Safari); null where the browser has none.
(function () {
  'use strict';
  const MAX_SIDE = 1568; const PDF_MAX = 8 * 1024 * 1024; const TEXT_MAX = 40000; const RAW_MAX = 60 * 1024 * 1024;
  const SHEET = /\.(xlsx|xlsm|xls|ods)$/i; const TEXTY = /\.(csv|tsv|txt|md|json|xml|html?)$/i;
  const loadXLSX = () => (window.XLSX ? Promise.resolve(window.XLSX) : new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'js/vendor/xlsx.full.min.js'; sc.onload = () => res(window.XLSX); sc.onerror = rej; document.head.appendChild(sc); }));
  const b64of = (buf) => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const fail = (message) => ({ ok: false, message });
  // a drawable (image or video frame) → JPEG base64 at most MAX_SIDE on its long side, and a small thumb for the chip
  function jpegOf(src, w, h) {
    const k = Math.min(1, MAX_SIDE / Math.max(w, h)); const cw = Math.max(1, Math.round(w * k)); const ch = Math.max(1, Math.round(h * k));
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch; const g = cv.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, cw, ch); g.drawImage(src, 0, 0, cw, ch);
    const url = cv.toDataURL('image/jpeg', 0.85);
    const t = document.createElement('canvas'); const tk = 96 / Math.max(cw, ch); t.width = Math.max(1, Math.round(cw * tk)); t.height = Math.max(1, Math.round(ch * tk)); t.getContext('2d').drawImage(cv, 0, 0, t.width, t.height);
    return { data: url.slice(url.indexOf(',') + 1), thumb: t.toDataURL('image/jpeg', 0.7) };
  }
  function image(file) {
    return new Promise((res) => {
      const url = URL.createObjectURL(file); const im = new Image();
      im.onload = () => { try { const j = jpegOf(im, im.naturalWidth, im.naturalHeight); res({ ok: true, file: { name: file.name, kind: 'image', data: j.data, thumb: j.thumb, note: '' } }); } catch (e) { res(fail('الصورة دي ماتقريتش')); } finally { URL.revokeObjectURL(url); } };
      im.onerror = () => { URL.revokeObjectURL(url); res(fail('الصورة دي ماتقريتش — جرّب JPG أو PNG')); };
      im.src = url;
    });
  }
  function video(file) {
    return new Promise((res) => {
      const url = URL.createObjectURL(file); const v = document.createElement('video'); let done = false;
      const end = (r) => { if (done) return; done = true; URL.revokeObjectURL(url); v.removeAttribute('src'); res(r); };
      v.muted = true; v.preload = 'auto'; v.playsInline = true;
      v.onloadedmetadata = () => { const d = isFinite(v.duration) ? v.duration : 0; v.currentTime = d > 2 ? d / 2 : Math.min(0.5, d / 2); };
      v.onseeked = () => { try { const j = jpegOf(v, v.videoWidth || 640, v.videoHeight || 360); const sec = isFinite(v.duration) ? Math.round(v.duration) : 0;
        end({ ok: true, file: { name: file.name, kind: 'image', data: j.data, thumb: j.thumb, note: 'فريم من نص فيديو' + (sec ? ' مدته ' + sec + ' ث' : '') + ' — المساعد بيشوف الفريم ده بس' } }); } catch (e) { end(fail('ماعرفناش ناخد فريم من الفيديو ده')); } };
      v.onerror = () => end(fail('الفيديو ده ماتقراش في المتصفح — جرّب MP4'));
      setTimeout(() => end(fail('الفيديو طوّل — جرّب فيديو أقصر أو صورة منه')), 15000);
      v.src = url;
    });
  }
  async function sheet(file) {
    try {
      const XL = await loadXLSX(); const wb = XL.read(await file.arrayBuffer(), { type: 'array' });
      let text = ''; for (const n of wb.SheetNames.slice(0, 6)) { text += (wb.SheetNames.length > 1 ? '# ' + n + '\n' : '') + XL.utils.sheet_to_csv(wb.Sheets[n], { blankrows: false }) + '\n'; if (text.length > TEXT_MAX) break; }
      if (!text.trim()) return fail('الشيت فاضي');
      return { ok: true, file: { name: file.name, kind: 'text', text: text.slice(0, TEXT_MAX), note: text.length > TEXT_MAX ? 'أول ' + TEXT_MAX + ' حرف من الشيت' : 'شيت', thumb: null } };
    } catch (e) { return fail('الشيت ده ماتقراش'); }
  }
  async function read(file) {
    if (!file) return fail('مفيش ملف');
    if (file.size > RAW_MAX) return fail('«' + file.name + '» أكبر من 60 ميجا');
    const type = String(file.type || ''); const name = String(file.name || '');
    if (/^image\//.test(type)) return image(file);
    if (/^video\//.test(type)) return video(file);
    if (type === 'application/pdf' || /\.pdf$/i.test(name)) {
      if (file.size > PDF_MAX) return fail('الـ PDF أكبر من 8 ميجا');
      return { ok: true, file: { name, kind: 'pdf', data: b64of(await file.arrayBuffer()), note: 'PDF', thumb: null } };
    }
    if (SHEET.test(name) || /spreadsheet|excel/.test(type)) return sheet(file);
    if (TEXTY.test(name) || /^text\//.test(type) || type === 'application/json') {
      const text = await file.text(); if (!text.trim()) return fail('الملف فاضي');
      return { ok: true, file: { name, kind: 'text', text: text.slice(0, TEXT_MAX), note: text.length > TEXT_MAX ? 'أول ' + TEXT_MAX + ' حرف' : '', thumb: null } };
    }
    return fail('«' + name + '» نوعه مش مدعوم — ابعت صورة أو فيديو أو PDF أو شيت أو ملف نص');
  }
  function dictation(o) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) return null;
    const r = new SR(); r.lang = 'ar-EG'; r.interimResults = true; r.continuous = true;
    let base = ''; let stopped = false;
    r.onresult = (e) => { let fin = ''; let mid = ''; for (let i = 0; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) fin += t; else mid += t; } o.onText && o.onText((base + ' ' + fin + ' ' + mid).replace(/\s+/g, ' ').trim()); };
    r.onerror = (e) => { o.onError && o.onError(e && e.error === 'not-allowed' ? 'المتصفح مش سامح بالمايك — اسمحله من علامة القفل جنب اللينك' : 'المايك وقف — جرّب تاني'); };
    r.onend = () => { if (!stopped) o.onEnd && o.onEnd(); };
    return { start(prefix) { base = String(prefix || ''); try { r.start(); } catch (e) { /* already */ } }, stop() { stopped = true; try { r.stop(); } catch (e) { /* done */ } o.onEnd && o.onEnd(); } };
  }
  window.IBChatFiles = { read, dictation, supportsVoice: () => !!(window.SpeechRecognition || window.webkitSpeechRecognition) };
})();
