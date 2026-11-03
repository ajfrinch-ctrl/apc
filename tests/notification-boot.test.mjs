import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const entryFiles = ['admin.js', 'manager.js', 'teacher.js', 'payment.js', 'main.js'];

test('shared notification center is lazy-loaded after each panel session is ready', () => {
  for (const file of entryFiles) {
    const source = readFileSync(new URL(`../js/${file}`, import.meta.url), 'utf8');
    assert.match(
      source,
      /dispatchEvent\(new Event\('apc-session-ready'\)\);\s*void import\('\.\/notifications\.js'\)/,
      `${file} should start the shared notification center after authentication`
    );
  }
});

test('notification module exposes the panel-safe initializer', () => {
  const source = readFileSync(new URL('../js/notifications.js', import.meta.url), 'utf8');
  assert.match(source, /export function initNotifications\(/);
});
