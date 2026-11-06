import { test } from 'node:test'; import assert from 'node:assert/strict';
import {
  planOf, ourCode, pubText, path, body, idOf, containerState, linkOf, insightsOf, fbStatsOf, igStatsOf, platformRowOf, platformRowsOf, cairoParts, scopesOf, connectionOf, PULL_FRESH_MS,
} from '../../supabase/functions/_shared/mkt-publish.js';
// mkt-publish's pure part (phase 9.5.2, decisions 29–39): what a log row becomes on Facebook / Instagram, Meta's errors as our
// codes, the numbers read back, the platform's own posts as log rows, Cairo's day and hour, the link's permissions.

const CID = '00000000-0000-4000-8000-00000000c051';
const row = (extra = {}) => ({ platform: 'فيسبوك', kind: 'بوست', images: [CID + '/pub-a.jpg'], caption: 'كابشن', tags: '#إبتكر', ...extra });

test('planOf: the platform, the kind, the images (1 or 2–10, Instagram JPEG) and Instagram\'s 2200 characters; a story has no text', () => {
  assert.deepEqual(planOf(row()), { platform: 'facebook', kind: 'post', images: [CID + '/pub-a.jpg'], text: 'كابشن\n\n#إبتكر' });
  assert.deepEqual(planOf(row({ platform: 'انستجرام', kind: 'ستوري' })).text, '');
  assert.equal(planOf(row({ platform: 'تيك توك' })).error, 'kind');
  assert.equal(planOf(row({ kind: 'ريل' })).error, 'kind');
  assert.equal(planOf(row({ images: [] })).error, 'images');
  assert.equal(planOf(row({ kind: 'كاروسيل' })).error, 'images'); // one image is not a carousel
  assert.equal(planOf(row({ images: [CID + '/a.jpg', CID + '/b.jpg'] })).error, 'images'); // a post is one image
  assert.equal(planOf(row({ kind: 'كاروسيل', images: Array(11).fill(CID + '/a.jpg') })).error, 'images');
  assert.equal(planOf(row({ platform: 'انستجرام', images: [CID + '/p.png'] })).error, 'images');
  assert.equal(planOf(row({ images: [CID + '/p.png'] })).platform, 'facebook'); // Facebook takes a PNG
  assert.equal(planOf(row({ platform: 'انستجرام', caption: 'ك'.repeat(2195) })).error, 'text');
  assert.equal(planOf(row({ caption: 'ك'.repeat(2195) })).kind, 'post'); // Facebook has room
  assert.equal(pubText('', '#a'), '#a');
});

test('ourCode: token / permission / gone / rate / image / timeout from Meta\'s codes; the rest kept as graph_<code>', () => {
  assert.equal(ourCode('graph_190'), 'token'); assert.equal(ourCode('graph_190:460'), 'token');
  assert.equal(ourCode('graph_10'), 'permission'); assert.equal(ourCode('graph_200'), 'permission'); assert.equal(ourCode('graph_3'), 'permission');
  assert.equal(ourCode('graph_100:33'), 'gone');
  assert.equal(ourCode('graph_4'), 'rate'); assert.equal(ourCode('graph_9:2207042'), 'rate'); assert.equal(ourCode('graph_32'), 'rate');
  assert.equal(ourCode('graph_9004:2207052'), 'image'); assert.equal(ourCode('graph_36003'), 'image'); assert.equal(ourCode('graph_100:2207009'), 'image');
  assert.equal(ourCode('graph_timeout'), 'timeout'); assert.equal(ourCode('graph_network'), 'timeout');
  assert.equal(ourCode('graph_368'), 'graph_368'); assert.equal(ourCode('graph_100'), 'graph_100');
  assert.equal(ourCode('no_instagram'), 'no_instagram'); assert.equal(ourCode('Bad Thing!'), 'failed');
});

test('the Graph calls and bodies: the page / account edges, the hidden photos, the carousel children, the story, no text when empty', () => {
  assert.match(path.fbPhotos('111'), /\/v21\.0\/111\/photos$/);
  assert.match(path.igPublish('777'), /\/777\/media_publish$/);
  assert.match(path.fbInsights('111_9'), /metric=post_media_view,post_total_media_view_unique$/);
  assert.match(path.igInsights('9', true), /metric=views,reach,shares,total_interactions$/);
  assert.match(path.fbPosts('111', 1700000000), /published_posts\?fields=.*&since=1700000000&limit=50$/);
  assert.deepEqual(body.fbPhoto('https://s/a', ''), { url: 'https://s/a', published: 'true' });
  assert.deepEqual(body.fbPhotoHidden('https://s/a'), { url: 'https://s/a', published: 'false', temporary: 'true' });
  assert.deepEqual(body.fbFeed('نص', ['1', '2']), { message: 'نص', attached_media: [{ media_fbid: '1' }, { media_fbid: '2' }] });
  assert.deepEqual(body.igCarousel(['1', '2'], 'نص'), { media_type: 'CAROUSEL', children: '1,2', caption: 'نص' });
  assert.deepEqual(body.igStory('https://s/a'), { image_url: 'https://s/a', media_type: 'STORIES' });
  assert.equal(idOf('111_9001'), '111_9001'); assert.equal(idOf(9001), '9001'); assert.equal(idOf('1; drop'), null);
  assert.equal(containerState({ status_code: 'FINISHED' }), 'ready'); assert.equal(containerState({ status_code: 'IN_PROGRESS' }), 'wait');
  assert.equal(containerState({ status_code: 'ERROR' }), 'failed'); assert.equal(containerState({ status_code: 'EXPIRED' }), 'failed'); assert.equal(containerState({}), 'wait');
  assert.equal(linkOf({ permalink: 'https://www.instagram.com/p/x/' }, 'permalink'), 'https://www.instagram.com/p/x/');
  assert.equal(linkOf({ permalink: 'http://x' }, 'permalink'), null);
});

test('the numbers: Facebook\'s reactions / comments / shares + views and reach; Instagram\'s insights or its counts; the engagement', () => {
  const ins = { data: [{ name: 'post_media_view', values: [{ value: 1200 }] }, { name: 'post_total_media_view_unique', total_value: { value: 900 } }, { name: 'odd', values: [{ value: { a: 2, b: 3 } }] }] };
  assert.deepEqual(insightsOf(ins), { post_media_view: 1200, post_total_media_view_unique: 900, odd: 5 });
  assert.deepEqual(fbStatsOf({ reactions: { summary: { total_count: 40 } }, comments: { summary: { total_count: 5 } }, shares: { count: 3 } }, ins),
    { views: 1200, reach: 900, likes: 40, comments: 5, shares: 3, saves: null, eng: 48 });
  assert.deepEqual(fbStatsOf({ reactions: { summary: { total_count: 2 } }, comments: { summary: { total_count: 0 } } }, null), // never shared, no insights permission
    { views: null, reach: null, likes: 2, comments: 0, shares: 0, saves: null, eng: 2 });
  const igIns = { data: [{ name: 'views', values: [{ value: 700 }] }, { name: 'reach', values: [{ value: 500 }] }, { name: 'likes', values: [{ value: 11 }] }, { name: 'saved', values: [{ value: 4 }] }] };
  assert.deepEqual(igStatsOf({ like_count: 10, comments_count: 2 }, igIns), { views: 700, reach: 500, likes: 11, comments: 2, shares: null, saves: 4, eng: 17 });
  assert.equal(igStatsOf({ like_count: 1 }, { data: [{ name: 'total_interactions', values: [{ value: 30 }] }] }).eng, 30);
  assert.deepEqual(igStatsOf(null, null), { views: null, reach: null, likes: null, comments: null, shares: null, saves: null, eng: null });
});

test('the platform\'s own posts: the kind, the first line as the name, Cairo\'s day and hour, https only, a fresh post waits a run', () => {
  const now = Date.parse('2026-11-06T12:00:00Z');
  const fb = platformRowOf({ id: '111_9500', message: '\n  بوست من الصفحة \nسطر', created_time: '2026-11-06T09:30:00+0000', permalink_url: 'https://www.facebook.com/x', full_picture: 'https://scontent/p.jpg', attachments: { data: [{ media_type: 'album' }] } }, 'facebook', now);
  assert.deepEqual([fb.src, fb.platform, fb.kind, fb.name, fb.day, fb.time, fb.status, fb.external_id, fb.thumb, fb.post_url], ['platform', 'فيسبوك', 'كاروسيل', 'بوست من الصفحة', '2026-11-06', '11:30', 'اتنشر', '111_9500', 'https://scontent/p.jpg', 'https://www.facebook.com/x']);
  assert.equal(fb.campaign_id, undefined); // no campaign
  const ig = platformRowOf({ id: '1890', media_type: 'VIDEO', media_product_type: 'REELS', media_url: 'https://cdn/v.mp4', thumbnail_url: 'https://cdn/t.jpg', timestamp: '2026-11-05T21:30:00+0000' }, 'instagram', now);
  assert.deepEqual([ig.kind, ig.name, ig.thumb, ig.day, ig.time], ['ريل', 'بوست على انستجرام', 'https://cdn/t.jpg', '2026-11-05', '23:30']);
  assert.equal(platformRowOf({ id: '1', media_type: 'IMAGE', media_url: 'http://x.jpg', timestamp: '2026-11-01T10:00:00+0000' }, 'instagram', now).thumb, null);
  assert.equal(platformRowOf({ id: '111_1', created_time: new Date(now - PULL_FRESH_MS + 60_000).toISOString() }, 'facebook', now), null);
  assert.equal(platformRowOf({ id: 'bad id', created_time: '2026-11-01T10:00:00+0000' }, 'facebook', now), null);
  // the last 30 days only: Instagram's media edge answers its latest ones whatever their date
  assert.equal(platformRowOf({ id: '1650', media_type: 'IMAGE', timestamp: '2026-09-15T10:00:00+0000' }, 'instagram', now), null);
  assert.equal(platformRowOf({ id: '1651', media_type: 'IMAGE', timestamp: '2026-10-08T10:00:00+0000' }, 'instagram', now).external_id, '1651');
  assert.equal(platformRowsOf({ data: [{ id: '1', created_time: '2026-11-01T10:00:00+0000' }] }, { data: [{ id: '2', timestamp: '2026-11-01T10:00:00+0000', media_type: 'CAROUSEL_ALBUM' }] }, now).length, 2);
});

test('cairoParts: Cairo\'s summer and winter hours (DST until the last Thursday of October)', () => {
  assert.deepEqual(cairoParts(Date.parse('2026-10-25T12:00:00Z')), { day: '2026-10-25', time: '15:00' });
  assert.deepEqual(cairoParts(Date.parse('2026-11-06T22:30:00Z')), { day: '2026-11-07', time: '00:30' });
});

test('the link\'s permissions: publishing and numbers per platform from the scopes; nothing without a link or with an invalid token', () => {
  const page = { id: '111', name: 'Ibtekr Club', token: 'T', ig: { id: '777', username: 'ibtekr.club' } };
  const all = scopesOf({ data: { is_valid: true, scopes: ['pages_manage_posts', 'instagram_content_publish', 'read_insights', 'instagram_manage_insights', 7] } });
  assert.deepEqual(connectionOf(page, all, true), { autopublish: true, facebook: { linked: true, name: 'Ibtekr Club', publish: true, insights: true }, instagram: { linked: true, name: '@ibtekr.club', publish: true, insights: true }, valid: true, missing: [] });
  const bad = scopesOf({ data: { is_valid: false, scopes: ['pages_manage_posts'] } });
  assert.equal(connectionOf(page, bad, true).facebook.publish, false);
  assert.deepEqual(connectionOf(null, null, false), { autopublish: false, facebook: { linked: false, name: null, publish: false, insights: false }, instagram: { linked: false, name: null, publish: false, insights: false }, valid: null, missing: null });
  assert.equal(scopesOf({}), null);
});
