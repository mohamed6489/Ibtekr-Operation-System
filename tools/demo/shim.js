// «نسخة التعليقات» (the owner 15 Nov: «افتحلي السيستم من هنا هحط كومنتاتي عليه»): the whole app inside a claude.ai Artifact, on the
// tests' stand-in backend running in the page itself. An Artifact may not reach any host, so nothing here talks to Supabase: every
// request to the stand-in's address is answered in the browser (boot.js installs the handlers), the data is the tests' made-up data,
// and it starts again on every open. First script of the page — before config.js and the Supabase client take `fetch`.
(function () {
  'use strict';
  var HOST = 'https://demo.ibtekr.invalid'; // build.mjs puts this in place of the project's address in every published file
  document.documentElement.setAttribute('dir', 'rtl'); document.documentElement.setAttribute('lang', 'ar');

  // --- the two Node globals the stand-in uses (Buffer for bytes, process.env for its «live» switch)
  var enc = new TextEncoder(); var dec = new TextDecoder();
  function latin(u8, a, b) { var s = ''; for (var i = a; i < b; i++) s += String.fromCharCode(u8[i]); return s; }
  class Buf extends Uint8Array {
    static from(v, e) {
      if (typeof v === 'string') {
        if (e === 'base64' || e === 'base64url') { var bin = atob(v.replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '')); var out = new Buf(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
        if (e === 'latin1' || e === 'binary') { var o2 = new Buf(v.length); for (var j = 0; j < v.length; j++) o2[j] = v.charCodeAt(j) & 255; return o2; }
        var u = enc.encode(v); var o3 = new Buf(u.length); o3.set(u); return o3;
      }
      if (v instanceof ArrayBuffer) { var o4 = new Buf(v.byteLength); o4.set(new Uint8Array(v)); return o4; }
      var src = ArrayBuffer.isView(v) ? new Uint8Array(v.buffer, v.byteOffset, v.byteLength) : Array.from(v || []); var o5 = new Buf(src.length); o5.set(src); return o5;
    }
    static alloc(n) { return new Buf(n || 0); }
    static isBuffer(v) { return v instanceof Buf; }
    static byteLength(v) { return typeof v === 'string' ? enc.encode(v).length : (v && v.byteLength) || 0; }
    static concat(list) { var n = list.reduce(function (s, b) { return s + b.length; }, 0); var out = new Buf(n); var at = 0; list.forEach(function (b) { out.set(b, at); at += b.length; }); return out; }
    toString(e, a, b) {
      a = a == null ? 0 : a; b = b == null ? this.length : Math.min(b, this.length);
      if (e === 'latin1' || e === 'binary') return latin(this, a, b);
      if (e === 'base64' || e === 'base64url') { var s = btoa(latin(this, a, b)); return e === 'base64' ? s : s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
      if (e === 'hex') { var h = ''; for (var i = a; i < b; i++) h += (this[i] < 16 ? '0' : '') + this[i].toString(16); return h; }
      return dec.decode(new Uint8Array(this.buffer, this.byteOffset + a, b - a));
    }
  }
  window.Buffer = Buf; window.process = window.process || { env: {} };

  // --- a session kept by an earlier open means nothing to a stand-in that starts again: forget it (boot.js signs in)
  try { [localStorage, sessionStorage].forEach(function (st) { Object.keys(st).filter(function (k) { return /^sb-.*-auth-token/.test(k); }).forEach(function (k) { st.removeItem(k); }); }); } catch (e) { /* storage blocked */ }

  // --- the requests: answered here by the handlers boot.js registers (the tests' page.route handlers, unchanged)
  var handlers = []; var open; var ready = new Promise(function (r) { open = r; });
  var match = function (p, url) {
    if (typeof p === 'function') return !!p(new URL(url)); if (p instanceof RegExp) return p.test(url);
    var s = String(p); return s.slice(-3) === '/**' ? url.indexOf(s.slice(0, -2)) === 0 : s === url;
  };
  var jsonRes = function (status, body) { return new Response(JSON.stringify(body), { status: status, headers: { 'content-type': 'application/json' } }); };
  function serve(req) {
    var bodyless = req.method === 'GET' || req.method === 'HEAD';
    return (bodyless ? Promise.resolve(null) : req.arrayBuffer()).then(function (ab) {
      var buf = ab && ab.byteLength ? Buf.from(ab) : null; var hd = {}; req.headers.forEach(function (v, k) { hd[k.toLowerCase()] = v; });
      return new Promise(function (resolve, reject) {
        var done = false; var end = function (res) { if (!done) { done = true; resolve(res); } };
        var request = {
          url: function () { return req.url; }, method: function () { return req.method; }, headers: function () { return hd; },
          postData: function () { return buf ? buf.toString() : null; }, postDataBuffer: function () { return buf; },
          postDataJSON: function () {
            if (!buf) return null; var t = buf.toString();
            if ((hd['content-type'] || '').indexOf('application/x-www-form-urlencoded') === 0) { var o = {}; new URLSearchParams(t).forEach(function (v, k) { o[k] = v; }); return o; }
            return JSON.parse(t);
          },
        };
        var route = {
          request: function () { return request; },
          fulfill: function (r) {
            r = r || {}; var status = r.status || 200; var headers = new Headers(r.headers || {}); if (r.contentType) headers.set('content-type', r.contentType);
            var body = r.json !== undefined ? JSON.stringify(r.json) : r.body; if (r.json !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json');
            var none = status === 204 || status === 205 || status === 304 || req.method === 'HEAD' || body == null;
            end(new Response(none ? null : body, { status: status, headers: headers })); return Promise.resolve();
          },
          abort: function () { if (!done) { done = true; reject(new TypeError('Failed to fetch')); } return Promise.resolve(); },
          continue: function () { end(jsonRes(404, { error: 'not_in_demo' })); return Promise.resolve(); },
        };
        route.fallback = route.continue;
        var h = handlers.filter(function (x) { return match(x.pattern, req.url); }).pop();
        if (!h) return route.continue();
        Promise.resolve().then(function () { return h.handler(route, request); }).then(function () { end(jsonRes(404, { error: 'not_in_demo' })); }, function (e) { console.error('[demo]', e); end(jsonRes(500, { error: 'demo_failed' })); });
      });
    });
  }
  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || String(input);
    if (url.indexOf(HOST) !== 0) return realFetch(input, init);
    var req; try { req = new Request(input, init); } catch (e) { return Promise.reject(e); }
    return ready.then(function () { return serve(req); });
  };

  // --- pictures: an <img> may not load from another host here. One kept by the stand-in (an upload of this visit) is read through
  // the handlers; any other remote picture (the made-up site's product photos, the 1-pixel stand-ins) shows a neutral tile.
  var TILE = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" fill="#efe6d5"/><path d="M22 54l12-14 9 10 6-7 9 11z" fill="#c9b892"/><circle cx="52" cy="29" r="5" fill="#c9b892"/></svg>');
  // a picture of the made-up site's uploads (a product's photo): a tile of its own colour with the file's first letters, so two
  // products do not look the same and the page shows where the photo goes
  var HUES = [['#e9d8c2', '#8a6a3b'], ['#d7e3d4', '#3f6b4f'], ['#e6d3d8', '#8a4a5c'], ['#d5dfe8', '#3d5f80'], ['#efe2b8', '#7d6a1f'], ['#e3d9ee', '#5d4a80']];
  function productTile(src) {
    var m = /\/wp-content\/uploads\/[^?#]*\/([^/?#]+?)\.[a-z0-9]+(?:[?#]|$)/i.exec(src); if (!m) return null;
    var name = decodeURIComponent(m[1]).replace(/-\d+x\d+$/, ''); var h = 0; for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    var c = HUES[h % HUES.length]; var letters = name.replace(/[^A-Za-z\u0600-\u06FF]+/g, ' ').trim().split(' ').slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join('') || '•';
    return 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" fill="' + c[0] + '"/><rect x="14" y="18" width="52" height="44" rx="8" fill="#fff" opacity=".55"/><text x="40" y="48" text-anchor="middle" font-family="Arial,sans-serif" font-size="20" font-weight="700" fill="' + c[1] + '">' + letters + '</text></svg>');
  }
  function fixImg(img) {
    var src = img.getAttribute('src') || ''; if (!/^https?:/i.test(src)) return;
    img.setAttribute('src', (src.indexOf(HOST) !== 0 && productTile(src)) || TILE);
    if (src.indexOf(HOST) !== 0) return;
    window.fetch(src).then(function (r) { return r.ok ? r.blob() : null; }).then(function (b) { if (b && b.size > 200 && img.getAttribute('src') === TILE) img.setAttribute('src', URL.createObjectURL(b)); }).catch(function () { /* stays the tile */ });
  }
  var imgWatch = new MutationObserver(function (list) {
    list.forEach(function (m) {
      if (m.type === 'attributes') { if (m.target.tagName === 'IMG') fixImg(m.target); return; }
      m.addedNodes.forEach(function (n) { if (n.nodeType !== 1) return; if (n.tagName === 'IMG') fixImg(n); if (n.querySelectorAll) n.querySelectorAll('img[src]').forEach(fixImg); });
    });
  });
  var watchImgs = function (root) { imgWatch.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] }); };
  watchImgs(document.documentElement);
  // the orders page draws inside a shadow root, which the document's observer does not see: every shadow root is watched too
  var attachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) { var root = attachShadow.call(this, init); try { watchImgs(root); } catch (e) { /* a closed root keeps its pictures */ } return root; };

  // --- a cover until boot.js has signed in (the sign-in screen would flash), and a small mark that this is not the live system
  var cover = document.createElement('div'); cover.id = 'demo-cover'; cover.textContent = 'جاري فتح النسخة التجريبية…';
  cover.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:#f6f1e7;color:#005642;font:600 16px Cairo,system-ui,sans-serif';
  var mark = document.createElement('div'); mark.id = 'demo-mark'; mark.textContent = 'نسخة تجريبية · داتا وهمية';
  mark.style.cssText = 'position:fixed;bottom:4px;right:6px;z-index:99998;pointer-events:none;padding:2px 8px;border-radius:999px;background:#f6f1e7;color:#005642;opacity:.8;font:500 10px Cairo,system-ui,sans-serif'; // the right corner: the bottom left is «اطلع لأول الصفحة»
  document.body.appendChild(cover); document.body.appendChild(mark);

  window.__ibDemo = { HOST: HOST, handlers: handlers, open: open, uncover: function () { if (cover.parentNode) cover.parentNode.removeChild(cover); } };
  setTimeout(window.__ibDemo.uncover, 15000); // never stuck behind the cover
})();
