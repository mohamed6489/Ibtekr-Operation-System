import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// IBCS (phase 6, 0034) against the mocked Supabase, before the page is wired (T4): the load at sign-in (customers from the seeded
// orders through cs_customers_list, the conversations with their messages, segments / campaigns / channels / settings), the writes
// the mock records (never a phone or a text), the permission rules (ops: reply without manage; accounts: nothing).
// Mock only: the cases assert the mock's seed and mock.csWrites.
const ADMIN = 'admin.dev@ibtekr.local'; const OPS = 'ops.dev@ibtekr.local'; const ACCOUNTS = 'accounts.dev@ibtekr.local';
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'asserts on the mocked Supabase');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page);
});
test.afterEach(() => { if (LIVE) return; expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });
async function signIn(page, id) {
  await page.goto('/');
  await expect(page.locator('#login')).toBeVisible();
  await page.fill('#lg-id', id); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
  await page.waitForFunction(() => window.IBCS && window.IBCS.state() === 'ready');
}
const data = (page) => page.evaluate(() => JSON.parse(JSON.stringify({ state: window.IBCS.state(), can: window.IBCS.can(), customers: window.IBCS.data.customers, convs: window.IBCS.data.convs, segments: window.IBCS.data.segments, campaigns: window.IBCS.data.campaigns, channels: window.IBCS.data.channels, settings: window.IBCS.data.settings, agents: window.IBCS.agents() })));

test('admin: the customers come from the orders (full phone, figures, the last orders), the conversations with their messages, the rest of the data', async ({ page }) => {
  await signIn(page, ADMIN);
  const d = await data(page);
  expect(d.can).toEqual({ view: 'F', reply: true, manage: true, phone: true, orders: true, admin: true });
  const salwa = d.customers.find((c) => c.name === 'سلوى زيتوني');
  expect(salwa).toMatchObject({ phone: '01200007052', city: 'مدينة نصر', createdFrom: 'orders', orders: 1, total: 3541, refused: 0, returned: 0, openComplaints: 1, conversations: 1, channels: ['whatsapp'] });
  expect(salwa.orderList).toEqual([['181668', 'Processing', expect.stringMatching(/^3,541 ج\.م · /), 'OnTime']]);
  // whole days since the seeded order, counted like the adapter (was a literal 6 on 2 Nov and broke with the clock)
  expect(salwa.lastOrderDays).toBe(Math.max(0, Math.floor((Date.now() - Date.parse(salwa.lastOrderAt)) / 864e5)));
  expect(salwa.notes.map((n) => [n.author, n.text])).toEqual([['سارة أحمد', 'بتحب التغليف كهدية دايماً — اسألها قبل الشحن.']]);
  expect(d.customers.find((c) => c.name === 'يوسف حامد')).toMatchObject({ createdFrom: 'manual', orders: 0, mood: 'متوسط', tags: ['مهتم'], orderList: [] });
  expect(d.customers.find((c) => c.name === 'أوردر قديم')).toMatchObject({ orders: 1, orderList: [['150001', 'Completed', expect.any(String), null]] });
  const open = d.convs.find((v) => v.seg === 'customers');
  expect(open).toMatchObject({ platform: 'whatsapp', who: salwa.id, status: 'مستنية ردنا', assignee: 'سارة أحمد', unread: 1, tags: ['شكوى'] });
  expect(open.waiting).toBeGreaterThanOrEqual(18); expect(open.waiting).toBeLessThan(25);
  expect(open.msgs.map((m) => [m.t, m.author])).toEqual([['in', ''], ['note', 'سارة أحمد']]);
  expect(d.convs.find((v) => v.seg === 'vendors')).toMatchObject({ who: 'a0000000-0000-4000-8000-000000000001', status: 'اتحلت', assignee: 'صفوت كمال', outcome: 'اتحل', time: 'أمس' });
  expect(d.segments).toEqual([{ id: expect.any(String), name: 'VIP راضيين', minTotal: 1000, minOrders: '', moods: [], last: '', lastFrom: '', lastTo: '', ranges: { sat: [4, 5] }, includeUnrated: false, add: [], remove: [] }]);
  expect(d.campaigns[0]).toMatchObject({ name: 'عرض العملاء المتكررين — أكتوبر', seg: 'VIP راضيين', from: 'واتساب 1 · العملاء', status: 'مسودة', size: 2, discountCode: 'OCT10' });
  expect(Object.keys(d.channels).sort()).toEqual(['instagram', 'messenger', 'tiktok', 'wa1', 'wa2']);
  expect(d.channels.wa1).toMatchObject({ status: 'disconnected', kind: 'qr', cap: 300, aud: 'customers' });
  expect(d.settings).toEqual({ routing: 'auto', slaWarn: 10, slaLate: 15, hours: expect.any(String), autoCloseDays: 3, live: { wa: false, campaigns: false } }); // decision 24: hidden until the owner opens them
  expect(d.agents.map((a) => a.name)).toEqual(['صفوت كمال', 'سارة أحمد', 'محمد علي', 'هدى سمير']);
});

test('admin writes: note, status, close with mood + rating, a new conversation, a lead, tags, merge, segment, campaign, settings — the mock records them without phones or texts', async ({ page }) => {
  await signIn(page, ADMIN);
  const r = await page.evaluate(async () => {
    const S = window.IBCS; const out = {}; const conv = S.data.convs.find((v) => v.seg === 'customers'); const cu = S.customer(conv.who); const lead = S.data.customers.find((c) => c.name === 'يوسف حامد');
    out.note = await S.note(conv.id, 'ملاحظة داخلية');
    out.status = await S.setStatus(conv.id, 'مستنية العميل');
    out.assign = await S.assign(conv.id, null);
    out.close = await S.close(conv.id, { outcome: 'اتحلت المشكلة', mood: 'سعيد', rating: { sat: 5, manners: 4 } });
    out.open = await S.open({ seg: 'customers', platform: 'instagram', customerId: lead.id });
    out.send = await S.send(out.open.conv.id, 'أهلاً يوسف');
    out.add = await S.addCustomer({ name: 'رحاب محمود', phone: '٠١٠١١١٢٢٢٣٣', city: 'القاهرة' });
    out.dup = await S.addCustomer({ name: 'x', phone: '01277766655' });
    out.tags = await S.setTags(cu.id, ['فخار', 'هدايا']);
    out.edit = await S.updateCustomer(cu.id, { ig: '@salwa', consent: false });
    out.override = await S.setOverride(cu.id, 4, 'عميلة قديمة');
    out.merge = await S.merge(cu.id, lead.id);
    out.seg = await S.saveSegment({ name: 'محتاجين متابعة', moods: ['متضايق'], ranges: {}, includeUnrated: true, add: [], remove: [] });
    out.camp = await S.saveCampaign({ name: 'الجمعة البيضاء', segId: out.seg.segment.id, channel: 'wa1', body: 'خصم', status: 'مجدولة', scheduledAt: '2026-11-20T17:00:00Z', size: 3 });
    out.campDelScheduled = await S.deleteCampaign(out.camp.campaign.id); // a schedule is not deleted — a draft is
    out.campDraft = await S.setCampaignStatus(out.camp.campaign.id, 'مسودة');
    out.campDel = await S.deleteCampaign(out.camp.campaign.id);
    out.segDel = await S.deleteSegment(out.seg.segment.id);
    out.settings = await S.saveSettings({ routing: 'manual', slaWarn: 8, slaLate: 12, hours: '10 ص – 10 م', autoCloseDays: 5 });
    out.after = JSON.parse(JSON.stringify({ conv: S.conv(conv.id), cu: S.customer(cu.id), leadGone: !S.customer(lead.id), newConv: S.conv(out.open.conv.id), rehab: S.data.customers.find((c) => c.name === 'رحاب محمود'), settings: S.data.settings }));
    return JSON.parse(JSON.stringify(out));
  });
  for (const k of ['note', 'status', 'assign', 'close', 'open', 'send', 'add', 'tags', 'edit', 'override', 'merge', 'seg', 'camp', 'campDraft', 'campDel', 'segDel', 'settings']) expect(r[k].ok, k).toBe(true);
  expect(r.campDelScheduled).toEqual({ ok: false, reason: 'forbidden' });
  expect(r.dup).toMatchObject({ ok: false, reason: 'invalid', duplicate: true });
  expect(r.after.conv).toMatchObject({ status: 'اتحلت', outcome: 'اتحلت المشكلة', assignee: 'غير معيّنة', waiting: 0 });
  expect(r.after.conv.msgs.map((m) => m.t)).toEqual(['in', 'note', 'note', 'event']);
  expect(r.after.cu).toMatchObject({ mood: 'سعيد', tags: ['فخار', 'هدايا', 'مهتم'], ig: '@salwa', consent: false, manualRating: 4, ratingReason: 'عميلة قديمة', ratingCount: 1, ratingSat: 5, ratingManners: 4 });
  expect(r.after.leadGone).toBe(true);
  expect(r.after.newConv).toMatchObject({ status: 'مستنية العميل', assignee: 'صفوت كمال', who: r.after.cu.id }); // the lead's conversation followed the merge
  expect(r.after.newConv.msgs.map((m) => [m.t, m.delivery])).toEqual([['out', 'queued']]);
  expect(r.after.rehab).toMatchObject({ phone: '01011122233', city: 'القاهرة', createdFrom: 'manual' });
  expect(r.after.settings).toEqual({ routing: 'manual', slaWarn: 8, slaLate: 12, hours: '10 ص – 10 م', autoCloseDays: 5, live: { wa: false, campaigns: false } }); // the form never opens the hidden parts
  const w = mock.csWrites;
  expect(w.filter((x) => x.table === 'cs_messages').map((x) => x.kind)).toEqual(['note', 'event', 'out']);
  expect(w.filter((x) => x.table === 'cs_conversations' && x.op === 'update').map((x) => x.status || x.assignee)).toEqual(['مستنية العميل', null, 'اتحلت']);
  expect(w.find((x) => x.table === 'cs_team_ratings')).toMatchObject({ op: 'insert', sat: 5, manners: 4 });
  expect(w.find((x) => x.table === 'cs_customers' && x.op === 'insert')).toEqual({ table: 'cs_customers', op: 'insert', name: 'رحاب محمود', ig: null, city: 'القاهرة', province: null, address: null, address2: null, mood: null, tags: [], consent: true, auto_consent: true, source: null, created_from: 'manual' });
  expect(w.find((x) => x.op === 'merge')).toMatchObject({ table: 'cs_customers' });
  expect(JSON.stringify(w)).not.toMatch(/01011122233|01277766655|ملاحظة داخلية|أهلاً يوسف/);
  expect(mock.settings.find((s) => s.section === 'cs').data).toEqual({ routing: 'manual', sla_warn: 8, sla_late: 12, hours: '10 ص – 10 م', auto_close_days: 5, live: { wa: false, campaigns: false } });
  // the activity rows are fire-and-forget: wait for the last one
  await expect.poll(() => mock.activity.map((a) => a.action)).toEqual(expect.arrayContaining(['cs.note', 'cs.status', 'cs.assign', 'cs.close', 'cs.rating', 'cs.open', 'cs.send', 'cs.customer.add', 'cs.customer.tags', 'cs.customer.edit', 'cs.customer.rating', 'cs.merge', 'cs.segment.add', 'cs.campaign.add', 'cs.campaign.delete', 'cs.segment.delete', 'cs.settings']));
  expect(JSON.stringify(mock.activity)).not.toMatch(/01011122233|ملاحظة داخلية|أهلاً يوسف/);
});

test('ops (reply without manage): mood and tags pass, a profile edit / a lead / a segment / a merge / the settings are refused', async ({ page }) => {
  await signIn(page, OPS);
  const r = await page.evaluate(async () => {
    const S = window.IBCS; const cu = S.data.customers.find((c) => c.name === 'سلوى زيتوني'); const out = { can: S.can(), phone: cu.phone, n: S.data.customers.length };
    out.mood = await S.setMood(cu.id, 'متضايق'); out.tags = await S.setTags(cu.id, ['متابعة']);
    out.edit = await S.updateCustomer(cu.id, { city: 'الجيزة' }); out.add = await S.addCustomer({ name: 'x', phone: '01000000777' });
    out.seg = await S.saveSegment({ name: 'جديدة', moods: ['سعيد'], ranges: {}, add: [], remove: [] }); out.merge = await S.merge(cu.id, S.data.customers[1].id);
    out.settings = await S.saveSettings({ routing: 'auto' });
    return JSON.parse(JSON.stringify(out));
  });
  expect(r.can).toEqual({ view: 'F', reply: true, manage: false, phone: true, orders: true, admin: false });
  expect(r.phone).toBe('01200007052'); expect(r.n).toBeGreaterThan(2);
  expect(r.mood.ok).toBe(true); expect(r.tags.ok).toBe(true);
  for (const k of ['edit', 'add', 'seg', 'merge', 'settings']) expect(r[k], k).toMatchObject({ ok: false, reason: 'forbidden' });
});

test('accounts (cs.view N): nothing is read, the data stays empty', async ({ page }) => {
  await signIn(page, ACCOUNTS);
  const a = await page.evaluate(() => JSON.parse(JSON.stringify({ can: window.IBCS.can(), n: window.IBCS.data.customers.length, convs: window.IBCS.data.convs.length })));
  expect(a).toEqual({ can: { view: 'N', reply: false, manage: false, phone: false, orders: true, admin: false }, n: 0, convs: 0 });
  expect(mock.requests.filter((r) => /cs_/.test(r))).toEqual([]);
  expect(mock.unhandled).toEqual([]);
});
