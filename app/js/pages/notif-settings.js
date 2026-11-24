/* Ibtekr — «الإعدادات › التنبيهات» in the notifications' new structure (Safwat 24 Nov — docs/superpowers/plans/2026-11-24-notifications.md,
   0157). Not a block: block 17 calls IBNotifSettings.render(redraw) when the tree is there. The admin builds what the bell shows, as it
   shows it — the main sections (the bell's groups), the sub-sections under them (the bell's filters), and under each sub-section its
   alerts: the element › type › state from the catalogue (IBNotifCatalog), the send time and its repeat, the visibility, the channels
   (the bell only for now), the recipients (the system's roles) and the message. Every write goes through IBSettings (admin RPCs). */
(function () {
  'use strict';
  const U = () => window.IBUI; const K = () => window.IBKit; const ST = () => window.IBSettings; const C = () => window.IBNotifCatalog;
  const h = (...a) => U().h(...a);
  const state = { open: {} };
  const say = (r, ok) => { const k = K(); if (r && r.ok) { if (ok) k.toast(ok); } else k.toast((r && r.message) || 'ماتحفظش — جرّب تاني', 'error'); };
  const t12 = (hhmm) => (K() && K().t12 ? K().t12(hhmm) : hhmm);
  const TIMES = (() => { const out = []; for (let i = 0; i < 48; i++) { const hh = String(Math.floor(i / 2)).padStart(2, '0'); out.push(hh + ':' + (i % 2 ? '30' : '00')); } return out; })();
  const roleList = () => { const s = ST(); const r = s && s.roles ? s.roles() : []; return (Array.isArray(r) ? r : []).filter((x) => !x.hidden).map((x) => ({ id: x.id, name: x.name || x.id })); };
  const roleName = (id) => (roleList().find((r) => r.id === id) || { name: id }).name;
  const lists = () => (ST() && ST().notifLists ? ST().notifLists() : {});
  const showText = (r) => { const c = C(); const s = (c.SHOWS.find(([k]) => k === r.show) || [, ''])[1]; return r.show === 'fixed' ? s + ' · ' + (r.hours >= 168 ? 'أسبوع' : r.hours + ' ساعة') : r.hours ? s + ' · بعد ' + r.hours + ' ساعات' : s; };
  const repeatText = (r) => { const c = C(); const s = (c.REPEATS.find(([k]) => k === r.repeat) || [, ''])[1]; return r.repeat === 'days' ? s + ' (' + (r.days || []).join('، ') + ')' : s; };
  const pathText = (r) => { const c = C(); const e = c.el(r.element); const t = c.typeOf(r.element, r.type); const s = c.stateOf(r.element, r.type, r.state, lists());
    return [e ? e.label : r.element, t ? t.label : r.type, s ? s.label : r.state].join(' › ') + (r.sub ? ' · ' + r.sub : ''); };

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
    const f = Object.assign({ section_id: sub.id, name: '', element: '', type: '', state: '', sub: null, param: null, at: '09:00', repeat: '24h', days: [], show: 'until_state', hours: 0, roles: [], channels: ['bell'], template: '', active: true }, rule ? JSON.parse(JSON.stringify(rule)) : {});
    let err = ''; const body = h('div', { class: 'nr-form', 'data-nr-form': '' });
    const types = () => { const e = c.el(f.element); return e ? e.types : []; };
    const states = () => (f.element && f.type ? c.statesOf(f.element, f.type, L) : []);
    const curState = () => c.stateOf(f.element, f.type, f.state, L);
    const sec = (title, ...kids) => h('div', { class: 'nr-sec' }, h('div', { class: 'nr-sec-h t-label' }, title), ...kids);
    const draw = () => {
      const st = curState(); const t = c.typeOf(f.element, f.type);
      body.replaceChildren(
        sec('تفاصيل التنبيه',
          U().TextInput({ id: 'nr-name', label: 'اسم التنبيه', required: true, value: f.name, maxlength: 80, onInput: (v) => { f.name = v; } }),
          h('div', { class: 'row cols3' },
            U().Select({ id: 'nr-el', label: 'العنصر', required: true, value: f.element || null, options: c.ELEMENTS.map((e) => ({ value: e.id, label: e.label })), onChange: (v) => { f.element = v; f.type = ''; f.state = ''; f.sub = null; f.param = null; draw(); } }),
            U().Select({ id: 'nr-type', label: 'نوع التنبيه', required: true, disabled: !f.element, value: f.type || null, options: types().map((x) => ({ value: x.id, label: x.label })), onChange: (v) => { f.type = v; f.state = ''; f.sub = null; f.param = null; draw(); } }),
            U().Select({ id: 'nr-state', label: 'الوضع', required: true, disabled: !f.type, value: f.state || null, options: states().map((x) => ({ value: x.id, label: x.label })), onChange: (v) => { f.state = v; const s2 = c.stateOf(f.element, f.type, v, L); f.param = s2 && s2.param ? s2.param.def : null; draw(); } })),
          t && t.dyn === 'ticket' ? U().Select({ id: 'nr-sub', label: 'نوع الطلب', value: f.sub || '', options: [{ value: '', label: 'كل الأنواع' }].concat((L.ticket || []).map((x) => ({ value: x, label: (window.IbtekrTickets && window.IbtekrTickets.label ? window.IbtekrTickets.label(x) : x) }))), onChange: (v) => { f.sub = v || null; } }) : null,
          st && st.param ? U().TextInput({ id: 'nr-param', label: st.param.label, inputmode: 'numeric', dir: 'ltr', value: f.param == null ? String(st.param.def) : String(f.param), onInput: (v) => { f.param = v === '' ? null : Number(String(v).replace(/[^\d.]/g, '')); } }) : null,
          st ? h('p', { class: 't-small help', style: 'margin:0' }, st.kind === 'event' ? 'بيتبعت مع كل حدث جديد من الوقت ده كل يوم.' : st.kind === 'due' ? 'بيتبعت مرة لما الميعاد يقرب.' : 'بيتبعت لكل حاجة في الوضع ده ويتجدد بالتكرار طول ما هي فيه.') : null),
        sec('وقت الإرسال',
          h('div', { class: 'row cols2' },
            U().Select({ id: 'nr-at', label: 'الوقت', value: f.at, options: TIMES.map((x) => ({ value: x, label: t12(x) })), onChange: (v) => { f.at = v; } }),
            U().Select({ id: 'nr-repeat', label: 'التكرار', value: f.repeat, options: c.REPEATS.map(([k, l]) => ({ value: k, label: l })), onChange: (v) => { f.repeat = v; draw(); } })),
          f.repeat === 'days' ? h('div', { class: 'nr-days', role: 'group', 'aria-label': 'أيام الشهر' }, Array.from({ length: 31 }, (_, i) => i + 1).map((d) => h('button', { type: 'button', class: 'chip' + (f.days.includes(d) ? ' on' : ''), 'aria-pressed': String(f.days.includes(d)),
            onClick: () => { f.days = f.days.includes(d) ? f.days.filter((x) => x !== d) : f.days.concat(d).sort((a, b) => a - b); draw(); } }, String(d)))) : null),
        sec('تفاصيل الظهور',
          K().Radios({ name: 'nr-show', label: 'الظهور', value: f.show, options: c.SHOWS.map(([k, l]) => ({ value: k, label: l })), onChange: (v) => { f.show = v; f.hours = c.SHOW_HOURS[v][0]; draw(); } }),
          U().Select({ id: 'nr-hours', label: f.show === 'fixed' ? 'المدة' : 'يختفي', value: String(f.hours), options: c.SHOW_HOURS[f.show].map((n) => ({ value: String(n), label: f.show === 'fixed' ? (n >= 168 ? 'أسبوع' : n + ' ساعة') : n ? 'بعد ' + n + ' ساعات' : 'في نفس الوقت' })), onChange: (v) => { f.hours = Number(v); } })),
        sec('تفاصيل الإرسال',
          h('div', { class: 'nr-checks', 'data-nr-channels': '' }, c.CHANNELS.map(([k, l]) => { const live = c.LIVE_CHANNELS.includes(k);
            return K().Checkbox({ label: l + (live ? '' : ' (قريبًا)'), checked: f.channels.includes(k), disabled: !live, onChange: (v) => { f.channels = v ? f.channels.concat(k) : f.channels.filter((x) => x !== k); draw(); } }); })),
          h('div', { class: 't-label', style: 'margin-top:8px' }, 'المستلم'),
          h('div', { class: 'nr-checks', 'data-nr-roles': '' }, roleList().map((r) => K().Checkbox({ label: r.name, checked: f.roles.includes(r.id), onChange: (v) => { f.roles = v ? f.roles.concat(r.id) : f.roles.filter((x) => x !== r.id); draw(); } }))),
          h('p', { class: 't-small help', style: 'margin:0' }, 'بيوصل لأعضاء الأدوار دي اللي بيشوفوا الصفحة بتاعته بس.')),
        sec('قالب الرسالة',
          U().Textarea({ id: 'nr-tpl', label: 'نص التنبيه', value: f.template || '', maxlength: 500, rows: 3, placeholder: 'مثال: {الرقم} لسه ما اتأكدش — {التفاصيل}', onInput: (v) => { f.template = v; } }),
          h('div', { class: 'nr-vars t-small' }, 'متغيرات: ', ['{الاسم}', '{الرقم}', '{الوضع}', '{التفاصيل}'].map((x) => h('code', null, x)))),
        err ? h('p', { class: 'ferr t-small', role: 'alert' }, err) : null);
    };
    draw();
    const m = U().Modal({ title: rule ? 'تعديل التنبيه' : 'إضافة تنبيه — ' + sub.name, body: [body], footer: [U().Button({ label: 'إلغاء', onClick: () => m.close() }), U().Button({ type: 'primary', label: 'حفظ', attrs: { 'data-nr-save': '' }, onClick: async () => {
      const r = await ST().notifRuleSave(f); if (r.ok) { m.close(); K().toast('اتحفظ التنبيه'); redraw(); } else { err = r.message || 'ماتحفظش'; draw(); } } })] });
    return m;
  }

  // ---------- the tree
  function ruleRow(sub, r, redraw) {
    return h('div', { class: 'nr-rule' + (r.active === false ? ' off' : ''), 'data-nr-rule': r.id },
      h('div', { class: 'nr-rule-main' }, h('b', null, r.name), h('div', { class: 't-small muted' }, pathText(r)),
        h('div', { class: 'nr-tags' }, [t12(r.at) + ' · ' + repeatText(r), showText(r)].map((x) => h('span', { class: 'tag' }, x)), (r.roles || []).map((x) => h('span', { class: 'tag brand' }, roleName(x))))),
      K().Switch({ id: 'nr-on-' + r.id, label: r.active === false ? 'متوقف' : 'شغّال', checked: r.active !== false, onChange: async (v) => { const x = await ST().notifRuleSave(Object.assign({}, r, { active: v })); say(x); redraw(); } }),
      K().RowMenu([{ label: 'تعديل', icon: 'edit', run: () => ruleForm(sub, r, redraw) },
        { label: 'حذف', icon: 'trash', danger: true, run: () => K().confirm({ title: 'حذف التنبيه', text: '«' + r.name + '» هيتمسح وتنبيهاته هتختفي من الجرس.', okLabel: 'احذف', okType: 'danger', onOk: async () => { say(await ST().notifRuleDelete(r.id), 'اتمسح'); redraw(); } }) }]));
  }
  const move = async (list, i, d, redraw) => { const ids = list.map((x) => x.id); const j = i + d; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; say(await ST().notifSectionOrder(ids)); redraw(); };
  function subBox(main, sub, i, redraw) {
    return h('div', { class: 'nr-sub', 'data-nr-sub': sub.id },
      h('div', { class: 'nr-sub-h' }, h('b', null, sub.name), h('span', { class: 'muted t-small' }, sub.rules.length + ' تنبيه'), h('span', { class: 'sp' }),
        U().Button({ size: 'sm', icon: 'plus', label: 'تنبيه', attrs: { 'data-nr-add': sub.id }, onClick: () => ruleForm(sub, null, redraw) }),
        K().RowMenu([{ label: 'لفوق', icon: 'chevU', run: () => move(main.subs, i, -1, redraw) }, { label: 'لتحت', icon: 'chevD', run: () => move(main.subs, i, 1, redraw) },
          { label: 'تغيير الاسم', icon: 'edit', run: () => nameForm('تغيير اسم القسم الفرعي', sub.name, (n) => ST().notifSectionSave({ id: sub.id, parentId: main.id, name: n }).then((r) => { if (r.ok) redraw(); return r; })) },
          { label: 'حذف', icon: 'trash', danger: true, run: () => K().confirm({ title: 'حذف القسم الفرعي', text: '«' + sub.name + '» وتنبيهاته (' + sub.rules.length + ') هيتمسحوا.', okLabel: 'احذف', okType: 'danger', onOk: async () => { say(await ST().notifSectionDelete(sub.id), 'اتمسح'); redraw(); } }) }])),
      sub.rules.length ? h('div', { class: 'nr-rules' }, sub.rules.map((r) => ruleRow(sub, r, redraw))) : h('p', { class: 't-small muted', style: 'margin:4px 0 0' }, 'مفيش تنبيهات — «+ تنبيه» يضيف واحد.'));
  }
  function mainBox(main, i, all, redraw) {
    const open = state.open[main.id] !== false; const n = main.subs.reduce((s, x) => s + x.rules.length, 0);
    return h('div', { class: 'card nr-main', 'data-nr-main': main.id },
      h('div', { class: 'nr-main-h' }, h('button', { type: 'button', class: 'nr-tog', 'aria-expanded': String(open), onClick: () => { state.open[main.id] = !open; redraw(true); } }, U().Icon(open ? 'chevD' : 'chevL', 'sm'), h('b', null, main.name)),
        h('span', { class: 'muted t-small' }, main.subs.length + ' قسم فرعي · ' + n + ' تنبيه'), h('span', { class: 'sp' }),
        U().Button({ size: 'sm', icon: 'plus', label: 'قسم فرعي', attrs: { 'data-nr-add-sub': main.id }, onClick: () => nameForm('قسم فرعي جديد — ' + main.name, '', (nm) => ST().notifSectionSave({ parentId: main.id, name: nm }).then((r) => { if (r.ok) redraw(); return r; })) }),
        K().RowMenu([{ label: 'لفوق', icon: 'chevU', run: () => move(all, i, -1, redraw) }, { label: 'لتحت', icon: 'chevD', run: () => move(all, i, 1, redraw) },
          { label: 'تغيير الاسم', icon: 'edit', run: () => nameForm('تغيير اسم القسم', main.name, (nm) => ST().notifSectionSave({ id: main.id, name: nm }).then((r) => { if (r.ok) redraw(); return r; })) },
          { label: 'حذف', icon: 'trash', danger: true, run: () => K().confirm({ title: 'حذف القسم', text: '«' + main.name + '» بأقسامه الفرعية وتنبيهاته هيتمسحوا.', okLabel: 'احذف', okType: 'danger', onOk: async () => { say(await ST().notifSectionDelete(main.id), 'اتمسح'); redraw(); } }) }])),
      open ? h('div', { class: 'nr-subs' }, main.subs.length ? main.subs.map((x, j) => subBox(main, x, j, redraw)) : h('p', { class: 't-small muted' }, 'مفيش أقسام فرعية — «+ قسم فرعي» يضيف واحد.')) : null);
  }
  // redraw(true) = the same tree drawn again; redraw() = read it again from the server first
  function render(R) {
    const tree = ST() && ST().notifTreeNow ? ST().notifTreeNow() : null;
    const redraw = (local) => { if (local) { R(); return; } ST().notifTree(true).then(() => R()); };
    if (!tree) return [K().Empty('بنحمّل التنبيهات…', '')];
    return [K().Section('أقسام التنبيهات', [
      h('p', { class: 't-small muted', style: 'margin:0 0 12px' }, 'الجرس بيتعرض بنفس التقسيمة دي بالظبط: كل قسم رئيسي مجموعة، وأقسامه الفرعية فلاتر، وتحت كل فرعي تنبيهاته. الجرس بس دلوقتي — الإيميل والواتساب قريبًا.'),
      h('div', { class: 'nr-tree', 'data-nr-tree': '', 'data-set-instant': '' }, tree.mains.map((m, i) => mainBox(m, i, tree.mains, redraw)))],
      [U().Button({ type: 'primary', icon: 'plus', label: 'قسم رئيسي', attrs: { 'data-nr-add-main': '' }, onClick: () => nameForm('قسم رئيسي جديد', '', (nm) => ST().notifSectionSave({ name: nm }).then((r) => { if (r.ok) redraw(); return r; })) })],
      { th: false })];
  }
  const ready = () => !!(ST() && ST().notifTreeNow && ST().notifTreeNow());
  window.IBNotifSettings = { render, ready, ruleForm, pathText };
})();
