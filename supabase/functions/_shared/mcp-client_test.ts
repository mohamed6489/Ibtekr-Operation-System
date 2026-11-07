// deno-lint-ignore-file no-explicit-any
// The generic MCP client (phase 11, decision 4): initialize → initialized → tools/list or tools/call over Streamable HTTP with a
// bearer token (or a named header), JSON or SSE answers, the session id carried, errors by status; findKey's loose read.
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { McpError, findKey, mcpClient } from './mcp-client.ts';

function server(opts: { sse?: boolean; status?: number; tools?: any[]; result?: any; isError?: boolean } = {}) {
  const calls: any[] = [];
  const fetchFn = (async (url: string, init: any) => {
    const body = JSON.parse(init.body); calls.push({ url, headers: init.headers, body });
    if (opts.status) return new Response('{"error":"nope"}', { status: opts.status });
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
    const answer = body.method === 'initialize' ? { jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18', capabilities: {} } }
      : body.method === 'tools/list' ? { jsonrpc: '2.0', id: body.id, result: { tools: opts.tools ?? [{ name: 'generate_video', description: 'x' }, { name: 'jobs_wait' }] } }
      : { jsonrpc: '2.0', id: body.id, result: opts.isError ? { isError: true, content: [{ type: 'text', text: 'bad model' }] } : (opts.result ?? { content: [{ type: 'text', text: JSON.stringify({ job_id: 'j-1' }) }] }) };
    const headers: Record<string, string> = { 'mcp-session-id': 'sess-1', 'content-type': opts.sse ? 'text/event-stream' : 'application/json' };
    return new Response(opts.sse ? 'event: message\ndata: ' + JSON.stringify(answer) + '\n\n' : JSON.stringify(answer), { status: 200, headers });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

Deno.test('listTools / callTool: the handshake, the bearer token, the session id, JSON and SSE answers, a tool result read as data', async () => {
  const s = server();
  const c = mcpClient('https://mcp.example/', 'tok-1', s.fetchFn);
  assertEquals(await c.listTools(), [{ name: 'generate_video', description: 'x' }, { name: 'jobs_wait', description: '' }]);
  assertEquals(s.calls.map((x) => x.body.method), ['initialize', 'notifications/initialized', 'tools/list']);
  assertEquals(s.calls[0].headers.Authorization, 'Bearer tok-1'); assertEquals(s.calls[0].url, 'https://mcp.example'); assertEquals(s.calls[2].headers['Mcp-Session-Id'], 'sess-1');
  assertEquals(await c.callTool('generate_video', { params: { model: 'seedance_2_5' } }), { job_id: 'j-1' });
  assertEquals(s.calls.at(-1).body.params, { name: 'generate_video', arguments: { params: { model: 'seedance_2_5' } } });
  const sse = server({ sse: true }); assertEquals(await mcpClient('https://mcp.example', null, sse.fetchFn).callTool('x', {}), { job_id: 'j-1' });
  assertEquals('Authorization' in sse.calls[0].headers, false, 'no token → no header');
  const hdr = server(); await mcpClient('https://mcp.example', 'k', hdr.fetchFn, 'x-api-key').listTools(); assertEquals(hdr.calls[0].headers['x-api-key'], 'k');
});

Deno.test('errors: 401 → not_linked, 5xx → busy, a tool isError → mcp_error with its words; findKey reads loosely', async () => {
  await assertRejects(() => mcpClient('https://m', 't', server({ status: 401 }).fetchFn).listTools(), McpError, 'not_linked');
  await assertRejects(() => mcpClient('https://m', 't', server({ status: 503 }).fetchFn).listTools(), McpError, 'busy');
  const e = await assertRejects(() => mcpClient('https://m', 't', server({ isError: true }).fetchFn).callTool('x', {}), McpError, 'mcp_error');
  assert(String((e as McpError).detail).includes('bad model'));
  assertEquals(findKey({ data: { items: [{ media_id: 'm-9' }] } }, ['media_id', 'id']), 'm-9');
  assertEquals(findKey({ result: { upload: { url: 'https://p' } } }, ['upload_url', 'url']), 'https://p');
  assertEquals(findKey({ a: 1 }, ['b']), undefined); assertEquals(findKey(null, ['a']), undefined);
});
