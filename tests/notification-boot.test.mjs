import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const entryPages = ['index.html', 'admin.html', 'manager.html', 'teacher.html', 'payment.html'];

test('every signed-in entry page loads the shared notification/sync bootstrap', () => {
  for (const file of entryPages) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.ok(source.includes('js/realtime-sync-entry.js'), `${file} loads the shared sync entry`);
  }
  const shared = readFileSync(new URL('../js/realtime-sync-entry.js', import.meta.url), 'utf8');
  assert.ok(shared.includes('function mountNotifications()'), 'the shared sync entry has a notification loader');
  assert.ok(shared.includes("import('./notifications.js')"), 'the shared sync entry lazy-loads notifications');
  assert.ok(shared.includes("window.addEventListener('apc-session-ready'"), 'the loader listens for session readiness');
  assert.ok(shared.includes('mountNotifications();'), 'notifications mount after the session becomes ready');
});

test('notification module exposes the panel-safe initializer', () => {
  const source = readFileSync(new URL('../js/notifications.js', import.meta.url), 'utf8');
  assert.ok(source.includes('export function initNotifications('));
});
