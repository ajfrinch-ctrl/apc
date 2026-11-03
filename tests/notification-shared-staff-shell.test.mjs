/* The staff notification inbox is one shared surface, not four role-specific copies. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const STAFF_PAGES = ['admin.html', 'manager.html', 'teacher.html', 'payment.html'];

test('all staff roles expose the same notification bell and shared stylesheet', async () => {
  for (const page of STAFF_PAGES) {
    const html = await readFile(new URL('../' + page, import.meta.url), 'utf8');
    assert.match(html, /css\/notifications\.css\?v=459/, page + ' must load the shared notification styles');
    assert.match(html, /id="notificationButton"/, page + ' must expose the shared bell control');
    assert.match(html, /aria-label="নোটিফিকেশন দেখুন"/, page + ' must keep the accessible bell label');
  }
});

test('one notification centre owns the shared modal, filters, list and read action', async () => {
  const source = await readFile(new URL('../js/notice-center.js', import.meta.url), 'utf8');
  for (const contract of [
    'export function mountNoticeCenter(api)',
    'id="apcNoticeTitle"',
    'data-apc-notice-filter="all"',
    'data-apc-notice-filter="unread"',
    'data-apc-notice-list',
    'data-apc-notice-read-all',
    'data-apc-notice-settings',
    'function readAll()'
  ]) {
    assert.ok(source.includes(contract), 'shared inbox contract missing: ' + contract);
  }
  assert.match(source, /const PAGE_SIZE = 40/, 'the shared inbox keeps bounded initial rendering');
  assert.match(source, /(?:function reviewerRole\(\)|const reviewerRole\s*=\s*\(\)\s*=>)/, 'reviewer-only registration queue remains role-gated');
});
