import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mountNotificationHistory } from '../js/notification-history.js';

test('History is a full-page searchable view with category and priority filters', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.test/student.html' });
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  const source = [
    { key: 'notice:old', type: 'notice', category: 'notice', priority: 'normal', title: 'পুরোনো নোটিশ', message: 'শীতকালীন ছুটি', at: Date.UTC(2026, 0, 1), read: false, targetType: 'notice-board' },
    { key: 'result:old', type: 'result', category: 'result', priority: 'important', title: 'ফলাফল প্রকাশ', message: 'পরীক্ষার ফল', at: Date.UTC(2026, 0, 2), read: true, targetType: 'exams' }
  ];
  const calls = { read: [], unread: [], opened: 0, all: 0 };
  const api = {
    history: () => source,
    markRead: keys => { calls.read.push(...keys); },
    markUnread: keys => { calls.unread.push(...keys); },
    markAllRead: () => { calls.all += 1; },
    openItem: () => { calls.opened += 1; }
  };
  try {
    const history = mountNotificationHistory(api);
    history.open();
    const root = document.querySelector('[data-apc-notification-history]');
    assert.ok(root && !root.hidden);
    assert.match(root.textContent, /নোটিফিকেশন হিস্টোরি/);
    assert.equal(root.querySelectorAll('[data-apc-history-open]').length, 2);

    const category = root.querySelector('[data-apc-history-category]');
    category.value = 'result';
    category.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.equal(root.querySelectorAll('[data-apc-history-open]').length, 1);
    assert.match(root.querySelector('[data-apc-history-open]').textContent, /ফলাফল প্রকাশ/);

    category.value = 'all';
    category.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    const card = root.querySelector('[data-apc-history-open="notice:old"]');
    card.click();
    assert.deepEqual(calls.read, ['notice:old']);
    assert.match(root.querySelector('[data-apc-history-detail]').textContent, /শীতকালীন ছুটি/);

    root.querySelector('[data-apc-history-open-target]').click();
    assert.equal(calls.opened, 1);
    assert.equal(root.hidden, true);
    history.open();
    root.querySelector('[data-apc-history-read-all]').click();
    assert.equal(calls.read.length, 2, 'History marks its archived unread records as read');
    assert.equal(calls.all, 0, 'History does not mark active inbox records read');
    history.close();
    assert.equal(root.hidden, true);
  } finally {
    dom.window.close();
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  }
});
