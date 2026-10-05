/* Question Bank: permanent QUESTION-#### ids, the four question kinds, the
   universal search and the copy-not-link rule that keeps every examination
   self-contained (a bank row can never be orphaned by a deleted paper, and a
   deleted bank row can never damage a paper). */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { provisionStaff, seedStaffSession } from './staff-harness.mjs';
import {
  questionBank, searchQuestions, questionById, questionKey, questionForExam,
  listQuestionsForStaff, listQuestionsForStudent, cleanBankQuestion, questionBankStats,
  QUESTION_BANK_KEY, QUESTION_TYPES, bankIdFrom
} from '../js/question-bank.js';
import { examRepository, examTemplate, MANAGER_ACTOR, EXAM_KEY, TEACHER_ACTOR } from '../js/exam-data.js';
import { dhakaDateKey } from '../js/exam-core.js';
import { STORAGE_KEYS } from '../js/config.js';
import { STAFF_ACCOUNTS } from '../js/staff-auth.js';
import { TEACHER_ASSIGNMENTS_KEY } from '../js/teacher-assignments.js';

let ctx;
const store = () => ctx.window.localStorage;
const bank = () => JSON.parse(store().getItem(QUESTION_BANK_KEY) || '{"version":1,"questions":[]}');
const mcq = (extra = {}) => ({
  type: 'mcq', className: 'দশম শ্রেণি', subject: 'গণিত', chapterName: 'অধ্যায় ১', topic: 'বহুপদী',
  difficulty: 'easy', text: '২ + ২ = কত?',
  options: [{ id: 'A', text: '৩' }, { id: 'B', text: '৪' }, { id: 'C', text: '৫' }, { id: 'D', text: '৬' }],
  answer: 'B', ...extra
});
const written = (extra = {}) => ({
  type: 'written', className: 'দশম শ্রেণি', subject: 'গণিত', chapterName: 'অধ্যায় ২',
  text: 'সমীকরণটি সমাধান করুন।', marks: 5, answerText: 'x = ২', ...extra
});

before(async () => {
  ctx = await loadPage('index.html', { seed: { 'activePlus.demo.autofill.v1': 'off' } });
  await provisionStaff('manager');
  await provisionStaff('teacher');
  seedStaffSession(ctx.window, 'manager');
  seedStaffSession(ctx.window, 'teacher');
});
after(() => { ctx?.window?.close?.(); });

test('a saved question keeps a permanent QUESTION-#### code that is never reused', async () => {
  store().removeItem(QUESTION_BANK_KEY);
  const first = await questionBank.save(mcq(), 'MANAGER');
  const second = await questionBank.save(mcq({ text: '৩ × ৩ = কত?', options: [{ id: 'A', text: '৬' }, { id: 'B', text: '৯' }, { id: 'C', text: '১২' }, { id: 'D', text: '১৫' }], answer: 'B' }), 'MANAGER');
  assert.equal(first.id, 'QUESTION-0001');
  assert.equal(first.code, 'QUESTION-0001');
  assert.equal(second.id, 'QUESTION-0002');
  assert.equal(first.active, true);
  assert.equal(questionById('QUESTION-0001').text, '২ + ২ = কত?');
  /* Editing keeps the identity; deleting never hands the code to a new row. */
  const edited = await questionBank.patch('QUESTION-0001', { marks: 1, difficulty: 'hard', text: '২ + ৩ = কত?', options: [{ id: 'A', text: '৪' }, { id: 'B', text: '৫' }, { id: 'C', text: '৬' }, { id: 'D', text: '৭' }], answer: 'B' }, 'MANAGER');
  assert.equal(edited.id, 'QUESTION-0001');
  assert.equal(edited.difficulty, 'hard');
  await questionBank.remove('QUESTION-0001', 'MANAGER');
  const third = await questionBank.save(mcq({ text: '৫ × ২ = কত?', options: [{ id: 'A', text: '৭' }, { id: 'B', text: '১০' }, { id: 'C', text: '১২' }, { id: 'D', text: '১৫' }], answer: 'B' }), 'MANAGER');
  assert.equal(third.id, 'QUESTION-0003', 'the removed code is not recycled');
  assert.equal(bankIdFrom(bank().questions), 'QUESTION-0004');
  assert.equal(bank().version, 1);
});

test('every question kind is validated in its own terms', async () => {
  store().removeItem(QUESTION_BANK_KEY);
  await assert.rejects(questionBank.save(mcq({ options: [{ id: 'A', text: '১' }, { id: 'B', text: '২' }] })), /চারটি অপশন/);
  await assert.rejects(questionBank.save(mcq({ answer: 'E' })), /চারটি অপশন/);
  await assert.rejects(questionBank.save(mcq({ text: '' })), /প্রশ্নের লেখা/);
  await assert.rejects(questionBank.save({ type: 'true_false', text: 'পৃথিবী গোল', marks: 1 }), /সত্য\/মিথ্যা/);
  await assert.rejects(questionBank.save({ type: 'short_answer', text: 'সংজ্ঞা লিখুন', marks: 0 }), /নম্বর/);
  const tf = await questionBank.save({ type: 'true_false', text: 'পৃথিবী গোল', className: 'দশম শ্রেণি', subject: 'বিজ্ঞান', marks: 1, answer: 'সত্য' }, 'MANAGER');
  const short = await questionBank.save({ type: 'short_answer', text: 'সংজ্ঞা লিখুন', className: 'দশম শ্রেণি', subject: 'বিজ্ঞান', marks: 2, answerText: 'নির্দিষ্ট উত্তর' }, 'MANAGER');
  assert.equal(tf.answerText, 'সত্য');
  assert.equal(tf.marks, 1);
  assert.equal(short.marks, 2);
  assert.equal(Object.keys(QUESTION_TYPES).length, 4);
  assert.throws(() => questionForExam(tf, 'mcq'), /শুধু চার অপশনের MCQ/);
  assert.deepEqual(Object.keys(questionForExam(short, 'short')).sort(), ['answerText', 'marks', 'text']);
});

test('the universal search covers code, class, subject, chapter, topic, type and date', async () => {
  store().removeItem(QUESTION_BANK_KEY);
  const rows = [
    mcq({ text: 'বাংলা ব্যাকরণের প্রশ্ন', subject: 'বাংলা', chapterName: 'ব্যাকরণ', topic: 'সন্ধি', difficulty: 'easy' }),
    mcq({ text: 'ইংরেজি গ্রামারের প্রশ্ন', subject: 'ইংরেজি', chapterName: 'Grammar', topic: 'Tense', difficulty: 'hard', options: [{ id: 'A', text: 'am' }, { id: 'B', text: 'is' }, { id: 'C', text: 'are' }, { id: 'D', text: 'be' }], answer: 'B' }),
    written({ text: 'জ্যামিতির প্রমাণ', subject: 'গণিত', chapterName: 'জ্যামিতি', topic: 'ত্রিভুজ' })
  ];
  for (const row of rows) await questionBank.save(row, 'MANAGER');
  assert.equal(searchQuestions({}).total, 3);
  assert.equal(searchQuestions({ query: 'QUESTION-0002' }).rows[0].topic, 'Tense');
  assert.equal(searchQuestions({ subject: 'বাংলা' }).total, 1);
  assert.equal(searchQuestions({ className: 'দশম শ্রেণি', subject: 'গণিত' }).total, 1);
  assert.equal(searchQuestions({ chapterName: 'জ্যামিতি' }).total, 1);
  assert.equal(searchQuestions({ topic: 'সন্ধি' }).total, 1);
  assert.equal(searchQuestions({ type: 'written' }).total, 1);
  assert.equal(searchQuestions({ difficulty: 'hard' }).rows[0].topic, 'Tense');
  assert.equal(searchQuestions({ query: 'জ্যামিতির' }).total, 1, 'free text finds the question body');
  assert.equal(searchQuestions({ query: 'grammar tense' }).total, 1, 'every term must match');
  assert.equal(searchQuestions({ query: 'grammar সন্ধি' }).total, 0);
  const today = dhakaDateKey();
  assert.equal(searchQuestions({ from: today, to: today }).total, 3);
  assert.equal(searchQuestions({ from: '2000-01-01', to: '2000-01-02' }).total, 0);
  /* Paging keeps a thousand-question shelf out of the DOM. */
  const page = searchQuestions({ limit: 2 });
  assert.equal(page.rows.length, 2);
  assert.equal(page.total, 3);
  assert.equal(searchQuestions({ limit: 2, offset: 2 }).rows.length, 1);
  const stats = questionBankStats();
  assert.equal(stats.total, 3);
  assert.deepEqual(stats.byType, { mcq: 2, written: 1 });
});

test('shelving a paper copies the questions and skips what is already shelved', async () => {
  store().removeItem(QUESTION_BANK_KEY);
  store().removeItem(EXAM_KEY);
  const saved = await examRepository.saveDraft({
    title: 'গণিত মূল্যায়ন', subject: 'গণিত', className: 'দশম শ্রেণি', type: 'mcq',
    startAt: Date.parse('2026-11-01T10:00:00+06:00'), endAt: Date.parse('2026-11-01T11:00:00+06:00'),
    lateMinutes: 10, negative: 0, passPercent: 33, template: examTemplate('mcq')
  }, MANAGER_ACTOR);
  const exam = saved.exams[0];
  assert.ok(exam.code, 'the paper carries an Exam Code');
  const examBefore = store().getItem(EXAM_KEY);
  const result = await questionBank.saveFromExam(exam, 'MANAGER');
  assert.equal(result.added, exam.questions.length);
  const shelved = searchQuestions({ examId: exam.id });
  assert.equal(shelved.total, exam.questions.length);
  assert.ok(shelved.rows.every(row => row.source.examCode === exam.code));
  assert.equal(store().getItem(EXAM_KEY), examBefore, 'shelving a question never edits the paper');
  const again = await questionBank.saveFromExam(exam, 'MANAGER');
  assert.deepEqual({ added: again.added, skipped: again.skipped }, { added: 0, skipped: exam.questions.length }, 'pressing আবার saves nothing twice');
  assert.equal(questionKey(shelved.rows[0]), questionKey(shelved.rows[0]));
  assert.notEqual(questionKey(shelved.rows[0]), questionKey(shelved.rows[1]));
});

test('a bank question enters a paper as a real exam question, never as a pointer', async () => {
  store().removeItem(QUESTION_BANK_KEY);
  store().removeItem(EXAM_KEY);
  const row = await questionBank.save(mcq({ text: 'বাংলাদেশের রাজধানী কোনটি?', options: [{ id: 'A', text: 'ঢাকা' }, { id: 'B', text: 'চট্টগ্রাম' }, { id: 'C', text: 'খুলনা' }, { id: 'D', text: 'রাজশাহী' }], answer: 'A' }), 'MANAGER');
  let db = await examRepository.saveDraft({
    title: 'বাংলা মূল্যায়ন', subject: 'বাংলা', className: 'দশম শ্রেণি', type: 'mcq',
    startAt: Date.parse('2026-11-02T10:00:00+06:00'), endAt: Date.parse('2026-11-02T11:00:00+06:00'),
    lateMinutes: 10, negative: 0, passPercent: 33, template: examTemplate('mcq')
  }, MANAGER_ACTOR);
  const exam = db.exams[0];
  db = await examRepository.addQuestion(exam.id, questionForExam(row, 'mcq'), MANAGER_ACTOR);
  const updated = db.exams[0];
  assert.equal(updated.questions.length, exam.questions.length + 1);
  assert.equal(updated.questions.at(-1).answer, 'A');
  assert.ok(updated.questions.at(-1).uid, 'the paper owns its own question identity');
  db = await examRepository.list(MANAGER_ACTOR);
  assert.equal(db.exams[0].questions.at(-1).text, row.text, 'the paper re-reads cleanly from storage');
  /* Deleting the bank row must not touch the paper that used it. */
  const storedExam = JSON.parse(store().getItem(EXAM_KEY)).exams[0];
  await questionBank.remove(row.id, 'MANAGER');
  const afterDelete = JSON.parse(store().getItem(EXAM_KEY)).exams[0];
  assert.deepEqual(afterDelete.questions, storedExam.questions);
  /* A non-MCQ shelf row still becomes a valid written question. */
  store().removeItem(EXAM_KEY);
  const writtenRow = await questionBank.save(written(), 'MANAGER');
  let paper = await examRepository.saveDraft({
    title: 'সৃজনশীল মূল্যায়ন', subject: 'গণিত', className: 'দশম শ্রেণি', type: 'written',
    startAt: Date.parse('2026-11-03T10:00:00+06:00'), endAt: Date.parse('2026-11-03T11:00:00+06:00'),
    passPercent: 33, template: examTemplate('written')
  }, MANAGER_ACTOR);
  paper = await examRepository.addQuestion(paper.exams[0].id, questionForExam(writtenRow, 'written'), MANAGER_ACTOR);
  assert.equal(paper.exams[0].questions.at(-1).answerText, 'x = ২');
  assert.deepEqual((await examRepository.list(MANAGER_ACTOR)).exams[0].questions.at(-1).answerText, 'x = ২');
  assert.equal((await examRepository.list(TEACHER_ACTOR)).exams.length, 0, 'a Teacher still sees only their own papers');
});

test('switching a question off hides it from new work but keeps it stored', async () => {
  store().removeItem(QUESTION_BANK_KEY);
  const row = await questionBank.save(mcq(), 'MANAGER');
  await questionBank.setActive(row.id, false, 'MANAGER');
  assert.equal(searchQuestions({ includeInactive: false }).total, 0);
  assert.equal(searchQuestions({ active: true }).total, 0);
  assert.equal(searchQuestions({}).total, 1, 'history keeps the question');
  assert.equal(questionById(row.id).text, row.text);
  await questionBank.setActive(row.id, true, 'MANAGER');
  assert.equal(searchQuestions({ active: true }).total, 1);
  await assert.rejects(questionBank.remove('QUESTION-9999'), /খুঁজে পাওয়া যায়নি/);
  assert.throws(() => cleanBankQuestion({ type: 'mcq', text: 'x', options: [], answer: 'A' }), /চারটি অপশন/);
});

test('Question Bank writes enforce staff role and Teacher assignments; Student reads stay batch/class isolated', async () => {
  store().removeItem(QUESTION_BANK_KEY);
  store().setItem(TEACHER_ASSIGNMENTS_KEY, JSON.stringify([{
    id: 'ASSIGNMENT-QB-1', teacherUsername: STAFF_ACCOUNTS.teacher.username, teacherName: 'পরীক্ষক শিক্ষক',
    className: 'দশম শ্রেণি', group: 'Batch A', subjects: ['গণিত']
  }]));

  const batchA = await questionBank.save(mcq({ group: 'Batch A', text: 'Batch A-র অনুশীলনী' }), 'MANAGER');
  const classWide = await questionBank.save(mcq({ group: '', text: 'সবার গণিত অনুশীলনী' }), 'MANAGER');
  const batchB = await questionBank.save(mcq({ group: 'Batch B', text: 'Batch B-র অনুশীলনী' }), 'MANAGER');
  const otherClass = await questionBank.save(mcq({ className: 'একাদশ শ্রেণি', group: 'বিজ্ঞান', text: 'একাদশের অনুশীলনী' }), 'MANAGER');
  const inactive = await questionBank.save(mcq({ group: 'Batch A', text: 'নিষ্ক্রিয় অনুশীলনী' }), 'MANAGER');
  await questionBank.setActive(inactive.id, false, 'MANAGER');

  const teacherRows = await listQuestionsForStaff('teacher');
  assert.ok(teacherRows.length >= 1);
  assert.ok(teacherRows.every(row => row.className === 'দশম শ্রেণি' && row.subject === 'গণিত' && row.group === 'Batch A'),
    'Teacher bank reads are restricted to the assigned class, batch and subject');
  const teacherWrite = await questionBank.save(mcq({ group: 'Batch A', text: 'শিক্ষকের নতুন প্রশ্ন' }), 'Teacher');
  assert.equal(teacherWrite.createdBy, 'teacher.apc');
  await assert.rejects(questionBank.save(mcq({ group: 'Batch B', text: 'ভুল ব্যাচের প্রশ্ন' }), 'Teacher'), { code: 'ACCESS_DENIED' });
  await assert.rejects(questionBank.save(mcq({ className: 'একাদশ শ্রেণি', group: 'বিজ্ঞান', text: 'ভুল শ্রেণির প্রশ্ন' }), 'Teacher'), { code: 'ACCESS_DENIED' });

  const managerSession = store().getItem(STAFF_ACCOUNTS.manager.sessionKey);
  store().removeItem(STAFF_ACCOUNTS.manager.sessionKey);
  await assert.rejects(questionBank.save(mcq({ text: 'কোনো Manager session ছাড়া' }), 'MANAGER'), { code: 'ACCESS_DENIED' });
  store().setItem(STAFF_ACCOUNTS.manager.sessionKey, managerSession);
  await assert.rejects(questionBank.save(mcq({ text: 'শিক্ষার্থী লিখতে পারবে না' }), 'STUDENT'), { code: 'ACCESS_DENIED' });
  await assert.rejects(listQuestionsForStaff('admin'), { code: 'ACCESS_DENIED' });

  const student = { id: 'STU-QB-A', name: 'ব্যাচ A', className: 'দশম শ্রেণি', group: 'Batch A' };
  store().setItem(STORAGE_KEYS.account, JSON.stringify({ status: 'active', student }));
  ctx.window.sessionStorage.setItem(STORAGE_KEYS.session, '1');
  const delivered = await listQuestionsForStudent(student.id);
  const deliveredIds = new Set(delivered.map(row => row.id));
  assert.equal(deliveredIds.has(batchA.id), true);
  assert.equal(deliveredIds.has(classWide.id), true, 'unbatched class material is available to the class');
  assert.equal(deliveredIds.has(teacherWrite.id), true);
  assert.equal(deliveredIds.has(batchB.id), false, 'another batch does not receive the question');
  assert.equal(deliveredIds.has(otherClass.id), false, 'another class does not receive the question');
  assert.equal(deliveredIds.has(inactive.id), false, 'inactive questions are not delivered');

  const otherStudent = { id: 'STU-QB-OTHER', name: 'অন্য শ্রেণি', className: 'একাদশ শ্রেণি', group: 'বিজ্ঞান' };
  store().setItem(STORAGE_KEYS.account, JSON.stringify({ status: 'active', student: otherStudent }));
  assert.deepEqual((await listQuestionsForStudent(otherStudent.id)).map(row => row.id), [otherClass.id], 'another Student sees only their class and batch');
  await assert.rejects(listQuestionsForStudent(student.id), { code: 'ACCESS_DENIED' }, 'a caller cannot request the first Student while signed in as the second');
});
