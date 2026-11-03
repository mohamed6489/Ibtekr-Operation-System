import { test } from 'node:test'; import assert from 'node:assert/strict';
import {
  SCOPES, SUBSCRIBED_FIELDS, authUrl, attachmentsOf, attachmentText, messageText, parseWebhook, commentThreadId, statusAfterIn, profileName, profileHandle, pagesOf, publicPages,
  graphErrorCode, graphPath, sendBody, privateReplyBody, hideBody, DEFAULT_NAME, permissionsOf, tokenlessCount, mergePages, businessIdsOf,
} from '../../supabase/functions/_shared/cs-channel.js';
// The Meta channel's pure part (phase 6.2): the dialog url, the attachments' labels, the webhook normalisation (messages, echoes,
// receipts, comments on Facebook and Instagram), the pages list, the error codes and the Graph addresses.

const REDIRECT = 'https://operation-system.ibtekr.club/meta-callback.html';

test('authUrl: the Facebook dialog with the app, the redirect, the state and the nine permissions (or a configuration)', () => {
  const u = new URL(authUrl('123', REDIRECT, 'st_' + 'x'.repeat(40)));
  assert.equal(u.origin + u.pathname, 'https://www.facebook.com/v21.0/dialog/oauth');
  assert.equal(u.searchParams.get('client_id'), '123'); assert.equal(u.searchParams.get('redirect_uri'), REDIRECT); assert.equal(u.searchParams.get('state'), 'st_' + 'x'.repeat(40));
  assert.deepEqual(u.searchParams.get('scope').split(','), SCOPES);
  assert.ok(SCOPES.includes('pages_messaging') && SCOPES.includes('pages_read_user_content') && SCOPES.length === 10 && SCOPES.includes('business_management') && SCOPES.includes('instagram_manage_messages') && SCOPES.includes('instagram_manage_comments') && SCOPES.includes('pages_manage_engagement'));
  const c = new URL(authUrl('123', REDIRECT, 's'.repeat(40), '987654321'));
  assert.equal(c.searchParams.get('config_id'), '987654321'); assert.equal(c.searchParams.get('override_default_response_type'), 'true');
  assert.equal(c.searchParams.get('scope'), null, 'a configuration replaces the scopes'); assert.equal(c.searchParams.get('response_type'), 'code');
  assert.ok(SUBSCRIBED_FIELDS.includes('messages') && SUBSCRIBED_FIELDS.includes('message_echoes') && SUBSCRIBED_FIELDS.includes('feed'));
});

test('attachments: type + https url only, labels in Arabic, the inbox text falls back to the labels then «[رسالة]»', () => {
  const list = attachmentsOf([{ type: 'image', payload: { url: 'https://cdn.fbsbx.com/a.jpg' } }, { type: 'image', payload: { url: 'http://x/a.jpg' } }, { type: 'audio', payload: {} }, 'junk', { type: 'file', payload: { url: 'https://cdn/f.pdf', title: 'f.pdf' } }]);
  assert.deepEqual(list, [{ type: 'image', url: 'https://cdn.fbsbx.com/a.jpg', title: null }, { type: 'image', url: null, title: null }, { type: 'audio', url: null, title: null }, { type: 'file', url: 'https://cdn/f.pdf', title: 'f.pdf' }]);
  assert.equal(attachmentText(list), '[صورة] [رسالة صوتية] [ملف]');
  assert.equal(messageText('  أهلاً  ', list), 'أهلاً'); assert.equal(messageText('', list), '[صورة] [رسالة صوتية] [ملف]'); assert.equal(messageText('', []), '[رسالة]');
  assert.equal(messageText('x'.repeat(5000), []).length, 4000);
  assert.deepEqual(attachmentsOf(null), []);
});

test('parseWebhook: a Messenger delivery — a customer message, an echo of the page, a delivery and a read receipt, a postback ignored', () => {
  const body = { object: 'page', entry: [{ id: '111', time: 1762000000000, messaging: [
    { sender: { id: '900' }, recipient: { id: '111' }, timestamp: 1762000001000, message: { mid: 'm.1', text: 'الأوردر فين؟', attachments: [{ type: 'image', payload: { url: 'https://cdn/x.jpg' } }] } },
    { sender: { id: '111' }, recipient: { id: '900' }, timestamp: 1762000002000, message: { mid: 'm.2', text: 'في الطريق', is_echo: true, app_id: 5 } },
    { sender: { id: '900' }, recipient: { id: '111' }, timestamp: 1762000003000, delivery: { mids: ['m.2'], watermark: 1762000002500 } },
    { sender: { id: '900' }, recipient: { id: '111' }, timestamp: 1762000004000, read: { watermark: 1762000003500 } },
    { sender: { id: '900' }, recipient: { id: '111' }, postback: { payload: 'GET_STARTED' } },
    { sender: { id: 'bad id!' }, recipient: { id: '111' }, message: { mid: 'm.3', text: 'x' } },
  ] }] };
  const p = parseWebhook(body);
  assert.equal(p.platform, 'messenger'); assert.equal(p.entries.length, 1); assert.equal(p.entries[0].id, '111');
  const ev = p.entries[0].events;
  assert.deepEqual(ev[0], { type: 'message', platform: 'messenger', pageId: '111', userId: '900', mid: 'm.1', text: 'الأوردر فين؟', attachments: [{ type: 'image', url: 'https://cdn/x.jpg', title: null }], at: 1762000001000, echo: false, replyTo: null, deleted: false, unsupported: false });
  assert.deepEqual(ev[1], { type: 'message', platform: 'messenger', pageId: '111', userId: '900', mid: 'm.2', text: 'في الطريق', attachments: [], at: 1762000002000, echo: true, replyTo: null, deleted: false, unsupported: false });
  assert.deepEqual(ev[2], { type: 'delivery', platform: 'messenger', pageId: '111', userId: '900', watermark: 1762000002500, mids: ['m.2'] });
  assert.deepEqual(ev[3], { type: 'read', platform: 'messenger', pageId: '111', userId: '900', watermark: 1762000003500 });
  assert.deepEqual(ev[4], { type: 'other', field: 'postback' });
  assert.equal(ev.length, 5, 'a sender id outside the id shape is dropped');
  assert.equal(parseWebhook({ object: 'user', entry: [] }), null); assert.equal(parseWebhook(null), null); assert.equal(parseWebhook({ object: 'page' }), null);
});

test('parseWebhook: Instagram DMs (seconds timestamps) and comments; Facebook feed comments (add / edited / remove), the page\'s own reply, other fields', () => {
  const ig = parseWebhook({ object: 'instagram', entry: [{ id: '777', time: 1762000000, messaging: [{ sender: { id: '55' }, recipient: { id: '777' }, timestamp: 1762000001, message: { mid: 'ig.1', attachments: [{ type: 'story_mention', payload: { url: 'https://cdn/s.jpg' } }] } }],
    changes: [{ field: 'comments', value: { id: 'c9', text: 'بكام؟', from: { id: '55', username: 'noha_h' }, media: { id: 'med1', media_product_type: 'FEED' }, parent_id: null } }, { field: 'mentions', value: {} }] }] });
  assert.equal(ig.platform, 'instagram');
  const e = ig.entries[0].events;
  assert.deepEqual(e[0], { type: 'message', platform: 'instagram', pageId: '777', userId: '55', mid: 'ig.1', text: '[ذكر في ستوري]', attachments: [{ type: 'story_mention', url: 'https://cdn/s.jpg', title: null }], at: 1762000001000, echo: false, replyTo: null, deleted: false, unsupported: false });
  assert.deepEqual(e[1], { type: 'comment', platform: 'instagram', pageId: '777', commentId: 'c9', postId: 'med1', parentId: null, fromId: '55', fromName: '@noha_h', text: 'بكام؟', at: 1762000000000, removed: false, edited: false });
  assert.deepEqual(e[2], { type: 'other', field: 'mentions' });
  const fb = parseWebhook({ object: 'page', entry: [{ id: '111', time: 1762000000, changes: [
    { field: 'feed', value: { item: 'comment', verb: 'add', comment_id: '111_c1', post_id: '111_p1', parent_id: '111_p1', from: { id: '42', name: 'Noha H' }, message: 'السعر؟', created_time: 1762000005 } },
    { field: 'feed', value: { item: 'comment', verb: 'add', comment_id: '111_c2', post_id: '111_p1', parent_id: '111_c1', from: { id: '111', name: 'Ibtekr Club' }, message: 'اتفضلي ع الخاص', created_time: 1762000006 } },
    { field: 'feed', value: { item: 'comment', verb: 'edited', comment_id: '111_c1', post_id: '111_p1', from: { id: '42', name: 'Noha H' }, message: 'السعر كام؟' } },
    { field: 'feed', value: { item: 'comment', verb: 'remove', comment_id: '111_c1', post_id: '111_p1', from: { id: '42' } } },
    { field: 'feed', value: { item: 'reaction', verb: 'add', post_id: '111_p1' } }, { field: 'feed', value: { item: 'comment', verb: 'hide', comment_id: '111_c1' } }, { field: 'ratings', value: {} }] }] });
  const f = fb.entries[0].events;
  assert.deepEqual(f[0], { type: 'comment', platform: 'facebook', pageId: '111', commentId: '111_c1', postId: '111_p1', parentId: '111_p1', fromId: '42', fromName: 'Noha H', text: 'السعر؟', at: 1762000005000, removed: false, edited: false });
  assert.equal(f[1].fromId, '111'); assert.equal(f[1].parentId, '111_c1');
  assert.deepEqual([f[2].edited, f[2].text, f[2].at], [true, 'السعر كام؟', 1762000000000]);
  assert.deepEqual([f[3].removed, f[3].text], [true, '']);
  assert.deepEqual(f.slice(4), [{ type: 'other', field: 'feed' }, { type: 'other', field: 'feed' }, { type: 'other', field: 'ratings' }]);
  assert.equal(commentThreadId('111_p1', '42'), '111_p1:42'); assert.equal(commentThreadId('p', null), 'p:anon');
  assert.equal(statusAfterIn(null), 'جديدة'); assert.equal(statusAfterIn('اتحلت'), 'مستنية ردنا'); assert.equal(statusAfterIn('جديدة'), 'مستنية ردنا');
});

test('profiles, pages, error codes, addresses and bodies', () => {
  assert.equal(profileName({ first_name: 'Noha', last_name: 'Hassan' }), 'Noha Hassan'); assert.equal(profileName({ name: 'نهى' }), 'نهى'); assert.equal(profileName({ username: 'noha' }), '@noha'); assert.equal(profileName({}), null); assert.equal(profileName(null), null);
  assert.equal(profileHandle({ username: 'noha' }), '@noha'); assert.equal(profileHandle({}), null);
  assert.deepEqual(DEFAULT_NAME, { messenger: 'عميل ماسنجر', instagram: 'عميل إنستجرام' });
  const pages = pagesOf({ data: [{ id: '111', name: 'Ibtekr Club', access_token: 'EAAB'.repeat(10), instagram_business_account: { id: '777', username: 'ibtekr.club' } }, { id: '222', name: 'Other', access_token: 'EAAC'.repeat(10) }, { id: '333', name: 'no token' }, 'junk'] });
  assert.deepEqual(pages, [{ id: '111', name: 'Ibtekr Club', token: 'EAAB'.repeat(10), ig: { id: '777', username: 'ibtekr.club' } }, { id: '222', name: 'Other', token: 'EAAC'.repeat(10), ig: null }]);
  assert.deepEqual(publicPages(pages), [{ id: '111', name: 'Ibtekr Club', ig: { id: '777', username: 'ibtekr.club' } }, { id: '222', name: 'Other', ig: null }]);
  assert.ok(!JSON.stringify(publicPages(pages)).includes('EAAB'), 'no token in the public list');
  assert.deepEqual(pagesOf(null), []);
  assert.equal(graphErrorCode({ error: { code: 10, error_subcode: 2018278, message: 'outside window' } }), 'graph_10:2018278'); assert.equal(graphErrorCode({ error: { code: 190 } }), 'graph_190'); assert.equal(graphErrorCode({}), 'graph_error');
  assert.equal(graphPath.send(), 'https://graph.facebook.com/v21.0/me/messages');
  assert.equal(graphPath.commentReply('c1', 'facebook'), 'https://graph.facebook.com/v21.0/c1/comments'); assert.equal(graphPath.commentReply('c1', 'instagram'), 'https://graph.facebook.com/v21.0/c1/replies');
  assert.equal(graphPath.profile('55', 'instagram'), 'https://graph.facebook.com/v21.0/55?fields=name,username'); assert.ok(graphPath.profile('55', 'messenger').endsWith('?fields=first_name,last_name,name'));
  assert.ok(graphPath.accounts().includes('instagram_business_account{id,username}'));
  assert.ok(graphPath.tokenExchange('1', REDIRECT, 'code-1').endsWith('&client_secret=')); assert.ok(graphPath.longLived('1').includes('grant_type=fb_exchange_token'));
  assert.deepEqual(sendBody('900', 'أهلاً'), { recipient: { id: '900' }, messaging_type: 'RESPONSE', message: { text: 'أهلاً' } });
  assert.deepEqual(privateReplyBody('c1', 'أهلاً'), { recipient: { comment_id: 'c1' }, message: { text: 'أهلاً' } });
  assert.deepEqual(hideBody('facebook'), { is_hidden: true }); assert.deepEqual(hideBody('instagram'), { hide: true });
});

test('the no-pages diagnosis: tokenless pages counted, permissions granted / declined / missing (business_management never required), merged pages once each, business ids', () => {
  assert.equal(tokenlessCount({ data: [{ id: '111', name: 'A' }, { id: '222', access_token: 'EAAB'.repeat(10) }, 'x'] }), 1); assert.equal(tokenlessCount(null), 0);
  const p = permissionsOf({ data: [{ permission: 'pages_show_list', status: 'granted' }, { permission: 'pages_messaging', status: 'declined' }, { permission: 'business_management', status: 'declined' }] });
  assert.deepEqual(p.granted, ['pages_show_list']); assert.deepEqual(p.declined, ['pages_messaging', 'business_management']);
  assert.ok(p.missing.includes('pages_messaging') && !p.missing.includes('pages_show_list') && !p.missing.includes('business_management')); assert.equal(p.missing.length, 8);
  assert.deepEqual(mergePages([{ id: '1', name: 'a' }], [{ id: '1', name: 'b' }, { id: '2', name: 'c' }]).map((x) => x.name), ['a', 'c']);
  assert.deepEqual(businessIdsOf({ data: [{ id: '5005' }, { id: 'bad id' }, 'x'] }), ['5005']);
  assert.ok(graphPath.businessPages('5005', 'owned').includes('/5005/owned_pages?') && graphPath.businessPages('5005', 'client').includes('/5005/client_pages?'));
});

test('a message id longer than 80 characters (88 live) is kept whole, never cut; an id with a space is dropped', () => {
  const MID = 'm_IL1l' + 'x'.repeat(72) + 'TKyfHPYcxg';
  const p = parseWebhook({ object: 'page', entry: [{ id: '111', time: 1762000000000, messaging: [
    { sender: { id: '111' }, recipient: { id: '900' }, timestamp: 1762000001000, message: { mid: MID, text: 'x', is_echo: true } },
    { sender: { id: '900' }, recipient: { id: '111' }, timestamp: 1762000002000, delivery: { mids: [MID], watermark: 1762000001500 } },
    { sender: { id: '900' }, recipient: { id: '111' }, message: { mid: 'bad mid', text: 'y' } }] }] });
  const ev = p.entries[0].events;
  assert.equal(ev[0].mid, MID); assert.equal(ev[0].mid.length, 88); assert.deepEqual(ev[1].mids, [MID]); assert.equal(ev.length, 2);
});
