
/* UI kit — one function per Figma component, same names. Safe DOM only: text goes through textContent, never innerHTML. */
(function () {
  'use strict';
  const D = window.IbtekrDomain;
  const NS = 'http://www.w3.org/2000/svg';

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'html') throw new Error('html is not allowed');
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    append(el, kids);
    return el;
  }
  function append(el, kids) {
    for (const k of kids.flat(Infinity)) {
      if (k == null || k === false) continue;
      el.append(k instanceof Node ? k : document.createTextNode(String(k)));
    }
  }
  // Numbers stay LTR. A string that mixes Arabic words with numbers («5 من 6», «12 يوم», «1,234.00 ج.م», «-12,000.00 (عليه)») keeps the
  // RTL reading order and only its number tokens are isolated LTR — wrapping the whole mixed string LTR flipped the words (owner fix 22 Oct).
  const AR_RE = /[\u0600-\u06FF]/; const NUM_RE = /[-−+]?\d[\d,.:\/٬٫]*%?/g;
  const numTokens = (s) => { const out = []; let last = 0; s.replace(NUM_RE, (m, i) => { if (i > last) out.push(s.slice(last, i)); out.push(h('span', { class: 'n' }, m)); last = i + m.length; return m; }); if (last < s.length) out.push(s.slice(last)); return out; };
  const num = (t) => (typeof t === 'string' && AR_RE.test(t) ? h('span', { class: 'num-ar' }, ...numTokens(t)) : h('span', { class: 'num' }, t));
  // same fix for any .num written by hand elsewhere (kit pages, hr slip…): runs on render
  const fixNum = (root) => { if (!root || !root.querySelectorAll) return; const list = root.matches && root.matches('.num') ? [root] : []; root.querySelectorAll('.num').forEach((e) => list.push(e));
    list.forEach((e) => { if (e.children.length || !AR_RE.test(e.textContent)) return; const t = e.textContent; e.className = e.className.replace(/\bnum\b/, 'num-ar'); e.replaceChildren(...numTokens(t)); }); };
  if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') { const mo = new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1) fixNum(n); }))); const start = () => mo.observe(document.body, { childList: true, subtree: true }); if (document.body) start(); else document.addEventListener('DOMContentLoaded', start); }

  const ICONS = {
    ticket: 'M2 9a3 3 0 010 6v2a2 2 0 002 2h16a2 2 0 002-2v-2a3 3 0 010-6V7a2 2 0 00-2-2H4a2 2 0 00-2 2zM13 5v2M13 17v2M13 11v2',
    msg: 'M7.9 20A9 9 0 104 16.1L2 22z',
    instagram: 'M7 2h10a5 5 0 015 5v10a5 5 0 01-5 5H7a5 5 0 01-5-5V7a5 5 0 015-5zM16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37zM17.5 6.5h.01',
    facebook: 'M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z',
    tiktok: 'M16 3a5 5 0 005 5v3a8 8 0 01-5-1.7V16a6 6 0 11-6-6v3a3 3 0 103 3V3z',
    at: 'M8 12a4 4 0 108 0 4 4 0 00-8 0zM16 8v5a3 3 0 006 0v-1a10 10 0 10-4 8',
    mic: 'M12 2a3 3 0 00-3 3v7a3 3 0 006 0V5a3 3 0 00-3-3zM19 10v2a7 7 0 01-14 0v-2M12 19v3',
    image: 'M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2zM7 9a2 2 0 104 0 2 2 0 00-4 0zM21 15l-3.1-3.1a2 2 0 00-2.8 0L6 21',
    frown: 'M2 12a10 10 0 1020 0 10 10 0 00-20 0zM16 16s-1.5-2-4-2-4 2-4 2M9 9h.01M15 9h.01',
    star: 'M12 2.5l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.3l-5.8 3.1 1.1-6.5L2.6 9.3l6.5-.9z',
    megaphone: 'M3 11l18-5v12L3 14zM11.6 16.8a3 3 0 11-5.8-1.6',
    zap: 'M13 2L3 14h9l-1 8 10-12h-9z',
    eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z', trash: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5',
    file: 'M15 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7zM14 2v4a2 2 0 002 2h4M10 9H8M16 13H8M16 17H8',
    qr: 'M4 3h3a1 1 0 011 1v3a1 1 0 01-1 1H4a1 1 0 01-1-1V4a1 1 0 011-1zM17 3h3a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1V4a1 1 0 011-1zM4 16h3a1 1 0 011 1v3a1 1 0 01-1 1H4a1 1 0 01-1-1v-3a1 1 0 011-1zM21 16h-3a2 2 0 00-2 2v3M21 21v.01M12 7v3a2 2 0 01-2 2H7M3 12h.01M12 3h.01M12 16v.01M16 12h1M21 12v.01M12 21v-1',
    link: 'M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71',
    merge: 'M8 6l4-4 4 4M12 2v10.3a4 4 0 01-1.17 2.87L4 22M20 22l-5-5',
    eyeoff: 'M10.7 5.1a10.7 10.7 0 0111.2 6.6 1 1 0 010 .7 10.7 10.7 0 01-1.4 2.5M14.1 14.2a3 3 0 01-4.2-4.2M17.5 17.5A10.8 10.8 0 012.1 12.3a1 1 0 010-.7 10.8 10.8 0 014.4-5.1M2 2l20 20',
    refresh: 'M3 12a9 9 0 019-9 9.75 9.75 0 016.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 01-9 9 9.75 9.75 0 01-6.74-2.74L3 16M8 16H3v5',
    moon: 'M12 3a6 6 0 009 9 9 9 0 11-9-9z',
    bot: 'M6 8h12a2 2 0 012 2v8a2 2 0 01-2 2H6a2 2 0 01-2-2v-8a2 2 0 012-2zM12 8V4H8M2 14h2M20 14h2M15 13v2M9 13v2',
    filter: 'M3 5h18l-7 8v6l-4 2v-8z',
    plus: 'M12 5v14M5 12h14', chevD: 'M6 9l6 6 6-6', chevU: 'M6 15l6-6 6 6', chevL: 'M15 6l-6 6 6 6', chevR: 'M9 6l6 6-6 6', close: 'M6 6l12 12M18 6L6 18',
    cal: 'M4 7h16v13H4zM4 11h16M8 3v4M16 3v4', more: 'M12 6h.01M12 12h.01M12 18h.01', sliders: 'M4 7h10M18 7h2M4 17h2M10 17h10M14 5v4M6 15v4',
    bell: 'M6 16v-5a6 6 0 0112 0v5l2 2H4zM10 21h4', search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-5-5',
    home: 'M4 11l8-7 8 7v9H4z', box: 'M4 8l8-4 8 4v9l-8 4-8-4zM4 8l8 4 8-4M12 12v9', tag: 'M3 12V4h8l10 10-8 8zM7.5 8h.01',
    users: 'M9 11a3 3 0 100-6 3 3 0 000 6zM3 20a6 6 0 0112 0M17 11a3 3 0 000-6M21 20a6 6 0 00-4-5.6', truck: 'M1 3h15v13H1zM16 8h4l3 3v5h-7zM5.5 21a2 2 0 100-4 2 2 0 000 4zM18.5 21a2 2 0 100-4 2 2 0 000 4z', external: 'M18 6L6 18M8 6h10v10', checkCircle: 'M22 11.1V12a10 10 0 11-5.9-9.1M22 4L12 14l-3-3', mail: 'M4 4h16v16H4zM4 6l8 7 8-7', clockc: 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 6v6l4 2', stock: 'M4 20V10M10 20V4M16 20v-8M22 20H2',
    headset: 'M4 14v-2a8 8 0 0116 0v2M3 14h4v6H3zM17 14h4v6h-4z', chart: 'M4 20V10M10 20V4M16 20v-8M22 20H2',
    sparkle: 'M10.5 2.25L12.6 8.4L18.75 10.5L12.6 12.6L10.5 18.75L8.4 12.6L2.25 10.5L8.4 8.4Z M18.75 15.75L19.65 18.3L22.2 19.2L19.65 20.1L18.75 22.65L17.85 20.1L15.3 19.2L17.85 18.3Z', send: 'M21 3L10 14M21 3l-7 18-4-7-7-4z',
    download: 'M12 3v12M6 11l6 6 6-6M4 21h16', share: 'M18 8a3 3 0 100-6 3 3 0 000 6zM6 15a3 3 0 100-6 3 3 0 000 6zM18 22a3 3 0 100-6 3 3 0 000 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4', copy: 'M9 9h11v11H9zM5 15H4V4h11v1', whatsapp: 'M3 21l1.6-4.7A8.5 8.5 0 1112 20.5a8.4 8.4 0 01-4.2-1.1zM9 8.5c0 3 2.5 5.5 5.5 5.5l1-1.5-1.8-.8-.8.8a4 4 0 01-2.4-2.4l.8-.8-.8-1.8z', activity: 'M22 12h-4l-3 9L9 3l-3 9H2', attach: 'M21 11l-9.5 9.5a5 5 0 01-7-7L14 4a3.5 3.5 0 015 5l-9.5 9.5a2 2 0 01-3-3L15 7', check: 'M5 13l4 4L19 7', alert: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
    briefcase: 'M4.25 7h15.5A2.25 2.25 0 0122 9.25v9.5A2.25 2.25 0 0119.75 21H4.25A2.25 2.25 0 012 18.75v-9.5A2.25 2.25 0 014.25 7zM8 7V4a1.5 1.5 0 011.5-1.5h5A1.5 1.5 0 0116 4v3M2 13h20',
    clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2', wallet: 'M3 7h16a2 2 0 012 2v10H5a2 2 0 01-2-2zM3 7l12-3v3M16 14h.01', gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1-1-3-2 .5-1.5-1.5.5-2-3-1-1 2h-2l-1-2-3 1 .5 2L6.5 8.5 4.5 8l-1 3 2 1v2l-2 1 1 3 2-.5 1.5 1.5-.5 2 3 1 1-2h2l1 2 3-1-.5-2 1.5-1.5 2 .5 1-3-2-1z',
  };
  function Icon(name, cls) {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'ic' + (name === 'more' ? ' ic-more' : '') + (cls ? ' ' + cls : '')); s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(NS, 'path'); p.setAttribute('d', ICONS[name]); s.append(p);
    return s;
  }

  // ---- Button / Icon button ----
  function Button({ type = 'default', size, label, icon, iconEnd, onClick, disabled, attrs }) {
    return h('button', Object.assign({ type: 'button', class: 'btn btn-' + type + (size ? ' ' + size : ''), disabled, onClick }, attrs || {}),
      icon ? Icon(icon, 'sm') : null, label, iconEnd ? Icon(iconEnd, 'sm') : null);
  }
  function IconButton({ icon, label, onClick, attrs }) {
    return h('button', Object.assign({ type: 'button', class: 'icon-btn', 'aria-label': label, title: label, onClick }, attrs || {}), Icon(icon));
  }

  // ---- Popover plumbing: one open at a time, closes on outside click / Esc, returns focus ----
  // Popovers can nest (a Select inside the notifications panel): a stack, Esc closes the top one, an outside click closes all.
  const popStack = []; let openClose = null; const syncTop = () => { openClose = popStack.length ? popStack[popStack.length - 1].close : null; };
  function closePopover() { if (popStack.length) popStack[popStack.length - 1].close(); }
  document.addEventListener('mousedown', (e) => { if (popStack.length && !e.target.closest('[data-popover-root]')) while (popStack.length) popStack[popStack.length - 1].close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openClose) { e.stopImmediatePropagation(); closePopover(); } }, true);

  function popover(anchorEl, trigger, build) {
    // anchorEl: wrapper (position:relative); build(close) -> element
    let el = null;
    const close = () => { if (el) { el.remove(); el = null; trigger.setAttribute('aria-expanded', 'false'); } const i = popStack.findIndex((p) => p.close === close); if (i >= 0) popStack.splice(i, 1); syncTop(); };
    const open = () => {
      while (popStack.length && !popStack[popStack.length - 1].el.contains(anchorEl)) popStack[popStack.length - 1].close();
      el = build(() => { close(); trigger.focus(); });
      anchorEl.append(el); trigger.setAttribute('aria-expanded', 'true'); popStack.push({ close, el }); syncTop();
      const first = el.querySelector('[role=option][aria-selected=true],[role=menuitem],[role=option]'); if (first && el.dataset.focus !== 'no') first.focus();
    };
    return { open, close, toggle: () => (el ? (close(), trigger.focus()) : open()) };
  }
  function menuKeys(menu) {
    menu.addEventListener('keydown', (e) => {
      const items = [...menu.querySelectorAll('[role=option],[role=menuitem]')]; const i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    });
  }

  // ---- Dropdown menu + option ----
  function DropdownMenu({ options, value, role = 'listbox', onSelect, end }) {
    const menu = h('div', { class: 'menu' + (end ? ' end' : ''), role, 'data-popover-root': '' });
    for (const o of options) {
      const sel = o.value === value;
      menu.append(h('button', { type: 'button', class: 'opt' + (o.danger ? ' danger' : ''), role: role === 'menu' ? 'menuitem' : 'option', 'aria-selected': role === 'menu' ? false : String(sel), onClick: () => onSelect(o.value) }, o.icon ? Icon(o.icon, 'sm') : null, o.label));
    }
    menuKeys(menu);
    return menu;
  }

  // ---- Select (form) ----
  function Select({ id, label, required, options, value, placeholder = 'اختار', error, onChange, help, disabled }) {
    const wrap = h('div', { class: 'pop-anchor', 'data-popover-root': '', style: 'display:block' });
    const cur = options.find((o) => o.value === value);
    const btn = h('button', { type: 'button', id, class: 'select' + (error ? ' err' : ''), 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-invalid': error ? 'true' : false, 'aria-describedby': error ? id + '-err' : false, disabled: disabled ? '' : false },
      Icon('chevD', 'sm'), h('span', { class: 'val' + (cur ? '' : ' ph') }, cur ? cur.label : placeholder));
    const pop = popover(wrap, btn, (close) => DropdownMenu({ options, value, onSelect: (v) => { close(); onChange(v); } }));
    btn.addEventListener('click', pop.toggle);
    wrap.append(btn);
    return FieldShell({ id, label, required, error, help }, wrap);
  }
  function FieldShell({ id, label, required, error, help }, control) {
    return h('div', { class: 'field' },
      label ? h('label', { for: id }, label, required ? h('span', { class: 'req', 'aria-hidden': 'true' }, ' *') : null) : null,
      control, help && !error ? h('div', { class: 'help' }, help) : null,
      error ? h('div', { class: 'err-msg', id: id + '-err', role: 'alert' }, error) : null);
  }

  // ---- Calendar (shared by single + range pickers); Saturday-first ----
  const DOW = ['س', 'ح', 'ن', 'ث', 'ر', 'خ', 'ج'];
  function Calendar({ year, month, today, from, to, hover, onPick, onHover, onNav, min, max, showPrev = true, showNext = true }) {
    const lo = from && to ? (from < to ? from : to) : from; const hi = from && to ? (from < to ? to : from) : from;
    const end = hover && from && !to ? hover : to;
    const a = from && end ? (from < end ? from : end) : from; const b = from && end ? (from < end ? end : from) : from;
    void lo; void hi;
    const grid = h('div', { class: 'cal-grid', role: 'grid', 'aria-label': D.monthName(month) + ' ' + year });
    DOW.forEach((d) => grid.append(h('div', { class: 'dow', role: 'columnheader' }, d)));
    for (const week of D.monthMatrix(year, month)) for (const c of week) {
      const isSel = !c.outside && (c.iso === a || c.iso === b);
      const inR = !c.outside && a && b && c.iso > a && c.iso < b;
      const dis = (min && c.iso < min) || (max && c.iso > max);
      grid.append(h('button', {
        type: 'button', role: 'gridcell', class: 'day' + (c.outside ? ' outside' : '') + (c.iso === today ? ' today' : '') + (isSel ? ' sel' : '') + (inR ? ' inrange' : ''),
        'aria-label': D.formatDateLong(c.iso), 'aria-selected': String(!!isSel), 'aria-current': c.iso === today ? 'date' : false, disabled: dis,
        onClick: () => onPick(c.iso), onMouseenter: () => onHover && onHover(c.iso),
      }, String(c.day)));
    }
    return h('div', { class: 'cal' },
      h('div', { class: 'cal-h' },
        showNext ? IconButton({ icon: 'chevR', label: 'الشهر السابق', onClick: () => onNav(-1) }) : h('span', { style: 'width:32px' }),
        h('span', null, D.monthName(month) + ' ' + year),
        showPrev ? IconButton({ icon: 'chevL', label: 'الشهر التالي', onClick: () => onNav(1) }) : h('span', { style: 'width:32px' })),
      grid);
  }
  const shiftMonth = (y, m, d) => { const t = m - 1 + d; return { year: y + Math.floor(t / 12), month: ((t % 12) + 12) % 12 + 1 }; };

  // ---- Date field (single date): typed input + calendar popup ----
  function DateField({ id, label, required, value, error, today, onChange, help }) {
    const wrap = h('div', { class: 'pop-anchor', 'data-popover-root': '', style: 'display:block' });
    const input = h('input', { id, type: 'text', inputmode: 'numeric', dir: 'ltr', placeholder: 'dd/mm/yyyy', value: value ? D.formatDateNumeric(value) : '', 'aria-invalid': error ? 'true' : false, 'aria-describedby': error ? id + '-err' : false });
    const calBtn = h('button', { type: 'button', class: 'icb', 'aria-label': 'اختيار التاريخ', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' }, Icon('cal', 'sm'));
    const box = h('div', { class: 'input' + (error ? ' err' : '') }, calBtn, input);
    input.addEventListener('change', () => { const iso = D.parseDate(input.value); if (iso) onChange(iso, null); else onChange(value, 'اكتب التاريخ بالشكل يوم/شهر/سنة، مثال 20/10/2026'); });
    const pop = popover(wrap, calBtn, (close) => {
      let [y, m] = (value || today).split('-').map(Number);
      const dp = h('div', { class: 'dp single', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'اختيار التاريخ', 'data-popover-root': '', 'data-focus': 'no' });
      const draw = () => { dp.replaceChildren(Calendar({ year: y, month: m, today, from: value, to: value, onPick: (iso) => { close(); onChange(iso, null); }, onNav: (d) => { ({ year: y, month: m } = shiftMonth(y, m, d)); draw(); } }),
        h('div', { class: 'range-row', style: 'padding:8px 0 0;border:0' }, Button({ type: 'text', size: 'sm', label: 'اليوم الحالي', onClick: () => { close(); onChange(today, null); } }))); };
      draw(); return dp;
    });
    calBtn.addEventListener('click', pop.toggle);
    wrap.append(box);
    return FieldShell({ id, label, required, error, help: help || 'الشكل: يوم/شهر/سنة' }, wrap);
  }

  function TextInput({ id, label, required, value, error, placeholder, onInput, inputmode, suffix, help, maxlength, disabled }) {
    const input = h('input', { id, type: 'text', value: value || '', placeholder, inputmode, maxlength, disabled: disabled ? '' : false, 'aria-invalid': error ? 'true' : false, 'aria-describedby': error ? id + '-err' : false });
    input.addEventListener('input', () => onInput(input.value));
    return FieldShell({ id, label, required, error, help }, h('div', { class: 'input' + (error ? ' err' : '') + (disabled ? ' is-disabled' : '') }, suffix ? h('span', { class: 'help' }, suffix) : null, input));
  }

  // ---- Modal ----
  let modalRoot = null;
  function Modal({ title, body, footer, onClose, share }) {
    const prev = document.activeElement;
    const titleId = 'm-title-' + Math.random().toString(36).slice(2, 7);
    const close = () => { scrim.remove(); document.removeEventListener('keydown', keys, true); if (prev && prev.focus) prev.focus(); onClose && onClose(); };
    const bodyEl = h('div', { class: 'modal-b' }); const footEl = h('div', { class: 'modal-f' });
    const dialog = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
      h('div', { class: 'modal-h' }, h('h2', { class: 't-h4', id: titleId }, title), h('div', { class: 'modal-h-actions' }, share !== true ? null : ShareButton({ icon: true, get: () => ({ title: typeof title === 'string' ? title : dialog.querySelector('#' + titleId).textContent, text: bodyShareText(typeof title === 'string' ? title : dialog.querySelector('#' + titleId).textContent, bodyEl), el: bodyEl }) }), IconButton({ icon: 'close', label: 'إغلاق', onClick: close }))), bodyEl, footEl);
    const scrim = h('div', { class: 'scrim' }, dialog);
    scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) close(); });
    const keys = (e) => {
      if (e.key === 'Escape' && !openClose) { e.preventDefault(); close(); }
      if (e.key === 'Tab') { const f = [...dialog.querySelectorAll('button:not([disabled]),input,[tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null); if (!f.length) return; const i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); } }
    };
    document.addEventListener('keydown', keys, true);
    (modalRoot || document.body).append(scrim);
    // Header «مشاركة» (opt-in: Modal({ share: true }) on report popups — owner 22 Oct «البوبات اللي فيها تقارير»); hidden on forms and when the footer has its own share.
    const syncShare = () => { const b = dialog.querySelector('.modal-h .share-anchor'); if (!b) return; const form = bodyEl.querySelector('input:not([type=search]):not([type=hidden]),textarea,select,[contenteditable=true]'); b.hidden = !!form || dialog.dataset.share === '1' || !!footEl.querySelector('[data-share]'); };
    const api = { el: dialog, close, setBody(...n) { bodyEl.replaceChildren(...n); syncShare(); }, setFooter(...n) { footEl.replaceChildren(...n); syncShare(); } };
    api.setBody(...[].concat(body || [])); api.setFooter(...[].concat(footer || []));
    setTimeout(syncShare, 0);
    return api;
  }

  // ---- Progress / cards ----
  function ProgressBar(tone, pct) { return h('div', { class: 'bar tone-' + tone, role: 'img', 'aria-label': D.formatPct(pct) }, h('i', { style: 'width:' + Math.max(0, Math.min(100, pct * 100)).toFixed(1) + '%' })); }
  function CategoryCard({ tone, name, value, unit = 'ج.م', pct, caption, sub, decimals = true, details }) {
    const card = h('div', { class: 'card cat-card tone-' + tone },
      h('div', { class: 'cat-top' }, h('span', { class: 't-h5' }, name), h('span', { class: 'dot' })),
      h('div', { class: 'cat-val' }, h('span', { class: 't-h3' }, num(decimals ? D.formatMoney(value) : String(value))), unit ? h('span', { class: 'unit' }, unit) : null),
      pct != null ? ProgressBar(tone, pct) : null,
      pct != null ? h('div', { class: 'bar-meta t-small' }, h('b', null, num(D.formatPct(pct))), h('span', null, caption)) : (sub ? h('div', { class: 't-small', style: 'color:var(--color-text-secondary)' }, sub) : null));
    if (details) card.append(h('button', { type: 'button', class: 'kpi-more kpi-details', 'aria-label': 'تفاصيل ' + name, 'data-details': name, onClick: () => DetailsModal(details, { label: name, value: decimals ? D.formatMoney(value) : String(value), unit }) }, 'التفاصيل', Icon('chevL', 'sm')));
    return card;
  }
  function InlineNote({ kind = '', children, action }) {
    return h('div', { class: 'note ' + kind, role: kind === 'error' ? 'alert' : 'status' }, h('span', null, children), action || null);
  }
  function EmptyState(title, text) { return h('div', { class: 'empty' }, h('div', { class: 't t-h5' }, title), h('div', { class: 's' }, text)); }
  function Tabs({ items, active, onChange }) {
    const list = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'أقسام الحسابات' });
    items.forEach((t) => list.append(h('button', { type: 'button', role: 'tab', class: 'tab', id: 'tab-' + t.id, 'aria-selected': String(t.id === active), 'aria-controls': 'panel', tabindex: t.id === active ? '0' : '-1', onClick: () => onChange(t.id) }, t.label)));
    list.addEventListener('keydown', (e) => {
      const i = items.findIndex((t) => t.id === active); let n = null;
      if (e.key === 'ArrowLeft') n = (i + 1) % items.length; // RTL: left = next
      if (e.key === 'ArrowRight') n = (i - 1 + items.length) % items.length;
      if (n != null) { e.preventDefault(); onChange(items[n].id, true); }
    });
    return list;
  }
  function Table({ cls, headers, rows, totalRow, caption }) {
    const t = h('table', { class: cls || '' }, caption ? h('caption', { class: 'sr', style: 'position:absolute;left:-9999px' }, caption) : null,
      h('thead', null, h('tr', null, headers.map((x) => h('th', { scope: 'col' }, x)))),
      h('tbody', null, rows.map((r) => h('tr', null, r.map((c, i) => h('td', { 'data-l': headers[i] || '' }, c))))),
      totalRow ? h('tfoot', null, h('tr', { class: 'total' }, totalRow.map((c, i) => h('td', { 'data-l': headers[i] || '' }, c)))) : null);
    return h('div', { class: 'scroll-x' }, t);
  }

  // ---- Reports components (Figma: KPI tile, Bar row, Chart card head, Freshness note) ----
  function KpiTile({ label, value, unit, note, compare, delta, details }) {
    // compare: 'off' | 'positive' | 'negative' | 'neutral'  (Figma property Compare)
    // details (owner, 22 Oct): spec or () => spec → «التفاصيل» opens DetailsModal with the data behind the number (Figma: KPI tile Link=true + Modal / KPI details).
    const tone = compare || 'off';
    const el = h('div', { class: 'card kpi kpi-' + tone, role: 'group', 'aria-label': label },
      h('div', { class: 'kpi-label t-label' }, label),
      h('div', { class: 'kpi-val' }, h('span', { class: 't-h3' }, num(value)), unit ? h('span', { class: 'unit t-small' }, unit) : null),
      tone !== 'off' && delta ? h('div', { class: 'kpi-delta' }, h('span', { class: 'pill' }, num(delta.text)), h('span', { class: 't-small' }, delta.caption)) : null,
      note ? h('div', { class: 't-small kpi-note' }, note) : null);
    if (details) el.append(h('button', { type: 'button', class: 'kpi-more kpi-details', 'aria-label': 'تفاصيل ' + label, 'data-details': label, onClick: (e) => { e.stopPropagation(); DetailsModal(details, { label, value, unit, note: typeof note === 'string' ? note : (el.querySelector('.kpi-note') || {}).textContent }); } }, 'التفاصيل', Icon('chevL', 'sm')));
    return el;
  }

  // ---- Share (owner, 22 Oct: every popup can be shared on WhatsApp or email) ----
  const toastMsg = (msg, kind) => { if (window.IBKit && window.IBKit.toast) window.IBKit.toast(msg, kind); };
  const waNum = (p) => { const d = String(p || '').replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660)).replace(/\D/g, ''); return d ? '20' + d.replace(/^0/, '').replace(/^20/, '') : ''; };
  async function shareVia(via, { title, text, el, phone, email }) {
    const href = via === 'whatsapp' ? 'https://wa.me/' + waNum(phone) + '?text=' + encodeURIComponent(text) : 'mailto:' + (email || '') + '?subject=' + encodeURIComponent(title) + '&body=' + encodeURIComponent(text);
    window.__lastShare = { via, href, text, title };
    let note = '';
    if (el) {
      try {
        if (!window.html2canvas) await new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); });
        const canvas = await window.html2canvas(el, { backgroundColor: getComputedStyle(document.body).backgroundColor, scale: 2 });
        const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
        try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); note = 'الصورة اتنسخت — الصقها في الرسالة.'; }
        catch (e) { const url = URL.createObjectURL(blob); const im = Modal({ title: 'صورة ' + title, share: false, body: [h('p', { class: 't-small' }, 'المتصفح ما سمحش بنسخ الصورة تلقائي — اضغط عليها بزر الماوس اليمين وانسخها أو احفظها.'), h('img', { class: 'share-img', src: url, alt: title })], footer: [Button({ type: 'primary', label: 'تمام', onClick: () => im.close() })] }); note = 'الصورة جاهزة في النافذة.'; }
      } catch (e) { note = 'اتبعت النص بس.'; }
    }
    const a = document.createElement('a'); a.href = href; a.target = '_blank'; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
    toastMsg('اتفتح ' + (via === 'whatsapp' ? 'واتساب' : 'الإيميل') + '. ' + note, 'success');
  }
  // ShareButton: «مشاركة» + menu (واتساب / إيميل). get() → { title, text, el, phone, email } at click time.
  function ShareButton({ get, primary = true, icon = false, label = 'مشاركة', disabled }) {
    const wrap = h('div', { class: 'pop-anchor share-anchor', 'data-popover-root': '', style: 'position:relative' });
    const trig = icon ? IconButton({ icon: 'share', label: 'مشاركة', attrs: { 'aria-haspopup': 'menu', 'data-share': '' } }) : Button({ type: primary ? 'primary' : 'default', label, disabled, attrs: { 'aria-haspopup': 'menu', 'data-share': '' } });
    const pop = popover(wrap, trig, (close) => h('div', { class: 'menu share-menu', role: 'menu', style: icon ? '' : 'top:auto;bottom:calc(100% + 4px)' },
      ...['whatsapp', 'email'].map((via) => { const g = get(); const who = via === 'whatsapp' ? g.phone : g.email;
        return h('button', { type: 'button', class: 'opt', role: 'menuitem', 'data-via': via, onClick: () => { close(); shareVia(via, get()); } }, Icon(via === 'whatsapp' ? 'whatsapp' : 'mail', 'sm'), (via === 'whatsapp' ? 'واتساب' : 'إيميل') + (who ? ' — ' + who : '')); })));
    trig.addEventListener('click', pop.toggle); wrap.append(trig); return wrap;
  }
  // text of any popup body: tables → rows, info rows → «label: value», else paragraphs
  function bodyShareText(title, body) {
    const DT = window.IbtekrDetails; const rows = []; const summary = [];
    body.querySelectorAll('.info-row').forEach((r) => { const c = [...r.children].map((x) => x.textContent.trim()).filter(Boolean); if (c.length >= 2) summary.push({ label: c[0], value: c.slice(1).join(' ') }); });
    body.querySelectorAll('table tbody tr').forEach((tr) => rows.push([...tr.cells].map((td) => td.textContent)));
    let sub = '';
    if (!rows.length && !summary.length) sub = (body.innerText || body.textContent || '').split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 30).join('\n');
    else { const p = body.querySelector('p'); if (p) sub = p.textContent; }
    return DT ? DT.detailsText({ title, sub, summary, rows }) : title + '\n' + sub;
  }

  // ---- Details popup (Figma: Modal / KPI details) ----
  function DetailsModal(details, tile) {
    const DT = window.IbtekrDetails; const s = DT.normalize(details, tile || {}); let m = null;
    const sum = s.summary.length ? h('div', { class: 'dt-sum' }, s.summary.map((x) => h('div', { class: 'dt-chip' }, h('span', { class: 't-small' }, x.label), h('b', null, num(String(x.value)))))) : null;
    const table = s.headers.length ? (s.rows.length ? h('div', { style: 'overflow-x:auto' }, h('table', { class: 'vlo-table dt-table' },
      h('thead', null, h('tr', null, s.headers.map((x) => h('th', { scope: 'col' }, x)))),
      h('tbody', null, s.rows.map((r, i) => { const tr = h('tr', s.onRow ? { class: 'dt-click', tabindex: '0', role: 'button' } : null, r.map((c, j) => h('td', { 'data-l': s.headers[j] || '', class: ((typeof c === 'string' && (c.length <= 16 || !/\s/.test(c))) || typeof c === 'number') ? 'nw' : null }, typeof c === 'string' || typeof c === 'number' ? num(String(c)) : c)));
        if (s.onRow) { const go = () => { m.close(); s.onRow(i); }; tr.addEventListener('click', go); tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); }); } return tr; }).concat(s.total ? [h('tr', { class: 'dt-total' }, s.total.map((c, j) => h('td', { 'data-l': j ? s.headers[j] || '' : '', class: c === '' ? 'dt-empty' : null }, typeof c === 'string' || typeof c === 'number' ? num(String(c)) : c)))] : [])))) : EmptyState('مفيش بيانات', s.empty)) : null;
    const body = h('div', { class: 'dt-body', style: 'display:flex;flex-direction:column;gap:12px' }, s.sub ? h('p', { class: 't-small', style: 'margin:0;color:var(--color-text-secondary)' }, num(s.sub)) : null, sum, table,
      s.note ? InlineNote({ children: s.note }) : null, s.source ? h('p', { class: 't-small dt-source', style: 'margin:0;color:var(--color-text-secondary)' }, 'المصدر: ' + s.source) : null);
    const plain = (c) => (c == null ? '' : typeof c === 'object' && c.textContent != null ? c.textContent : String(c));
    const share = ShareButton({ get: () => ({ title: s.title, text: details.shareText ? String(details.shareText) : DT.detailsText({ title: s.title, sub: s.sub, summary: s.summary.map((x) => ({ label: x.label, value: plain(x.value) })), rows: s.rows.map((r) => r.map(plain)), total: s.total && s.total.map(plain) }), el: m.el.querySelector('.modal-b'), phone: s.phone, email: s.email }) });
    m = Modal({ title: s.title, body, share: false, footer: [share].concat(s.actions.map((a) => Button({ label: a.label, onClick: () => { m.close(); a.onClick(); } })), [Button({ type: 'text', label: 'إغلاق', onClick: () => m.close() })]) });
    m.el.dataset.details = tile && tile.label || s.title; m.el.dataset.share = '1'; if (s.headers.length >= 4) m.el.classList.add('wide'); else if (s.headers.length) m.el.classList.add('mid');
    return m;
  }
  function BarRow({ tone, label, value, pct }) {
    return h('div', { class: 'bar-row tone-' + tone },
      h('span', { class: 'bar-row-label t-body' + (label === 'غير مؤكد' ? ' unconf' : '') }, label),
      ProgressBar(tone, pct),
      h('span', { class: 'bar-row-val t-label' }, num(value)));
  }
  function ChartCard({ title, subtitle, footnote, body }) {
    return h('section', { class: 'card chart-card' },
      h('div', { class: 'chart-head' }, h('h2', { class: 't-h4' }, title), subtitle ? h('span', { class: 't-small' }, subtitle) : null),
      h('div', { class: 'chart-body' }, body),
      footnote ? h('div', { class: 't-small chart-foot' }, footnote) : null);
  }
  const DELAY = { ok: ['غير متأخر', 'check'], risk: ['قابل للتأخير', 'clock'], late: ['متأخر', 'alert'] };
  function DelayBadge(state) { const [label, icon] = DELAY[state] || DELAY.ok; return h('span', { class: 'delay delay-' + state }, Icon(icon, 'sm'), label); }
  function FreshnessNote(text) { return h('div', { class: 'fresh t-small' }, Icon('clock', 'sm'), h('span', null, text)); }

  // ---- Tickets components (Figma: Textarea, Avatar, Ticket status, Priority tag, Timeline / Message, Timeline / Event, Reply box, Drawer) ----
  function Textarea({ id, label, required, value, error, placeholder, onInput, help, maxlength, rows = 3 }) {
    const ta = h('textarea', { id, rows, maxlength, placeholder, 'aria-invalid': error ? 'true' : false, 'aria-describedby': error ? id + '-err' : false, class: 'textarea' + (error ? ' err' : '') });
    ta.value = value || '';
    ta.addEventListener('input', () => onInput(ta.value));
    return FieldShell({ id, label, required, error, help }, ta);
  }
  function Avatar(name) { return h('span', { class: 'avatar sm', 'aria-hidden': 'true' }, (name || '؟').trim().charAt(0)); }
  const TICKET_STATUS = { open: 'مفتوح', in_progress: 'جاري العمل', waiting: 'بانتظار الرد', resolved: 'تم الحل', closed: 'مغلق' };
  const PRIORITY = { urgent: 'عاجل', high: 'عالي', normal: 'عادي', low: 'منخفض' };
  function TicketStatus(status) { return h('span', { class: 'tstatus ts-' + status }, TICKET_STATUS[status] || status); }
  function PriorityTag(p) { return h('span', { class: 'prio prio-' + p }, h('i', { 'aria-hidden': 'true' }), PRIORITY[p] || p); }
  function TimelineMessage({ author, role, time, text }) {
    return h('div', { class: 'tl-msg' }, Avatar(author),
      h('div', { class: 'bubble' }, h('div', { class: 'head' }, h('span', { class: 'who' }, h('span', { class: 't-label' }, author), h('span', { class: 'role' }, role)), h('span', { class: 't-small time' }, time)),
        h('div', { class: 't-body txt' }, text)));
  }
  function TimelineEvent({ text, time }) { return h('div', { class: 'tl-ev t-small' }, Icon('activity', 'sm'), h('span', null, text), h('span', { class: 'time' }, time)); }
  function ReplyBox({ onSend, disabled }) {
    const ta = h('textarea', { class: 'textarea', rows: 2, placeholder: 'اكتب تحديث للفريق… استخدم @ لذكر دور', 'aria-label': 'رد على التذكرة', disabled });
    const send = () => { const v = ta.value.trim(); if (!v) { ta.focus(); return; } onSend(v); ta.value = ''; };
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
    const btn = Button({ type: 'primary', label: 'إرسال', icon: 'send', disabled, onClick: send });
    return h('div', { class: 'reply' }, ta, h('div', { class: 'row' }, btn, h('span', { class: 't-small hint' }, IconButton({ icon: 'attach', label: 'إضافة مرفق (غير متاح في النموذج)', attrs: { disabled: true } }), 'Enter للإرسال · Shift+Enter سطر جديد')));
  }
  // Drawer: side sheet (role=dialog) with focus trap, Esc, scrim; same plumbing as Modal
  function Drawer({ label, onClose }) {
    const prev = document.activeElement;
    const close = () => { scrim.remove(); document.removeEventListener('keydown', keys, true); if (prev && prev.focus) prev.focus(); onClose && onClose(); };
    const panel = h('div', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': label });
    const scrim = h('div', { class: 'scrim drawer-scrim' }, panel);
    scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) close(); });
    const keys = (e) => {
      if (e.key === 'Escape' && !openClose) { e.preventDefault(); close(); }
      if (e.key === 'Tab') { const f = [...panel.querySelectorAll('button:not([disabled]),input,textarea,[tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null); if (!f.length) return; const i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); } }
    };
    document.addEventListener('keydown', keys, true);
    (modalRoot || document.body).append(scrim);
    return { el: panel, close, set(...n) { panel.replaceChildren(...n); } };
  }

  // ---- Vendors components (Figma: Vendor logo, Info row, Secure field, Contract card, Vendor status) ----
  function VendorLogo({ letter, size = 'md' }) { return h('span', { class: 'vlogo vlogo-' + size, 'aria-hidden': 'true' }, (letter || '؟').charAt(0)); }
  function VendorStatus(status) { return h('span', { class: 'vstatus vs-' + status }, status === 'active' ? 'نشط' : 'غير نشط'); }
  function InfoRow({ label, value, copy, onCopy }) {
    return h('div', { class: 'info-row' }, h('span', { class: 't-body lab' }, label),
      h('span', { class: 'val' }, h('span', { class: 't-body' }, value == null || value === '' ? '—' : value), copy && value ? IconButton({ icon: 'copy', label: 'نسخ ' + label, onClick: () => onCopy(value, label) }) : null));
  }
  // state: 'masked' | 'shown' | 'hidden' (no permission)
  function SecureField({ label, masked, value, state, onToggle, onCopy }) {
    const el = h('div', { class: 'secure' }, h('span', { class: 't-body lab' }, label),
      state === 'hidden' ? h('span', { class: 't-small', style: 'color:var(--color-text-secondary)' }, 'مخفي — متاح للأدمن ودور الحسابات فقط')
        : h('span', { class: 'val' }, h('span', { class: 't-body', dir: 'ltr' }, state === 'shown' ? value : masked),
          Button({ type: 'text', size: 'sm', label: state === 'shown' ? 'إخفاء' : 'إظهار', attrs: { 'aria-pressed': String(state === 'shown') }, onClick: onToggle }),
          IconButton({ icon: 'copy', label: 'نسخ ' + label, onClick: onCopy })));
    return el;
  }
  // status: 'missing' | 'uploaded' | 'expiring' | 'expired'
  function ContractCard({ status, title, sub, canManage, onView, onDownload, onUpload, onTemplate }) {
    const icon = status === 'missing' ? 'alert' : status === 'uploaded' ? 'check' : 'clock';
    const actions = status === 'missing' ? [canManage ? Button({ type: 'primary', size: 'sm', label: 'ارفع العقد الآن', onClick: onUpload }) : null, Button({ size: 'sm', label: 'تحميل القالب', onClick: onTemplate })]
      : [Button({ type: 'primary', size: 'sm', label: 'عرض', onClick: onView }), Button({ size: 'sm', label: 'تحميل', onClick: onDownload }), canManage ? Button({ type: 'text', size: 'sm', label: 'استبدال', onClick: onUpload }) : null];
    return h('div', { class: 'contract contract-' + status }, Icon(icon, 'sm'), h('div', { class: 'txt' }, h('div', { class: 't-label' }, title), h('div', { class: 't-small' }, sub)), h('div', { class: 'acts' }, actions));
  }

  window.IBUI = { h, num, Icon, Button, IconButton, ShareButton, DetailsModal, shareVia, popover, closePopover, DropdownMenu, Select, FieldShell, Calendar, shiftMonth, DateField, TextInput, Modal, CategoryCard, ProgressBar, KpiTile, BarRow, ChartCard, FreshnessNote, DelayBadge, Textarea, Avatar, VendorLogo, VendorStatus, InfoRow, SecureField, ContractCard, TicketStatus, PriorityTag, TimelineMessage, TimelineEvent, ReplyBox, Drawer, TICKET_STATUS, PRIORITY, InlineNote, EmptyState, Tabs, Table, setModalRoot: (n) => { modalRoot = n; } };
})();

