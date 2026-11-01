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
