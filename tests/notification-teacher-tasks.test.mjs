/* Teacher phone: a paper returned by the Manager (with reason) and a paper
   published are announced; the returned one opens the online-exams view. */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { KEYS, STAFF_KEYS } from '../js/database.js';

let ctx; let controller; let shown;
async function boot(page, accountKey, username, seed) {
  ctx = await loadPage(page);
  shown = [];
  class FakeNotification { constructor(title, options) { shown.push({ title, options: options || {} }); } close() {} }
  FakeNotification.permission = 'granted';
  FakeNotification.requestPermission = async () => 'granted';
  ctx.window.Notification = FakeNotification;
  const store = ctx.window.localStorage;
  store.setItem(accountKey, JSON.stringify({ username }));
  store.setItem(`activePlus.notifications.boot.v1:staff:${username}`, JSON.stringify({ version: 1, at: Date.now() - 60000 }));
  store.setItem(`activePlus.notifications.rules.v1:staff:${username}`, JSON.stringify({ version: 2, at: Date.now() - 60000 }));
  seed(store);
  controller = (await import('../js/notifications.js')).initNotifications();
  await ctx.flush();
}

const clicks = [];
before(async () => {
  await boot('teacher.html', STAFF_KEYS.teacherAccount, 'teacher.apc', store => {
    store.setItem(KEYS.exams, JSON.stringify({ version: 1, attempts: [], exams: [
      { id: 'P1', title: 'রসায়ন', status: 'pending', teacherId: 'T', startAt: Date.now() + 86400000, updatedAt: 1, submittedAt: 2, participants: [] }
    ] }));
  });
  ctx.$('#teacherShell').hidden = false;      // a signed-in teacher
  for (const button of ctx.$$('[data-panel-view]')) button.addEventListener('click', () => clicks.push(button.dataset.panelView));
});

test('a paper waiting for the Manager says nothing to the teacher', () => {
  assert.equal(shown.length, 0);
  assert.deepEqual(controller.feed(), []);
});

test('a returned paper is announced with its reason and opens the exam list', async () => {
  const db = JSON.parse(ctx.window.localStorage.getItem(KEYS.exams));
  Object.assign(db.exams[0], { status: 'rejected', reviewNote: 'প্রশ্ন ৩-এর উত্তর ভুল', reviewedAt: Date.now() });
  ctx.window.localStorage.setItem(KEYS.exams, JSON.stringify(db));
  controller.refresh();
  await ctx.flush();
  assert.equal(shown.at(-1).title, 'পরীক্ষা সংশোধনের জন্য ফেরত এসেছে');
  assert.match(shown.at(-1).options.body, /প্রশ্ন ৩-এর উত্তর ভুল/);
  ctx.click(ctx.$('#notificationButton'));
  const open = ctx.$('button[data-apc-notice-open^="exam-returned:P1:"]');
  assert.equal(open?.textContent, 'সংশোধন করুন');
  ctx.click(open);
  await ctx.flush();
  assert.equal(clicks.at(-1), 'online-exams');
});

test('a published paper is announced', async () => {
  const db = JSON.parse(ctx.window.localStorage.getItem(KEYS.exams));
  Object.assign(db.exams[0], { status: 'published', reviewNote: '', publishedAt: Date.now() });
  ctx.window.localStorage.setItem(KEYS.exams, JSON.stringify(db));
  controller.refresh();
  await ctx.flush();
  assert.equal(shown.at(-1).title, 'আপনার পরীক্ষা প্রকাশিত হয়েছে');
});

test('the page booted without errors', () => assert.deepEqual(ctx.jsdomErrors, []));
