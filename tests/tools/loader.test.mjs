import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// «دودة اللوجو» (the owner 15 Nov — docs/superpowers/plans/2026-11-15-preloader.md): at rest the preloader IS the logo. The mark is
// drawn as dashes of one stroke on the logo's square track (loader.js TRACK, the numbers in app.css) — this test walks the track and
// checks that the dashes cover exactly the logo's own shapes (the numbers of the owner's SVG), that one round of the animation is
// one round of the track, and that the page's first-paint cover is the same drawing.
const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const js = read('app/js/pages/loader.js'); const css = read('app/css/app.css'); const html = read('app/index.html');
const TRACK = /const TRACK = '([^']+)'/.exec(js)[1]; const CLIP = /const CLIP = '([^']+)'/.exec(js)[1];
const W = 4.75, HALF = W / 2, ROUND = 53;
// the track as points (M / V / H only), and the point at a distance along it
function points(d) {
  const out = []; let x = 0, y = 0;
  for (const m of d.matchAll(/([MVH])([-\d. ]+)/g)) { const n = m[2].trim().split(/\s+/).map(Number); if (m[1] === 'M') { [x, y] = n; } else if (m[1] === 'V') y = n[0]; else x = n[0]; out.push([x, y]); }
  return out;
}
const P = points(TRACK);
const segs = P.slice(1).map((p, i) => ({ a: P[i], b: p, len: Math.abs(p[0] - P[i][0]) + Math.abs(p[1] - P[i][1]) }));
const total = segs.reduce((s, g) => s + g.len, 0);
function at(s) { let left = s; for (const g of segs) { if (left <= g.len + 1e-9) { const t = g.len ? left / g.len : 0; return [g.a[0] + (g.b[0] - g.a[0]) * t, g.a[1] + (g.b[1] - g.a[1]) * t]; } left -= g.len; } return segs.at(-1).b; }
const near = (got, want, msg) => assert.ok(Math.abs(got[0] - want[0]) < 0.01 && Math.abs(got[1] - want[1]) < 0.01, `${msg}: ${got} ≠ ${want}`);
const rule = (sel) => new RegExp('(?:^|\\n)' + sel.replace(/[.\s]/g, (c) => (c === '.' ? '\\.' : '\\s')) + '\\{([^}]*)\\}').exec(css)[1]; // the rule that starts a line with exactly this selector
const num = (decl, prop) => new RegExp(prop + ':([^;]+)').exec(decl)[1].trim().split(/\s+/).map(Number);

test('the track: the centre line of the logo\'s square ring, round twice, starting on the left edge under the head', () => {
  assert.deepEqual(P[0], [9.375, 11.75]); assert.deepEqual(P.at(-1), [9.375, 11.75]);
  assert.equal(total, 2 * ROUND, 'twice round (no dash is ever cut at the path\'s start)');
  near(at(HALF), [9.375, 9.375], 'the first corner'); near(at(ROUND), [9.375, 11.75], 'one round is back at the start');
  for (const s of [3, 11, 20, 30, 45]) near(at(s + ROUND), at(s), 'the second round is the first again');
});

test('at rest the dashes are the logo: the green head in the corner cell, the two gold pieces where the owner\'s SVG has them', () => {
  const body = rule('.ib-worm .w-body'); const head = rule('.ib-worm .w-head'); const both = rule('.ib-worm .w-body,.ib-worm .w-head');
  assert.match(both, /stroke-width:4\.75/); assert.match(both, /stroke-linecap:square/); assert.match(both, /stroke-linejoin:miter/);
  assert.match(body, /stroke:#C9A259/i); assert.match(head, /stroke:#015642/i); assert.match(rule('.ib-worm .w-tile'), /fill:#FFF3E6/i);
  // a square end adds half the thickness on each side: what is seen of a dash [a, b] is [a − 2.375, b + 2.375]
  const bd = num(body, 'stroke-dasharray'); const b0 = -num(body, 'stroke-dashoffset')[0];
  assert.equal(bd.reduce((s, n) => s + n, 0), ROUND, 'the body pattern is one round long');
  const pieceA = [b0 - HALF, b0 + bd[0] + HALF]; const startB = b0 + bd[0] + bd[1]; const pieceB = [startB - HALF, startB + bd[2] + HALF];
  // the owner's SVG: «M24.997 7V14.6255H20.2496V11.7502H14.125V7» and «M24.9972 17.0004V24.9998H9.81…7 22.189V14.125H11.7502…»
  near(at(pieceA[0]), [14.125, 9.375], 'the top bar starts at x = 14.125'); near(at(pieceA[1]), [22.625, 14.6255], 'and ends down the right side at y = 14.6255');
  near(at(pieceB[0]), [22.625, 17.0004], 'the second piece starts at y = 17.0004'); near(at(pieceB[1]), [9.375, 14.125], 'and ends up the left side at y = 14.125');
  // the head: a dash of (almost) nothing at the corner — its square ends make the 4.75 cell «M11.7502 7H7V11.7502H11.7502V7Z»
  const hd = num(head, 'stroke-dasharray'); const h0 = -num(head, 'stroke-dashoffset')[0];
  assert.ok(hd[0] > 0 && hd[0] < 0.05, 'a dash of almost nothing'); assert.ok(Math.abs(hd[0] + hd[1] - ROUND) < 1e-9);
  near(at(h0 + hd[0] / 2), [9.375, 9.375], 'centred on the corner');
  assert.ok(Math.abs((9.375 + HALF) - 11.7502) < 0.01 && Math.abs((9.375 - HALF) - 7) < 0.01, 'the cell 7 … 11.75');
  // the three gaps are the logo's 2.375
  for (const gap of [pieceA[0] - (h0 + HALF), pieceB[0] - pieceA[1], (h0 - HALF + ROUND) - pieceB[1]]) assert.ok(Math.abs(gap - 2.375) < 0.03, 'gap ' + gap);
  // the logo's one round corner (bottom-left, outside) is the clip
  assert.match(CLIP, /^M7 7H25V25H9\.81C8\.26 25 7 23\.74 7 22\.19Z$/);
});

test('the motion: one round forward for the head and the body alike, then a rest as the logo; slower for reduced motion', () => {
  const frames = (name) => { const m = new RegExp('@keyframes ' + name + '\\{0%\\{stroke-dashoffset:(-?[\\d.]+)\\}(\\d+)%,100%\\{stroke-dashoffset:(-?[\\d.]+)\\}\\}').exec(css); return m.slice(1).map(Number); };
  const [b0, bAt, b1] = frames('ib-worm-body'); const [h0, hAt, h1] = frames('ib-worm-head');
  assert.equal(Math.round((b0 - b1) * 1000) / 1000, ROUND); assert.equal(Math.round((h0 - h1) * 1000) / 1000, ROUND);
  assert.equal(b0, num(rule('.ib-worm .w-body'), 'stroke-dashoffset')[0], 'it starts from the logo'); assert.equal(h0, num(rule('.ib-worm .w-head'), 'stroke-dashoffset')[0]);
  assert.equal(bAt, hAt); assert.ok(bAt >= 70 && bAt < 100, 'a rest at the end of each round');
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\.ib-worm \.w-body,\.ib-worm \.w-head\{animation-duration:8s/);
});

test('the first-paint cover in index.html is the same drawing, and the loader is there before anything else (the portal too)', () => {
  const cover = /<div id="ib-boot"[\s\S]*?<\/div>/.exec(html)[0];
  assert.match(cover, /class="ib-boot" role="status"/); assert.match(cover, /class="ib-worm" viewBox="0 0 32 32"/);
  assert.equal(cover.split(`d="${TRACK}"`).length - 1, 2, 'the body and the head on the same track');
  assert.ok(cover.includes(`d="${CLIP}"`)); assert.match(cover, /class="w-body"/); assert.match(cover, /class="w-head"/); assert.match(cover, /class="w-tile" width="32" height="32" rx="6"/);
  const order = ['<div id="root"', '<div id="ib-boot"', '<script src="js/pages/loader.js">', '<script src="config.js">', 'js/adapter/supabase-client.js', 'js/adapter/busy.js', 'js/blocks/14-kit.js'].map((x) => html.indexOf(x));
  assert.ok(order.every((n, i) => n > 0 && (i === 0 || n > order[i - 1])), 'the cover, then the loader, then the rest: ' + order);
  assert.match(read('app/portal.html'), /<script src="js\/pages\/loader\.js"><\/script>/);
  // the Supabase client hands its requests to the busy adapter (every member-started request shows the running pill)
  assert.match(read('app/js/adapter/supabase-client.js'), /global: \{ fetch: viaBusy \}/);
});
