
/* Shell additions: clock widget + overtime flow (Figma Clock widget 360:2538, OT popups 380:*), account menu, logout on shift,
   session timeout, and the login screen (option B: green background, centered beige card 440, radius 12 — Figma 406:3456…). */
(function () {
  'use strict';
  const U = window.IBUI, O = window.IbtekrOps, K = window.IBKit, L = window.IBLogo;
  const { h, Icon, Button } = U; const S = K.store;

  // ================= shift / overtime =================
  // phase 10 T6 (decision 10): the shift lives on the server (hr_clock_in / hr_clock_out through IBHR) — a refresh, another tab or
  // another device shows the same open shift (known issue 1); the timer counts from the server's start. The overtime flow is the
  // prototype's: at 8 hours «إنهاء الدوام» (ends at the 8-hour mark) or «لسه — وقت إضافي»; ending overtime asks what was worked on
  // (the server records it past 8 hours for the direct manager); «لسه شغال؟» unanswered ends the shift at the moment it was shown.
  // What the member chose for this shift (the 8-hour question, the presence prompts) stays in sessionStorage by the shift's id.
  const HR = () => window.IBHR;
  // owner batch 14 Nov decision 7 (0087): the day's minutes are the member's (own time, else the department's, else the official hours)
  const DM = () => (window.IBHR && window.IBHR.dayMinutes ? window.IBHR.dayMinutes() : 480);
  const dayHrs = () => { const m = DM(); return (m % 60 ? (m / 60).toFixed(1) : String(m / 60)) + ' ساعات'; };
  // phase 13 decision 24 (0068 — «مع المرونة مفيش تأخير»): flexible hours — «ابدأ الدوام» shows again after «إنهاء الدوام», each start is a
  // session of the day, and the day's hours are its sessions summed: `base` = the day's other closed sessions, `worked()` the day's total
  const sh = { state: 'out', start: 0, base: 0, id: null, otStart: null, prompted: 0, endAsked: false, presence: null, note: '', ended: false, endedMin: 0, busy: false };
  const now = () => Date.now();
  const worked = () => (sh.state === 'out' ? 0 : sh.base + Math.max(0, (now() - sh.start) / 60000));
  const otMin = () => (sh.otStart == null ? 0 : worked() - sh.otStart);
  const clockLabel = (ms) => { const d = new Date(ms); try { return new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d); } catch (e) { return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); } };
  const realOf = (min) => sh.start + Math.max(0, min - sh.base) * 60000; // wall-clock time when the day reached `min` worked minutes (in this session)
  const settings = () => (HR() ? HR().data.hrSettings : S.hrSettings);
  const SKEY = (id) => 'ib.shift.' + id;
  const remember = () => { if (sh.id == null) return; try { sessionStorage.setItem(SKEY(sh.id), JSON.stringify({ endAsked: sh.endAsked, ot: sh.otStart != null, prompted: sh.prompted })); } catch (e) { /* storage blocked: asked again after a refresh */ } };
  const forget = (id) => { try { sessionStorage.removeItem(SKEY(id)); } catch (e) { /* */ } };
  let widget = null;
  function state() { return { state: sh.state, worked: worked(), startLabel: sh.start && sh.state !== 'out' ? clockLabel(sh.start) : '', ended: sh.ended, endedMin: sh.endedMin }; }
  // the clock from the server's rows (IBHR.myShift): on every load and the live line
  function sync() {
    const s = HR() && HR().myShift ? HR().myShift() : null;
    if (!s) { if (sh.state !== 'out' || sh.ended) { closePresence(); Object.assign(sh, { state: 'out', id: null, start: 0, base: 0, otStart: null, ended: false, endedMin: 0 }); } paint(); return; }
    const base = Math.max(0, Number(s.done) || 0);
    if (s.out_at) { closePresence(); Object.assign(sh, { state: 'out', id: s.id, start: Date.parse(s.in_at), base: 0, otStart: null, ended: s.day === (HR().today ? HR().today() : ''), endedMin: base + Math.max(0, Math.round((Date.parse(s.out_at) - Date.parse(s.in_at)) / 60000)) }); paint(); return; }
    if (sh.id !== s.id) {
      let saved = null; try { saved = JSON.parse(sessionStorage.getItem(SKEY(s.id)) || 'null'); } catch (e) { saved = null; }
      // a session that starts with the day past 8 hours is overtime from its start (the 8-hour question was the earlier session's)
      if (!saved && base >= DM()) saved = { endAsked: true, ot: true, prompted: 0 };
      saved = saved || {};
      Object.assign(sh, { id: s.id, endAsked: !!saved.endAsked, prompted: Number(saved.prompted) || 0, otStart: saved.ot ? DM() : null });
    }
    // decision 25 (0069): an overtime started on the server (this device or another) — from its start, or the 8-hour mark if later
    if (s.ot_from) { sh.otStart = Math.min(DM(), base + Math.max(0, (Date.parse(s.ot_from) - Date.parse(s.in_at)) / 60000)); sh.endAsked = true; }
    sh.start = Date.parse(s.in_at); sh.base = base; sh.ended = false; sh.state = sh.otStart != null ? 'overtime' : 'in';
    paint();
  }
  document.addEventListener('ib:hr', sync);
  async function clockIn() {
    if (sh.busy || !HR()) return; sh.busy = true; paint();
    const t = HR().today(); const again = sh.ended;
    const r = await HR().clockIn(); sh.busy = false; // «عن بُعد» comes from the server (an approved «شغل عن بُعد» covering today)
    if (!r.ok) { K.toast(r.message || 'تعذّر بدء الدوام — جرّب تاني', 'error'); paint(); return; }
    const remote = !!(r.shift && r.shift.remote);
    const off = (HR().isWorkDay ? !HR().isWorkDay(t) : [5, 6].includes(new Date(t + 'T00:00:00Z').getUTCDay())) || HR().holidayDates().includes(t);
    K.toast(off ? 'بدأ الدوام — يوم راحة/عطلة: بيتحسب بيومين بعد موافقة الأدمن' : remote ? 'بدأ الدوام عن بُعد — بالتوفيق' : again ? 'رجعت للدوام — الساعات بتتجمع على النهارده' : 'بدأ الدوام — بالتوفيق', 'success'); sync();
  }
  async function finish(endMinWorked, note, auto) {
    if (sh.busy || !HR()) return; sh.busy = true;
    const id = sh.id; const r = await HR().clockOut(note || null, new Date(realOf(endMinWorked)).toISOString()); sh.busy = false;
    if (!r.ok) { K.toast(r.message || 'تعذّر إنهاء الدوام — جرّب تاني', 'error'); paint(); return; }
    const res = r.result || {}; const ot = Number(res.overtime) || 0;
    forget(id); sh.otStart = null; closePresence(); sync();
    K.toast(res.rest_day ? 'انتهى الدوام — يوم الراحة اتبعت لمديرك يأكده' : auto ? 'الدوام خلص تلقائي من وقت ظهور «لسه شغال؟»' + (ot ? ' — الوقت الإضافي اتبعت للتأكيد' : '') : ot ? 'انتهى الدوام — اتبعت ' + K.hrs(ot) + ' وقت إضافي لمديرك للتأكيد' : 'انتهى الدوام — تقدر تبدأ تاني في أي وقت', auto ? '' : 'success');
  }
  // «إنهاء الدوام»: plain confirm while in; overtime needs the note of what was worked on
  function endShift(after) {
    if (sh.state === 'out') { if (after) after(); return; }
    if (sh.state === 'overtime') return endOvertime(after);
    K.confirm({ title: 'إنهاء الدوام', text: 'اشتغلت ' + K.hrs(worked()) + ' النهارده. هينتهي الدوام دلوقتي — وتقدر تبدأ تاني بعدين والساعات بتتجمع.', okLabel: 'إنهاء الدوام', onOk: async () => { await finish(worked(), '', false); if (after) after(); } });
  }
  function endOvertime(after) {
    const end = worked();
    K.form({ title: 'إنهاء الوقت الإضافي', values: {}, note: U.InlineNote({ children: 'اشتغلت ' + K.hrs(end - sh.otStart) + ' وقت إضافي (من ' + clockLabel(realOf(sh.otStart)) + '). هيتسجل في تذكرة الطلب ويتبعت لمديرك المباشر يأكده — ولو عدّى ' + (settings().escalate || 24) + ' ساعة بيروح للأدمن.' }),
      fields: (f, e, set) => [K.field.area('note', 'اشتغلت على إيه في الوقت ده؟', f, e, set, { required: true, placeholder: 'مثلاً: جهزت 14 أوردر لشحنة أرامكس' })],
      validate: (f) => { const err = O.validateOtEnd(f.note); return err ? { note: err } : {}; }, submitLabel: 'إنهاء الدوام وإرسال للتأكيد', submit: (f) => { finish(end, f.note.trim(), false).then(() => { if (after) after(); }); } });
  }
  // decision 25 (0069 — «اكتمال ساعات العمل»): the day past 8 hours asks; «ابدأ وقت إضافي» (here or from «ملفي › ساعات العمل», even before
  // 8 hours) opens a request ticket in «تذاكر الفريق» for the direct manager with a bell to the admins — nothing counts before the approval
  async function startOvertime(atMark) {
    if (sh.state !== 'in' || sh.busy || !HR() || !HR().overtimeBegin) return;
    sh.busy = true; const r = await HR().overtimeBegin(); sh.busy = false;
    if (!r.ok) { K.toast(r.message || 'تعذّر بدء الوقت الإضافي — جرّب تاني', 'error'); paint(); return; }
    sh.state = 'overtime'; sh.otStart = atMark ? DM() : worked(); sh.endAsked = true; sh.prompted = 0; remember(); sync();
    // decision 32 (0070): a rest day / holiday worked is the admins' to approve
    const t = HR().today(); const off = (HR().isWorkDay ? !HR().isWorkDay(t) : [5, 6].includes(new Date(t + 'T00:00:00Z').getUTCDay())) || HR().holidayDates().includes(t);
    K.toast('بدأ الوقت الإضافي — اتبعت طلب ' + (off ? 'للأدمن' : 'لمديرك المباشر') + (r.ticket ? ' (' + r.ticket + ')' : '') + '، ومابيتحسبش غير بعد موافقته', 'success'); paint();
  }
  function shiftOver() {
    sh.endAsked = true; remember();
    const m = U.Modal({ title: 'اكتمال ساعات العمل', body: [h('p', { style: 'margin:0' }, 'كمّلت ' + dayHrs() + ' النهارده (من أول ' + clockLabel(sh.start) + '). تنهي الدوام ولا تبدأ وقت إضافي؟'), h('p', { class: 't-small help', style: 'margin:0' }, 'الوقت الإضافي بيتبعت طلب في «تذاكر الفريق» لمديرك المباشر ومابيتحسبش غير بعد موافقته.')],
      footer: [Button({ label: 'ابدأ وقت إضافي', onClick: () => { m.close(); startOvertime(true); } }), Button({ type: 'primary', label: 'إنهاء الدوام', onClick: () => { m.close(); finish(Math.min(worked(), DM()), '', false); } })] });
  }
  function closePresence() { if (sh.presence) { clearInterval(sh.presence.t); sh.presence.modal.close(); sh.presence = null; } }
  function presencePrompt() {
    const shownAt = now(); const shownWorked = worked(); let left = O.HR.presenceTimeoutSec;
    const count = h('b', { class: 'num', 'aria-live': 'polite' }, '1:00');
    const modal = U.Modal({ title: 'لسه شغال؟', body: [h('p', { style: 'margin:0' }, 'بقالك ' + K.hrs(otMin()) + ' وقت إضافي. لو مردتش خلال دقيقة الدوام هيخلص تلقائي من دلوقتي (' + clockLabel(shownAt) + ').'), h('div', { class: 'countdown' }, Icon('clock', 'sm'), count)],
      footer: [Button({ label: 'لا — أنهي الدوام', onClick: () => { sh.presence && clearInterval(sh.presence.t); sh.presence = null; modal.close(); endOvertime(); } }), Button({ type: 'primary', label: 'أيوه لسه شغال', onClick: () => { const r = O.presenceOutcome({ shownAt, repliedAt: now(), now: now() }); clearInterval(sh.presence.t); sh.presence = null; modal.close(); if (r === 'continue') K.toast('تمام — كمّل'); } })], onClose: () => {} });
    const t = setInterval(() => { left -= 1; count.textContent = '0:' + String(Math.max(0, left)).padStart(2, '0'); if (O.presenceOutcome({ shownAt, repliedAt: null, now: now() }) === 'ended') { clearInterval(t); sh.presence = null; modal.close(); finish(shownWorked, 'انتهى تلقائي — مفيش رد على «لسه شغال؟»', true); } }, 1000);
    sh.presence = { t, modal };
  }
  function tick() {
    if (sh.state === 'out' || sh.busy) return;
    const w = worked(); const c = settings();
    if (sh.state === 'in' && w >= DM() && !sh.endAsked && c.shiftEnd && !document.querySelector('.scrim')) shiftOver();
    if (sh.state === 'overtime' && c.presence && !sh.presence) { const n = Math.floor(otMin() / (Number(c.presenceEvery) || 120)); if (n > sh.prompted) { sh.prompted = n; remember(); presencePrompt(); } }
    paintTimer();
  }
  setInterval(tick, 1000);
  // decision 7 (0087): a work day, no session yet and the member's time has started → one reminder a day «ابدأ الدوام» (no lateness)
  function startReminder() {
    const H = HR(); if (!H || !H.scheduleOf || !H.today || sh.state !== 'out' || sh.ended || sh.busy) return;
    const t = H.today(); if (!H.isWorkDay(t) || (H.holidayDates && H.holidayDates().includes(t))) return;
    const from = H.hm(H.scheduleOf().from); if (from == null || H.nowMin() < from) return;
    const key = 'ib.start.reminded'; let seen = null; try { seen = localStorage.getItem(key); } catch (e) { seen = null; }
    if (seen === t) return; try { localStorage.setItem(key, t); } catch (e) { /* private window */ }
    K.toast('ميعاد الدوام بدأ (' + H.scheduleOf().from + ') — اضغط «ابدأ الدوام» من فوق', 'info');
    if (widget) widget.classList.add('remind');
  }
  setInterval(startReminder, 60000); setTimeout(startReminder, 4000);

  // Clock widget (State=Out/In/Overtime + Timer)
  let timerEl = null;
  function paintTimer() { if (timerEl) timerEl.textContent = K.hm(worked()) + (sh.state === 'overtime' ? ' · +' + K.hm(otMin()) : ''); }
  function paint() { if (!widget) return; widget.replaceChildren(...clockInner()); }
  function clockInner() {
    if (sh.state === 'out') {
      timerEl = null;
      const startBtn = Button({ type: 'primary', size: 'sm', label: sh.busy ? 'بيبدأ…' : 'ابدأ الدوام', icon: 'clock', disabled: sh.busy || !HR() || HR().state() !== 'ready', attrs: { 'aria-label': 'ابدأ الدوام' }, onClick: clockIn });
      // decision 24: «ابدأ الدوام» again after «إنهاء الدوام» (another session); decision 37 (owner 10 Nov — «مش محتاجين خلص الدوام يبان في
      // الهيدر، هو إما يكون شغال وبيعد أو ابدأ الدوام»): no «خلص الدوام» label — the day's hours are in «ملفي › ساعات العمل»
      return [startBtn];
    }
    const wrap = h('div', { class: 'pop-anchor', 'data-popover-root': '' });
    timerEl = h('span', { class: 'num' });
    const trig = h('button', { type: 'button', class: 'clock clock-' + sh.state, 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-label': sh.state === 'overtime' ? 'وقت إضافي — تفاصيل الدوام' : 'على الدوام — تفاصيل الدوام' }, h('i', { class: 'dot' }), h('span', { class: 'lbl' }, sh.state === 'overtime' ? 'وقت إضافي' : 'على الدوام'), timerEl);
    const pop = U.popover(wrap, trig, (close) => h('div', { class: 'menu end clock-pop', role: 'dialog', 'aria-label': 'الدوام', 'data-popover-root': '' },
      K.Kv([['بدأت', clockLabel(sh.start) + (sh.base ? ' (جلسة تانية)' : '')], ['اشتغلت النهارده', K.hrs(worked())], ['الشيفت', dayHrs() + ' — مرن'], sh.state === 'overtime' ? ['وقت إضافي', K.hrs(otMin())] : ['فاضل', K.hrs(Math.max(0, 480 - worked()))]]),
      Button({ type: 'primary', label: sh.state === 'overtime' ? 'إنهاء الوقت الإضافي' : 'إنهاء الدوام', onClick: () => { close(); endShift(); } })));
    trig.addEventListener('click', pop.toggle); wrap.append(trig); paintTimer(); return [wrap];
  }
  function ClockWidget() { widget = h('div', { class: 'clock-widget' }); sync(); return widget; }

  // ================= account menu / logout =================
  function AccountMenu(go) {
    const me = K.member(K.ME);
    const wrap = h('div', { class: 'pop-anchor user', 'data-popover-root': '' });
    const trig = h('button', { type: 'button', class: 'user-btn', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': 'حسابي — ' + me.name }, h('span', { class: 'avatar', 'aria-hidden': 'true' }, me.name.charAt(0)), h('span', { class: 't-label nm' }, me.name), Icon('chevD', 'sm'));
    const items = [['users', 'ملفي', () => go('profile')], ['send', 'طلباتي', () => { location.hash = 'profile-requests'; }] /* the owner 11 Nov: «ملفي › طلباتي» (my team requests) */, ['clock', 'ساعات العمل', () => { location.hash = 'profile-hours'; }], HR() && HR().overtimeRequest ? ['plus', 'طلب وقت إضافي', otRequest] : null /* decision 44 */, me.role === 'أدمن' ? ['gear', 'الإعدادات', () => go('settings')] : null, ['external', 'تسجيل الخروج', logout, true]].filter(Boolean);
    const pop = U.popover(wrap, trig, (close) => { const menu = h('div', { class: 'menu end acct', role: 'menu', 'data-popover-root': '' }, h('div', { class: 'acct-h' }, h('b', null, me.name), h('small', { dir: 'ltr' }, me.email)), items.map(([ic, lb, run, danger]) => h('button', { type: 'button', role: 'menuitem', class: 'opt' + (danger ? ' danger' : ''), onClick: () => { close(); run(); } }, Icon(ic, 'sm'), lb))); return menu; });
    trig.addEventListener('click', pop.toggle); wrap.append(trig); return wrap;
  }
  // ---- decision 44 (owner 10 Nov): «طلب وقت إضافي» — a day in the last 31, from / to (Cairo), what was worked on → a request the admins,
  // the direct manager and the hr.approve F people decide (hr_overtime_request, 0073); nothing counts before the approval
  function otRequest() {
    const T = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); const back = (n) => { const d = new Date(T + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
    const mins = (f) => { const a = /^(\d{2}):(\d{2})$/.exec(f.from || ''); const b = /^(\d{2}):(\d{2})$/.exec(f.to || ''); return a && b ? (+b[1] * 60 + +b[2]) - (+a[1] * 60 + +a[2]) : 0; };
    let busy = false;
    K.form({ title: 'طلب وقت إضافي', submitLabel: 'ابعت الطلب', values: { day: T, from: '', to: '', note: '' },
      note: (f) => h('p', { class: 't-small help', style: 'margin:0 0 8px' }, 'الطلب بيوصل للأدمن ومديرك المباشر واللي ليهم صلاحية الموافقة، ومابيتحسبش في المرتب غير بعد الموافقة.' + (mins(f) > 0 ? ' المدة: ' + K.hrs(mins(f)) + '.' : '')),
      fields: (f, e, set) => [U.DateField({ id: 'day', label: 'اليوم', required: true, value: f.day, error: e.day, today: T, onChange: (v, err) => { set('day', v); if (err) e.day = err; } }),
        K.two(U.TextInput({ id: 'from', label: 'من', type: 'time', required: true, value: f.from, error: e.from, onInput: (v) => set('from', v) }),
          U.TextInput({ id: 'to', label: 'لحد', type: 'time', required: true, value: f.to, error: e.to, onInput: (v) => set('to', v) })),
        K.field.area('note', 'اشتغلت على إيه', f, e, set, { required: true, maxlength: 300 })],
      validate: (f) => { const er = K.req(f, ['day', 'from', 'to', 'note']);
        if (f.day && (f.day > T || f.day < back(31))) er.day = 'اختار يوم من آخر 31 يوم لحد النهارده';
        if (!er.from && !er.to && (mins(f) < 15 || mins(f) > 720)) er.to = 'المدة من ربع ساعة لـ 12 ساعة';
        if (f.note && f.note.trim().length > 300) er.note = 'لحد 300 حرف'; return er; },
      submit: (f, m) => {
        if (busy) return false; busy = true;
        HR().overtimeRequest({ day: f.day, from: f.from, to: f.to, note: f.note.trim() }).then((r) => {
          busy = false;
          if (!r || !r.ok) { K.toast((r && r.message) || 'تعذّر إرسال الطلب — جرّب تاني', 'error'); return; }
          m.close(); K.toast('اتبعت طلب الوقت الإضافي' + (r.ticket ? ' — ' + r.ticket : '') + ' — مستني الموافقة', 'success');
        });
        return false;
      } });
  }
  function logout() {
    if (sh.state === 'out') return signOut();
    const m = U.Modal({ title: 'إنت لسه على الدوام', body: [h('p', { style: 'margin:0' }, 'بقالك ' + K.hrs(worked()) + (sh.state === 'overtime' ? ' (منهم ' + K.hrs(otMin()) + ' وقت إضافي)' : '') + '. تحب تنهي الدوام قبل ما تخرج؟'), h('p', { class: 't-small help', style: 'margin:0' }, '«أخرج بس» بيسيب الدوام شغال — تقدر تنهيه من أي جهاز.')],
      footer: [Button({ label: 'أخرج بس', onClick: () => { m.close(); signOut(); } }), Button({ type: 'primary', label: 'أنهي الدوام وأخرج', onClick: () => { m.close(); endShift(signOut); } })] });
  }
  // the server log never holds the screen: a stalled request is given up on after 3 s
  const logWithin = (action, detail) => Promise.race([K.logEvent(action, detail), new Promise((r) => setTimeout(r, 3000))]);
  // the app is hidden first; then the log (before the Supabase sign-out, so the server still takes it), then this device's sign-out.
  // loggedOut first so the idle timer and SIGNED_OUT listener stand down. Then a reload: the only way every in-memory store
  // (directory, edited sample stores, conversations) starts over; the gate shows the same view again from ib.loginView.
  async function signOut(reason) { if (loggedOut) return; loggedOut = true; U.closePopover(); showLogin(reason === 'idle' ? 'expired' : 'login'); await logWithin('auth.signout', reason || 'يدوي'); await window.IBAuth.signOut('local').catch(() => {}); try { sessionStorage.setItem('ib.loginView', reason === 'idle' ? 'expired' : 'login'); } catch (e) { /* storage blocked: the gate shows login */ } location.reload(); }
  function signOutAll() { K.confirm({ title: 'خروج من كل الأجهزة', text: 'هيتعمل خروج من كل الأجهزة التانية. الجهاز ده هيفضل داخل.', okLabel: 'خروج من الكل', onOk: async () => { const r = await window.IBAuth.signOutOthers().catch(() => ({ ok: false })); if (!r.ok) return K.toast('معرفناش نعمل خروج من الأجهزة التانية — جرّب تاني', 'error'); K.logEvent('auth.signoutAll', K.member(K.ME).name); K.toast('اتعمل خروج من الأجهزة التانية', 'success'); } }); }

  // ================= session timeout: 8h idle, 1-minute warning =================
  // ib.lastAct is shared by every tab (and read by the gate in 28-app.js on load); written at most once per 5 s
  let lastAct = now(); let warnOpen = null; let lastWrite = 0;
  const touch = () => { lastAct = now(); if (lastAct - lastWrite < 5000) return; lastWrite = lastAct; try { localStorage.setItem('ib.lastAct', String(lastAct)); } catch (e) { /* storage blocked */ } };
  const idleSec = () => { let shared = 0; try { shared = Number(localStorage.getItem('ib.lastAct')) || 0; } catch (e) { /* storage blocked */ } return (now() - Math.max(lastAct, shared)) / 1000; }; // activity in any tab counts
  ['mousedown', 'keydown', 'touchstart', 'scroll'].forEach((e) => document.addEventListener(e, () => { if (!warnOpen) touch(); }, { passive: true }));
  // phase 11 (decision 19): the company policy from settings_public().security — idle off, or the desktop / mobile limit by its label
  const IDLE_MINS = { '4 ساعات': 240, '8 ساعات (تحذير قبلها بدقيقة)': 480, '12 ساعة': 720, '1 يوم': 1440, '7 أيام': 10080, '30 يوم': 43200 };
  let idleMins = null;
  function setIdle(sec) { const p = sec && typeof sec === 'object' ? sec : {}; if (p.idle === false) { idleMins = Infinity; return; } const mobile = window.matchMedia && window.matchMedia('(max-width: 767px)').matches; idleMins = IDLE_MINS[mobile ? p.idleMobile : p.idleDesktop] || IDLE_MINS[p.idleDesktop] || null; }
  setInterval(() => { if (loggedOut) return; const s = O.idleState(idleSec(), idleMins); if (s === 'active' && warnOpen) warnOpen.close(); if (s === 'warn' && !warnOpen) sessionWarning(); if (s === 'expired') { if (warnOpen) warnOpen.close(); signOut('idle'); } }, 15000);
  function sessionWarning() {
    let left = 60; const c = h('b', { class: 'num' }, '1:00');
    const m = U.Modal({ title: 'الجلسة هتخلص', body: [h('p', { style: 'margin:0' }, 'مفيش نشاط من فترة. هنعمل تسجيل خروج تلقائي خلال:'), h('div', { class: 'countdown' }, Icon('clock', 'sm'), c)], footer: [Button({ label: 'اخرج', onClick: () => { m.close(); signOut(); } }), Button({ type: 'primary', label: 'كمّل', onClick: () => { touch(); m.close(); } })], onClose: () => { clearInterval(t); warnOpen = null; } });
    warnOpen = m; const t = setInterval(() => { left--; c.textContent = '0:' + String(Math.max(0, left)).padStart(2, '0'); if (left <= 0) { clearInterval(t); m.close(); if (O.idleState(idleSec(), idleMins) !== 'active') signOut('idle'); } }, 1000);
  }

  // ================= login (option B) =================
  let loggedOut = false; let auth = O.loginInit(); let ls = { view: 'login', id: '', pw: '', err: '', code: '', channel: 'تطبيق Authenticator', remember: true, p1: '', p2: '', show: false, sentTo: '' };
  const TOTP_CH = 'تطبيق Authenticator'; const SOON = 'متاح بعد تشغيل جسر واتساب'; // only the Authenticator channel is live until the WhatsApp bridge exists
  const RECOVERY_2FA = 'لو ضيّعت التطبيق، الأدمن يقدر يشيل التحقق من لوحة Supabase لحد ما نضيف أكواد احتياطية'; // block 18's text: no backup codes, no trusted device yet
  const netErr = () => (window.IBSupabase.client ? 'مشكلة في الاتصال — جرّب تاني' : 'النظام مش متوصّل بقاعدة البيانات — راجع config.js');
  function showLogin(view) { loggedOut = true; ls = Object.assign(ls, { view: view || 'login', err: '', pw: '', code: '' }); document.getElementById('root').hidden = true; let el = document.getElementById('login'); if (!el) { el = h('div', { id: 'login', dir: 'rtl', lang: 'ar' }); document.body.append(el); } el.hidden = false; drawLogin(); document.title = 'تسجيل الدخول — نظام إبتكر'; }
  function enterApp() { loggedOut = false; touch(); const el = document.getElementById('login'); if (el) el.hidden = true; document.getElementById('root').hidden = false; try { history.replaceState(null, '', '#dashboard'); } catch (e) { /* */ } window.dispatchEvent(new HashChangeEvent('hashchange')); K.toast('أهلاً ' + K.member(K.ME).name.split(' ')[0]); }
  function drawLogin() {
    const el = document.getElementById('login'); const v = ls.view;
    const field = (id, label, key, type, extra = {}) => { const inp = h('input', Object.assign({ id, type, value: ls[key], autocomplete: extra.ac || 'off', 'aria-invalid': ls.err && extra.errKey === key ? 'true' : false }, extra.attrs || {})); inp.addEventListener('input', () => { ls[key] = inp.value; }); inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') extra.onEnter && extra.onEnter(); });
      return h('div', { class: 'field' }, h('label', { for: id }, label), h('div', { class: 'input' + (ls.err && extra.errKey === key ? ' err' : '') }, inp, extra.toggle ? h('button', { type: 'button', class: 'icb t-small', 'aria-pressed': String(ls.show), onClick: () => { ls.show = !ls.show; drawLogin(); } }, ls.show ? 'إخفاء' : 'إظهار') : null), extra.help ? h('div', { class: 'help' }, extra.help) : null); };
    const err = ls.err ? U.InlineNote({ kind: 'error', children: ls.err }) : null;
    let title = '', sub = '', body = [];
    if (v === 'login') {
      const locked = O.isLocked(auth, now());
      title = 'تسجيل الدخول'; sub = 'أهلاً بيك تاني';
      body = [locked ? U.InlineNote({ kind: 'error', children: 'الحساب اتقفل مؤقتًا بعد 5 محاولات غلط. جرّب تاني بعد ' + Math.ceil((auth.lockedUntil - now()) / 60000) + ' دقيقة أو غيّر كلمة المرور.' }) : err,
        field('lg-id', 'الإيميل أو رقم الموبايل', 'id', 'text', { ac: 'username', errKey: 'id', onEnter: doLogin, attrs: { dir: 'ltr', inputmode: 'email' } }), field('lg-pw', 'كلمة المرور', 'pw', ls.show ? 'text' : 'password', { ac: 'current-password', errKey: 'pw', toggle: true, onEnter: doLogin }),
        h('div', { class: 'lg-row' }, K.Checkbox({ label: 'افتكرني على الجهاز ده', checked: ls.remember, onChange: (x) => { ls.remember = x; drawLogin(); } }), Button({ type: 'text', size: 'sm', label: 'نسيت كلمة المرور؟', onClick: () => { ls.view = 'forgot'; ls.err = ''; drawLogin(); } })),
        Button({ type: 'primary', size: 'lg', label: 'دخول', disabled: locked, onClick: doLogin, attrs: { class: 'btn btn-primary lg block' } })];
    } else if (v === '2fa') {
      title = 'التحقق بخطوتين'; sub = ls.channel === TOTP_CH ? 'اكتب الكود من 6 أرقام اللي في تطبيق Authenticator' : 'بعتنالك كود من 6 أرقام على ' + ls.channel;
      body = [err, U.Select({ id: 'lg-ch', label: 'ابعت الكود على', help: 'واتساب وإيميل: ' + SOON, options: ['واتساب', 'إيميل', TOTP_CH].map((x) => ({ value: x, label: x === TOTP_CH ? x : x + ' — ' + SOON })), value: ls.channel, onChange: (x) => { if (x !== TOTP_CH) return K.toast(SOON); ls.channel = x; drawLogin(); } }), field('lg-code', 'الكود', 'code', 'text', { ac: 'one-time-code', errKey: 'code', onEnter: do2fa, attrs: { inputmode: 'numeric', maxlength: 6, dir: 'ltr' } }),
        Button({ type: 'primary', size: 'lg', label: 'تأكيد', onClick: do2fa, attrs: { class: 'btn btn-primary lg block' } }), h('p', { class: 't-small help', style: 'margin:0' }, RECOVERY_2FA),
        Button({ type: 'text', label: 'رجوع لتسجيل الدخول', onClick: back2fa })];
    } else if (v === 'forgot') {
      title = 'نسيت كلمة المرور'; sub = 'اكتب الإيميل أو الموبايل وهنبعتلك لينك';
      body = [err, field('lg-fid', 'الإيميل أو رقم الموبايل', 'id', 'text', { errKey: 'id', onEnter: doForgot, attrs: { dir: 'ltr' } }), Button({ type: 'primary', size: 'lg', label: 'ابعت اللينك', onClick: doForgot, attrs: { class: 'btn btn-primary lg block' } }), Button({ type: 'text', label: 'رجوع لتسجيل الدخول', onClick: () => { ls.view = 'login'; ls.err = ''; drawLogin(); } })];
    } else if (v === 'sent') {
      title = 'اللينك اتبعت'; sub = '';
      body = [U.InlineNote({ kind: 'success', children: 'لو الحساب موجود هيوصلك لينك على ' + ls.sentTo + '. اللينك صالح 30 دقيقة.' }), Button({ type: 'text', label: 'ابعت تاني', onClick: async () => { const r = await window.IBAuth.resetPassword(ls.id); K.toast(r.ok ? 'اتبعت تاني' : netErr(), r.ok ? 'success' : 'error'); } }), Button({ type: 'text', label: 'رجوع لتسجيل الدخول', onClick: () => { ls.view = 'login'; drawLogin(); } })];
    } else if (v === 'reset' || v === 'invite') {
      title = v === 'invite' ? 'أهلاً بيك في فريق ابتكر' : 'كلمة مرور جديدة'; sub = v === 'invite' ? 'سارة عادل دعتك — اعمل كلمة المرور عشان تبدأ (الدعوة صالحة 7 أيام)' : 'اختار كلمة مرور جديدة';
      body = [err, v === 'invite' ? K.Kv([['الإيميل', 'new.member@ibtekr.club'], ['الدور', 'خدمة عملاء']]) : null, field('lg-p1', 'كلمة المرور', 'p1', ls.show ? 'text' : 'password', { errKey: 'p1', toggle: true, ac: 'new-password', help: '8 حروف على الأقل فيها حرف ورقم' }), field('lg-p2', 'أكّد كلمة المرور', 'p2', ls.show ? 'text' : 'password', { errKey: 'p2', ac: 'new-password', onEnter: doReset }),
        Button({ type: 'primary', size: 'lg', label: v === 'invite' ? 'ابدأ' : 'حفظ ودخول', onClick: doReset, attrs: { class: 'btn btn-primary lg block' } })];
    } else if (v === 'suspended') {
      title = 'الحساب موقوف'; body = [U.InlineNote({ kind: 'error', children: 'الحساب ده اتوقف من الأدمن. لو ده غلط كلّم صفوت كمال.' }), Button({ type: 'text', label: 'رجوع', onClick: () => { ls.view = 'login'; drawLogin(); } })];
    } else if (v === 'expiredInvite') {
      title = 'الدعوة انتهت'; body = [U.InlineNote({ kind: 'warning', children: 'لينك الدعوة صالح 7 أيام بس وانتهى. اطلب من الأدمن يبعته تاني.' }), Button({ type: 'text', label: 'رجوع لتسجيل الدخول', onClick: () => { ls.view = 'login'; drawLogin(); } })];
    } else if (v === 'expired') {
      title = 'الجلسة خلصت'; sub = 'اتعمل خروج تلقائي بعد 8 ساعات من غير نشاط'; body = [Button({ type: 'primary', size: 'lg', label: 'سجّل دخول تاني', onClick: () => { ls.view = 'login'; drawLogin(); }, attrs: { class: 'btn btn-primary lg block' } })];
    }
    el.replaceChildren(h('main', { class: 'login-wrap' }, h('div', { class: 'login-brand' }, L.Logo({ tone: 'reversed', width: 200 }), h('div', { class: 'tagline' }, L.TAGLINE)),
      h('section', { class: 'login-card', 'aria-labelledby': 'lg-title' }, h('h1', { class: 't-h4', id: 'lg-title' }, title), sub ? h('p', { class: 't-small help' }, sub) : null, ...[].concat(body).filter(Boolean)),
      h('p', { class: 'login-foot t-small' }, '© 2026 إبتكر كلوب · ', h('a', { href: '#', onClick: (e) => { e.preventDefault(); K.toast('محتاج مساعدة؟ كلّم الأدمن'); } }, 'مساعدة'))));
    setTimeout(() => { const f = el.querySelector('[aria-invalid=true]') || el.querySelector('input'); if (f) f.focus(); });
  }
  async function doLogin() {
    if (O.isLocked(auth, now())) return drawLogin();
    if (ls.busy) return;
    if (!O.identifierKind(ls.id)) { ls.err = 'اكتب إيميل صحيح أو رقم موبايل من 11 رقم'; return drawLogin(); }
    ls.busy = true; let r; try { r = await window.IBAuth.signIn(ls.id, ls.pw, ls.remember); } finally { ls.busy = false; }
    if (!r.ok && r.reason === 'suspended') { ls.view = 'suspended'; return drawLogin(); }
    if (!r.ok && r.reason === 'bad') { auth = O.loginFail(auth, now()); K.logEvent('auth.fail', O.toLatin(ls.id)); ls.err = O.isLocked(auth, now()) ? '' : 'الإيميل/الموبايل أو كلمة المرور غلط. فاضل ' + auth.left + ' محاولات قبل ما الحساب يتقفل 15 دقيقة.'; ls.pw = ''; return drawLogin(); }
    if (!r.ok) { ls.err = r.reason === 'rate_limited' ? 'محاولات كتير — استنى دقيقة وجرّب تاني' : netErr(); return drawLogin(); }
    auth = O.loginInit(); ls.err = '';
    if (window.IBAuth.needsTotp()) { ls.view = '2fa'; return drawLogin(); } // aal2 every sign-in: the gate would stop an aal1 session on reload anyway
    K.logEvent('auth.signin', r.profile.name); enterApp();
  }
  async function do2fa() { const r = await window.IBAuth.verifyTotp(O.toLatin(ls.code)); if (!r.ok && r.reason === 'suspended') { ls.view = 'suspended'; return drawLogin(); } if (!r.ok) { ls.err = r.reason === 'network' ? netErr() : 'الكود غلط أو انتهى — جرّب تاني'; ls.code = ''; return drawLogin(); } K.logEvent('auth.2fa', ls.channel); ls.err = ''; enterApp(); }
  // «رجوع لتسجيل الدخول» on the code screen: the aal1 session ends first (a remembered one would bring the code screen back on reload)
  async function back2fa() { if (ls.busy) return; ls.busy = true; try { await window.IBAuth.signOut('local').catch(() => {}); } finally { ls.busy = false; } ls.view = 'login'; ls.err = ''; ls.code = ''; ls.pw = ''; drawLogin(); }
  async function doForgot() { if (!O.identifierKind(ls.id)) { ls.err = 'اكتب إيميل صحيح أو رقم موبايل من 11 رقم'; return drawLogin(); } const r = await window.IBAuth.resetPassword(ls.id); if (!r.ok) { ls.err = netErr(); return drawLogin(); } ls.sentTo = O.identifierKind(ls.id) === 'email' ? O.toLatin(ls.id) : 'واتساب ' + O.toLatin(ls.id); ls.err = ''; ls.view = 'sent'; drawLogin(); }
  async function doReset() { const e = O.validatePassword(ls.p1, ls.p2); if (e) { ls.err = e; return drawLogin(); } const r = await window.IBAuth.updatePassword(ls.p1); if (!r.ok) { ls.err = window.IBSupabase.client ? 'معرفناش نحفظ كلمة المرور — افتح اللينك من الإيميل تاني وجرّب' : netErr(); return drawLogin(); } ls.err = ''; ls.p1 = ls.p2 = ''; if (ls.view === 'invite') { await logWithin('auth.password.set', 'invite'); return enterApp(); }
    // the login view first (sign-in held until the old sessions are gone), then the log, then every session of the user ends
    ls.view = 'login'; ls.busy = true; drawLogin(); K.toast('اتحفظت كلمة المرور — سجّل دخول', 'success'); try { await logWithin('auth.password.set', 'reset'); await window.IBAuth.signOut('global').catch(() => {}); } finally { ls.busy = false; } }
  function routeLogin(hs) { const map = { login: 'login', 'login-2fa': '2fa', 'login-forgot': 'forgot', 'login-reset': 'reset', invite: 'invite', 'invite-expired': 'expiredInvite', 'login-suspended': 'suspended', 'login-locked': 'login' }; if (!(hs in map)) return false; if (hs === 'login-locked') auth = { fails: 0, left: 5, lockedUntil: now() + 15 * 60000 }; showLogin(map[hs]); return true; }

  window.IBShell = { setIdle, idleMinutes: () => idleMins, ClockWidget, AccountMenu, state, clockIn, endShift, startOvertime: () => startOvertime(false), otRequest, sessionWarning, signOutAll, showLogin, routeLogin, isLoggedOut: () => loggedOut };
})();

