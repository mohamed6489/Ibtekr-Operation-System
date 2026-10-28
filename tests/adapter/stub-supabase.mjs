// Chainable stand-in for the supabase-js client, shared by the adapter unit tests (not a test file itself).
// table(name) (the client's from) returns a query whose builder methods record themselves and return the query; awaiting it gives
// responses[name] (default { data: [], error: null }), read at await time so a test can change it between calls. A response may
// also be a function of that query's own calls ([{ op, args }], without the from()), for answers that depend on the filters.
// Every call is recorded plain-cloned, so assertions compare objects of this realm, not of the vm context.
// channel() records too and returns { on, subscribe } (or throws with channelThrows); emit(row) plays a Realtime INSERT on alerts
// to the last handler, emitChange(payload) plays a postgres_changes payload ({ table, eventType, new }) to every matching handler;
// subscribe(cb) keeps cb and emitStatus(status) plays a channel status ('SUBSCRIBED', 'CHANNEL_ERROR', …) to the last one.
// functions.invoke(name, opts) records { op: 'invoke', args } and answers responses['fn:' + name] (a value or a function of opts).
// rpc(fn, args) records { op: 'rpc', args: [fn, args] } and answers responses['rpc:' + fn] (a value or a function of args).
// auth: storageKey, getSession (nothing stored) and onAuthStateChange; emitAuth(event, session) plays an auth event to its listener.
// auth.mfa.<method>(args) records { op: 'mfa.<method>', args: [args] } and answers responses['mfa:' + method] (a value or a
// function of args; default { data: null, error: null }), for listFactors / enroll / challengeAndVerify / unenroll /
// getAuthenticatorAssuranceLevel.
const MFA = ['listFactors', 'enroll', 'challenge', 'verify', 'challengeAndVerify', 'unenroll', 'getAuthenticatorAssuranceLevel'];
const OPS = ['select', 'eq', 'in', 'is', 'gte', 'order', 'limit', 'range', 'upsert', 'insert', 'update', 'delete', 'match', 'single', 'or', 'not'];
const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
export function stubClient({ responses = {}, channelThrows = false } = {}) {
  const calls = []; let handler = null; let authHandler = null; const handlers = []; let statusCb = null;
  const rec = (c) => { calls.push(plain(c)); };
  const answer = (r, arg) => (typeof r === 'function' ? r(arg) : r);
  const table = (name) => {
    rec({ table: name, op: 'from' });
    const mine = [];
    const q = { then: (ok, ko) => Promise.resolve().then(() => answer(responses[name], plain(mine)) || { data: [], error: null }).then(ok, ko) };
    OPS.forEach((op) => { q[op] = (...args) => { rec({ table: name, op, args }); mine.push({ op, args }); return q; }; });
    return q;
  };
  const client = {
    from: table,
    channel: (name) => {
      rec({ op: 'channel', args: [name] });
      if (channelThrows) throw new Error('realtime unavailable');
      const ch = { on: (type, filter, cb) => { rec({ op: 'on', args: [type, filter] }); handler = cb; handlers.push({ filter, cb }); return ch; }, subscribe: (cb) => { rec({ op: 'subscribe' }); statusCb = typeof cb === 'function' ? cb : null; return ch; } };
      return ch;
    },
    removeChannel: () => { rec({ op: 'removeChannel' }); return Promise.resolve('ok'); },
    rpc: (fn, args) => { rec({ op: 'rpc', args: [fn, args] }); return Promise.resolve().then(() => answer(responses['rpc:' + fn], plain(args)) || { data: null, error: null }); },
    functions: {
      invoke: (name, opts) => { rec({ op: 'invoke', args: [name, opts] }); return Promise.resolve().then(() => answer(responses['fn:' + name], plain(opts)) || { data: null, error: null }); },
    },
    auth: {
      storageKey: 'sb-stub-auth-token',
      getSession: () => Promise.resolve({ data: { session: null }, error: null }),
      onAuthStateChange: (cb) => { authHandler = cb; return { data: { subscription: { unsubscribe() {} } } }; },
      mfa: Object.fromEntries(MFA.map((m) => [m, (args) => { rec({ op: 'mfa.' + m, args: args === undefined ? [] : [args] }); return Promise.resolve().then(() => answer(responses['mfa:' + m], plain(args)) || { data: null, error: null }); }])),
    },
  };
  const emitChange = (p) => Promise.all(handlers.filter(({ filter }) => filter && filter.table === p.table && (filter.event === '*' || filter.event === p.eventType)).map(({ cb }) => cb({ schema: 'public', ...p })));
  return { client, calls, responses, emit: (row) => handler && handler({ eventType: 'INSERT', schema: 'public', table: 'alerts', new: row }), emitChange, emitStatus: (s) => statusCb && statusCb(s), emitAuth: (event, session = null) => authHandler && authHandler(event, session) };
}
// calls of one table, without the from() entry: [{ op, args }]
export const opsOf = (calls, table) => calls.filter((c) => c.table === table && c.op !== 'from').map(({ op, args }) => ({ op, args }));
