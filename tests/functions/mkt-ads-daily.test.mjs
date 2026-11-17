// The owner 17 Nov — «يبعتلي ملخص يومي عن الصرف و حالة الاعلان و اهم الارقام … الكامبين و السيتس و الاعلانات اللي شغالة»: the buyer's daily note.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dailySummary } from '../../supabase/functions/_shared/mkt-ads-daily.js';

test('daily summary: the spend and the site\'s orders, each campaign with its state and real numbers, the top ad sets and ads, what needs a look', () => {
  const d = dailySummary({ day: '2026-11-16', rules: { maxCpa: 450 },
    campaigns: [{ id: '1', name: 'Lamps', status: 'ACTIVE', spend: 900, purchases: 6 }, { id: '2', name: 'Macrame', status: 'ACTIVE', spend: 600, purchases: 1 }, { id: '3', name: 'Old', status: 'PAUSED', spend: 0, purchases: 0 }],
    orders: [{ campaign: '1', sold: true, sales: 1500 }, { campaign: '1', sold: true, sales: 1500 }, { campaign: '1', sold: false, sales: 999 }],
    adsets: [{ name: 'Broad 25-45', spend: 900, ctr: 1.2, cpm: 40, frequency: 4.5, purchases: 6, impressions: 20000 }],
    ads: null, pending: 2 });
  assert.match(d.title, /ملخص الإعلانات — 2026-11-16 · 2 محتاج تبص/);
  assert.match(d.body, /الصرف إمبارح \(2026-11-16\): 1,500 ج.م · 2 أوردر .* 3,000 ج.م · العائد الحقيقي 2.00×/);
  assert.match(d.body, /• Lamps — شغّالة · صرف 900 · 2 أوردر \(ميتا بتقول 6\)/);
  assert.doesNotMatch(d.body, /Old/); // a paused campaign that spent nothing is left out
  assert.match(d.body, /Broad 25-45 — صرف 900 · CTR 1.2% · CPM 40 · تكرار 4.5/);
  assert.match(d.body, /أعلى الإعلانات: ميتا ماردتش/);
  assert.deepEqual(d.bad, ['«Macrame» صرفت 600 ج.م من غير أوردر', '«Broad 25-45» التكرار 4.5 — الناس زهقت، محتاج كرييتيف جديد']);
  assert.match(d.body, /2 اقتراح مستني موافقتك/);
});
