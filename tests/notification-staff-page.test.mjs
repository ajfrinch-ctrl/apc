/* The notification centre also runs on the staff panels (it is mounted from
   js/realtime-sync-entry.js, which every page loads). A Manager device must be
   recognised as staff and must receive notices published from another device. */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { KEYS, STAFF_KEYS } from '../js/database.js';

let ctx;
let controller;
let shown;

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
  ctx.window.localStorage.setItem(STAFF_KEYS.managerAccount, JSON.stringify({ username: 'manager.apc', fullName: 'ম্যানেজার' }));
  ctx.window.localStorage.setItem('activePlus.notifications.boot.v1:staff:manager.apc', JSON.stringify({ version: 1, at: Date.now() - 60000 }));
  ctx.window.localStorage.setItem(KEYS.notices, JSON.stringify([]));
  const module = await import('../js/notifications.js');
  controller = module.initNotifications();
  // The permission pill was removed on purpose (no unsolicited banner; the
  // switch lives in the notice inbox). The controller itself is synchronous.
  await ctx.flush();
});

test('a staff panel knows which person is using it', () => {
  assert.deepEqual(controller.viewer(), { kind: 'staff', role: 'manager', username: 'manager.apc', name: 'ম্যানেজার', assignedClasses: [] });
  assert.equal(controller.viewerKey(), 'staff:manager.apc');
});

test('a notice published elsewhere reaches the staff device too', async () => {
  const notice = {
    id: 'N1', title: 'অফিসের নোটিশ', body: 'সকাল ১০টায় মিটিং', audience: 'সকল শিক্ষার্থী',
    status: 'published', date: '২৯ সেপ্টেম্বর', createdAt: '2026-09-29T10:00:00.000Z'
  };
  ctx.window.localStorage.setItem(KEYS.notices, JSON.stringify([notice]));
  controller.refresh();
  await ctx.waitFor(() => shown.length === 1);
  assert.equal(shown[0].title, 'অফিসের নোটিশ');
  assert.match(shown[0].options.body, /মিটিং/);
});
