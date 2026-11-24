/* The media buyer's reading of the ads (Safwat 24 Nov — «يقدر يعرف انا اداء الكامبينز بتاعتي ايه واحسن كامبن شغال و احسن كريتايفز»;
   docs/superpowers/plans/2026-11-24-buyer-brain.md decision 1). Not a block. Pure (UMD), no model and no network — the page
   (the buyer's chat answers from the system first) and the server (<ads_data> for an outside model) run the same file:
   app/js/pages/ads-insight.js = supabase/functions/_shared/ads-insight.js byte for byte (tests/domain/ads-insight.test.mjs).
     IBAdsInsight.build({ objects, stats, orders, from, to, platform }) → { from, to, days, totals, campaigns, ads, best, top, stop, tired }
       objects  mkt_ad_objects rows { platform, kind, id, parent_id, name, status, thumb, thumbPath }
       stats    mkt_ad_stats rows   { platform, level, object_id, campaign_id, day, spend, impressions, clicks, link_clicks, frequency, purchases, purchase_value }
       orders   the shop's orders that came from the ads, cancelled ones out: [{ campaign, ad, orders, sales }] — campaign = the Meta id
                (utm_campaign, its leading digits), ad = the Meta ad id when the ad carries utm_content={{ad.id}} ('' otherwise)
     IBAdsInsight.intent(text, norm) → 'best_campaign' | 'best_creative' | 'performance' | 'stop' | 'tired' | null
     IBAdsInsight.days(text, norm) → 7 | 30 | 'month' (the period the question names; 7 by default)
     IBAdsInsight.answer(intent, insight, en) → the text of the system's answer (every number counted here, from the rows)
     IBAdsInsight.block(insight) → the lines an outside model reads inside <ads_data> (data, not instructions)
   The verdicts, in this order: «لسه بيتعلّم» under MIN_SPEND · «بيخسر» spend ≥ 3 × MIN_SPEND and no purchase at all, or a ROAS under 1 ·
   «زهق» frequency ≥ 4 or the CTR fell 40% from the period's first half to its second · «كسبان» real ROAS ≥ 3 (else Meta's when no
   order carries the campaign) · «ماشي» the rest. The real ROAS = the shop's sales from the ad ÷ the spend; Meta's = the value Meta reports ÷ the spend. */
(function (root, factory) {
  const api = factory(); root.IBAdsInsight = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MIN_SPEND = 300; // ج.م — under it an ad is still learning: its numbers decide nothing
  const WIN_ROAS = 3; const TIRED_FREQ = 4; const CTR_DROP = 0.4;
  const VERDICTS = { win: 'كسبان', ok: 'ماشي', lose: 'بيخسر', tired: 'زهق', learning: 'لسه بيتعلّم' };
  const VERDICTS_EN = { win: 'winning', ok: 'steady', lose: 'losing', tired: 'fatigued', learning: 'still learning' };
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const idOf = (v) => { const m = /^\d{1,30}/.exec(String(v == null ? '' : v).trim()); return m ? m[0] : ''; };
  const money = (n) => Math.round(num(n)).toLocaleString('en-US');
  const fix = (n, d) => (Number.isFinite(n) ? n.toFixed(d) : '—');

  function blank(o) { return { id: o.id, name: o.name || '#' + o.id, status: o.status || null, campaign: o.campaign || null, thumb: o.thumb || null, thumbPath: o.thumbPath || null,
    spend: 0, impressions: 0, clicks: 0, freqW: 0, freqN: 0, purchases: 0, value: 0, orders: 0, sales: 0, halves: [{ c: 0, i: 0 }, { c: 0, i: 0 }] }; }
  function finish(x) {
    const ctr = x.impressions ? x.clicks / x.impressions * 100 : 0;
    const out = { id: x.id, name: x.name, status: x.status, campaign: x.campaign, thumb: x.thumb, thumbPath: x.thumbPath,
      spend: r2(x.spend), impressions: Math.round(x.impressions), clicks: Math.round(x.clicks), ctr: r2(ctr),
      cpc: x.clicks ? r2(x.spend / x.clicks) : null, cpm: x.impressions ? r2(x.spend / x.impressions * 1000) : null,
      frequency: x.freqN ? r2(x.freqW / x.freqN) : null, metaPurchases: r2(x.purchases), metaValue: r2(x.value), metaRoas: x.spend ? r2(x.value / x.spend) : null,
      orders: x.orders, sales: r2(x.sales), roas: x.spend && x.orders ? r2(x.sales / x.spend) : null, cpa: x.orders ? r2(x.spend / x.orders) : null };
    const h0 = x.halves[0], h1 = x.halves[1]; const c0 = h0.i ? h0.c / h0.i : null; const c1 = h1.i ? h1.c / h1.i : null;
    out.ctrDrop = c0 && c1 != null && h0.i >= 1000 && h1.i >= 1000 ? r2((c0 - c1) / c0 * 100) : null;
    const roas = out.roas != null ? out.roas : out.metaRoas;
    // losing before fatigued: an ad with no sales is to stop, not to refresh
    out.verdict = out.spend < MIN_SPEND ? 'learning'
      : (out.spend >= 3 * MIN_SPEND && !out.orders && !out.metaPurchases) || (roas != null && roas < 1) ? 'lose'
      : (out.frequency != null && out.frequency >= TIRED_FREQ) || (out.ctrDrop != null && out.ctrDrop >= CTR_DROP * 100) ? 'tired'
      : roas != null && roas >= WIN_ROAS ? 'win' : 'ok';
    out.score = roas != null ? roas : 0; // the ranking: the real ROAS (Meta's when no order carries it)
    return out;
  }

  function build(input) {
    const I = input || {}; const pf = I.platform || 'meta'; const from = String(I.from || ''); const to = String(I.to || '');
    const inRange = (d) => (!from || d >= from) && (!to || d <= to);
    const objs = (Array.isArray(I.objects) ? I.objects : []).filter((o) => o && (o.platform || 'meta') === pf);
    const camps = {}; const ads = {};
    objs.forEach((o) => { if (o.kind === 'campaign') camps[o.id] = blank(o); else if (o.kind === 'ad') ads[o.id] = blank({ ...o, campaign: o.parent_id || null }); });
    const days = []; (Array.isArray(I.stats) ? I.stats : []).forEach((s) => { if (s && (s.platform || 'meta') === pf && inRange(String(s.day))) days.push(String(s.day)); });
    const sorted = days.slice().sort(); const mid = sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : '';
    (Array.isArray(I.stats) ? I.stats : []).forEach((s) => {
      if (!s || (s.platform || 'meta') !== pf || !inRange(String(s.day))) return;
      const id = String(s.object_id);
      const box = s.level === 'campaign' ? (camps[id] = camps[id] || blank({ id })) : s.level === 'ad' ? (ads[id] = ads[id] || blank({ id, campaign: String(s.campaign_id || '') || null })) : null;
      if (!box) return;
      const sp = num(s.spend), im = num(s.impressions), cl = num(s.link_clicks != null ? s.link_clicks : s.clicks);
      box.spend += sp; box.impressions += im; box.clicks += cl; box.purchases += num(s.purchases); box.value += num(s.purchase_value);
      if (s.frequency != null && im) { box.freqW += num(s.frequency) * im; box.freqN += im; }
      const half = String(s.day) <= mid ? 0 : 1; box.halves[half].c += cl; box.halves[half].i += im;
    });
    (Array.isArray(I.orders) ? I.orders : []).forEach((o) => {
      if (!o) return; const c = idOf(o.campaign); const a = idOf(o.ad); const n = num(o.orders); const v = num(o.sales);
      if (c && camps[c]) { camps[c].orders += n; camps[c].sales += v; }
      if (a && ads[a]) { ads[a].orders += n; ads[a].sales += v; }
    });
    const cList = Object.values(camps).map(finish).filter((x) => x.spend > 0 || x.orders > 0).sort((a, b) => b.spend - a.spend);
    const aList = Object.values(ads).map(finish).filter((x) => x.spend > 0).sort((a, b) => b.spend - a.spend);
    const nameOf = (id) => (camps[id] ? camps[id].name : null); aList.forEach((x) => { x.campaignName = x.campaign ? nameOf(x.campaign) : null; });
    const T = cList.reduce((t, x) => ({ spend: t.spend + x.spend, orders: t.orders + x.orders, sales: t.sales + x.sales, metaValue: t.metaValue + x.metaValue, metaPurchases: t.metaPurchases + x.metaPurchases, impressions: t.impressions + x.impressions, clicks: t.clicks + x.clicks }),
      { spend: 0, orders: 0, sales: 0, metaValue: 0, metaPurchases: 0, impressions: 0, clicks: 0 });
    const totals = { spend: r2(T.spend), orders: T.orders, sales: r2(T.sales), roas: T.spend ? r2(T.sales / T.spend) : null, metaRoas: T.spend ? r2(T.metaValue / T.spend) : null,
      cpa: T.orders ? r2(T.spend / T.orders) : null, ctr: T.impressions ? r2(T.clicks / T.impressions * 100) : null, metaPurchases: r2(T.metaPurchases), campaigns: cList.length, ads: aList.length };
    const ranked = (list) => list.filter((x) => x.spend >= MIN_SPEND && x.verdict !== 'lose').sort((a, b) => b.score - a.score || (b.ctr - a.ctr) || (b.spend - a.spend));
    const realAds = aList.some((x) => x.orders > 0); // utm_content={{ad.id}} on the ads: the creatives are ranked by the shop's sales
    const topAds = aList.filter((x) => x.spend >= MIN_SPEND && x.verdict !== 'lose' && x.verdict !== 'tired')
      .sort((a, b) => (realAds ? (b.roas || 0) - (a.roas || 0) : (b.metaRoas || 0) - (a.metaRoas || 0)) || (b.ctr - a.ctr)).slice(0, 3);
    const nDays = from && to ? Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 864e5) + 1 : null;
    return { platform: pf, from, to, days: nDays, totals, campaigns: cList, ads: aList, realAds,
      best: ranked(cList)[0] || null, top: topAds, stop: cList.concat(aList).filter((x) => x.verdict === 'lose').sort((a, b) => b.spend - a.spend).slice(0, 5),
      tired: aList.filter((x) => x.verdict === 'tired').sort((a, b) => b.spend - a.spend).slice(0, 5) };
  }

  // ---- the question (Arabic or English, after the brain's norm: no hamza, ى → ي, lower case)
  const RX = {
    best_creative: /(كريتيف|كرياتيف|كريتف|creative|الاعلان|اعلان|تصميم|فيديو|صوره|صور)\S*/,
    best: /(احسن|افضل|اقوي|انجح|الكسبان|كسبان|ماشي كويس|best|top|winning|strongest)/,
    stop: /(اوقف|اقفل|نوقف|نقفل|وقف|بيخسر|خسران|خسرانه|بتخسر|لازم يقف|stop|pause|kill|losing|wasting)/,
    tired: /(زهق|زهقت|زهقو|اتحرق|اتحرقت|fatigue|tired|burnt|burned)/,
    perf: /(اداء|الاداء|ماشي ازاي|ماشيه ازاي|عامله ايه|عامل ايه|النتايج|نتيجه|performance|how are|results|roas|العائد)/,
    camp: /(كامبين|كامبينز|كامبينات|حمله|حملات|الحمله|الحملات|campaign)/,
  };
  function intent(text, norm) {
    const raw = String(text == null ? '' : text); const t = ' ' + (norm ? norm(raw) : raw.toLowerCase()).replace(/[؟?!.,،]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
    if (/(ليه|لماذا|why|اكتب|اعمل|صمم|فكره|افكار|write|make|idea|منافس|competitor)/.test(t)) return null; // a why, writing or a competitor: a model's work
    const ads = RX.best_creative.test(t); const camp = RX.camp.test(t);
    if (RX.tired.test(t)) return 'tired';
    if (RX.stop.test(t) && (ads || camp)) return 'stop';
    if (RX.best.test(t) && ads && !camp) return 'best_creative';
    if (RX.best.test(t) && (camp || !ads)) return camp || /(شغال|ماشي)/.test(t) ? 'best_campaign' : null;
    if (RX.perf.test(t) && (camp || ads || /اعلانات|ads/.test(t))) return 'performance';
    return null;
  }
  function days(text, norm) {
    const t = ' ' + (norm ? norm(String(text || '')) : String(text || '').toLowerCase()) + ' ';
    if (/(الشهر ده|الشهر دا|هذا الشهر|this month)/.test(t)) return 'month';
    if (/(30|٣٠|تلاتين|ثلاثين|شهر|month)/.test(t)) return 30;
    return 7;
  }

  // ---- the system's answer (every number from the rows above)
  function answer(kind, ins, en) {
    const tx = (ar, e) => (en ? e : ar); const V = en ? VERDICTS_EN : VERDICTS; const cur = tx(' ج.م', ' EGP');
    if (!ins || !ins.totals) return null;
    const head = tx('آخر ', 'Last ') + (ins.days || '') + tx(' يوم (', ' days (') + ins.from + ' – ' + ins.to + ')';
    const roasTxt = (x) => (x.roas != null ? tx('العائد الحقيقي ', 'real ROAS ') + fix(x.roas, 2) + '×' : x.metaRoas != null ? tx('ميتا بتقول ', 'Meta says ') + fix(x.metaRoas, 2) + '×' : tx('من غير عائد', 'no return'));
    const line = (x) => '• ' + x.name + ' — ' + tx('صرف ', 'spend ') + money(x.spend) + cur + ' · ' + roasTxt(x)
      + (x.orders ? ' · ' + x.orders + tx(' أوردر', ' orders') + (x.cpa != null ? tx(' (الأوردر بـ ', ' (') + money(x.cpa) + cur + ')' : '') : '')
      + ' · CTR ' + fix(x.ctr, 2) + '%' + (x.frequency != null ? tx(' · التكرار ', ' · frequency ') + fix(x.frequency, 1) : '') + ' — ' + V[x.verdict];
    if (!ins.campaigns.length) return tx('مفيش صرف على ميتا في ', 'No Meta spend in the ') + head + tx(' — يا الحساب مش مربوط يا لسه مفيش مزامنة.', ' — the account is not linked, or not synced yet.');
    const T = ins.totals;
    const sum = tx('الإجمالي: صرف ', 'Total: spend ') + money(T.spend) + cur + ' · ' + T.orders + tx(' أوردر من الإعلانات بمبيعات ', ' ad orders, sales ') + money(T.sales) + cur
      + (T.roas != null ? tx(' · العائد الحقيقي ', ' · real ROAS ') + fix(T.roas, 2) + '×' : '') + (T.metaRoas != null ? tx(' (ميتا بتقول ', ' (Meta says ') + fix(T.metaRoas, 2) + '×)' : '')
      + (T.cpa != null ? tx(' · تكلفة الأوردر ', ' · cost per order ') + money(T.cpa) + cur : '');
    const noUtm = !ins.realAds ? '\n' + tx('ملحوظة: ترتيب الكريتيفز بأرقام ميتا لأن الإعلانات مش عليها utm_content={{ad.id}} — لو اتحط، الترتيب يبقى بأوردرات الموقع نفسها.',
      'Note: the creatives are ranked by Meta\'s numbers since the ads carry no utm_content={{ad.id}} — with it they rank by the shop\'s own orders.') : '';
    if (kind === 'best_campaign') {
      const b = ins.best; if (!b) return head + ':\n' + tx('مفيش حملة صرفت ', 'No campaign spent ') + MIN_SPEND + cur + tx(' أو أكتر ونتيجتها كويسة لسه — الأرقام لسه صغيرة على حكم.', ' or more with a good result yet — too early to judge.') + '\n' + sum;
      return head + ' — ' + tx('أحسن حملة شغّالة:', 'the best campaign running:') + '\n' + line(b) + '\n' + sum;
    }
    if (kind === 'best_creative') {
      if (!ins.top.length) return head + ':\n' + tx('مفيش إعلان صرف ', 'No ad spent ') + MIN_SPEND + cur + tx(' أو أكتر ونتيجته كويسة لسه.', ' or more with a good result yet.') + noUtm;
      return head + ' — ' + tx('أحسن كريتيفز:', 'the best creatives:') + '\n' + ins.top.map((x, i) => (i + 1) + '. ' + line(x).slice(2) + (x.campaignName ? tx(' — في «', ' — in “') + x.campaignName + tx('»', '”') : '')).join('\n') + noUtm;
    }
    if (kind === 'stop') {
      if (!ins.stop.length) return head + ':\n' + tx('مفيش حملة ولا إعلان بيخسر بوضوح دلوقتي.', 'Nothing is clearly losing now.') + (ins.tired.length ? '\n' + tx('بس فيه إعلانات زهقت:', 'But some ads are fatigued:') + '\n' + ins.tired.map(line).join('\n') : '');
      return head + ' — ' + tx('اللي بيخسر (فكّر توقفه أو تغيّر الكريتيف):', 'what is losing (think of pausing it or changing the creative):') + '\n' + ins.stop.map(line).join('\n')
        + '\n' + tx('الإيقاف نفسه بموافقتك من «مستني موافقتك» أو كارت الحملة.', 'The pause itself is yours to approve — from «awaiting you» or the campaign card.');
    }
    if (kind === 'tired') {
      if (!ins.tired.length) return head + ':\n' + tx('مفيش إعلان زهق — التكرار تحت ', 'No fatigued ad — frequency under ') + TIRED_FREQ + tx(' والـ CTR مانزلش.', ' and the CTR held.');
      return head + ' — ' + tx('الإعلانات اللي الناس زهقت منها (تكرار عالي أو الـ CTR نزل):', 'the fatigued ads (high frequency or a falling CTR):') + '\n' + ins.tired.map((x) => line(x) + (x.ctrDrop != null ? tx(' · الـ CTR نزل ', ' · CTR fell ') + fix(x.ctrDrop, 0) + '%' : '')).join('\n')
        + '\n' + tx('محتاجين نسخ جديدة — اطلبها من «اطلب نسخة جديدة» أو اسأل الديزاينر.', 'They need fresh versions — ask the designer.');
    }
    // performance
    const rows = ins.campaigns.slice(0, 8).map(line).join('\n');
    return head + ':\n' + sum + '\n' + tx('الحملات (الأكتر صرف الأول):', 'The campaigns (most spend first):') + '\n' + rows
      + (ins.best ? '\n' + tx('الأحسن: ', 'Best: ') + ins.best.name : '') + (ins.stop.length ? '\n' + tx('بيخسر: ', 'Losing: ') + ins.stop.map((x) => x.name).join(tx('، ', ', ')) : '');
  }

  // ---- what an outside model reads (inside <ads_data>): the same numbers, one line each
  function block(ins) {
    if (!ins || !ins.totals) return '';
    const T = ins.totals; const row = (x, ad) => [x.name, ad ? (x.campaignName || x.campaign || '-') : (x.status || '-'), x.spend, x.impressions, fix(x.ctr, 2), x.cpc == null ? '-' : x.cpc, x.cpm == null ? '-' : x.cpm,
      x.frequency == null ? '-' : x.frequency, x.metaPurchases, x.metaRoas == null ? '-' : x.metaRoas, x.orders, x.sales, x.roas == null ? '-' : x.roas, x.cpa == null ? '-' : x.cpa, x.ctrDrop == null ? '-' : x.ctrDrop, VERDICTS_EN[x.verdict]].join(' | ');
    const head = 'name | ' + '%s' + ' | spend EGP | impressions | ctr % | cpc | cpm | frequency | meta purchases | meta roas | shop orders | shop sales | real roas | cost per order | ctr drop % | verdict';
    return ['Meta · ' + ins.from + ' – ' + ins.to + ' (' + ins.days + ' days): spend ' + T.spend + ' · shop orders ' + T.orders + ' · shop sales ' + T.sales + ' · real roas ' + (T.roas == null ? '-' : T.roas) + ' · meta roas ' + (T.metaRoas == null ? '-' : T.metaRoas) + ' · cost per order ' + (T.cpa == null ? '-' : T.cpa),
      'Campaigns:', head.replace('%s', 'status'), ...ins.campaigns.slice(0, 25).map((x) => row(x, false)),
      'Ads (creatives):' + (ins.realAds ? '' : ' (no ad carries utm_content={{ad.id}} — the shop\'s orders are per campaign only)'), head.replace('%s', 'campaign'), ...ins.ads.slice(0, 30).map((x) => row(x, true)),
      'Verdict rules (in this order): learning under ' + MIN_SPEND + ' EGP · losing with no purchase after ' + (3 * MIN_SPEND) + ' EGP or roas < 1 · fatigued at frequency ≥ ' + TIRED_FREQ + ' or a CTR drop ≥ ' + (CTR_DROP * 100) + '% (first half vs second half of the period) · winning at roas ≥ ' + WIN_ROAS + '.'].join('\n');
  }

  return Object.freeze({ MIN_SPEND, WIN_ROAS, TIRED_FREQ, CTR_DROP, VERDICTS, build, intent, days, answer, block });
});
