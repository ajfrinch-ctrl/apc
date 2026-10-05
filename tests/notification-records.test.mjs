/* The notification record store and Settings → Notification Settings.
 *
 * The school's rules, one test each:
 *   • every notification is a record with id NOTIF-YYYYMMDD-0001, per-user,
 *     never shared between two accounts on one device
 *   • only `read === false` counts as unread; 0 hides the badge, 1–9 shows the
 *     number, 10+ shows "১০+"
 *   • updating the app never turns old news into unread notifications
 *   • settings are per user, saved, and a new user gets the defaults
 *   • the Settings screen exists on the student app with entry, switches,
 *     permission state, preview and history — and no acknowledgement button
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import {
  NOTIFICATIONS_KEY, NOTIFICATION_SETTINGS_KEY, NOTIFICATION_DEFAULTS, notificationId, nextNotificationId,
  listNotifications, unreadCount, unreadNotifications, markRead, markAllRead, markUnread, markDelivered,
  notificationByKey, pruneRecords, recordFromFeedItem, syncNotifications, notificationSettings, saveNotificationSettings
} from '../js/notification-store.js';
import { unreadBadgeText } from '../js/notice-center.js';
import { KEYS } from '../js/database.js';

const DAY = Date.parse('2026-10-02T08:00:00.000Z');
const item = (key, at = DAY) => ({ key, kind: 'notice', title: `শিরোনাম ${key}`, body: `বার্তা ${key}`, at, sourceId: key.split(':')[1] || key });

test('a record carries the agreed fields and an id of the day’s own series', async () => {
  const ctx = await loadPage('index.html');
  const first = nextNotificationId([], new Date(DAY));
  assert.equal(first, 'NOTIF-20261002-0001');
  const second = nextNotificationId([{ id: first }], new Date(DAY));
  assert.equal(second, 'NOTIF-20261002-0002');
  // A new day starts its own series.
  assert.equal(nextNotificationId([{ id: first }], new Date(Date.parse('2026-10-03T09:00:00Z'))), 'NOTIF-20261003-0001');
  assert.equal(notificationId(new Date('2026-01-09T00:00:00Z')).endsWith('20260109'), true);

  const result = syncNotifications({ userId: 'student:AP-1', feed: [item('notice:N1')], now: DAY });
  assert.equal(result.created, 1);
  const [record] = listNotifications('student:AP-1');
  for (const field of ['id', 'userId', 'type', 'title', 'message', 'targetType', 'targetId', 'relatedId', 'createdBy', 'createdAt', 'read', 'readAt', 'delivered', 'deliveredAt']) {
    assert.ok(field in record, `the record is missing ${field}`);
  }
  assert.equal(record.id, 'NOTIF-20261002-0001');
  assert.equal(record.userId, 'student:AP-1');
  assert.equal(record.type, 'notice');
  assert.equal(record.title, 'শিরোনাম notice:N1');
  assert.equal(record.message, 'বার্তা notice:N1');
  assert.equal(record.read, false);
  assert.equal(record.delivered, false);
  assert.equal(record.createdAt, new Date(DAY).toISOString());
  assert.equal(ctx.window.localStorage.getItem(NOTIFICATIONS_KEY).startsWith('{'), true, 'stored as JSON, not as a raw object');
});

test('syncing twice writes nothing new, and two users never share a record', async () => {
  await loadPage('index.html');
  const feed = [item('notice:N1'), item('notice:N2')];
  const first = syncNotifications({ userId: 'student:AP-1', feed, now: DAY });
  assert.equal(first.created, 2);
  const again = syncNotifications({ userId: 'student:AP-1', feed, now: DAY });
  assert.equal(again.created, 0, 'the same feed must not be recorded twice');
  assert.equal(listNotifications('student:AP-1').length, 2);

  syncNotifications({ userId: 'student:AP-2', feed, now: DAY });
  assert.equal(listNotifications('student:AP-1').length, 2, 'another user’s records are separate');
  assert.equal(listNotifications('student:AP-2').length, 2);
  markRead('student:AP-1', ['notice:N1']);
  assert.equal(unreadCount('student:AP-1'), 1, 'reading one user’s item must not touch the other’s');
  assert.equal(unreadCount('student:AP-2'), 2);
});

test('only read===false is unread; read, unread and delivered stamps follow the actions', async () => {
  await loadPage('index.html');
  const feed = [item('notice:A'), item('notice:B'), item('notice:C', DAY + 1000)];
  syncNotifications({ userId: 'student:AP-1', feed, now: DAY });
  assert.equal(unreadCount('student:AP-1'), 3);

  assert.equal(markRead('student:AP-1', ['notice:A'], DAY + 5000), 1);
  assert.equal(markRead('student:AP-1', ['notice:A'], DAY + 6000), 0, 'a second read is a no-op');
  const a = notificationByKey('student:AP-1', 'notice:A');
  assert.equal(a.read, true);
  assert.equal(a.readAt, new Date(DAY + 5000).toISOString());
  assert.equal(unreadCount('student:AP-1'), 2);

  assert.equal(markUnread('student:AP-1', ['notice:A']), 1);
  assert.deepEqual([notificationByKey('student:AP-1', 'notice:A').read, notificationByKey('student:AP-1', 'notice:A').readAt], [false, '']);
  assert.equal(unreadCount('student:AP-1'), 3);

  assert.equal(markDelivered('student:AP-1', ['notice:B'], DAY + 7000), 1);
  const b = notificationByKey('student:AP-1', 'notice:B');
  assert.deepEqual([b.delivered, b.deliveredAt], [true, new Date(DAY + 7000).toISOString()]);
  assert.equal(b.read, false, 'delivering is not reading');

  assert.equal(markAllRead('student:AP-1', DAY + 8000), 3, 'all three are unread again after markUnread');
  assert.equal(unreadCount('student:AP-1'), 0);
  assert.equal(unreadNotifications('student:AP-1').length, 0);
});

test('the badge text: 0 hides, 1–9 exact, 10+ shows ১০+', () => {
  assert.equal(unreadBadgeText(0), '');
  assert.equal(unreadBadgeText(1), '১');
  assert.equal(unreadBadgeText(9), '৯');
  assert.equal(unreadBadgeText(10), '১০+');
  assert.equal(unreadBadgeText(250), '১০+');
});

test('an update stores what the device already knew as read, so old news never buzzes as unread', async () => {
  await loadPage('index.html');
  const feed = [item('notice:OLD'), item('notice:NEW')];
  // `legacyRead` is the read receipts + cleared keys from before this refresh.
  const result = syncNotifications({ userId: 'student:AP-1', feed, legacyRead: ['notice:OLD'], now: DAY });
  assert.equal(result.created, 2);
  // Same timestamp: the list keeps the order they arrived in (newest first when stamped).
  assert.deepEqual(listNotifications('student:AP-1').map(record => [record.key, record.read]), [['notice:OLD', true], ['notice:NEW', false]]);
  assert.equal(unreadCount('student:AP-1'), 1);
});

test('a homework task leaving the due feed is resolved instead of leaving a stale unread badge', async () => {
  await loadPage('index.html');
  const task = {
    key: 'homework:ACT-1:rev1', kind: 'homework', title: 'অধ্যায় ৩', body: 'আগামীকাল জমা',
    sourceId: 'ACT-1', target: 'courses', at: DAY
  };
  syncNotifications({ userId: 'student:AP-1', feed: [task], now: DAY });
  assert.equal(unreadCount('student:AP-1'), 1);
  syncNotifications({ userId: 'student:AP-1', feed: [], now: DAY + 86400000 });
  assert.equal(unreadCount('student:AP-1'), 0);
  assert.equal(notificationByKey('student:AP-1', task.key).read, true);
});

test('the newest records are kept and unread ones are never pruned', async () => {
  await loadPage('index.html');
  const feed = Array.from({ length: 30 }, (_, index) => item(`notice:N${index}`, DAY + index * 1000));
  syncNotifications({ userId: 'student:AP-1', feed, now: DAY });
  markRead('student:AP-1', ['notice:N29']);
  markRead('student:AP-1', ['notice:N28']);
  // Most of the backlog has been read; a handful stays unread.
  markRead('student:AP-1', Array.from({ length: 21 }, (_, index) => `notice:N${index}`));
  const unreadBefore = unreadCount('student:AP-1');
  assert.equal(unreadBefore, 7);
  const removed = pruneRecords('student:AP-1', 10);
  assert.ok(removed > 0, 'something was pruned');
  const left = listNotifications('student:AP-1');
  assert.equal(left.length >= 10, true);
  assert.ok(left.some(record => record.key === 'notice:N29'), 'the newest records stay');
  assert.equal(unreadCount('student:AP-1'), unreadBefore, 'an unread record is never pruned away');
  for (let index = 1; index < left.length; index += 1) {
    assert.ok((left[index - 1].at || 0) >= (left[index].at || 0), 'history is newest-first');
  }
});

test('settings are per user, saved, and a fresh user gets the defaults', async () => {
  const ctx = await loadPage('index.html');
  assert.deepEqual(notificationSettings('student:AP-1'), { ...NOTIFICATION_DEFAULTS });
  const saved = saveNotificationSettings('student:AP-1', { background: false, sound: false });
  assert.deepEqual([saved.background, saved.sound, saved.inApp, saved.enabled], [false, false, true, true]);
  assert.deepEqual(
    [notificationSettings('student:AP-1').background, notificationSettings('student:AP-1').sound, notificationSettings('student:AP-1').inApp],
    [false, false, true]
  );
  assert.deepEqual(notificationSettings('student:AP-2'), { ...NOTIFICATION_DEFAULTS }, 'another user keeps the defaults');
  // Rewriting keeps the file readable and ignores unknown fields.
  saveNotificationSettings('student:AP-1', { nonsense: true, enabled: true });
  const raw = JSON.parse(ctx.window.localStorage.getItem(NOTIFICATION_SETTINGS_KEY));
  assert.equal(raw.users['student:AP-1'].background, false);
  assert.equal('nonsense' in raw.users['student:AP-1'], false);
});

test('a feed item maps to the section names the card shows', () => {
  const record = recordFromFeedItem({ key: 'exam-live:E1:5', kind: 'exam-live', title: 'পরীক্ষা শুরু', at: DAY, sourceId: 'E1' }, { userId: 'student:AP-1' });
  assert.equal(record.type, 'exam-live');
  assert.equal(record.section, 'পরীক্ষা');
  assert.equal(record.targetType, 'exams');
  assert.equal(record.relatedId, 'E1');
});

/* ---- the Settings screen, on the real student page ---------------------------- */

test('the student app ships Settings → Notification Settings with every switch', async () => {
  const ctx = await loadPage('index.html', { seed: { 'activePlus.demo.autofill.v1': 'off' } });
  const { window } = ctx;
  window.localStorage.setItem(KEYS.account, JSON.stringify({ username: 'raisa.islam', status: 'active', student: { id: 'AP-1024', name: 'রাইসা', className: 'দশম শ্রেণি' } }));
  const { buildSessionRecord } = await import('../js/session.js');
  window.localStorage.setItem('active-plus-session-v1', JSON.stringify(buildSessionRecord({ owner: 'raisa.islam' })));
  // Boot the real app shell (navigation + the Settings mount) and then the
  // notification engine, exactly like the page's own scripts do.
  await import(`../js/main.js?notification-settings-audit=${Math.random()}`);
  await ctx.waitFor(() => ctx.$('#appShell') && ctx.$('#appShell').hidden === false);
  const { initNotifications } = await import(`../js/notifications.js?records=${Math.random()}`);
  const api = initNotifications();
  await ctx.flush();
  await ctx.waitFor(() => Boolean(window.apcNoticeCenter), 3000);

  // The entry lives inside the student's own settings list.
  const entry = ctx.$('#profileView [data-view="notification-settings"]');
  assert.ok(entry, 'the settings entry is missing');
  assert.match(entry.textContent, /নোটিফিকেশন সেটিংস/);
  ctx.click(entry);
  assert.equal(ctx.$('#notificationSettingsView').classList.contains('active'), true, 'the settings view did not open');

  await ctx.waitFor(() => ctx.$$('#notificationSettings .notice-setting-row').length >= 4, 3000);
  const toggles = ctx.$$('#notificationSettings input[type=checkbox]').map(input => input.id);
  assert.deepEqual(toggles, ['noticeMasterToggle', 'noticeBackgroundToggle', 'noticeInAppToggle', 'noticeSoundToggle']);
  assert.ok(ctx.$('#notificationSettings [data-notice-preview]'), 'the preview action is missing');
  assert.ok(ctx.$('#notificationSettings [data-notice-read-all-settings]'), 'the read-all action is missing');
  assert.ok(ctx.$('#notificationSettings [data-notice-permission]') || ctx.$('#notificationSettings .notice-permission-ok'), 'the browser permission state is missing');
  assert.ok(ctx.$('#notificationSettings .notice-history-list'), 'the history list is missing');
  assert.doesNotMatch(ctx.$('#notificationSettingsView').textContent, /বুঝেছি|ঠিক আছে|আমি বুঝেছি/, 'no acknowledgement wording in Settings');

  // Flipping a switch is stored for this user and reaches the engine.
  const sound = ctx.$('#noticeMasterToggle');
  const event = new window.Event('change', { bubbles: true });
  sound.checked = false;
  sound.dispatchEvent(event);
  assert.equal(api.settings().enabled, false, 'the master switch did not reach the engine');
  assert.equal(notificationSettings('student:AP-1024').enabled, false, 'the choice was not saved for this user');
  await ctx.flush();
  assert.equal(ctx.$('#noticeMasterToggle').checked, false, 'the screen redrew with the off state');

  // The history shows what has arrived, with its read state.
  syncNotifications({ userId: 'student:AP-1024', feed: [{ ...item('result:H1'), kind: 'result' }], now: DAY });
  api.refresh();
  await ctx.flush();
  await ctx.waitFor(() => ctx.$('#notificationSettings .notice-history-row'), 3000);
  assert.match(ctx.$('#notificationSettings .notice-history-row').textContent, /অপঠিত/);

  // A preview opens the in-app card; no button asks for an acknowledgement.
  ctx.click(ctx.$('#notificationSettings [data-notice-preview]'));
  await ctx.waitFor(() => Boolean(ctx.$('#apcInAppAlert') && !ctx.$('#apcInAppAlert').hidden), 3000);
  assert.match(ctx.$('#apcInAppAlert').textContent, /প্রিভিউ/);
  assert.doesNotMatch(ctx.$('#apcInAppAlert').textContent, /বুঝেছি|ঠিক আছে|আমি বুঝেছি/);
  assert.deepEqual(ctx.jsdomErrors, [], 'no script errors on the settings screen');
});
