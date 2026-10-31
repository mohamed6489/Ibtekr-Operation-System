import { test } from 'node:test'; import assert from 'node:assert/strict';
import {
  IMG_MODELS, DEFAULT_MODEL, MODEL_IDS, creditsFor, modelCredits, usdOf, sizeOf, parseGenerate, parseEdit, parseCreate, slotPrompt, shapePrompt,
  editPrompt, studioPathOk, studioGenPath, studioEditPath, toolPath, extOf, imageSettings, line, MAX_IMAGE_B64, SLOTS,
} from '../../supabase/functions/_shared/ai-images.js';
// Product images with the AI (phase 5.4, docs/superpowers/plans/2026-10-31-phase-5-4-images.md): the request checks, the prompts,
// the sizes, the credits and the settings — the pure part the ai-images function and the browser mock share.

const SB = '0b6f2f5e-1d2c-4a8b-9e3f-1234567890ab';
const IMG = { media_type: 'image/webp', data: 'A'.repeat(400) };

test('models: a listed default, credits per image × count, a USD estimate for the shared view', () => {
  assert.equal(DEFAULT_MODEL, 'seedream-5-pro');
  assert.ok(IMG_MODELS.every((m) => MODEL_IDS.includes(m.id) && m.credits > 0 && m.name && m.note));
  assert.equal(modelCredits('seedream-5-pro'), 75); assert.equal(modelCredits('seedream-5-lite'), 50);
  assert.equal(modelCredits('unknown'), 75); // an unknown id is priced as the default
  assert.equal(creditsFor('seedream-5-lite', 3), 150); assert.equal(creditsFor('seedream-5-pro', 0), 75);
  assert.equal(usdOf(75), 0.15); assert.equal(usdOf('x'), 0);
});

test('sizeOf: a listed id, or custom 256–4096 a side at most 4:1; else null', () => {
  assert.deepEqual(sizeOf('700x800'), { w: 700, h: 800, id: '700x800' });
  assert.deepEqual(sizeOf('1080x1920t'), { w: 1080, h: 1920, id: '1080x1920t' });
  assert.deepEqual(sizeOf('custom', '1500', 1000), { w: 1500, h: 1000, id: 'custom' });
  assert.equal(sizeOf('custom', 100, 1000), null); assert.equal(sizeOf('custom', 4096, 1000), null); assert.equal(sizeOf('custom', '12.5', 300), null);
  assert.equal(sizeOf('999x999'), null); assert.equal(sizeOf(null), null);
});

test('parseGenerate: a batch, an item, a slot (a number or a color), the default model and product size; refusals by field', () => {
  assert.deepEqual(parseGenerate({ batch_id: SB.toUpperCase(), index: 2, slot: 1 }).req, { batchId: SB, index: 2, slot: 1, model: 'seedream-5-pro', size: { w: 700, h: 800, id: '700x800' } });
  assert.deepEqual(parseGenerate({ batch_id: SB, index: 0, slot: 'color:BK', model: 'seedream-5-lite', size: '1080x1080' }).req.slot, { color: 'BK' });
  assert.equal(parseGenerate({ batch_id: 'x', index: 0, slot: 0 }).field, 'batch_id');
  assert.equal(parseGenerate({ batch_id: SB, index: -1, slot: 0 }).field, 'index');
  assert.equal(parseGenerate({ batch_id: SB, index: 0, slot: 6 }).field, 'slot');
  assert.equal(parseGenerate({ batch_id: SB, index: 0, slot: 'color:bk' }).field, 'slot');
  assert.equal(parseGenerate({ batch_id: SB, index: 0, slot: 0, model: 'dall-e' }).field, 'model');
  assert.equal(parseGenerate({ batch_id: SB, index: 0, slot: 0, size: 'custom', width: 10, height: 10 }).field, 'size');
  assert.equal(parseGenerate(null).field, 'body');
});

test('parseEdit: an op on a studio path (with its batch) or a site product; instruction needs words; remove_bg / upscale options checked', () => {
  const r = parseEdit({ batch_id: SB, path: SB + '/gen-0-0-x.webp', op: 'instruction', prompt: ' lighter <b>background</b> ' }).req;
  assert.deepEqual(r, { batchId: SB, path: SB + '/gen-0-0-x.webp', productId: null, op: 'instruction', prompt: 'lighter background', model: 'seedream-5-pro', options: {} });
  assert.deepEqual(parseEdit({ product_id: '4001', op: 'remove_bg', options: { bg: '#1A5C40' } }).req.options, { bg: '#1a5c40' });
  assert.deepEqual(parseEdit({ product_id: 4001, op: 'remove_bg' }).req.options, { bg: 'transparent' });
  assert.deepEqual(parseEdit({ product_id: 4001, op: 'upscale' }).req.options, { scale: 2 });
  assert.equal(parseEdit({ product_id: 4001, op: 'upscale', options: { scale: 3 } }).field, 'options.scale');
  assert.equal(parseEdit({ product_id: 4001, op: 'remove_bg', options: { bg: 'red' } }).field, 'options.bg');
  assert.equal(parseEdit({ batch_id: SB, path: SB + '/a.webp', op: 'instruction' }).field, 'prompt');
  assert.equal(parseEdit({ op: 'instruction', prompt: 'x' }).field, 'path'); // nothing to edit
  assert.equal(parseEdit({ path: 'loose/a.webp', op: 'upscale' }).field, 'batch_id'); // a studio path needs its batch
  assert.equal(parseEdit({ product_id: 4001, op: 'blur' }).field, 'op');
  assert.equal(parseEdit({ product_id: 0, op: 'upscale' }).field, 'product_id');
});

test('parseCreate: text needs a prompt, image needs a photo or a product, custom needs a prompt; count 1–4; the image checked like the content tool', () => {
  const r = parseCreate({ source: 'image', shape: 'home', image: IMG, count: 2, size: '1080x1350' }).req;
  assert.deepEqual(r, { source: 'image', prompt: '', shape: 'home', size: { w: 1080, h: 1350, id: '1080x1350' }, count: 2, model: 'seedream-5-pro', image: IMG, productId: null });
  assert.equal(parseCreate({ source: 'image', shape: 'studio', product_id: 7 }).req.productId, 7);
  assert.equal(parseCreate({ source: 'text', shape: 'studio' }).field, 'prompt');
  assert.equal(parseCreate({ source: 'image', shape: 'custom', image: IMG }).field, 'prompt');
  assert.equal(parseCreate({ source: 'image', shape: 'studio' }).field, 'image');
  assert.equal(parseCreate({ source: 'image', shape: 'studio', image: { ...IMG, media_type: 'image/gif' } }).field, 'image');
  assert.equal(parseCreate({ source: 'image', shape: 'studio', image: { ...IMG, data: 'A'.repeat(MAX_IMAGE_B64 + 4) } }).field, 'image');
  assert.equal(parseCreate({ source: 'text', shape: 'studio', prompt: 'a mug', count: 5 }).field, 'count');
  assert.equal(parseCreate({ source: 'text', shape: 'studio', prompt: 'a mug', count: 0 }).field, 'count');
  assert.equal(parseCreate({ source: 'text', shape: 'poster', prompt: 'a mug' }).field, 'shape');
  assert.equal(parseCreate({ source: 'web', shape: 'studio', prompt: 'a mug' }).field, 'source');
  assert.equal(parseCreate({ source: 'text', shape: 'studio', prompt: 'a mug', size: 'custom', width: 2000, height: 100 }).field, 'size');
});

test('slotPrompt: the product in words + the slot scene, every slot different, inputs cleaned, never a price or a SKU', () => {
  const it = { nameEn: 'Kilim <b>Pouf</b>', material: 'Cotton', style: 'Boho', sizes: ['50×50', '40×40'], vendorPrice: 2000, sku: 'IBTARBE0999' };
  const ps = SLOTS.map((_, k) => slotPrompt(it, k, { brand: 'Art Craft' }));
  assert.ok(ps[0].includes('Kilim Pouf, made of Cotton, Boho style by the handmade brand Art Craft'));
  assert.ok(ps[0].includes('clean warm cream studio background') && ps[1].includes('Egyptian home') && ps[2].includes('detail') && ps[3].includes('(50×50, 40×40)'));
  assert.equal(new Set(ps.slice(0, 4)).size, 4); assert.equal(ps[4], ps[5]); // the extras are more angles
  assert.ok(ps.every((p) => !/2000|IBTAR|<|>/.test(p) && p.includes('no watermark')));
  assert.ok(slotPrompt(it, { color: 'BK' }, { colorName: 'Black' }).includes('in Black'));
  assert.ok(slotPrompt({}, 0).includes('the handmade product'));
});

test('shapePrompt / editPrompt: the tool shapes around the subject, custom = the user words alone; the edit ops', () => {
  assert.ok(shapePrompt('home', 'Macrame Bag', 'on a beige sofa').endsWith('on a beige sofa'));
  assert.ok(shapePrompt('custom', 'Macrame Bag', 'a <script>bag</script> on the beach').includes('a bag on the beach'));
  assert.ok(shapePrompt('hand', '').includes('the handmade product'));
  assert.ok(editPrompt('instruction', 'lighter background').startsWith('Edit the reference photo'));
  assert.equal(editPrompt('remove_bg', '', { bg: 'transparent' }), 'Cut the product out on a transparent background.');
  assert.ok(editPrompt('remove_bg', '', { bg: '#ffffff' }).includes('#ffffff'));
  assert.ok(editPrompt('upscale', '', { scale: 4 }).includes('4×'));
  assert.ok(editPrompt('relight', 'golden hour').includes('golden hour'));
});

test('paths: a studio image belongs to its batch; generated / edited / tool paths and extensions', () => {
  assert.equal(studioPathOk(SB, SB + '/row1-main.webp'), true);
  assert.equal(studioPathOk(SB, 'other/row1-main.webp'), false);
  assert.equal(studioPathOk(SB, SB + '/../x.webp'), false);
  assert.equal(studioGenPath(SB, 2, 1, 'abc', 'png'), SB + '/gen-2-1-abc.png');
  assert.equal(studioGenPath(SB, 0, { color: 'BK' }, 'abc', 'webp'), SB + '/gen-0-cBK-abc.webp');
  assert.equal(studioEditPath(SB, 0, 'abc', 'webp'), SB + '/edit-0-abc.webp');
  assert.equal(toolPath('u1', 'abc', 2, 'png'), 'u1/abc-2.png');
  assert.deepEqual(['image/png', 'image/jpeg', 'image/webp', 'x'].map(extOf), ['png', 'jpg', 'webp', 'webp']);
  assert.equal(line('  a <i>b</i>  c ', 100), 'a b c');
});

test('imageSettings: the settings row «ai» over the secrets over the defaults; a model off the list is ignored', () => {
  assert.deepEqual(imageSettings(null, {}), { model: 'seedream-5-pro', monthlyCredits: null });
  assert.deepEqual(imageSettings({ image_model: 'seedream-5-lite', image_monthly_credits: '5000' }, { MAGNIFIC_MODEL: 'gpt-image-2' }), { model: 'seedream-5-lite', monthlyCredits: 5000 });
  assert.deepEqual(imageSettings({ image_model: 'dall-e' }, { MAGNIFIC_MODEL: 'gpt-image-2', IMAGE_MONTHLY_CREDITS: '800.7' }), { model: 'gpt-image-2', monthlyCredits: 800 });
  assert.deepEqual(imageSettings({ image_monthly_credits: -5 }, {}), { model: 'seedream-5-pro', monthlyCredits: null });
});
