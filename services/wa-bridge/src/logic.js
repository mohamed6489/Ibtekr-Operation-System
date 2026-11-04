// wa-bridge — the pure part (phase 6.4 decisions 21–22): a Baileys message → the body cs-wa takes, the receipt statuses, the API
// client (fetch injected) and the pacing of the loops. No Baileys import here, so node --test runs it anywhere.

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const unwrap = (m) => { // ephemeral / view-once / edited wrappers → the inner message
  let x = m;
  for (let i = 0; i < 4 && isObj(x); i++) {
    const inner = x.ephemeralMessage?.message || x.viewOnceMessage?.message || x.viewOnceMessageV2?.message || x.documentWithCaptionMessage?.message || x.editedMessage?.message;
    if (!inner) break; x = inner;
  }
  return x;
};
// the text and the kind of a WhatsApp message (media keep their caption, if any)
export function contentOf(message) {
  const m = unwrap(message);
  if (!isObj(m)) return null;
  if (typeof m.conversation === 'string') return { kind: 'text', text: m.conversation };
  if (isObj(m.extendedTextMessage)) return { kind: 'text', text: String(m.extendedTextMessage.text ?? '') };
  if (isObj(m.imageMessage)) return { kind: 'image', text: String(m.imageMessage.caption ?? '') };
  if (isObj(m.videoMessage)) return { kind: 'video', text: String(m.videoMessage.caption ?? '') };
  if (isObj(m.audioMessage)) return { kind: 'audio', text: '' };
  if (isObj(m.documentMessage)) return { kind: 'document', text: String(m.documentMessage.caption ?? m.documentMessage.fileName ?? '') };
  if (isObj(m.stickerMessage)) return { kind: 'sticker', text: '' };
  if (isObj(m.locationMessage) || isObj(m.liveLocationMessage)) return { kind: 'location', text: '' };
  if (isObj(m.contactMessage) || isObj(m.contactsArrayMessage)) return { kind: 'contact', text: '' };
  if (isObj(m.buttonsResponseMessage)) return { kind: 'text', text: String(m.buttonsResponseMessage.selectedDisplayText ?? '') };
  if (isObj(m.listResponseMessage)) return { kind: 'text', text: String(m.listResponseMessage.title ?? '') };
  if (m.protocolMessage || m.reactionMessage || m.senderKeyDistributionMessage) return null; // not a message a person reads
  return { kind: 'other', text: '' };
}
// a Baileys WAMessage → the cs-wa «inbound» body, or null (groups, broadcasts, status, protocol messages)
export function inboundOf(channel, wm) {
  if (!isObj(wm) || !isObj(wm.key)) return null;
  const jid = String(wm.key.remoteJid ?? '');
  if (!/@s\.whatsapp\.net$/.test(jid)) return null;
  const c = contentOf(wm.message); if (!c) return null;
  const ts = Number(typeof wm.messageTimestamp === 'object' && wm.messageTimestamp ? wm.messageTimestamp.low ?? wm.messageTimestamp : wm.messageTimestamp);
  return { action: 'inbound', channel, jid, id: String(wm.key.id ?? ''), fromMe: wm.key.fromMe === true, name: wm.key.fromMe ? null : (wm.pushName || null), kind: c.kind, text: c.text, at: Number.isFinite(ts) && ts > 0 ? ts : null };
}
// Baileys' message status (2 server ack, 3 delivered, 4 read, 5 played) → ours
export const receiptOf = (status) => (status >= 4 ? 'read' : status === 3 ? 'delivered' : null);
// the linked number of the session (sock.user.id = '2010…:12@s.whatsapp.net')
export const phoneOfUser = (id) => { const m = /^(\d{6,15})/.exec(String(id ?? '')); return m ? m[1] : null; };

// the cs-wa client: one POST per call with the bridge secret; never logs a body
export function api({ url, secret, fetch: f = fetch, timeoutMs = 20000 }) {
  if (!/^https:\/\//.test(url || '') && !/^http:\/\/(127\.0\.0\.1|localhost)/.test(url || '')) throw new Error('CS_WA_URL must be https');
  if (!secret || secret.length < 32) throw new Error('WA_BRIDGE_SECRET must be 32+ characters');
  return async (action, body = {}) => {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await f(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-bridge-secret': secret }, body: JSON.stringify({ action, ...body }), signal: ctl.signal });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) { const e = new Error('cs-wa ' + action + ' ' + res.status + ' ' + (out.error || '')); e.status = res.status; throw e; }
      return out;
    } finally { clearTimeout(t); }
  };
}
// the next pause of the campaign loop: what cs-wa asked (wait_ms), bounded to [2 s, 60 s]; 5 s after a send or when idle
export const nextCampaignDelay = (answer) => {
  const w = Number(answer && answer.wait_ms);
  if (answer && Array.isArray(answer.items) && answer.items.length) return 5000;
  return Number.isFinite(w) && w > 0 ? Math.min(60000, Math.max(2000, w)) : 15000;
};
