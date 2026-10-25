// Chainable stand-in for the supabase-js client, shared by the adapter unit tests (not a test file itself).
// table(name) (the client's from) returns a query whose builder methods record themselves and return the query; awaiting it gives
// responses[name] (default { data: [], error: null }), read at await time so a test can change it between calls.
// Every call is recorded plain-cloned, so assertions compare objects of this realm, not of the vm context.
// channel() records too and returns { on, subscribe } (or throws with channelThrows); emit(row) plays a Realtime INSERT.
const OPS = ['select', 'eq', 'order', 'limit', 'upsert', 'insert', 'delete', 'match'];
const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
export function stubClient({ responses = {}, channelThrows = false } = {}) {
  const calls = []; let handler = null;
  const rec = (c) => { calls.push(plain(c)); };
  const table = (name) => {
    rec({ table: name, op: 'from' });
    const q = { then: (ok, ko) => Promise.resolve(responses[name] || { data: [], error: null }).then(ok, ko) };
    OPS.forEach((op) => { q[op] = (...args) => { rec({ table: name, op, args }); return q; }; });
    return q;
  };
  const client = {
    from: table,
    channel: (name) => {
      rec({ op: 'channel', args: [name] });
      if (channelThrows) throw new Error('realtime unavailable');
      const ch = { on: (type, filter, cb) => { rec({ op: 'on', args: [type, filter] }); handler = cb; return ch; }, subscribe: () => { rec({ op: 'subscribe' }); return ch; } };
      return ch;
    },
    removeChannel: () => { rec({ op: 'removeChannel' }); return Promise.resolve('ok'); },
  };
  return { client, calls, responses, emit: (row) => handler && handler({ eventType: 'INSERT', schema: 'public', table: 'alerts', new: row }) };
}
// calls of one table, without the from() entry: [{ op, args }]
export const opsOf = (calls, table) => calls.filter((c) => c.table === table && c.op !== 'from').map(({ op, args }) => ({ op, args }));
