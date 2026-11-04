// wa-bridge (phase 6.4, decisions 21–22): WhatsApp 1 (customers) and 2 (makers) by QR, like WhatsApp Web, through Baileys.
// It holds no database key: every read and write goes through the cs-wa Edge Function with X-Bridge-Secret.
//
//   env  CS_WA_URL          https://<project>.supabase.co/functions/v1/cs-wa
//        WA_BRIDGE_SECRET   the same 32+ character secret as the Supabase secret of that name
//        WA_CHANNELS        wa1,wa2 (default both)
//        WA_DATA            the folder of the sessions (default /data — a Docker volume; keep it private)
//
// Per channel: the QR (as SVG) goes to cs-wa while waiting to be scanned; once linked, every incoming message (and every message
// sent from the phone itself) goes to cs-wa «inbound», receipts to «receipt»; every 3 s the queued replies of the inbox («outbox»)
// are sent and reported («sent»); the campaigns are sent one at a time as cs-wa's pacing allows («campaign_next» / «campaign_result»).
// A «logout» command from the admin (in the answer to «state») unlinks the number. Nothing of a message is logged.
import fs from 'node:fs/promises';
import path from 'node:path';
import pino from 'pino';
import QRCode from 'qrcode';
import * as B from '@whiskeysockets/baileys';
import { api, inboundOf, receiptOf, phoneOfUser, nextCampaignDelay } from './logic.js';

// Baileys 6 is CommonJS: its names sit on the namespace or on its default export, depending on the loader
const lib = B.useMultiFileAuthState ? B : B.default;
const makeWASocket = typeof lib.default === 'function' ? lib.default : lib.makeWASocket;
const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = lib;
const log = pino({ level: process.env.LOG_LEVEL || 'info' });
const quiet = pino({ level: 'silent' }); // Baileys' own logger: its debug lines carry message contents
const call = api({ url: process.env.CS_WA_URL, secret: process.env.WA_BRIDGE_SECRET });
const DATA = process.env.WA_DATA || '/data';
const CHANNELS = (process.env.WA_CHANNELS || 'wa1,wa2').split(',').map((s) => s.trim()).filter((c) => c === 'wa1' || c === 'wa2');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function report(channel, status, extra = {}) {
  try {
    const out = await call('state', { channel, status, ...extra });
    return out && out.command ? out.command : null;
  } catch (e) { log.warn({ channel, status: e.status }, 'state not reported'); return null; }
}

function startChannel(channel) {
  const dir = path.join(DATA, channel);
  const st = { sock: null, open: false, stopped: false, fails: 0 };

  async function connect() {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const { state, saveCreds } = await useMultiFileAuthState(dir);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
    const sock = makeWASocket({ version, auth: state, logger: quiet, printQRInTerminal: false, browser: Browsers.ubuntu('Ibtekr Ops'), markOnlineOnConnect: false, syncFullHistory: false });
    st.sock = sock;
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', async (u) => {
      if (u.qr) { const svg = await QRCode.toString(u.qr, { type: 'svg', margin: 1 }); await report(channel, 'qr', { qr_svg: svg }); }
      if (u.connection === 'connecting') await report(channel, 'connecting');
      if (u.connection === 'open') {
        st.open = true; st.fails = 0;
        const cmd = await report(channel, 'connected', { phone: phoneOfUser(sock.user && sock.user.id) });
        if (cmd === 'logout') await sock.logout().catch(() => {});
      }
      if (u.connection === 'close') {
        st.open = false;
        const code = u.lastDisconnect && u.lastDisconnect.error && u.lastDisconnect.error.output ? u.lastDisconnect.error.output.statusCode : 0;
        if (code === DisconnectReason.loggedOut) {
          await report(channel, 'logged_out');
          await fs.rm(dir, { recursive: true, force: true }); // a fresh QR next time
        } else await report(channel, 'offline');
        // reconnect with a growing pause (3 s → 60 s) while WhatsApp cannot be reached
        if (!st.stopped) { st.fails += 1; await sleep(Math.min(60000, 3000 * 2 ** Math.min(5, st.fails - 1))); connect().catch((e) => log.error({ channel, err: e.message }, 'reconnect failed')); }
      }
    });
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify' && type !== 'append') return;
      for (const wm of messages) {
        const body = inboundOf(channel, wm); if (!body || !body.id) continue;
        try { await call('inbound', body); } catch (e) { log.warn({ channel, status: e.status }, 'inbound not taken'); }
      }
    });
    sock.ev.on('messages.update', async (updates) => {
      const by = { delivered: [], read: [] };
      for (const x of updates) { const r = x.update && x.update.status != null ? receiptOf(x.update.status) : null; if (r && x.key && x.key.fromMe && x.key.id) by[r].push(x.key.id); }
      for (const [status, ids] of Object.entries(by)) if (ids.length) { try { await call('receipt', { channel, ids: ids.slice(0, 100), status }); } catch { /* the next receipt will do */ } }
    });
  }

  // the inbox's queued replies, every 3 seconds while linked
  async function outboxLoop() {
    for (;;) {
      await sleep(3000);
      if (!st.open || !st.sock) continue;
      try {
        const { items = [] } = await call('outbox', { channel });
        for (const m of items) {
          try { const r = await st.sock.sendMessage(m.jid, { text: m.text }); await call('sent', { id: m.id, ok: true, wa_id: r && r.key ? r.key.id : null }); }
          catch (e) { await call('sent', { id: m.id, ok: false, error: e && e.message === 'not_on_whatsapp' ? 'not_on_whatsapp' : 'send_failed' }).catch(() => {}); }
          await sleep(1500);
        }
      } catch (e) { log.warn({ channel, status: e.status }, 'outbox'); }
    }
  }
  // the campaigns, one message at a time, as fast as cs-wa's pacing allows (the day's cap, the pause, the live switch)
  async function campaignLoop() {
    for (;;) {
      let wait = 15000;
      if (st.open && st.sock) {
        try {
          const answer = await call('campaign_next', { channel });
          for (const it of answer.items || []) {
            const [on] = await st.sock.onWhatsApp(it.jid).catch(() => [null]);
            if (!on || !on.exists) { await call('campaign_result', { recipient_id: it.recipient_id, ok: false, error: 'not_on_whatsapp' }); continue; }
            try { const r = await st.sock.sendMessage(it.jid, { text: it.text }); await call('campaign_result', { recipient_id: it.recipient_id, ok: true, wa_id: r && r.key ? r.key.id : null }); }
            catch { await call('campaign_result', { recipient_id: it.recipient_id, ok: false, error: 'send_failed' }).catch(() => {}); }
          }
          wait = nextCampaignDelay(answer);
        } catch (e) { log.warn({ channel, status: e.status }, 'campaign'); }
      }
      await sleep(wait);
    }
  }
  // a heartbeat: the state every minute (and the admin's logout, if one waits)
  async function heartbeat() {
    for (;;) {
      await sleep(60000);
      if (!st.sock) continue;
      const cmd = await report(channel, st.open ? 'connected' : 'offline', st.open ? { phone: phoneOfUser(st.sock.user && st.sock.user.id) } : {});
      if (cmd === 'logout' && st.open) await st.sock.logout().catch(() => {});
    }
  }

  connect().catch((e) => log.error({ channel, err: e.message }, 'start failed'));
  outboxLoop(); campaignLoop(); heartbeat();
  return st;
}

log.info({ channels: CHANNELS }, 'wa-bridge starting');
const running = CHANNELS.map(startChannel);
const stop = async () => { running.forEach((s) => { s.stopped = true; }); for (const ch of CHANNELS) await report(ch, 'offline'); process.exit(0); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
