import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const entryPages = ['index.html', 'admin.html', 'manager.html', 'teacher.html', 'payment.html'];

test('every signed-in entry page loads the shared notification/sync bootstrap', () => {
  for (const file of entryPages) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(source, /js\\/realtime-sync-entry\\.js/, `${file} loads the shared sync entry`);
  }
  const shared = readFileSync(new URL('../js/realtime-sync-entry.js', import.meta.url), 'utf8');
  assert.match(shared, /function mountNotifications\\(\\)[\\s\\S]*?import\\('\\.\\/notifications\\.js'\\)/,
    'the shared sync entry lazy-loads notifications');
  assert.match(shared, /apc-session-ready[\\s\\S]*?mountNotifications\\(\\)/,
    'notifications mount after the session becomes ready');
});

test('notification module exposes the panel-safe initializer', () => {
  const source = readFileSync(new URL('../js/notifications.js', import.meta.url), 'utf8');
  assert.match(source, /export function initNotifications\\(/);
});
