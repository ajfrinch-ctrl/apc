/* An ordinary task alert acknowledged in the inbox must not come back as a
   "new" in-app message after login, even if the popup receipt is stale. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { KEYS } from '../js/database.js';

const STUDENT_ID = 'AP-READ-LOGIN';
const USER_ID = `student:${STUDENT_ID}`;
const INAPP_KEY = `activePlus.notifications.inapp.v1:${USER_ID}`;
const alertIsVisible = ctx => Boolean(ctx.$('#apcInAppAlert') && !ctx.$('#apcInAppAlert').hidden);

test('mark-all-read stays authoritative after login when an in-app popup receipt is stale', async t => {
  const ctx = await loadPage('index.html');
  t.after(() => ctx.window.close());
  const store = ctx.window.localStorage;
  const at = Date.now();
  store.setItem(KEYS.account, JSON.stringify({
    username: 'read.login.student', status: 'active', student: { id: STUDENT_ID, name: 'শিক্ষার্থী' }
  }));
  store.setItem(KEYS.exams, JSON.stringify({ version: 1, attempts: [], exams: [{
    id: 'E-READ-LOGIN', title: 'পড়া ফলাফল', subject: 'গণিত', status: 'published',
    startAt: at - 7200000, endAt: at - 3600000, publishedAt: at - 86400000,
    resultsPublished: true, resultsPublishedAt: at,
    participants: [{ id: STUDENT_ID, name: 'শিক্ষার্থী', className: 'দশম' }]
  }] }));
  // This is an existing account/device, not the silent first-install path.
  store.setItem(`activePlus.notifications.boot.v1:${USER_ID}`, JSON.stringify({ version: 1, at: Date.now() - 60000 }));
  store.setItem(`activePlus.notifications.rules.v1:${USER_ID}`, JSON.stringify({ version: 3, at: Date.now() - 60000 }));
  store.setItem(INAPP_KEY, JSON.stringify({ version: 1, at: Date.now(), keys: [] }));
  ctx.$('#appShell').hidden = false;

  const { initNotifications } = await import(`../js/notifications.js?read-login=${Math.random()}`);
  const api = initNotifications();
  await ctx.waitFor(() => Boolean(ctx.window.apcNoticeCenter), 3000);
  await ctx.waitFor(() => alertIsVisible(ctx), 3000);

  // Read every ordinary message using the same control the student sees in the inbox.
  ctx.click(ctx.$('#notificationButton'));
  const modal = ctx.$('#noticeModal');
  assert.equal(modal.hidden, false, 'the inbox opens');
  ctx.click(modal.querySelector('[data-apc-notice-read-all]'));
  assert.equal(api.unread(), 0, 'all ordinary notification records are read');
  assert.equal(ctx.$('#notificationButton .notification-dot').hidden, true, 'the unread badge clears');
  assert.equal(alertIsVisible(ctx), false, 'the popup is dismissed after reading');

  // Reproduce an old/incomplete in-app delivery receipt. The durable read
  // record, not this secondary popup cache, must decide whether the message is new.
  store.setItem(INAPP_KEY, JSON.stringify({ version: 1, at: Date.now(), keys: [] }));
  modal.hidden = true;
  ctx.$('#appShell').hidden = true;
  ctx.window.dispatchEvent(new ctx.window.Event('apc-session-ended'));
  ctx.$('#appShell').hidden = false;
  ctx.window.dispatchEvent(new ctx.window.Event('apc-session-ready'));
  api.refresh();
  await ctx.flush();
  await new Promise(resolve => setTimeout(resolve, 80));

  assert.equal(api.unread(), 0, 'logging in does not make the read item unread again');
  assert.equal(alertIsVisible(ctx), false, 'the read message is not replayed as a login popup');
  assert.deepEqual(ctx.jsdomErrors, [], 'no UI errors while restoring the read state');
});
