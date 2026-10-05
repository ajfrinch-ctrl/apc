/* Sender rules (functions/notification-payload.js): when a push may be sent at
   all. They are pure functions, so a wrong "send on every write" regression is
   caught here instead of on the phones. */
import test from 'node:test';
import assert from 'node:assert/strict';
import payload from '../functions/notification-payload.js';

const { noticePush, broadcastPush, examPushes, chunkTokens, tokensToPrune, messageFor } = payload;

const published = {
  id: 'N1', title: 'পরীক্ষার সময়সূচি', body: 'আগামী শুক্রবার মডেল টেস্ট।',
  audience: 'সকল শিক্ষার্থী', status: 'published', createdAt: '2026-09-29T04:00:00.000Z'
};

test('only a newly published notice is pushed', () => {
  assert.equal(noticePush(null, { ...published, status: 'draft' }), null, 'a draft stays internal');
  const push = noticePush(null, published);
  assert.equal(push.kind, 'notice');
  assert.match(push.title, /পরীক্ষার সময়সূচি/);
  assert.equal(push.data.collection, 'notices');
  assert.equal(push.data.id, 'N1');
});

test('a background write on an unchanged notice does not push again', () => {
  assert.equal(noticePush(published, { ...published }), null);
  assert.ok(noticePush(published, { ...published, body: 'নতুন সময়' }), 'edited text notifies again');
  assert.equal(noticePush(published, null), null, 'a deletion cannot un-send a notification');
});

test('the urgent announcement pushes once per message', () => {
  assert.equal(broadcastPush(null, { broadcastAlert: false, broadcastMessage: 'x' }), null);
  assert.equal(broadcastPush(null, { broadcastAlert: true, broadcastMessage: '   ' }), null);
  const first = broadcastPush(null, { broadcastAlert: true, broadcastMessage: 'আজ ক্লাস বন্ধ' });
  assert.equal(first.kind, 'broadcast');
  assert.equal(broadcastPush({ broadcastAlert: true, broadcastMessage: 'আজ ক্লাস বন্ধ' }, { broadcastAlert: true, broadcastMessage: 'আজ ক্লাস বন্ধ' }), null);
  assert.ok(broadcastPush({ broadcastAlert: true, broadcastMessage: 'পুরোনো' }, { broadcastAlert: true, broadcastMessage: 'নতুন খবর' }));
});

test('exam news goes only to that paper participants', () => {
  const exam = {
    id: 'E1', title: 'মডেল টেস্ট ৩', subject: 'গণিত', status: 'draft',
    participants: [{ id: 's260929001' }, { id: 's260929002' }]
  };
  assert.deepEqual(examPushes(null, exam), [], 'an unpublished paper is not announced');
  const announced = examPushes(exam, { ...exam, status: 'published', publishedAt: 100 });
  assert.equal(announced.length, 1);
  assert.deepEqual(announced[0].studentIds, ['s260929001', 's260929002']);
  const results = examPushes({ ...exam, status: 'published', resultsPublished: false }, { ...exam, status: 'published', resultsPublished: true, resultsPublishedAt: 200 });
  assert.equal(results.length, 1);
  assert.equal(results[0].kind, 'result');
  assert.deepEqual(examPushes(null, { ...exam, participants: [] }), [], 'nobody to tell');
});

test('a newly published running MCQ push carries the paper title and an immediate action', () => {
  const now = 1_000_000;
  const exam = {
    id: 'E10', title: 'মডেল টেস্ট ৩', subject: 'গণিত', type: 'mcq', status: 'published',
    startAt: now - 60_000, endAt: now + 600_000, lateMinutes: 5, publishedAt: 7,
    participants: [{ id: 's1' }]
  };
  const [push] = examPushes(null, exam, now);
  assert.equal(push.title, 'মডেল টেস্ট ৩');
  assert.equal(push.actionLabel, 'এখনই পরীক্ষা দিন');
  const message = messageFor('device-token', push);
  assert.equal(message.notification.title, 'মডেল টেস্ট ৩');
  assert.deepEqual(message.webpush.notification.actions, [{ action: 'open', title: 'এখনই পরীক্ষা দিন' }]);
});

/* Audit round 6: the sender must not announce a paper the app cannot list.
   The client shows papers that are not over yet and results that are out
   (js/notification-rules.js stillOpenExam), so the sender follows the same
   rule — otherwise the phone shows a notification that leads nowhere. */
test('an exam the app cannot list is never pushed', () => {
  const now = 1_000_000;
  const ended = {
    id: 'E9', title: 'পুরোনো পরীক্ষা', subject: 'গণিত', status: 'published',
    startAt: now - 7_200_000, endAt: now - 3_600_000, publishedAt: 5,
    participants: [{ id: 's1' }]
  };
  assert.deepEqual(examPushes(null, ended, now), [], 'a paper that is over and has no results stays quiet');
  assert.deepEqual(
    examPushes(null, { ...ended, resultsPublished: true, resultsPublishedAt: now }, now),
    [{ kind: 'result', title: 'ফলাফল প্রকাশিত হয়েছে', body: 'পুরোনো পরীক্ষা — গণিত পরীক্ষার ফলাফল এখন অ্যাপে দেখা যাচ্ছে।', studentIds: ['s1'], data: { collection: 'exams', id: 'E9', kind: 'result' } }],
    'results are still announced, and only as results'
  );

  const running = { ...ended, id: 'E10', startAt: now - 600_000, endAt: now + 600_000, publishedAt: 7 };
  assert.equal(examPushes({ ...running, status: 'draft' }, running, now).length, 1,
    'a paper published after it started is still news while it runs');
});

test('recipients are batched at 500 and dead tokens are found', () => {
  assert.deepEqual(chunkTokens(Array.from({ length: 1200 }, (unused, index) => `t${index}`)).map(chunk => chunk.length), [500, 500, 200]);
  const tokens = ['a', 'b', 'c'];
  const results = { responses: [{ success: true }, { success: false, error: { code: 'messaging/registration-token-not-registered' } }, { success: false, error: { code: 'messaging/internal-error' } }] };
  assert.deepEqual(tokensToPrune(results, tokens), ['b'], 'a temporary failure keeps its token');
});

test('a pushed message and an in-app item read the same', () => {
  const message = messageFor('token-1', { title: 'নতুন নোটিশ: ক', body: 'খ', data: { collection: 'notices', id: 'N1', key: 'notice:N1:1', kind: 'notice' } });
  assert.equal(message.token, 'token-1');
  assert.deepEqual(message.notification, { title: 'নতুন নোটিশ: ক', body: 'খ' });
  assert.equal(message.data.id, 'N1');
  // A pushed message carries no page link at all: the device's own service
  // worker opens the panel that belongs to it.
  assert.equal('fcmOptions' in message.webpush, false);
  assert.equal(/index\.html/.test(JSON.stringify(message)), false);
});
