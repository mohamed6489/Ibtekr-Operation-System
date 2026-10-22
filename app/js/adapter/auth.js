// Sign-in behind the existing login screen: identifier → email_for_identifier → signInWithPassword → IBDirectory.
// session() is synchronous: fed by the initial getSession() (await ready()) and onAuthStateChange.
(function () {
  'use strict';
  const c = () => window.IBSupabase.client;
  const fail = (reason) => ({ ok: false, reason });
  let current = null; let totp = false; const subs = [];
  const ready = c() ? c().auth.getSession().then(({ data }) => { current = data.session; }, () => { current = null; }) : Promise.resolve();
  if (c()) c().auth.onAuthStateChange((event, s) => { current = s; subs.forEach((cb) => { try { cb(event, s); } catch (e) { /* a bad listener must not stop the others */ } }); });

  // identifier (email or 11-digit phone, any digits) → { row: {email, status} | null } | { error: 'rate_limited'|'network' }
  async function lookup(identifier) {
    const ident = window.IbtekrOps.toLatin(String(identifier || '')).trim();
    const { data, error } = await c().rpc('email_for_identifier', { ident });
    if (error) return { error: /rate_limited/.test(error.message || '') ? 'rate_limited' : 'network' };
    return { row: (Array.isArray(data) ? data[0] : data) || null };
  }
  async function signIn(identifier, password) {
    if (!c()) return fail('network');
    try {
      const l = await lookup(identifier);
      if (l.error) return fail(l.error);
      if (!l.row) return fail('bad');
      if (l.row.status === 'suspended') return fail('suspended');
      const { data, error } = await c().auth.signInWithPassword({ email: l.row.email, password });
      if (error) return fail(error.status === 429 ? 'rate_limited' : error.code === 'user_banned' ? 'suspended' : error.code === 'invalid_credentials' || error.status === 400 ? 'bad' : 'network');
      current = data.session;
      await window.IBDirectory.load();
      const profile = window.IBDirectory.me();
      if (!profile || profile.status !== 'active') { await signOut(); return fail('suspended'); }
      totp = false;
      if (profile.twofa) { const r = await c().auth.mfa.getAuthenticatorAssuranceLevel(); totp = !!r.data && r.data.nextLevel === 'aal2' && r.data.currentLevel !== 'aal2'; }
      return { ok: true, profile };
    } catch (e) {
      if (current) await signOut();
      return fail('network');
    }
  }
  // TOTP (Supabase MFA): challenge the first verified factor with the code.
  async function verifyTotp(code) {
    if (!c()) return { ok: false };
    try {
      const { data, error } = await c().auth.mfa.listFactors();
      const f = !error && data && (data.totp || []).find((x) => x.status === 'verified');
      if (!f) return { ok: false };
      const r = await c().auth.mfa.challengeAndVerify({ factorId: f.id, code: String(code) });
      if (r.error) return { ok: false };
      totp = false; return { ok: true };
    } catch (e) { return { ok: false }; }
  }
  async function signOut() {
    totp = false;
    if (c()) { try { await c().auth.signOut(); } catch (e) { /* signed out locally anyway */ } }
    current = null;
  }
  // Unknown accounts still answer ok (the "sent" view never says whether the account exists).
  async function resetPassword(identifier) {
    if (!c()) return { ok: false };
    try {
      const O = window.IbtekrOps; const id = O.toLatin(String(identifier || '')).trim();
      let email = id.toLowerCase();
      if (O.identifierKind(id) !== 'email') { const l = await lookup(id); if (l.error) return { ok: false }; if (!l.row) return { ok: true }; email = l.row.email; }
      const { error } = await c().auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname + '#login-reset' });
      return { ok: !error };
    } catch (e) { return { ok: false }; }
  }
  async function updatePassword(p1) {
    if (!c()) return { ok: false };
    try { const { error } = await c().auth.updateUser({ password: p1 }); return { ok: !error }; } catch (e) { return { ok: false }; }
  }
  window.IBAuth = { signIn, verifyTotp, needsTotp: () => totp, signOut, session: () => current, onChange: (cb) => { subs.push(cb); }, resetPassword, updatePassword, ready: () => ready };
})();
