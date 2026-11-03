/* A brand-new device must not replay the whole notice history as a burst of
   notifications, and it must start announcing as soon as the first cloud load
   is finished. */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { KEYS } from '../js/database.js';

const STUDENT_ID = 's260929777';
const notices = [
  { id: 'A', title: 'পুরোনো ১', body: 'এক', audience: 'সকল শিক্ষার্থী', status: 'published', createdAt: '2026-09-01T04:00:00.000Z' },
  { id: 'B', title: 'পুরোনো ২', body: 'দুই', audience: 'সকল শিক্ষার্থী', status: 'published', createdAt: '2026-09-10T04:00:00.000Z' },
  { id: 'C', title: 'পুরোনো ৩', body: 'তিন', audience: 'সকল শিক্ষার্থী', status: 'published', createdAt: '2026-09-20T04:00:00.000Z' }
];

let ctx;
let controller;
let shown;

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
  ctx.window.localStorage.setItem(KEYS.account, JSON.stringify({ username: 'new.student', student: { id: STUDENT_ID, name: 'নতুন শিক্ষার্থী' } }));
  ctx.window.localStorage.setItem(KEYS.notices, JSON.stringify(notices));
  const module = await import('../js/notifications.js');
  controller = module.initNotifications();
  // The permission pill was removed on purpose; the controller is synchronous.
  await ctx.flush();
  await ctx.flush();
});

test('installing the app does not replay old notices', () => {
  assert.deepEqual(shown, []);
  const seen = JSON.parse(ctx.window.localStorage.getItem(`activePlus.notifications.seen.v1:student:${STUDENT_ID}`)).keys;
  assert.equal(seen.length, 3, 'the existing list is recorded silently');
  assert.ok(ctx.window.localStorage.getItem(`activePlus.notifications.boot.v1:student:${STUDENT_ID}`), 'the device remembers it started here');
});

test('once the first cloud load is done, the next notice is announced', async () => {
  // The real page gets this from js/sync-status.js when the first sync pass ends.
  ctx.window.dispatchEvent(new ctx.window.CustomEvent('apc-sync-status', { detail: { state: 'online' } }));
  await ctx.flush();
  assert.equal(shown.length, 0, 'arming itself announces nothing');

  const fresh = { id: 'D', title: 'নতুন ঘোষণা', body: 'আগামীকাল ছুটি', audience: 'সকল শিক্ষার্থী', status: 'published', createdAt: new Date(Date.now() - 60_000).toISOString() };
  const store = ctx.window.localStorage;
  store.setItem(KEYS.notices, JSON.stringify([fresh, ...notices]));
  ctx.window.dispatchEvent(new ctx.window.StorageEvent('storage', {
    key: KEYS.notices, newValue: store.getItem(KEYS.notices), storageArea: store, url: 'http://localhost/'
  }));
  await ctx.waitFor(() => shown.length === 1);
  assert.equal(shown[0].title, 'নতুন ঘোষণা');
});
