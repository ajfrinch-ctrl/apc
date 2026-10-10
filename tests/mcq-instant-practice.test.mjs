/* Instant MCQ practice + the automatic shelf rule (user request, 2026-10-03):
   • an MCQ paper can be sat instantly, as self-study, at any moment — no
     schedule, no late window, no roster — under a one-minute-per-question
     timer (the sheet auto-submits when it runs out), and is marked on the
     spot with the correct answer beside every question;
   • every MCQ examination the students have actually sat is kept in the
     question bank: auto-shelved the moment it is published, and backfilled
     (without duplicates) for papers that predate the rule;
   • a student can practise those past papers from the bank in the future —
     but only after the paper's official window has ended, so an upcoming
     exam's questions can never be drilled early;
   • practice sessions never touch the official attempt store, so they can
     never move a real result, a rank, or a retry.
   Drives the real modules in jsdom: the repository (js/exam-data.js), the
   shelf (js/question-bank.js) and the student practice UI
   (js/student-practice.js) on index.html. The contexts bootstrap lazily and
   in order, because the app modules read the globals of whichever window
   was loaded last. */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { provisionStaff, seedStaffSession } from './staff-harness.mjs';
import { examRepository as repo, validateExam, EXAM_KEY, MANAGER_ACTOR } from '../js/exam-data.js';
import { KEYS } from '../js/database.js';
import { STORAGE_KEYS } from '../js/config.js';
import { questionBank, listQuestions, ensureExamsInBank, QUESTION_BANK_KEY } from '../js/question-bank.js';
import { initStudentPractice } from '../js/student-practice.js';

const PRACTICE_KEY = 'activePlus.mcqPractice.v1';
const H = 3600000, D = 86400000;
const TPL = [
  'প্রশ্ন: বাংলাদেশের রাজধানী কোনটি?', 'A: ঢাকা', 'B: চট্টগ্রাম', 'C: খুলনা', 'D: রাজশাহী', 'উত্তর: A',
  '---',
  'প্রশ্ন: ৫ + ৭ = কত?', 'A: ১১', 'B: ১২', 'C: ১৩', 'D: ১৪', 'উত্তর: B',
  '---',
  'প্রশ্ন: পানির রাসায়নিক সংকেত কোনটি?', 'A: CO2', 'B: H2O', 'C: NaCl', 'D: O2', 'উত্তর: B'
].join('\n');
const TPL2 = [
  'প্রশ্ন: মানবদেহের সবচেয়ে বড় অঙ্গ কোনটি?', 'A: যকৃত', 'B: ত্বক', 'C: হৃৎপিণ্ড', 'D: ফুসফুস', 'উত্তর: B',
  '---',
  'প্রশ্ন: বলের একক কী?', 'A: জুল', 'B: ওয়াট', 'C: নিউটন', 'D: প্যাসকেল', 'উত্তর: C'
].join('\n');

const student = { id: 'AP-PRA-1', name: 'অনুশীলন শিক্ষার্থী', className: 'দশম শ্রেণি', group: '' };
function makeExam({ id, title, status, startOffset, endOffset, template = TPL, className = 'দশম শ্রেণি', participants = [] }) {
  const now = Date.now();
  return {
    ...validateExam({
      type: 'mcq', title, subject: 'গণিত', className, group: '',
      startAt: now + startOffset, endAt: now + endOffset, lateMinutes: 15, negative: 0.5, passPercent: 33, template
    }),
    id, teacherId: 'DEMO-TEACHER', teacherName: 'Demo Teacher', status,
    resultsPublished: false, participants, createdAt: now - 5000, updatedAt: now - 5000
  };
}
/* One seed set for the whole UI section: the timestamps are fixed once, so
   the assertions can compare against the exact records the page received. */
const UI_EXAMS = [
  makeExam({ id: 'EX-PAST', title: 'গত গণিত MCQ পরীক্ষা', status: 'completed', startOffset: -26 * H, endOffset: -25 * H, participants: [student] }),
  makeExam({ id: 'EX-FUTURE', title: 'আসন্ন গণিত MCQ পরীক্ষা', status: 'published', startOffset: 2 * H, endOffset: 3 * H, template: TPL2, participants: [student] }),
  makeExam({ id: 'EX-OTHER', title: 'অন্য শ্রেণির MCQ পরীক্ষা', status: 'completed', startOffset: -26 * H, endOffset: -25 * H, className: 'একাদশ শ্রেণি', participants: [student] })
];
const uiExams = () => UI_EXAMS;

const windows = [];
async function loadApp(seed = {}) {
  const context = await loadPage('index.html', { seed: { 'activePlus.demo.autofill.v1': 'off', ...seed } });
  windows.push(context);
  return context;
}
function seedStudentSession(context) {
  context.window.localStorage.setItem(STORAGE_KEYS.account, JSON.stringify({ status: 'active', student }));
  context.window.sessionStorage.setItem(STORAGE_KEYS.session, '1');
}
after(() => { for (const context of windows) context?.window.close?.(); });

/* The app modules read the current globals, so each section boots its own
   page on first use and the sections stay strictly ordered. */
let ctx, uiCtx, uiReady = false, uiBankInitially = null;
async function repoContext() {
  if (ctx) return ctx;
  ctx = await loadApp();
  await provisionStaff('manager');
  seedStaffSession(ctx.window, 'manager');
  return ctx;
}
async function uiContext() {
  if (uiReady) return uiCtx;
  uiCtx = await loadApp({ [EXAM_KEY]: JSON.stringify({ version: 1, exams: uiExams(), attempts: [] }) });
  seedStudentSession(uiCtx);
  uiBankInitially = uiCtx.window.localStorage.getItem(QUESTION_BANK_KEY);
  initStudentPractice({ getStudent: () => student, getAccount: () => ({ status: 'active' }) });
  await uiCtx.waitFor(() => Boolean(uiCtx.$('#studentPracticeWorkspace [data-practice-action="start-paper"]')));
  uiReady = true;
  return uiCtx;
}
const bankRows = () => listQuestions();
const seedExams = exams => window.localStorage.setItem(EXAM_KEY, JSON.stringify({ version: 1, exams, attempts: [] }));
const bankCount = () => JSON.parse(window.localStorage.getItem(QUESTION_BANK_KEY) || '{"questions":[]}').questions.length;

/* ---------- the shelf rule, driven through the real repository ------------- */

test('a published MCQ examination is shelved into the bank the moment it goes live', async () => {
  await repoContext();
  const exam = makeExam({ id: 'EX-BANK-1', title: 'স্বয়ংক্রিয় ব্যাংক পরীক্ষা ১', status: 'draft', startOffset: 2 * D, endOffset: 2 * D + 3 * H });
  seedExams([exam]);
  await repo.review('EX-BANK-1', 'publish', {}, MANAGER_ACTOR);
  const rows = bankRows().filter(row => row.source?.examId === 'EX-BANK-1');
  assert.equal(rows.length, 3, 'every question of the paper is on the shelf');
  for (const row of rows) {
    assert.equal(row.type, 'mcq');
    assert.equal(row.className, 'দশম শ্রেণি');
    assert.equal(row.endAt, exam.endAt, 'the row remembers the paper’s window end');
    assert.equal(row.options.length, 4);
  }
});

test('the same questions sitting in another paper never duplicate the shelf', async () => {
  await repoContext();
  const stored = JSON.parse(window.localStorage.getItem(EXAM_KEY));
  const before = bankCount();
  const duplicate = makeExam({ id: 'EX-BANK-2', title: 'একই প্রশ্নের পুনরাবৃত্ত পরীক্ষা', status: 'draft', startOffset: 3 * D, endOffset: 3 * D + 3 * H });
  stored.exams.push(duplicate);
  seedExams(stored.exams);
  await repo.review('EX-BANK-2', 'publish', {}, MANAGER_ACTOR);
  assert.equal(bankCount(), before, 'content identity keeps the shelf from doubling');
});

test('the backfill shelves past papers and completes legacy rows without duplicating them', async () => {
  await repoContext();
  const stored = JSON.parse(window.localStorage.getItem(EXAM_KEY));
  /* A row shelved by hand before the practice build: right content, no exam
     metadata. The backfill must complete it, not re-shelve it. */
  const legacy = await questionBank.save({
    type: 'mcq', className: 'দশম শ্রেণি', subject: 'গণিত', text: 'মানবদেহের সবচেয়ে বড় অঙ্গ কোনটি?',
    options: [{ id: 'A', text: 'যকৃত' }, { id: 'B', text: 'ত্বক' }, { id: 'C', text: 'হৃৎপিণ্ড' }, { id: 'D', text: 'ফুসফুস' }],
    answer: 'B'
  }, 'MANAGER');
  assert.equal(legacy.endAt, 0, 'a standalone row has no exam window');
  const before = bankCount();
  const past = makeExam({ id: 'EX-BANK-3', title: 'গত পরীক্ষা — অনুশীলনের জন্য', status: 'published', startOffset: -26 * H, endOffset: -25 * H, template: TPL2 });
  stored.exams.push(past);
  seedExams(stored.exams);
  const result = await ensureExamsInBank(stored.exams, 'Manager');
  assert.equal(result.added, 1, 'only the missing question is shelved');
  assert.ok(result.updated >= 1, 'the legacy row is completed in place');
  const patched = bankRows().find(row => row.id === legacy.id);
  assert.equal(patched.startAt, past.startAt, 'the legacy row now carries the window start');
  assert.equal(patched.endAt, past.endAt, '…and the window end');
  assert.equal(patched.source?.examId, 'EX-BANK-3', '…and the paper it came from');
  assert.equal(bankCount(), before + 1, 'no duplicate rows were created');
  const again = await ensureExamsInBank(stored.exams, 'Manager');
  assert.deepEqual(again, { exams: 0, added: 0, updated: 0 }, 'a current shelf is a no-op — no write at all');
});

/* ---------- the student practice lane on index.html ------------------------- */
const $2 = sel => uiCtx.$(sel);
const $$2 = sel => uiCtx.$$(sel);
const workspace = () => $2('#studentPracticeWorkspace');
const practiceStore = () => JSON.parse(uiCtx.window.localStorage.getItem(PRACTICE_KEY) || '{}')[student.id];

test('the practice list offers only this student’s papers whose window has ended', async () => {
  await uiContext();
  const text = workspace().textContent;
  assert.match(text, /গত গণিত MCQ পরীক্ষা/, 'the finished paper is offered');
  assert.doesNotMatch(text, /আসন্ন গণিত MCQ পরীক্ষা/, 'an upcoming paper’s questions never leak');
  assert.doesNotMatch(text, /অন্য শ্রেণির MCQ পরীক্ষা/, 'another class’s paper stays out of this student’s lane');
  assert.equal($$2('#studentPracticeWorkspace [data-practice-action="start-paper"]').length, 1);
  assert.match($$2('#studentPracticeWorkspace [data-practice-action="start-random"]')[0].textContent, /৩টি প্রশ্ন • ৩ মিনিট/, 'the random drill sizes itself to the bank and its pace');
  assert.match(workspace().textContent, /গত গণিত MCQ পরীক্ষা[\s\S]*৩ মিনিট/, 'the paper card prices its sheet at one minute a question');
  assert.equal(uiCtx.window.localStorage.getItem(QUESTION_BANK_KEY), uiBankInitially,
    'a Student may practise from their scoped exam snapshot but never writes the shared Question Bank');
});

test('chapter MCQ practice filters the shared bank and records a personal chapter result', async () => {
  await uiContext();
  const now = Date.now();
  const qbankBefore = uiCtx.window.localStorage.getItem(QUESTION_BANK_KEY);
  const practiceBefore = uiCtx.window.localStorage.getItem(PRACTICE_KEY);
  const db = JSON.parse(qbankBefore || '{"version":1,"questions":[]}');
  const makeQuestion = (id, { chapterName = 'বাস্তব সংখ্যা', subject = 'গণিত', source = null, endAt = 0, active = true } = {}) => ({
    id, className: student.className, subject, chapterName, chapterId: '', topic: '', type: 'mcq',
    text: `${id} — অনুশীলনের প্রশ্ন`, options: [{ id: 'A', text: 'সঠিক' }, { id: 'B', text: 'ভুল ১' }, { id: 'C', text: 'ভুল ২' }, { id: 'D', text: 'ভুল ৩' }],
    answer: 'A', marks: 1, source, startAt: source ? endAt - H : 0, endAt, active
  });
  db.questions.push(
    makeQuestion('Q-CHAPTER-TEACHER'),
    makeQuestion('Q-CHAPTER-PAST', { source: { examId: 'EX-CHAPTER-PAST', examTitle: 'গত পরীক্ষা' }, endAt: now - H }),
    makeQuestion('Q-CHAPTER-FUTURE', { source: { examId: 'EX-CHAPTER-FUTURE', examTitle: 'আসন্ন পরীক্ষা' }, endAt: now + H }),
    makeQuestion('Q-CHAPTER-OTHER', { chapterName: 'বীজগণিত' }),
    makeQuestion('Q-CHAPTER-INACTIVE', { active: false }),
    makeQuestion('Q-CHAPTER-OTHER-SUBJECT', { subject: 'বাংলা' })
  );
  uiCtx.window.localStorage.setItem(QUESTION_BANK_KEY, JSON.stringify(db));
  await uiCtx.window.apcStudentPractice.openChapter({
    className: student.className, subject: 'গণিত', chapterId: 'CONTENT-REAL-NUMBERS',
    chapterName: 'অধ্যায় ১ — বাস্তব সংখ্যা'
  });
  await uiCtx.waitFor(() => Boolean($2('#studentPracticeWorkspace [data-practice-action="start-chapter"]')));
  const text = workspace().textContent;
  assert.match(text, /২টি প্রশ্ন/, 'standalone and completed-paper questions are included');
  assert.doesNotMatch(text, /Q-CHAPTER-FUTURE|Q-CHAPTER-OTHER|Q-CHAPTER-INACTIVE|Q-CHAPTER-OTHER-SUBJECT/);
  ctx2click($2('#studentPracticeWorkspace [data-practice-action="start-chapter"]'));
  await uiCtx.waitFor(() => $$2('#studentPracticeWorkspace .exam-question').length === 2);
  assert.match(workspace().textContent, /অধ্যায় ১ — বাস্তব সংখ্যা — MCQ Practice/);
  ctx2click($2('#studentPracticeWorkspace [data-practice-action="confirm"]'));
  ctx2click($2('#studentPracticeWorkspace [data-practice-action="finish"]'));
  await uiCtx.waitFor(() => Boolean($2('#studentPracticeWorkspace .exam-summary')));
  const saved = practiceStore();
  assert.equal(saved.sessions[0].kind, 'chapter');
  assert.equal(saved.sessions[0].chapterId, 'CONTENT-REAL-NUMBERS');
  assert.equal(saved.sessions[0].subject, 'গণিত');
  assert.equal(JSON.parse(uiCtx.window.localStorage.getItem(EXAM_KEY)).attempts.length, 0, 'chapter practice does not touch official attempts');

  /* This test is part of a longer shared practice-lane story; restore its
     fixture and clear the in-memory chapter context for the following tests. */
  await uiCtx.window.apcStudentPractice.openChapter(null);
  if (qbankBefore === null) uiCtx.window.localStorage.removeItem(QUESTION_BANK_KEY);
  else {
    const restoredBank = JSON.parse(qbankBefore);
    restoredBank.questions = restoredBank.questions.filter(row => !String(row.id).startsWith('Q-CHAPTER-'));
    uiCtx.window.localStorage.setItem(QUESTION_BANK_KEY, JSON.stringify(restoredBank));
  }
  if (practiceBefore === null) uiCtx.window.localStorage.removeItem(PRACTICE_KEY);
  else uiCtx.window.localStorage.setItem(PRACTICE_KEY, practiceBefore);
  await uiCtx.window.apcStudentPractice.refresh();
});

test('a paper is sat instantly — no clock, no window — and marked on the spot', async () => {
  await uiContext();
  ctx2click($2('#studentPracticeWorkspace [data-practice-action="start-paper"]'));
  await uiCtx.waitFor(() => $$2('#studentPracticeWorkspace .exam-question').length === 3);
  const clock = $2('#studentPracticeWorkspace [data-practice-clock]');
  assert.ok(clock, 'the sheet runs under a clock, like the real exam');
  assert.equal($2('#studentPracticeWorkspace [data-exam-clock]'), null, '…under its own clock, not the official one');
  assert.equal($2('#studentPracticeWorkspace .exam-timer--pinned'), null, 'only an official live exam pins its timer bar');
  assert.match($2('#studentPracticeWorkspace .exam-timer').textContent, /৩ মিনিট/, 'three questions price the sheet at three minutes');
  assert.match(clock.textContent, /সময় বাকি (৩:০০|২:[০-৯]{2})/, 'the countdown is live, from three minutes');
  assert.equal(clock.dataset.lowTime, 'false', 'not yet in the low-time band (half of three minutes)');

  /* Slide the clock into the low-time band (30s left on a 3-minute sheet):
     the flag and the warning appear — then back out again. */
  {
    const realNow = Date.now, realWinNow = uiCtx.window.Date.now;
    const endsAt = practiceStore().active.endsAt;
    let offset = endsAt - realNow() - 30000;
    let fakeNow = () => realNow() + offset;
    Date.now = fakeNow; uiCtx.window.Date.now = fakeNow;
    try {
      await uiCtx.waitFor(() => $2('#studentPracticeWorkspace [data-practice-clock]')?.dataset.lowTime === 'true', 5000);
      const hint = $2('#studentPracticeWorkspace [data-low-hint]');
      assert.equal(hint.hidden, false, 'the warning is visible');
      assert.match(hint.textContent, /জমা হবে/, '…and it says the paper will submit itself');
      offset = endsAt - realNow() - 120000;
      fakeNow = () => realNow() + offset;
      Date.now = fakeNow; uiCtx.window.Date.now = fakeNow;
      await uiCtx.waitFor(() => $2('#studentPracticeWorkspace [data-practice-clock]')?.dataset.lowTime === 'false', 5000);
    } finally {
      Date.now = realNow; uiCtx.window.Date.now = realWinNow;
    }
  }

  const pick = async (fragment, option) => {
    const fieldset = $$2('#studentPracticeWorkspace .exam-question').find(node => node.textContent.includes(fragment));
    const input = fieldset.querySelector(`[data-practice-answer][value="${option}"]`);
    input.checked = true;
    input.dispatchEvent(new uiCtx.window.Event('change', { bubbles: true }));
    await uiCtx.waitFor(() => input.checked === true);
  };
  await pick('রাজধানী', 'A');  // correct
  await pick('৫ + ', 'C');   // wrong (the answer is B)
  // the third question is left unanswered

  ctx2click($2('#studentPracticeWorkspace [data-practice-action="confirm"]'));
  await uiCtx.waitFor(() => !$2('#studentPracticeWorkspace [data-practice-confirm]').hidden);
  ctx2click($2('#studentPracticeWorkspace [data-practice-action="finish"]'));
  await uiCtx.waitFor(() => Boolean($2('#studentPracticeWorkspace .exam-summary')));

  const summary = $2('#studentPracticeWorkspace .exam-summary').textContent;
  assert.match(summary, /১ \/ ৩/, 'one correct out of three');
  assert.match(summary, /৩৩%/, 'the percentage is instant, not scheduled');
  assert.match(summary, /সঠিক ১/);
  assert.match(summary, /ভুল ১/);
  assert.match(summary, /অনুত্তরিত ১/);
  const reviews = $$2('#studentPracticeWorkspace .practice-review .exam-question');
  assert.equal(reviews.length, 3);
  assert.ok(reviews.find(node => node.classList.contains('practice-correct') && node.textContent.includes('রাজধানী')));
  assert.ok(reviews.find(node => node.classList.contains('practice-wrong') && node.textContent.includes('৫ + ')));
  assert.ok(reviews.find(node => node.classList.contains('practice-skip') && node.textContent.includes('পানির')));
  for (const node of reviews) assert.match(node.textContent, /সঠিক উত্তর:/, 'every question shows the correct answer');

  const official = JSON.parse(uiCtx.window.localStorage.getItem(EXAM_KEY));
  assert.equal(official.attempts.length, 0, 'practice never touches the official attempt store');
  const record = practiceStore().sessions[0];
  assert.equal(record.total, 3);
  assert.equal(record.score, 1);
  assert.equal(practiceStore().active, null, 'a finished sheet is no longer in flight');
});

test('when the timer hits zero the sheet submits itself and the result appears', async () => {
  await uiContext();
  ctx2click($2('#studentPracticeWorkspace [data-practice-action="list"]'));
  await uiCtx.waitFor(() => Boolean($2('#studentPracticeWorkspace [data-practice-action="start-paper"]')));
  ctx2click($2('#studentPracticeWorkspace [data-practice-action="start-paper"]'));
  await uiCtx.waitFor(() => $$2('#studentPracticeWorkspace .exam-question').length === 3);
  const inFlight = practiceStore().active;
  assert.ok(Number.isFinite(inFlight.endsAt) && inFlight.endsAt > Date.now(), 'the in-flight sheet carries an absolute deadline');

  /* Move the wall clock just past the deadline, the way minutes would: the
     one-second heartbeat then finds time up and closes the sheet itself. */
  const realNow = Date.now;
  const realWindowNow = uiCtx.window.Date.now;
  const offset = inFlight.endsAt - realNow() + 1500;
  const fakeNow = () => realNow() + offset;
  Date.now = fakeNow;
  uiCtx.window.Date.now = fakeNow;
  try {
    await uiCtx.waitFor(() => Boolean($2('#studentPracticeWorkspace .exam-summary')), 15000);
  } finally {
    Date.now = realNow;
    uiCtx.window.Date.now = realWindowNow;
  }
  const summary = $2('#studentPracticeWorkspace .exam-summary').textContent;
  assert.match(summary, /সময় শেষে স্বয়ংক্রিয় জমা/, 'the result says the sheet was closed by the clock');
  assert.match($2('#studentPracticeWorkspace').textContent, /সময় শেষ/, 'the page says time is up too');
  const record = practiceStore().sessions[0];
  assert.equal(record.auto, true, 'the history marks it as an automatic close');
  assert.equal(record.score, 0, 'nothing was answered, so nothing scores');
  assert.equal(practiceStore().active, null, 'the sheet is closed for good');
});

test('the list remembers the best score, the history shows the session, and an in-flight sheet can be resumed', async () => {
  await uiContext();
  ctx2click($2('#studentPracticeWorkspace [data-practice-action="list"]'));
  await uiCtx.waitFor(() => Boolean($2('#studentPracticeWorkspace [data-practice-action="start-paper"]')));
  assert.match(workspace().textContent, /তোমার সেরা: ১\/৩/, 'the paper shows the student’s best');
  assert.match($$2('#studentPracticeWorkspace .practice-history-row').map(node => node.textContent).join(' '), /১\/৩/, 'the history keeps the scored session');

  ctx2click($2('#studentPracticeWorkspace [data-practice-action="start-random"]'));
  await uiCtx.waitFor(() => $$2('#studentPracticeWorkspace .exam-question').length === 3);
  const fieldset = $$2('#studentPracticeWorkspace .exam-question').find(node => node.textContent.includes('রাজধানী'));
  const input = fieldset.querySelector('[data-practice-answer][value="A"]');
  input.checked = true;
  input.dispatchEvent(new uiCtx.window.Event('change', { bubbles: true }));
  await uiCtx.waitFor(() => input.checked === true);
  ctx2click($2('#studentPracticeWorkspace [data-practice-action="keep"]'));
  await uiCtx.waitFor(() => Boolean($2('#studentPracticeWorkspace [data-practice-action="resume-active"]')));
  assert.ok(practiceStore().active, 'the in-flight sheet survived leaving the screen');
  ctx2click($2('#studentPracticeWorkspace [data-practice-action="resume-active"]'));
  await uiCtx.waitFor(() => $$2('#studentPracticeWorkspace .exam-question').length === 3);
  const resumed = $$2('#studentPracticeWorkspace .exam-question').find(node => node.textContent.includes('রাজধানী'));
  assert.equal(resumed.querySelector('[data-practice-answer][value="A"]').checked, true, 'the saved answer comes back with the sheet');
  ctx2click($2('#studentPracticeWorkspace [data-practice-action="confirm"]'));
  await uiCtx.waitFor(() => !$2('#studentPracticeWorkspace [data-practice-confirm]').hidden);
  ctx2click($2('#studentPracticeWorkspace [data-practice-action="finish"]'));
  await uiCtx.waitFor(() => Boolean($2('#studentPracticeWorkspace .exam-summary')));
  assert.equal(practiceStore().sessions.length, 3, 'all three practice sessions are on record');
});

function ctx2click(element) { element.dispatchEvent(new uiCtx.window.Event('click', { bubbles: true, cancelable: true })); }

/* ---------- a fresh load sees the same history ------------------------------ */

test('a reload restores the practice history and the best score', async () => {
  await uiContext();
  const savedPractice = uiCtx.window.localStorage.getItem(PRACTICE_KEY);
  const fresh = await loadApp({
    [EXAM_KEY]: JSON.stringify({ version: 1, exams: uiExams(), attempts: [] }),
    [PRACTICE_KEY]: savedPractice
  });
  seedStudentSession(fresh);
  initStudentPractice({ getStudent: () => student, getAccount: () => ({ status: 'active' }) });
  await fresh.waitFor(() => Boolean(fresh.$('#studentPracticeWorkspace [data-practice-action="start-paper"]')));
  const rows = fresh.$$('#studentPracticeWorkspace .practice-history-row');
  assert.equal(rows.length, 3, 'all sessions come back from the device');
  assert.match(fresh.$('#studentPracticeWorkspace').textContent, /তোমার সেরা: ১\/৩/, 'the best score is restored too');
});

/* ---------- a pre-timer (legacy) in-flight draft ---------------------------- */

test('a pre-timer draft is given its deadline on first visit and keeps it on the next', async () => {
  const now = Date.now();
  const legacyQuestions = [
    { id: 'q1', text: 'প্রশ্ন: বাংলাদেশের রাজধানী কোনটি?', answer: 'A', options: [{ id: 'A', text: 'ঢাকা' }, { id: 'B', text: 'চট্টগ্রাম' }, { id: 'C', text: 'খুলনা' }, { id: 'D', text: 'রাজশাহী' }] },
    { id: 'q2', text: 'প্রশ্ন: ৫ + ৭ = কত?', answer: 'B', options: [{ id: 'A', text: '১১' }, { id: 'B', text: '১২' }, { id: 'C', text: '১৩' }, { id: 'D', text: '১৪' }] },
    { id: 'q3', text: 'প্রশ্ন: পানির রাসায়নিক সংকেত কোনটি?', answer: 'B', options: [{ id: 'A', text: 'CO2' }, { id: 'B', text: 'H2O' }, { id: 'C', text: 'NaCl' }, { id: 'D', text: 'O2' }] }
  ];
  const seed = {
    [EXAM_KEY]: JSON.stringify({ version: 1, exams: uiExams(), attempts: [] }),
    /* A sheet started before the timer existed: no endsAt, no lowMs. */
    [PRACTICE_KEY]: JSON.stringify({
      [student.id]: {
        active: {
          id: 'PLEGACY', at: now - 60000, kind: 'paper', title: 'গত গণিত MCQ পরীক্ষা',
          examId: 'EX-PAST', examCode: '', className: 'দশম শ্রেণি', subject: '',
          startsAt: now - 60000, durationMs: 180000, total: 3, answers: {},
          order: legacyQuestions.map(question => ({ id: question.id, options: question.options.map(option => option.id) })),
          questions: legacyQuestions
        }, sessions: []
      }
    })
  };
  const first = await loadApp(seed);
  seedStudentSession(first);
  initStudentPractice({ getStudent: () => student, getAccount: () => ({ status: 'active' }) });
  await first.waitFor(() => Boolean(first.$('#studentPracticeWorkspace [data-practice-action="resume-active"]')));
  const pickedUp = JSON.parse(first.window.localStorage.getItem(PRACTICE_KEY))[student.id].active;
  assert.ok(Number.isFinite(pickedUp.endsAt) && pickedUp.endsAt > Date.now(), 'the draft was given a standard deadline and saved it');

  /* Re-open the same device: the window must be the one already saved — not a
     fresh three minutes. */
  const carried = {
    [EXAM_KEY]: JSON.stringify({ version: 1, exams: uiExams(), attempts: [] }),
    [PRACTICE_KEY]: first.window.localStorage.getItem(PRACTICE_KEY)
  };
  const second = await loadApp(carried);
  seedStudentSession(second);
  initStudentPractice({ getStudent: () => student, getAccount: () => ({ status: 'active' }) });
  await second.waitFor(() => Boolean(second.$('#studentPracticeWorkspace [data-practice-action="resume-active"]')));
  const kept = JSON.parse(second.window.localStorage.getItem(PRACTICE_KEY))[student.id].active;
  assert.equal(kept.endsAt, pickedUp.endsAt, 'the deadline does not restart on the next visit');
});
