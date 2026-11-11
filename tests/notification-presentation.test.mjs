import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NOTIFICATION_CATEGORIES, NOTIFICATION_PRIORITIES,
  NOTIFICATION_ARCHIVE_AFTER_DAYS, notificationCategory,
  notificationPriority, notificationPresentation, archiveState
} from '../js/notification-presentation.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 3, 12);

test('the six requested notification categories are stable and complete', () => {
  assert.deepEqual(NOTIFICATION_CATEGORIES.map(row => row.id),
    ['registration', 'exam', 'result', 'notice', 'chat', 'system']);
});

test('legacy event kinds map into the six categories without dropping events', () => {
  const cases = [
    ['registration', 'registration'], ['approved', 'registration'],
    ['exam-live', 'exam'], ['exam-review', 'exam'], ['result', 'result'],
    ['notice', 'notice'], ['broadcast', 'notice'], ['class-chat', 'chat'],
    ['payment-review', 'system'], ['homework', 'system'], ['birthday', 'system']
  ];
  for (const [kind, expected] of cases) assert.equal(notificationCategory({ kind }), expected, kind);
});

test('explicit valid categories take precedence; unknown categories fail safely to system', () => {
  assert.equal(notificationCategory({ kind: 'payment', category: 'notice' }), 'notice');
  assert.equal(notificationCategory({ kind: 'payment', category: 'not-a-category' }), 'system');
});

test('priority is deterministic and explicit valid priority wins', () => {
  assert.equal(notificationPriority({ kind: 'broadcast' }), 'urgent');
  assert.equal(notificationPriority({ kind: 'notice', category: 'urgent' }), 'urgent');
  assert.equal(notificationPriority({ kind: 'exam-live' }), 'urgent');
  assert.equal(notificationPriority({ kind: 'registration' }), 'important');
  assert.equal(notificationPriority({ kind: 'result' }), 'important');
  assert.equal(notificationPriority({ kind: 'chat' }), 'normal');
  assert.equal(notificationPriority({ kind: 'chat', priority: 'urgent' }), 'urgent');
  assert.equal(notificationPriority({ kind: 'broadcast', priority: 'normal' }), 'normal');
  assert.equal(NOTIFICATION_PRIORITIES.length, 3);
});

test('presentation provides matching category and priority labels', () => {
  assert.deepEqual(notificationPresentation({ kind: 'result' }), {
    category: 'result', categoryLabel: 'ফলাফল', priority: 'important', priorityLabel: 'গুরুত্বপূর্ণ'
  });
});

test('30-day retention archives old records without deleting or changing read state', () => {
  const old = { key: 'notice:old', at: NOW - 31 * DAY, read: false };
  const archived = archiveState(old, NOW);
  assert.equal(archived.archived, true);
  assert.equal(archived.read, false);
  assert.equal(archived.key, old.key);
  assert.equal(old.archived, undefined, 'the input record is not mutated');
  assert.equal(archiveState({ key: 'notice:new', at: NOW - 29 * DAY }, NOW).archived, undefined);
  assert.equal(archiveState({ key: 'notice:edge', at: NOW - 30 * DAY }, NOW).archived, true);
  assert.equal(NOTIFICATION_ARCHIVE_AFTER_DAYS, 30);
});

test('pending approval records stay active after 30 days until acknowledged', () => {
  const pending = { key: 'registration:pending', type: 'registration', at: NOW - 90 * DAY, read: false };
  assert.equal(archiveState(pending, NOW), pending);
  assert.equal(archiveState({ ...pending, read: true }, NOW).archived, true);
});

test('archived records remain archived and records without a usable date are preserved', () => {
  const existing = { key: 'notice:archived', archived: true, archivedAt: '2026-10-01T00:00:00.000Z' };
  assert.equal(archiveState(existing, NOW), existing);
  const undated = { key: 'notice:undated', read: true };
  assert.equal(archiveState(undated, NOW), undated);
});
