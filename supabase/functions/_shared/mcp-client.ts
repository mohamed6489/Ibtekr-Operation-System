// A generic MCP client (phase 11, decision 4: the system as the client of MCP servers the admin links from «الإعدادات › الربط
// بالمنصات» with a URL and a token — Higgsfield and any other). Streamable HTTP as the Magnific layer does it (one POST per
// JSON-RPC message, a JSON or an SSE answer, the session id in the Mcp-Session-Id header), but with a plain bearer token (or an
// api-key header) the admin pasted instead of OAuth. Nothing here is logged with a token or a URL.
import { sseMessages } from '../ai-images/providers/magnific-mcp.ts';
import { toolData } from './mcp-text.js';

// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;
export type McpClient = { listTools: () => Promise<{ name: string; description: string }[]>; callTool: (name: string, args: Json) => Promise<unknown> };
export class McpError extends Error {
  kind: 'not_linked' | 'busy' | 'mcp_error';
  status: number | null;
  detail: string | null;
  constructor(kind: McpError['kind'], status: number | null = null, detail: string | null = null) { super(kind); this.kind = kind; this.status = status; this.detail = detail; }
}
const PROTOCOL = '2025-06-18';
const TIMEOUT_MS = 60_000;
const describe = (j: unknown) => (j && typeof j === 'object' ? (Object.keys(j as Json).join(',') + ' :: ' + String((j as Json).message ?? (j as Json).error ?? '')).slice(0, 200) : String(j).slice(0, 200)).replace(/[A-Za-z0-9._-]{40,}/g, '<tok>');

export function mcpClient(url: string, token: string | null, fetchFn: typeof fetch = fetch, header = 'Authorization'): McpClient {
  const base = String(url).replace(/\/+$/, '');
  const auth = (): Record<string, string> => (token ? (header === 'Authorization' ? { Authorization: 'Bearer ' + token } : { [header]: token }) : {});
  async function rpc(session: string | null, msg: Json): Promise<{ answer: Json | null; session: string | null }> {
    let res: Response;
    try {
      res = await fetchFn(base, { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': PROTOCOL, ...(session ? { 'Mcp-Session-Id': session } : {}) }, body: JSON.stringify(msg), signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch { throw new McpError('busy'); }
    const sid = res.headers.get('mcp-session-id') ?? session;
    if (res.status === 401 || res.status === 403) throw new McpError('not_linked', res.status);
    if (res.status === 429 || res.status >= 500) throw new McpError('busy', res.status);
    if (res.status === 202 || res.status === 204) return { answer: null, session: sid };
    const ct = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const text = await res.text();
    let messages: Json[] = [];
    if (ct === 'text/event-stream') messages = sseMessages(text);
    else { try { const j = JSON.parse(text); messages = Array.isArray(j) ? j : j && typeof j === 'object' ? [j] : []; } catch { messages = []; } }
    if (!res.ok) throw new McpError('mcp_error', res.status, describe(messages[0] ?? text));
    const answer = msg.id === undefined ? null : messages.find((m) => m.id === msg.id) ?? null;
    if (msg.id !== undefined && !answer) throw new McpError('mcp_error', res.status, 'no answer');
    if (answer?.error) throw new McpError('mcp_error', res.status, describe(answer.error));
    return { answer, session: sid };
  }
  async function session(): Promise<string | null> {
    const init = await rpc(null, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'ibtekr-operation-system', version: '1' } } });
    await rpc(init.session, { jsonrpc: '2.0', method: 'notifications/initialized' });
    return init.session;
  }
  return {
    async listTools() {
      const sid = await session();
      const { answer } = await rpc(sid, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
      const tools = Array.isArray(answer?.result?.tools) ? answer!.result.tools : [];
      return tools.filter((t: Json) => t && typeof t.name === 'string').map((t: Json) => ({ name: String(t.name).slice(0, 80), description: typeof t.description === 'string' ? t.description.slice(0, 200) : '' }));
    },
    async callTool(name, args) {
      const sid = await session();
      const { answer } = await rpc(sid, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } });
      const result = answer?.result;
      if (!result || typeof result !== 'object') throw new McpError('mcp_error', null, 'no result');
      if (result.isError) {
        const said = (Array.isArray(result.content) ? result.content : []).filter((p: Json) => p && p.type === 'text' && typeof p.text === 'string').map((p: Json) => p.text).join(' ').trim();
        throw new McpError('mcp_error', null, describe(said || toolData(result) || result));
      }
      return toolData(result);
    },
  };
}

// a loose read of a tool's answer: the first value found under any of the keys, at any depth (the servers' shapes differ)
export function findKey(v: unknown, keys: string[], depth = 0): unknown {
  if (depth > 5 || v === null || typeof v !== 'object') return undefined;
  if (Array.isArray(v)) { for (const x of v) { const f = findKey(x, keys, depth + 1); if (f !== undefined) return f; } return undefined; }
  const o = v as Json;
  for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k];
  for (const x of Object.values(o)) { const f = findKey(x, keys, depth + 1); if (f !== undefined) return f; }
  return undefined;
}
