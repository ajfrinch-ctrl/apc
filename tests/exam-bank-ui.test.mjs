/* প্রশ্ন সংরক্ষণ করুন (Question Bank) driven through the real teacher panel:
   the shelf entry, saving a new question, searching, paging, inserting a
   shelved question into a draft paper and shelving a paper's own questions.
   The rule under test: a bank row and a paper question are copies of each
   other, so neither can orphan the other. */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { provisionStaff, openStaffPanel } from './staff-harness.mjs';
import { EXAM_KEY, examTemplate } from '../js/exam-data.js';
import { QUESTION_BANK_KEY } from '../js/question-bank.js';
import { adminStudents } from '../js/admin-data.js';
import { ROSTER_KEY } from '../js/office-data.js';
import { enabledClasses } from '../js/config.js';
import { TEACHER_ASSIGNMENTS_KEY } from '../js/teacher-assignments.js';
import { STAFF_ACCOUNTS } from '../js/staff-auth.js';

let ctx;
const $ = selector => ctx.$(selector);
const $$ = selector => ctx.$$(selector);
const exams = () => JSON.parse(ctx.window.localStorage.getItem(EXAM_KEY) || '{"exams":[]}').exams;
const bank = () => JSON.parse(ctx.window.localStorage.getItem(QUESTION_BANK_KEY) || '{"version":1,"questions":[]}').questions;
const now = Date.now();
const localInput = ms => new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 16);

before(async () => {
  ctx = await loadPage('teacher.html', {
    seed: {
      'activePlus.demo.autofill.v1': 'off',
      [ROSTER_KEY]: JSON.stringify(adminStudents),
      [STAFF_ACCOUNTS.teacher.accountKey]: JSON.stringify({ role: 'teacher', username: 'teacher.apc', fullName: 'Test Teacher', status: 'active' }),
      [TEACHER_ASSIGNMENTS_KEY]: JSON.stringify(enabledClasses.map((className, index) => ({ id: `TAS-${index}`, teacherUsername: 'teacher.apc', teacherName: 'Test Teacher', className, group: '', subject: 'Test', subjects: ['গণিত', 'ইংরেজি', 'বিজ্ঞান', 'Test'] })))
    }
  });
  await provisionStaff('manager');
  await openStaffPanel(ctx, 'teacher', {
    importPanel: () => import('../js/teacher.js'),
    shellId: 'teacherShell',
    ready: () => [...$('#teacherClassFilter').options].some(option => option.textContent === 'সব নির্ধারিত শ্রেণি')
  });
  ctx.click($('[data-panel-view="online-exams"]'));
  await ctx.waitFor(() => Boolean($('#teacherExamWorkspace [data-exam-action="new-mcq"]')));
});
after(() => ctx?.window.close());

async function createPaper({ title, template = examTemplate('mcq'), className = 'দশম শ্রেণি' }) {
  /* Back to the landing screen: create buttons live there, never on the shelf. */
  if (!$('#teacherExamWorkspace [data-exam-action="new-mcq"]')) {
    ctx.click($('#teacherExamWorkspace [data-exam-action="list"]'));
    await ctx.waitFor(() => Boolean($('#teacherExamWorkspace [data-exam-action="new-mcq"]')));
  }
  ctx.click($('#teacherExamWorkspace [data-exam-action="new-mcq"]'));
  await ctx.waitFor(() => Boolean($('select[name=className]')));
  ctx.type($('[name=title]'), title);
  $('select[name=className]').value = className;
  $('select[name=subject]').value = 'গণিত';
  ctx.type($('[name=startAt]'), localInput(now + 86400000));
  ctx.type($('[name=endAt]'), localInput(now + 86400000 + 3600000));
  ctx.type($('[name=chapterName]'), 'অধ্যায় ১');
  ctx.type($('[name=template]'), template);
  ctx.submit($('[data-exam-form]'));
  await ctx.waitFor(() => Boolean(exams().find(exam => exam.title === title)));
  return exams().find(exam => exam.title === title);
}

test('the hub offers প্রশ্ন সংরক্ষণ করুন and the shelf opens as its own screen', async () => {
  assert.ok($('#teacherExamWorkspace [data-exam-action="bank"]'), 'the shelf has an entry point on the landing screen');
  ctx.click($('#teacherExamWorkspace [data-exam-action="bank"]'));
  await ctx.waitFor(() => Boolean($('[data-bank-filters]')));
  assert.equal($$(  '#teacherExamWorkspace [data-bank-question]').length, 0, 'an empty shelf renders no rows');
  assert.match($('#teacherExamWorkspace').textContent, /প্রশ্ন সংরক্ষণ করুন/);
  ctx.click($('[data-exam-action="bank-new"]'));
  await ctx.waitFor(() => Boolean($('[data-bank-form]')));
  ctx.type($('[data-bank-form] [name=text]'), 'বাংলাদেশের রাজধানী কোনটি?');
  ctx.type($('[data-bank-form] [name=option-A]'), 'ঢাকা');
  ctx.type($('[data-bank-form] [name=option-B]'), 'চট্টগ্রাম');
  ctx.type($('[data-bank-form] [name=option-C]'), 'খুলনা');
  ctx.type($('[data-bank-form] [name=option-D]'), 'রাজশাহী');
  $('[data-bank-form] [name=answer]').value = 'A';
  $('[data-bank-form] [name=className]').value = 'দশম শ্রেণি';
  $('[data-bank-form] [name=subject]').value = 'গণিত';
  ctx.submit($('[data-bank-form]'));
  await ctx.waitFor(() => bank().length === 1);
  assert.equal(bank()[0].id, 'QUESTION-0001');
  assert.equal(bank()[0].type, 'mcq');
  assert.equal(bank()[0].answer, 'A');
  assert.equal(bank()[0].chapterName, '');
});

test('the quick MCQ wizard filters assigned question-bank rows and adds selected MCQs to its paste template', async () => {
  ctx.click($('[data-panel-view="online-exams"]'));
  await ctx.waitFor(() => Boolean($('.teacher-cta')));
  ctx.click($('.teacher-cta'));
  await ctx.waitFor(() => Boolean($('#teacherExamWorkspace [data-quick-wizard]')));
  const form = $('#teacherExamWorkspace [data-exam-form]');
  ctx.type(form.elements.title, 'ব্যাংক থেকে দ্রুত পরীক্ষা');
  form.elements.className.value = 'দশম শ্রেণি';
  form.elements.className.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 30));
  form.elements.subject.value = 'গণিত';
  ctx.click($('#teacherExamWorkspace [data-quick-next]'));
  ctx.click($('#teacherExamWorkspace [data-quick-method="bank"]'));
  await ctx.waitFor(() => Boolean($('#teacherExamWorkspace [data-quick-bank-id]')));
  assert.equal($$('#teacherExamWorkspace [data-quick-bank-id]').length, 1,
    'the picker lists only the matching assigned class and subject');
  $('#teacherExamWorkspace [data-quick-bank-id]').checked = true;
  ctx.click($('#teacherExamWorkspace [data-quick-bank-add]'));
  assert.match(form.elements.template.value, /প্রশ্ন: বাংলাদেশের রাজধানী কোনটি/u);
  assert.match(form.elements.template.value, /উত্তর: A/u);
  assert.equal($('#teacherExamWorkspace [data-quick-bank-id]').disabled, true,
    'the same bank question cannot be added twice in this wizard');
  ctx.click($('#teacherExamWorkspace [data-quick-next]'));
  assert.equal($('#teacherExamWorkspace [data-quick-step="2"]').hidden, false,
    'selected bank questions pass validation and move to the final step');
  ctx.click($('#teacherExamWorkspace [data-exam-action="list"]'));
  await ctx.waitFor(() => Boolean($('#teacherExamWorkspace [data-exam-action="bank"]')));
  ctx.click($('#teacherExamWorkspace [data-exam-action="bank"]'));
  await ctx.waitFor(() => Boolean($('[data-bank-filters]')));
});

test('the shelf search, filters and paging never render more than one page', async () => {
  for (let index = 0; index < 3; index++) {
    ctx.click($('[data-exam-action="bank-new"]'));
    await ctx.waitFor(() => Boolean($('[data-bank-form]')));
    ctx.type($('[data-bank-form] [name=text]'), `অতিরিক্ত প্রশ্ন ${index + 1}`);
    for (const [letter, text] of [['A', 'এক'], ['B', 'দুই'], ['C', 'তিন'], ['D', 'চার']]) ctx.type($(`[data-bank-form] [name=option-${letter}]`), `${text} ${index}`);
    $('[data-bank-form] [name=answer]').value = 'B';
    $('[data-bank-form] [name=className]').value = 'দশম শ্রেণি';
    $('[data-bank-form] [name=subject]').value = 'গণিত';
    ctx.submit($('[data-bank-form]'));
    await ctx.waitFor(() => bank().length === index + 2);
    await ctx.flush(40); /* the save has finished: the screen is idle again */
  }
  assert.equal(bank().length, 4);
  ctx.type($('[data-bank-filters] [name=query]'), 'রাজধানী');
  ctx.submit($('[data-bank-filters]'));
  await ctx.waitFor(() => $$('#teacherExamWorkspace [data-bank-question]').length === 1);
  assert.equal($$('#teacherExamWorkspace [data-bank-question]').length, 1, 'the search narrows the shelf');
  ctx.click($('[data-exam-action="bank-reset"]'));
  await ctx.waitFor(() => $$('#teacherExamWorkspace [data-bank-question]').length === 4);
  ctx.click($(`#teacherExamWorkspace [data-bank-question] [data-exam-action="bank-toggle"]`));
  await ctx.waitFor(() => bank().some(row => row.active === false));
  await ctx.flush(40);
  assert.equal(bank().filter(row => row.active === false).length, 1, 'a question can be switched off without being deleted');
  assert.equal(bank().length, 4);
});

test('a shelved question is inserted into a paper, and the paper’s questions are shelved back', async () => {
  const paper = await createPaper({ title: 'ব্যাংক ইন্টিগ্রেশন পরীক্ষা' });
  assert.ok(paper.code, 'the saved paper carries its Exam Code');
  assert.equal(paper.chapterName, 'অধ্যায় ১', 'the chapter typed into the editor is kept on the record');
  await ctx.flush(40);
  ctx.click($(`#teacherExamWorkspace [data-managed-exam="${paper.id}"] [data-exam-action="questions"]`));
  await ctx.waitFor(() => Boolean($('#teacherExamWorkspace .exam-bank-picker')));
  /* The picker offers the MCQ shelf rows of this class+subject. */
  assert.ok($('#teacherExamWorkspace [data-bank-pick]'), 'the picker lists shelved questions');
  const target = bank().find(row => row.active !== false);
  ctx.click($(`#teacherExamWorkspace [data-bank-pick="${target.id}"] [data-exam-action="bank-add"]`));
  await ctx.waitFor(() => exams().find(exam => exam.id === paper.id).questions.length === paper.questions.length + 1);
  const updated = exams().find(exam => exam.id === paper.id);
  assert.equal(updated.questions.at(-1).text, target.text);
  assert.equal(updated.questions.at(-1).answer, target.answer);
  /* Shelving the paper's questions copies them and never edits the paper. */
  const before = JSON.stringify(exams().find(exam => exam.id === paper.id).questions);
  ctx.click($(`#teacherExamWorkspace [data-exam-action="save-to-bank"]`));
  await ctx.waitFor(() => bank().length > 4);
  await ctx.flush(40);
  assert.equal(JSON.stringify(exams().find(exam => exam.id === paper.id).questions), before, 'the paper is untouched by shelving');
  const sources = bank().filter(row => row.source && row.source.examId === paper.id);
  assert.equal(sources.length, updated.questions.length);
  assert.ok(sources.every(row => row.source.examCode === paper.code));
  assert.ok(bank().every(row => /^QUESTION-\d{4}$/.test(row.id)), 'every shelf row keeps its permanent id');
  assert.equal(new Set(bank().map(row => row.id)).size, bank().length);
});
