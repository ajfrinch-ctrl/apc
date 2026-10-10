/* An online exam belongs to one class: the teacher picks it, the card shows it,
   and only that class can take it. Drives the real teacher.html + exam-manager. */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { EXAM_KEY, examTemplate, examMatchesClass, validateExam, MANAGER_ACTOR } from '../js/exam-data.js';
import { enabledClasses, STORAGE_KEYS } from '../js/config.js';
import { adminStudents } from '../js/admin-data.js';
import { ROSTER_KEY } from '../js/office-data.js';
import { TEACHER_ASSIGNMENTS_KEY } from '../js/teacher-assignments.js';
import { STAFF_ACCOUNTS } from '../js/staff-auth.js';
import { provisionStaff, openStaffPanel } from './staff-harness.mjs';

let ctx, repo;
const $ = sel => ctx.$(sel);
/* Saving an exam goes through validation + the repository, which can take longer
   than one frame when the whole suite runs in parallel — wait for the record
   itself, never for a fixed delay. */
const settle = predicate => predicate
  ? ctx.waitFor(predicate, 30000)
  : new Promise(resolve => setTimeout(resolve, 60));
const exams = () => (JSON.parse(ctx.window.localStorage.getItem(EXAM_KEY) || '{}') || {}).exams || [];
const write = db => ctx.window.localStorage.setItem(EXAM_KEY, JSON.stringify(db));
const seedStudentSession = student => {
  ctx.window.localStorage.setItem(STORAGE_KEYS.account, JSON.stringify({ status: 'active', student }));
  ctx.window.sessionStorage.setItem(STORAGE_KEYS.session, '1');
};

const tenth = adminStudents.find(s => s.id === 'AP-1024');            // দশম শ্রেণি
const honours = adminStudents.find(s => s.id === '260716011');        // অনার্স ১ম বর্ষ

before(async () => {
  ctx = await loadPage('teacher.html', {
    seed: { 'activePlus.demo.autofill.v1': 'off', [ROSTER_KEY]: JSON.stringify(adminStudents), [TEACHER_ASSIGNMENTS_KEY]: JSON.stringify(enabledClasses.map((className, index) => ({ id: `TAS-${index}`, teacherUsername: 'teacher.apc', teacherName: 'Test Teacher', className, group: '', subject: 'Test', subjects: ['গণিত', 'ইংরেজি', 'বিজ্ঞান', 'বাংলা', 'Test'] }))) }
  });
  repo = (await import('../js/exam-data.js')).examRepository;
  await provisionStaff('manager');
  await openStaffPanel(ctx, 'teacher', {
    importPanel: () => import('../js/teacher.js'),
    shellId: 'teacherShell',
    ready: () => [...$('#teacherClassFilter').options].some(option => option.textContent === 'সব assigned class')
  });
  ctx.window.sessionStorage.setItem(STAFF_ACCOUNTS.manager.sessionKey, '1');
  ctx.click($('[data-teacher-view="online-exams"]'));
  ctx.click($('#teacherExamWorkspace [data-exam-action="new-mcq"]'));
});

test('the exam editor asks which class the exam is for', () => {
  const select = $('select[name=className]');
  assert.ok(select, 'a class picker exists');
  assert.equal(select.required, true, 'and it cannot be skipped');
  const options = [...select.options].map(o => o.value);
  assert.equal(options[0], '', 'it starts empty so a class has to be chosen');
  assert.deepEqual(options.slice(1), [...enabledClasses]);
});

test('saving an exam records the chosen class and the card shows it', async () => {
  ctx.type($('input[name=title]'), 'শ্রেণি পরীক্ষা — ত্রিকোণমিতি');
  ctx.type($('[name=subject]'), 'গণিত');
  ctx.$('select[name=className]').value = tenth.className;
  ctx.type($('textarea[name=template]'), examTemplate('mcq'));
  ctx.submit($('[data-exam-form]'));
  await settle(() => exams()[0]?.className);

  const saved = exams()[0];
  assert.equal(saved.className, tenth.className);
  assert.match($('#teacherExamWorkspace').textContent, new RegExp(tenth.className), 'the exam card names the class');
});

test('an exam keeps its class when it is reopened for editing', async () => {
  ctx.click($(`#teacherExamWorkspace [data-managed-exam="${exams()[0].id}"]`));
  await settle();
  ctx.click($(`#teacherExamWorkspace [data-exam-action="edit"][data-id="${exams()[0].id}"]`));
  await settle(() => ctx.$('select[name=className]')?.value === tenth.className);
  assert.equal(ctx.$('select[name=className]').value, tenth.className);
});

test('a class the app does not run is refused', () => {
  assert.throws(() => validateExam({ type: 'mcq', title: 'x', subject: 'y', className: 'সপ্তম শ্রেণি', startAt: Date.now() + 60000, endAt: Date.now() + 3660000, template: examTemplate('mcq') }),
    /সঠিক শ্রেণি নির্বাচন করুন/);
  assert.equal(examMatchesClass({ className: tenth.className }, tenth.className), true);
  assert.equal(examMatchesClass({ className: tenth.className }, honours.className), false);
  assert.equal(examMatchesClass({ className: '' }, honours.className), true, 'exams saved before the picker existed stay open to every class');
});

test('only that class can start the published exam', async () => {
  const id = exams()[0].id;
  assert.ok(id, 'the exam saved in the previous test is still there');
  await repo.requestApproval(id);
  await repo.review(id, 'publish', {}, MANAGER_ACTOR);
  // Open the window: publishing requires a future start, taking it a past one.
  const db = JSON.parse(ctx.window.localStorage.getItem(EXAM_KEY));
  db.exams[0].startAt = Date.now() - 60000;
  db.exams[0].endAt = Date.now() + 3600000;
  write(db);

  seedStudentSession(honours);
  await assert.rejects(() => repo.startAttempt(id, honours), /শ্রেণি\/ব্যাচের জন্য নয়/);
  seedStudentSession(tenth);
  const after = await repo.startAttempt(id, tenth);
  assert.ok(after.attempts.some(a => a.examId === id && a.studentId === tenth.id), 'the class it was made for can sit it');
});

test('the exam list can be narrowed to one class', async () => {
  ctx.click($('#teacherExamWorkspace [data-exam-action="list"]'));
  await settle();
  const cards = () => ctx.$$('#teacherExamWorkspace [data-managed-exam]');
  const pick = value => {
    const select = ctx.$('#teacherExamWorkspace [data-exam-class-filter]');   // list() rebuilds it
    select.value = value;
    select.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  };
  assert.ok(ctx.$('#teacherExamWorkspace [data-exam-class-filter]'), 'a class filter sits beside the type buttons');
  assert.equal(cards().length, 1, 'the one saved exam is listed');

  pick(honours.className);
  assert.equal(cards().length, 0, 'another class hides it');
  assert.match($('#teacherExamWorkspace').textContent, /এই শ্রেণির কোনো পরীক্ষা নেই/);

  pick(tenth.className);
  assert.equal(cards().length, 1, 'its own class brings it back');

  pick('all');
  assert.equal(cards().length, 1);
});
