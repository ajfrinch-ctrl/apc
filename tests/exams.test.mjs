import test from 'node:test';
import assert from 'node:assert/strict';
import { examRepository as repo, EXAM_KEY, examTemplate, parseQuestions, MCQ_MARKS, scoreAttempt, retryEligibility, firstAttemptMean, examResults, classExamDate, totalMarks, TEACHER_ACTOR, ADMIN_ACTOR, MANAGER_ACTOR } from '../js/exam-data.js';
import { pagesPDF } from '../js/exam-pdf.js';
import { adminStudents } from '../js/admin-data.js';
import { ROSTER_KEY } from '../js/office-data.js';
import { enabledClasses } from '../js/config.js';
import { TEACHER_ASSIGNMENTS_KEY } from '../js/teacher-assignments.js';
import { STAFF_ACCOUNTS } from '../js/staff-auth.js';
import { STORAGE_KEYS } from '../js/config.js';
const realNow = Date.now;
let clock;
const start = new Date('2026-10-01T10:00:00Z').getTime(), end = start + 3600000;
const [one, two, three] = adminStudents.filter(s => s.status === 'approved');
function setup() {
  const assignments = enabledClasses.map((className, index) => ({ id: `TAS-${index}`, teacherUsername: 'teacher.apc', teacherName: 'Test Teacher', className, group: '', subject: 'Test', subjects: ['গণিত', 'ইংরেজি', 'বিজ্ঞান', 'বাংলা', 'Test'] }));
  const store = new Map([
    [ROSTER_KEY, JSON.stringify(adminStudents)],
    [TEACHER_ASSIGNMENTS_KEY, JSON.stringify(assignments)],
    [STAFF_ACCOUNTS.teacher.accountKey, JSON.stringify({ role: 'teacher', username: 'teacher.apc', fullName: 'Test Teacher', status: 'active' })],
    [STAFF_ACCOUNTS.manager.accountKey, JSON.stringify({ role: 'manager', username: 'manager.apc', fullName: 'Test Manager', status: 'active' })],
    [STORAGE_KEYS.account, JSON.stringify({ status: 'active', student: one })]
  ]); let fail = false, events = 0;
  clock = start - 3600000; Date.now = () => clock;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
  const sessions = new Map([[STAFF_ACCOUNTS.teacher.sessionKey, '1'], [STAFF_ACCOUNTS.manager.sessionKey, '1'], [STORAGE_KEYS.session, '1']]);
  globalThis.window = { localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => { if (fail) throw new Error('quota'); store.set(key, value); } }, sessionStorage: { getItem: key => sessions.get(key) ?? null, setItem: (key, value) => sessions.set(key, value), removeItem: key => sessions.delete(key) }, dispatchEvent: () => events++ };
  return { store, fail: () => { fail = true; }, get events() { return events; } };
}
function seedStudentSession(student, status = 'active') {
  window.localStorage.setItem(STORAGE_KEYS.account, JSON.stringify({ status, student }));
  window.sessionStorage.setItem(STORAGE_KEYS.session, '1');
}
const fields = (extra = {}) => ({ title: 'গণিত মূল্যায়ন', subject: 'গণিত', className: 'দশম শ্রেণি', type: 'mcq', startAt: start, endAt: end, lateMinutes: 10, negative: .5, passPercent: 33, template: examTemplate('mcq'), ...extra });
async function publish(extra = {}) {
  let db = await repo.saveDraft(fields(extra)); const id = db.exams[0].id;
  await repo.requestApproval(id); db = await repo.review(id, 'publish', {}, MANAGER_ACTOR); return db.exams[0];
}
async function attempt(e, student, answers = {}) {
  seedStudentSession(student);
  let db = await repo.startAttempt(e.id, student); const a = db.attempts.find(a => a.studentId === student.id && a.examId === e.id && a.status === 'active');
  for (const [qid, option] of Object.entries(answers)) db = await repo.saveAnswer(a.id, student.id, qid, option);
  return { a, db };
}
test.afterEach(() => { Date.now = realNow; });

test('MCQ marks are fixed at 1; written/short keep their own weights; malformed input rejected', () => {
  const mcq = parseQuestions(examTemplate('mcq'), 'mcq');
  assert.equal(mcq.length, 2);
  assert.deepEqual(mcq.map(q => q.marks), [MCQ_MARKS, MCQ_MARKS], 'every MCQ question is worth one mark');
  assert.equal(totalMarks({ questions: mcq }), mcq.length, 'MCQ total equals the question count');
  assert.equal(examTemplate('mcq').includes('নম্বর'), false, 'the MCQ template no longer asks for marks');
  for (const type of ['written', 'short']) { const questions = parseQuestions(examTemplate(type), type); assert.equal(questions.length, 2); assert.ok(questions[0].marks !== questions[1].marks); }
  const withMarks = examTemplate('mcq').replace('A: ঢাকা', 'নম্বর: ২\nA: ঢাকা');
  for (const text of ['', 'প্রশ্ন: x', examTemplate('mcq').replace('উত্তর: A', 'উত্তর: E'), withMarks, examTemplate('mcq').replace('B: চট্টগ্রাম', 'B: ঢাকা'), examTemplate('mcq') + '\nউত্তর: B']) assert.throws(() => parseQuestions(text, 'mcq'));
  assert.throws(() => parseQuestions(examTemplate('mcq'), 'written'));
});
test('teacher exam actions and participants are bounded to assigned class/batch', async () => {
  const env = setup();
  env.store.set(TEACHER_ASSIGNMENTS_KEY, JSON.stringify([{ id: 'TAS-SCI', teacherUsername: 'teacher.apc', teacherName: 'Test Teacher', className: 'দশম শ্রেণি', group: 'বিজ্ঞান বিভাগ', subject: 'গণিত' }]));
  await assert.rejects(repo.saveDraft(fields({ group: '' })), /assignment নেই/);
  await assert.rejects(repo.saveDraft(fields({ className: 'অনার্স ১ম বর্ষ', group: 'বাংলা' })), /assignment নেই/);
  let db = await repo.saveDraft(fields({ group: 'বিজ্ঞান' }));
  const id = db.exams[0].id;
  await repo.requestApproval(id);
  db = await repo.review(id, 'publish', {}, MANAGER_ACTOR);
  assert.ok(db.exams[0].participants.every(person => person.className === 'দশম শ্রেণি'));
  assert.ok(db.exams[0].participants.every(person => person.id === one.id || person.id === two.id));
  const teacherDb = await repo.list(TEACHER_ACTOR);
  assert.equal(teacherDb.exams.length, 1);
  await assert.rejects(repo.saveDraft(fields({ id, group: 'মানবিক' })), /assignment নেই/);
  await assert.rejects(repo.markWrittenAbsent(id, three));
});

test('teacher drafts → submit → Manager rejection/edit/approval; no premature publication', async () => {
  setup(); let db = await repo.saveDraft(fields()); const id = db.exams[0].id;
  assert.equal(db.exams[0].status, 'draft');
  await assert.rejects(repo.review(id, 'publish'));
  await assert.rejects(repo.startAttempt(id, one));
  await assert.rejects(repo.requestApproval(id, { role: 'teacher', id: 'OTHER' }));
  await repo.requestApproval(id);
  await assert.rejects(repo.review(id, 'publish', {}, TEACHER_ACTOR));
  await assert.rejects(repo.review(id, 'publish', {}, ADMIN_ACTOR), /শুধু Manager/);
  db = await repo.review(id, 'reject', { note: 'প্রশ্ন সংশোধন করুন' }, MANAGER_ACTOR); assert.equal(db.exams[0].status, 'rejected');
  db = await repo.saveDraft({ ...fields(), id }); assert.equal(db.exams[0].status, 'draft');
  await repo.requestApproval(id); db = await repo.review(id, 'publish', { negative: 1 }, MANAGER_ACTOR);
  assert.equal(db.exams[0].negative, 1); assert.equal(db.exams[0].status, 'published'); assert.equal(db.exams[0].participants.every(person => person.className === 'দশম শ্রেণি'), true);
  await assert.rejects(repo.saveDraft({ ...fields(), id })); await assert.rejects(repo.deleteDraft(id));
});
test('start/end, late entry, all-class approved students, stable shuffled resume and duplicate starts', async () => {
  setup(); const e = await publish(); await assert.rejects(repo.startAttempt(e.id, one));
  clock = start; const { a } = await attempt(e, one);
  assert.deepEqual(new Set(a.order.map(q => q.id)), new Set(e.questions.map(q => q.id)));
  for (const q of a.order) assert.deepEqual(new Set(q.options), new Set(['A', 'B', 'C', 'D']));
  let db = await repo.startAttempt(e.id, one); assert.equal(db.attempts.length, 1); assert.deepEqual(db.attempts[0].order, a.order);
  seedStudentSession(three);
  await assert.rejects(repo.startAttempt(e.id, three), /শ্রেণি\/ব্যাচের জন্য নয়/); // A different class cannot access this exam.
  seedStudentSession({ id: 'pending', className: one.className, group: one.group }, 'pending');
  await assert.rejects(repo.startAttempt(e.id, { id: 'pending' }), { code: 'ACCESS_DENIED' });
  seedStudentSession(two);
  clock = start + 11 * 60000; await assert.rejects(repo.startAttempt(e.id, two));
  clock = end;
  seedStudentSession(one);
  await assert.rejects(repo.saveAnswer(a.id, one.id, 'q1', 'A'));
  seedStudentSession(two);
  await assert.rejects(repo.startAttempt(e.id, two));
});
test('different question weights, wrong/unanswered, change answer, zero floor, immediate marks', async () => {
  setup(); const e = await publish(); clock = start;
  const { a } = await attempt(e, one, { q1: 'B', q2: 'C' });
  await repo.saveAnswer(a.id, one.id, 'q1', 'A'); let db = await repo.finishAttempt(a.id, one.id);
  assert.equal(db.attempts[0].score, 2); assert.equal(db.attempts[0].correct, 2);
  assert.equal((await repo.finishAttempt(a.id, one.id)).attempts.length, 1);
  assert.deepEqual(scoreAttempt(e, { answers: { q1: 'B' } }), { score: 0, correct: 0, wrong: 1, unanswered: 1 });
  assert.deepEqual(scoreAttempt(e, { answers: { q1: 'B', q2: 'C' } }), { score: 0.5, correct: 1, wrong: 1, unanswered: 0 });
});
test('running FIRST attempt mean enables one retry only, ignores second scores and keeps best score', async () => {
  setup(); const e = await publish(); clock = start;
  let { a } = await attempt(e, one, { q1: 'A' }); let db = await repo.finishAttempt(a.id, one.id); assert.equal(retryEligibility(db, e, one.id), false);
  ({ a } = await attempt(e, two, { q1: 'A', q2: 'C' })); db = await repo.finishAttempt(a.id, two.id);
  db = await repo.list(MANAGER_ACTOR);
  assert.equal(firstAttemptMean(db, e.id), 1.5); assert.equal(retryEligibility(db, e, one.id), true);
  seedStudentSession(one);
  const studentSnapshot = await repo.listForStudent(one.id);
  assert.equal(firstAttemptMean(studentSnapshot, e.id), 1.5, 'the Student gets only the aggregate required for the retry rule');
  assert.equal(studentSnapshot.attempts.every(row => row.studentId === one.id), true, 'another Student’s attempt stays hidden');
  assert.equal(retryEligibility(studentSnapshot, e, one.id), true, 'the Student view exposes the eligible retry action without peer rows');
  clock = start + 20 * 60000; ({ a } = await attempt(e, one, { q1: 'B' })); assert.equal(a.number, 2);
  db = await repo.finishAttempt(a.id, one.id); assert.equal(firstAttemptMean(db, e.id), 1.5);
  assert.equal(examResults(db, e).find(a => a.studentId === one.id).score, 1);
  assert.equal(retryEligibility(db, e, one.id), false); await assert.rejects(repo.startAttempt(e.id, one));
});
test('offline queue survives reload; deadline locks; later sync grades exactly once', async () => {
  setup(); const e = await publish(); clock = start; const { a } = await attempt(e, one, { q1: 'A', q2: 'C' }); navigator.onLine = false;
  clock = end + 1; let db = await repo.syncStudent(one.id); assert.equal(db.attempts[0].status, 'queued'); assert.equal(db.attempts[0].finishedAt, end); assert.equal(db.attempts[0].score, undefined);
  await assert.rejects(repo.saveAnswer(a.id, one.id, 'q1', 'B')); assert.equal((await repo.list()).attempts[0].answers.q1, 'A');
  clock = end + 86400000; navigator.onLine = true; db = await repo.syncStudent(one.id); assert.equal(db.attempts[0].status, 'submitted'); assert.equal(db.attempts[0].score, 2);
  db = await repo.syncStudent(one.id); assert.equal(db.attempts.length, 1);
});
test('written/short next-day physical grading and explicit absence; invalid score cannot overwrite', async () => {
  setup(); const e = await publish({ type: 'short', template: examTemplate('short') }); assert.equal(classExamDate(start), '2026-10-02');
  /* The marks come from the exam's own questions, so a template change (the
     short-answer template is ১ + ২ now) cannot silently invalidate this test. */
  const [q1, q2] = (await repo.list()).exams[0].questions.map(q => q.marks);
  await assert.rejects(repo.startAttempt(e.id, one)); await assert.rejects(repo.saveWrittenScore(e.id, one, { q1, q2 }));
  clock = new Date('2026-10-02T00:00:00+06:00').getTime(); await repo.markWrittenAbsent(e.id, one);
  let db = await repo.saveWrittenScore(e.id, one, { q1, q2 }); assert.equal(db.attempts[0].score, q1 + q2); assert.deepEqual(db.exams[0].absentIds, []);
  await assert.rejects(repo.saveWrittenScore(e.id, one, { q1: q1 + 3, q2 })); await assert.rejects(repo.markWrittenAbsent(e.id, one));
  await assert.rejects(repo.publishResults(e.id), /সব অংশগ্রহণকারীর/);
  await repo.markWrittenAbsent(e.id, two);
  db = await repo.publishResults(e.id, MANAGER_ACTOR); assert.equal(db.exams[0].resultsPublished, true);
  await assert.rejects(repo.saveWrittenScore(e.id, one, { q1: 1, q2: 1 }));
  await assert.rejects(repo.saveWrittenScore(e.id, one, { q1: 1, q2: 1 }, ADMIN_ACTOR));
});
test('invalid/corrupt storage and quota failure never reset data or announce success', async () => {
  let env = setup(); env.store.set(EXAM_KEY, '{broken'); await assert.rejects(repo.list()); await assert.rejects(repo.saveDraft(fields())); assert.equal(env.store.get(EXAM_KEY), '{broken');
  env = setup(); const e = await publish(); clock = start; const { a } = await attempt(e, one); const before = env.store.get(EXAM_KEY), events = env.events; env.fail();
  await assert.rejects(repo.saveAnswer(a.id, one.id, 'q1', 'A')); assert.equal(env.store.get(EXAM_KEY), before); assert.equal(env.events, events);
});
test('multi-page PDF has exact stream lengths and page count', async () => {
  const blob = pagesPDF(Array.from({ length: 3 }, () => ({ width: 1240, height: 1754, jpeg: new Uint8Array([255, 216, 1, 2, 255, 217]) })));
  const pdf = Buffer.from(await blob.arrayBuffer()).toString('latin1'); assert.match(pdf, /\/Count 3/); assert.equal((pdf.match(/\/Type \/Page /g) || []).length, 3);
  const xref = Number(pdf.match(/startxref\n(\d+)/)[1]); assert.equal(pdf.slice(xref, xref + 4), 'xref'); assert.match(pdf, /\/Length 6 >>\nstream/);
});
