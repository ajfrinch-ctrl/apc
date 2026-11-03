/* Notification rules: who is told what, when a fresh device stays silent, and
   what a push payload looks like. These are the decisions the whole feature
   rests on, so they are tested without a browser. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  notificationFeed, planDeliveries, seenRecord, markLocalSource, isSelfAuthored,
  pushPayload, pushTokenRecord, tokenPathKey, noticeItem, examItems, examReviewItems, staffExamItems,
  viewerKeyOf, audienceMatches, claimDelivery, MAX_BURST
} from '../js/notification-rules.js';

const student = { kind: 'student', studentId: 's260929001', username: 'raisa.islam', name: 'রাইসা' };
const manager = { kind: 'staff', role: 'manager', username: 'manager.apc' };
const admin = { kind: 'staff', role: 'admin', username: 'admin.apc' };

const notice = (overrides = {}) => ({
  id: 'N1', title: 'পরীক্ষার সময়সূচি', body: 'আগামী শুক্রবার মডেল টেস্ট।',
  audience: 'সকল শিক্ষার্থী', date: '২৯ সেপ্টেম্বর ২০২৬', status: 'published',
  createdAt: '2026-09-29T04:00:00.000Z', author: 'manager.apc', ...overrides
});

test('the feed carries notices, the urgent broadcast and this student exam news', () => {
  const feed = notificationFeed({
    notices: [notice()],
    config: { broadcastAlert: true, broadcastMessage: 'আজ ক্লাস বন্ধ' },
    examDb: { exams: [{ id: 'E1', title: 'মডেল টেস্ট ৩', subject: 'গণিত', status: 'published', startAt: Date.now() + 86400000, publishedAt: 111, participants: [{ id: student.studentId }] }] },
    viewer: student
  });
  assert.deepEqual(feed.map(item => item.kind).sort(), ['broadcast', 'exam', 'notice']);
  for (const item of feed) assert.ok(item.key && item.title, 'every item is addressable and readable');
});

test('editing a notice makes it newsworthy again (new revision key)', () => {
  const before = noticeItem(notice());
  const after = noticeItem(notice({ body: 'সময় বদলে হয়েছে', updatedAt: '2026-09-29T05:00:00.000Z' }));
  assert.notEqual(before.key, after.key);
  assert.equal(noticeItem(notice()).key, before.key, 'an untouched notice keeps one key');
});

test('a student device shows the student/guardian audiences, not an unknown one', () => {
  assert.equal(audienceMatches(notice(), student), true);
  assert.equal(audienceMatches(notice({ audience: 'শিক্ষার্থী ও অভিভাবক' }), student), true);
  assert.equal(audienceMatches(notice({ audience: 'শুধু শিক্ষক' }), student), false);
  assert.equal(audienceMatches(notice({ audience: 'শুধু শিক্ষক' }), manager), true, 'staff see everything');
});

test('exam news reaches participants only', () => {
  const examDb = {
    exams: [
      { id: 'E1', title: 'মডেল টেস্ট', subject: 'পদার্থ', status: 'published', startAt: Date.now() + 1000, publishedAt: 5, participants: [{ id: student.studentId }] },
      { id: 'E2', title: 'অন্য ক্লাসের পরীক্ষা', status: 'published', startAt: Date.now() + 1000, publishedAt: 5, participants: [{ id: 's260929999' }] }
    ]
  };
  const items = examItems(examDb, student);
  assert.equal(items.length, 1);
  assert.equal(items.some(item => item.key.includes('E2')), false);
  assert.deepEqual(examItems(examDb, manager), [], 'staff panels are not exam inboxes');
  const published = { exams: [{ ...examDb.exams[0], resultsPublished: true, resultsPublishedAt: 9 }] };
  assert.equal(examItems(published, student)[0].kind, 'result');
});

/* Audit round 6: an exam notification must always be findable in this list.
   The sender (functions/notification-payload.js) announces a published paper
   that is not over yet; the rule below is the client half of that contract. */
test('a paper the sender would announce is listed, and a finished one is not', () => {
  const now = 2_000_000;
  const base = { id: 'E3', title: 'নতুন পরীক্ষা', subject: 'ইংরেজি', status: 'published', publishedAt: 5, participants: [{ id: student.studentId }] };
  const view = exam => ({ exams: [exam] });

  const running = { ...base, startAt: now - 600_000, endAt: now + 600_000 };
  const runningItems = examItems(view(running), student, now);
  assert.equal(runningItems.length, 1, 'published while it runs: still worth announcing');
  assert.match(runningItems[0].body, /এখন চলছে/);

  const upcoming = { ...base, startAt: now + 600_000, endAt: now + 1_200_000 };
  assert.match(examItems(view(upcoming), student, now)[0].body, /শুরু/);

  const over = { ...base, startAt: now - 7_200_000, endAt: now - 3_600_000 };
  assert.deepEqual(examItems(view(over), student, now), [], 'a finished paper without results is not news');
  assert.deepEqual(examItems(view({ ...over, resultsPublished: true, resultsPublishedAt: now }), student, now)
    .map(item => item.kind), ['result'], 'but its results are');
});

test('pending exam review alerts reach Admin and Manager with role-correct destinations', () => {
  const examDb = { exams: [{
    id: 'E-REVIEW', title: 'HSC মডেল টেস্ট', className: 'দ্বাদশ',
    teacherName: 'Test Teacher', status: 'pending', submittedAt: 123456
  }] };
  const adminItems = examReviewItems(examDb, admin);
  const managerItems = examReviewItems(examDb, manager);
  assert.equal(adminItems.length, 1);
  assert.equal(managerItems.length, 1);
  assert.equal(adminItems[0].target, 'audit-exam');
  assert.equal(managerItems[0].target, 'exams');
  assert.equal(adminItems[0].audience, 'Admin/Manager');
  assert.deepEqual(examReviewItems(examDb, student), []);
  assert.equal(notificationFeed({ examDb, viewer: admin })[0].kind, 'exam-review');
});

test('Admin and Manager receive published-exam and result updates in their own panel', () => {
  const examDb = { exams: [{
    id: 'E-PUBLISHED', title: 'HSC প্রস্তুতি পরীক্ষা', status: 'published',
    publishedAt: 100, resultsPublished: true, resultsPublishedAt: 200
  }] };
  const adminItems = staffExamItems(examDb, admin);
  const managerItems = staffExamItems(examDb, manager);
  assert.deepEqual(adminItems.map(item => item.kind), ['exam-published', 'result-published']);
  assert.deepEqual(managerItems.map(item => item.kind), ['exam-published', 'result-published']);
  assert.ok(adminItems.every(item => item.target === 'audit-exam'));
  assert.ok(managerItems.every(item => item.target === 'exams'));
  assert.equal(adminItems[1].actionLabel, 'ফলাফল দেখুন');
  assert.deepEqual(notificationFeed({ examDb, viewer: admin }).map(item => item.kind),
    ['result-published', 'exam-published'], 'newest result update is first in the inbox');
});

test('a brand-new device records the existing list silently — no burst of old news', () => {
  const feed = notificationFeed({ notices: [notice(), notice({ id: 'N2', title: 'পুরোনো নোটিশ' })], viewer: student });
  const plan = planDeliveries({ feed, seen: [], firstRun: true });
  assert.deepEqual(plan.notify, []);
  assert.equal(plan.seen.length, 2, 'everything is marked seen instead');
});

test('later runs announce only what this device has not seen', () => {
  const first = noticeItem(notice());
  const second = noticeItem(notice({ id: 'N2', title: 'নতুন নোটিশ', createdAt: '2026-09-29T06:00:00.000Z' }));
  const plan = planDeliveries({ feed: [first, second], seen: [first.key] });
  assert.deepEqual(plan.notify.map(item => item.key), [second.key]);
  assert.equal(plan.seen.length, 2);
});

test('the person who typed the notice does not get their own notification', () => {
  const stamp = markLocalSource(null, 'notices', 'N2');
  const feed = notificationFeed({ notices: [notice({ id: 'N2', title: 'নিজের নোটিশ' })], viewer: manager, localWrites: stamp });
  const plan = planDeliveries({ feed, seen: [] });
  assert.deepEqual(plan.notify, [], 'self-authored is suppressed');
  assert.equal(isSelfAuthored(feed[0], stamp), true);
  assert.equal(isSelfAuthored(feed[0], stamp, Date.now() + 11 * 60 * 1000), false, 'the window closes');
});

test('a backlog is capped: at most a few notifications at a time', () => {
  const notices = Array.from({ length: 6 }, (unused, index) =>
    notice({ id: `N${index}`, title: `নোটিশ ${index}`, createdAt: `2026-09-29T0${index}:00:00.000Z` }));
  const feed = notificationFeed({ notices, viewer: student });
  const plan = planDeliveries({ feed, seen: [] });
  assert.equal(plan.notify.length, MAX_BURST);
  assert.equal(plan.seen.length, 6, 'the rest are still recorded as seen');
});

test('seen receipts are a rolling window, not an archive', () => {
  const notices = Array.from({ length: 12 }, (unused, index) => notice({ id: `N${index}` }));
  const feed = notificationFeed({ notices, viewer: student });
  const plan = planDeliveries({ feed, seen: [], maxSeen: 5 });
  assert.equal(plan.seen.length, 5);
  assert.equal(seenRecord(plan.seen).version, 1);
});

test('viewer keys and token node keys are stable, RTDB-safe and injective', () => {
  assert.equal(viewerKeyOf(student), 'student:s260929001');
  assert.equal(viewerKeyOf(manager), 'staff:manager.apc');
  const key = tokenPathKey('device.id[1]', student);
  assert.equal(/[.#$/[\]]/.test(key), false, 'RTDB forbids these characters in a key');
  assert.equal(tokenPathKey('device.id[1]', student), key, 'the same device always gets the same slot');
  /* Different devices must never share one slot: a lossy `-` replacement would
     let `dev.1` overwrite `dev-1`'s push token. */
  assert.notEqual(tokenPathKey('dev.1', manager), tokenPathKey('dev-1', manager));
  assert.notEqual(tokenPathKey('a/b', manager), tokenPathKey('a b', manager));
  assert.notEqual(key, tokenPathKey('device.id[1]', manager), 'one device, two roles: two records');
});

test('a push payload is short, tagged and carries no secret', () => {
  const payload = pushPayload(noticeItem(notice({ body: 'ক'.repeat(400) })));
  assert.ok(payload.body.length <= 140);
  assert.ok(payload.tag.startsWith('notice:N1:'));
  // No `url`: the device's own panel decides which page opens, so a payload can
  // never carry a link into another portal (tests/panel-lockdown.test.mjs).
  assert.deepEqual(Object.keys(payload.data).sort(), ['collection', 'id', 'key', 'kind']);
});

test('a device record holds a token, a role and an ID — nothing else', () => {
  const record = pushTokenRecord({ token: 'f'.repeat(120), viewer: student, deviceId: 'dev-1', platform: 'Android', at: 42 });
  assert.equal(record.role, 'student');
  assert.equal(record.studentId, 's260929001');
  assert.equal(record.updatedAt, 42);
  assert.deepEqual(Object.keys(record).sort(), ['deviceId', 'locale', 'notifications', 'platform', 'role', 'studentId', 'token', 'updatedAt', 'username']);
  assert.equal(pushTokenRecord({ token: 'short', viewer: student }), null, 'a placeholder is not a token');
});

test('the same event is displayed once, whichever path arrives first', () => {
  const at = Date.now();
  const first = claimDelivery(null, 'N1', at);
  assert.equal(first.claim, true);
  const second = claimDelivery(first.record, 'N1', at + 50);
  assert.equal(second.claim, false, 'the push and the sync bridge do not both alert');
  const later = claimDelivery(first.record, 'N1', at + 3 * 60 * 1000);
  assert.equal(later.claim, true, 'a genuinely new revision may alert again');
  assert.deepEqual(Object.keys(later.record), ['N1'], 'old entries are swept out');
});
