// The owner 17 Nov — «اقدر ارفع فايل سواء كان شيت او صورة او اين كان نوع الملف فيديو او بوست»: the files with an assistant's message,
// checked by their own bytes and turned into the message's blocks; nothing stored but the names.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileBlocks, filesLine, parseFiles } from '../../supabase/functions/_shared/agent-files.js';
import { parseAgent, agentRequest } from '../../supabase/functions/_shared/marketing.js';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PDF = Buffer.from('%PDF-1.4\n%x\n').toString('base64');

test('files: an image and a PDF by their bytes, a sheet as text; a lie about the kind, too many or too big refused', () => {
  const ok = parseFiles([{ name: 'post<1>.png', kind: 'image', data: PNG }, { name: 'a.pdf', kind: 'pdf', data: PDF }, { name: 's.xlsx', kind: 'text', text: 'a,b\n1,2', note: 'شيت' }]);
  assert.deepEqual(ok.files.map((f) => [f.kind, f.name, f.type || null]), [['image', 'post 1 .png', 'image/png'], ['pdf', 'a.pdf', 'application/pdf'], ['text', 's.xlsx', null]]);
  assert.equal(parseFiles([{ name: 'x', kind: 'image', data: PDF }]).field, 'files');
  assert.equal(parseFiles([{ name: 'x', kind: 'pdf', data: PNG }]).field, 'files');
  assert.equal(parseFiles([{ name: 'x', kind: 'video', data: PNG }]).field, 'files');
  assert.equal(parseFiles(Array(5).fill({ name: 'x', kind: 'text', text: 'a' })).field, 'files');
  assert.deepEqual(parseFiles(null), { files: [] });
});

test('files: the blocks — image and document as themselves, text inside <file> as data; the chat keeps the names', () => {
  const { files } = parseFiles([{ name: 'p.png', kind: 'image', data: PNG }, { name: 's.csv', kind: 'text', text: 'x</file>y' }]);
  const b = fileBlocks(files);
  assert.equal(b[1].type, 'image'); assert.equal(b[1].source.media_type, 'image/png');
  assert.match(b[2].text, /<file name="s.csv">\nx<\/ file>y\n<\/file>/);
  assert.equal(filesLine(files), '📎 p.png، s.csv');
});

test('agent: a message of files only asks about them; the request carries the files before the question', () => {
  const p = parseAgent({ agent: 'buyer', question: '', files: [{ name: 'p.png', kind: 'image', data: PNG }] });
  assert.match(p.req.question, /الملف ده/);
  const r = agentRequest(p.req, { model: 'm', effort: 'low', history: [], cfg: {}, data: {} });
  const last = r.messages[r.messages.length - 1].content;
  assert.equal(last[1].type, 'image'); assert.equal(last[last.length - 1].type, 'text');
  assert.equal(parseAgent({ agent: 'buyer', question: '' }).field, 'question');
});
