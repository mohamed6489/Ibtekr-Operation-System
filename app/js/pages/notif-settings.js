/* Ibtekr — «الإعدادات › التنبيهات» in the notifications' new structure (Safwat 24 Nov — docs/superpowers/plans/2026-11-24-notifications.md,
   0157). Not a block: block 17 calls IBNotifSettings.render(redraw) when the tree is there. The admin builds what the bell shows, as it
   shows it — the main sections (the bell's groups), the sub-sections under them (the bell's filters), and under each sub-section its
   alerts: the element › type › state from the catalogue (IBNotifCatalog), the send time and its repeat, the visibility, the channels
   (the bell only for now), the recipients (the system's roles) and the message. Every write goes through IBSettings (admin RPCs). */
(function () {
  'use strict';
  const U = () => window.IBUI; const K = () => window.IBKit; const ST = () => window.IBSettings; const C = () => window.IBNotifCatalog;
  const h = (...a) => U().h(...a);
  // the main sections as tabs, one shown at a time (Safwat 24 Nov — «في تابس اسهل من تحت بعضها»); `tab` = the open one, `want` = a new
  // main section's name to open once it is read back
  const state = { tab: null, want: null };
  const say = (r, ok) => { const k = K(); if (r && r.ok) { if (ok) k.toast(ok); } else k.toast((r && r.message) || 'ماتحفظش — جرّب تاني', 'error'); };
  const t12 = (hhmm) => (K() && K().t12 ? K().t12(hhmm) : hhmm);
  const TIMES = (() => { const out = []; for (let i = 0; i < 48; i++) { const hh = String(Math.floor(i / 2)).padStart(2, '0'); out.push(hh + ':' + (i % 2 ? '30' : '00')); } return out; })();
  const roleList = () => { const s = ST(); const r = s && s.roles ? s.roles() : []; return (Array.isArray(r) ? r : []).filter((x) => !x.hidden).map((x) => ({ id: x.id, name: x.name || x.id })); };
  const roleName = (id) => (roleList().find((r) => r.id === id) || { name: id }).name;
  const lists = () => (ST() && ST().notifLists ? ST().notifLists() : {});
  const showText = (r) => { const c = C(); const s = (c.SHOWS.find(([k]) => k === r.show) || [, ''])[1]; return r.show === 'fixed' ? s + ' · ' + (r.hours >= 168 ? 'أسبوع' : r.hours + ' ساعة') : r.hours ? s + ' · بعد ' + r.hours + ' ساعات' : s; };
  const repeatText = (r) => { const c = C(); const s = (c.REPEATS.find(([k]) => k === r.repeat) || [, ''])[1]; return r.repeat === 'days' ? s + ' (' + (r.days || []).join('، ') + ')' : s; };
  const pathOne = (r) => { const c = C(); const e = c.el(r.element); const t = c.typeOf(r.element, r.type); const s = c.stateOf(r.element, r.type, r.state, lists());
    return [e ? e.label : r.element, t ? t.label : r.type, s ? s.label : r.state].join(' › ') + (r.sub ? ' · ' + r.sub : ''); };
  // with its extra elements (0162): each on its own after «+»
  const pathText = (r) => [pathOne(r)].concat((Array.isArray(r.conds) ? r.conds : []).map(pathOne)).join(' + ');

  // ---------- the section names (add / rename)
  function nameForm(title, value, onSave) {
    let v = value || ''; let err = '';
    const field = () => U().TextInput({ id: 'ns-name', label: 'الاسم', required: true, value: v, maxlength: 40, error: err, onInput: (x) => { v = x; } });
    let box = h('div', null, field());
    const m = U().Modal({ title, body: [box], footer: [U().Button({ label: 'إلغاء', onClick: () => m.close() }), U().Button({ type: 'primary', label: 'حفظ', onClick: async () => {
      const n = String(v || '').trim(); if (!n || n.length > 40 || /[<>]/.test(n)) { err = 'اكتب اسم لحد 40 حرف من غير < >'; box.replaceChildren(field()); return; }
      const r = await onSave(n); if (r && r.ok) m.close(); else { err = (r && r.message) || 'ماتحفظش'; box.replaceChildren(field()); } } })] });
    return m;
  }

  // ---------- the alert's form (Safwat's drawing «إضافة تنبيه»)
  function ruleForm(sub, rule, redraw) {
    const c = C(); const L = lists();
    const f = Object.assign({ section_id: sub.id, name: '', element: '', type: '', state: '', sub: null, param: null, at: '09:00', repeat: '24h', days: [], show: 'until_state', hours: 0, roles: [], channels: ['bell'], template: '', active: true, mode: 'single', conds: [], level: null }, rule ? JSON.parse(JSON.stringify(rule)) : {});
    if (!Array.isArray(f.conds)) f.conds = [];
    // a new rule takes its level's «تفاصيل الظهور» (the bell's redesign decision 1) — with all its elements (decision 8: the highest)
    // the level: the admin's pick (`f.level` — Safwat 24 Nov «المستخدم يقدر يختار»), else the state's own (with all its elements: the highest)
    const levelNow = () => (c.levelOfAll ? c.levelOfAll(f) : c.levelOf(f));
    const reShow = () => { if (!rule && c.showOf) Object.assign(f, c.showOf(levelNow(), c.kindOf(f))); };
    // an extra element (Safwat 24 Nov — «إمكانية لإضافة أكتر من عنصر في التنبيه الواحد»): the same three lists, × takes it off
    const condRow = (x, i) => {
      const ts = (c.el(x.element) || { types: [] }).types; const ss = x.element && x.type ? c.statesOf(x.element, x.type, L) : []; const s2 = c.stateOf(x.element, x.type, x.state, L); const n = i + 2;
      return h('div', { class: 'nr-cond', 'data-nr-cond': String(i) },
        h('div', { class: 'nr-cond-h' }, h('span', { class: 'nr-cond-n' }, 'العنصر ' + n), h('button', { type: 'button', class: 'nr-cond-x', 'aria-label': 'شيل العنصر ' + n, title: 'شيل العنصر ' + n, 'data-nr-cond-x': String(i), onClick: () => { f.conds.splice(i, 1); reShow(); draw(); } }, '×')),
        h('div', { class: 'row cols3' },
          U().Select({ id: 'nr-el-' + n, label: 'العنصر', required: true, value: x.element || null, options: c.ELEMENTS.map((e) => ({ value: e.id, label: e.label })), onChange: (v) => { Object.assign(x, { element: v, type: '', state: '', sub: null, param: null }); draw(); } }),
          U().Select({ id: 'nr-type-' + n, label: 'نوع التنبيه', required: true, disabled: !x.element, value: x.type || null, options: ts.map((t) => ({ value: t.id, label: t.label })), onChange: (v) => { Object.assign(x, { type: v, state: '', sub: null, param: null }); draw(); } }),
          U().Select({ id: 'nr-state-' + n, label: 'الوضع', required: true, disabled: !x.type, value: x.state || null, options: ss.map((t) => ({ value: t.id, label: t.label })), onChange: (v) => { x.state = v; const s3 = c.stateOf(x.element, x.type, v, L); x.param = s3 && s3.param ? s3.param.def : null; reShow(); draw(); } })),
        s2 && s2.param ? U().TextInput({ id: 'nr-param-' + n, label: s2.param.label, inputmode: 'numeric', dir: 'ltr', value: x.param == null ? String(s2.param.def) : String(x.param), onInput: (v) => { x.param = v === '' ? null : Number(String(v).replace(/[^\d.]/g, '')); } }) : null);
    };
    let err = ''; const body = h('div', { class: 'nr-form', 'data-nr-form': '' });
    const types = () => { const e = c.el(f.element); return e ? e.types : []; };
    const states = () => (f.element && f.type ? c.statesOf(f.element, f.type, L) : []);
    const curState = () => c.stateOf(f.element, f.type, f.state, L);
    // a numbered step with its icon (the page's redesign — Safwat 24 Nov «أحسن شكل UI و UX … منظم مع التركيز في التفاصيل»)
    let step = 0;
    const sec = (head, ...kids) => { const [icon, title, note] = Array.isArray(head) ? head : [null, head, null]; step++;
      return h('div', { class: 'nr-sec' }, h('div', { class: 'nr-sec-h' }, h('span', { class: 'nr-step' }, String(step)), icon ? U().Icon(icon, 'sm') : null, h('b', null, title), note ? h('span', { class: 'nr-sec-note' }, note) : null), ...kids); };
    const LV_TEXT = { critical: 'أول حاجة في الجرس', important: 'بعد الحرج', normal: 'بعد المهم', info: 'آخر حاجة — بيختفي بعد يوم بالكتير' };
    const draw = () => {
      const st = curState(); const t = c.typeOf(f.element, f.type); step = 0;
      const many = f.conds.length > 0;
      body.replaceChildren(
        sec(['bell', 'تفاصيل التنبيه', 'إيه اللي يتابعه'],
          U().TextInput({ id: 'nr-name', label: 'اسم التنبيه', required: true, value: f.name, maxlength: 80, onInput: (v) => { f.name = v; } }),
          h('div', { class: 'nr-cond first' + (many ? '' : ' solo') }, many ? h('div', { class: 'nr-cond-h' }, h('span', { class: 'nr-cond-n' }, 'العنصر 1')) : null, h('div', { class: 'row cols3' },
            U().Select({ id: 'nr-el', label: 'العنصر', required: true, value: f.element || null, options: c.ELEMENTS.map((e) => ({ value: e.id, label: e.label })), onChange: (v) => { f.element = v; f.type = ''; f.state = ''; f.sub = null; f.param = null; draw(); } }),
            U().Select({ id: 'nr-type', label: 'نوع التنبيه', required: true, disabled: !f.element, value: f.type || null, options: types().map((x) => ({ value: x.id, label: x.label })), onChange: (v) => { f.type = v; f.state = ''; f.sub = null; f.param = null; draw(); } }),
            U().Select({ id: 'nr-state', label: 'الوضع', required: true, disabled: !f.type, value: f.state || null, options: states().map((x) => ({ value: x.id, label: x.label })), onChange: (v) => { f.state = v; const s2 = c.stateOf(f.element, f.type, v, L); f.param = s2 && s2.param ? s2.param.def : null;
              reShow(); draw(); } }))),
          t && t.dyn === 'ticket' ? U().Select({ id: 'nr-sub', label: 'نوع الطلب', value: f.sub || '', options: [{ value: '', label: 'كل الأنواع' }].concat((L.ticket || []).map((x) => ({ value: x, label: (window.IbtekrTickets && window.IbtekrTickets.label ? window.IbtekrTickets.label(x) : x) }))), onChange: (v) => { f.sub = v || null; } }) : null,
          st && st.param ? U().TextInput({ id: 'nr-param', label: st.param.label, inputmode: 'numeric', dir: 'ltr', value: f.param == null ? String(st.param.def) : String(f.param), onInput: (v) => { f.param = v === '' ? null : Number(String(v).replace(/[^\d.]/g, '')); } }) : null,
          f.conds.map(condRow),
          h('div', { class: 'nr-cond-add' }, U().Button({ size: 'sm', icon: 'plus', label: 'عنصر تاني', disabled: !st || f.conds.length >= (c.CONDS_MAX || 5), attrs: { 'data-nr-cond-add': '' }, onClick: () => { f.conds.push({ element: '', type: '', state: '', sub: null, param: null }); draw(); } }),
            f.conds.length >= (c.CONDS_MAX || 5) ? h('span', { class: 't-small muted' }, 'لحد ' + (c.CONDS_MAX || 5) + ' عناصر زيادة') : null),
          // «طريقة التنبيه» — two cards to pick from (فردي / تقرير), each saying what lands in the bell
          c.MODES ? h('div', { class: 'nr-modes', role: 'radiogroup', 'aria-label': 'طريقة التنبيه', 'data-nr-modes': '' }, h('span', { class: 't-label' }, 'طريقة التنبيه'),
            h('div', { class: 'nr-mode-cards' }, [['single', 'bell', 'فردي', 'تنبيه لكل حاجة لوحدها — من كل عنصر'], ['report', 'sheet', 'تقرير', 'تنبيه واحد بجدول فيه كل الحاجات من كل العناصر']].map(([k, ic, l, d]) =>
              h('button', { type: 'button', role: 'radio', class: 'nr-mode-card' + ((f.mode || 'single') === k ? ' on' : ''), 'aria-checked': String((f.mode || 'single') === k), 'data-nr-mode-pick': k, onClick: () => { f.mode = k; draw(); } },
                U().Icon(ic, 'sm'), h('b', null, l), h('span', null, d))))) : null,
          // «أهمية التنبيه» — four to pick from, highest first (the bell's order); «تلقائي» = the state's own
          st && c.LEVELS ? h('div', { class: 'nr-level-row', 'data-nr-level': levelNow() }, h('span', { class: 't-label' }, 'أهمية التنبيه'),
            h('div', { class: 'nr-lv-pick', role: 'radiogroup', 'aria-label': 'أهمية التنبيه' }, c.LEVELS.map(([k, l]) => h('button', { type: 'button', role: 'radio', class: 'nr-lv-opt lv-' + k + (levelNow() === k ? ' on' : ''), 'aria-checked': String(levelNow() === k), 'data-nr-level-pick': k, title: LV_TEXT[k],
              onClick: () => { f.level = k; if (!rule && c.showOf) Object.assign(f, c.showOf(k, c.kindOf(f))); draw(); } }, h('b', null, l), h('span', null, LV_TEXT[k])))),
            h('span', { class: 't-small muted' }, f.level ? 'اخترتها إنت' : 'تلقائي من الوضع' + (many ? ' (أعلى أهمية بين العناصر)' : ''))) : null,
          st ? h('p', { class: 't-small help', style: 'margin:0' }, f.mode === 'report' ? 'بيتجمع كل اللي في العناصر دي في تقرير واحد يتجدد بالتكرار.' : st.kind === 'event' ? 'بيتبعت مع كل حدث جديد من الوقت ده كل يوم.' : st.kind === 'due' ? 'بيتبعت مرة لما الميعاد يقرب.' : 'بيتبعت لكل حاجة في الوضع ده ويتجدد بالتكرار طول ما هي فيه.') : null),
        sec(['clock', 'وقت الإرسال', 'إمتى بيشتغل'],
          h('div', { class: 'row cols2' },
            U().Select({ id: 'nr-at', label: 'الوقت', value: f.at, options: TIMES.map((x) => ({ value: x, label: t12(x) })), search: false, onChange: (v) => { f.at = v; } }),
            U().Select({ id: 'nr-repeat', label: 'التكرار', value: f.repeat, options: c.REPEATS.map(([k, l]) => ({ value: k, label: l })), onChange: (v) => { f.repeat = v; draw(); } })),
          f.repeat === 'days' ? h('div', { class: 'nr-days', role: 'group', 'aria-label': 'أيام الشهر' }, Array.from({ length: 31 }, (_, i) => i + 1).map((d) => h('button', { type: 'button', class: 'chip' + (f.days.includes(d) ? ' on' : ''), 'aria-pressed': String(f.days.includes(d)),
            onClick: () => { f.days = f.days.includes(d) ? f.days.filter((x) => x !== d) : f.days.concat(d).sort((a, b) => a - b); draw(); } }, String(d)))) : null),
        sec(['eye', 'تفاصيل الظهور', 'يفضل في الجرس لحد إمتى'],
          K().Radios({ name: 'nr-show', label: 'الظهور', value: f.show, options: c.SHOWS.map(([k, l]) => ({ value: k, label: l })), onChange: (v) => { f.show = v; f.hours = c.SHOW_HOURS[v][0]; draw(); } }),
          U().Select({ id: 'nr-hours', label: f.show === 'fixed' ? 'المدة' : 'يختفي', value: String(f.hours), options: c.SHOW_HOURS[f.show].map((n) => ({ value: String(n), label: f.show === 'fixed' ? (n >= 168 ? 'أسبوع' : n + ' ساعة') : n ? 'بعد ' + n + ' ساعات' : 'في نفس الوقت' })), onChange: (v) => { f.hours = Number(v); } })),
        sec(['send', 'تفاصيل الإرسال', 'لمين وعلى أنهي قناة'],
          h('div', { class: 'nr-checks', 'data-nr-channels': '' }, c.CHANNELS.map(([k, l]) => { const live = c.LIVE_CHANNELS.includes(k);
            const off = k !== 'bell' && !gates()[k]; // the channel's switch above the tree is off: the rule keeps it, nothing is sent
            return K().Checkbox({ label: l + (!live ? ' (قريبًا)' : off ? (k === 'whatsapp' ? ' (واقف لحد تشغيل الـ API)' : ' (مقفول من فوق)') : ''), checked: f.channels.includes(k), disabled: !live, onChange: (v) => { f.channels = v ? f.channels.concat(k) : f.channels.filter((x) => x !== k); draw(); } }); })),
          h('div', { class: 't-label', style: 'margin-top:8px' }, 'المستلم'),
          h('div', { class: 'nr-checks', 'data-nr-roles': '' }, roleList().map((r) => K().Checkbox({ label: r.name, checked: f.roles.includes(r.id), onChange: (v) => { f.roles = v ? f.roles.concat(r.id) : f.roles.filter((x) => x !== r.id); draw(); } }))),
          h('p', { class: 't-small help', style: 'margin:0' }, 'بيوصل لأعضاء الأدوار دي اللي بيشوفوا الصفحة بتاعته بس.')),
        sec(['msg', 'قالب الرسالة', 'اختياري'],
          U().Textarea({ id: 'nr-tpl', label: 'نص التنبيه', value: f.template || '', maxlength: 500, rows: 3, placeholder: 'مثال: {الرقم} لسه ما اتأكدش — {التفاصيل}', onInput: (v) => { f.template = v; } }),
          h('div', { class: 'nr-vars t-small' }, 'متغيرات: ', ['{الاسم}', '{الرقم}', '{الوضع}', '{التفاصيل}'].map((x) => h('code', null, x)))),
        err ? h('p', { class: 'ferr t-small', role: 'alert' }, err) : null);
    };
    draw();
    const m = U().Modal({ title: rule ? 'تعديل التنبيه' : 'إضافة تنبيه — ' + sub.name, body: [body], footer: [U().Button({ label: 'إلغاء', onClick: () => m.close() }), U().Button({ type: 'primary', label: 'حفظ', attrs: { 'data-nr-save': '' }, onClick: async () => {
      const r = await ST().notifRuleSave(f); if (r.ok) { m.close(); K().toast('اتحفظ التنبيه'); redraw(); } else { err = r.message || 'ماتحفظش'; draw(); } } })] });
    m.el.classList.add('nr-modal');
    return m;
  }

  // ---------- the tree
  // the rule's roles on its card (Safwat 24 Nov — the bell's redesign decision 7): a green label each with × that takes it off, and a small
  // «+» that adds one from the roles left — saved at once; the last role stays (a rule needs one)
  function roleChips(r, redraw) {
    const save = async (roles) => { const x = await ST().notifRuleSave(Object.assign({}, r, { roles })); say(x, 'اتحفظ'); redraw(); };
    const left = roleList().filter((x) => !(r.roles || []).includes(x.id));
    const wrap = h('div', { class: 'pop-anchor', 'data-popover-root': '' });
    const add = h('button', { type: 'button', class: 'nr-role-add', 'aria-label': 'إضافة دور', title: 'إضافة دور', 'aria-haspopup': 'menu', 'aria-expanded': 'false', disabled: !left.length }, U().Icon('plus', 'sm'));
    const pop = U().popover(wrap, add, (close) => U().DropdownMenu({ role: 'menu', end: true, options: left.map((x) => ({ value: x.id, label: x.name })), onSelect: (id) => { close(); save((r.roles || []).concat(id)); } }));
    add.addEventListener('click', pop.toggle); wrap.append(add);
    return h('div', { class: 'nr-roles', 'data-nr-roles-of': r.id }, (r.roles || []).map((x) => h('span', { class: 'nr-role' }, roleName(x),
      h('button', { type: 'button', class: 'x', 'aria-label': 'شيل ' + roleName(x), title: (r.roles || []).length < 2 ? 'لازم دور واحد على الأقل' : 'شيل ' + roleName(x), disabled: (r.roles || []).length < 2,
        onClick: () => save((r.roles || []).filter((y) => y !== x)) }, '×'))), wrap);
  }
  // the rule's card: its level on the edge and as a badge, the name, each element a chip («+» between them), the time / repeat / visibility /
  // channels as small icon lines, «تقرير» when it is one, the roles, the switch and ⋮
  const CH_ICON = { bell: 'bell', email: 'mail', whatsapp: 'whatsapp' }; const CH_NAME = { bell: 'الجرس', email: 'إيميل', whatsapp: 'واتساب' };
  const LV_NAME = { critical: 'حرج', important: 'مهم', normal: 'عادي', info: 'للمعرفة' };
  const levelOfRule = (r) => { const c = C(); return c.levelOfAll ? c.levelOfAll(r) : c.levelOf ? c.levelOf(r) : 'important'; };
  function ruleRow(sub, r, redraw) {
    const lv = levelOfRule(r); const parts = [r].concat(Array.isArray(r.conds) ? r.conds : []);
    const meta = (icon, text, attrs) => h('span', Object.assign({ class: 'nr-m' }, attrs || {}), U().Icon(icon, 'sm'), h('span', null, text));
    return h('div', { class: 'nr-rule lv-' + lv + (r.active === false ? ' off' : ''), 'data-nr-rule': r.id },
      h('div', { class: 'nr-rule-main' },
        h('div', { class: 'nr-rule-top' }, h('span', { class: 'nr-lv lv-' + lv, title: 'الأهمية' }, LV_NAME[lv] || lv), h('b', { class: 'nr-name' }, r.name),
          r.mode === 'report' ? h('span', { class: 'nr-mode-tag', 'data-nr-mode': 'report' }, 'تقرير') : null, r.active === false ? h('span', { class: 'nr-off-tag' }, 'متوقف') : null),
        h('div', { class: 'nr-path' }, parts.map((x, i) => [i ? h('span', { class: 'nr-plus' }, ' + ') : null, h('span', { class: 'nr-part' }, pathOne(x))]).flat()),
        h('div', { class: 'nr-meta' }, meta('clock', t12(r.at) + ' · ' + repeatText(r)), meta('eye', showText(r)),
          h('span', { class: 'nr-m nr-chs', title: (r.channels || ['bell']).map((k) => CH_NAME[k] || k).join('، ') }, (r.channels || ['bell']).map((k) => U().Icon(CH_ICON[k] || 'bell', 'sm')), h('span', null, (r.channels || ['bell']).map((k) => CH_NAME[k] || k).join(' · ')))),
        roleChips(r, redraw)),
      h('div', { class: 'nr-rule-side' }, K().Switch({ id: 'nr-on-' + r.id, label: r.active === false ? 'متوقف' : 'شغّال', checked: r.active !== false, onChange: async (v) => { const x = await ST().notifRuleSave(Object.assign({}, r, { active: v })); say(x); redraw(); } })),
      K().RowMenu([{ label: 'تعديل', icon: 'edit', run: () => ruleForm(sub, r, redraw) },
        { label: 'حذف', icon: 'trash', danger: true, run: () => K().confirm({ title: 'حذف التنبيه', text: '«' + r.name + '» هيتمسح وتنبيهاته هتختفي من الجرس.', okLabel: 'احذف', okType: 'danger', onOk: async () => { say(await ST().notifRuleDelete(r.id), 'اتمسح'); redraw(); } }) }]));
  }
  const move = async (list, i, d, redraw) => { const ids = list.map((x) => x.id); const j = i + d; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; say(await ST().notifSectionOrder(ids)); redraw(); };
  function subBox(main, sub, i, redraw) {
    const on = sub.rules.filter((r) => r.active !== false).length;
    return h('div', { class: 'nr-sub', 'data-nr-sub': sub.id },
      h('div', { class: 'nr-sub-h' }, h('span', { class: 'nr-sub-dot' }), h('b', null, sub.name), h('span', { class: 'nr-count' }, sub.rules.length + ' تنبيه' + (on < sub.rules.length ? ' · ' + (sub.rules.length - on) + ' متوقف' : '')), h('span', { class: 'sp' }),
        U().Button({ size: 'sm', icon: 'plus', label: 'تنبيه', attrs: { 'data-nr-add': sub.id }, onClick: () => ruleForm(sub, null, redraw) }),
        K().RowMenu([{ label: 'لفوق', icon: 'chevU', run: () => move(main.subs, i, -1, redraw) }, { label: 'لتحت', icon: 'chevD', run: () => move(main.subs, i, 1, redraw) },
          { label: 'تغيير الاسم', icon: 'edit', run: () => nameForm('تغيير اسم القسم الفرعي', sub.name, (n) => ST().notifSectionSave({ id: sub.id, parentId: main.id, name: n }).then((r) => { if (r.ok) redraw(); return r; })) },
          { label: 'حذف', icon: 'trash', danger: true, run: () => K().confirm({ title: 'حذف القسم الفرعي', text: '«' + sub.name + '» وتنبيهاته (' + sub.rules.length + ') هيتمسحوا.', okLabel: 'احذف', okType: 'danger', onOk: async () => { say(await ST().notifSectionDelete(sub.id), 'اتمسح'); redraw(); } }) }])),
      sub.rules.length ? h('div', { class: 'nr-rules' }, sub.rules.map((r) => ruleRow(sub, r, redraw))) : h('div', { class: 'nr-empty' }, U().Icon('bell', 'sm'), h('span', null, 'مفيش تنبيهات هنا — «+ تنبيه» يضيف واحد.')));
  }
  // the open main section: its head (name, counts, «+ قسم فرعي», ⋮) and its sub-sections under it — the tab above picks which
  function mainBox(main, i, all, redraw) {
    const n = main.subs.reduce((x, y) => x + y.rules.length, 0);
    const crit = main.subs.reduce((x, y) => x + y.rules.filter((r) => r.active !== false && levelOfRule(r) === 'critical').length, 0);
    return h('div', { class: 'card nr-main open', 'data-nr-main': main.id, role: 'tabpanel' },
      h('div', { class: 'nr-main-h' }, h('div', { class: 'nr-tog' },
          h('span', { class: 'nr-ico' }, U().Icon(main.icon || 'bell', 'sm')), h('span', { class: 'nr-main-t' }, h('b', null, main.name), h('span', { class: 'nr-main-sub' }, main.subs.length + ' قسم فرعي · ' + n + ' تنبيه' + (crit ? ' · ' : ''), crit ? h('span', { class: 'nr-crit' }, crit + ' حرج') : null))),
        h('span', { class: 'sp' }),
        U().Button({ size: 'sm', icon: 'plus', label: 'قسم فرعي', attrs: { 'data-nr-add-sub': main.id }, onClick: () => nameForm('قسم فرعي جديد — ' + main.name, '', (nm) => ST().notifSectionSave({ parentId: main.id, name: nm }).then((r) => { if (r.ok) redraw(); return r; })) }),
        K().RowMenu([{ label: 'لليمين', icon: 'chevR', run: () => move(all, i, -1, redraw) }, { label: 'للشمال', icon: 'chevL', run: () => move(all, i, 1, redraw) },
          { label: 'تغيير الاسم', icon: 'edit', run: () => nameForm('تغيير اسم القسم', main.name, (nm) => ST().notifSectionSave({ id: main.id, name: nm }).then((r) => { if (r.ok) redraw(); return r; })) },
          { label: 'حذف', icon: 'trash', danger: true, run: () => K().confirm({ title: 'حذف القسم', text: '«' + main.name + '» بأقسامه الفرعية وتنبيهاته هيتمسحوا.', okLabel: 'احذف', okType: 'danger', onOk: async () => { say(await ST().notifSectionDelete(main.id), 'اتمسح'); state.tab = null; redraw(); } }) }])),
      h('div', { class: 'nr-subs' }, main.subs.length ? main.subs.map((x, j) => subBox(main, x, j, redraw)) : h('div', { class: 'nr-empty' }, U().Icon('bell', 'sm'), h('span', null, 'مفيش أقسام فرعية — «+ قسم فرعي» يضيف واحد.'))));
  }
  // the tabs: a main section each with its alerts' count (the stopped left out), the critical ones marked
  function mainTabs(mains, active, redraw) {
    const t = U().Tabs({ items: mains.map((m) => ({ id: m.id, label: m.name, count: m.subs.reduce((x, y) => x + y.rules.filter((r) => r.active !== false).length, 0) })), active, onChange: (id) => { state.tab = id; redraw(true); } });
    t.setAttribute('aria-label', 'أقسام التنبيهات'); t.setAttribute('data-nr-tabs', ''); t.classList.add('nr-tabs');
    t.querySelectorAll('[role=tab]').forEach((b, k) => { b.setAttribute('data-nr-tab', mains[k].id); b.removeAttribute('aria-controls'); });
    return t;
  }
  // the outbound channels as a whole (Safwat 24 Nov: «الايميل ممكن تشغلوا و الواتساب … يبقا واقف علي تشغيل ال API»): settings «notif».channels
  // — a rule that names e-mail / WhatsApp sends only while its switch here is on; the admin's, saved at once
  const gates = () => { const n = ST() && ST().section ? ST().section('notif') : {}; const c = n && n.channels && typeof n.channels === 'object' ? n.channels : {}; return { email: c.email === true, whatsapp: c.whatsapp === true }; };
  function channelsBox(redraw) {
    const g = gates(); const n = ST().section('notif') || {};
    const flip = async (k, v) => { const r = await ST().save('notif', { channels: Object.assign({}, g, { [k]: !!v }) }); say(r, v ? 'اتشغّل' : 'اتقفل'); redraw(true); };
    const tile = (k, icon, name, help, id) => h('div', { class: 'nr-ch' + (g[k] ? ' on' : '') }, h('span', { class: 'nr-ch-ico' }, U().Icon(icon, 'sm')),
      h('div', { class: 'nr-ch-t' }, h('b', null, name), h('span', null, help)),
      h('span', { class: 'nr-ch-st' }, g[k] ? 'شغّال' : 'مقفول'), K().Switch({ id, label: name, checked: g[k], onChange: (v) => flip(k, v) }));
    return h('div', { class: 'nr-channels', 'data-nr-out': '' },
      h('div', { class: 'nr-block-h' }, h('b', null, 'إرسال برّه الجرس'), h('span', null, 'التنبيه اللي عليه «إيميل» أو «واتساب» بيتبعت للمستلمين كمان — رسالة واحدة لكل عضو في كل مرة التنبيه يشتغل.')),
      h('div', { class: 'nr-ch-row' },
        tile('email', 'mail', 'الإيميل', 'من إيميل التنبيهات (Resend) لإيميل العضو', 'nr-out-email'),
        tile('whatsapp', 'whatsapp', 'الواتساب', 'واقف لحد تشغيل الـ API — من واتساب 1 بالقالب «' + (typeof n.whatsappTemplate === 'string' && n.whatsappTemplate ? n.whatsappTemplate : 'ibtekr_alert') + '»', 'nr-out-wa')));
  }
  // the numbers on top: the sections, the alerts on, off and critical
  function summary(tree) {
    const all = tree.mains.flatMap((m) => m.subs.flatMap((x) => x.rules)); const on = all.filter((r) => r.active !== false);
    const subs = tree.mains.reduce((x, m) => x + m.subs.length, 0);
    const tile = (icon, n, label, cls) => h('div', { class: 'nr-stat' + (cls ? ' ' + cls : '') }, h('span', { class: 'nr-stat-ico' }, U().Icon(icon, 'sm')), h('div', { class: 'nr-stat-t' }, h('b', { class: 'nr-stat-n' }, String(n)), h('small', null, label)));
    return h('div', { class: 'nr-stats', 'data-nr-stats': '' },
      tile('bell', tree.mains.length + ' / ' + subs, 'قسم رئيسي / فرعي'), tile('checkCircle', on.length, 'تنبيه شغّال', 'ok'),
      tile('alert', on.filter((r) => levelOfRule(r) === 'critical').length, 'حرج', 'crit'), tile('clock', all.length - on.length, 'متوقف', 'off'));
  }
  // redraw(true) = the same tree drawn again; redraw() = read it again from the server first
  function render(R) {
    const tree = ST() && ST().notifTreeNow ? ST().notifTreeNow() : null;
    const redraw = (local) => { if (local) { R(); return; } ST().notifTree(true).then(() => R()); };
    if (!tree) return [K().Empty('بنحمّل التنبيهات…', '')];
    // the open tab: a main section just added, else the one picked, else the first
    const wanted = state.want ? tree.mains.find((m) => m.name === state.want) : null; if (wanted) { state.tab = wanted.id; state.want = null; }
    let at = tree.mains.findIndex((m) => m.id === state.tab); if (at < 0) at = 0; const active = tree.mains[at];
    return [K().Section('أقسام التنبيهات', [
      h('p', { class: 'nr-intro' }, U().Icon('bell', 'sm'), h('span', null, 'الجرس بيتعرض بنفس التقسيمة دي بالظبط: كل قسم رئيسي مجموعة، وأقسامه الفرعية فلاتر، وتحت كل فرعي تنبيهاته.')),
      summary(tree),
      channelsBox(redraw),
      h('div', { class: 'nr-tree', 'data-nr-tree': '', 'data-set-instant': '' }, tree.mains.length ? [mainTabs(tree.mains, active.id, redraw), mainBox(active, at, tree.mains, redraw)]
        : h('div', { class: 'nr-empty' }, U().Icon('bell', 'sm'), h('span', null, 'مفيش أقسام — «+ قسم رئيسي» يضيف واحد.')))],
      [U().Button({ type: 'primary', icon: 'plus', label: 'قسم رئيسي', attrs: { 'data-nr-add-main': '' }, onClick: () => nameForm('قسم رئيسي جديد', '', (nm) => ST().notifSectionSave({ name: nm }).then((r) => { if (r.ok) { state.want = nm; redraw(); } return r; })) })],
      { th: false })];
  }
  const ready = () => !!(ST() && ST().notifTreeNow && ST().notifTreeNow());
  window.IBNotifSettings = { render, ready, ruleForm, pathText };
})();
