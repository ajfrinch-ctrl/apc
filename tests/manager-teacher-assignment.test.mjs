/* Manager portal → teacher work assignment, by Login User ID.
   The bug this pins: the শিক্ষক form always saved work onto the built-in
   teacher.apc device account, so a teacher whose Login User ID was created in
   Admin Staff Management could never be given class/batch/subject work from
   the Manager portal. The form must list every active teacher-role staff
   member, the saved row must be keyed to the chosen Login User ID (and appear
   in that teacher's panel scope), and the subject delete button must keep the
   row on the teacher who owns it. Callers that pass no teacher keep the old
   teacher.apc behaviour, byte for byte. */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { provisionStaff, seedStaffSession } from './staff-harness.mjs';
import {
  TEACHER_ASSIGNMENTS_KEY, listTeacherAssignments,
  saveTeacherAssignment, deleteAssignmentSubject, deleteTeacherAssignment
} from '../js/teacher-assignments.js';
import { createStaff } from '../js/staff-directory.js';
import { STAFF_ACCOUNTS } from '../js/staff-auth.js';

const nfc = value => String(value || '').normalize('NFC');
const rows = () => JSON.parse(ctx.window.localStorage.getItem(TEACHER_ASSIGNMENTS_KEY) || '[]');

let ctx;

before(async () => {
  ctx = await loadPage('manager.html', { seed: { 'activePlus.demo.autofill.v1': 'off' } });
  await provisionStaff('manager');
  /* The built-in teacher device account every install carries. */
  ctx.window.localStorage.setItem(STAFF_ACCOUNTS.teacher.accountKey, JSON.stringify({ role: 'teacher', username: 'teacher.apc', fullName: 'Rahim Uddin', status: 'active' }));
  seedStaffSession(ctx.window, 'manager');
  await provisionStaff('admin');
  /* createStaff is Admin-only; the sessions live under per-role keys, so the
     device can be signed in as both Admin (creates) and Manager (assigns). */
  seedStaffSession(ctx.window, 'admin');
  const { managerReady } = await import('../js/manager.js');
  await managerReady;
});

after(() => ctx?.window.close());

test('Manager assigns work to an Admin-created teacher by Login User ID', async () => {
  /* The exact function the Admin create form submits to. */
  const created = await createStaff({
    fullName: 'নতুন শিক্ষক',
    role: 'teacher',
    password: 'TestPass1234',
    confirmPassword: 'TestPass1234'
  });
  assert.equal(created.ok, true, created.error);
  const username = String(created.staff.username).toLowerCase();
  assert.equal(username, 'notun.teacher.apc');

  /* The form now offers every active teacher — not just teacher.apc. */
  ctx.click(ctx.$('[data-panel-view="teachers"]'));
  const form = ctx.$('#managerTeacherAssignmentForm');
  await ctx.waitFor(() => form.elements.teacherUsername.options.length >= 2);
  const offered = [...form.elements.teacherUsername.options].map(option => option.value.toLowerCase());
  assert.ok(offered.includes(username), `picker offers the new teacher: ${offered.join(', ')}`);
  assert.ok(offered.includes('teacher.apc'), 'the built-in teacher stays available');

  /* Assign দশম শ্রেণি · গণিত + রসায়ন to the NEW teacher through the form. */
  form.elements.teacherUsername.value = username;
  form.elements.className.value = 'দশম শ্রেণি';
  form.elements.className.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  await ctx.waitFor(() => ctx.$$('#managerTeacherSubjectList input[name=subject]').length >= 2);
  for (const name of ['গণিত', 'রসায়ন']) {
    const box = ctx.$$('#managerTeacherSubjectList input[name=subject]').find(input => nfc(input.value) === nfc(name));
    assert.ok(box, `subject checkbox for ${name}`);
    box.checked = true;
  }
  ctx.submit(form);

  await ctx.waitFor(() => rows().some(row => row.teacherUsername === username));
  const mine = listTeacherAssignments(username);
  assert.equal(mine.length, 1);
  assert.equal(nfc(mine[0].className), nfc('দশম শ্রেণি'));
  assert.deepEqual(mine[0].subjects.map(nfc).sort(), [nfc('গণিত'), nfc('রসায়ন')].sort());
  assert.equal(nfc(mine[0].teacherName), nfc('নতুন শিক্ষক'), 'the row carries the chosen teacher');
  assert.equal(mine[0].teacherUsername, username);

  /* teacher.apc was never touched. */
  assert.equal(listTeacherAssignments('teacher.apc').length, 0, 'the singleton receives nothing');

  /* The work is visible in the Manager teacher list. */
  await ctx.waitFor(() => nfc(ctx.$('#managerTeacherList').textContent).includes(nfc('নতুন শিক্ষক')));

  /* Subject delete keeps the row on THIS teacher (it used to re-save onto
     teacher.apc and fail, silently leaving the subject in place). */
  await deleteAssignmentSubject(mine[0].id, 'গণিত');
  const left = listTeacherAssignments(username);
  assert.equal(left.length, 1, 'the row survives with its remaining subject');
  assert.deepEqual(left[0].subjects.map(nfc), [nfc('রসায়ন')]);
  assert.equal(left[0].teacherUsername, username);
  assert.equal(listTeacherAssignments('teacher.apc').length, 0);
});

test('a caller that names no teacher keeps assigning to teacher.apc', async () => {
  const saved = await saveTeacherAssignment({ className: 'দশম শ্রেণি', subjects: ['উচ্চতর গণিত'] });
  assert.ok(Array.isArray(saved) && saved.length, 'the save returns the written rows');
  const mine = listTeacherAssignments('teacher.apc');
  assert.equal(mine.length, 1);
  assert.equal(nfc(mine[0].className), nfc('দশম শ্রেণি'));
  assert.equal(mine[0].teacherUsername, 'teacher.apc');
  assert.deepEqual(mine[0].subjects.map(nfc), [nfc('উচ্চতর গণিত')]);
  await deleteTeacherAssignment(mine[0].id);
  assert.equal(listTeacherAssignments('teacher.apc').length, 0);
});
