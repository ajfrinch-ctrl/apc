/* The student bell remains for tasks and account alerts. School notices live
   on the separate Notice Board; unrelated actionable alerts still use the card. */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage } from './jsdom-harness.mjs';
import { KEYS } from '../js/database.js';
import { planInAppAlerts } from '../js/notification-rules.js';

const STUDENT_ID = 's260930002-inap';
const VIEWER = `student:${STUDENT_ID}`;
const INAPP_KEY = `activePlus.notifications.inapp.v1:${VIEWER}`;
const notice = (id, title, createdAt = new Date().toISOString()) => ({ id, title, body: `${title} — বিস্তারিত`, audience: 'সকল শিক্ষার্থী', status: 'published', createdAt });

let ctx;
let controller;
let board;
let examDb = { version: 1, attempts: [], exams: [] };
const clicks = [];
const card = () => ctx.$('#apcInAppAlert');
const cardVisible = () => Boolean(card() && !card().hidden);
const inbox = () => ctx.$('#noticeModal');
const closeInbox = () => ctx.click(ctx.$('#noticeModal .modal-close'));

function publishResult(id, title = 'ফলাফল প্রকাশিত') {
  const at = Date.now();
  examDb = {
    ...examDb,
    exams: [...examDb.exams, {
      id, title, subject: 'গণিত', status: 'published', teacherId: 'T', startAt: at - 7200000,
      endAt: at - 3600000, publishedAt: at - 86400000, resultsPublished: true,
      resultsPublishedAt: at, participants: [{ id: STUDENT_ID, name: 'নাদিয়া', className: 'দশম' }]
    }]
  };
  ctx.window.localStorage.setItem(KEYS.exams, JSON.stringify(examDb));
  controller.refresh();
}

// The planner is intentionally data-only. Student-specific Board separation is
// applied by the notification engine before this helper receives the feed.
test('the pure plan: new items once; a first run shows only tasks and running exams', () => {
  const feed = [
    { key: 'notice:old', kind: 'notice', at: 1 },
    { key: 'registration:s1', kind: 'registration', actionable: true, at: 2 },
    { key: 'exam-live:E1:5', kind: 'exam-live', at: 3 }
  ];
  const first = planInAppAlerts({ feed, known: feed, initialise: true });
  assert.deepEqual(first.show.map(item => item.key), ['exam-live:E1:5', 'registration:s1']);
  assert.deepEqual(first.record.sort(), feed.map(item => item.key).sort(), 'everything current is the baseline');
  const next = planInAppAlerts({ feed: [...feed, { key: 'notice:new', kind: 'notice', at: 9 }], known: feed, shown: first.record });
  assert.deepEqual(next.show.map(item => item.key), ['notice:new']);
  assert.deepEqual(next.record.sort(), first.record.sort(), 'an item counts as shown only when the card shows it');
  const pruned = planInAppAlerts({ feed: [], known: [], shown: ['gone'] });
  assert.deepEqual(pruned.record, [], 'receipts of vanished items are dropped');
});

before(async () => {
  ctx = await loadPage('index.html');
  assert.equal('Notification' in ctx.window, false, 'no phone notification permission exists here');
  const store = ctx.window.localStorage;
  store.setItem(KEYS.account, JSON.stringify({ username: 'nadia', status: 'active', student: { id: STUDENT_ID, name: 'নাদিয়া' } }));
  store.setItem(KEYS.notices, JSON.stringify([notice('N-OLD', 'পুরোনো নোটিশ', '2026-09-01T00:00:00.000Z')]));
  store.setItem(`activePlus.notifications.boot.v1:${VIEWER}`, JSON.stringify({ version: 1, at: Date.now() - 60000 }));
  store.setItem(`activePlus.notifications.rules.v1:${VIEWER}`, JSON.stringify({ version: 2, at: Date.now() - 60000 }));
  store.setItem(INAPP_KEY, JSON.stringify({ version: 1, at: 0, keys: ['notice:N-OLD:2026-09-01T00:00:00.000Z'] }));
  // A notice published while the phone was off.
  store.setItem(KEYS.notices, JSON.stringify([notice('N-OLD', 'পুরোনো নোটিশ', '2026-09-01T00:00:00.000Z'), notice('N-NEW', 'কাল ক্লাস বন্ধ')]));
  const { initStudentNoticeBoard } = await import('../js/student-notice-board.js?inapp-notice-board');
  board = initStudentNoticeBoard({ getStudent: () => ({ id: STUDENT_ID, name: 'নাদিয়া' }) });
  for (const button of ctx.$$('[data-view]')) button.addEventListener('click', () => clicks.push(button.dataset.view));
  controller = (await import('../js/notifications.js?notice-board-inapp-separation')).initNotifications();
  assert.ok(controller, 'notification engine should initialize');
  await ctx.waitFor(() => Boolean(ctx.window.apcNoticeCenter), 3000);
  await ctx.flush();
});

test('nothing is shown over the login screen', async () => {
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(cardVisible(), false);
  const stored = JSON.parse(ctx.window.localStorage.getItem(INAPP_KEY)).keys;
  assert.ok(!stored.some(key => key.startsWith('notice:N-NEW')), 'not counted as shown yet');
});

test('student notices appear only on the Notice Board, not as in-app cards or in the bell', async () => {
  ctx.$('#appShell').hidden = false;
  controller.refresh();
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(cardVisible(), false, 'a newly published notice does not cover the app with a popup');
  assert.equal(board.refresh().total, 2, 'both old and newly published notices remain on the Board');
  assert.ok(controller.feed().every(item => !['notice', 'broadcast'].includes(item.kind)));
  assert.equal(controller.unread(), 0, 'Board notices do not affect the ordinary unread count');

  ctx.click(ctx.$('#notificationButton'));
  assert.equal(inbox().hidden, false);
  assert.match(ctx.$('#noticeListStudent').textContent, /আলাদা Notice Board/);
  assert.doesNotMatch(ctx.$('#noticeListStudent').textContent, /কাল ক্লাস বন্ধ|পুরোনো নোটিশ/);
  closeInbox();
});

test('a notice arriving while signed in updates the Board without queuing an in-app alert', async () => {
  ctx.window.localStorage.setItem(KEYS.notices, JSON.stringify([
    notice('N-OLD', 'পুরোনো নোটিশ', '2026-09-01T00:00:00.000Z'),
    notice('N-NEW', 'কাল ক্লাস বন্ধ'), notice('N-LIVE', 'আজকের নতুন ঘোষণা')
  ]));
  board.refresh(); controller.refresh();
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(cardVisible(), false);
  assert.equal(board.refresh().total, 3);
  assert.ok(controller.feed().every(item => item.kind !== 'notice'));
});

test('something arriving while the app is open appears at once; tapping a result opens Results', async () => {
  publishResult('E-R', 'গণিত');
  await ctx.waitFor(() => cardVisible(), 3000);
  assert.match(card().textContent, /ফলাফল প্রকাশিত হয়েছে/);
  clicks.length = 0;
  ctx.click(ctx.$('#apcInAppAlert [data-apc-alert-open^="result:E-R"]'));
  await ctx.waitFor(() => clicks.includes('results'), 3000);
  assert.equal(cardVisible(), false);
});

test('× closes the card; the item stays in the ordinary bell list', async () => {
  publishResult('E-CLOSE', 'ফলাফল বন্ধ না করে পড়া');
  await ctx.waitFor(() => cardVisible(), 3000);
  assert.match(card().textContent, /ফলাফল প্রকাশিত হয়েছে/);
  ctx.click(ctx.$('#apcInAppAlert [data-apc-alert-close]'));
  assert.equal(cardVisible(), false);
  assert.ok(controller.feed().some(item => item.key.startsWith('result:E-CLOSE')));
});

test('"সব দেখুন" opens the ordinary list for a result alert', async () => {
  publishResult('E-ALL', 'সবার জন্য ফলাফল');
  await ctx.waitFor(() => cardVisible(), 3000);
  ctx.click(ctx.$('#apcInAppAlert [data-apc-alert-all]'));
  assert.equal(cardVisible(), false);
  assert.equal(inbox().hidden, false);
  assert.match(ctx.$('#noticeListStudent').textContent, /সবার জন্য ফলাফল/);
  closeInbox();
});

test('the popup is closed by its own controls — no acknowledgement wording anywhere', async () => {
  publishResult('E-POPUP', 'পপআপ বন্ধ করুন');
  await ctx.waitFor(() => cardVisible(), 3000);
  const backdrop = ctx.$('#apcAlertBackdrop');
  assert.ok(backdrop && !backdrop.hidden, 'the popup sits on its own backdrop');
  assert.equal(backdrop.contains(card()), true, 'the sheet lives inside the backdrop');
  assert.equal(card().getAttribute('role'), 'dialog');
  assert.equal(card().getAttribute('aria-modal'), 'true');
  assert.doesNotMatch(card().textContent, /বুঝেছি|ঠিক আছে|আমি বুঝেছি/);
  const closeButton = card().querySelector('[data-apc-alert-close]');
  assert.ok(closeButton, 'the popup has a close control');
  assert.equal(ctx.$('#apcInAppAlert [data-apc-alert-cancel]'), null, 'the acknowledgement button must not return');
  const css = readFileSync(new URL('../css/ui-features.css', import.meta.url), 'utf8');
  assert.match(css, /\.apc-alert-backdrop\{[^}]*background:var\(--modal-backdrop\)/, 'the backdrop has no dim layer');
  const skin = readFileSync(new URL('../css/ui-interior.css', import.meta.url), 'utf8');
  assert.match(skin, /\.apc-alert-backdrop/, 'the glass skin does not blur the popup backdrop');
  ctx.click([...card().querySelectorAll('[data-apc-alert-close]')].at(-1));
  assert.equal(cardVisible(), false);
  assert.equal(backdrop.hidden, true);
  assert.ok(controller.feed().some(item => item.key.startsWith('result:E-POPUP')));
});

test('× on the popup closes it and Escape always works', async () => {
  publishResult('E-X1', 'Escape দিয়ে বন্ধ');
  await ctx.waitFor(() => cardVisible(), 3000);
  ctx.click(ctx.$('#apcInAppAlert [data-apc-alert-close]'));
  assert.equal(cardVisible(), false, '× did not close the popup');
  publishResult('E-X2', 'Escape পরীক্ষা');
  await ctx.waitFor(() => cardVisible(), 3000);
  ctx.window.document.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(cardVisible(), false, 'Escape did not close the popup');
});

test('the off switch is explained in the same popup, on the same blurred backdrop', () => {
  const center = ctx.window.apcNoticeCenter;
  assert.ok(center && typeof center.showInfo === 'function', 'the popup has no off-state');
  assert.equal(center.showInfo('denied'), true);
  assert.equal(cardVisible(), true);
  assert.match(card().textContent, /নোটিফিকেশন বন্ধ/);
  assert.match(card().textContent, /ব্রাউজার সেটিংস/);
  assert.doesNotMatch(card().textContent, /বুঝেছি|ঠিক আছে|আমি বুঝেছি/);
  assert.equal(ctx.$('#apcAlertBackdrop').hidden, false);
  ctx.click(ctx.$('#apcInAppAlert [data-apc-alert-close]'));
  assert.equal(cardVisible(), false);
  ctx.window.document.dispatchEvent(new ctx.window.CustomEvent('apc-notifications-updated'));
  assert.equal(center.showInfo('disabled'), true);
  assert.match(card().textContent, /বন্ধ করা হয়েছে/);
  ctx.click(ctx.$('#apcInAppAlert [data-apc-alert-close]'));
  assert.equal(cardVisible(), false);
});

test('no page errors', () => assert.deepEqual(ctx.jsdomErrors, []));
