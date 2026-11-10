/* New-registration notifications → review → decision (owner request 2026-09-30).
 *
 *   • Admin and Manager (never Teacher/Payment/students) get a "new
 *     registration" item for every pending student;
 *   • tapping it (inbox or tray) opens the review dialog directly;
 *   • looking at it clears it, "পরে দেখব" brings it back, a decision removes it
 *     for good; "সব খালি করুন" empties the whole list;
 *   • the Admin can approve/reject, exactly like the Manager. */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { ROSTER_KEY, NOTICES_KEY } from '../js/office-data.js';
import { provisionStaff, seedStaffSession } from './staff-harness.mjs';
import {
  registrationItems, notificationFeed, clearedRecord, planDeliveries, pushPayload
} from '../js/notification-rules.js';

const pending = (id, extra = {}) => ({
  id, name: `শিক্ষার্থী ${id}`, className: 'দশম শ্রেণি', group: 'বিজ্ঞান', mobile: '01700000000',
  status: 'pending', registeredAt: '2026-09-30T04:00:00.000Z', ...extra
});

/* ---- pure rules --------------------------------------------------------------- */

test('only Admin and Manager are told about a pending registration', () => {
  const roster = [pending('s1'), { ...pending('s2'), status: 'approved' }, { ...pending('s3'), status: 'rejected' }];
  for (const role of ['admin', 'manager']) {
    const items = registrationItems(roster, { kind: 'staff', role, username: role });
    assert.deepEqual(items.map(item => item.key), ['registration:s1'], `${role} sees exactly the pending one`);
    assert.equal(items[0].actionable, true);
    assert.equal(items[0].kind, 'registration');
    assert.match(items[0].body, /শিক্ষার্থী s1/);
    assert.equal(items[0].at, Date.parse('2026-09-30T04:00:00.000Z'));
  }
  for (const viewer of [{ kind: 'staff', role: 'teacher' }, { kind: 'staff', role: 'payment' }, { kind: 'student', studentId: 's1' }, null]) {
    assert.deepEqual(registrationItems(roster, viewer), [], 'nobody else is told');
  }
  assert.deepEqual(registrationItems('not a list', { kind: 'staff', role: 'admin' }), []);
});

test('a cleared item stays out of the feed and is never announced', () => {
  const viewer = { kind: 'staff', role: 'admin', username: 'admin' };
  const students = [pending('s1'), pending('s2')];
  const feed = notificationFeed({ students, viewer, cleared: ['registration:s1'] });
  assert.deepEqual(feed.map(item => item.key), ['registration:s2']);
  const plan = planDeliveries({ feed, seen: [] });
  assert.deepEqual(plan.notify.map(item => item.key), ['registration:s2']);
  // The tray payload carries what the click handler needs.
  assert.deepEqual(pushPayload(feed[0]).data, { collection: 'students', id: 's2', key: 'registration:s2', kind: 'registration' });
});

test('the cleared record forgets keys that no longer exist', () => {
  const record = clearedRecord(['a', 'b', 'a', '', 5], ['a']);
  assert.deepEqual(record.keys, ['a']);
  assert.equal(record.version, 1);
});

/* ---- the real Admin panel ------------------------------------------------------ */

let ctx;
let controller;
let shown;

const roster = () => JSON.parse(ctx.window.localStorage.getItem(ROSTER_KEY));
const feedKeys = () => controller.feed().map(item => item.key);
const dialog = () => ctx.$('#apcRegistrationReview');

before(async () => {
  ctx = await loadPage('admin.html', {
    seed: {
      'activePlus.demo.autofill.v1': 'off',
      [ROSTER_KEY]: JSON.stringify([
        pending('s260930001-abcd', { registeredAt: '2026-09-30T04:00:00.000Z' }),
        { ...pending('s260929001-efgh'), status: 'approved' }
      ]),
      [NOTICES_KEY]: JSON.stringify([])
    }
  });
  shown = [];
  class FakeNotification {
    constructor(title, options) { shown.push({ title, options: options || {} }); }
    close() {}
  }
  FakeNotification.permission = 'granted';
  FakeNotification.requestPermission = async () => 'granted';
  ctx.window.Notification = FakeNotification;
  await provisionStaff('admin');
  seedStaffSession(ctx.window, 'admin');
  // A device that already ran the engine announces at once.
  ctx.window.localStorage.setItem('activePlus.notifications.boot.v1:staff:admin.apc', JSON.stringify({ version: 1, at: Date.now() - 60000 }));
  ctx.window.localStorage.setItem('activePlus.notifications.rules.v1:staff:admin.apc', JSON.stringify({ version: 2, at: Date.now() - 60000 }));
  await import('../js/admin.js');
  await ctx.waitFor(() => ctx.$('#adminShell').hidden === false);
  const module = await import('../js/notifications.js');
  controller = module.initNotifications();
  await ctx.flush();
  await ctx.waitFor(() => Boolean(ctx.window.apcNoticeCenter));
});

test('a pending registration appears in the Admin bell and the device tray', async () => {
  assert.deepEqual(feedKeys(), ['registration:s260930001-abcd']);
  controller.refresh();
  await ctx.flush();
  assert.ok(shown.some(item => item.title === 'নতুন শিক্ষার্থী রেজিস্ট্রেশন'), 'a system notification is raised');
  ctx.window.apcNoticeCenter.paint();
  assert.equal(ctx.$('#notificationButton .notification-dot').hidden, false, 'the bell shows it until it is handled');
});

test('a registration arriving from another device is announced too', async () => {
  const store = ctx.window.localStorage;
  store.setItem(ROSTER_KEY, JSON.stringify([...roster(), pending('s260930002-ijkl', { registeredAt: '2026-09-30T05:00:00.000Z' })]));
  const before = shown.length;
  controller.refresh();
  await ctx.flush();
  assert.equal(shown.length, before + 1);
  assert.match(shown.at(-1).options.body, /s260930002-ijkl/);
  assert.equal(shown.at(-1).options.data.kind, 'registration');
});

test('tapping the item in the inbox opens the review and clears it', async () => {
  ctx.click(ctx.$('#notificationButton'));
  const modal = ctx.$('#apcNoticeModal');
  assert.equal(modal.hidden, false);
  const open = ctx.$('button[data-apc-notice-open="registration:s260930002-ijkl"]');
  assert.ok(open, 'the item offers review');
  ctx.click(open);
  const detail = ctx.$('[data-apc-notice-detail-sheet="registration:s260930002-ijkl"]');
  assert.ok(detail, 'registration opens its context detail first');
  ctx.click(detail.querySelector('[data-apc-notice-detail-action]'));
  await ctx.waitFor(() => Boolean(dialog()));
  assert.equal(modal.hidden, true, 'the list steps aside');
  assert.match(dialog().textContent, /s260930002-ijkl/);
  assert.match(dialog().textContent, /দশম শ্রেণি/);
  assert.ok(!feedKeys().includes('registration:s260930002-ijkl'), 'seen → cleared from the list');
  controller.refresh();   // a sync update while the dialog is open
  await ctx.flush();
});

test('"later" puts the notification back', async () => {
  ctx.click(dialog().querySelector('[data-review-later]'));
  assert.equal(dialog(), null);
  assert.ok(feedKeys().includes('registration:s260930002-ijkl'));
  const before = shown.length;
  // Beyond the 2-minute duplicate window the receipts alone must hold.
  ctx.window.localStorage.removeItem('activePlus.notifications.shown.v1');
  controller.refresh();
  await ctx.flush();
  assert.equal(shown.length, before, 'it is back in the list, but the phone is not buzzed again');
});

test('rejecting needs a reason; approving records the Admin decision', async () => {
  await controller.openItem({ kind: 'registration', sourceId: 's260930002-ijkl', key: 'registration:s260930002-ijkl' });
  await ctx.waitFor(() => Boolean(dialog()));
  ctx.click(dialog().querySelector('[data-review-decision="rejected"]'));
  assert.match(dialog().querySelector('[data-review-status]').textContent, /কারণ/);
  assert.equal(roster().find(row => row.id === 's260930002-ijkl').status, 'pending', 'nothing saved without a reason');

  let decided = null;
  ctx.window.addEventListener('apc-registration-decided', event => { decided = event.detail; }, { once: true });
  ctx.click(dialog().querySelector('[data-review-decision="approved"]'));
  await ctx.waitFor(() => dialog() === null);
  const row = roster().find(item => item.id === 's260930002-ijkl');
  assert.equal(row.status, 'approved');
  assert.equal(row.reviewedRole, 'admin');
  assert.ok(row.reviewedAt);
  assert.deepEqual(decided, { studentId: 's260930002-ijkl', decision: 'approved', role: 'admin' });
  assert.ok(!feedKeys().includes('registration:s260930002-ijkl'), 'a decided registration never returns');
  controller.restore('registration:s260930002-ijkl');
  assert.ok(!feedKeys().includes('registration:s260930002-ijkl'), 'not even when un-cleared: it is no longer pending');
});

test('the Admin student list offers review for pending rows only, and rejects with a reason', async () => {
  await ctx.waitFor(() => ctx.$$('#studentList [data-action="review-registration"]').length === 1);
  const button = ctx.$('#studentList [data-action="review-registration"]');
  assert.equal(button.dataset.id, 's260930001-abcd');
  ctx.click(button);
  await ctx.waitFor(() => Boolean(dialog()));
  dialog().querySelector('#apcReviewNote').value = 'তথ্য অসম্পূর্ণ';
  ctx.click(dialog().querySelector('[data-review-decision="rejected"]'));
  await ctx.waitFor(() => dialog() === null);
  const row = roster().find(item => item.id === 's260930001-abcd');
  assert.equal(row.status, 'rejected');
  assert.equal(row.reviewNote, 'তথ্য অসম্পূর্ণ');
  await ctx.waitFor(() => ctx.$$('#studentList [data-action="review-registration"]').length === 0);
  assert.deepEqual(feedKeys(), [], 'nothing left to decide');
});

test('a decided registration cannot be decided again', async () => {
  const { decideRegistration } = await import('../js/registration-review.js');
  const again = await decideRegistration('s260930001-abcd', 'approved', { role: 'admin' });
  assert.deepEqual([again.ok, again.reason], [false, 'already-decided']);
  const wrongRole = await decideRegistration('s260930001-abcd', 'approved', { role: 'teacher' });
  assert.deepEqual([wrongRole.ok, wrongRole.reason], [false, 'not-allowed']);
});

test('"clear all" empties the list, and it stays empty', async () => {
  ctx.window.localStorage.setItem(NOTICES_KEY, JSON.stringify([
    { id: 'N1', title: 'অফিস নোটিশ', body: 'মিটিং', status: 'published', createdAt: '2026-09-30T06:00:00.000Z' }
  ]));
  ctx.window.localStorage.setItem(ROSTER_KEY, JSON.stringify([...roster(), pending('s260930003-mnop')]));
  assert.equal(feedKeys().length, 2);
  ctx.click(ctx.$('#notificationButton'));
  const clear = ctx.$('#apcNoticeModal [data-apc-notice-clear]');
  assert.ok(clear && !clear.hidden, 'the clear button is offered');
  ctx.click(clear);
  assert.deepEqual(feedKeys(), []);
  assert.match(ctx.$('#apcNoticeModal [data-apc-notice-status]').textContent, /খালি/);
  assert.equal(clear.hidden, true);
  controller.refresh();
  await ctx.flush();
  assert.deepEqual(feedKeys(), [], 'a refresh does not bring cleared items back');
  // The pending student is still in the approval list — clearing hides the
  // reminder, not the task.
  assert.equal(roster().find(item => item.id === 's260930003-mnop').status, 'pending');
});

test('a tapped tray notification opens the review straight away', async () => {
  const module = await import('../js/notifications.js');
  ctx.window.localStorage.setItem(ROSTER_KEY, JSON.stringify([...roster(), pending('s260930004-qrst')]));
  await module.openNotificationTarget({ kind: 'registration', id: 's260930004-qrst', key: 'registration:s260930004-qrst' });
  await ctx.waitFor(() => Boolean(dialog()));
  assert.match(dialog().textContent, /s260930004-qrst/);
  ctx.click(dialog().querySelector('[data-review-close]'));
  assert.equal(dialog(), null);
  // An ordinary notice tap needs no dialog.
  assert.equal(await module.openNotificationTarget({ kind: 'notice', id: 'N1' }), false);
});

test('the panel booted without errors', () => {
  assert.deepEqual(ctx.jsdomErrors, []);
});
