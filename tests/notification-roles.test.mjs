/* "All necessary notifications" (owner request 2026-09-30) — the pure rules.
 *
 *   Student : registration approved/rejected · exam starts in 10 min · exam
 *             started · fee confirmed   (plus the existing notices, urgent
 *             broadcast, new exam, result)
 *   Manager : new registration · fee entry to approve · paper to approve
 *   Admin   : new registration · pending/published exam and result updates
 *   Teacher : paper returned with reason · paper published
 *   Payment : entry rejected with reason                                      */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXAM_REMINDER_MS, examTimingItems, nextExamBoundary, notificationFeed, studentDecisionItems,
  studentPaymentItems, paymentReviewItems, paymentRejectedItems, examReviewItems, teacherExamItems
} from '../js/notification-rules.js';

const student = { kind: 'student', studentId: 's1', username: 'rahim' };
const staff = role => ({ kind: 'staff', role, username: `${role}.apc` });
const MIN = 60 * 1000;
const START = Date.parse('2026-10-01T10:00:00.000Z');
const exam = (extra = {}) => ({
  id: 'E1', title: 'গণিত সাপ্তাহিক', subject: 'গণিত', status: 'published', startAt: START, endAt: START + 30 * MIN,
  publishedAt: START - 86400000, participants: [{ id: 's1', name: 'রহিম', className: 'দশম' }], ...extra
});

test('student hears the decision on their own registration only', () => {
  const approved = studentDecisionItems([{ id: 's1', status: 'approved', reviewedAt: '2026-09-30T08:00:00Z' }], student);
  assert.equal(approved.length, 1);
  assert.equal(approved[0].title, 'রেজিস্ট্রেশন অনুমোদিত হয়েছে');
  const rejected = studentDecisionItems([{ id: 's1', status: 'rejected', reviewedAt: '2026-09-30T08:00:00Z', reviewNote: 'ছবি নেই' }], student);
  assert.match(rejected[0].body, /ছবি নেই/);
  assert.deepEqual(studentDecisionItems([{ id: 's2', status: 'approved', reviewedAt: 'x' }], student), [], 'not someone else');
  assert.deepEqual(studentDecisionItems([{ id: 's1', status: 'approved' }], student), [], 'an old row without a review stays quiet');
  assert.deepEqual(studentDecisionItems([{ id: 's1', status: 'pending', reviewedAt: 'x' }], student), []);
  assert.deepEqual(studentDecisionItems([{ id: 's1', status: 'approved', reviewedAt: 'x' }], staff('admin')), []);
});

test('an exam reminds 10 minutes before and announces the start', () => {
  const db = { exams: [exam()], attempts: [] };
  assert.deepEqual(examTimingItems(db, student, START - EXAM_REMINDER_MS - MIN), [], 'too early');
  const soon = examTimingItems(db, student, START - 7 * MIN);
  assert.equal(soon.length, 1);
  assert.equal(soon[0].kind, 'exam-soon');
  assert.match(soon[0].body, /7 মিনিট পর শুরু/);
  assert.equal(soon[0].target, 'exams');
  const live = examTimingItems(db, student, START + MIN);
  assert.equal(live[0].kind, 'exam-live');
  assert.match(live[0].title, /শুরু হয়েছে/);
  assert.notEqual(live[0].key, soon[0].key, 'the start is a separate notification');
  assert.deepEqual(examTimingItems(db, student, START + 31 * MIN), [], 'over');
});

test('exam timing respects participants, attempts and status', () => {
  const at = START + MIN;
  assert.deepEqual(examTimingItems({ exams: [exam({ participants: [] })] }, student, at), [], 'not a participant');
  for (const status of ['active', 'queued', 'submitted']) {
    assert.deepEqual(examTimingItems({ exams: [exam()], attempts: [{ examId: 'E1', studentId: 's1', status }] }, student, at), [], `already ${status}`);
  }
  assert.equal(examTimingItems({ exams: [exam()], attempts: [{ examId: 'E1', studentId: 's9', status: 'submitted' }] }, student, at).length, 1, 'another student’s attempt does not count');
  for (const status of ['draft', 'pending', 'rejected']) {
    assert.deepEqual(examTimingItems({ exams: [exam({ status })] }, student, at), [], `${status} is not announced`);
  }
  assert.deepEqual(examTimingItems({ exams: [exam()] }, staff('teacher'), at), []);
});

test('the next exam moment drives the reminder timer', () => {
  const db = { exams: [exam()] };
  assert.equal(nextExamBoundary(db, student, START - 60 * MIN), START - EXAM_REMINDER_MS);
  assert.equal(nextExamBoundary(db, student, START - 5 * MIN), START);
  assert.equal(nextExamBoundary(db, student, START + MIN), START + 30 * MIN);
  assert.equal(nextExamBoundary(db, student, START + 60 * MIN), 0);
  assert.equal(nextExamBoundary(db, { kind: 'student', studentId: 'other' }, START - 60 * MIN), 0);
});

const tx = (extra = {}) => ({
  id: 'T1', receiptNo: 'R1', studentId: 's1', studentName: 'রহিম', feeType: 'মাসিক বেতন', month: 'অক্টোবর ২০২৬',
  amount: 1500, status: 'pending', recordedAt: START, ...extra
});

test('a student is told when a fee is confirmed, and only their own', () => {
  assert.deepEqual(studentPaymentItems([tx()], student), [], 'pending is not confirmed yet');
  const confirmed = studentPaymentItems([tx({ status: 'approved', reviewedAt: '2026-10-01T11:00:00Z' })], student);
  assert.equal(confirmed[0].title, 'ফি জমা নিশ্চিত হয়েছে');
  assert.match(confirmed[0].body, /৳1500/);
  assert.match(confirmed[0].body, /R1/);
  assert.match(confirmed[0].body, /অক্টোবর ২০২৬/);
  assert.deepEqual(studentPaymentItems([tx({ status: 'approved', reviewedAt: 'x', studentId: 's2' })], student), []);
  assert.deepEqual(studentPaymentItems([tx({ status: 'approved' })], student), [], 'legacy entries without a review stay quiet');
});

test('the Manager is asked to approve fee entries; the counter hears rejections', () => {
  const review = paymentReviewItems([tx(), tx({ id: 'T2', status: 'approved' })], staff('manager'));
  assert.deepEqual(review.map(item => item.key), ['payment-review:T1']);
  assert.equal(review[0].actionable, true);
  assert.equal(review[0].target, 'cash-counter');
  for (const role of ['admin', 'teacher', 'payment']) assert.deepEqual(paymentReviewItems([tx()], staff(role)), []);
  assert.deepEqual(paymentReviewItems([tx()], student), []);

  const rejected = paymentRejectedItems([tx({ status: 'rejected', reviewedAt: '2026-10-01T11:00:00Z', reviewNote: 'ভুল মাস' })], staff('payment'));
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].body, /ভুল মাস/);
  assert.deepEqual(paymentRejectedItems([tx({ status: 'rejected' })], staff('manager')), []);
});

test('the Manager is asked to approve papers; the teacher hears the answer', () => {
  const db = { exams: [exam({ id: 'P1', status: 'pending', updatedAt: 5, className: 'দশম', teacherName: 'করিম' })] };
  const review = examReviewItems(db, staff('manager'));
  assert.equal(review.length, 1);
  assert.equal(review[0].actionable, true);
  assert.match(review[0].body, /করিম/);
  assert.deepEqual(examReviewItems(db, staff('teacher')), []);

  const returned = teacherExamItems({ exams: [exam({ status: 'rejected', reviewNote: 'প্রশ্ন ৩ ভুল', updatedAt: 9 })] }, staff('teacher'));
  assert.equal(returned[0].kind, 'exam-returned');
  assert.match(returned[0].body, /প্রশ্ন ৩ ভুল/);
  const again = teacherExamItems({ exams: [exam({ status: 'rejected', reviewNote: 'প্রশ্ন ৩ ভুল', updatedAt: 9, reviewedAt: 50 })] }, staff('teacher'));
  assert.notEqual(again[0].key, returned[0].key, 'returned a second time with the same reason is new');
  const resent = examReviewItems({ exams: [exam({ id: 'P1', status: 'pending', updatedAt: 5, submittedAt: 70 })] }, staff('manager'));
  assert.notEqual(resent[0].key, review[0].key, 'an unchanged paper sent again is a new request');
  const published = teacherExamItems({ exams: [exam()] }, staff('teacher'));
  assert.equal(published[0].kind, 'exam-approved');
  assert.deepEqual(teacherExamItems({ exams: [exam({ resultsPublished: true })] }, staff('teacher')), []);
  assert.deepEqual(teacherExamItems({ exams: [exam({ status: 'rejected' })] }, staff('manager')), []);
});

test('each person’s feed contains only their own kinds', () => {
  const data = {
    students: [{ id: 's1', status: 'approved', reviewedAt: '2026-09-30T08:00:00Z' }, { id: 's5', status: 'pending', name: 'নতুন' }],
    transactions: [tx(), tx({ id: 'T3', status: 'approved', reviewedAt: '2026-10-01T11:00:00Z' }), tx({ id: 'T4', status: 'rejected', reviewedAt: '2026-10-01T12:00:00Z' })],
    examDb: { exams: [exam(), exam({ id: 'P2', status: 'pending', updatedAt: 1 }), exam({ id: 'P3', status: 'rejected', updatedAt: 2 })], attempts: [] },
    now: START + MIN
  };
  const kinds = viewer => [...new Set(notificationFeed({ ...data, viewer }).map(item => item.kind))].sort();
  assert.deepEqual(kinds(student), ['approved', 'exam', 'exam-live', 'payment']);
  assert.deepEqual(kinds(staff('admin')), ['exam-published', 'exam-review', 'registration']);
  assert.deepEqual(kinds(staff('manager')), ['exam-published', 'exam-review', 'payment-review', 'registration']);
  assert.deepEqual(kinds(staff('teacher')), ['exam-approved', 'exam-returned']);
  assert.deepEqual(kinds(staff('payment')), ['payment-rejected']);
});
