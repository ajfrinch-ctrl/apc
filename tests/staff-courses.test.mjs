/* পড়াশোনা পরিচালনা করুন inside the real staff panels (teacher.html,
   manager.html): the More-menu entry, the page, and each role's own scope.

   The school's rules:
     • a Teacher's editor offers only the class+subject Manager assigned;
     • a Manager's editor offers the whole Admin-configured structure;
     • what they save is the same record the student Learning Hub reads. */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { openStaffPanel } from './staff-harness.mjs';
import { STAFF_ACCOUNTS } from '../js/staff-auth.js';
import { TEACHER_ASSIGNMENTS_KEY } from '../js/teacher-assignments.js';
import { COURSE_CONTENT_KEY, listCourseContentForStaff } from '../js/course-content.js';
import { classByName, subjectByName } from '../js/academics.js';

const ASSIGNMENT = [{
  id: 'ASSIGN-COURSE', teacherUsername: STAFF_ACCOUNTS.teacher.username, teacherName: 'নমুনা শিক্ষক',
  className: 'দশম শ্রেণি', group: '', subjects: ['গণিত'], active: true
}];
const contexts = [];
after(() => contexts.forEach(ctx => ctx.window.close()));

test('the Teacher panel opens the learning-library page for the assigned class only', async () => {
  const ctx = await loadPage('teacher.html', {
    seed: { 'activePlus.demo.autofill.v1': 'off', [TEACHER_ASSIGNMENTS_KEY]: JSON.stringify(ASSIGNMENT) }
  });
  contexts.push(ctx);
  await openStaffPanel(ctx, 'teacher', {
    importPanel: () => import('../js/teacher.js'), shellId: 'teacherShell'
  });
  /* The learning library moved to একাডেমিক → উপকরণ (docs/APP-ARCHITECTURE.md §9);
     the feature is the same editor, opened from its new home. */
  const entry = ctx.$('#teacherAcademic [data-teacher-view="courses"]');
  assert.ok(entry, 'the academic hub has the learning-library entry');
  assert.match(entry.textContent, /উপকরণ/);
  assert.match(entry.textContent, /নোট, PDF, লেকচার/);
  ctx.click(entry);
  await ctx.waitFor(() => ctx.$('#teacherCourses')?.hidden === false);
  const editor = ctx.$('#teacherCourses #teacherCourseEditor');
  assert.ok(editor, 'the page carries its editor mount');
  /* The editor reads the Teacher's own account asynchronously — the first
     frame is the empty state, the second carries the assignment. */
  await ctx.waitFor(() => ctx.$$('#teacherCourseEditor [data-course-form]').length === 1
    && ctx.$$('#teacherCourseEditor select[name="className"] option').length === 1);
  assert.deepEqual(
    Array.from(ctx.$('#teacherCourseEditor select[name="className"]').options).map(option => option.value),
    ['দশম শ্রেণি'], 'only the assigned class is offered');
  assert.deepEqual(
    Array.from(ctx.$('#teacherCourseEditor select[name="subject"]').options).map(option => option.value),
    ['গণিত'], 'only the assigned subject is offered');
  /* Saving writes the very record the student hub reads. */
  ctx.type(ctx.$('#teacherCourseEditor input[name="title"]'), 'নবম অধ্যায়ের নোট');
  ctx.submit(ctx.$('#teacherCourseEditor form'));
  await ctx.waitFor(() => /সংরক্ষিত হয়েছে/.test(ctx.$('#teacherCourseEditor [data-course-status]').textContent));
  const stored = await listCourseContentForStaff(
    { classId: classByName('দশম শ্রেণি').id, subjectId: subjectByName('গণিত').id, includeInactive: true },
    { role: 'teacher', actor: 'TEACHER' }
  );
  assert.equal(stored.length, 1);
  assert.equal(stored[0].title, 'নবম অধ্যায়ের নোট');
  assert.equal(stored[0].published, false, 'a Teacher never publishes by accident');
});

test('the Manager panel opens the same page for the whole academic structure', async () => {
  const ctx = await loadPage('manager.html', { seed: { 'activePlus.demo.autofill.v1': 'off' } });
  contexts.push(ctx);
  await openStaffPanel(ctx, 'manager', {
    importPanel: () => import('../js/manager.js'), shellId: 'managerShell'
  });
  ctx.click(ctx.$('[data-manager-view="courses"]'));
  await ctx.waitFor(() => ctx.$('[data-view-panel="courses"]') && ctx.$('[data-view-panel="courses"]').hidden === false);
  assert.match(ctx.$('#managerCourseTitle').textContent, /পড়াশোনা পরিচালনা করুন/);
  await ctx.waitFor(() => ctx.$$('#managerCourseEditor [data-course-form]').length === 1);
  const classes = Array.from(ctx.$('#managerCourseEditor select[name="className"]').options).map(option => option.value);
  assert.ok(classes.length >= 5, 'every enabled class is offered');
  assert.ok(classes.includes('দশম শ্রেণি'));
  const subjects = Array.from(ctx.$('#managerCourseEditor select[name="subject"]').options).map(option => option.value);
  assert.ok(subjects.includes('গণিত'));
  assert.equal(ctx.window.localStorage.getItem(COURSE_CONTENT_KEY), null, 'opening the page writes no course data');
});
