/* An assistant's own chat answers from the system first (the owner 22 Nov — «يبقوا اذكية كفاية من غير مخ خارجي بناء علي … المعلومات
   اللي داخلالهم يوميا … و يديوني معلومات حقيقة ١٠٠٪ و لو احتاجوا مخ خارجي يسالوني و كل واحد متخصص في الحتة بتاعتوا» · «المدير
   العام … يرتب الشغل … و يوجهة المستخدم للموظف الصح»). Not a block. Pure (UMD), no model behind it.
     IBAgentBrain.answer(agent, text, ctx) → null (not the system's: the page asks before any outside model), or
       { type: 'status', text }            the numbers the assistant watches now (the general manager: every assistant's)
       { type: 'metric', text, key }       one number of its speciality, whether its rule holds, what to do
       { type: 'handoff', text, agent, question }   another assistant's speciality: «روح لـ…» with the question
     ctx: { facts: { at, agents: { <id>: { name, metrics: [{ key, label, now, nowText, kw, tip, rule }] } } } (ai_agent_facts —
            the assistants this member sees), norm(text), thinks(text) (a model's work: a why, an opinion, writing), when, en }
   Every number is the one the server counted; the engine adds none. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.IBAgentBrain = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const STATUS = /(^|\s)(اخبار|الاخبار|الوضع|وضع|ملخص|النهارده|انهارده|الجديد|الحاله|حاله|status|summary|overview|news|update me|whats new)(\s|$)/;
  const ASK = /(^|\s)(كام|كم|عدد|ايه|ايش|فيه|في|هل|عندي|عندنا|عندك|مين|انهي|how many|how much|any|what|which|who|is there|are there)(\s|$)/;
  const hits = (t, m) => (m.kw || []).reduce((n, k) => n + (t.includes(k) ? 1 + k.split(' ').length : 0), 0);
  const best = (t, list) => list.map((m) => ({ m, n: hits(t, m) })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n)[0] || null;

  function answer(agent, text, ctx) {
    const c = ctx || {}; const F = c.facts && c.facts.agents ? c.facts.agents : null; if (!F || !F[agent]) return null;
    const en = !!c.en; const tx = (ar, e) => (en ? e : ar); const raw = String(text == null ? '' : text).trim(); const t = (c.norm ? c.norm(raw) : raw.toLowerCase()).replace(/[؟?!.,،]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t || (c.thinks && c.thinks(raw))) return null;
    const asks = /[؟?]/.test(raw) || ASK.test(' ' + t + ' '); const status = STATUS.test(' ' + t + ' ');
    if (!asks && !status) return null; // an order, a wish, a text to write: not a question about a number
    const tail = c.when ? '\n' + tx('آخر تحديث: ', 'Last updated: ') + c.when : '';
    const line = (m) => (m.rule ? '⚠ ' : '• ') + m.label + ': ' + m.nowText;
    const one = (m) => ({ type: 'metric', key: m.key, text: m.label + ': ' + m.nowText + '.' + (m.rule ? '\n' + tx('القاعدة متحققة: ', 'The rule holds: ') + m.rule + '.' : '') + (m.rule && m.tip ? '\n' + m.tip : '') + tail });
    const own = F[agent].metrics || []; const mine = best(t, own);
    if (mine) return one(mine.m);
    // another assistant's number: the question goes to it (its numbers are its own to say)
    const others = Object.keys(F).filter((id) => id !== agent); let far = null;
    for (const id of others) { const b = best(t, F[id].metrics || []); if (b && (!far || b.n > far.n)) far = { id, n: b.n }; }
    if (far) return { type: 'handoff', agent: far.id, question: raw.slice(0, 1000), text: tx('ده تخصص «', 'This is the speciality of “') + F[far.id].name + tx('» — الأرقام دي عنده. اضغط وطلبك هيوصله ويبدأ معاك على طول.', '” — these numbers are its own. Press, and your request goes to it and it starts right away.') };
    if (!status) return null;
    if (agent === 'manager') { // every assistant's desk in a line: what holds, by name
      const rows = [agent].concat(others).filter((id) => (F[id].metrics || []).length).map((id) => { const hold = F[id].metrics.filter((m) => m.rule);
        return (hold.length ? '⚠ ' : '• ') + F[id].name + ': ' + (hold.length ? hold.map((m) => m.label + ' (' + m.nowText + ')').join(tx('، ', ', ')) : tx('تمام', 'fine')); });
      return rows.length ? { type: 'status', text: tx('الوضع دلوقتي عند كل مساعد:', 'Where every assistant stands now:') + '\n' + rows.join('\n') + tail } : null;
    }
    return own.length ? { type: 'status', text: tx('الأرقام اللي براقبها دلوقتي:', 'The numbers I watch now:') + '\n' + own.map(line).join('\n') + tail } : null;
  }
  return Object.freeze({ answer });
});
