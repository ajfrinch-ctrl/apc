/* Date-wise examination workflow (school request, 2026-10-02):
   questions live in per-date records with their own status, the archive
   filters by date/range/class/subject/name/status, and only the Manager moves
   a paper through Draft → Review → Approved → Published → Completed → Archived.
   This file drives the real repository (js/exam-data.js) with a fake clock and
   storage; the two UI files drive teacher.html and manager.html. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  examRepository as repo, EXAM_KEY, examTemplate, parseQuestions, questionSignature,
  serializeQuestions, examDateFor, examDateOf, examDurationMinutes, questionRecord,
  isStudentVisibleExam, totalMarks, EXAM_STATUSES, TEACHER_ACTOR, MANAGER_ACTOR, ADMIN_ACTOR
} from '../js/exam-data.js';
import {
  filterExams, groupExamsByDate, upcomingExams, examCounters, workflowSteps,
  examPermissions, examDateLabel, examDateShort, durationLabel, normalizeFilters
} from '../js/exam-archive.js';
import { adminStudents } from '../js/admin-data.js';
import { ROSTER_KEY } from '../js/office-data.js';
import { enabledClasses, STORAGE_KEYS } from '../js/config.js';
import { TEACHER_ASSIGNMENTS_KEY } from '../js/teacher-assignments.js';
import { STAFF_ACCOUNTS } from '../js/staff-auth.js';

const realNow = Date.now;
let clock;
const start = new Date('2026-10-01T10:00:00Z').getTime(), end = start + 3600000;
const [one, two] = adminStudents.filter(student => student.status === 'approved');

function setup() {
  const assignments = enabledClasses.map((className, index) => ({ id: `TAS-${index}`, teacherUsername: 'teacher.apc', teacherName: 'Test Teacher', className, group: '', subject: 'Test', subjects: ['গণিত', 'ইংরেজি', 'বিজ্ঞান', 'Test'] }));
  const store = new Map([
    [ROSTER_KEY, JSON.stringify(adminStudents)],
    [TEACHER_ASSIGNMENTS_KEY, JSON.stringify(assignments)],
    [STAFF_ACCOUNTS.teacher.accountKey, JSON.stringify({ role: 'teacher', username: 'teacher.apc', fullName: 'Test Teacher', status: 'active' })],
    [STAFF_ACCOUNTS.manager.accountKey, JSON.stringify({ role: 'manager', username: 'manager.apc', fullName: 'Test Manager', status: 'active' })],
    [STORAGE_KEYS.account, JSON.stringify({ status: 'active', student: one })]
  ]);
  const sessions = new Map([[STAFF_ACCOUNTS.teacher.sessionKey, '1'], [STAFF_ACCOUNTS.manager.sessionKey, '1'], [STORAGE_KEYS.session, '1']]);
  clock = start - 3600000;
  Date.now = () => clock;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
  globalThis.window = {
    localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) },
    sessionStorage: { getItem: key => sessions.get(key) ?? null, setItem: (key, value) => sessions.set(key, value), removeItem: key => sessions.delete(key) },
    dispatchEvent: () => true
  };
  return { store };
}
const fields = (extra = {}) => ({ title: 'সাপ্তাহিক মূল্যায়ন', subject: 'গণিত', className: 'দশম শ্রেণি', type: 'mcq', startAt: start, endAt: end, lateMinutes: 10, negative: .5, passPercent: 33, template: examTemplate('mcq'), ...extra });
const stored = env => JSON.parse(env.store.get(EXAM_KEY) || '{"exams":[]}');
const find = (snapshot, id) => snapshot.exams.find(exam => exam.id === id);
async function publishVia(extra = {}) {
  let db = await repo.saveDraft(fields(extra)); const id = db.exams[0].id;
  await repo.requestApproval(id); return repo.publish(id, MANAGER_ACTOR).then(() => id);
}
async function answerOne(examId) {
  window.localStorage.setItem(STORAGE_KEYS.account, JSON.stringify({ status: 'active', student: one }));
  window.sessionStorage.setItem(STORAGE_KEYS.session, '1');
  clock = start;
  let db = await repo.startAttempt(examId, one);
  const attempt = db.attempts.find(item => item.studentId === one.id && item.examId === examId && item.status === 'active');
  db = await repo.saveAnswer(attempt.id, one.id, 'q1', 'A');
  return repo.finishAttempt(attempt.id, one.id);
}
test.afterEach(() => { Date.now = realNow; });

/* ---------- date-wise archive helpers (pure) ------------------------------- */

const synthetic = (id, date, extra = {}) => ({
  id, title: `পরীক্ষা ${id}`, subject: 'গণিত', className: 'দশম শ্রেণি', group: '', type: 'mcq',
  status: 'published', examDate: date, startAt: Date.parse(`${date}T10:00:00Z`), endAt: Date.parse(`${date}T11:00:00Z`),
  questions: [{ id: 'q1', uid: `${id}-q1`, text: 'বাংলাদেশের রাজধানী কোনটি?', marks: 1, options: [], answer: 'A' }],
  createdAt: 1, ...extra
});

test('exams group by their own date and never mix two days in one list', () => {
  const exams = [synthetic('E1', '2026-10-02'), synthetic('E2', '2026-10-02'), synthetic('E3', '2026-10-03')];
  const groups = groupExamsByDate(exams);
  assert.deepEqual(groups.map(group => group.date), ['2026-10-03', '2026-10-02'], 'newest day first');
  assert.deepEqual(groups.find(group => group.date === '2026-10-02').exams.map(exam => exam.id), ['E1', 'E2']);
  assert.match(groups[0].label, /০৩ অক্টোবর ২০২৬/, 'the header is a readable Bengali date');
  assert.deepEqual(groupExamsByDate(exams, { direction: 'asc' }).map(group => group.date), ['2026-10-02', '2026-10-03']);
  assert.equal(examDateShort('2026-10-02'), '০২-১০-২০২৬');
  assert.match(examDateLabel('2026-10-02'), /শুক্রবার|শনিবার|রবিবার|সোমবার|মঙ্গলবার|বুধবার|বৃহস্পতিবার/);
  assert.equal(durationLabel(90), '৯০ মিনিট');
});

test('the archive filters by single date, range, class, subject, name, status and question text', () => {
  const exams = [
    synthetic('E1', '2026-10-02'),
    synthetic('E2', '2026-10-04', { title: 'Model Test', subject: 'ইংরেজি', className: 'নবম শ্রেণি' }),
    synthetic('E3', '2026-10-06', { status: 'draft', title: 'Weekly Exam', questions: [{ id: 'q1', text: 'অনুপস্থিত প্রশ্ন', marks: 1 }] })
  ];
  const ids = filters => filterExams(exams, filters).map(exam => exam.id);
  assert.deepEqual(ids({ date: '2026-10-04' }), ['E2']);
  assert.deepEqual(ids({ date: '' }), ['E1', 'E2', 'E3'], 'no filter keeps the whole archive');
  assert.deepEqual(ids({ from: '2026-10-03', to: '2026-10-05' }), ['E2']);
  assert.deepEqual(ids({ className: 'নবম শ্রেণি' }), ['E2']);
  assert.deepEqual(ids({ subject: 'ইংরেজি' }), ['E2']);
  assert.deepEqual(ids({ query: 'Model' }), ['E2']);
  assert.deepEqual(ids({ query: 'অনুপস্থিত' }), ['E3'], 'search reaches into the question text');
  assert.deepEqual(ids({ status: 'draft' }), ['E3']);
  assert.deepEqual(ids({ status: 'live' }), ['E1', 'E2']);
  assert.deepEqual(ids({ from: '2026-10-06', to: '2026-10-03' }), ['E2', 'E3'], 'a reversed range is read the right way round');
  assert.equal(normalizeFilters({ date: 'not-a-date' }).date, '');
});

test('upcoming exams only count windows that are still open, soonest first', () => {
  const now = Date.parse('2026-10-02T12:00:00Z');
  const exams = [
    synthetic('E1', '2026-10-02', { startAt: Date.parse('2026-10-02T09:00:00Z'), endAt: Date.parse('2026-10-02T10:00:00Z') }),
    synthetic('E2', '2026-10-03', { startAt: Date.parse('2026-10-03T09:00:00Z'), endAt: Date.parse('2026-10-03T10:00:00Z') }),
    synthetic('E3', '2026-10-04', { status: 'draft', startAt: Date.parse('2026-10-04T09:00:00Z'), endAt: Date.parse('2026-10-04T10:00:00Z') })
  ];
  assert.deepEqual(upcomingExams(exams, now).map(exam => exam.id), ['E2'], 'a finished or draft paper is not upcoming');
  assert.deepEqual(examCounters(exams).questions, 3);
  assert.equal(workflowSteps('approved').find(step => step.step === 'approved').state, 'current');
  assert.equal(workflowSteps('rejected').find(step => step.step === 'pending').state, 'current', 'a rejected paper sits at Review');
});

test('permissions decide who sees and moves a paper at each status', () => {
  const teacher = { role: 'teacher', id: TEACHER_ACTOR.id }, manager = MANAGER_ACTOR;
  const own = { id: 'E1', teacherId: TEACHER_ACTOR.id, status: 'draft', type: 'written', startAt: Date.now() + 3600000, endAt: Date.now() + 7200000 };
  const published = { ...own, status: 'published' };
  assert.equal(examPermissions(teacher, own).edit, true);
  assert.equal(examPermissions(teacher, own).publish, false, 'a teacher never publishes');
  assert.equal(examPermissions(teacher, own).approve, false);
  assert.equal(examPermissions(manager, own).publish, true);
  assert.equal(examPermissions(manager, own).approve, true);
  assert.equal(examPermissions(manager, published).unpublish, true);
  assert.equal(examPermissions(manager, published).remove, false, 'a published paper is archived, not deleted');
  assert.equal(examPermissions(manager, { ...published, status: 'archived' }).restore, true);
  assert.equal(examPermissions(manager, { ...published, status: 'published' }, { openAttempts: 1 }).unpublish, false);
  assert.equal(examPermissions(teacher, { ...own, teacherId: 'OTHER' }).questions, false, 'another teacher’s paper stays private');
  assert.equal(examPermissions({ role: 'admin', id: 'ADMIN' }, published).publish, false, 'the admin panel reads, it does not publish');
});

/* ---------- the workflow through the repository ---------------------------- */

test('draft → review → approved → published → completed → archived → restore, with nothing lost', async () => {
  const env = setup();
  const startAt = start, endAt = end;
  let db = await repo.saveDraft(fields({ startAt, endAt }));
  const id = db.exams[0].id, exam0 = find(db, id);
  assert.equal(exam0.status, 'draft');
  assert.equal(exam0.examDate, examDateFor('mcq', startAt), 'the record carries its exam date');
  assert.equal(exam0.durationMinutes, 60);
  assert.equal(isStudentVisibleExam(exam0), false, 'a draft is staff-only');

  await assert.rejects(repo.publish(id, TEACHER_ACTOR), /Manager/, 'a teacher never publishes a paper');
  db = await repo.approve(id, MANAGER_ACTOR);
  assert.equal(find(db, id).status, 'approved');
  assert.equal(isStudentVisibleExam(find(db, id)), false, 'an approved paper is still not student-visible');

  db = await repo.publish(id, MANAGER_ACTOR);
  assert.equal(find(db, id).status, 'published');
  assert.equal(isStudentVisibleExam(find(db, id)), true);
  const participants = find(db, id).participants.length;
  assert.ok(participants > 0, 'publishing fills the class roster');

  await assert.rejects(repo.complete(id, MANAGER_ACTOR), /সময়|time/i, 'a running paper is not completed early');
  clock = end + 1000;
  db = await repo.complete(id, MANAGER_ACTOR);
  assert.equal(find(db, id).status, 'completed');
  assert.equal(isStudentVisibleExam(find(db, id)), true, 'results stay readable after completion');

  db = await repo.archive(id, MANAGER_ACTOR);
  assert.equal(find(db, id).status, 'archived');
  assert.equal(find(db, id).archivedFrom, 'completed');
  assert.equal(isStudentVisibleExam(find(db, id)), false, 'an archived paper leaves the student list');
  assert.equal(find(db, id).participants.length, participants, 'archiving keeps the roster');

  db = await repo.restore(id, MANAGER_ACTOR);
  assert.equal(find(db, id).status, 'completed', 'restore puts the paper back where it was');
  assert.equal(find(db, id).questions.length, 2);
  assert.equal(find(db, id).template, examTemplate('mcq'));
  assert.equal(stored(env).exams.length, 1, 'not one record was written twice');
});

test('a teacher cannot approve, publish, unpublish, archive or delete a published paper', async () => {
  setup();
  const id = await publishVia();
  for (const [call, pattern] of [
    [() => repo.approve(id, TEACHER_ACTOR), /Manager/],
    [() => repo.publish(id, TEACHER_ACTOR), /Manager/],
    [() => repo.unpublish(id, TEACHER_ACTOR), /Manager/],
    [() => repo.archive(id, TEACHER_ACTOR), /Manager/],
    [() => repo.complete(id, TEACHER_ACTOR), /Manager/],
    [() => repo.review(id, 'reject', { note: 'x' }, ADMIN_ACTOR), /Manager/]
  ]) await assert.rejects(call, pattern);
  await assert.rejects(repo.deleteExam(id, TEACHER_ACTOR), /Unpublish|Archive/);
});

test('the Manager authors, edits, duplicates, publishes and retires a paper of their own', async () => {
  const env = setup();
  let db = await repo.saveDraft(fields({ className: 'দশম শ্রেণি' }), MANAGER_ACTOR);
  const id = db.exams[0].id;
  assert.equal(find(db, id).teacherId, '', 'a Manager-owned paper has no teacher id');
  assert.equal(find(db, id).createdByRole, 'manager');

  await repo.duplicate(id, MANAGER_ACTOR);
  db = await repo.list(MANAGER_ACTOR);
  const source = find(db, id), copy = db.exams.find(exam => exam.copiedFrom === id);
  assert.ok(copy, 'the copy is a first-class record with a link back');
  assert.notEqual(copy.id, source.id);
  assert.equal(copy.status, 'draft');
  assert.match(copy.title, /\(কপি\)/);
  assert.equal(copy.questions.length, source.questions.length);
  assert.notEqual(copy.questions[0].uid, source.questions[0].uid, 'copied questions get their own unique ids');
  assert.equal(copy.participants.length, 0);

  await repo.deleteExam(copy.id, MANAGER_ACTOR);
  assert.equal((await repo.list(MANAGER_ACTOR)).exams.length, 1, 'only the draft copy was removed');

  await repo.requestApproval(id, MANAGER_ACTOR);
  await repo.approve(id, MANAGER_ACTOR);
  db = await repo.publish(id, MANAGER_ACTOR);
  await assert.rejects(repo.deleteExam(id, MANAGER_ACTOR), /Unpublish|Archive/);
  db = await repo.archive(id, MANAGER_ACTOR);
  assert.equal(find(db, id).status, 'archived');
  db = await repo.deleteExam(id, MANAGER_ACTOR);
  assert.equal(find(db, id), undefined, 'an archived, unanswered paper may be deleted');
  assert.equal(stored(env).exams.length, 0);
});

test('a paper somebody answered can be unpublished and archived, but never deleted', async () => {
  const env = setup();
  const id = await publishVia();
  clock = start;
  const db1 = await repo.startAttempt(id, one);
  const attempt = db1.attempts.find(item => item.examId === id && item.studentId === one.id);
  await repo.saveAnswer(attempt.id, one.id, 'q1', 'A');
  await assert.rejects(repo.unpublish(id, MANAGER_ACTOR), /Unpublish করা যাবে না/, 'a paper in flight cannot be pulled');
  await repo.finishAttempt(attempt.id, one.id);
  /* Pretend the Manager already released these results: republishing must not
     take that back. */
  const beforeRelease = JSON.parse(env.store.get(EXAM_KEY));
  beforeRelease.exams.find(exam => exam.id === id).resultsPublished = true;
  env.store.set(EXAM_KEY, JSON.stringify(beforeRelease));
  let db = await repo.unpublish(id, MANAGER_ACTOR);
  assert.equal(find(db, id).status, 'approved');
  assert.equal(db.attempts.length, 1, 'the saved answer is still there');
  await assert.rejects(repo.deleteExam(id, MANAGER_ACTOR), /মুছে ফেলা যাবে না/);
  db = await repo.archive(id, MANAGER_ACTOR);
  assert.equal(find(db, id).status, 'archived');
  assert.equal(db.attempts.length, 1);
  assert.equal(find(db, id).questions.length, 2, 'the questions are archived intact');
  await assert.rejects(repo.deleteExam(id, MANAGER_ACTOR), /মুছে ফেলা যাবে না/);
  clock = start - 3600000;
  db = await repo.restore(id, MANAGER_ACTOR);
  assert.equal(find(db, id).status, 'approved', 'a published paper comes back as approved, ready to publish again');
  db = await repo.publish(id, MANAGER_ACTOR);
  assert.equal(find(db, id).status, 'published');
  assert.equal(db.attempts.length, 1, 'republishing never drops an answer');
  assert.equal(find(db, id).resultsPublished, true, 'republishing never takes a released result back');
});

test('question edits keep a unique id per question and rebuild the paste template', async () => {
  setup();
  let db = await repo.saveDraft(fields());
  const id = db.exams[0].id;
  const exam = () => find(db, id);
  assert.deepEqual(exam().questions.map(question => question.uid), [`${id}-q1`, `${id}-q2`]);
  assert.equal(new Set(exam().questions.map(question => question.uid)).size, 2);
  assert.equal(exam().questions[0].examId, id);
  assert.equal(exam().questions[0].context.examDate, examDateFor('mcq', start));
  assert.equal(exam().questions[0].context.className, 'দশম শ্রেণি');

  db = await repo.updateQuestion(id, `${id}-q1`, { text: 'নতুন প্রশ্ন — রাজধানী?', answer: 'B' });
  assert.equal(exam().questions[0].text, 'নতুন প্রশ্ন — রাজধানী?');
  assert.equal(exam().questions[0].answer, 'B');
  assert.equal(questionSignature(parseQuestions(exam().template, 'mcq')), questionSignature(exam().questions), 'template and records still agree');
  assert.equal(exam().questions[0].uid, `${id}-q1`, 'editing keeps the question id');

  db = await repo.addQuestion(id, { text: 'তৃতীয় প্রশ্ন?', options: ['A', 'B', 'C', 'D'].map((cid, index) => ({ id: cid, text: `অপশন ${index + 1}` })), answer: 'A' });
  assert.equal(exam().questions.length, 3);
  assert.equal(totalMarks(exam()), 3, 'MCQ totals one mark per question');
  await assert.rejects(repo.addQuestion(id, { text: 'ভুল', options: [{ id: 'A', text: 'এক' }], answer: 'A' }), /চারটি অপশন/);

  db = await repo.deleteQuestion(id, `${id}-q2`);
  assert.deepEqual(exam().questions.map(question => question.uid), [`${id}-q1`, `${id}-q3`], 'the surviving questions keep their identity');
  assert.equal(questionSignature(parseQuestions(exam().template, 'mcq')), questionSignature(exam().questions));
  db = await repo.deleteQuestion(id, `${id}-q1`);
  assert.equal(exam().questions.length, 1);
  await assert.rejects(repo.deleteQuestion(id, `${id}-q3`), /অন্তত একটি প্রশ্ন/);

  /* A written paper keeps its own per-question marks and never stores options. */
  db = await repo.saveDraft(fields({ type: 'short', template: examTemplate('short'), title: 'সংক্ষিপ্ত' }));
  const writtenId = db.exams.find(exam => exam.type === 'short').id;
  db = await repo.updateQuestion(writtenId, `${writtenId}-q1`, { marks: 7 });
  const written = db.exams.find(exam => exam.id === writtenId);
  assert.equal(written.questions[0].marks, 7);
  assert.equal(written.questions[0].options, undefined);
  assert.equal(questionSignature(parseQuestions(written.template, 'short')), questionSignature(written.questions));

  /* Once published, the paper is frozen for good. */
  await repo.requestApproval(writtenId);
  db = await repo.publish(writtenId, MANAGER_ACTOR);
  await assert.rejects(repo.updateQuestion(writtenId, `${writtenId}-q1`, { text: 'x' }), /প্রশ্ন বদলানো যাবে না/);
  await assert.rejects(repo.deleteQuestion(writtenId, `${writtenId}-q1`), /প্রশ্ন বদলানো যাবে না/);
  await assert.rejects(repo.addQuestion(writtenId, { text: 'x', marks: 1 }), /প্রশ্ন বদলানো যাবে না/);
});

test('every question record carries its exam context; a legacy record keeps loading and gains a date', async () => {
  const env = setup();
  const legacy = {
    id: 'E-LEGACY-1', teacherId: TEACHER_ACTOR.id, teacherName: 'Test Teacher', status: 'draft', reviewNote: '',
    createdAt: clock, updatedAt: clock, participants: [], noteFromOldVersion: 'এই তথ্য মুছে যাবে না',
    ...fields({ startAt: start, endAt: end })
  };
  delete legacy.examDate; delete legacy.durationMinutes;
  legacy.questions = parseQuestions(legacy.template, 'mcq').map(question => {
    const copy = { ...question }; delete copy.uid; delete copy.examId; delete copy.context; return copy;
  });
  env.store.set(EXAM_KEY, JSON.stringify({ version: 1, exams: [legacy], attempts: [] }));

  let db = await repo.list(TEACHER_ACTOR);
  const exam = find(db, legacy.id);
  assert.equal(exam.examDate, examDateFor('mcq', start), 'the old record is placed by its own schedule');
  assert.equal(examDurationMinutes(exam), 60);
  assert.equal(exam.questions[0].uid, `${legacy.id}-q1`, 'a stable unique id is derived, not invented twice');
  const record = questionRecord(exam, exam.questions[0]);
  assert.deepEqual(
    ['examName', 'examDate', 'subject', 'className', 'totalQuestions', 'marks', 'totalMarks', 'duration', 'createdBy', 'createdAt', 'status', 'uid'].filter(key => record[key] === undefined || record[key] === ''),
    [], 'a question record answers with every field the school listed'
  );

  /* Saving an edit is additive: unknown fields and the question identity stay. */
  db = await repo.saveDraft({ ...fields({ startAt: start, endAt: end }), id: legacy.id, title: 'নতুন নাম' });
  const saved = find(db, legacy.id);
  assert.equal(saved.noteFromOldVersion, 'এই তথ্য মুছে যাবে না');
  assert.equal(saved.title, 'নতুন নাম');
  assert.equal(saved.questions[0].uid, `${legacy.id}-q1`);
  assert.equal(JSON.parse(env.store.get(EXAM_KEY)).exams[0].noteFromOldVersion, 'এই তথ্য মুছে যাবে না');
});

test('moving the exam to another date re-files the record under the new day', async () => {
  const env = setup();
  let db = await repo.saveDraft(fields());
  const id = db.exams[0].id;
  assert.equal(find(db, id).examDate, '2026-10-01');
  const nextDay = start + 86400000;
  db = await repo.reschedule(id, { startAt: nextDay, endAt: nextDay + 1800000 }, MANAGER_ACTOR);
  const exam = find(db, id);
  assert.equal(exam.examDate, examDateFor('mcq', nextDay));
  assert.equal(exam.durationMinutes, 30);
  assert.equal(exam.questions[0].context.examDate, exam.examDate, 'the questions move with their exam');
  assert.equal(groupExamsByDate([exam])[0].date, exam.examDate);
  await assert.rejects(repo.reschedule(id, { startAt: nextDay + 86400000 * 2, endAt: nextDay + 86400000 * 2 + 3600000 }, TEACHER_ACTOR), /Manager/);
  /* A class paper is sat the next class day — the date-wise record says so. */
  db = await repo.saveDraft(fields({ type: 'written', template: examTemplate('written'), startAt: start, endAt: end }));
  const written = db.exams.find(item => item.type === 'written');
  assert.equal(written.examDate, examDateFor('written', start));
  assert.notEqual(written.examDate, examDateFor('mcq', start));
  assert.equal(examDateOf(written), written.examDate);
  void env;
});

test('the student list only ever contains published or completed papers', async () => {
  setup();
  const id = await publishVia();
  const db = await repo.list();
  const statuses = { draft: 'draft', pending: 'pending', approved: 'approved', rejected: 'rejected' };
  for (const [status, expected] of Object.entries(statuses)) {
    const exam = { ...find(db, id), status };
    assert.equal(isStudentVisibleExam(exam), false, `${status} must stay invisible to students`);
    assert.equal(isStudentVisibleExam({ ...exam, status }), false);
    void expected;
  }
  assert.match(EXAM_STATUSES.completed, /সম্পন্ন/);
  assert.equal(isStudentVisibleExam({ ...find(db, id), status: 'completed' }), true);
  assert.equal(serializeQuestions(find(db, id).questions, 'mcq'), find(db, id).template, 'the stored template round-trips');
});
