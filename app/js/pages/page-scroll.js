// The page's own scroll (the owner 15 Nov — docs/superpowers/plans/2026-11-15-page-scroll.md: «عايز اضيف زرار دائري داخله سهم stickey اقدر ادوس
// عليه يطلعني لبداية الصفحة يبقي علي الشمال تحت و عايز كمان ال scroll bar للسيستم يتنقل لشمال»). Not a block.
//
// 1) The scroll bar on the left. A browser keeps the window's own scroll bar on the right even in a right-to-left page; only a scrolling
//    element inside the page gets it on the left. So on a desktop (app.css: wide screen + mouse) <html> stops scrolling and <body> is the
//    scroller. The pages were written for the window (window.scrollTo(0, 0) after a navigation, window.scrollY kept across a redraw,
//    scrollBy while a card is dragged), so those three keep meaning «the page» here: they read and move <body> while it is the scroller,
//    and the window as before on a phone or a tablet (their scroll bar is an overlay, and the address bar must keep hiding on scroll).
// 2) «اطلع لأول الصفحة»: a round button fixed at the bottom left (clear of the left scroll bar, above the phone's bottom bar) that shows
//    once the page is scrolled down and takes it back to the top.
(function () {
  'use strict';
  var doc = document.documentElement;
  var native = { to: window.scrollTo.bind(window), by: window.scrollBy.bind(window) };
  var bodyScrolls = function () {
    var b = document.body; if (!b) return false;
    var o = getComputedStyle(b).overflowY; return (o === 'auto' || o === 'scroll') && getComputedStyle(doc).overflowY === 'hidden';
  };
  var top = function () { return bodyScrolls() ? document.body.scrollTop : doc.scrollTop; };
  var opts = function (a, b) { return a && typeof a === 'object' ? a : { left: Number(a) || 0, top: Number(b) || 0 }; };
  window.scrollTo = window.scroll = function (a, b) { if (bodyScrolls()) document.body.scrollTo(opts(a, b)); else native.to(opts(a, b)); };
  window.scrollBy = function (a, b) { if (bodyScrolls()) document.body.scrollBy(opts(a, b)); else native.by(opts(a, b)); };
  ['scrollY', 'pageYOffset'].forEach(function (k) { try { Object.defineProperty(window, k, { configurable: true, enumerable: true, get: top, set: function () {} }); } catch (e) { /* a browser that keeps its own: the window's value */ } });

  var SHOW_AFTER = 400; var btn = null;
  var NS = 'http://www.w3.org/2000/svg';
  function arrow() {
    var s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '22'); s.setAttribute('height', '22'); s.setAttribute('aria-hidden', 'true');
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2.2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    var p = document.createElementNS(NS, 'path'); p.setAttribute('d', 'M12 19V5M5 12l7-7 7 7'); s.appendChild(p); return s;
  }
  // the left scroll bar's width (0 with overlay scroll bars / on a phone): the button stands clear of it
  var sbw = -1;
  function gutter() { var b = document.body; var w = bodyScrolls() ? Math.max(0, b.offsetWidth - b.clientWidth) : 0; if (w !== sbw) { sbw = w; doc.style.setProperty('--page-sbw', w + 'px'); } }
  function sync() { if (!btn) return; gutter(); var on = top() > SHOW_AFTER; btn.classList.toggle('show', on); btn.tabIndex = on ? 0 : -1; if (on) btn.removeAttribute('aria-hidden'); else btn.setAttribute('aria-hidden', 'true'); }
  function mount() {
    if (btn || !document.body) return;
    btn = document.createElement('button'); btn.type = 'button'; btn.className = 'to-top'; btn.setAttribute('aria-label', 'اطلع لأول الصفحة'); btn.title = 'اطلع لأول الصفحة'; btn.setAttribute('data-to-top', '');
    btn.appendChild(arrow());
    btn.addEventListener('click', function () {
      var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: 0, left: 0, behavior: calm ? 'auto' : 'smooth' });
    });
    document.body.appendChild(btn); sync();
    // the scroll bar comes and goes with the page's height: the body's content box changes with it
    if (window.ResizeObserver) new ResizeObserver(function () { gutter(); }).observe(document.body);
  }
  // a scroll does not bubble: the capture on the window hears the body's scroll and the document's alike (an inner list's too — cheap)
  var tick = 0; window.addEventListener('scroll', function () { if (tick) return; tick = requestAnimationFrame(function () { tick = 0; sync(); }); }, { passive: true, capture: true });
  window.addEventListener('resize', function () { gutter(); sync(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
  window.IBPageScroll = { top: top, bodyScrolls: bodyScrolls, sync: function () { gutter(); sync(); } };
})();
