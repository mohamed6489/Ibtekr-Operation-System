// The Magnific MCP layer of ai-images (phase 5.4 decision 11): the only file that knows how the system speaks to the Magnific site's
// MCP server — OAuth 2.1 on its Keycloak (https://auth.magnific.com/realms/mcp: discovery, PKCE S256, the authorization code, the
// refresh token) and the Streamable HTTP transport of https://mcp.magnific.com (one POST per JSON-RPC message, a JSON or an SSE
// answer, the session id in the Mcp-Session-Id header, the protocol version header). Pinned on 1 Nov from the server's own
// metadata (read through pg_net from the project's database: .well-known/oauth-protected-resource and
// oauth-authorization-server; the client the system registered there lives in Vault as magnific_mcp_client).
// Nothing here is logged with a token, a code or a link.
import { toolData } from '../../_shared/mcp-text.js';

// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;
export type Tokens = { access_token: string; refresh_token: string | null; expires_at: string; account: string | null };
export type Bridge = {
  pkce: () => Promise<{ verifier: string; challenge: string }>;
  authUrl: (clientId: string, redirectUri: string, state: string, challenge: string) => Promise<string>;
  exchangeCode: (clientId: string, redirectUri: string, code: string, verifier: string) => Promise<Tokens>;
  refresh: (clientId: string, tokens: Tokens) => Promise<Tokens>;
  callTool: (accessToken: string, name: string, args: Json) => Promise<unknown>;
};
export class BridgeError extends Error {
  kind: 'not_linked' | 'busy' | 'refused' | 'mcp_error';
  status: number | null;
  detail: string | null; // a safe word on what came back (keys and any error text, cut short) — never a token or a link
  constructor(kind: BridgeError['kind'], status: number | null = null, detail: string | null = null) { super(kind); this.kind = kind; this.status = status; this.detail = detail; }
}

const MCP_URL = 'https://mcp.magnific.com';
const AUTH_ISSUER = 'https://auth.magnific.com/realms/mcp';
export const SCOPE = 'openid profile email mcp:custom-audience offline_access';
const PROTOCOL = '2025-06-18';
const TIMEOUT_MS = 60_000;
const MAX_DETAIL = 300;

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
/** Random url-safe text of 32 bytes (43 characters) — a state or a PKCE verifier. */
export const randomText = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
/** A short, safe description of an answer: its top keys and any error / message text, at most 300 characters, long tokens masked. */
export function describe(j: unknown): string {
  if (j === null || typeof j !== 'object') return typeof j === 'string' ? j.replace(/[A-Za-z0-9._-]{40,}/g, '<tok>').slice(0, MAX_DETAIL) : typeof j;
  const o = j as Json;
  const text = [o.error, o.error_description, o.message, o.detail].filter((x) => x !== undefined).map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' | ');
  return (Object.keys(o).join(',') + (text ? ' :: ' + text : '')).replace(/[A-Za-z0-9._-]{40,}/g, '<tok>').slice(0, MAX_DETAIL);
}

/** The SSE body of a Streamable HTTP answer → the JSON-RPC messages it carried (one per `data:` event). */
export function sseMessages(body: string): Json[] {
  const out: Json[] = [];
  for (const ev of body.replace(/\r\n?/g, '\n').split('\n\n')) {
    const data = ev.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
    if (!data) continue;
    try { const j = JSON.parse(data); if (j && typeof j === 'object') out.push(j); } catch { /* not a JSON event */ }
  }
  return out;
}

export function magnificMcp(env: Record<string, string | undefined>, fetchFn: typeof fetch = fetch): Bridge {
  const mcp = (env.MAGNIFIC_MCP_URL ?? MCP_URL).replace(/\/+$/, '');
  const issuer = (env.MAGNIFIC_AUTH_URL ?? AUTH_ISSUER).replace(/\/+$/, '');
  let discovery: Json | null = null;
  async function oidc(): Promise<Json> {
    if (discovery) return discovery;
    let res: Response;
    try { res = await fetchFn(issuer + '/.well-known/openid-configuration', { signal: AbortSignal.timeout(TIMEOUT_MS) }); } catch { throw new BridgeError('busy'); }
    if (!res.ok) throw new BridgeError('busy', res.status);
    const j = await res.json().catch(() => null);
    if (!j || typeof j.authorization_endpoint !== 'string' || typeof j.token_endpoint !== 'string') throw new BridgeError('mcp_error', res.status, 'no endpoints');
    discovery = j;
    return j;
  }
  async function tokenCall(form: Record<string, string>): Promise<Tokens> {
    const d = await oidc();
    let res: Response;
    try { res = await fetchFn(d.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams(form).toString(), signal: AbortSignal.timeout(TIMEOUT_MS) }); }
    catch { throw new BridgeError('busy'); }
    const j: Json = await res.json().catch(() => ({}));
    if (res.status === 429 || res.status >= 500) throw new BridgeError('busy', res.status, describe(j));
    if (!res.ok || typeof j.access_token !== 'string') throw new BridgeError(res.status === 400 || res.status === 401 ? 'refused' : 'mcp_error', res.status, describe(j));
    const life = Number(j.expires_in); const seconds = Number.isFinite(life) && life > 0 ? life : 300;
    return { access_token: j.access_token, refresh_token: typeof j.refresh_token === 'string' ? j.refresh_token : null, expires_at: new Date(Date.now() + seconds * 1000).toISOString(), account: null };
  }
  async function account(d: Json, accessToken: string): Promise<string | null> {
    if (typeof d.userinfo_endpoint !== 'string') return null;
    try {
      const res = await fetchFn(d.userinfo_endpoint, { headers: { Authorization: 'Bearer ' + accessToken, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) return null;
      const j: Json = await res.json().catch(() => ({}));
      const who = [j.email, j.preferred_username, j.name].find((x) => typeof x === 'string' && x.trim());
      return who ? String(who).trim().slice(0, 120) : null;
    } catch { return null; }
  }
  // one JSON-RPC message in, the answer with the same id out (a JSON body or an SSE stream), the session id carried along
  async function rpc(accessToken: string, session: string | null, msg: Json): Promise<{ answer: Json | null; session: string | null }> {
    let res: Response;
    try {
      res = await fetchFn(mcp + '/', { method: 'POST', headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': PROTOCOL, ...(session ? { 'Mcp-Session-Id': session } : {}) }, body: JSON.stringify(msg), signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch { throw new BridgeError('busy'); }
    const sid = res.headers.get('mcp-session-id') ?? session;
    if (res.status === 401 || res.status === 403) throw new BridgeError('not_linked', res.status);
    if (res.status === 429 || res.status >= 500) throw new BridgeError('busy', res.status);
    if (res.status === 202 || res.status === 204) return { answer: null, session: sid }; // a notification accepted
    const ct = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const text = await res.text();
    let messages: Json[] = [];
    if (ct === 'text/event-stream') messages = sseMessages(text);
    else { try { const j = JSON.parse(text); messages = Array.isArray(j) ? j : j && typeof j === 'object' ? [j] : []; } catch { messages = []; } }
    if (!res.ok) throw new BridgeError('mcp_error', res.status, describe(messages[0] ?? text));
    const answer = msg.id === undefined ? null : messages.find((m) => m.id === msg.id) ?? null;
    if (msg.id !== undefined && !answer) throw new BridgeError('mcp_error', res.status, 'no answer');
    if (answer?.error) throw new BridgeError('mcp_error', res.status, describe(answer.error));
    return { answer, session: sid };
  }

  return {
    pkce: async () => {
      const verifier = randomText() + randomText().slice(0, 21); // 64 characters, within 43–128
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
      return { verifier, challenge: b64url(digest) };
    },
    authUrl: async (clientId, redirectUri, state, challenge) => {
      const d = await oidc();
      const u = new URL(d.authorization_endpoint);
      for (const [k, v] of Object.entries({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope: SCOPE, state, code_challenge: challenge, code_challenge_method: 'S256', resource: mcp })) u.searchParams.set(k, v);
      return u.toString();
    },
    exchangeCode: async (clientId, redirectUri, code, verifier) => {
      const t = await tokenCall({ grant_type: 'authorization_code', client_id: clientId, redirect_uri: redirectUri, code, code_verifier: verifier });
      t.account = await account(await oidc(), t.access_token);
      return t;
    },
    refresh: async (clientId, tokens) => {
      if (!tokens.refresh_token) throw new BridgeError('not_linked');
      const t = await tokenCall({ grant_type: 'refresh_token', client_id: clientId, refresh_token: tokens.refresh_token });
      if (!t.refresh_token) t.refresh_token = tokens.refresh_token;
      t.account = tokens.account;
      return t;
    },
    // initialize → initialized → tools/call, a fresh session each call (the volume is a few calls a batch)
    callTool: async (accessToken, name, args) => {
      const init = await rpc(accessToken, null, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'ibtekr-operation-system', version: '1' } } });
      await rpc(accessToken, init.session, { jsonrpc: '2.0', method: 'notifications/initialized' });
      const { answer } = await rpc(accessToken, init.session, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } });
      const result = answer?.result;
      if (!result || typeof result !== 'object') throw new BridgeError('mcp_error', null, 'no result');
      if (result.isError) {
        const said = (Array.isArray(result.content) ? result.content : []).filter((p: Json) => p && p.type === 'text' && typeof p.text === 'string').map((p: Json) => p.text).join(' ').trim();
        throw new BridgeError('mcp_error', null, describe(said || toolData(result) || result));
      }
      return toolData(result);
    },
  };
}
