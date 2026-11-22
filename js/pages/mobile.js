/* The phone and tablet pass (21 Nov) — the part a stylesheet alone cannot reach. Look and touch only: nothing here changes what
   a page shows or does.
   · The orders page keeps its own styles inside a shadow root, where css/mobile.css does not apply — its phone and tablet rules
     are added here, as one more <style> after the page's own (logical properties throughout, so they read the same in both
     directions). */
(function () {
  'use strict';
  var ORDERS_CSS = [
    /* under a banner on top of the page (the demo's), a popup starts below it */
    '#cscrim,#uscrim{top:var(--dm-h,0px)}',
    /* ---- touch basics ---- */
    '@media (pointer:coarse){button,a,label,select,summary{touch-action:manipulation}.btn,.ibtn,.sc,.ocb,.car-b{transition:transform .12s cubic-bezier(.2,.8,.2,1),background-color .12s cubic-bezier(.2,.8,.2,1)}.btn:active,.ibtn:active,.sc:active,.car-b:active{transform:scale(.97)}}',
    '@media (pointer:coarse) and (prefers-reduced-motion:reduce){.btn,.ibtn,.sc,.ocb,.car-b{transition:none}.btn:active,.ibtn:active,.sc:active,.car-b:active{transform:none}}',
    /* ---- phone ---- */
    '@media (max-width:767px){',
    /* the head: the title and the sync on one line, then sort · filter · files as three equal buttons */
    '.ph{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;align-items:center}',
    '.ph .tb{grid-column:1 / span 3;min-width:0}.ph h1{font-size:22px;line-height:32px;font-weight:700}',
    '.ph #sync{grid-column:4 / span 3;grid-row:1;min-width:0;padding-inline:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.ph .btn,.ph .dd.btn{grid-column:span 2;min-width:0;padding-inline:6px;gap:4px;font-size:13px}.ph .btn span,.ph .dd.btn span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.ph small,small{font-size:12px}',
    /* a field you type in: 16px, so the phone does not zoom the page */
    'input,select,textarea{font-size:16px!important}',
    /* small controls: a 44px tap area without growing what you see */
    '.ocb,.ibtn{position:relative}.ocb::after,.ibtn::after{content:"";position:absolute;left:50%;top:50%;width:max(100%,44px);height:max(100%,44px);transform:translate(-50%,-50%)}',
    '.oh.m .ibtn[data-more],.scard .ibtn[data-more]{width:40px}.ocb{width:24px;height:24px;flex-basis:24px;border-radius:6px}.ocb svg{width:16px;height:16px}',
    '.card{border-radius:12px}.toolbar{border-radius:12px}',
    /* the customer's details: «label … value» on one line each, not a tall column */
    '.sec.cust .crow{gap:0}.sec.cust .inf2{flex-direction:row;align-items:center;justify-content:space-between;gap:12px;min-height:40px;padding-block:6px;border-bottom:1px solid rgba(255,247,239,.14)}',
    '.sec.cust .inf2 small{flex:none}.sec.cust .inf2 b{flex:0 1 auto;min-width:0;justify-content:flex-end;text-align:end}',
    '.sec.cust .inf2.adr{flex-direction:column;align-items:stretch;gap:2px;border-bottom:0}.sec.cust .inf2.adr b{text-align:start}',
    /* a row's ⋮ menu: up from the bottom, by the thumb (the page places it with inline styles) */
    '#mpop{position:fixed!important;top:auto!important;left:0!important;right:0!important;bottom:0!important;width:auto!important;max-width:none!important;min-width:0;max-height:min(80vh,80dvh)!important;overflow-y:auto;overscroll-behavior:contain;border:0;border-radius:20px 20px 0 0;padding:6px 12px calc(12px + env(safe-area-inset-bottom,0px));box-shadow:0 -8px 32px rgba(46,42,27,.24),0 0 0 100vmax rgba(46,42,27,.38);animation:m-up .22s cubic-bezier(.2,.8,.2,1)}',
    '#mpop::before{content:"";display:block;flex:none;width:36px;height:4px;border-radius:2px;background:var(--bd);opacity:.45;margin:4px auto 8px}',
    '#mpop button,#mpop a{min-height:48px;padding-inline:12px;border-radius:10px;font-size:15px}',
    /* a date («تاريخ التأكيد», «تاريخ التبليغ»): a sheet from the bottom, the week across the screen, days of 46px */
    '#dpop{position:fixed!important;top:auto!important;left:0!important;right:0!important;bottom:0!important;width:auto!important;z-index:90;animation:m-up .22s cubic-bezier(.2,.8,.2,1)}',
    '#dpop .dp{width:auto;border:0;border-radius:20px 20px 0 0;padding:8px 16px calc(16px + env(safe-area-inset-bottom,0px));box-shadow:0 -8px 32px rgba(46,42,27,.24),0 0 0 100vmax rgba(46,42,27,.38)}',
    '#dpop .dp::before{content:"";display:block;width:36px;height:4px;border-radius:2px;background:var(--bd);opacity:.45;margin:4px auto 8px}',
    '#dpop .hd{height:48px}#dpop .hd button{min-width:44px;min-height:44px}#dpop .hd,#dpop .hd *{font-size:16px}',
    '#dpop .g{grid-template-columns:repeat(7,minmax(0,1fr));width:auto}#dpop .wd{width:auto;font-size:12px}#dpop .d{width:100%;height:46px;font-size:16px}',
    '#dpop .ft{padding-top:12px}#dpop .ft .btn{min-height:48px;padding-inline:20px;font-size:15px}',
    /* «تعديل الأوردر»: its three tabs on one line, each a full target */
    '#cdlg .dtabs{overflow-x:auto;scrollbar-width:none}#cdlg .dtabs::-webkit-scrollbar{display:none}#cdlg .dtabs .tab{flex:1 0 auto;white-space:nowrap;padding-inline:12px;font-size:14px}',
    '#cdlg{border-radius:16px!important}#cdlg .cf .btn{min-height:48px;font-size:15px;font-weight:600;border-radius:10px}',
    /* the filter: a screen of its own — its title on top, «تطبيق الفلتر» always at the bottom, everything between scrolls */
    '.fb{position:fixed!important;top:var(--dm-h,0px)!important;left:0!important;right:0!important;bottom:0!important;width:auto!important;max-width:none!important;max-height:none!important;height:auto;border:0;border-radius:0;box-shadow:none;padding:0 16px;gap:16px;overflow-y:auto;overscroll-behavior:contain;animation:m-up .22s cubic-bezier(.2,.8,.2,1)}',
    '.fb h3{position:sticky;top:0;z-index:3;flex:none;margin:0 -16px;padding:0 16px;min-height:56px;font-size:18px;line-height:28px;font-weight:700;background:var(--bg-base);border-bottom:1px solid var(--bd-sub)}',
    '.fb h3 svg{width:20px;height:20px}',
    /* «اوصف إزاي تفلتر»: one field with its button inside */
    '.fb .ai{min-height:52px;padding:4px 6px 4px 12px;padding-inline:12px 6px;border-radius:12px;gap:8px}',
    '.fb .ai input{min-width:0;height:44px;text-overflow:ellipsis}',
    '.fb .ai .go{flex:none;min-height:44px;padding:0 12px;border-radius:10px;font-size:14px;background:var(--brand);color:var(--bg-base)}.fb .ai .go[disabled]{background:transparent;color:var(--brand)}',
    /* a group's name, then its chips — each a 40px target with air around it */
    '.fb .qf{gap:8px}.fb .qf .qt{font-size:13px;font-weight:700;color:var(--tx)}.fb .qf .qt small{font-size:12px;font-weight:400;color:var(--tx2)}',
    '.fb .qc{min-height:40px;padding-inline:14px;font-size:14px}.fb .qc.sv button{min-height:40px}.fb .qc.sv .x{min-width:36px;justify-content:center}.fb .qc.sv .x svg{width:14px;height:14px}',
    '.fb .qc.on{background:var(--brand);border-color:var(--brand);color:var(--bg-base)}',
    '.fb .svf{flex-wrap:wrap}.fb .svf input{flex:1 1 100%;height:48px}.fb .svf .btn{flex:1;min-height:44px}',
    '.fb .lead{font-size:13px;font-weight:700;color:var(--tx);padding-top:16px;border-top:1px solid var(--bd-sub)}',
    /* a condition: a card — «حيث / و / أو» and its ✕ on top, the field and the comparison side by side, the value under them */
    '.fb .fr{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) 40px;gap:8px;align-items:center;padding:12px;border:1px solid var(--bd-sub);border-radius:12px;background:var(--bg-container)}',
    '.fb .fr>.w,.fb .fr>.conj{grid-column:1 / span 2;grid-row:1;width:auto;justify-self:start;text-align:start;font-weight:600}.fb .fr>.conj{min-width:104px}',
    '.fb .fr>[data-fbx],.fb .fr>.ibtn{grid-column:3;grid-row:1;justify-self:end;width:40px;height:40px;border:0;background:transparent}',
    '.fb .fr>.fld{grid-column:1;grid-row:2;width:auto;flex:none}.fb .fr>.opr{grid-column:2 / span 2;grid-row:2;width:auto;flex:none}.fb .fr>.val{grid-column:1 / -1;grid-row:3;width:auto;flex:none}',
    '.fb .fr>.grp{grid-column:1 / -1;grid-row:2;padding:8px;gap:8px;border-radius:10px;background:var(--bg-base)}.fb .grp .fr{background:var(--bg-container)}',
    '.fb select.sel2,.fb input.sel2,.fb .fld,.fb .opr,.fb .val{height:48px;min-height:48px;border-radius:10px;padding-inline:12px;min-width:0;max-width:100%}',
    /* «+ إضافة شرط» and «+ إضافة مجموعة شروط»: two real buttons; «مسح كل الشروط» quiet, on its own line */
    '.fb .acts{display:grid;grid-template-columns:1fr 1fr;gap:8px}.fb .acts .sp{display:none}',
    '.fb .acts .lnk{min-height:48px;justify-content:center;padding:0 8px;border:1px solid var(--brand);border-radius:10px;font-size:14px;text-align:center}.fb .acts .lnk:hover{text-decoration:none}',
    '.fb .acts [data-fbclear]{grid-column:1 / -1;border-color:transparent;color:var(--err-text);min-height:44px}',
    '.fb .lnk[data-svnew]{min-height:40px}',
    /* the footer: always on screen, the main button across it */
    '.fb .ft{position:sticky;bottom:0;z-index:3;flex:none;margin:auto -16px 0;padding:12px 16px calc(12px + env(safe-area-inset-bottom,0px));gap:8px;background:var(--bg-base);border-top:1px solid var(--bd-sub);box-shadow:0 -6px 16px rgba(46,42,27,.08)}',
    '.fb .ft .btn{height:52px;min-height:52px;border-radius:12px;font-size:16px;font-weight:700;padding-inline:20px}.fb .ft .btn.pri{flex:1 1 auto;justify-content:center}.fb .ft .btn:not(.pri){flex:0 0 auto;min-width:96px;justify-content:center}',
    '}',
    '@keyframes m-up{from{transform:translateY(24px);opacity:0}to{transform:none;opacity:1}}',
    '@media (prefers-reduced-motion:reduce){#mpop,.fb,#dpop{animation:none}}',
    /* ---- the chips of the filters in force (phone, tablet, any touch screen): one line that slides under the finger — picking
       five filters no longer pushes the orders five lines down. «مسح الفلاتر» is the line's first button. ---- */
    '@media (max-width:1023px),(pointer:coarse){',
    '.afc-row{flex-wrap:nowrap;gap:8px;overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain;scrollbar-width:none;scroll-snap-type:x proximity;margin-inline:-12px;padding-inline:12px;scroll-padding-inline:12px}',
    '.afc-row::-webkit-scrollbar{display:none}',
    /* a keyboard up (--m-kb-* are set only then, below): the dialog fits the part of the screen still in sight; and a
       scroll inside a popup never runs on into the page */
    '#cscrim,#uscrim{top:var(--m-kb-top,var(--dm-h,0px));height:var(--m-kb-h,auto)}',
    '#cdlg,#udlg{max-height:min(80vh,calc(var(--m-kb-h,100vh) - 16px))!important;max-height:min(80dvh,calc(var(--m-kb-h,100dvh) - 16px))!important}',
    '#cscrim,#uscrim,#cdlg,#udlg,#mpop,#dpop,.fb{overscroll-behavior:contain}',
    '.afc{flex:none;flex-wrap:nowrap;gap:8px;padding-top:0}',
    '.afc-chip{flex:none;max-width:min(78vw,340px);scroll-snap-align:start}.afc-op{flex:none}',
    '.afc-n{flex:none;padding-inline:4px}',
    /* «مسح الفلاتر» is the line's first button, the chips after it (the owner 22 Nov) — not pinned over them at its end */
    '.afc-row>.btn{flex:none;order:-1;position:static;scroll-snap-align:start;min-height:44px;padding-inline:14px;margin:0;background:var(--bg-base);box-shadow:0 0 0 1px var(--bd-sub);border-radius:999px}',
    '}',
    /* ---- a touch screen of any width: nothing you tap is under 40px ---- */
    '@media (min-width:768px) and (pointer:coarse){#dpop{width:340px!important}#dpop .dp{width:auto}#dpop .g{grid-template-columns:repeat(7,44px);justify-content:space-between;width:auto}#dpop .wd{width:44px}#dpop .d{width:44px;height:44px;font-size:15px}#dpop .hd button{min-width:40px;min-height:40px}.ibtn{width:40px;height:40px}.sdd{height:40px;max-height:40px}[data-sc],.sc{height:40px}.in,.sel,.sel2,.btn,.dd.btn{min-height:40px}.ocb{position:relative;width:24px;height:24px;flex-basis:24px}.ocb::after{content:"";position:absolute;left:50%;top:50%;width:44px;height:44px;transform:translate(-50%,-50%)}.car-b{width:44px;height:44px}}'
  ].join('');

  function dress(host) {
    var root = host && host.shadowRoot; if (!root || root.querySelector('style[data-mobile]')) return;
    var st = document.createElement('style'); st.setAttribute('data-mobile', ''); st.textContent = ORDERS_CSS; root.appendChild(st);
    quietFocus(root);
  }
  /* On a touch screen a field that takes the focus by itself throws the keyboard over half the page. The filter focuses its
     «اوصف إزاي تفلتر» box as it opens — fine with a keyboard on the desk, in the way on a phone. So there, a focus the member
     did not ask for with a finger is given back; a tap on the field works as always. */
  function quietFocus(root) {
    var touched = 0; var coarse = window.matchMedia ? window.matchMedia('(pointer:coarse)') : null;
    root.addEventListener('pointerdown', function (e) { if (e.target && e.target.id === 'fbai') touched = Date.now(); }, true);
    root.addEventListener('focusin', function (e) {
      var t = e.target; if (!t || t.id !== 'fbai' || !coarse || !coarse.matches) return;
      if (Date.now() - touched < 800) return;
      t.blur();
    }, true);
  }
  function look() { var h = document.getElementById('orders'); if (h) dress(h); return !!(h && h.shadowRoot && h.shadowRoot.querySelector('style[data-mobile]')); }
  function start() {
    if (look()) return;
    var mo = new MutationObserver(function () { if (look()) mo.disconnect(); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('ib:orders-ready', look);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  /* · The header on a phone or a tablet (the owner 21 Nov): «إجراءات سريعة» and «ابدأ الدوام» live in the account's menu, not
     in the bar — the bar keeps the search, the assistant, the bell and the account. The two buttons stay where the shell drew
     them (out of sight, css/mobile.css), and each row added to the menu presses its button: the same code runs, the same
     popups open. On a desktop nothing is added. */
  var narrow = window.matchMedia ? window.matchMedia('(max-width:1023px)') : null;
  function pressEscape() { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); }
  function row(icon, label, attr, run, off) {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'opt m-moved'; b.setAttribute('role', 'menuitem'); b.setAttribute(attr, ''); if (off) b.disabled = true;
    if (icon) b.appendChild(icon.cloneNode(true));
    var t = document.createElement('span'); t.textContent = label; b.appendChild(t);
    b.addEventListener('click', function () { pressEscape(); setTimeout(run, 60); });
    return b;
  }
  function clockState() {
    var start = document.querySelector('.topbar .clock-widget > .btn'); var run = document.querySelector('.topbar .clock-widget .clock');
    if (run) { var lbl = run.querySelector('.lbl'); var num = run.querySelector('.num'); return { el: run, text: (lbl ? lbl.textContent : '') + (num && num.textContent ? ' · ' + num.textContent : ''), icon: null, off: false }; }
    if (start) return { el: start, text: start.getAttribute('aria-label') || start.textContent, icon: start.querySelector('svg'), off: start.disabled };
    return null;
  }
  function fillAccount(menu) {
    // every width (the owner 22 Nov — the account menu, redrawn): the member's own picture heads the menu, beside the name
    var hd = menu.querySelector('.acct-h'); var av = document.querySelector('.topbar .user-btn .avatar');
    if (hd && av && !hd.querySelector('.m-av')) { var pic = av.cloneNode(true); pic.classList.add('m-av'); pic.setAttribute('aria-hidden', 'true'); hd.insertBefore(pic, hd.firstChild); }
    if (!narrow || !narrow.matches || menu.querySelector('.m-moved')) return;
    var head = menu.querySelector('.acct-h'); var first = menu.querySelector('.opt'); if (!first) return;
    var frag = document.createDocumentFragment();
    var c = clockState();
    if (c) { var cb = row(c.icon, c.text, 'data-m-clock', function () { var now = clockState(); if (now && now.el) now.el.click(); }, c.off); cb.classList.add('m-clock'); if (!c.icon) { var dot = document.createElement('i'); dot.className = 'm-dot'; cb.insertBefore(dot, cb.firstChild); } frag.appendChild(cb);
      var tick = setInterval(function () { if (!cb.isConnected) { clearInterval(tick); return; } var n = clockState(); if (n) cb.lastChild.textContent = n.text; }, 1000); }
    var qa = document.querySelector('.topbar .qa-anchor > .btn');
    if (qa) { var ql = qa.querySelector('.qa-lbl'); frag.appendChild(row(qa.querySelector('svg'), (ql && ql.textContent) || qa.getAttribute('aria-label') || '', 'data-m-quick', function () { qa.click(); })); }
    if (!frag.childNodes.length) return;
    var sep = document.createElement('div'); sep.className = 'm-sep'; sep.setAttribute('role', 'separator'); frag.appendChild(sep);
    menu.insertBefore(frag, head ? head.nextSibling : first);
  }
  function watchAccount() {
    new MutationObserver(function (list) {
      for (var i = 0; i < list.length; i++) for (var j = 0; j < list[i].addedNodes.length; j++) { var n = list[i].addedNodes[j]; if (n.nodeType === 1 && n.classList && n.classList.contains('acct') && n.classList.contains('menu')) fillAccount(n); }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchAccount); else watchAccount();

  /* · The keyboard (the owner 21 Nov, an iPhone): a phone's keyboard does not shrink the page — it covers it, and the browser
     slides the page up under it, so anything pinned to the screen (the assistant, the bottom bar) ends up half off the top or
     floating in the middle. The part of the screen still in sight is the visual viewport: its top and height go to
     --m-vv-top / --m-vv-h (under the demo's banner while that is in sight), and html.m-kb says a keyboard is up
     (css/mobile.css §32). Zoomed in with two fingers nothing is set — the sheet falls back to the screen's own height. */
  var vv = window.visualViewport; var rootEl = document.documentElement; var tall = 0; var wide = 0;
  function typing() { var a = document.activeElement; while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
    return !!a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && !/^(checkbox|radio|button|submit|range|file|color)$/.test(a.type || '')); }
  function fit() {
    if (!vv) return;
    if (vv.scale > 1.05) { rootEl.style.removeProperty('--m-vv-top'); rootEl.style.removeProperty('--m-vv-h'); rootEl.style.removeProperty('--m-kb-top'); rootEl.style.removeProperty('--m-kb-h'); rootEl.classList.remove('m-kb'); return; }
    if (Math.abs(vv.width - wide) > 1) { wide = vv.width; tall = 0; } // turned on its side: a new «full height»
    tall = Math.max(tall, vv.height, window.innerHeight || 0);
    var up = tall - vv.height > 120 && typing();
    var bar = parseFloat(getComputedStyle(rootEl).getPropertyValue('--dm-h')) || 0;
    var top = Math.max(vv.offsetTop, bar);
    rootEl.style.setProperty('--m-vv-top', Math.round(top) + 'px');
    rootEl.style.setProperty('--m-vv-h', Math.max(240, Math.round(vv.height - (top - vv.offsetTop))) + 'px');
    rootEl.classList.toggle('m-kb', up);
    if (up) { rootEl.style.setProperty('--m-kb-top', Math.round(top) + 'px'); rootEl.style.setProperty('--m-kb-h', Math.max(240, Math.round(vv.height - (top - vv.offsetTop))) + 'px'); } else { rootEl.style.removeProperty('--m-kb-top'); rootEl.style.removeProperty('--m-kb-h'); }
  }
  if (vv) { vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); window.addEventListener('resize', fit);
    document.addEventListener('focusin', function () { setTimeout(fit, 60); setTimeout(fit, 400); }, true); document.addEventListener('focusout', function () { setTimeout(fit, 120); }, true);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fit); else fit(); window.addEventListener('load', fit); }
  /* · Nothing moves behind an open popup (the owner 21 Nov — «لو فيه بوباب مفتوح و عملت سكرول بلاقي الصفحة اللي وراه بيتعملها
     سكرول»): with fingers, while a popup, a drawer, a sheet, a menu or a calendar is open — the kit's or the orders page's —
     a drag scrolls only what is inside it. A drag that starts on the page behind, or on a part of the popup with nothing
     left to scroll that way, goes nowhere (so the scroll never runs on into the page). And a tap on the dimmed page behind
     a bottom sheet closes the sheet, as before, without also pressing whatever was under the finger. A mouse on a desk is
     not touched by any of this. */
  var hands = window.matchMedia ? window.matchMedia('(max-width:1023px),(pointer:coarse)') : null;
  var ORDERS_POPS = '#cscrim,#uscrim,#mpop,#dpop,.fb';
  function shown(el) { return !!el && !el.hidden && el.getClientRects().length > 0; }
  function pinned(el) { var p = getComputedStyle(el).position; return p === 'fixed' || p === 'absolute'; }
  // the kit's popover: the popup is the last child of its [data-popover-root] anchor, beside the trigger that opened it
  function kitPopups() {
    var out = []; var list = document.querySelectorAll('[data-popover-root] [aria-expanded="true"]'); var i;
    for (i = 0; i < list.length; i++) { var a = list[i].closest('[data-popover-root]'); var el = a && a.lastElementChild;
      if (el && el !== list[i] && !el.contains(list[i]) && shown(el) && pinned(el) && out.indexOf(el) < 0) out.push(el); }
    var moved = document.querySelectorAll('[data-m-portal]>*'); // … and the ones lifted out of a sliding box (below)
    for (i = 0; i < moved.length; i++) if (shown(moved[i]) && out.indexOf(moved[i]) < 0) out.push(moved[i]);
    return out;
  }
  /* · A popup is never left inside a box that scrolls (the owner 21 Nov, an iPhone — «بوب اب اختيار التاريخ بايظ خالص في
     الموبايل»): the kit hangs a popup beside the button that opened it and pins it to the screen. Safari on a phone pins it
     to the nearest box that scrolls instead — the head's sliding row of actions, a table, a popup's body — and cuts it at
     that box's edge: the period's calendar showed as one strip of days inside the toolbar. So on a touch screen a popup
     opened inside such a box is lifted, as it opens, to just outside the outermost one — still in its page, in a holder
     with the anchor's own classes, so its look and the kit's «a press outside closes it» hold — and the holder goes when
     the popup does. The kit never looks for a popup through its anchor, only through the element itself. */
  // the outermost box that scrolls or cuts, up to the page (<main>) or the popup's backdrop — never past them, so a popup
  // keeps its page's look. A box that only cuts («overflow:hidden») counts once one that scrolls was met: lifting out of the
  // scrolling body of a popup must not leave the list inside the popup's own clipped frame.
  function outerScroller(el) {
    var top = null; var scrolls = false;
    for (var a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      if (a.tagName === 'MAIN' || (a.classList && a.classList.contains('scrim'))) break;
      var cs = getComputedStyle(a); var o = cs.overflowX + ' ' + cs.overflowY;
      if (/(auto|scroll)/.test(o)) { top = a; scrolls = true; } else if (scrolls && /(hidden|clip)/.test(o)) top = a; }
    return scrolls ? top : null;
  }
  function lift(el) {
    var anchor = el.parentElement; if (!anchor || !anchor.hasAttribute('data-popover-root') || anchor.hasAttribute('data-m-portal')) return;
    if (el.hasAttribute('aria-haspopup') || el.hasAttribute('aria-expanded') || !pinned(el)) return; // the button itself, or something drawn in the row
    var box = outerScroller(el); if (!box || !box.parentElement) return;
    var had = document.activeElement && el.contains(document.activeElement) ? document.activeElement : null;
    var holder = document.createElement('div'); holder.className = anchor.className; holder.setAttribute('data-popover-root', ''); holder.setAttribute('data-m-portal', ''); holder.style.display = 'contents';
    box.parentElement.appendChild(holder); holder.appendChild(el);
    if (had && had.isConnected) { try { had.focus({ preventScroll: true }); } catch (e) { had.focus(); } }
    window.dispatchEvent(new Event('resize')); // the kit places it again where it now is
  }
  // the period picker's ready periods are one sliding line on a phone (css §19): the one in force is brought into sight
  var chipWas = null;
  function chipInView() {
    var line = document.querySelector('.dp.range .presets'); if (!line) { chipWas = null; return; }
    var on = line.querySelector('.radio[aria-checked="true"]'); if (!on || on === chipWas || line.scrollWidth <= line.clientWidth + 1) return;
    chipWas = on; var l = line.getBoundingClientRect(); var r = on.getBoundingClientRect(); line.scrollLeft += (r.left + r.width / 2) - (l.left + l.width / 2);
  }
  var fingers = window.matchMedia ? window.matchMedia('(pointer:coarse)') : null;
  function liftWatch() {
    new MutationObserver(function (list) {
      if (!fingers || !fingers.matches) return;
      for (var i = 0; i < list.length; i++) { var m = list[i]; var j;
        for (j = 0; j < m.addedNodes.length; j++) { var n = m.addedNodes[j]; if (n.nodeType === 1 && n.parentElement && n.parentElement.hasAttribute('data-popover-root')) lift(n); }
        if (m.removedNodes.length && m.target.nodeType === 1 && m.target.hasAttribute('data-m-portal') && !m.target.firstElementChild) m.target.remove(); }
      chipInView();
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', liftWatch); else liftWatch();
  function ordersPopups() { var h = document.getElementById('orders'); var r = h && h.shadowRoot; var out = []; if (!r) return out;
    var list = r.querySelectorAll(ORDERS_POPS); for (var i = 0; i < list.length; i++) if (shown(list[i])) out.push(list[i]); return out; }
  function openPopups() {
    var out = kitPopups().concat(ordersPopups()); var phone = window.innerWidth <= 767; var i;
    var list = document.querySelectorAll('.scrim' + (phone ? ',.ai-panel,.cs-inbox.show-chat .cs-chat' : '')); // on a phone the assistant is a page of its own (css §32); on a tablet it is the desktop's box and the page stays free
    for (i = 0; i < list.length; i++) if (shown(list[i])) out.push(list[i]);
    return out;
  }
  function isSheet(el) { var r = el.getBoundingClientRect(); return getComputedStyle(el).position === 'fixed' && r.width >= window.innerWidth - 2 && r.bottom >= window.innerHeight - 2; }
  var drag = null; // this finger's drag: where it began and what it may scroll
  function dragStart(e) {
    drag = null; if (!hands || !hands.matches || !e.touches || e.touches.length !== 1) return;
    var pops = openPopups(); if (!pops.length) return;
    var path = e.composedPath ? e.composedPath() : []; var may = []; var inside = false;
    for (var i = 0; i < path.length; i++) { var n = path[i]; if (!n || n.nodeType !== 1) continue;
      var cs = getComputedStyle(n);
      if (/(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 1) may.push([n, 'y']);
      if (/(auto|scroll)/.test(cs.overflowX) && n.scrollWidth > n.clientWidth + 1) may.push([n, 'x']);
      if (pops.indexOf(n) >= 0) { inside = true; break; }
      if (n === document.body) break; }
    // a finger on the dimmed page behind a bottom sheet: the tap closes the sheet and stops there (dragEnd)
    var t = e.target; var behind = false;
    if (!inside && t && t.closest && !t.closest('[data-popover-root]') && !t.closest('#demo-bar')) { var kit = kitPopups(); for (var k = 0; k < kit.length; k++) if (isSheet(kit[k])) behind = true; }
    drag = { x: e.touches[0].clientX, y: e.touches[0].clientY, may: inside ? may : [], behind: behind, moved: false };
  }
  function dragMove(e) {
    if (!drag || !e.touches || e.touches.length !== 1) return;
    var dx = e.touches[0].clientX - drag.x; var dy = e.touches[0].clientY - drag.y; var flat = Math.abs(dx) > Math.abs(dy);
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) drag.moved = true;
    /* A finger is never still: a tap comes with a move of a few pixels. Safari takes a move whose default was called off as
       «this was not a tap» and drops the click — a tick in a filter needed several presses (the owner 22 Nov). So a move is
       held back only once it is a drag (8px — the page itself does not start to scroll before 10). */
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
    if (!e.cancelable) return;
    for (var i = 0; i < drag.may.length; i++) { var n = drag.may[i][0];
      if (drag.may[i][1] === 'x') { if (flat) return; continue; }
      if (flat) continue;
      if (dy > 0 && n.scrollTop > 0) return;
      if (dy < 0 && n.scrollTop + n.clientHeight < n.scrollHeight - 1) return; }
    e.preventDefault();
  }
  document.addEventListener('touchstart', dragStart, { capture: true, passive: true });
  document.addEventListener('touchmove', dragMove, { capture: true, passive: false });
  /* The kit closes its popovers on a mousedown outside them; a finger's mousedown comes with the click, on whatever is under
     it. So for a tap behind a sheet the browser's own mousedown / focus / click are called off, and the kit is told. */
  function dragEnd(e) {
    var d = drag; drag = null; if (!d || !d.behind || d.moved || !e.cancelable) return;
    e.preventDefault(); document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  }
  document.addEventListener('touchend', dragEnd, { capture: true, passive: false });
  // a wheel or a trackpad on a tablet: the same rule
  document.addEventListener('wheel', function (e) {
    if (!window.matchMedia || !window.matchMedia('(pointer:coarse)').matches || !e.cancelable || e.ctrlKey) return; var pops = openPopups(); if (!pops.length) return;
    var path = e.composedPath ? e.composedPath() : []; var flat = Math.abs(e.deltaX) > Math.abs(e.deltaY);
    for (var i = 0; i < path.length; i++) { var n = path[i]; if (!n || n.nodeType !== 1) continue; var cs = getComputedStyle(n);
      if (flat && /(auto|scroll)/.test(cs.overflowX) && n.scrollWidth > n.clientWidth + 1) return;
      if (!flat && /(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 1 && (e.deltaY < 0 ? n.scrollTop > 0 : n.scrollTop + n.clientHeight < n.scrollHeight - 1)) return;
      if (pops.indexOf(n) >= 0 || n === document.body) break; }
    e.preventDefault();
  }, { capture: true, passive: false });
  document.addEventListener('touchcancel', function () { drag = null; }, { capture: true, passive: true });
  /* · The floating main action lives on the page itself (css §35 — on an iPhone a pinned button inside a sliding row is drawn
     under the cards further down the page). On a touch phone a button of ours on <body> carries the open page's main
     action: its icon and words (copied as they are, so the English layer's words too), its «disabled», and a tap on it
     presses the real one — the same code runs. It follows the page as it is drawn again, changes tab or language. */
  var fabOn = window.matchMedia ? window.matchMedia('(max-width:767px) and (pointer:coarse)') : null;
  var fab = null; var fabSrc = null; var fabSig = ''; var fabTick = 0;
  function fabSource() {
    var list = document.querySelectorAll('main:not([hidden]) .page-head .actions>.btn.btn-brand');
    for (var i = 0; i < list.length; i++) { var row = list[i].parentElement; if (row && row.getClientRects().length) return list[i]; }
    return null;
  }
  function fabSync() {
    fabTick = 0; var on = !!(fabOn && fabOn.matches); if (rootEl.classList.contains('m-fab-on') !== on) rootEl.classList.toggle('m-fab-on', on);
    var src = on ? fabSource() : null;
    if (!src) { fabSrc = null; fabSig = ''; if (fab && !fab.hidden) fab.hidden = true; return; }
    if (!fab) { fab = document.createElement('button'); fab.type = 'button'; fab.className = 'btn btn-brand m-fab'; fab.setAttribute('data-m-fab', '');
      fab.addEventListener('click', function () { if (fabSrc && fabSrc.isConnected && !fabSrc.disabled) fabSrc.click(); }); document.body.appendChild(fab); }
    var sig = src.textContent + '|' + src.disabled + '|' + (src.getAttribute('aria-label') || '') + '|' + src.childNodes.length;
    if (src !== fabSrc || sig !== fabSig) { fabSrc = src; fabSig = sig;
      var kids = []; for (var k = 0; k < src.childNodes.length; k++) kids.push(src.childNodes[k].cloneNode(true)); fab.replaceChildren.apply(fab, kids);
      fab.disabled = src.disabled; var al = src.getAttribute('aria-label'); if (al) fab.setAttribute('aria-label', al); else fab.removeAttribute('aria-label'); }
    if (fab.hidden) fab.hidden = false;
  }
  function fabSoon() { if (!fabTick) fabTick = requestAnimationFrame(fabSync); }
  function fabWatch() {
    new MutationObserver(function (list) { for (var i = 0; i < list.length; i++) { var t = list[i].target; if (fab && (t === fab || fab.contains(t))) continue; fabSoon(); return; } })
      .observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'disabled'] });
    window.addEventListener('hashchange', fabSoon); window.addEventListener('resize', fabSoon); if (fabOn && fabOn.addEventListener) fabOn.addEventListener('change', fabSoon);
    fabSync();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fabWatch); else fabWatch();

  /* · A calendar's days under a finger (the owner 22 Nov, an iPhone — «التاتش في الكاليندر مش مظبوط»): while a period's end is
     being picked the calendar draws the period up to the day the mouse is over — and it draws itself again to do so. A
     finger has no «over»: its tap arrives as «the mouse came over this day» and then the click, the first redraws the
     calendar under the finger, and Safari — seeing the page change on the «over» — keeps the click back; the end of a
     period needed two presses. So for the second or so after a touch, a day is not told the mouse came over it: the tap is
     the click, as on every other button. A mouse still gets the preview. */
  var touchedAt = 0;
  document.addEventListener('touchstart', function () { touchedAt = Date.now(); }, { capture: true, passive: true });
  document.addEventListener('touchend', function () { touchedAt = Date.now(); }, { capture: true, passive: true });
  ['mouseenter', 'mouseover'].forEach(function (type) {
    document.addEventListener(type, function (e) {
      if (Date.now() - touchedAt > 1500) return; var t = e.target;
      if (t && t.nodeType === 1 && t.classList && t.classList.contains('day') && t.closest && t.closest('.cal-grid')) e.stopImmediatePropagation();
    }, true);
  });

  /* The assistant takes the focus as it opens — with a keyboard on the desk that is a help, on a touch screen it throws the
     keyboard over the chat before the member has read it. So there the focus is given back; a tap in the box types as always. */
  var touch = window.matchMedia ? window.matchMedia('(pointer:coarse)') : null;
  document.addEventListener('click', function (e) {
    var t = e.target; if (!touch || !touch.matches || !t || !t.closest || !t.closest('.ai-btn')) return;
    var a = document.activeElement; if (a && a.classList && a.classList.contains('ai-input')) a.blur(); fit();
  });
})();
