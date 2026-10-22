// Sign-in behind the existing login screen: email → signInWithPassword; phone → email_for_identifier → signInWithPassword; then IBDirectory.
// session() is synchronous: fed by the initial getSession() (await ready()) and onAuthStateChange.
// Nothing about the member is loaded while the session is still aal1 with a verified TOTP factor (checkTotp()).
(function () {
  'use strict';
  const c = () => window.IBSupabase.client;
  const fail = (reason) => ({ ok: false, reason });
  let current = null; let totp = false; let recovered = false; const subs = [];
  let onRecovered = () => {};
  const ready = c() ? c().auth.getSession().then(({ data }) => { current = data.session; }, () => { current = null; }) : Promise.resolve();
  if (c()) c().auth.onAuthStateChange((event, s) => { current = s; if (event === 'PASSWORD_RECOVERY') { recovered = true; onRecovered(); } subs.forEach((cb) => { try { cb(event, s); } catch (e) { /* a bad listener must not stop the others */ } }); });

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
  // scope 'local' (default) ends this browser's session only; 'global' every session of the user (after a password reset).
  async function signOut(scope = 'local') {
    totp = false; recovered = false;
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
  window.IBAuth = { signIn, verifyTotp, needsTotp: () => totp, checkTotp, signOut, signOutOthers, session: () => current, onChange: (cb) => { subs.push(cb); }, resetPassword, updatePassword, ready: () => ready, recovery: () => recoveryCheck };
})();
