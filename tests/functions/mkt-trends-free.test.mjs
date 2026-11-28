// The trends from free sources (docs/superpowers/plans/2026-11-28-trends-free.md — Safwat 28 Nov): the pure part of mkt-publish
// trends_free / trends_daily — the request, the keywords, YouTube's and Google Trends' (SerpApi) addresses and rows, the competitors on
// Instagram from the sources, and the answer's text. No key is in a row; a source not linked says so.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ALIAS, FREE_DAYS, KW_MAX, afterOf, answerText, bdRows, bdUrl, codeOf, competitorsOf, durationOf, gtDate, gtEmpty, gtRows, gtUrl, hashOf, igUserOf, keywordsOf, mergeRows, normWord, parseFree, tagOf, ytIds, ytRows, ytSearchUrl, ytVideosUrl } from '../../supabase/functions/_shared/mkt-trends-free.js';

test('the request: words without < or >, a window of 1–30 days (3 by default)', () => {
  assert.deepEqual(parseFree({}), { req: { q: '', days: FREE_DAYS } });
  assert.deepEqual(parseFree({ q: '  المكرمية  ', days: 7 }), { req: { q: 'المكرمية', days: 7 } });
  assert.equal(parseFree({ q: '<b>' }).field, 'q'); assert.equal(parseFree({ days: 0 }).field, 'days'); assert.equal(parseFree({ days: 31 }).field, 'days'); assert.equal(parseFree(null).field, 'body');
});

test('the keywords: the member\'s words (no «ال») and their English, else the admin\'s tags — each once, at most four', () => {
  assert.deepEqual(keywordsOf('المكرمية', []), ['مكرمية', 'macrame']);
  assert.deepEqual(keywordsOf('', ['هاندميد', 'مكرمية']), ['هاندميد', 'مكرمية', 'handmade', 'macrame']);
  assert.deepEqual(keywordsOf('', ['macrame', 'boho_decor']), ['macrame', 'boho decor']);
  assert.ok(keywordsOf('', ['a1', 'b2', 'c3', 'd4', 'e5']).length <= KW_MAX);
  assert.equal(normWord('المكرميّة'.replace('ّ', '')), 'مكرميه'); assert.equal(ALIAS['مكرمية'], 'macrame');
  assert.equal(tagOf('home decor'), 'home_decor'); assert.equal(tagOf('<x>'), null);
});

test('YouTube: Egypt and Arabic for an Arabic word, the world for another; the most viewed of the window, a minute or less a Short; the picture on YouTube\'s host only', () => {
  const after = afterOf('2026-11-28T10:00:00.000Z', 3); assert.equal(after, '2026-11-25T10:00:00Z');
  const ar = new URL(ytSearchUrl('مكرمية', after)); const en = new URL(ytSearchUrl('macrame', after));
  assert.deepEqual([ar.searchParams.get('regionCode'), ar.searchParams.get('relevanceLanguage'), ar.searchParams.get('order'), ar.searchParams.get('publishedAfter')], ['EG', 'ar', 'viewCount', after]);
  assert.equal(en.searchParams.get('regionCode'), null); assert.ok(!ar.href.includes('key='), 'the key goes in a header');
  assert.deepEqual(ytIds({ items: [{ id: { videoId: 'AAAAAAAAAA1' } }, { id: { videoId: 'bad' } }, { id: { videoId: 'AAAAAAAAAA1' } }] }), ['AAAAAAAAAA1']);
  assert.ok(ytVideosUrl(['AAAAAAAAAA1']).includes('id=AAAAAAAAAA1'));
  assert.deepEqual([durationOf('PT45S'), durationOf('PT1M5S'), durationOf('PT1H'), durationOf('x')], [45, 65, 3600, null]);
  const v = (id, views, at, dur, pic) => ({ id, snippet: { title: 'فيديو <' + id + '>', channelTitle: 'قناة', publishedAt: at, description: '\nأول سطر\n', thumbnails: { high: { url: pic } } }, statistics: { viewCount: String(views) }, contentDetails: { duration: dur } });
  const rows = ytRows({ items: [v('AAAAAAAAAA1', 10, '2026-11-27T00:00:00Z', 'PT30S', 'https://i.ytimg.com/vi/A/hq.jpg'), v('BBBBBBBBBB2', 99, '2026-11-26T00:00:00Z', 'PT5M', 'https://evil.example/x.jpg'), v('CCCCCCCCCC3', 500, '2026-11-01T00:00:00Z', 'PT5M', '')] },
    new Map([['AAAAAAAAAA1', 'مكرمية']]), Date.parse(after));
  assert.deepEqual(rows.map((r) => r.external_id), ['BBBBBBBBBB2', 'AAAAAAAAAA1'], 'the old one is left out; the most viewed first');
  assert.equal(rows[1].url, 'https://www.youtube.com/shorts/AAAAAAAAAA1'); assert.equal(rows[0].url, 'https://www.youtube.com/watch?v=BBBBBBBBBB2');
  assert.deepEqual([rows[1].thumb_src, rows[0].thumb_src, rows[1].tag, rows[1].summary, rows[1].kind, rows[1].platform], ['https://i.ytimg.com/vi/A/hq.jpg', null, 'مكرمية', 'أول سطر', 'video', 'youtube']);
  assert.ok(!/[<>]/.test(rows[1].title));
});

test('Google Trends (SerpApi): Egypt, the window Google has, the key in the query; the rising queries (else the top) one row each a day, no picture tried', () => {
  assert.deepEqual([gtDate(1), gtDate(3), gtDate(7), gtDate(30)], ['now 1-d', 'now 7-d', 'now 7-d', 'today 1-m']);
  const u = new URL(gtUrl('مكرمية', 'k'.repeat(64), 3));
  assert.deepEqual([u.host, u.searchParams.get('engine'), u.searchParams.get('geo'), u.searchParams.get('data_type'), u.searchParams.get('date')], ['serpapi.com', 'google_trends', 'EG', 'RELATED_QUERIES', 'now 7-d']);
  const rows = gtRows({ related_queries: { rising: [{ query: 'مكرمية حائط', value: '+250%', link: 'https://trends.google.com/trends/explore?q=a' }, { query: 'macrame plant hanger', value: 'Breakout', link: 'https://evil.example/' }], top: [{ query: 'x' }] } }, 'مكرمية', '2026-11-28', 3);
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].kind, rows[0].platform, rows[0].url, rows[0].thumb_tries, rows[0].tag], ['search', 'google', 'https://trends.google.com/trends/explore?q=a', 2, 'مكرمية']);
  assert.ok(rows[0].summary.startsWith('طالع +250%')); assert.ok(rows[1].summary.startsWith('طالع جامد (Breakout)'));
  assert.ok(rows[1].url.startsWith('https://trends.google.com/trends/explore?'), 'a link off Google Trends is built again');
  assert.equal(rows[0].external_id, 'gt-2026-11-28-' + hashOf('مكرمية حائط')); assert.match(rows[0].external_id, /^[A-Za-z0-9_.:-]{1,80}$/);
  assert.deepEqual(gtRows({ related_queries: { top: [{ query: 'مكرمية', value: '100' }] } }, 'مكرمية', '2026-11-28', 3).map((r) => r.summary.split(' ').slice(0, 3).join(' ')), ['من الأكتر بحثًا']);
  assert.ok(gtEmpty({ error: "Google Trends hasn't returned any results for this query." })); assert.ok(!gtEmpty({ error: 'Invalid API key.' }));
});

test('the competitors on Instagram: an account\'s link among the sources and the competitors\' list (a post, a reel or another site is not one); their posts of the window', () => {
  assert.equal(igUserOf('https://www.instagram.com/Etsy/'), 'etsy'); assert.equal(igUserOf('https://www.instagram.com/p/ABC/'), null); assert.equal(igUserOf('https://www.instagram.com/reel/ABC/'), null);
  assert.equal(igUserOf('https://evil.example/etsy/'), null); assert.equal(igUserOf('http://www.instagram.com/etsy/'), null);
  const who = competitorsOf([{ name: 'Etsy', url: 'https://www.instagram.com/etsy/' }, { name: 'موقع', url: 'https://homzmart.com/' }, { name: 'تاني', url: 'https://instagram.com/etsy' }], [{ name: 'Boho', page_url: 'https://www.instagram.com/boho.eg/' }, { name: 'FB', page_url: 'https://www.facebook.com/x' }]);
  assert.deepEqual(who, [{ username: 'etsy', name: 'Etsy' }, { username: 'boho.eg', name: 'Boho' }]);
  const u = new URL(bdUrl('777', 'etsy')); assert.ok(u.searchParams.get('fields').startsWith('business_discovery.username(etsy){'));
  const rows = bdRows({ business_discovery: { username: 'etsy', media: { data: [
    { id: '1', media_type: 'IMAGE', media_url: 'https://scontent.cdninstagram.com/a.jpg', permalink: 'https://www.instagram.com/p/AAAAA1/', caption: 'جديد', like_count: 50, timestamp: '2026-11-27T10:00:00+0000' },
    { id: '2', media_type: 'IMAGE', media_url: 'https://scontent.cdninstagram.com/b.jpg', permalink: 'https://www.instagram.com/p/BBBBB2/', caption: 'قديم', like_count: 999, timestamp: '2026-10-01T10:00:00+0000' }] } } }, { username: 'etsy', name: 'Etsy' }, Date.parse('2026-11-25T00:00:00Z'));
  assert.deepEqual(rows.map((r) => [r.external_id, r.author, r.likes]), [['AAAAA1', '@etsy', 50]]);
  assert.ok(rows[0].summary.startsWith('منافس: Etsy'));
  assert.deepEqual(bdRows({}, { username: 'x', name: 'x' }, 0), []);
});

test('the run\'s rows each once, the most seen first; the answer says the window, the words and what was not read (no key = «الربط بالمنصات»)', () => {
  const m = mergeRows([[{ platform: 'youtube', external_id: 'A', views: 100 }, { platform: 'youtube', external_id: 'A', views: 100 }], [{ platform: 'instagram', external_id: 'B', likes: 10 }]], 10);
  assert.deepEqual(m.map((r) => r.external_id), ['B', 'A'], 'a like counts as 20 views');
  assert.deepEqual([codeOf(401), codeOf(403), codeOf(429), codeOf(500), codeOf(400)], ['unauthorized', 'unauthorized', 'quota', 'provider', 'refused']);
  const t = answerText([{ platform: 'youtube', title: 'فيديو', author: 'قناة', views: 52000, url: 'https://www.youtube.com/watch?v=A' }], { youtube: 'ok', google: 'not_linked', instagram: 'none' }, 3, ['مكرمية']);
  assert.ok(t.startsWith('لقيت 1 تريند آخر 3 أيام حوالين «مكرمية»:'));
  assert.ok(t.includes('• يوتيوب: فيديو — قناة (52,000 مشاهدة)') && t.includes('https://www.youtube.com/watch?v=A'));
  assert.ok(t.includes('بحث جوجل: مش مربوط لسه') && t.includes('«الإعدادات › الربط بالمنصات»') && t.includes('مفيش منافسين بحساب إنستجرام'));
  assert.ok(answerText([], { youtube: 'ok' }, 1, []).startsWith('مالقيتش تريندات جديدة آخر يوم'));
});
