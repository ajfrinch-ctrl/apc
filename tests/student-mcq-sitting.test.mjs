/* How a student sits an MCQ exam (the questions the school asked, 2026-09-30):
     • every question arrives together, on one page;
     • the top of the page counts the time left, and the last five minutes are
       flagged;
     • answers can be changed until the paper is submitted or time runs out;
     • when time runs out the paper is submitted automatically, and the result
       says so.
   One page per test file: the app modules read the globals of their window. */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { examTemplate, validateExam, EXAM_KEY } from '../js/exam-data.js';
import { STORAGE_KEYS } from '../js/config.js';
import { initStudentExams } from '../js/student-exams.js';

/* The app reads the wall clock, so the test moves it: `offset` shifts "now"
   forward (or back) while it still advances in real time — that keeps the
   harness's own waitFor timeout honest. */
const realNow = Date.now;
let offset = 0;
const clockNow = () => realNow() + offset;
const setLeft = ms => { offset = (exam.endAt - ms) - realNow(); };

const student = { id: 'AP-MCQ-1', name: 'পরীক্ষার্থী শিক্ষার্থী', className: 'দশম শ্রেণি', group: '' };
const exam = {
  ...validateExam({
    type: 'mcq', title: 'ডেমো MCQ পরীক্ষা', subject: 'গণিত', className: 'দশম শ্রেণি',
    startAt: realNow(), endAt: realNow() + 60 * 60000, lateMinutes: 10, negative: 0.5, passPercent: 33,
    template: examTemplate('mcq')
  }),
  id: 'EX-MCQ-1', teacherId: 'DEMO-TEACHER', teacherName: 'Demo Teacher', status: 'published',
  resultsPublished: true, participants: [student], createdAt: realNow(), updatedAt: realNow()
};

let ctx;
const $ = sel => ctx.$(sel);
const stored = () => JSON.parse(ctx.window.localStorage.getItem(EXAM_KEY));
const attempt = () => stored().attempts[0];
const questionIds = () => ctx.$$('[data-answer-question]').map(input => input.dataset.answerQuestion).filter((id, index, all) => all.indexOf(id) === index);
const choose = async (input, id) => {
  // A save briefly locks every control; the next click must wait for that.
  await ctx.waitFor(() => !input.disabled, 10000);
  input.checked = true;
  input.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  await ctx.waitFor(() => attempt()?.answers[id] === input.value, 10000);
  await ctx.waitFor(() => !input.disabled, 10000);
};
let answeredId, answeredValue;

before(async () => {
  ctx = await loadPage('index.html', { seed: { 'activePlus.demo.autofill.v1': 'off' } });
  Date.now = clockNow;
  ctx.window.Date.now = clockNow;
  ctx.window.localStorage.setItem(STORAGE_KEYS.account, JSON.stringify({ status: 'active', student }));
  ctx.window.sessionStorage.setItem(STORAGE_KEYS.session, '1');
  ctx.window.localStorage.setItem(EXAM_KEY, JSON.stringify({ version: 1, exams: [exam], attempts: [] }));
  initStudentExams({ getStudent: () => student, getAccount: () => ({ status: 'active' }) });
  await ctx.waitFor(() => ctx.$$('[data-student-exam-action="start"]').length > 0);
  ctx.click($('[data-student-exam-action="start"]'));
  await ctx.waitFor(() => Boolean($('[data-answer-question]')));
});
after(() => { Date.now = realNow; ctx?.window.close(); });

test('every question arrives together, each with its options', () => {
  const ids = questionIds();
  assert.equal(ids.length, exam.questions.length, 'all questions are on the page at once');
  assert.equal(ctx.$$('.exam-question').length, exam.questions.length);
  for (const id of ids) {
    assert.equal(ctx.$$(`[data-answer-question="${id}"]`).length, 4, `${id} has its four options`);
  }
  const notes = ctx.$$('.exam-note').map(node => node.textContent).join(' ');
  assert.match(notes, /সব প্রশ্ন একসঙ্গে/, 'the page says so too');
});

test('the top of the page counts the time left and warns in the last five minutes', async () => {
  const clockNode = $('[data-exam-clock]');
  assert.ok(clockNode, 'the clock sits in the exam header');
  assert.match(clockNode.textContent, /সময় বাকি/, 'it says time is left');
  assert.match(clockNode.textContent, /[০-৯]+:[০-৯]{2}/, 'minutes and seconds in Bangla digits');
  assert.equal(clockNode.dataset.lowTime, 'false', 'not yet in the warning window');

  assert.equal($('[data-low-hint]').hidden, true, 'no warning while plenty of time is left');

  setLeft(4 * 60000);   // four minutes left; the clock repaints every second
  await ctx.waitFor(() => $('[data-exam-clock]')?.dataset.lowTime === 'true', 10000);
  assert.match($('[data-exam-clock]').textContent, /সময় বাকি ০*৪:[০-৯]{2}/, 'still counting, from the top');
  assert.match($('[data-exam-clock]').title, /শেষ ৫ মিনিট/, 'the last five minutes carry a hint');
  const hint = $('[data-low-hint]');
  assert.equal(hint.hidden, false, 'the warning is visible, not just coloured');
  assert.match(hint.textContent, /শেষ ৫ মিনিট/, 'it spells out the last five minutes');
  assert.match(hint.textContent, /জমা হবে/, 'and that the paper is about to be submitted by itself');

  setLeft(30 * 60000);
  await ctx.waitFor(() => $('[data-exam-clock]')?.dataset.lowTime === 'false', 10000);
  assert.equal($('[data-low-hint]').hidden, true, 'the warning goes away when time is moved back');
});

test('an answer can be changed again and again until the paper is submitted', async () => {
  const [first] = questionIds();
  const [a, b] = ctx.$$(`[data-answer-question="${first}"]`);
  await choose(a, first);
  assert.equal(attempt().answers[first], a.value, 'the first choice is saved');
  assert.equal(attempt().status, 'active', 'the paper is still open');

  await choose(b, first);
  assert.equal(attempt().answers[first], b.value, 'a later choice replaces it: options stay open');
  answeredId = first; answeredValue = b.value;
  const status = $('[data-answer-status]').textContent;
  assert.match(status, /১ \/ ২ উত্তর ফোনে সংরক্ষিত/, 'the header shows how many are answered');
});

test('the confirm card explains that time will submit the paper by itself', () => {
  ctx.click($('[data-student-exam-action="confirm"]'));
  const card = $('[data-submit-confirm]');
  assert.equal(card.hidden, false);
  assert.match(card.textContent, /উত্তর বদলানো যাবে না/);
  assert.match(card.textContent, /স্বয়ংক্রিয়ভাবে জমা/, 'and that waiting submits automatically');
  ctx.click($('[data-student-exam-action="cancel-confirm"]'));
  assert.equal(card.hidden, true, 'the student can go back to the answers');
});

test('when time runs out the paper is submitted automatically and the result says so', async () => {
  assert.equal(attempt().answers[answeredId], answeredValue, 'the changed answer is the one on file');
  setLeft(-1000);   // one second past the deadline; the exam screen re-checks every second
  await ctx.waitFor(() => attempt().status === 'submitted', 25000);
  assert.equal(attempt().finishedAt >= exam.endAt, true, 'it was finalised at the deadline');
  assert.equal(Number.isFinite(attempt().score), true, 'the score is worked out');
  assert.equal(attempt().answers[answeredId], answeredValue, 'the chosen answer is what was counted');

  await ctx.waitFor(() => $('[data-answer-question]') === null, 25000);
  assert.ok($('.exam-summary'), 'the result is on screen');
  assert.match($('#studentExamWorkspace').textContent, /স্বয়ংক্রিয় জমা/, 'the result names the automatic submission');
  assert.ok($('[data-student-exam-action="solutions"]'), 'the student can explicitly request the combined question-and-answer PDF');
  assert.equal($('[data-auto-download]'), null, 'the student panel does not trigger an extra background PDF download');
  // The paper is no longer editable.
  assert.equal(ctx.$$('[data-answer-question]').length, 0, 'no answer control is left');
  assert.equal(stored().attempts[0].status, 'submitted', 'and it is stored as submitted');
});
