import { test } from 'node:test'; import assert from 'node:assert/strict';
import {
  VIDEO_MODELS, modelOf, ratioOf, resolutionOf, clipSeconds, splitScenes, fitScenes, scenePrompt, clipArgs, chainedArgs, VOICES, ttsArgs, musicArgs, MUSIC_TYPES, mixPlan,
  videoPath, videoPathOk, parseVideo, jobView, scenesRequest, cleanScenes, MAX_SHOTS, CAMS,
} from '../../supabase/functions/_shared/mkt-video.js';
// The AI video's pure part (phase 9.5.5, decisions 57–61): the catalog models and their limits, the scenes and their fitting, the clip
// and multi-shot prompts, the voice and music calls, the mix plan, the stored names, the requests, Claude's scenes.
const C = 'f0000000-0000-4000-8000-000000000001';

test('the models: the catalog slugs; the ratio and resolution each takes (4:5 → 3:4, a ratio Kling lacks → 9:16); the clip seconds (Kling 5 / 10, the others clamped)', () => {
  assert.deepEqual(VIDEO_MODELS.map((m) => m.slug), ['bytedance-seedance-pro-2.5', 'bytedance-seedance-pro-2.0', 'kling-25', 'minimax-video-3_0-max']);
  assert.equal(modelOf('nope').id, 'seedance-2.5');
  assert.equal(ratioOf('4:5', 'seedance-2.5'), '3:4'); assert.equal(ratioOf('4:5', 'kling-2.5'), '9:16'); assert.equal(ratioOf('16:9', 'kling-2.5'), '16:9');
  assert.equal(resolutionOf('4K', 'seedance-2.5'), '1080p'); assert.equal(resolutionOf('4K', 'seedance-2.0'), '4K'); assert.equal(resolutionOf(null, 'minimax-h3'), '768p');
  assert.deepEqual([clipSeconds(3, 'kling-2.5'), clipSeconds(8, 'kling-2.5'), clipSeconds(2, 'seedance-2.5'), clipSeconds(40, 'seedance-2.5'), clipSeconds(20, 'seedance-2.0'), clipSeconds(3, 'minimax-h3')], [5, 10, 4, 30, 15, 5]);
});

test('splitScenes: whole seconds summing to the length, the first scenes take the rest, the old texts kept; fitScenes per model', () => {
  const s = splitScenes(15, 4, [{ idea: 'قديم', cam: 'ماكرو' }]);
  assert.deepEqual(s.map((x) => x.d), [4, 4, 4, 3]); assert.equal(s[0].idea, 'قديم'); assert.equal(s[0].cam, 'ماكرو'); assert.equal(s[3].text, '');
  assert.equal(splitScenes(50, 20).length, 8); assert.equal(splitScenes(50, 20).reduce((a, x) => a + x.d, 0), 30);
  assert.deepEqual(fitScenes(splitScenes(15, 3), 'kling-2.5').map((x) => x.d), [5, 5, 5]);
  assert.deepEqual(fitScenes(splitScenes(10, 4), 'seedance-2.5').map((x) => x.d), [4, 4, 4, 4]); // 3 and 2 → the model's minimum 4
});

test('scenePrompt / clipArgs: the product as it is and no text, the camera in English, the campaign and scene ideas in Arabic, ambient sound only on an audio model; the key frame', () => {
  const w = { goal: 'منتج جديد', idea: 'كولكشن الشتا من Art craft' }; const piece = { idea: 'المخدة في القعدة' }; const scene = { d: 5, idea: 'لقطة قريبة على النقشة', cam: 'زوم بطيء', text: 'دفا' };
  const pr = scenePrompt(scene, piece, w, { notes: 'نور عصاري', audio: true });
  assert.ok(pr.includes('launching a new product') && pr.includes('«كولكشن الشتا من Art craft»') && pr.includes('This scene (in Arabic): «لقطة قريبة على النقشة»') && pr.includes('Camera: slow push-in') && pr.includes('Instructions (in Arabic): «نور عصاري»') && pr.includes('ambient sounds only'));
  assert.ok(pr.includes('No text, captions') && !pr.includes('دفا'));
  const a = clipArgs({ model: 'seedance-2.5', size: '9:16', res: '1080p', scene, piece, w, imageRef: 'img-ref-1', folder: 'proj-1' });
  assert.deepEqual([a.slug, a.duration, a.aspectRatio, a.resolution, a.withSoundEffects, a.noMusic, a.folderReference], ['bytedance-seedance-pro-2.5', 5, '9:16', '1080p', true, true, 'proj-1']);
  assert.deepEqual(a.keyframes, { start: { type: 'image', url: 'img-ref-1' } });
  const k = clipArgs({ model: 'kling-2.5', size: '4:5', scene: { d: 7 }, piece, w });
  assert.deepEqual([k.slug, k.duration, k.aspectRatio, k.withSoundEffects, k.keyframes], ['kling-25', 5, '9:16', undefined, undefined]);
  assert.ok(!k.prompt.includes('ambient'));
  assert.equal(clipArgs({ model: 'minimax-h3', scene: { d: 7 }, piece, w }).withSoundEffects, true);
});

test('chainedArgs: one multi-shot call on Seedance (a shot a scene, the extra scenes join the last, at most 6), the first frame a reference; none on Kling', () => {
  const scenes = Array.from({ length: 8 }, (_, i) => ({ d: 3, idea: 'مشهد ' + (i + 1), cam: 'ثابتة' }));
  const a = chainedArgs({ model: 'seedance-2.5', size: '9:16', scenes, piece: {}, w: {}, imageRef: 'ref-1' });
  assert.equal(a.multi_prompt.length, MAX_SHOTS); assert.equal(a.multi_prompt[5].duration, 12); assert.ok(a.multi_prompt[5].prompt.includes('مشهد 6 ثم مشهد 7 ثم مشهد 8'));
  assert.equal(a.duration, 30); assert.deepEqual(a.references, [{ type: 'image', url: 'ref-1' }]); assert.equal(a.prompt, undefined);
  assert.equal(chainedArgs({ model: 'kling-2.5', scenes, piece: {}, w: {} }), null);
  assert.equal(chainedArgs({ model: 'seedance-2.5', scenes: [], piece: {}, w: {} }), null);
});

test('the voice and the music: the catalog ids, ElevenLabs v3 with the text as written (≤ 1500), Lyria 3 with the type\'s prompt', () => {
  assert.equal(VOICES.length, 5); assert.equal(ttsArgs({ text: '  ', voice: 'm-eg-1' }), null);
  const t = ttsArgs({ text: 'الدفا الحقيقي من إيد صانعة مصرية', voice: 'f-ar-1', folder: 'p' });
  assert.deepEqual([t.voiceId, t.model, t.source, t.folderReference, t.text], [352, 'eleven_v3', 'catalog', 'p', 'الدفا الحقيقي من إيد صانعة مصرية']);
  assert.equal(ttsArgs({ text: 'x', voice: 'nope' }).voiceId, 1171);
  const m = musicArgs({ type: 'شرقي حديث' }); assert.equal(m.model, 'google-lyria-3'); assert.ok(m.prompt.includes('oud') && m.prompt.includes('no vocals'));
  assert.ok(musicArgs({ type: 'x' }).prompt.includes('acoustic')); assert.equal(MUSIC_TYPES.length, 4);
});

test('mixPlan: the clips in scene order (the last done one a scene), the voice and the music when they are done; chained = the whole clip; a missing clip = error', () => {
  const J = [{ kind: 'clip', scene: 0, status: 'done', creation_ref: 'c0a' }, { kind: 'clip', scene: 0, status: 'done', creation_ref: 'c0b' }, { kind: 'clip', scene: 1, status: 'done', creation_ref: 'c1' },
    { kind: 'voice', status: 'done', creation_ref: 'v1' }, { kind: 'music', status: 'failed', creation_ref: 'm0' }, { kind: 'upload', status: 'done', creation_ref: 'u1', data: { role: 'music' } }];
  assert.deepEqual(mixPlan(J, [{}, {}], 'separate'), { clips: ['c0b', 'c1'], voice: 'v1', music: 'u1', steps: ['concat', 'voice', 'music'] });
  assert.deepEqual(mixPlan(J, [{}, {}, {}], 'separate'), { error: 'clips' });
  assert.deepEqual(mixPlan([{ kind: 'clip', scene: null, status: 'done', creation_ref: 'all' }], [{}, {}], 'chained'), { clips: ['all'], voice: null, music: null, steps: [] });
  assert.deepEqual(mixPlan([{ kind: 'clip', scene: 0, status: 'running', creation_ref: 'x' }], [{}], 'separate'), { error: 'clips' });
});

test('the stored names and the requests: vid-<piece>-<part>-<stamp>.<ext> inside the campaign; parseVideo per action; jobView without the link', () => {
  assert.equal(videoPath(C, 'V1', 's2', 'ab12', 'mp4'), C + '/vid-V1-s2-ab12.mp4');
  assert.ok(videoPathOk(C, C + '/vid-V1-mix-ab12.mp4') && videoPathOk(C, C + '/vid-V12-up1-x_y.m4a') && !videoPathOk(C, C + '/gen-P1-1.png') && !videoPathOk('other', C + '/vid-V1-mix-1.mp4'));
  assert.equal(parseVideo('clip', { campaign_id: 'x', piece: 'V1' }).field, 'campaign_id');
  assert.equal(parseVideo('clip', { campaign_id: C, piece: 'P1' }).field, 'piece');
  assert.equal(parseVideo('clip', { campaign_id: C, piece: 'V1', scene: 8 }).field, 'scene');
  assert.deepEqual(parseVideo('clip', { campaign_id: C.toUpperCase(), piece: 'V1' }).req, { campaignId: C, piece: 'V1', scene: null });
  assert.equal(parseVideo('voice', { campaign_id: C, piece: 'V1', voice: 'm-eg-1', text: ' ' }).field, 'text');
  assert.equal(parseVideo('voice', { campaign_id: C, piece: 'V1', voice: 'x', text: 'y' }).field, 'voice');
  assert.equal(parseVideo('music', { campaign_id: C, piece: 'V1', type: 'روك' }).field, 'type');
  assert.equal(parseVideo('upload', { campaign_id: C, piece: 'V1', path: C + '/vid-V1-up1-a.mp3', role: 'voice' }).req.role, 'voice');
  assert.equal(parseVideo('upload', { campaign_id: C, piece: 'V1', path: 'x', role: 'voice' }).field, 'path');
  assert.equal(parseVideo('nope', { campaign_id: C, piece: 'V1' }).field, 'action');
  assert.deepEqual(jobView({ id: '3', kind: 'clip', scene: 1, status: 'done', creation_ref: 'r', url: 'https://secret', path: 'p', bytes: '10', error: null, data: { model: 'x' }, created_at: 't', done_at: null }), { id: 3, kind: 'clip', scene: 1, status: 'done', ref: 'r', path: 'p', bytes: 10, error: null, data: { model: 'x' }, createdAt: 't', doneAt: null });
});

test('the scenes by Claude: the request carries the campaign and the count, the schema the camera moves; cleanScenes keeps the count and the fitted durations, tames the text', () => {
  const r = scenesRequest({ model: 'm', effort: 'low', w: { goal: 'منتج جديد', idea: 'كولكشن الشتا' }, piece: { idea: 'المخدة' }, n: 3, dur: 15, voice: true, notes: 'نور دافي' });
  const t = r.messages[0].content[0].text;
  assert.ok(t.includes('Campaign idea: كولكشن الشتا') && t.includes('Scenes: 3') && t.includes('Write exactly 3 scenes for a 15-second video, and the voice-over script.') && t.includes('Instructions: نور دافي'));
  assert.deepEqual(r.output_config.format.schema.properties.scenes.items.properties.cam.enum, CAMS);
  assert.ok(scenesRequest({ model: 'm', effort: 'low', n: 2, dur: 10, voice: false }).messages[0].content[0].text.includes('no voice-over'));
  const c = cleanScenes({ scenes: [{ idea: 'أ', text: 'كلام طويل جدًا '.repeat(10), cam: 'زوم بطيء' }, { idea: 'ب', text: '', cam: 'x' }], voice: 'الدفا' }, { n: 3, dur: 15, model: 'kling-2.5' });
  assert.deepEqual(c.scenes.map((s) => [s.n, s.d, s.idea, s.cam]), [[1, 5, 'أ', 'زوم بطيء'], [2, 5, 'ب', 'ثابتة'], [3, 5, '', 'ثابتة']]);
  assert.ok(c.scenes[0].text.length <= 60); assert.equal(c.voice, 'الدفا');
  assert.equal(cleanScenes(null, { n: 1, dur: 5, model: 'seedance-2.5' }).scenes[0].d, 5);
});
