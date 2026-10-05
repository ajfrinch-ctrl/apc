/* Manager phone (real manager.html + notification engine): fee entries and
   papers waiting for approval are announced, open their view when tapped, and
   an update does not replay old tasks as new notifications. */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { KEYS, STAFF_KEYS } from '../js/database.js';

const VIEWER = 'staff:manager.apc';
let ctx;
let controller;
let shown;
const clicks = [];

before(async () => {
  ctx = await loadPage('manager.html');
  shown = [];
  class FakeNotification {
    constructor(title, options) { shown.push({ title, options: options || {} }); }
    close() {}
  }
  FakeNotification.permission = 'granted';
  FakeNotification.requestPermission = async () => 'granted';
  ctx.window.Notification = FakeNotification;
  const store = ctx.window.localStorage;
  store.setItem(STAFF_KEYS.managerAccount, JSON.stringify({ username: 'manager.apc', fullName: 'ম্যানেজার' }));
  // A device that ran the engine BEFORE this update (rules version 1).
  store.setItem(`activePlus.notifications.boot.v1:${VIEWER}`, JSON.stringify({ version: 1, at: Date.now() - 86400000 }));
  store.setItem(KEYS.notices, JSON.stringify([]));
  store.setItem(KEYS.transactions, JSON.stringify([
    { id: 'OLD1', studentName: 'পুরোনো', studentId: 's1', feeType: 'মাসিক বেতন', month: 'সেপ্টেম্বর', amount: 1000, status: 'pending', recordedAt: Date.now() - 86400000 }
  ]));
  ctx.$('#managerShell').hidden = false;      // a signed-in Manager
  for (const button of ctx.$$('[data-manager-view]')) button.addEventListener('click', () => clicks.push(button.dataset.managerView));
  controller = (await import('../js/notifications.js')).initNotifications();
  await ctx.flush();
});

test('after the update, existing tasks are listed but do not buzz the phone', () => {
  assert.ok(controller.feed().some(item => item.key === 'payment-review:OLD1'), 'listed');
  assert.equal(shown.length, 0, 'not announced as new');
  assert.equal(JSON.parse(ctx.window.localStorage.getItem(`activePlus.notifications.rules.v1:${VIEWER}`)).version, 3);
});

test('a new fee entry from the counter is announced', async () => {
  const list = JSON.parse(ctx.window.localStorage.getItem(KEYS.transactions));
  list.push({ id: 'T2', studentName: 'রহিম', studentId: 's2', feeType: 'মাসিক বেতন', month: 'অক্টোবর', amount: 1500, status: 'pending', recordedAt: Date.now() });
  ctx.window.localStorage.setItem(KEYS.transactions, JSON.stringify(list));
  controller.refresh();
  await ctx.flush();
  assert.equal(shown.length, 1);
  assert.equal(shown[0].title, 'পেমেন্ট অনুমোদনের অপেক্ষায়');
  assert.match(shown[0].options.body, /রহিম/);
});

test('a paper sent by the teacher is announced', async () => {
  ctx.window.localStorage.setItem(KEYS.exams, JSON.stringify({ version: 1, attempts: [], exams: [
    { id: 'P1', title: 'রসায়ন', status: 'pending', teacherId: 'T', teacherName: 'করিম', className: 'দশম', startAt: Date.now() + 86400000, updatedAt: Date.now(), participants: [] }
  ] }));
  controller.refresh();
  await ctx.flush();
  assert.equal(shown.at(-1).title, 'পরীক্ষা অনুমোদনের অপেক্ষায়');
});

test('tapping a task in the bell opens its view and clears it', async () => {
  ctx.click(ctx.$('#notificationButton'));
  const open = ctx.$('button[data-apc-notice-open="payment-review:T2"]');
  assert.ok(open, 'the item offers its action');
  assert.equal(open.textContent, 'পেমেন্ট দেখুন');
  ctx.click(open);
  await ctx.flush();
  assert.equal(clicks.at(-1), 'cash-counter');
  assert.ok(!controller.feed().some(item => item.key === 'payment-review:T2'));
  const paper = controller.feed().find(item => item.kind === 'exam-review');
  await controller.openItem(paper);
  assert.equal(clicks.at(-1), 'exams');
});

test('a tray tap while the panel is still starting waits for it, and is not overwritten by its dashboard', async () => {
  const module = await import('../js/notifications.js');
  ctx.$('#managerShell').hidden = true;        // cold start: login still being verified
  clicks.length = 0;
  const opened = module.openNotificationTarget({ kind: 'payment-review', key: 'payment-review:none', id: 'none' });
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.deepEqual(clicks, [], 'nothing happens behind the lock');
  // The panel unlocks and shows its own first view in the same task.
  ctx.$('#managerShell').hidden = false;
  ctx.$('[data-manager-view="dashboard"]').click();
  assert.equal(await opened, true);
  assert.deepEqual(clicks, ['dashboard', 'cash-counter'], 'the notification’s view wins');
});

test('a decided fee entry leaves the list by itself', async () => {
  const list = JSON.parse(ctx.window.localStorage.getItem(KEYS.transactions)).map(tx => ({ ...tx, status: 'approved', reviewedAt: new Date().toISOString() }));
  ctx.window.localStorage.setItem(KEYS.transactions, JSON.stringify(list));
  controller.refresh();
  await ctx.flush();
  assert.ok(!controller.feed().some(item => item.kind === 'payment-review'));
});

test('the page booted without errors', () => {
  assert.deepEqual(ctx.jsdomErrors, []);
});
