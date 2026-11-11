/* Notification centre on a real page (jsdom): a notice that syncs in must raise
   a system notification, while a fresh device — and the person who typed the
   notice — must stay silent. jsdom has no Notification API, so a stand-in
   records what the page would have shown; no app logic is stubbed. */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { KEYS } from '../js/database.js';

const STUDENT_ID = 's260929001';
const BOOT_KEY = `activePlus.notifications.boot.v1:student:${STUDENT_ID}`;
const SEEN_KEY = `activePlus.notifications.seen.v1:student:${STUDENT_ID}`;

const oldNotice = {
  id: 'N0', title: 'পুরোনো নোটিশ', body: 'আগের খবর', audience: 'সকল শিক্ষার্থী',
  status: 'published', date: '২০ সেপ্টেম্বর', createdAt: '2026-09-20T04:00:00.000Z'
};
const freshNotice = {
  id: 'N1', title: 'আজকের ঘোষণা', body: 'বিকেল ৩টায় ক্লাস বন্ধ।', audience: 'শিক্ষার্থী ও অভিভাবক',
  status: 'published', date: 'আজ', createdAt: new Date(Date.now() - 60_000).toISOString()
};

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

  const store = ctx.window.localStorage;
  store.setItem(KEYS.account, JSON.stringify({ username: 'raisa.islam', student: { id: STUDENT_ID, name: 'রাইসা ইসলাম' } }));
  store.setItem(KEYS.notices, JSON.stringify([oldNotice]));
  // The device has run before: the existing notice is already part of the list.
  store.setItem(BOOT_KEY, JSON.stringify({ version: 1, at: Date.parse('2026-09-29T00:00:00.000Z') }));
  store.setItem(SEEN_KEY, JSON.stringify({ version: 1, at: 0, keys: [`notice:N0:${oldNotice.createdAt}`] }));

  const module = await import('../js/notifications.js');
  controller = module.initNotifications();
  // The permission pill was removed on purpose (no unsolicited banner; the
  // switch lives in the notice inbox). The controller itself is synchronous.
  await ctx.flush();
});

const seenKeys = () => JSON.parse(ctx.window.localStorage.getItem(SEEN_KEY)).keys;

test('the notices already on the device are not announced again', () => {
  assert.deepEqual(shown, []);
  assert.equal(controller.permission(), 'granted');
});

test('a notice that arrives from the other device raises a system notification', async () => {
  const store = ctx.window.localStorage;
  store.setItem(KEYS.notices, JSON.stringify([freshNotice, oldNotice]));
  ctx.window.dispatchEvent(new ctx.window.StorageEvent('storage', {
    key: KEYS.notices, newValue: store.getItem(KEYS.notices), storageArea: store, url: 'http://localhost/'
  }));
  await ctx.waitFor(() => shown.length === 1);
  assert.equal(shown[0].title, 'আজকের ঘোষণা');
  assert.match(shown[0].options.body, /বিকেল ৩টায়/);
  assert.equal(shown[0].options.tag, `notice:N1:${freshNotice.createdAt}`);
  assert.equal(shown[0].options.data.collection, 'notices');
  assert.ok(seenKeys().some(key => key.startsWith('notice:N1:')), 'the receipt is stored, so it is never repeated');
});

test('the same notice is never announced twice', async () => {
  controller.refresh();
  await ctx.flush();
  assert.equal(shown.length, 1);
});

test('the person who typed a notice is not notified about their own work', async () => {
  const { saveNotices } = await import('../js/office-data.js');
  const written = { ...freshNotice, id: 'N2', title: 'নিজের লেখা নোটিশ', createdAt: new Date(Date.now() - 30_000).toISOString() };
  saveNotices([written, freshNotice, oldNotice]);
  controller.refresh();
  await ctx.flush();
  assert.equal(shown.length, 1, 'still only the one that came from elsewhere');
  assert.ok(seenKeys().some(key => key.startsWith('notice:N2:')), 'it is recorded as seen, not repeated later');
});

test('with permission blocked the list still records what arrived', async () => {
  ctx.window.Notification.permission = 'denied';
  const store = ctx.window.localStorage;
  const blocked = { ...freshNotice, id: 'N3', title: 'অনুমতি ছাড়া নোটিশ', createdAt: new Date(Date.now() - 20_000).toISOString() };
  store.setItem(KEYS.notices, JSON.stringify([blocked, freshNotice, oldNotice]));
  controller.refresh();
  await ctx.flush();
  assert.equal(shown.length, 1, 'no system notification without permission');
  assert.ok(seenKeys().some(key => key.startsWith('notice:N3:')), 'but the app list stays correct');
});

test('the urgent announcement replaces the notice list on top', async () => {
  ctx.window.Notification.permission = 'granted';
  const store = ctx.window.localStorage;
  store.setItem(KEYS.settings, JSON.stringify({ broadcastAlert: true, broadcastMessage: 'আজ ক্লাস বন্ধ' }));
  controller.refresh();
  await ctx.flush();
  assert.equal(shown.length, 2);
  assert.equal(shown[1].title, 'জরুরি ঘোষণা');
  assert.match(shown[1].options.body, /ক্লাস বন্ধ/);
});

