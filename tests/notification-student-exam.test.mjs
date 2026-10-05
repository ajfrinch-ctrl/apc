/* Student phone (real index.html + notification engine): the exam reminder is
   raised by a timer at "10 minutes before", the start is announced, the fee
   confirmation and the registration decision arrive, and tapping an item opens
   its view and clears it. */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { KEYS } from '../js/database.js';
import { EXAM_REMINDER_MS } from '../js/notification-rules.js';

const STUDENT_ID = 's260930001-abcd';
const VIEWER = `student:${STUDENT_ID}`;

let ctx;
let controller;
let shown;
const clicks = [];

const examDb = exams => ({ version: 1, exams, attempts: [] });
const exam = (id, startAt, extra = {}) => ({
  id, title: `পরীক্ষা ${id}`, subject: 'গণিত', type: 'mcq', status: 'published', teacherId: 'T', startAt, endAt: startAt + 30 * 60000,
  publishedAt: Date.now() - 86400000, participants: [{ id: STUDENT_ID, name: 'রহিম', className: 'দশম' }], ...extra
});

before(async () => {
  ctx = await loadPage('index.html');
  shown = [];
  class FakeNotification {
    constructor(title, options) { shown.push({ title, options: options || {} }); }
    close() {}
  }
  FakeNotification.permission = 'granted';
  FakeNotification.requestPermission = async () => 'granted';
  ctx.window.Notification = FakeNotification;
  const store = ctx.window.localStorage;
  store.setItem(KEYS.account, JSON.stringify({ username: 'rahim', status: 'pending', student: { id: STUDENT_ID, name: 'রহিম' } }));
  store.setItem(KEYS.students, JSON.stringify([{ id: STUDENT_ID, name: 'রহিম', status: 'pending' }]));
  store.setItem(`activePlus.notifications.boot.v1:${VIEWER}`, JSON.stringify({ version: 1, at: Date.now() - 60000 }));
  store.setItem(`activePlus.notifications.rules.v1:${VIEWER}`, JSON.stringify({ version: 2, at: Date.now() - 60000 }));
  ctx.$('#appShell').hidden = false;          // a signed-in student
  for (const button of ctx.$$('[data-view]')) button.addEventListener('click', () => clicks.push(button.dataset.view));
  controller = (await import('../js/notifications.js')).initNotifications();
  await ctx.flush();
});

test('the approval of this student’s registration is announced', async () => {
  ctx.window.localStorage.setItem(KEYS.students, JSON.stringify([{ id: STUDENT_ID, name: 'রহিম', status: 'approved', reviewedAt: new Date().toISOString(), reviewedRole: 'admin' }]));
  controller.refresh();
  await ctx.flush();
  assert.ok(shown.some(item => item.title === 'রেজিস্ট্রেশন অনুমোদিত হয়েছে'));
});

test('a timer raises the reminder 10 minutes before the start, without any data change', async () => {
  // The reminder window opens ~1.2 s from now.
  const startAt = Date.now() + EXAM_REMINDER_MS + 1200;
  ctx.window.localStorage.setItem(KEYS.exams, JSON.stringify(examDb([exam('E1', startAt)])));
  controller.refresh();
  await ctx.flush();
  const before = shown.length;
  assert.ok(!shown.some(item => item.title === 'পরীক্ষা শীঘ্রই শুরু হবে'), 'not yet');
  await ctx.waitFor(() => shown.length > before && shown.some(item => item.title === 'পরীক্ষা শীঘ্রই শুরু হবে'), 5000);
  const reminder = shown.find(item => item.title === 'পরীক্ষা শীঘ্রই শুরু হবে');
  assert.match(reminder.options.body, /পরীক্ষা E1/);
  assert.match(reminder.options.body, /মিনিট পর শুরু/);
});

test('an exam that is running is announced as started', async () => {
  const running = exam('E2', Date.now() - 60000);
  ctx.window.localStorage.setItem(KEYS.exams, JSON.stringify(examDb([running])));
  controller.refresh();
  await ctx.flush();
  assert.ok(shown.some(item => item.title === 'পরীক্ষা শুরু হয়েছে — এখনই অংশ নাও'));
});

test('a confirmed fee is announced', async () => {
  ctx.window.localStorage.setItem(KEYS.transactions, JSON.stringify([
    { id: 'T1', receiptNo: 'R1', studentId: STUDENT_ID, studentName: 'রহিম', feeType: 'মাসিক বেতন', month: 'অক্টোবর', amount: 1500, status: 'approved', reviewedAt: new Date().toISOString() },
    { id: 'T2', studentId: 'someone-else', amount: 900, status: 'approved', reviewedAt: new Date().toISOString() }
  ]));
  controller.refresh();
  await ctx.flush();
  const fee = shown.filter(item => item.title === 'ফি জমা নিশ্চিত হয়েছে');
  assert.equal(fee.length, 1, 'only this student’s own fee');
  assert.match(fee[0].options.body, /৳1500/);
});

test('tapping the running exam opens the exams view and clears the item', async () => {
  const item = controller.feed().find(entry => entry.kind === 'exam-live');
  assert.ok(item);
  await controller.openItem(item);
  assert.equal(clicks.at(-1), 'exams');
  assert.ok(!controller.feed().some(entry => entry.key === item.key), 'seen → cleared');
});

test('a tray tap without a view name still finds the right view', async () => {
  const module = await import('../js/notifications.js');
  clicks.length = 0;
  await module.openNotificationTarget({ kind: 'result', id: 'E9', key: 'result:E9:1' });
  assert.deepEqual(clicks, ['exams'], 'ফলাফল lives inside the পরীক্ষা section');
});

test('a fee confirmation carries its details and has no page to open', async () => {
  const fee = controller.feed().find(entry => entry.kind === 'payment');
  assert.equal(fee.target, undefined);
  clicks.length = 0;
  await controller.openItem(fee);
  assert.deepEqual(clicks, [], 'the student app has no fee page');
  assert.ok(!controller.feed().some(entry => entry.key === fee.key), 'but it is cleared as seen');
});

test('the page booted without errors', () => {
  assert.deepEqual(ctx.jsdomErrors, []);
});
