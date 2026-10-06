/* End to end on the real Manager panel (manager.js + notification engine +
   bell inbox): a counter entry waiting for approval rings, "পেমেন্ট দেখুন"
   closes the inbox and really opens হিসাব → পেমেন্ট অনুমোদন with that entry's
   Approve button; approving it there removes the notification. A paper sent by
   the teacher opens the Examination view the same way. */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { provisionStaff, seedStaffSession } from './staff-harness.mjs';
import { STAFF_ACCOUNTS } from '../js/staff-auth.js';
import { KEYS } from '../js/database.js';

const VIEWER = `staff:${STAFF_ACCOUNTS.manager.username}`;
let ctx;
let controller;
const shown = [];

before(async () => {
  const now = Date.now();
  ctx = await loadPage('manager.html', { seed: {
    [KEYS.transactions]: JSON.stringify([
      { id: 'TX-9', receiptNo: 'R-9', studentId: 'S-1', studentName: 'রহিম উদ্দিন', className: 'দশম', feeType: 'মাসিক বেতন', month: 'অক্টোবর', amount: 1500, method: 'Cash', status: 'pending', reviewHistory: [], recordedAt: now }
    ]),
    [KEYS.exams]: JSON.stringify({ version: 1, attempts: [], exams: [] }),
    // This device already ran the current engine.
    [`activePlus.notifications.boot.v1:${VIEWER}`]: JSON.stringify({ version: 1, at: now - 60000 }),
    [`activePlus.notifications.rules.v1:${VIEWER}`]: JSON.stringify({ version: 2, at: now - 60000 })
  } });
  class FakeNotification { constructor(title, options) { shown.push({ title, options: options || {} }); } close() {} }
  FakeNotification.permission = 'granted';
  FakeNotification.requestPermission = async () => 'granted';
  ctx.window.Notification = FakeNotification;
  await provisionStaff('manager');
  seedStaffSession(ctx.window, 'manager');
  await import('../js/manager.js');
  await ctx.waitFor(() => ctx.$('#managerShell').hidden === false);
  controller = (await import('../js/notifications.js')).initNotifications();
  await ctx.flush();
});

const activeView = () => ctx.$('.manager-view.active')?.dataset.viewPanel;
/* A legacy deep link (`cash-counter`) now opens the approval segment of
   route name stays, its home in the new information architecture is হিসাব. */
const financeSegment = () => ctx.$('[data-finance-panel]:not([hidden])')?.dataset.financePanel;
const inboxOpen = () => { const modal = ctx.$('#noticeModal'); return Boolean(modal && !modal.hidden && !modal.classList.contains('hidden')); };

test('the pending counter entry rings on the Manager phone', () => {
  assert.equal(controller.viewer()?.role, 'manager');
  assert.ok(shown.some(item => item.title === 'পেমেন্ট অনুমোদনের অপেক্ষায়' && /রহিম উদ্দিন/.test(item.options.body)));
  assert.equal(activeView(), 'dashboard');
});

test('"পেমেন্ট দেখুন" closes the inbox and opens হিসাব → পেমেন্ট অনুমোদন at that entry', async () => {
  ctx.click(ctx.$('#notificationButton'));
  await ctx.flush();
  const open = ctx.$('button[data-apc-notice-open="payment-review:TX-9"]');
  assert.ok(open);
  ctx.click(open);
  await ctx.flush();
  assert.equal(activeView(), 'finance');
  assert.equal(financeSegment(), 'approval', 'the approval queue is the open segment');
  assert.equal(inboxOpen(), false, 'the bell list is closed');
  // The panel loads its ledger asynchronously and repaints the open view.
  await ctx.waitFor(() => ctx.$('#managerCashList [data-manager-action="approve-payment"][data-id="TX-9"]'), 5000);
});

test('approving it in the approval queue removes the notification', async () => {
  ctx.click(ctx.$('#managerCashList [data-manager-action="approve-payment"][data-id="TX-9"]'));
  await ctx.waitFor(() => JSON.parse(ctx.window.localStorage.getItem(KEYS.transactions))[0].status === 'approved');
  controller.refresh();
  await ctx.flush();
  assert.ok(!controller.feed().some(item => item.kind === 'payment-review'));
});

test('a paper from the teacher opens the Examination view', async () => {
  ctx.window.localStorage.setItem(KEYS.exams, JSON.stringify({ version: 1, attempts: [], exams: [
    { id: 'EX-1', title: 'রসায়ন', subject: 'রসায়ন', status: 'pending', teacherId: 'T', teacherName: 'করিম', className: 'দশম', startAt: Date.now() + 86400000, endAt: Date.now() + 90000000, updatedAt: 1, submittedAt: Date.now(), participants: [], questions: [] }
  ] }));
  controller.refresh();
  await ctx.flush();
  assert.equal(shown.at(-1).title, 'পরীক্ষা অনুমোদনের অপেক্ষায়');
  ctx.click(ctx.$('#notificationButton'));
  await ctx.flush();
  const open = ctx.$('button[data-apc-notice-open^="exam-review:EX-1:"]');
  assert.equal(open?.textContent, 'পরীক্ষা দেখুন');
  ctx.click(open);
  await ctx.flush();
  assert.equal(activeView(), 'exams');
  assert.equal(inboxOpen(), false);
});

test('the in-app card: a new entry appears on it, and tapping it opens the approval queue', async () => {
  ctx.click(ctx.$('[data-manager-view="dashboard"]'));
  const list = JSON.parse(ctx.window.localStorage.getItem(KEYS.transactions));
  list.unshift({ id: 'TX-10', receiptNo: 'R-10', studentId: 'S-2', studentName: 'করিম হাসান', className: 'নবম', feeType: 'মাসিক বেতন', month: 'অক্টোবর', amount: 1200, method: 'Cash', status: 'pending', reviewHistory: [], recordedAt: Date.now() });
  // Arrives the way the sync bridge delivers it (js/realtime-sync.js notifyRemote).
  ctx.window.localStorage.setItem(KEYS.transactions, JSON.stringify(list));
  const arrived = new ctx.window.StorageEvent('storage', { key: KEYS.transactions, newValue: JSON.stringify(list), storageArea: ctx.window.localStorage });
  Object.defineProperty(arrived, 'apcRemote', { value: true });
  ctx.window.dispatchEvent(arrived);
  await ctx.waitFor(() => ctx.$('#apcInAppAlert') && !ctx.$('#apcInAppAlert').hidden, 3000);
  assert.match(ctx.$('#apcInAppAlert').textContent, /করিম হাসান/);
  ctx.click(ctx.$('#apcInAppAlert [data-apc-alert-open="payment-review:TX-10"]'));
  await ctx.waitFor(() => activeView() === 'finance' && financeSegment() === 'approval', 3000);
  await ctx.waitFor(() => ctx.$('#managerCashList [data-manager-action="approve-payment"][data-id="TX-10"]'), 5000);
  assert.equal(ctx.$('#apcInAppAlert').hidden, true);
});

test('no page errors', () => assert.deepEqual(ctx.jsdomErrors, []));
