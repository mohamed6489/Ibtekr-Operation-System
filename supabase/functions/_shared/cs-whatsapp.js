// WhatsApp 1 on Meta's Cloud API by coexistence (phase 6, decision 26) — the pure parts of cs-whatsapp: the Embedded Signup dialog,
// the Graph paths, the webhook (messages, the replies sent from the phone, the history, the contacts, the statuses) reduced to
// events, the phone ↔ wa_id mapping and the send body. Node-testable (tests/functions/cs-whatsapp.test.mjs); nothing here logs.
import { cut, graphErrorCode } from './cs-channel.js';
import { normPhone } from './cs-wa.js';

export const WA_GRAPH_VERSION = 'v25.0';
export const WA_GRAPH = 'https://graph.facebook.com/' + WA_GRAPH_VERSION;
export const WA_DIALOG = 'https://www.facebook.com/' + WA_GRAPH_VERSION + '/dialog/oauth';
export const STATE_PREFIX = 'wa_'; // the callback page sends a state with this prefix to cs-whatsapp (the others go to cs-channel)
export const MAX_TEXT = 4000;
export { graphErrorCode };

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const clean = (v, n = MAX_TEXT) => cut(str(v), n).replace(/\u0000/g, '').trim();
const when = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? (n < 1e11 ? n * 1000 : n) : null; }; // seconds → ms
const digits = (v) => str(v).replace(/\D/g, '');
const ID = /^[A-Za-z0-9_.:=+/-]{4,160}$/;
const msgId = (v) => (ID.test(str(v)) ? str(v) : null);

// ---------------------------------------------------------------- phone ↔ wa_id
// our phone (cs_customers.phone / the conversation's external_id) is the normalised local number (0100…); WhatsApp's wa_id is
// the international digits (20100…). A foreign number stays its digits both ways.
export const phoneOfWaId = (waId) => { const d = digits(waId); return d.length >= 6 && d.length <= 15 ? normPhone(d) : null; };
export const waIdOfPhone = (phone) => { const d = digits(phone); if (/^01\d{9}$/.test(d)) return '20' + d.slice(1); return d.length >= 6 && d.length <= 15 ? d : null; };

// ---------------------------------------------------------------- the dialog (Embedded Signup, the WhatsApp Business app option)
// ES v4 (Meta's Embedded Signup Builder, 4 Nov: v2/v3 deprecated after 15 Oct 2026)
export const EXTRAS = { setup: {}, featureType: 'whatsapp_business_app_onboarding', sessionInfoVersion: '3', version: 'v4' };
export function waAuthUrl(appId, redirectUri, state, configId) {
  const q = new URLSearchParams({ client_id: appId, redirect_uri: redirectUri, state, config_id: configId, response_type: 'code', override_default_response_type: 'true', extras: JSON.stringify(EXTRAS) });
  return WA_DIALOG + '?' + q.toString();
}

export const waPath = {
  tokenExchange: (appId, redirectUri, code) => WA_GRAPH + '/oauth/access_token?' + new URLSearchParams({ client_id: appId, redirect_uri: redirectUri, code }).toString() + '&client_secret=',
  debugToken: (inputToken) => WA_GRAPH + '/debug_token?' + new URLSearchParams({ input_token: inputToken }).toString(),
  phones: (wabaId) => WA_GRAPH + '/' + wabaId + '/phone_numbers?fields=id,display_phone_number,verified_name,is_on_biz_app,platform_type&limit=20',
  phone: (phoneId) => WA_GRAPH + '/' + phoneId + '?fields=id,display_phone_number,verified_name,is_on_biz_app,platform_type,quality_rating',
  subscribe: (wabaId) => WA_GRAPH + '/' + wabaId + '/subscribed_apps',
  sync: (phoneId) => WA_GRAPH + '/' + phoneId + '/smb_app_data',
  send: (phoneId) => WA_GRAPH + '/' + phoneId + '/messages',
};
export const syncBody = (type) => ({ messaging_product: 'whatsapp', sync_type: type === 'history' ? 'history' : 'smb_app_state_sync' });
export const textBody = (waId, text) => ({ messaging_product: 'whatsapp', recipient_type: 'individual', to: waId, type: 'text', text: { preview_url: false, body: text } });
export const sentIdOf = (json) => (isObj(json) && Array.isArray(json.messages) && isObj(json.messages[0]) ? msgId(json.messages[0].id) : null);

// the WhatsApp accounts the business token reaches: debug_token's granular scopes (whatsapp_business_management → the WABA ids)
export function wabaIdsOf(json) {
  const d = isObj(json) && isObj(json.data) ? json.data : {};
  const out = new Set();
  for (const g of Array.isArray(d.granular_scopes) ? d.granular_scopes : []) {
    if (!isObj(g) || (g.scope !== 'whatsapp_business_management' && g.scope !== 'whatsapp_business_messaging')) continue;
    for (const t of Array.isArray(g.target_ids) ? g.target_ids : []) if (/^\d{5,30}$/.test(str(t))) out.add(str(t));
  }
  return [...out];
}
// the numbers of a WABA (ids and display only); the coexistence one first
export function phonesOf(json) {
  const list = isObj(json) && Array.isArray(json.data) ? json.data : [];
  return list.filter((p) => isObj(p) && /^\d{5,30}$/.test(str(p.id))).map((p) => ({ id: str(p.id), display: clean(p.display_phone_number, 40) || null, name: clean(p.verified_name, 120) || null, biz_app: p.is_on_biz_app === true, platform: clean(p.platform_type, 30) || null }))
    .sort((a, b) => Number(b.biz_app) - Number(a.biz_app));
}

// ---------------------------------------------------------------- a message's text (the media as a short Arabic label + its caption)
const MEDIA = { image: 'صورة', video: 'فيديو', audio: 'فويس', voice: 'فويس', document: 'ملف', sticker: 'ستيكر' };
export function textOf(m) {
  if (!isObj(m)) return null;
  const t = str(m.type);
  if (t === 'text') return clean(isObj(m.text) ? m.text.body : '') || null;
  if (MEDIA[t]) { const o = isObj(m[t]) ? m[t] : {}; const cap = clean(o.caption || o.filename || '', 1000); const label = t === 'audio' && o.voice === false ? 'ملف صوتي' : MEDIA[t]; return '[' + label + ']' + (cap ? ' ' + cap : ''); }
  if (t === 'location') { const o = isObj(m.location) ? m.location : {}; const name = clean(o.name || o.address || '', 300); return '[موقع]' + (name ? ' ' + name : ''); }
  if (t === 'contacts') return '[جهة اتصال]';
  if (t === 'interactive') { const o = isObj(m.interactive) ? m.interactive : {}; const r = isObj(o.button_reply) ? o.button_reply : isObj(o.list_reply) ? o.list_reply : isObj(o.nfm_reply) ? o.nfm_reply : {}; return clean(r.title || r.name || '', 1000) || '[رد على زرار]'; }
  if (t === 'button') return clean(isObj(m.button) ? m.button.text : '', 1000) || '[رد على زرار]';
  if (t === 'order') return '[طلب من الكتالوج]';
  if (t === 'reaction' || t === 'edit' || t === 'revoke' || t === 'system' || t === 'ephemeral') return null; // not a message of the thread
  return '[رسالة مش مدعومة]';
}
const kindOf = (m) => (MEDIA[str(m.type)] ? str(m.type) : str(m.type) || 'unknown').slice(0, 20);

// ---------------------------------------------------------------- the webhook → events
// { object: 'whatsapp_business_account', entry: [{ id: <WABA id>, changes: [{ field, value }] }] } → { entries: [{ id, phoneId, events }] }
// events: in (a customer's message) · echo (a reply sent from the phone) · status (sent / delivered / read / failed of ours) ·
// history (a past message, in or out, with its original time) · history_meta (phase / progress / an error code) · contact · other
export function parseWaWebhook(body) {
  if (!isObj(body) || body.object !== 'whatsapp_business_account' || !Array.isArray(body.entry)) return null;
  const entries = [];
  for (const e of body.entry) {
    if (!isObj(e)) continue;
    const id = str(e.id); const events = []; let phoneId = null;
    for (const ch of Array.isArray(e.changes) ? e.changes : []) {
      if (!isObj(ch) || !isObj(ch.value)) continue;
      const v = ch.value; const field = str(ch.field);
      if (isObj(v.metadata) && /^\d{5,30}$/.test(str(v.metadata.phone_number_id))) phoneId = str(v.metadata.phone_number_id);
      if (field === 'messages') {
        const names = new Map((Array.isArray(v.contacts) ? v.contacts : []).filter(isObj).map((c) => [digits(c.wa_id), clean(isObj(c.profile) ? c.profile.name : '', 120) || null]));
        for (const m of Array.isArray(v.messages) ? v.messages : []) {
          if (!isObj(m)) continue;
          const waId = digits(m.from); const mid = msgId(m.id); const text = textOf(m);
          if (!waId || !mid) { events.push({ type: 'other', field: 'bad_message' }); continue; }
          if (text === null) { events.push({ type: 'other', field: 'messages_' + kindOf(m) }); continue; }
          events.push({ type: 'in', waId, name: names.get(waId) ?? null, id: mid, at: when(m.timestamp), text, kind: kindOf(m), replyTo: isObj(m.context) ? msgId(m.context.id) : null });
        }
        for (const s of Array.isArray(v.statuses) ? v.statuses : []) {
          if (!isObj(s) || !msgId(s.id)) continue;
          const st = str(s.status); const err = Array.isArray(s.errors) && isObj(s.errors[0]) && Number.isFinite(Number(s.errors[0].code)) ? 'wa_' + Number(s.errors[0].code) : null;
          if (['sent', 'delivered', 'read', 'failed'].includes(st)) events.push({ type: 'status', id: msgId(s.id), status: st, at: when(s.timestamp), waId: digits(s.recipient_id) || null, error: err });
        }
      } else if (field === 'smb_message_echoes') {
        for (const m of Array.isArray(v.message_echoes) ? v.message_echoes : []) {
          if (!isObj(m)) continue;
          const waId = digits(m.to); const mid = msgId(m.id); const text = textOf(m);
          if (!waId || !mid || text === null) { events.push({ type: 'other', field: 'echo_' + kindOf(m) }); continue; }
          events.push({ type: 'echo', waId, id: mid, at: when(m.timestamp), text, kind: kindOf(m) });
        }
      } else if (field === 'history') {
        for (const h of Array.isArray(v.history) ? v.history : []) {
          if (!isObj(h)) continue;
          if (Array.isArray(h.errors) && h.errors.length) { const c = isObj(h.errors[0]) && Number.isFinite(Number(h.errors[0].code)) ? 'wa_' + Number(h.errors[0].code) : 'wa_error'; events.push({ type: 'history_meta', error: c }); continue; }
          const md = isObj(h.metadata) ? h.metadata : {};
          events.push({ type: 'history_meta', phase: Number.isFinite(Number(md.phase)) ? Number(md.phase) : null, chunk: Number.isFinite(Number(md.chunk_order)) ? Number(md.chunk_order) : null, progress: Number.isFinite(Number(md.progress)) ? Number(md.progress) : null });
          for (const th of Array.isArray(h.threads) ? h.threads : []) {
            if (!isObj(th)) continue;
            const user = digits(th.id);
            for (const m of Array.isArray(th.messages) ? th.messages : []) {
              if (!isObj(m)) continue;
              const mid = msgId(m.id); const text = textOf(m); const from = digits(m.from);
              if (!user || !mid || text === null) { events.push({ type: 'other', field: 'history_' + kindOf(m) }); continue; }
              events.push({ type: 'history', waId: user, id: mid, at: when(m.timestamp), text, kind: kindOf(m), out: !!from && from !== user });
            }
          }
        }
      } else if (field === 'smb_app_state_sync') {
        for (const s of Array.isArray(v.state_sync) ? v.state_sync : []) {
          if (!isObj(s) || !isObj(s.contact)) continue;
          const waId = digits(s.contact.phone_number); const name = clean(s.contact.full_name || s.contact.first_name || '', 120) || null;
          if (waId) events.push({ type: 'contact', waId, name, action: clean(s.action, 20) || 'add' });
        }
      } else events.push({ type: 'other', field: field.replace(/[^a-z_]/g, '').slice(0, 30) || 'other' });
    }
    entries.push({ id, phoneId, events });
  }
  return { object: 'whatsapp_business_account', entries };
}
