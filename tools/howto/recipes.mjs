// The «إزاي…» guides' screenshots (tools/howto/run.mjs): per guide, its steps in order — `nav` a sidebar page and `tab` one of its tabs,
// `act` (what the member does to reach the step's screen), `hl` the thing to press (an orange ring; the shot is the part of the window
// around it), `clip` the part of the screen the step is about (a popup), else the page without the sidebar.
const vis = (l) => l.filter({ visible: true }).first();
const btn = (pg, name) => vis(pg.getByRole('button', { name, exact: false }));
const tabEl = (pg, name) => vis(pg.locator('.tab, [role="tab"]').filter({ hasText: name }));
const item = (pg, name) => vis(pg.locator('[role="menuitem"], .menu button, .dropdown button, .menu li').filter({ hasText: name }));
const rowMenu = (pg, i = 0) => pg.locator('main button[aria-label^="إجراءات "]:visible').nth(i);
const modal = (pg) => pg.locator('.scrim .modal:visible').last();
const drawer = (pg) => vis(pg.locator('.drawer'));
const nav = async (pg, name) => { await vis(pg.locator('.sidebar .nav-item').filter({ hasText: name })).click(); await pg.waitForTimeout(1500); };
const tab = async (pg, name) => { await tabEl(pg, name).click(); await pg.waitForTimeout(1000); };
const ordMenu = (pg) => vis(pg.locator('button.ibtn[aria-label="المزيد"]'));
const ordItem = (pg, re) => vis(pg.locator('button').filter({ hasText: re }));
const makerName = (pg) => vis(pg.locator('main table tbody tr .vendor-cell'));
const expMenu = (pg) => vis(pg.locator('main button[aria-label="إجراءات الصف"]'));
const custRow = (pg) => vis(pg.locator('button.who-cell'));
const myReq = (pg) => vis(pg.locator('table tbody tr').filter({ hasText: 'TKT-' }));
// the hub's place / status / «شيل من المخزن» are on a line of an open count: «جرد جديد» (the whole hub) opens it, ⋮ on its first line
const countLine = async (pg) => { await btn(pg, 'جرد جديد').click(); await pg.waitForTimeout(500); await vis(modal(pg).getByRole('button', { name: 'ابدأ الجرد' })).click(); await pg.waitForTimeout(1800);
  await vis(pg.locator('.scrim .modal button[aria-label^="إجراءات "]')).click(); await pg.waitForTimeout(400); };
export const RECIPES = {
  'add.product': [
    { nav: 'المنتجات', hl: (pg) => btn(pg, 'دفعة منتجات جديدة') },
    { act: (pg) => btn(pg, 'دفعة منتجات جديدة').click(), clip: modal },
  ],
  'edit.product': [
    { nav: 'المنتجات', tab: 'سجل المنتجات', hl: (pg) => rowMenu(pg, 0) },
    { act: (pg) => rowMenu(pg, 0).click(), hl: (pg) => item(pg, 'تعديل') },
    { act: (pg) => item(pg, 'تعديل').click() },
  ],
  'delete.product': [
    { nav: 'المنتجات', tab: 'سجل المنتجات', hl: (pg) => rowMenu(pg, 0) },
    { act: (pg) => rowMenu(pg, 0).click(), hl: (pg) => item(pg, 'مسح') },
    { act: (pg) => item(pg, 'مسح').click(), clip: modal },
  ],
  'add.maker': [
    { nav: 'المبتكرين', hl: (pg) => btn(pg, 'إضافة مبتكر') },
    { act: (pg) => btn(pg, 'إضافة مبتكر').click(), clip: modal },
  ],
  'edit.maker': [
    { nav: 'المبتكرين', tab: 'سجل المبتكرين', hl: makerName },
    { act: (pg) => makerName(pg).click(), clip: drawer, hl: (pg) => vis(drawer(pg).getByRole('button', { name: 'تعديل' })) },
  ],
  'delete.maker': [
    { nav: 'المبتكرين', tab: 'سجل المبتكرين', act: (pg) => makerName(pg).click(), clip: drawer, hl: (pg) => vis(drawer(pg).locator('button[aria-label="المزيد"]')) },
    { act: (pg) => vis(drawer(pg).locator('button[aria-label="المزيد"]')).click(), hl: (pg) => item(pg, 'حذف المبتكر') },
  ],
  'add.money': [
    { nav: 'الحسابات', tab: 'المصروفات', hl: (pg) => btn(pg, 'إضافة مصروفات') },
    { act: (pg) => btn(pg, 'إضافة مصروفات').click(), hl: (pg) => item(pg, 'سحب') },
    { act: (pg) => item(pg, 'سحب').click(), clip: modal },
  ],
  'add.makerMove': [
    { nav: 'المبتكرين', tab: 'حسابات المبتكرين', hl: (pg) => btn(pg, 'إضافة مبلغ') },
    { act: (pg) => btn(pg, 'إضافة مبلغ').click(), hl: (pg) => vis(pg.locator('[role="menuitem"], .menu button').first()) },
  ],
  'edit.money': [
    { nav: 'الحسابات', tab: 'المصروفات', hl: expMenu },
    { act: (pg) => expMenu(pg).click(), hl: (pg) => item(pg, 'تعديل') },
    { act: (pg) => item(pg, 'تعديل').click(), clip: modal },
  ],
  'delete.money': [
    { nav: 'الحسابات', tab: 'المصروفات', act: (pg) => expMenu(pg).click(), hl: (pg) => item(pg, 'حذف') },
  ],
  'add.category': [
    { nav: 'المنتجات', tab: 'الأقسام', hl: (pg) => btn(pg, 'قسم رئيسي جديد') },
    { act: (pg) => btn(pg, 'قسم رئيسي جديد').click(), clip: modal },
  ],
  'edit.category': [
    { nav: 'المنتجات', tab: 'الأقسام', hl: (pg) => btn(pg, 'إجراءات القسم') },
    { act: (pg) => btn(pg, 'إجراءات القسم').click(), hl: (pg) => item(pg, 'تعديل') },
  ],
  'delete.category': [
    { nav: 'المنتجات', tab: 'الأقسام', act: (pg) => btn(pg, 'إجراءات القسم').click(), hl: (pg) => item(pg, 'حذف') },
  ],
  'add.member': [
    { nav: 'الموارد البشرية', tab: 'الفريق والحضور', hl: (pg) => btn(pg, 'إضافة عضو') },
    { act: (pg) => btn(pg, 'إضافة عضو').click(), clip: modal },
  ],
  'edit.member': [
    { nav: 'الموارد البشرية', tab: 'الفريق والحضور', hl: (pg) => rowMenu(pg, 1) },
    { act: (pg) => rowMenu(pg, 1).click(), hl: (pg) => item(pg, 'فتح الملف') },
    { act: (pg) => item(pg, 'فتح الملف').click(), hl: (pg) => btn(pg, 'تعديل البيانات') },
  ],
  'delete.member': [
    { nav: 'الموارد البشرية', tab: 'الفريق والحضور', act: (pg) => rowMenu(pg, 1).click(), hl: (pg) => item(pg, 'حذف العضو') },
  ],
  'add.order': [
    { nav: 'خدمة العملاء', tab: 'الرسايل', hl: (pg) => btn(pg, 'إنشاء أوردر') },
    { act: (pg) => btn(pg, 'إنشاء أوردر').click(), clip: modal },
  ],
  'edit.order': [
    { nav: 'الأوردرات', hl: ordMenu },
    { act: (pg) => ordMenu(pg).click(), hl: (pg) => ordItem(pg, /^\s*تعديل\s*$/), h: 600 },
    { act: (pg) => ordItem(pg, /^\s*تعديل\s*$/).click(), area: { x: 0, y: 0, width: 1280, height: 680 } },
  ],
  'delete.order': [
    { nav: 'الأوردرات', act: (pg) => ordMenu(pg).click(), hl: (pg) => ordItem(pg, /^\s*مسح\s*$/), h: 600 },
  ],
  'add.sub': [
    { nav: 'الأوردرات', act: async (pg) => { await ordMenu(pg).click(); await pg.waitForTimeout(300); await ordItem(pg, /^\s*تعديل\s*$/).click(); await pg.waitForTimeout(700); await ordItem(pg, 'الأوردرات الفرعية').click(); },
      w: 1280, h: 500, hl: (pg) => ordItem(pg, 'إضافة منتج') },
  ],
  'edit.sub': [
    { nav: 'الأوردرات', act: async (pg) => { await ordMenu(pg).click(); await pg.waitForTimeout(300); await ordItem(pg, /^\s*تعديل\s*$/).click(); await pg.waitForTimeout(700); await ordItem(pg, 'الأوردرات الفرعية').click(); },
      w: 1280, h: 500, hl: (pg) => ordItem(pg, 'تعديل الحالة على الموقع') },
  ],
  'delete.sub': [
    { nav: 'الأوردرات', act: async (pg) => { await ordMenu(pg).click(); await pg.waitForTimeout(300); await ordItem(pg, /^\s*تعديل\s*$/).click(); await pg.waitForTimeout(700); await ordItem(pg, 'الأوردرات الفرعية').click(); },
      w: 1280, h: 500, hl: (pg) => ordItem(pg, 'مسح المنتج') },
  ],
  'add.design': [
    { nav: 'التسويق', tab: 'إنشاء', hl: (pg) => btn(pg, 'ابدأ كامبين') },
    { act: (pg) => btn(pg, 'ابدأ كامبين').click() },
  ],
  'edit.design': [
    { nav: 'التسويق', tab: 'إنشاء', hl: (pg) => vis(pg.locator('main table tbody').getByRole('button', { name: 'افتح' })) },
    { act: (pg) => vis(pg.locator('main table tbody').getByRole('button', { name: 'افتح' })).click() },
  ],
  'delete.design': [
    { nav: 'التسويق', tab: 'إنشاء', act: (pg) => vis(pg.locator('main button[aria-label="إجراءات"]')).click(), hl: (pg) => item(pg, 'احذف الكامبين') },
  ],
  // «إجراءات ذكية» (2026-11-28-smart-actions.md): the customer, the HR request, the hub's piece and the brand
  'add.customer': [
    { nav: 'خدمة العملاء', tab: 'العملاء', hl: (pg) => btn(pg, 'إضافة عميل') },
    { act: (pg) => btn(pg, 'إضافة عميل').click(), clip: modal },
  ],
  'edit.customer': [
    { nav: 'خدمة العملاء', tab: 'العملاء', hl: custRow },
    { act: (pg) => custRow(pg).click(), clip: drawer, hl: (pg) => vis(drawer(pg).getByRole('button', { name: 'تعديل', exact: true })) },
  ],
  'delete.customer': [
    { nav: 'خدمة العملاء', tab: 'العملاء', act: async (pg) => { await custRow(pg).click(); await pg.waitForTimeout(700); await vis(drawer(pg).locator('button[aria-label="إجراءات"]')).click(); }, hl: (pg) => item(pg, 'دمج مع عميل تاني') },
    { act: (pg) => item(pg, 'دمج مع عميل تاني').click(), clip: modal },
  ],
  'add.hr': [
    { nav: 'طلبات الفريق', hl: (pg) => btn(pg, 'فتح طلب') },
    { act: async (pg) => { await btn(pg, 'فتح طلب').click(); await pg.waitForTimeout(600); await modal(pg).locator('#t-type').click(); await pg.waitForTimeout(300); await vis(pg.getByRole('option', { name: 'طلب إجازة' })).click(); }, clip: modal },
  ],
  'edit.hr': [
    { go: 'profile-requests-mine', hl: myReq },
  ],
  'delete.hr': [
    { go: 'profile-requests-mine', hl: myReq },
  ],
  'add.lot': [
    { nav: 'المخزون', hl: (pg) => btn(pg, 'استلام في المخزن') },
    { act: (pg) => btn(pg, 'استلام في المخزن').click(), clip: modal },
  ],
  'edit.lot': [
    { nav: 'المخزون', tab: 'سجل المخزون', act: (pg) => rowMenu(pg, 0).click(), hl: (pg) => item(pg, 'تسوية كمية') },
    { nav: 'المخزون', tab: 'الجرد', act: countLine, hl: (pg) => item(pg, 'تعديل المكان'), w: 1280, h: 560 },
  ],
  'delete.lot': [
    { nav: 'المخزون', tab: 'الجرد', act: countLine, hl: (pg) => item(pg, 'شيل من المخزن'), w: 1280, h: 560 },
    { act: (pg) => item(pg, 'شيل من المخزن').click(), clip: modal },
  ],
  'add.brand': [
    { nav: 'المبتكرين', tab: 'سجل المبتكرين', hl: makerName },
    { act: (pg) => makerName(pg).click(), clip: drawer, hl: (pg) => vis(drawer(pg).locator('[data-add-brand]')) },
  ],
  'edit.brand': [
    { nav: 'المبتكرين', tab: 'سجل المبتكرين', act: (pg) => makerName(pg).click(), clip: drawer, hl: (pg) => vis(drawer(pg).locator('[data-brand-menu]')) },
    { act: (pg) => vis(drawer(pg).locator('[data-brand-menu]')).click(), hl: (pg) => item(pg, 'تعديل') },
  ],
  'delete.brand': [
    { nav: 'المبتكرين', tab: 'سجل المبتكرين', act: async (pg) => { await makerName(pg).click(); await pg.waitForTimeout(600); await vis(drawer(pg).locator('[data-brand-menu]')).click(); }, hl: (pg) => item(pg, 'نقل لمبتكر تاني') },
  ],
  'settle.maker': [
    { nav: 'المبتكرين', tab: 'حسابات المبتكرين', hl: (pg) => rowMenu(pg, 1) },
    { act: (pg) => rowMenu(pg, 1).click(), hl: (pg) => item(pg, 'تسوية دلوقتي') },
    { act: (pg) => item(pg, 'تسوية دلوقتي').click(), clip: modal },
  ],
};
export const NAV = nav; export const TAB = tab;
