import { test } from 'node:test'; import assert from 'node:assert/strict';
import { normPhone, phoneOfJid, jidOfPhone, parseInbound, parseState, isOptOut, campaignText, cairoDayStart, paceOk, shouldStop, sameSecret, OPT_OUT } from '../../supabase/functions/_shared/cs-wa.js';
// WhatsApp by QR (phase 6.4) and the campaigns' sending (6.3): the pure part of cs-wa.

test('the phone of a WhatsApp id and back (Egypt local ↔ international); groups / broadcasts are not people', () => {
  assert.equal(phoneOfJid('201012345678@s.whatsapp.net'), '01012345678');
  assert.equal(phoneOfJid('201012345678:12@s.whatsapp.net'), '01012345678', 'a device suffix');
  assert.equal(phoneOfJid('120363012345@g.us'), null);
  assert.equal(phoneOfJid('status@broadcast'), null);
  assert.equal(jidOfPhone('01012345678'), '201012345678@s.whatsapp.net');
  assert.equal(jidOfPhone('٠١٠١٢٣٤٥٦٧٨'), '201012345678@s.whatsapp.net', 'Arabic-Indic digits');
  assert.equal(jidOfPhone('+966501234567'), '966501234567@s.whatsapp.net');
  assert.equal(jidOfPhone('12'), null);
  assert.equal(normPhone('0020 101 234 5678'), '01012345678');
});

test('the bridge bodies are checked: an inbound message (text or media label), a state with a clean SVG only', () => {
  const ev = parseInbound({ channel: 'wa1', jid: '201012345678@s.whatsapp.net', id: '3EB0ABC123', fromMe: false, name: 'نهى', text: '  بكام؟ ', at: 1762000000 });
  assert.deepEqual([ev.phone, ev.text, ev.at, ev.fromMe, ev.name], ['01012345678', 'بكام؟', 1762000000000, false, 'نهى']);
  assert.equal(parseInbound({ channel: 'wa1', jid: '201012345678@s.whatsapp.net', id: '3EB0ABC124', kind: 'image', text: '' }).text, '[صورة]');
  assert.equal(parseInbound({ channel: 'wa3', jid: '201012345678@s.whatsapp.net', id: '3EB0ABC125' }), null);
  assert.equal(parseInbound({ channel: 'wa1', jid: '120363@g.us', id: '3EB0ABC126' }), null);
  assert.equal(parseInbound({ channel: 'wa1', jid: '201012345678@s.whatsapp.net', id: 'x y' }), null);
  const s = parseState({ channel: 'wa2', status: 'qr', qr_svg: '<svg viewBox="0 0 10 10"><path d="M0 0h1v1H0z"/></svg>' });
  assert.ok(s.qr_svg.startsWith('<svg'));
  assert.equal(parseState({ channel: 'wa2', status: 'qr', qr_svg: '<svg onload="alert(1)"></svg>' }).qr_svg, null, 'an SVG with a handler is dropped');
  assert.equal(parseState({ channel: 'wa2', status: 'qr', qr_svg: '<svg><script>x</script></svg>' }).qr_svg, null);
  assert.equal(parseState({ channel: 'wa1', status: 'connected', phone: '201012345678', qr_svg: '<svg/>' }).qr_svg, null, 'no QR once connected');
  assert.equal(parseState({ channel: 'wa1', status: 'connected', phone: '201012345678' }).phone, '01012345678');
  assert.equal(parseState({ channel: 'wa1', status: 'hacked' }), null);
});

test('the campaign text: the first name, the code, the opt-out line once; «إيقاف» is an opt-out', () => {
  assert.equal(campaignText('أهلا {اسم_العميل}! كود {كود_الخصم}', { name: 'نهى حسن', code: 'IB10' }), 'أهلا نهى! كود IB10\n\n' + OPT_OUT);
  assert.equal(campaignText('عرض — اكتب إيقاف للإلغاء', {}), 'عرض — اكتب إيقاف للإلغاء');
  assert.ok(isOptOut(' إيقاف ')); assert.ok(isOptOut('STOP')); assert.ok(!isOptOut('مش عايز أوقف الأوردر'));
});

test('the pacing: the day starts at Cairo midnight (summer and winter), the cap and the pause; the auto stop', () => {
  assert.equal(cairoDayStart('2026-11-04T05:00:00Z'), '2026-11-03T22:00:00.000Z', 'winter: +2');
  assert.equal(cairoDayStart('2026-07-04T05:00:00Z'), '2026-07-03T21:00:00.000Z', 'summer: +3');
  assert.deepEqual(paceOk({ sentToday: 300, cap: 300, lastAt: null, minDelayS: 20, nowMs: 0 }), { ok: false, reason: 'cap' });
  assert.equal(paceOk({ sentToday: 1, cap: 300, lastAt: 1000, minDelayS: 20, nowMs: 11000 }).reason, 'delay');
  assert.deepEqual(paceOk({ sentToday: 1, cap: 300, lastAt: 1000, minDelayS: 20, nowMs: 21000 }), { ok: true });
  assert.ok(!shouldStop({ sent: 10, failed: 5 }), 'not before 20 sends');
  assert.ok(shouldStop({ sent: 95, failed: 5 }));
  assert.ok(!shouldStop({ sent: 99, failed: 1 }));
});

test('the bridge secret: constant-time, never a short one', () => {
  const s = 'x'.repeat(40);
  assert.ok(sameSecret(s, s)); assert.ok(!sameSecret(s + 'y', s)); assert.ok(!sameSecret('', s)); assert.ok(!sameSecret('short', 'short'));
});
