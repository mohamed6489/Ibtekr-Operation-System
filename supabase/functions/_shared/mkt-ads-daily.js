// The media buyer's daily summary (the owner 17 Nov — «يبعتلي ملخص يومي عن الصرف و حالة الاعلان و اهم الارقام اللي محتاج اعرفها عن الكامبين و
// السيتس و الاعلانات اللي شغالة»): yesterday's spend, each campaign's state and numbers next to the site's orders, and the running ad sets
// and ads with what matters (spend, CTR, CPM, frequency, Meta's purchases) — the text of the buyer's note in the bell (0124). Pure.

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
const pct = (n) => (Number.isFinite(Number(n)) ? (Math.round(Number(n) * 100) / 100) + '%' : '—');
const STATE = { ACTIVE: 'شغّالة', PAUSED: 'متوقفة', CAMPAIGN_PAUSED: 'متوقفة', ADSET_PAUSED: 'متوقفة', ARCHIVED: 'متأرشفة', DELETED: 'اتمسحت', WITH_ISSUES: 'فيها مشكلة', DISAPPROVED: 'مرفوضة', PENDING_REVIEW: 'مستنية مراجعة' };
const stateOf = (s) => STATE[String(s || '').toUpperCase()] || (s ? String(s) : '—');

/**
 * input: { day, campaigns: [{ id, name, status, spend, purchases }] (yesterday per Meta campaign), orders: [{ campaign, sold, sales }] (the
 * site's, yesterday), adsets / ads: Meta's live rows of yesterday (liveAdsRows shape) or null when Meta did not answer, pending (the open
 * suggestions), rules: { maxCpa } } → { title, body, bad } — bad = the things that need a look today (a running campaign with spend and no
 * order over maxCpa, a frequency over 4, a CTR under 0.5%).
 */
export function dailySummary(input) {
  const camps = (Array.isArray(input.campaigns) ? input.campaigns : []).filter(isObj);
  const byCamp = {}; for (const o of Array.isArray(input.orders) ? input.orders : []) { if (!isObj(o) || !o.sold) continue; const c = byCamp[o.campaign] || (byCamp[o.campaign] = { orders: 0, sales: 0 }); c.orders += 1; c.sales += Number(o.sales) || 0; }
  const spend = camps.reduce((s, c) => s + (Number(c.spend) || 0), 0);
  const orders = Object.values(byCamp).reduce((s, c) => s + c.orders, 0); const sales = Object.values(byCamp).reduce((s, c) => s + c.sales, 0);
  const maxCpa = Number(input.rules && input.rules.maxCpa) || 450; const bad = [];
  const lines = [];
  lines.push('الصرف إمبارح (' + input.day + '): ' + fmt(spend) + ' ج.م · ' + fmt(orders) + ' أوردر من الإعلانات على الموقع بـ ' + fmt(sales) + ' ج.م · العائد الحقيقي ' + (spend > 0 ? (sales / spend).toFixed(2) + '×' : '—') + ' · تكلفة الأوردر ' + (orders ? fmt(spend / orders) + ' ج.م' : '—'));
  const active = camps.filter((c) => (Number(c.spend) || 0) > 0 || String(c.status).toUpperCase() === 'ACTIVE').sort((a, b) => (Number(b.spend) || 0) - (Number(a.spend) || 0)).slice(0, 10);
  if (active.length) {
    lines.push('', 'الحملات:');
    for (const c of active) {
      const o = byCamp[c.id] || { orders: 0, sales: 0 }; const s = Number(c.spend) || 0;
      lines.push('• ' + c.name + ' — ' + stateOf(c.status) + ' · صرف ' + fmt(s) + ' · ' + fmt(o.orders) + ' أوردر (ميتا بتقول ' + fmt(c.purchases) + ') · عائد ' + (s > 0 ? (o.sales / s).toFixed(2) + '×' : '—') + ' · للأوردر ' + (o.orders ? fmt(s / o.orders) : '—'));
      if (s >= maxCpa && !o.orders) bad.push('«' + c.name + '» صرفت ' + fmt(s) + ' ج.م من غير أوردر');
      else if (o.orders && s / o.orders > maxCpa) bad.push('«' + c.name + '» تكلفة الأوردر ' + fmt(s / o.orders) + ' فوق ' + fmt(maxCpa));
    }
  } else lines.push('', 'مفيش حملات صرفت إمبارح.');
  const rowsOf = (title, rows) => {
    if (rows === null) { lines.push('', title + ': ميتا ماردتش — الأرقام دي من آخر مزامنة بس.'); return; }
    const top = (Array.isArray(rows) ? rows : []).filter((r) => r.spend > 0).sort((a, b) => b.spend - a.spend).slice(0, 5); if (!top.length) return;
    lines.push('', title + ':');
    for (const r of top) {
      lines.push('• ' + r.name + ' — صرف ' + fmt(r.spend) + ' · CTR ' + pct(r.ctr) + ' · CPM ' + fmt(r.cpm) + ' · تكرار ' + (r.frequency || '—') + ' · مشتريات ميتا ' + fmt(r.purchases));
      if (r.frequency >= 4) bad.push('«' + r.name + '» التكرار ' + r.frequency + ' — الناس زهقت، محتاج كرييتيف جديد');
      else if (r.impressions >= 1000 && r.ctr < 0.5) bad.push('«' + r.name + '» CTR ' + pct(r.ctr) + ' ضعيف');
    }
  };
  rowsOf('أعلى مجموعات الإعلانات (Ad sets)', input.adsets); rowsOf('أعلى الإعلانات', input.ads);
  if (bad.length) lines.push('', 'محتاج تبص عليه النهارده:', ...bad.slice(0, 8).map((x) => '• ' + x));
  if (input.pending) lines.push('', fmt(input.pending) + ' اقتراح مستني موافقتك في «الذكاء الاصطناعي › الميديا باير».');
  return { title: 'ملخص الإعلانات — ' + input.day + (bad.length ? ' · ' + fmt(bad.length) + ' محتاج تبص' : ''), body: lines.join('\n').slice(0, 3900), bad };
}
