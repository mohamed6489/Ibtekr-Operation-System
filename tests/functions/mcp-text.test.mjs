import { test } from 'node:test'; import assert from 'node:assert/strict';
import { parseLoose, toolData, pick, scalar } from '../../supabase/functions/_shared/mcp-text.js';
// The Magnific MCP server's text answers (phase 5.4 decision 11) read as data: the indented listing with "[n]" counts and "- "
// items, quoted links with "~" and "=", JSON text, structuredContent first; nothing throws on odd input.

const SEARCH = `from: project-root
items[2]:
  - identifier: Lwpw4IEswO
    name: شنطة جلد عليا رسمة عباد الشمس ب 1300ج مقاسها 40x50
    family: a31ee69d-b749-4c7b-bb54-6f82aadc75f8
    tool: upload
    status: completed
    url: "https://pikaso.cdnpk.net/private/production/5905438916/3808553773.jpg?token=exp=1793923200~hmac=51aa"
    liked: false
    mine: true
    commentsCount: 0
    metadata:
      prompt: شنطة جلد عليا رسمة عباد الشمس ب 1300ج مقاسها 40x50
    webUrl: "https://www.magnific.com/app/creation/Lwpw4IEswO?utm_source=mcp&utm_medium=ai_connector"
  - identifier: AbC123
    name: result one
    family: a31ee69d-b749-4c7b-bb54-6f82aadc75f8
    tool: imagen-nano-banana-2
    url: "https://pikaso.cdnpk.net/private/production/1/2.jpg?token=exp=1~hmac=2"
pagination:
  currentPage: 1
  lastPage: 1
  perPage: 50
  total: 2
instruction: "Full results: same payload as creations_get, per page."
`;

test('parseLoose: the listing → objects and lists; "[n]" dropped from keys; quoted links kept whole; numbers and booleans typed', () => {
  const d = parseLoose(SEARCH);
  assert.equal(d.from, 'project-root');
  assert.equal(d.items.length, 2);
  assert.deepEqual([d.items[0].identifier, d.items[0].tool, d.items[0].liked, d.items[0].commentsCount], ['Lwpw4IEswO', 'upload', false, 0]);
  assert.equal(d.items[0].url, 'https://pikaso.cdnpk.net/private/production/5905438916/3808553773.jpg?token=exp=1793923200~hmac=51aa');
  assert.equal(d.items[0].metadata.prompt, 'شنطة جلد عليا رسمة عباد الشمس ب 1300ج مقاسها 40x50');
  assert.equal(d.items[1].name, 'result one');
  assert.deepEqual(d.pagination, { currentPage: 1, lastPage: 1, perPage: 50, total: 2 });
  assert.equal(d.instruction, 'Full results: same payload as creations_get, per page.');
});

test('parseLoose: a lineage answer (nested data, an empty list, a scalar list)', () => {
  const d = parseLoose(`data:
  root: Lwpw4d1swO
  nodes[1]:
    - identifier: Lwpw4d1swO
      family: a31ee690-9ec2-4fa5-8ae5-cda3c4cc5b5c
      tool: upload
      user_tags[0]:
  edges[0]:
tags:
  - a
  - b
`);
  assert.deepEqual(d.data.nodes.map((n) => [n.identifier, n.tool]), [['Lwpw4d1swO', 'upload']]);
  assert.deepEqual(d.data.edges, []);
  assert.deepEqual(d.data.nodes[0].user_tags, []);
  assert.deepEqual(d.tags, ['a', 'b']);
});

test('parseLoose never throws: empty, plain words, odd indentation', () => {
  assert.equal(parseLoose(''), '');
  assert.equal(parseLoose('just words'), 'just words');
  assert.deepEqual(parseLoose('a: 1\n      deeper: 2\nb: x'), { a: 1, b: 'x' });
  assert.deepEqual(parseLoose(null), '');
});

test('scalar: quotes, JSON escapes, true/false/null, numbers, long digit strings stay text', () => {
  assert.equal(scalar('"a \\"b\\""'), 'a "b"');
  assert.equal(scalar("'x'"), 'x');
  assert.deepEqual([scalar('true'), scalar('false'), scalar('null'), scalar('12'), scalar('-1.5')], [true, false, null, 12, -1.5]);
  assert.equal(scalar('12345678901234567890'), '12345678901234567890');
});

test('toolData: structuredContent first, else JSON text, else the listing; pick looks under data', () => {
  assert.deepEqual(toolData({ structuredContent: { a: 1 }, content: [{ type: 'text', text: 'a: 2' }] }), { a: 1 });
  assert.deepEqual(toolData({ content: [{ type: 'text', text: '{"identifier":"X"}' }] }), { identifier: 'X' });
  assert.deepEqual(toolData({ content: [{ type: 'text', text: 'identifier: X\nurl: "https://a/b?c=1~2"' }] }), { identifier: 'X', url: 'https://a/b?c=1~2' });
  assert.deepEqual(toolData({ content: [{ type: 'text', text: 'plain' }] }), { text: 'plain' });
  assert.equal(toolData({ content: [] }), null);
  assert.equal(toolData('x'), null);
  assert.deepEqual(pick({ data: { items: [1] } }, 'results', 'items'), [1]);
  assert.equal(pick({ data: { items: [1] } }, 'nope'), undefined);
  assert.equal(pick('x', 'items'), undefined);
  assert.deepEqual(pick({ items: [2] }, 'items'), [2]);
});

test('parseTables / csvRow: the Spaces tables (header name[n]{cols}: + indented CSV rows), quoted JSON strings with escapes and commas kept whole, typed nulls and numbers; toolData keeps the tables beside the plain pairs', async () => {
  const { parseTables, csvRow } = await import('../../supabase/functions/_shared/mcp-text.js');
  const text = `board:
  uuid: a24c0027-cdcc-461c-bc94-74a2a275c599
  elementsCount: 2
nodes[2]{id,type,name,selected,x,y,width,height,pageId,sourceNodeId,groupId,panelIndex,workflowStatus}:
  02c8479e,list,مخرجات — لقطات التفاصيل المقربة,false,19882.51,4391.75,420,392,"1",null,null,null,null
  23d8acbf,image-generator,كرسي 1 — تركيز على المنتج #2,false,18400,3440,420,392,"1",null,null,null,completed
nodeData[3]{elementId,key,value}:
  02c8479e,mode,replace
  23d8acbf,prompt,"A professional photo, with a comma and a \\"quote\\".\\nSecond line."
  23d8acbf,items,"[{\\"id\\":\\"item-1\\",\\"type\\":\\"image\\",\\"value\\":\\"https://x/a.png?token=exp=1~hmac=2\\",\\"creationIdentifier\\":\\"gOTTFpwSXO\\"}]"
connections[1]{id,sourceElementId,sourcePort,targetElementId,targetPort,dataType,pageId,sourcePageId,targetPageId,selected}:
  conn-1,23d8acbf,output-images,7291d292,reference,image,"1","1","1",false
`;
  const t = parseTables(text);
  assert.deepEqual(Object.keys(t), ['nodes', 'nodeData', 'connections']);
  assert.deepEqual(t.nodes.map((n) => [n.id, n.type, n.name, n.selected, n.x, n.pageId, n.sourceNodeId, n.workflowStatus]), [['02c8479e', 'list', 'مخرجات — لقطات التفاصيل المقربة', false, 19882.51, '1', null, null], ['23d8acbf', 'image-generator', 'كرسي 1 — تركيز على المنتج #2', false, 18400, '1', null, 'completed']]);
  assert.equal(t.nodeData[1].value, 'A professional photo, with a comma and a "quote".\nSecond line.');
  assert.deepEqual(JSON.parse(t.nodeData[2].value)[0].creationIdentifier, 'gOTTFpwSXO');
  assert.deepEqual(t.connections[0], { id: 'conn-1', sourceElementId: '23d8acbf', sourcePort: 'output-images', targetElementId: '7291d292', targetPort: 'reference', dataType: 'image', pageId: '1', sourcePageId: '1', targetPageId: '1', selected: false });
  assert.deepEqual(csvRow('a,,"x,y",3,'), ['a', '', 'x,y', 3, '']);
  const d = toolData({ content: [{ type: 'text', text }] });
  assert.equal(d.board.uuid, 'a24c0027-cdcc-461c-bc94-74a2a275c599');
  assert.equal(d.nodes.length, 2);
  assert.deepEqual(parseTables('nothing here'), {});
});
