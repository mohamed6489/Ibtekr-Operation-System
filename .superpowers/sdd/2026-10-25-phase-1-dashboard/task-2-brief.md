### Task 2: اختبارات قواعد لوحة التحكم (الكتلة 24، نقية)

**Files:**
- Create: `tests/domain/dash-domain.test.mjs`
- Test: `npm test`

**Interfaces:**
- Consumes: `app/js/blocks/24-dash-domain.js` (UMD) عبر `loadUmd(new URL('../../app/js/blocks/24-dash-domain.js', import.meta.url))` من `tests/helpers/load-umd.mjs` → `{ packRows, nextMonthDay, ROLES, CARD, MONEY_KPIS, cardsFor, kpisFor, layout, topNeed, health, greeting, countDelta, countIn, quickActions, roleOf }`.
- الكتلة **ماتتعدلش**؛ لو اختبار كشف اختلاف عن المتوقع هنا، التوقع هو اللي يتعدّل ليطابق الكود ويتسجّل في الدفتر.

- [ ] **Step 1: اكتب الاختبارات** (`test(...)` لكل سطر):
  - `roleOf falls back to viewer for unknown and custom roles`: `roleOf('مراجعة جودة') === 'مشاهد'`، `roleOf(undefined) === 'مشاهد'`، `roleOf('أدمن') === 'أدمن'`.
  - `cardsFor marks need as locked`: `cardsFor('مشاهد')` بترجّع 4 كروت بالـ ids `['kpis','daily','need','activity']`، والكارت `need` بس `locked: true`.
  - `layout keeps the saved order, drops unknown ids, appends new cards, never hides need`: `layout('أدمن', { order: ['team', 'kpis', 'statements'], hidden: ['need', 'team'] })` → الـ ids تبدأ بـ `['team','kpis']` ثم باقي كروت الأدمن بترتيبها الافتراضي، `statements` مش موجود، `team.hidden === true`، `need.hidden === false`، الطول = 10.
  - `layout with no prefs = default order, nothing hidden`: `layout('حسابات', null).map(c => c.id)` = `['kpis','daily','need','expByType','money','statements','activity']` وكل `hidden === false`.
  - `kpisFor per role and MONEY_KPIS`: `kpisFor('عمليات')` = `['open','ready','consLate','returns','late']`؛ `kpisFor('مشاهد')` = `['myTasks','mentions','photo']`؛ `MONEY_KPIS` تحتوي `'sales'` و`'payroll'` ومش `'open'`.
  - `topNeed ranks error < orange < warning < other, skips muted, keeps source order inside a rank`: sections = `[{ label: 'النظام', tabs: [['all','الكل',[{ title:'w1', tone:'warning' }, { title:'e1', tone:'error' }, { title:'m', tone:'error', muted:true }]]] }, { label: 'عملاء', tabs: [['all','الكل',[{ title:'o1', tone:'orange' }, { title:'n1' }, { title:'e2', tone:'error' }]]] }]` → `topNeed(sections, 5).items.map(i => i.title)` = `['e1','e2','o1','w1','n1']`، `total === 5`، و`items[0].section === 'النظام'`؛ `topNeed(sections, 2).items.length === 2` و`total === 5`؛ `topNeed([], 5)` = `{ items: [], total: 0 }`.
  - `health counts open orders by state with shares`: rows = `[{status:'جاري التنفيذ'},{status:'قيد الشحن'},{status:'جاهز للشحن'},{status:'مكتمل'},{status:'معلّق', confirm:'غير مؤكد', delivery:'late'},{status:'ملغي'}]` → `open === 4`؛ `rows` بالترتيب `progress 1`، `shipping 2`، `unconf 1`، `risk 0`، `late 1`؛ `rows[1].pct === 0.5`؛ `health([]).open === 0` و`rows[0].pct === 0`.
  - `greeting switches at noon`: `greeting(11*60+59) === 'صباح الخير'`، `greeting(12*60) === 'مساء الخير'`.
  - `countDelta tone follows the good direction`: `countDelta(5, 3, 'up')` = `{ text: '+2', tone: 'positive' }`؛ `countDelta(3, 5, 'up').tone === 'negative'`؛ `countDelta(3, 5, 'down').tone === 'positive'` و`text === '-2'`؛ `countDelta(4, 4, 'up')` = `{ text: '0', tone: 'neutral' }`.
  - `countIn is inclusive on both ends`: orders بتواريخ `'2026-10-01','2026-10-05','2026-10-06'` و`r = { from: '2026-10-01', to: '2026-10-05' }` → 2.
  - `quickActions per role`: `quickActions('مشاهد').map(a => a.id)` = `['clock','leave','notifs']`؛ `quickActions('حسابات')` تحتوي `'expense'` و`'vendorMove'` ومش `'vendor'`؛ `quickActions('دور مجهول')` = نفس المشاهد.
  - `nextMonthDay: today counts, last day, rollover, clamp`: `nextMonthDay('2026-10-16', [16, 'last']) === '2026-10-16'`؛ `nextMonthDay('2026-10-17', [16, 'last']) === '2026-10-31'`؛ `nextMonthDay('2026-10-31', [16]) === '2026-11-16'`؛ `nextMonthDay('2026-02-10', [30]) === '2026-02-28'`؛ `nextMonthDay('2026-12-20', [5]) === '2027-01-05'`؛ `nextMonthDay('2026-10-01', []) === null`.
  - `packRows fills 12 columns and stretches the last card of each row`: `packRows(['daily','need','weeks','health'])` = `[['daily',4],['need',8],['weeks',7],['health',5]]`؛ `packRows(['weeks','team'])` = `[['weeks',7],['team',5]]` (team من 4 لـ 5)؛ `packRows(['money'])` = `[['money',12]]` (الافتراضي 6 → يتمدد)؛ `packRows([])` = `[]`.

- [ ] **Step 2: شغّل `npm test`** → كل الاختبارات الجديدة PASS (لو واحد فشل: راجع الكود في الكتلة 24 وعدّل التوقع، ماتعدلش الكتلة، واكتب الفرق في تقريرك).

- [ ] **Step 3: Commit**

```bash
git add tests/domain/dash-domain.test.mjs
git commit -m "test(dashboard): rules of the dashboard domain block (layout, ranking, health, packing)"
```

---

