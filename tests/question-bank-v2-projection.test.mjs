import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  buildStudentQuestionProjection,
  buildTeacherQuestionProjection,
  buildQuestionBankFanout,
  normalizeQuestionRecord,
  questionMatchesExamPaper,
  advanceDraftAfterPublish,
  canonicalJSON
} = require('../functions/question-bank-projection.js');

const NOW = Date.UTC(2026, 9, 7, 6, 0, 0);
const question = (overrides = {}) => ({
  id: 'Q-1', code: 'Q-1', className: 'দশম শ্রেণি', subject: 'গণিত', group: '',
  type: 'mcq', difficulty: 'medium', text: '২ + ২ = কত?',
  options: [
    { id: 'A', text: '১' }, { id: 'B', text: '২' },
    { id: 'C', text: '৪' }, { id: 'D', text: '৫' }
  ],
  answer: 'C', answerText: '', marks: 1, source: null, tags: [],
  createdBy: 'Teacher', createdAt: NOW - 1000, updatedBy: 'Teacher', updatedAt: NOW - 1000,
  active: true, ...overrides
});
const student = (overrides = {}) => ({
  id: 'S-1', status: 'approved', className: 'দশম শ্রেণি', group: '', ...overrides
});
const assignment = (overrides = {}) => ({
  id: 'AS-1', teacherId: 'T-1', className: 'দশম শ্রেণি', group: '', subjects: ['গণিত'], ...overrides
});

test('normalizes safe Question Bank records and fails closed on malformed MCQs', () => {
  assert.equal(normalizeQuestionRecord(question()).id, 'Q-1');
  assert.throws(() => normalizeQuestionRecord(question({ id: 'Q.1' })), /safe key/);
  assert.throws(() => normalizeQuestionRecord(question({ options: [{ id: 'A', text: 'only one' }] })), /four A-D/);
  assert.throws(() => normalizeQuestionRecord(question({ answer: 'Z' })), /four A-D/);
});

test('student projection is approved, active, class/group scoped, and delays exam questions until after endAt', () => {
  const future = question({
    id: 'Q-FUTURE', source: { examId: 'EX-1', examTitle: 'Upcoming' }, endAt: NOW + 1
  });
  const ended = question({
    id: 'Q-PAST', source: { examId: 'EX-2', examTitle: 'Past' }, endAt: NOW - 1,
    createdByUid: 'private-teacher-uid'
  });
  const records = {
    'Q-1': question({ createdByUid: 'private-teacher-uid' }),
    'Q-FUTURE': future,
    'Q-PAST': ended,
    'Q-INACTIVE': question({ id: 'Q-INACTIVE', active: false }),
    'Q-OTHER-CLASS': question({ id: 'Q-OTHER-CLASS', className: 'নবম শ্রেণি' }),
    'Q-OTHER-GROUP': question({ id: 'Q-OTHER-GROUP', group: 'বিজ্ঞান বিভাগ' })
  };
  const result = buildStudentQuestionProjection(records, student(), NOW);
  assert.deepEqual(Object.keys(result).sort(), ['Q-1', 'Q-PAST']);
  assert.equal(result['Q-1'].answer, 'C', 'practice answer is present only in the recipient-scoped copy');
  assert.equal(result['Q-PAST'].source.examId, 'EX-2');
  assert.equal(result['Q-1'].createdByUid, undefined, 'internal Auth identifiers are not projected');
  assert.deepEqual(buildStudentQuestionProjection(records, student({ status: 'pending' }), NOW), {});
  assert.deepEqual(buildStudentQuestionProjection(records, student({ group: 'বিজ্ঞান বিভাগ' }), NOW)['Q-OTHER-GROUP']?.id, 'Q-OTHER-GROUP');
});

test('teacher projection honors teacher id, subject, class and group assignment scope', () => {
  const rows = {
    'Q-1': question(),
    'Q-GROUP': question({ id: 'Q-GROUP', group: 'বিজ্ঞান বিভাগ' }),
    'Q-SUBJECT': question({ id: 'Q-SUBJECT', subject: 'ইংরেজি' }),
    'Q-OTHER': question({ id: 'Q-OTHER', className: 'নবম শ্রেণি' })
  };
  assert.deepEqual(Object.keys(buildTeacherQuestionProjection(rows, 'T-1', [assignment()])).sort(), ['Q-1', 'Q-GROUP']);
  assert.deepEqual(buildTeacherQuestionProjection(rows, 'T-2', [assignment()]), {});
  assert.deepEqual(Object.keys(buildTeacherQuestionProjection(rows, 'T-1', [assignment({ group: 'বিজ্ঞান বিভাগ' })])).sort(), ['Q-GROUP']);
});

test('canonical changes fan out only eligible projections and retract old-scope copies', () => {
  const students = {
    'S-1': student(),
    'S-2': student({ id: 'S-2', group: 'বিজ্ঞান বিভাগ' }),
    'S-3': student({ id: 'S-3', className: 'নবম শ্রেণি' }),
    'S-PENDING': student({ id: 'S-PENDING', status: 'pending' })
  };
  const assignments = { 'AS-1': assignment(), 'AS-2': assignment({ id: 'AS-2', teacherId: 'T-2', className: 'নবম শ্রেণি' }) };
  const created = buildQuestionBankFanout({
    questionId: 'Q-1', after: question(), students, assignments, now: NOW
  });
  assert.equal(created['teacherQuestionBank/T-1/Q-1'].answer, 'C');
  assert.equal(created['teacherQuestionBank/T-2/Q-1'], null);
  assert.equal(created['studentQuestionBank/S-1/Q-1'].answer, 'C');
  assert.equal(created['studentQuestionBank/S-2/Q-1'].answer, 'C');
  assert.equal(created['studentQuestionBank/S-3/Q-1'], undefined);
  assert.equal(created['studentQuestionBank/S-PENDING/Q-1'], undefined);

  const moved = buildQuestionBankFanout({
    questionId: 'Q-1', before: question(),
    after: question({ group: 'বিজ্ঞান বিভাগ' }), students, assignments, now: NOW
  });
  assert.equal(moved['studentQuestionBank/S-1/Q-1'], null, 'old ungrouped recipient is retracted');
  assert.equal(moved['studentQuestionBank/S-2/Q-1'].id, 'Q-1', 'new matching recipient receives it');
});

test('teacher cannot forge a past-exam source; the content must match their published paper', () => {
  const exam = {
    id: 'EX-1', teacherId: 'T-1', status: 'published', type: 'mcq',
    className: 'দশম শ্রেণি', subject: 'গণিত', group: '',
    questions: [{
      text: '২ + ২ = কত?', answer: 'C',
      options: [{ id: 'A', text: '১' }, { id: 'B', text: '২' }, { id: 'C', text: '৪' }, { id: 'D', text: '৫' }]
    }]
  };
  const sourced = question({ source: { examId: 'EX-1' } });
  assert.equal(questionMatchesExamPaper(sourced, exam, 'T-1'), true);
  assert.equal(questionMatchesExamPaper(sourced, { ...exam, status: 'draft' }, 'T-1'), false);
  assert.equal(questionMatchesExamPaper(sourced, exam, 'T-2'), false);
  assert.equal(questionMatchesExamPaper({ ...sourced, answer: 'A' }, exam, 'T-1'), false);
  assert.equal(questionMatchesExamPaper({ ...sourced, className: 'নবম শ্রেণি' }, exam, 'T-1'), false);
});

test('exam-sourced questions stay out of student fan-out until their end time', () => {
  const item = question({ id: 'Q-EXAM', source: { examId: 'EX-1' }, endAt: NOW + 1000 });
  const recipients = { 'S-1': student() };
  assert.deepEqual(buildStudentQuestionProjection({ 'Q-EXAM': item }, student(), NOW), {});
  assert.deepEqual(buildQuestionBankFanout({ questionId: 'Q-EXAM', after: item, students: recipients, now: NOW }), {});
  const released = buildQuestionBankFanout({ questionId: 'Q-EXAM', after: item, students: recipients, now: NOW + 1001 });
  assert.equal(released['studentQuestionBank/S-1/Q-EXAM'].answer, 'C');
});

test('draft flips to published only when its content still equals the promoted question', () => {
  const draftQuestion = question({ id: 'Q-DRAFT' });
  const draft = { id: 'Q-DRAFT', teacherId: 'T-1', status: 'draft', question: draftQuestion, createdAt: NOW - 5 };
  const publishedAt = NOW + 1000;

  // Same content → publish.
  const advanced = advanceDraftAfterPublish(draft, {
    teacherId: 'T-1', questionId: 'Q-DRAFT', publishedQuestion: draftQuestion, publishedAt
  });
  assert.equal(advanced.status, 'published');
  assert.equal(advanced.publishedAt, publishedAt);
  assert.equal(advanced.teacherId, 'T-1');

  // Key order alone must not block a genuine match.
  const reordered = { ...draftQuestion, options: draftQuestion.options.map(option => ({ text: option.text, id: option.id })) };
  const reorderedDraft = { ...draft, question: reordered };
  assert.equal(advanceDraftAfterPublish(reorderedDraft, {
    teacherId: 'T-1', questionId: 'Q-DRAFT', publishedQuestion: draftQuestion, publishedAt
  })?.status, 'published');

  // Teacher kept editing while the publish was in flight → stays draft.
  const editedDraft = { ...draft, question: question({ id: 'Q-DRAFT', text: 'এখন অন্য প্রশ্ন?' }) };
  assert.equal(advanceDraftAfterPublish(editedDraft, {
    teacherId: 'T-1', questionId: 'Q-DRAFT', publishedQuestion: draftQuestion, publishedAt
  }), undefined);

  // Cross-teacher, wrong id, already-published or missing drafts never move.
  assert.equal(advanceDraftAfterPublish({ ...draft, teacherId: 'T-2' }, {
    teacherId: 'T-1', questionId: 'Q-DRAFT', publishedQuestion: draftQuestion, publishedAt
  }), undefined);
  assert.equal(advanceDraftAfterPublish(draft, {
    teacherId: 'T-1', questionId: 'Q-OTHER', publishedQuestion: draftQuestion, publishedAt
  }), undefined);
  assert.equal(advanceDraftAfterPublish({ ...draft, status: 'published' }, {
    teacherId: 'T-1', questionId: 'Q-DRAFT', publishedQuestion: draftQuestion, publishedAt
  }), undefined);
  assert.equal(advanceDraftAfterPublish(null, {
    teacherId: 'T-1', questionId: 'Q-DRAFT', publishedQuestion: draftQuestion, publishedAt
  }), undefined);
});

test('canonicalJSON ignores object key order but not values', () => {
  assert.equal(canonicalJSON({ a: 1, b: [2, 3] }), canonicalJSON({ b: [2, 3], a: 1 }));
  assert.notEqual(canonicalJSON({ a: 1 }), canonicalJSON({ a: 2 }));
  assert.notEqual(canonicalJSON({ a: [1, 2] }), canonicalJSON({ a: [2, 1] }));
});
