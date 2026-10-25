// Sign-in behind the existing login screen: email → signInWithPassword; phone → email_for_identifier → signInWithPassword; then IBDirectory.
// session() is synchronous: fed by the initial getSession() (await ready()) and onAuthStateChange.
// Nothing about the member is loaded while the session is still aal1 with a verified TOTP factor (checkTotp()): that is the
// sign-in's second step (checkTotp / needsTotp / verifyTotp, the 2FA view of 21-shell.js).
// «ملفي» › التحقق بخطوتين: enrollTotp / verifyEnroll / unenrollTotp (Supabase MFA TOTP). profiles.twofa is the server's: it
// follows mark_twofa_enrolled / mark_twofa_disabled (0008_mfa_cron.sql, aal2 only), and has_perm gives an enrolled member
// nothing below aal2. The directory's copy follows a confirmed change; codes and keys are never logged.
(function () {
  'use strict';
  const c = () => window.IBSupabase.client;
  const fail = (reason) => ({ ok: false, reason });
  let current = null; let totp = false; let recovered = false; const subs = [];
  let onRecovered = () => {};
  const ready = c() ? c().auth.getSession().then(({ data }) => { current = data.session; }, () => { current = null; }) : Promise.resolve();
  // a SIGNED_OUT from another tab must not leave this tab's copy behind (supabase-js only notifies; a duplicated tab keeps its sessionStorage)
  const forget = () => { try { const k = c().auth.storageKey; sessionStorage.removeItem(k); localStorage.removeItem(k); } catch (e) { /* storage blocked */ } };
  if (c()) c().auth.onAuthStateChange((event, s) => { current = s; if (event === 'SIGNED_OUT') forget(); if (event === 'PASSWORD_RECOVERY') { recovered = true; onRecovered(); } subs.forEach((cb) => { try { cb(event, s); } catch (e) { /* a bad listener must not stop the others */ } }); });

  // True only when supabase-js confirmed a recovery link (PASSWORD_RECOVERY). It fires in a setTimeout after init, so with
  // the fragment hint we wait for it (bounded); without the hint this is false at once and the stored session is gated as usual.
  const recoveryCheck = !(c() && window.IBSupabase.recoveryHint) ? Promise.resolve(false)
    : new Promise((res) => { onRecovered = () => res(true); ready.then(() => setTimeout(() => res(recovered), 1500)); });
  // phone (11 digits, any script) → { row: {email, status} | null } | { error: 'rate_limited'|'network' }. Never called for an email.
  async function lookup(identifier) {
    const ident = window.IbtekrOps.toLatin(String(identifier || '')).trim();
    const { data, error } = await c().rpc('email_for_identifier', { ident });
    if (error) return { error: /rate_limited/.test(error.message || '') ? 'rate_limited' : 'network' };
    return { row: (Array.isArray(data) ? data[0] : data) || null };
  }
  // aal1 session of a user with a verified TOTP factor → true (and needsTotp() stays true until verifyTotp). No network call.
  // Fails closed: an unreadable assurance level throws and leaves needsTotp() true.
  async function checkTotp() {
    if (!c() || !current) return (totp = false);
    totp = true;
    const { data, error } = await c().auth.mfa.getAuthenticatorAssuranceLevel();
    if (error || !data) throw error || new Error('assurance level unknown');
    return (totp = data.nextLevel === 'aal2' && data.currentLevel !== 'aal2');
  }
  // The signed-in member (directory loaded) when active; otherwise signs out → 'suspended' (or 'network' if the load fails).
  async function loadMember() {
    try { await window.IBDirectory.load(); } catch (e) { await signOut(); return fail('network'); }
    const profile = window.IBDirectory.me();
    if (!profile || profile.status !== 'active') { await signOut(); return fail('suspended'); }
    return { ok: true, profile };
  }
  // remember=false keeps the session in this tab only (see supabase-client.js). With TOTP pending → { ok:true, profile:null }.
  async function signIn(identifier, password, remember = true) {
    if (!c()) return fail('network');
    try {
      try { localStorage.setItem('ib.remember', remember ? '1' : '0'); } catch (e) { /* storage blocked: default store */ }
      // an email goes straight to GoTrue (no lookup oracle); a suspended profile is caught by loadMember (sign-out → 'suspended')
      const O = window.IbtekrOps; const id = O.toLatin(String(identifier || '')).trim();
      let email = id.toLowerCase();
      if (O.identifierKind(id) !== 'email') {
        const l = await lookup(id);
        if (l.error) return fail(l.error);
        if (!l.row) return fail('bad');
        if (l.row.status === 'suspended') return fail('suspended');
        email = l.row.email;
      }
      const { data, error } = await c().auth.signInWithPassword({ email, password });
      if (error) return fail(error.status === 429 ? 'rate_limited' : error.code === 'user_banned' ? 'suspended' : error.code === 'invalid_credentials' || error.status === 400 ? 'bad' : 'network');
      current = data.session;
      if (await checkTotp()) return { ok: true, profile: null };
      return await loadMember();
    } catch (e) {
      if (current) await signOut();
      return fail('network');
    }
  }
  // TOTP (Supabase MFA): challenge the first verified factor with the code; on aal2 load the member.
  // → { ok:true, profile } | { ok:false, reason: 'bad'|'suspended'|'network' }
  async function verifyTotp(code) {
    if (!c() || !current) return fail('bad');
    try {
      const { data, error } = await c().auth.mfa.listFactors();
      if (error) return fail('network');
      const f = (data.totp || []).find((x) => x.status === 'verified');
      if (!f) return fail('bad');
      const r = await c().auth.mfa.challengeAndVerify({ factorId: f.id, code: String(code) });
      if (r.error) return fail(r.error.status === 0 ? 'network' : 'bad');
      totp = false;
      return await loadMember();
    } catch (e) { return fail('network'); }
  }
  // ---- 2FA enrolment («ملفي») ----
  const why = (err) => (err && err.status === 0 ? 'network' : 'server'); // supabase-js: status 0 = the request never got an answer
  const digits = (code) => window.IbtekrOps.toLatin(String(code == null ? '' : code)).trim();
  // supabase-js hands GoTrue's raw SVG behind `data:image/svg+xml;utf-8,`; percent-encoded here so a '#' in it cannot end the URI.
  // Anything that is not a data:image URI → '' (the page shows the key alone).
  const RAW_SVG = 'data:image/svg+xml;utf-8,';
  const qrUri = (q) => (typeof q !== 'string' ? '' : q.startsWith(RAW_SVG) ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(q.slice(RAW_SVG.length)) : /^data:image\//.test(q) ? q : '');
  // after the server took the change: the signed-in row and its member card (same objects the pages read), then ib:directory
  function setTwofa(on) {
    const D = window.IBDirectory; const me = D && D.me && D.me(); if (!me) return;
    me.twofa = on;
    const m = (D.members() || []).find((x) => x.id === me.member_code); if (m) m.twofa = on;
    try { document.dispatchEvent(new Event('ib:directory')); } catch (e) { /* a bad listener must not undo the change */ }
  }
  const logged = (action) => { const K = window.IBKit; if (K && K.logEvent) K.logEvent(action, 'Authenticator'); }; // the channel only
  // A new TOTP factor (unverified until verifyEnroll) → { ok:true, factorId, qr (data:image URI or ''), secret, uri }
  // | { ok:false, reason: 'network'|'server' }. An unfinished enrolment (unverified TOTP factor) is removed first: GoTrue refuses
  // a second factor with the same friendly name.
  async function enrollTotp() {
    if (!c() || !current) return fail('network');
    try {
      const l = await c().auth.mfa.listFactors();
      if (l.error) return fail(why(l.error));
      for (const f of (l.data && l.data.all) || []) {
        if (f.factor_type === 'totp' && f.status === 'unverified') { const u = await c().auth.mfa.unenroll({ factorId: f.id }); if (u.error) return fail(why(u.error)); }
      }
      const { data, error } = await c().auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Authenticator' });
      if (error || !data || !data.totp) return fail(why(error));
      return { ok: true, factorId: data.id, qr: qrUri(data.totp.qr_code), secret: String(data.totp.secret || ''), uri: String(data.totp.uri || '') };
    } catch (e) { return fail('network'); }
  }
  // The first code from the app: challenge + verify (the session becomes aal2), then the server flag. → { ok:true }
  // | { ok:false, reason: 'code' (wrong / expired / not 6 digits: try again) | 'network' | 'server' (the flag was refused: the
  // factor is removed again, start over) }
  async function verifyEnroll(factorId, code) {
    if (!c() || !current) return fail('network');
    const d = digits(code);
    if (!/^[0-9]{6}$/.test(d)) return fail('code');
    try {
      const v = await c().auth.mfa.challengeAndVerify({ factorId, code: d });
      if (v.error) return fail(v.error.status === 0 ? 'network' : 'code');
      const r = await c().rpc('mark_twofa_enrolled');
      // if this unenroll fails too, the factor stays verified without the flag: the sign-in still asks for the code
      if (r.error) { try { await c().auth.mfa.unenroll({ factorId }); } catch (e) { /* reported as 'server' all the same */ } return fail('server'); }
      setTwofa(true); logged('profile.2fa.enable');
      return { ok: true };
    } catch (e) { return fail('network'); }
  }
  // «إيقاف»: only on an aal2 session (signed in with the code). The server flag first (it needs aal2 too), then every verified
  // TOTP factor; a factor that will not go puts the flag back. → { ok:true } | { ok:false, reason: 'aal1'|'network'|'server' }
  async function unenrollTotp() {
    if (!c() || !current) return fail('network');
    try {
      const lv = await c().auth.mfa.getAuthenticatorAssuranceLevel();
      if (lv.error || !lv.data) return fail(why(lv.error));
      if (lv.data.currentLevel !== 'aal2') return fail('aal1');
      const l = await c().auth.mfa.listFactors();
      if (l.error) return fail(why(l.error));
      const r = await c().rpc('mark_twofa_disabled');
      if (r.error) return fail(/aal2_required/.test(r.error.message || '') ? 'aal1' : 'server');
      for (const f of (l.data && l.data.totp) || []) {
        const u = await c().auth.mfa.unenroll({ factorId: f.id });
        if (u.error) { await c().rpc('mark_twofa_enrolled'); return fail(why(u.error)); }
      }
      setTwofa(false); logged('profile.2fa.disable');
      return { ok: true };
    } catch (e) { return fail('network'); }
  }
  // scope 'local' (default) ends this browser's session only; 'global' every session of the user (after a password reset).
  // The member's data in memory (directory, prefs, alerts, activity) is cleared first: IBDirectory.clear.
  async function signOut(scope = 'local') {
    totp = false; recovered = false;
    if (window.IBDirectory && window.IBDirectory.clear) { try { window.IBDirectory.clear(); } catch (e) { /* signing out matters more */ } }
    if (c()) { try { await c().auth.signOut({ scope }); } catch (e) { /* signed out locally anyway */ } }
    current = null;
  }
  // «خروج من كل الأجهزة»: ends the user's other sessions; this one stays signed in. → { ok }
  async function signOutOthers() {
    if (!c() || !current) return { ok: false };
    try { const { error } = await c().auth.signOut({ scope: 'others' }); return { ok: !error }; } catch (e) { return { ok: false }; }
  }
  // Unknown accounts still answer ok (the "sent" view never says whether the account exists).
  async function resetPassword(identifier) {
    if (!c()) return { ok: false };
    try {
      const O = window.IbtekrOps; const id = O.toLatin(String(identifier || '')).trim();
      let email = id.toLowerCase();
      if (O.identifierKind(id) !== 'email') { const l = await lookup(id); if (l.error) return { ok: false }; if (!l.row) return { ok: true }; email = l.row.email; }
      const { error } = await c().auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }); // back here with #…type=recovery
      return { ok: !error };
    } catch (e) { return { ok: false }; }
  }
  // Only on a confirmed recovery session: a stored everyday session cannot change the password without the old one.
  async function updatePassword(p1) {
    if (!c() || !recovered) return { ok: false };
    try { const { error } = await c().auth.updateUser({ password: p1 }); return { ok: !error }; } catch (e) { return { ok: false }; }
  }
  window.IBAuth = { signIn, verifyTotp, needsTotp: () => totp, checkTotp, enrollTotp, verifyEnroll, unenrollTotp, signOut, signOutOthers, session: () => current, onChange: (cb) => { subs.push(cb); }, resetPassword, updatePassword, ready: () => ready, recovery: () => recoveryCheck };
})();
