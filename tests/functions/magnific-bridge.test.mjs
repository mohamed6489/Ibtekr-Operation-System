import { test } from 'node:test'; import assert from 'node:assert/strict';
import { creationsOf, lastPageOf, lineageIds, uploadedId, familyOf, matchResults, importShape } from '../../supabase/functions/_shared/magnific-bridge.js';
import { parseLoose } from '../../supabase/functions/_shared/mcp-text.js';
// The bridge's pure part (phase 5.4 decision 11): the site's answers read as data and the results matched to the batch's photos.

const FAM = 'a31ee69d-b749-4c7b-bb54-6f82aadc75f8';
const search = parseLoose(`from: project-root
items[3]:
  - identifier: SRC1
    name: Boho Cushion
    family: ${FAM}
    tool: upload
    url: "https://pikaso.cdnpk.net/p/1.jpg?token=exp=1~hmac=a"
  - identifier: RES1
    name: Boho Cushion
    family: ${FAM}
    tool: imagen-nano-banana-2
    url: "https://pikaso.cdnpk.net/p/2.jpg?token=exp=1~hmac=b"
    metadata:
      prompt: a cushion on a sofa
  - identifier: BAD!
    name: no id
    url: "https://pikaso.cdnpk.net/p/3.jpg"
pagination:
  currentPage: 1
  lastPage: 3
`);

test('creationsOf: items with a well-formed identifier and an https link; the family, the tool and the prompt; lastPage', () => {
  const list = creationsOf(search);
  assert.deepEqual(list.map((x) => [x.id, x.tool, x.family === FAM, x.prompt]), [['SRC1', 'upload', true, ''], ['RES1', 'imagen-nano-banana-2', true, 'a cushion on a sofa']]);
  assert.equal(lastPageOf(search), 3);
  assert.equal(lastPageOf({ items: [] }), 1);
  assert.deepEqual(creationsOf({ data: { items: [{ identifier: 'X', url: 'http://plain' }, { identifier: 'Y', url: 'https://ok/a' }] } }).map((x) => [x.id, x.url]), [['X', null], ['Y', 'https://ok/a']], 'a plain link is dropped (the item stays, never matched)');
  assert.deepEqual(creationsOf('nope'), []);
});

test('lineageIds / uploadedId / familyOf read the shapes the server answers (data wrapper or flat)', () => {
  assert.deepEqual(lineageIds(parseLoose('data:\n  root: RES1\n  nodes[2]:\n    - identifier: RES1\n      tool: x\n    - identifier: SRC1\n      tool: upload\n  edges[0]:\n')), ['RES1', 'SRC1']);
  assert.deepEqual(lineageIds({ nodes: [{ identifier: 'A' }, { identifier: 'bad id' }] }), ['A']);
  assert.equal(uploadedId({ identifier: 'NEW1', url: 'https://x' }), 'NEW1');
  assert.equal(uploadedId({ data: { identifier: 'NEW2' } }), 'NEW2');
  assert.equal(uploadedId({ creation: { identifier: 'NEW3' } }), 'NEW3');
  assert.equal(uploadedId({ identifier: 'bad id' }), null);
  assert.equal(familyOf({ data: { family: FAM } }), FAM);
});

test('matchResults: by lineage first, then the family, then the name; uploads and sources never results; the import shape groups by product', () => {
  const sources = [{ ref: 'SRC1', index: 0, name: 'Boho Cushion.jpg', family: FAM }, { ref: 'SRC2', index: 1, name: 'Stripe Pillow.jpg', family: 'fam2' }];
  const results = [
    { id: 'SRC1', tool: 'upload', url: 'https://x/0', family: FAM, name: 'Boho Cushion', prompt: '' },
    { id: 'R1', tool: 'nano', url: 'https://x/1', family: 'other', name: '', prompt: '' }, // lineage → SRC2
    { id: 'R2', tool: 'nano', url: 'https://x/2', family: FAM, name: '', prompt: '' }, // family → SRC1
    { id: 'R3', tool: 'nano', url: 'https://x/3', family: '', name: 'Stripe Pillow on a bed', prompt: '' }, // name → SRC2
    { id: 'R4', tool: 'nano', url: 'https://x/4', family: '', name: 'something else', prompt: 'a mug' }, // unmatched
    { id: 'R5', tool: 'nano', url: null, family: FAM, name: '', prompt: '' }, // no link → skipped
  ];
  const { matched, unmatched } = matchResults(sources, results, { R1: ['R1', 'SRC2'] });
  assert.deepEqual(matched.map((m) => [m.result.id, m.index]), [['R1', 1], ['R2', 0], ['R3', 1]]);
  assert.deepEqual(unmatched.map((r) => r.id), ['R4']);
  assert.deepEqual(importShape(matched), { urls: ['https://x/1', 'https://x/2', 'https://x/3'], refs: ['R1', 'R2', 'R3'], items: [{ index: 1, images: [0, 2] }, { index: 0, images: [1] }] });
  assert.deepEqual(matchResults([], results), { matched: [], unmatched: results.filter((r) => r.tool !== 'upload' && r.url) });
});

test('decision 12 — templatePrompts: the owner\'s generators «<فئة> N — <لقطة>» (copies « #k», a number touching the name, no number → the vertical order) → one entry a category and shot with the prompt, negative, model, aspect, resolution', async () => {
  const { nodesOf, nodeDataOf, templatePrompts } = await import('../../supabase/functions/_shared/magnific-bridge.js');
  const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
  const data = { nodes: [
    { id: id(1), type: 'image-generator', name: 'كرسي 1 — تركيز على المنتج', x: 0, y: 0, pageId: '1' },
    { id: id(2), type: 'image-generator', name: 'كرسي 2 — المنتج في بيئة محيطة #3', x: 0, y: 600, pageId: '1' },
    { id: id(3), type: 'image-generator', name: 'كرسي 3 — Closeup للتفاصيل', x: 0, y: 1200, pageId: '1' },
    { id: id(4), type: 'image-generator', name: 'كرسي 1 — تركيز على المنتج #2', x: 500, y: 0, pageId: '1' }, // a copy: the first wins
    { id: id(5), type: 'image-generator', name: 'كرسي هزاز2 — صورة علوية', x: 0, y: 0, pageId: '1' }, // the number touches the name
    { id: id(6), type: 'image-generator', name: 'فري ستاندنج  —البيئة', x: 0, y: 900, pageId: 'p2' }, // no number: by the vertical order
    { id: id(7), type: 'image-generator', name: 'فري ستاندنج  — تركيز على المنتج', x: 0, y: 100, pageId: 'p2' },
    { id: id(8), type: 'image-generator', name: 'بدون برومبت 1 — x', x: 0, y: 0, pageId: '1' },
    { id: id(9), type: 'list', name: 'قائمة', x: 0, y: 0, pageId: '1' },
  ], nodeData: [
    { elementId: id(1), key: 'prompt', value: 'P1' }, { elementId: id(1), key: 'mode', value: 'imagen-nano-banana-2' }, { elementId: id(1), key: 'aspectRatio', value: '3:4' }, { elementId: id(1), key: 'resolution', value: '1k' }, { elementId: id(1), key: 'negativePrompt', value: 'people' },
    { elementId: id(2), key: 'prompt', value: 'P2' }, { elementId: id(3), key: 'prompt', value: 'P3' }, { elementId: id(4), key: 'prompt', value: 'COPY' },
    { elementId: id(5), key: 'prompt', value: 'TOP' }, { elementId: id(6), key: 'prompt', value: 'ENV' }, { elementId: id(7), key: 'prompt', value: 'FOCUS' },
    { elementId: id(1), key: 'items', value: '[{"type":"image","creationIdentifier":"A1"}]' },
  ] };
  const nodes = nodesOf(data); const nd = nodeDataOf(data);
  assert.equal(nodes.length, 9);
  assert.deepEqual(nd[id(1)].items, [{ type: 'image', creationIdentifier: 'A1' }], 'a JSON value is read');
  const rows = templatePrompts(nodes, nd);
  assert.deepEqual(rows.map((r) => [r.category, r.shot, r.prompt]), [['فري ستاندنج', 1, 'FOCUS'], ['فري ستاندنج', 2, 'ENV'], ['كرسي', 1, 'P1'], ['كرسي', 2, 'P2'], ['كرسي', 3, 'P3'], ['كرسي هزاز', 2, 'TOP']]);
  assert.deepEqual([rows[2].name, rows[2].negative, rows[2].model, rows[2].aspect, rows[2].resolution, rows[2].node], ['كرسي 1 — تركيز على المنتج', 'people', 'imagen-nano-banana-2', '3:4', '1k', id(1)]);
  assert.equal(rows[3].name, 'كرسي 2 — المنتج في بيئة محيطة', 'the copy mark is dropped from the name');
});

test('decision 12 — flowNodes / listIdsOf / urlsById: the flow of a batch (panel, the photos list in replace mode, three generators with the category prompts or the generic words, three output lists, six connections); the output ids in order; the urls by id', async () => {
  const { flowNodes, listIdsOf, urlsById, FRAME_NOTE } = await import('../../supabase/functions/_shared/magnific-bridge.js');
  const { FRAME_NOTE: NOTE2 } = await import('../../supabase/functions/_shared/ai-images.js');
  assert.equal(FRAME_NOTE, NOTE2, 'one framing sentence everywhere'); assert.match(FRAME_NOTE, /center crop to 7:8/);
  const prompts = [{ category: 'كرسي', shot: 1, name: 'كرسي 1 — تركيز على المنتج', prompt: 'P1', negative: 'people', model: 'imagen-nano-banana-2', aspect: '3:4', resolution: '2k' }, { category: 'كرسي', shot: 3, name: 'كرسي 3 — Closeup للتفاصيل', prompt: 'P3', negative: null, model: null, aspect: null, resolution: null }];
  const f = flowNodes({ title: 'دفعة كراسي — 2026-11-01', category: 'كرسي', photos: ['UP1', 'UP2'], prompts });
  assert.deepEqual(f.nodes.map((n) => [n.nodeType, n.ref]), [['panel', 'panel'], ['list', 'list'], ['image-generator', 'gen1'], ['list', 'out1'], ['image-generator', 'gen2'], ['list', 'out2'], ['image-generator', 'gen3'], ['list', 'out3']]);
  assert.deepEqual(f.nodes[1].data, { itemType: 'image', mode: 'replace', items: [{ type: 'image', creationIdentifier: 'UP1' }, { type: 'image', creationIdentifier: 'UP2' }] });
  assert.deepEqual(f.nodes[2].data, { prompt: 'P1 ' + FRAME_NOTE, mode: 'imagen-nano-banana-2', aspectRatio: '3:4', resolution: '2k', numberOfGenerations: 1, negativePrompt: 'people' }, 'decision 14: every generator (the template\'s rows too) is told to keep the product in the middle for the crop');
  assert.equal(f.nodes[2].name, 'كرسي 1 — تركيز على المنتج');
  assert.ok(f.nodes[4].data.prompt.startsWith('A lifestyle photograph') && f.nodes[4].name === 'كرسي 2 — المنتج في بيئة محيطة', 'shot 2 has no row: the generic words');
  assert.deepEqual([f.nodes[6].data.prompt, f.nodes[6].data.mode, f.nodes[6].data.aspectRatio, f.nodes[6].data.resolution], ['P3 ' + FRAME_NOTE, 'imagen-nano-banana-2', '3:4', '1k']);
  assert.ok(f.nodes[4].data.prompt.endsWith(FRAME_NOTE), 'the generic words too');
  // decision 13 (the owner, 1 Nov): every generator runs Nano Banana Pro — a template row on another model is not carried over
  const other = flowNodes({ title: 't', category: 'كرسي', photos: ['UP1'], prompts: [{ shot: 1, prompt: 'P1', model: 'flux-2-pro', aspect: '4:5', resolution: '2k' }] });
  assert.deepEqual([other.nodes[2].data.mode, other.nodes[2].data.aspectRatio, other.nodes[2].data.resolution, other.nodes[4].data.mode], ['imagen-nano-banana-2', '4:5', '2k', 'imagen-nano-banana-2']);
  assert.deepEqual(f.nodes[2].layout, { groupId: 'panel', relativeToNodeId: 'list', direction: 'right' });
  assert.deepEqual(f.connections, [
    { from: 'list', fromPort: 'output-images', to: 'gen1', toPort: 'reference' }, { from: 'gen1', fromPort: 'output', to: 'out1', toPort: 'images' },
    { from: 'list', fromPort: 'output-images', to: 'gen2', toPort: 'reference' }, { from: 'gen2', fromPort: 'output', to: 'out2', toPort: 'images' },
    { from: 'list', fromPort: 'output-images', to: 'gen3', toPort: 'reference' }, { from: 'gen3', fromPort: 'output', to: 'out3', toPort: 'images' }]);
  const nd = { 'o1': { items: [{ type: 'image', creationIdentifier: 'R1' }, { type: 'image', creationIdentifier: 'bad id' }, { type: 'image', creationIdentifier: 'R2' }] } };
  assert.deepEqual(listIdsOf(nd, 'o1'), ['R1', 'R2']);
  assert.deepEqual(listIdsOf(nd, 'o2'), []);
  assert.deepEqual(urlsById({ creations: [{ identifier: 'R1', url: 'https://pikaso.cdnpk.net/a.png' }, { identifier: 'R2', url: 'http://plain' }, { identifier: 'R3' }] }), { R1: 'https://pikaso.cdnpk.net/a.png' });
  assert.deepEqual(urlsById({ identifier: 'R9', url: 'https://x/y.png' }), { R9: 'https://x/y.png' });
});
