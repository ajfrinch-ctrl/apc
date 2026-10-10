/* The date-wise examination screen, driven through the real teacher.html.
   The school's rule: one landing page with Create Exam / Upcoming Exams /
   Exam History / Question Archive, and questions stay collapsed until
   View Questions is pressed — no paper lies open on the screen. */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { provisionStaff, openStaffPanel } from './staff-harness.mjs';
import { EXAM_KEY, examRepository as repo, examTemplate, examDateFor, MANAGER_ACTOR } from '../js/exam-data.js';
import { adminStudents } from '../js/admin-data.js';
import { ROSTER_KEY } from '../js/office-data.js';
import { enabledClasses } from '../js/config.js';
import { TEACHER_ASSIGNMENTS_KEY } from '../js/teacher-assignments.js';
import { STAFF_ACCOUNTS } from '../js/staff-auth.js';

const SECOND_TEMPLATE = 'প্রশ্ন: মডেল টেস্টের প্রথম প্রশ্ন?\nA: ক\nB: খ\nC: গ\nD: ঘ\nউত্তর: A\n---\nপ্রশ্ন: মডেল টেস্টের দ্বিতীয় প্রশ্ন?\nA: ক\nB: খ\nC: গ\nD: ঘ\nউত্তর: B';
const THIRD_TEMPLATE = 'প্রশ্ন: তৃতীয় পরীক্ষার প্রশ্ন?\nA: ক\nB: খ\nC: গ\nD: ঘ\nউত্তর: C';

let ctx, repoModule;
const $ = selector => ctx.$(selector);
const $$ = selector => ctx.$$(selector);
const exams = () => JSON.parse(ctx.window.localStorage.getItem(EXAM_KEY) || '{"exams":[]}').exams;
const examByTitle = title => exams().find(exam => exam.title === title);
const rows = () => $$('#teacherExamWorkspace [data-managed-exam]');

const now = Date.now();
const DAY = 86400000;
const localInput = ms => { const date = new Date(ms - new Date(ms).getTimezoneOffset() * 60000); return date.toISOString().slice(0, 16); };

before(async () => {
  ctx = await loadPage('teacher.html', {
    seed: {
      'activePlus.demo.autofill.v1': 'off',
      [ROSTER_KEY]: JSON.stringify(adminStudents),
      [STAFF_ACCOUNTS.teacher.accountKey]: JSON.stringify({ role: 'teacher', username: 'teacher.apc', fullName: 'Test Teacher', status: 'active' }),
      [TEACHER_ASSIGNMENTS_KEY]: JSON.stringify(enabledClasses.map((className, index) => ({ id: `TAS-${index}`, teacherUsername: 'teacher.apc', teacherName: 'Test Teacher', className, group: '', subject: 'Test', subjects: ['গণিত', 'ইংরেজি', 'বিজ্ঞান', 'Test'] })))
    }
  });
  repoModule = await import('../js/exam-data.js');
  await provisionStaff('manager');
  await openStaffPanel(ctx, 'teacher', {
    importPanel: () => import('../js/teacher.js'),
    shellId: 'teacherShell',
    ready: () => [...$('#teacherClassFilter').options].some(option => option.textContent === 'সব assigned class')
  });
  ctx.window.sessionStorage.setItem(STAFF_ACCOUNTS.manager.sessionKey, '1');
  ctx.click($('[data-teacher-view="online-exams"]'));
  await ctx.waitFor(() => Boolean($('#teacherExamWorkspace [data-exam-action="new-mcq"]')));
});
after(() => ctx?.window.close());

/** Save one paper through the teacher's own editor. */
async function createInEditor({ title, startAt, endAt, template = examTemplate('mcq'), className = 'দশম শ্রেণি' }) {
  ctx.click($('#teacherExamWorkspace [data-exam-action="new-mcq"]'));
  await ctx.waitFor(() => Boolean($('select[name=className]')));
  ctx.type($('[name=title]'), title);
  ctx.type($('[name=subject]'), 'গণিত');
  $('select[name=className]').value = className;
  ctx.type($('[name=startAt]'), localInput(startAt));
  ctx.type($('[name=endAt]'), localInput(endAt));
  ctx.type($('[name=template]'), template);
  ctx.submit($('[data-exam-form]'));
  await ctx.waitFor(() => ctx.$('#teacherExamWorkspace [data-managed-exam]'));
  await ctx.waitFor(() => Boolean(examByTitle(title)));
  return examByTitle(title);
}

test('the examination section opens as a hub — nothing is answered or open before View Questions', async () => {
  const workspace = $('#teacherExamWorkspace');
  for (const action of ['new-mcq', 'new-written', 'new-short', 'view-history', 'view-upcoming', 'view-archive']) {
    assert.ok($(`#teacherExamWorkspace [data-exam-action="${action}"]`), `${action} entry point is on the landing screen`);
  }
  assert.ok($('#teacherExamWorkspace .exam-hub'), 'the module tiles sit together');
  assert.ok($('#teacherExamWorkspace .exam-counters'), 'and the status counters');
  assert.equal($$('#teacherExamWorkspace .exam-question').length, 0, 'no question is lying open on the landing screen');
  assert.equal($$('#teacherExamWorkspace [data-managed-exam]').length, 0, 'and the history is empty until a paper exists');
  assert.match(workspace.textContent, /এখনও কোনো পরীক্ষা নেই/);
});

test('each paper is stored as its own date-wise record and listed under that date', async () => {
  const first = await createInEditor({ title: 'সাপ্তাহিক পরীক্ষা', startAt: now + DAY, endAt: now + DAY + 3600000 });
  assert.equal(first.status, 'draft');
  assert.equal(first.examDate, examDateFor('mcq', first.startAt));
  assert.equal(first.createdByRole, 'teacher');
  assert.ok(first.createdBy, 'the record names whoever created it');
  assert.equal(first.questions.length, 2);
  assert.equal(first.questions[0].uid, `${first.id}-q1`, 'every question carries its own unique id');
  assert.equal($$('#teacherExamWorkspace [data-exam-date]').length, 1);
  assert.match($('[data-exam-date]').textContent, /১টি পরীক্ষা/);

  await repo.saveDraft({ title: 'মডেল টেস্ট', subject: 'ইংরেজি', className: 'দশম শ্রেণি', type: 'mcq', startAt: now + DAY * 2, endAt: now + DAY * 2 + 3600000, lateMinutes: 10, negative: .5, passPercent: 33, template: SECOND_TEMPLATE });
  await repo.saveDraft({ title: 'তৃতীয় পরীক্ষা', subject: 'বিজ্ঞান', className: 'দশম শ্রেণি', type: 'mcq', startAt: now + DAY * 3, endAt: now + DAY * 3 + 3600000, lateMinutes: 10, negative: .5, passPercent: 33, template: THIRD_TEMPLATE });
  await ctx.waitFor(() => rows().length === 3);
  const groups = $$('#teacherExamWorkspace [data-exam-date]');
  assert.equal(groups.length, 3, 'three dates are three separate groups — no mixing');
  const titles = groups.map(group => group.querySelector('[data-managed-exam] strong').textContent);
  assert.deepEqual(new Set(titles).size, 3);
  assert.equal($$('#teacherExamWorkspace .exam-question').length, 0, 'the history still shows no questions');
  assert.doesNotMatch($('#teacherExamWorkspace').textContent, /মডেল টেস্টের প্রথম প্রশ্ন/, 'question text is not on the history screen');
});

test('View Questions opens only the selected exam', async () => {
  const target = examByTitle('মডেল টেস্ট');
  ctx.click($(`#teacherExamWorkspace [data-exam-action="questions"][data-id="${target.id}"]`));
  await ctx.waitFor(() => $$('#teacherExamWorkspace .exam-question').length === 2);
  const workspace = $('#teacherExamWorkspace').textContent;
  assert.match(workspace, /মডেল টেস্টের প্রথম প্রশ্ন/);
  assert.doesNotMatch(workspace, /বাংলাদেশের রাজধানী কোনটি/, 'the other exams stay closed');
  assert.match(workspace, new RegExp(target.id), 'the record names its own Exam ID');
  assert.match(workspace, /মোট প্রশ্ন/);
  assert.match(workspace, /তৈরি করেছেন/);
  ctx.click($('#teacherExamWorkspace [data-exam-action="list"]'));
  await ctx.waitFor(() => rows().length === 3);
});

test('a single question is edited and deleted without touching the others', async () => {
  const target = examByTitle('তৃতীয় পরীক্ষা');
  ctx.click($(`#teacherExamWorkspace [data-exam-action="questions"][data-id="${target.id}"]`));
  await ctx.waitFor(() => $$('#teacherExamWorkspace .exam-question').length === 1);
  ctx.click($('#teacherExamWorkspace [data-exam-action="q-edit"]'));
  await ctx.waitFor(() => Boolean($('#teacherExamWorkspace [data-question-form]')));
  ctx.type($('#teacherExamWorkspace [data-question-form] [name=text]'), 'সম্পাদিত প্রশ্ন — সঠিক উত্তর কোনটি?');
  ctx.type($('#teacherExamWorkspace [data-question-form] [name=option-B]'), 'নতুন খ');
  ctx.$('#teacherExamWorkspace [data-question-form] [name=answer]').value = 'B';
  ctx.submit($('#teacherExamWorkspace [data-question-form]'));
  await ctx.waitFor(() => examByTitle('তৃতীয় পরীক্ষা')?.questions[0].text === 'সম্পাদিত প্রশ্ন — সঠিক উত্তর কোনটি?');
  const edited = examByTitle('তৃতীয় পরীক্ষা');
  assert.equal(edited.questions[0].answer, 'B');
  assert.equal(edited.questions[0].uid, `${edited.id}-q1`, 'the question keeps its identity');
  assert.match(edited.template, /সম্পাদিত প্রশ্ন/, 'the paste template follows the record');

  /* Adding a question through the archive form keeps marks/totals honest. */
  ctx.type($('#teacherExamWorkspace [data-question-add] [name=text]'), 'আরও একটি প্রশ্ন?');
  ['A', 'B', 'C', 'D'].forEach((id, index) => ctx.type($(`#teacherExamWorkspace [data-question-add] [name=option-${id}]`), `বিকল্প ${index + 1}`));
  ctx.submit($('#teacherExamWorkspace [data-question-add]'));
  await ctx.waitFor(() => examByTitle('তৃতীয় পরীক্ষা')?.questions.length === 2);

  /* Deleting asks first and leaves the rest alone. */
  ctx.window.confirm = () => true;
  const before = examByTitle('তৃতীয় পরীক্ষা');
  ctx.click($(`#teacherExamWorkspace [data-exam-action="q-delete"][data-id="${before.questions[0].uid}"]`));
  await ctx.waitFor(() => examByTitle('তৃতীয় পরীক্ষা')?.questions.length === 1);
  const after = examByTitle('তৃতীয় পরীক্ষা');
  assert.equal(after.questions[0].uid, before.questions[1].uid, 'the surviving question keeps its own id');
  assert.equal(after.template.includes('সম্পাদিত প্রশ্ন'), false);
  ctx.click($('#teacherExamWorkspace [data-exam-action="list"]'));
  await ctx.waitFor(() => rows().length === 3);
});

test('date, class and name filters narrow the history, with a clear empty state', async () => {
  const target = examByTitle('তৃতীয় পরীক্ষা');
  ctx.$('#teacherExamWorkspace [data-exam-filters] [name=date]').value = target.examDate;
  ctx.submit($('#teacherExamWorkspace [data-exam-filters]'));
  await ctx.waitFor(() => rows().length === 1);
  assert.match($('[data-managed-exam]').textContent, /তৃতীয় পরীক্ষা/);

  ctx.$('#teacherExamWorkspace [data-exam-filters] [name=date]').value = '';
  ctx.submit($('#teacherExamWorkspace [data-exam-filters]'));
  await ctx.waitFor(() => rows().length === 3);

  const classFilter = $('#teacherExamWorkspace [data-exam-class-filter]');
  classFilter.value = 'অনার্স ১ম বর্ষ';
  classFilter.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  await ctx.waitFor(() => rows().length === 0);
  assert.match($('#teacherExamWorkspace').textContent, /এই শ্রেণির কোনো পরীক্ষা নেই/);

  ctx.click($('#teacherExamWorkspace [data-exam-action="filters-reset"]'));
  await ctx.waitFor(() => rows().length === 3);

  ctx.type($('#teacherExamWorkspace [data-exam-filters] [name=query]'), 'মডেল');
  ctx.submit($('#teacherExamWorkspace [data-exam-filters]'));
  await ctx.waitFor(() => rows().length === 1);
  assert.match($('[data-managed-exam]').textContent, /মডেল টেস্ট/);
  ctx.click($('#teacherExamWorkspace [data-exam-action="filters-reset"]'));
  await ctx.waitFor(() => rows().length === 3);
});

test('a published paper is read-only for the teacher and offers no Manager decision', async () => {
  const target = examByTitle('সাপ্তাহিক পরীক্ষা');
  await repo.requestApproval(target.id);
  const published = await repo.publish(target.id, MANAGER_ACTOR);
  assert.equal(published.exams.find(exam => exam.id === target.id).status, 'published');
  await ctx.waitFor(() => {
    const row = $(`#teacherExamWorkspace [data-managed-exam="${target.id}"]`);
    return row && !row.querySelector('[data-exam-action="request"]');
  });
  for (const action of ['approve', 'publish', 'unpublish', 'archive']) {
    assert.equal($(`#teacherExamWorkspace [data-exam-action="${action}"]`), null, `a teacher gets no ${action} control`);
  }
  ctx.click($(`#teacherExamWorkspace [data-exam-action="questions"][data-id="${target.id}"]`));
  await ctx.waitFor(() => $$('#teacherExamWorkspace .exam-question').length === 2);
  assert.equal($$('#teacherExamWorkspace [data-exam-action="q-edit"]').length, 0, 'published questions cannot be edited');
  assert.match($('#teacherExamWorkspace').textContent, /প্রশ্ন বদলানো যাবে না/);
  assert.equal(repoModule.isStudentVisibleExam(exams().find(exam => exam.id === target.id)), true);
});

test('the question archive is date-wise, searchable and offers duplicate instead of hiding nothing', async () => {
  ctx.click($('#teacherExamWorkspace [data-exam-action="list"]'));
  await ctx.waitFor(() => Boolean($('#teacherExamWorkspace [data-exam-action="view-archive"]')));
  ctx.click($('#teacherExamWorkspace [data-exam-action="view-archive"]'));
  await ctx.waitFor(() => $$('#teacherExamWorkspace [data-managed-exam]').length >= 1);
  assert.ok($('#teacherExamWorkspace [data-exam-action="filters-reset"]'), 'the archive carries the same filters');
  assert.equal($$('#teacherExamWorkspace .exam-question').length, 0, 'the archive never opens a paper by itself');
  assert.ok($('#teacherExamWorkspace [data-exam-action="duplicate"]'), 'an old paper can be reused for a new exam');
  assert.ok($('#teacherExamWorkspace [data-exam-action="questions"]'), 'and one paper opens at a time');

  ctx.click($('#teacherExamWorkspace [data-exam-action="list"]'));
  await ctx.waitFor(() => Boolean($('#teacherExamWorkspace [data-exam-action="view-upcoming"]')));
  ctx.click($('#teacherExamWorkspace [data-exam-action="view-upcoming"]'));
  await ctx.waitFor(() => /আসন্ন পরীক্ষা/.test($('#teacherExamWorkspace').textContent));
  ctx.click($('#teacherExamWorkspace [data-exam-action="list"]'));
  await ctx.waitFor(() => rows().length === 3);
});
