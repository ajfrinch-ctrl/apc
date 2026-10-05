/* Exam records: the identity fields a paper carries (code, class/subject code,
   chapter, batch, order settings), the six stages the UI talks about, and the
   promise that a legacy local file is upgraded in place — never rewritten. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  examRepository as repo, EXAM_KEY, examTemplate, examStageKey, examStageLabel, examCodeOf,
  stampExamCodes, normalizeExam, EXAM_STAGES, MANAGER_ACTOR
} from '../js/exam-data.js';
import { adminStudents } from '../js/admin-data.js';
import { ROSTER_KEY } from '../js/office-data.js';
import { enabledClasses, STORAGE_KEYS } from '../js/config.js';
import { TEACHER_ASSIGNMENTS_KEY } from '../js/teacher-assignments.js';
import { STAFF_ACCOUNTS } from '../js/staff-auth.js';
import { ACADEMICS_KEY } from '../js/academics.js';

const realNow = Date.now;
let clock;
const start = new Date('2026-10-01T10:00:00Z').getTime(), end = start + 3600000;
const [one] = adminStudents.filter(s => s.status === 'approved');

function setup() {
  const assignments = enabledClasses.map((className, index) => ({ id: `TAS-${index}`, teacherUsername: 'teacher.apc', teacherName: 'Test Teacher', className, group: '', subject: 'Test', subjects: ['গণিত', 'ইংরেজি', 'বিজ্ঞান', 'বাংলা', 'Test'] }));
  const store = new Map([
    [ROSTER_KEY, JSON.stringify(adminStudents)],
    [TEACHER_ASSIGNMENTS_KEY, JSON.stringify(assignments)],
    [STAFF_ACCOUNTS.teacher.accountKey, JSON.stringify({ role: 'teacher', username: 'teacher.apc', fullName: 'Test Teacher', status: 'active' })],
    [STAFF_ACCOUNTS.manager.accountKey, JSON.stringify({ role: 'manager', username: 'manager.apc', fullName: 'Test Manager', status: 'active' })],
    [STORAGE_KEYS.account, JSON.stringify({ status: 'active', student: one })]
  ]);
  let events = 0;
  clock = start - 3600000; Date.now = () => clock;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
  const sessions = new Map([[STAFF_ACCOUNTS.teacher.sessionKey, '1'], [STAFF_ACCOUNTS.manager.sessionKey, '1'], [STORAGE_KEYS.session, '1']]);
  globalThis.window = {
    localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) },
    sessionStorage: { getItem: key => sessions.get(key) ?? null, setItem: (key, value) => sessions.set(key, value), removeItem: key => sessions.delete(key) },
    dispatchEvent: () => events++
  };
  return { store, get events() { return events; } };
}
const fields = (extra = {}) => ({
  title: 'গণিত মূল্যায়ন', subject: 'গণিত', className: 'দশম শ্রেণি', type: 'mcq',
  startAt: start, endAt: end, lateMinutes: 10, negative: .5, passPercent: 33,
  template: examTemplate('mcq'), ...extra
});
test.afterEach(() => { Date.now = realNow; });

test('a saved paper gets a permanent Exam Code plus the class/subject codes', async () => {
  const env = setup();
  let db = await repo.saveDraft(fields({ chapterName: 'অধ্যায় ১', topic: 'বহুপদী', batchName: 'বিজ্ঞান ব্যাচ' }), MANAGER_ACTOR);
  const exam = db.exams[0];
  assert.equal(exam.code, 'M2610MT01', 'MCQ + 26 + class 10 + Mathematics + first serial');
  assert.equal(exam.classCode, '10');
  assert.equal(exam.subjectCode, 'MT');
  assert.ok(exam.codeLockedAt > 0);
  assert.equal(exam.chapterName, 'অধ্যায় ১');
  assert.equal(exam.batchName, 'বিজ্ঞান ব্যাচ');
  assert.equal(exam.passingMarks, Math.round(exam.questions.length * 33 / 100));
  assert.equal(exam.negativeMarks, .5);
  assert.equal(exam.startTime, '16:00', 'the start clock is stored in Dhaka time');
  assert.equal(exam.endTime, '17:00');
  assert.equal(exam.questionOrder, 'shuffle');
  assert.equal(exam.optionOrder, 'shuffle');
  /* Editing the paper keeps the code, even when its date moves. */
  db = await repo.saveDraft(fields({ id: exam.id, startAt: start + 86400000, endAt: end + 86400000, questionOrder: 'fixed' }), MANAGER_ACTOR);
  assert.equal(db.exams[0].code, 'M2610MT01');
  assert.equal(db.exams[0].questionOrder, 'fixed');
  assert.equal(db.exams[0].examDate, '2026-10-02', 'the record is re-filed on the new day');
  /* A second paper of the same class+subject gets the next serial. */
  db = await repo.saveDraft(fields({ title: 'দ্বিতীয় মূল্যায়ন' }), MANAGER_ACTOR);
  assert.equal(db.exams[0].code, 'M2610MT02');
  /* Another subject/class never collides with it. */
  db = await repo.saveDraft(fields({ title: 'ইংরেজি মূল্যায়ন', subject: 'ইংরেজি' }), MANAGER_ACTOR);
  assert.equal(db.exams[0].code, 'M2610EN01');
  assert.equal(new Set(db.exams.map(item => item.code)).size, db.exams.length, 'no two papers share a code');
  const reread = await repo.list(MANAGER_ACTOR);
  assert.equal(reread.exams.length, 3);
  assert.deepEqual(reread.exams.map(item => item.code).sort(), ['M2610EN01', 'M2610MT01', 'M2610MT02'].sort());
  assert.equal(env.events > 0, true);
});

test('the six stages come from the stored status plus the clock', () => {
  const base = { type: 'mcq', startAt: start, endAt: end };
  assert.equal(examStageKey({ ...base, status: 'draft' }), 'draft');
  assert.equal(examStageLabel({ ...base, status: 'draft' }), EXAM_STAGES.draft);
  assert.equal(examStageKey({ ...base, status: 'pending' }), 'scheduled');
  assert.equal(examStageKey({ ...base, status: 'approved' }), 'scheduled');
  assert.equal(examStageKey({ ...base, status: 'rejected' }), 'scheduled');
  assert.equal(examStageKey({ ...base, status: 'published' }, start - 1000), 'scheduled', 'published but not started yet');
  assert.equal(examStageKey({ ...base, status: 'published' }, start + 1000), 'running', 'inside the window it is running');
  assert.equal(examStageKey({ ...base, status: 'published' }, end + 1000), 'completed');
  assert.equal(examStageKey({ ...base, status: 'completed' }, start - 1000), 'completed');
  assert.equal(examStageKey({ ...base, status: 'archived' }), 'archived');
  assert.equal(Object.keys(EXAM_STAGES).length, 6);
});

test('a legacy record is upgraded in place: code backfilled, questions untouched', async () => {
  setup();
  const legacy = {
    version: 1,
    exams: [{
      id: 'E-OLD', title: 'পুরোনো পরীক্ষা', subject: 'বাংলা', className: 'দশম শ্রেণি', group: '', type: 'mcq',
      startAt: start, endAt: end, lateMinutes: 10, negative: 0, passPercent: 33,
      template: examTemplate('mcq'), questions: (await repo.saveDraft(fields(), MANAGER_ACTOR)).exams[0].questions,
      teacherId: 'teacher.apc', teacherName: 'Test Teacher', createdBy: 'Test Teacher', createdByRole: 'teacher',
      status: 'draft', participants: [], createdAt: start - 5000, updatedAt: start - 5000
    }],
    attempts: []
  };
  window.localStorage.setItem(EXAM_KEY, JSON.stringify(legacy));
  const before = JSON.parse(window.localStorage.getItem(EXAM_KEY)).exams[0].questions;
  const db = await repo.list(MANAGER_ACTOR);
  assert.equal(db.exams[0].code, undefined, 'reading never writes');
  const stamped = await repo.ensureCodes();
  assert.equal(stamped.exams[0].code, 'M2610BN01');
  const stored = JSON.parse(window.localStorage.getItem(EXAM_KEY)).exams[0];
  assert.equal(stored.code, 'M2610BN01');
  /* Only the derived identity fields (uid/examId/context) may be refreshed;
     the question text, options, answer and marks are the same objects. */
  assert.deepEqual(stored.questions.map(q => ({ text: q.text, options: q.options, answer: q.answer, marks: q.marks })),
    before.map(q => ({ text: q.text, options: q.options, answer: q.answer, marks: q.marks })), 'the questions are exactly as they were');
  assert.ok(stored.questions.every(question => question.examId === 'E-OLD'), 'the questions now belong to the stamped paper');
  assert.equal(stored.questionOrder, 'shuffle', 'read-time defaults fill the missing settings');
  assert.equal(stored.optionOrder, 'shuffle');
  /* Idempotent: a second pass changes nothing. */
  const again = JSON.parse(window.localStorage.getItem(EXAM_KEY));
  await repo.ensureCodes();
  assert.deepEqual(JSON.parse(window.localStorage.getItem(EXAM_KEY)), again);
  const snapshot = JSON.parse(window.localStorage.getItem(EXAM_KEY));
  const changed = stampExamCodes(snapshot);
  assert.equal(changed, false, 'nothing left to stamp');
  assert.equal(examCodeOf({ ...snapshot.exams[0], code: '' }), 'M2610BN01', 'a preview code is derived without writing');
});

test('duplicate copies a paper into a new code and new question ids', async () => {
  setup();
  let db = await repo.saveDraft(fields(), MANAGER_ACTOR);
  const source = db.exams[0];
  db = await repo.duplicate(source.id, MANAGER_ACTOR);
  const copy = db.exams.find(item => item.id !== source.id);
  assert.notEqual(copy.code, source.code);
  assert.equal(copy.code, 'M2610MT02');
  assert.equal(copy.copiedFrom, source.id);
  assert.equal(copy.status, 'draft');
  assert.equal(copy.questions.length, source.questions.length);
  for (const [index, question] of copy.questions.entries()) {
    assert.notEqual(question.uid, source.questions[index].uid, 'the copy owns its questions');
    assert.equal(question.examId, copy.id);
  }
  assert.equal(source.questions[0].examId, source.id, 'the original paper is untouched');
  assert.equal((await repo.list(MANAGER_ACTOR)).exams.length, 2);
});

test('order settings reach the attempt and a resumed attempt keeps its paper', async () => {
  setup();
  let db = await repo.saveDraft(fields({ questionOrder: 'fixed', optionOrder: 'fixed' }), MANAGER_ACTOR);
  const id = db.exams[0].id;
  await repo.requestApproval(id, MANAGER_ACTOR);
  db = await repo.review(id, 'publish', {}, MANAGER_ACTOR);
  const exam = db.exams[0];
  assert.equal(examStageKey(exam, clock), 'scheduled');
  clock = start + 60000;
  assert.equal(examStageKey(exam, clock), 'running');
  db = await repo.startAttempt(id, one);
  const attempt = db.attempts[0];
  assert.ok(attempt.id);
  assert.deepEqual(attempt.order.map(row => row.id), exam.questions.map(q => q.id), 'fixed order is honoured');
  for (const row of attempt.order) assert.deepEqual(row.options, ['A', 'B', 'C', 'D']);
  const stored = JSON.stringify(attempt.order);
  db = await repo.startAttempt(id, one);
  assert.equal(JSON.stringify(db.attempts[0].order), stored, 're-opening the attempt never reshuffles');
  assert.equal(db.attempts.length, 1);
  clock = end + 1000;
  assert.equal(examStageKey(db.exams[0], clock), 'completed');
  const reload = JSON.parse(window.localStorage.getItem(EXAM_KEY));
  normalizeExam(reload.exams[0]);
  assert.equal(reload.exams[0].questionOrder, 'fixed');
  assert.equal(reload.exams[0].optionOrder, 'fixed');
});
