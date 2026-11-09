/* "সব ক্লাস · সব বিষয় একসাথে দিন" — one click hands a Teacher the whole school.

   The Manager form used to give out one class at a time, so the Teacher panel
   opened from a Super Admin session saw nothing until somebody typed in ten
   rows. assignEverything() writes ordinary assignment rows — one per class,
   every subject the class runs — so the existing edit/remove controls keep
   working and every publish gate (course, exam, question bank, lecture sheet)
   answers from rows it already understands. */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { provisionStaff, seedStaffSession } from './staff-harness.mjs';
import { assignEverything, listTeacherAssignments, selectableSubjects, isTeacherAssigned, isTeacherAssignedSubject, TEACHER_ASSIGNMENTS_KEY } from '../js/teacher-assignments.js';
import { ACADEMICS_KEY, listClasses, subjectsForClass } from '../js/academics.js';

let ctx;

before(async () => {
  ctx = await loadPage('student.html', { seed: { 'activePlus.demo.autofill.v1': 'off' } });
  /* The panel's built-in device Teacher account is what a Super Admin session
     browsing teacher.html resolves to, so the Manager can hand it work too. */
  await provisionStaff('teacher');
  await provisionStaff('manager');
  seedStaffSession(ctx.window, 'manager');
});
after(() => ctx?.window.close());

test('every class in Academic Setup reaches the chosen teacher with all of its subjects', async () => {
  const classes = listClasses().map(item => item.name);
  assert.ok(classes.length, 'Academic Setup lists classes');
  const result = await assignEverything({ teacherUsername: 'teacher.apc', classes });
  assert.deepEqual(result.failed, [], 'nothing failed');
  assert.equal(result.assigned.length + result.skipped.length, classes.length, 'each class is either assigned or explicitly skipped');
  assert.ok(result.assigned.length, 'at least one class was assigned');

  const rows = listTeacherAssignments('teacher.apc');
  for (const className of result.assigned) {
    const row = rows.find(item => item.className === className);
    assert.ok(row, `${className} has a row`);
    assert.equal(row.group, '', 'the whole class, not one batch');
    assert.deepEqual([...row.subjects].sort(), [...selectableSubjects(className)].sort(), `${className} carries every enabled subject`);
    /* The gates a Teacher panel actually asks. */
    assert.equal(isTeacherAssigned('teacher.apc', className), true);
    for (const subject of selectableSubjects(className)) {
      assert.equal(isTeacherAssignedSubject('teacher.apc', className, subject), true, `${className} • ${subject}`);
    }
  }
});

test('running it again updates the same rows instead of piling up duplicates', async () => {
  const classes = listClasses().map(item => item.name);
  const before = listTeacherAssignments('teacher.apc');
  await assignEverything({ teacherUsername: 'teacher.apc', classes });
  const after = listTeacherAssignments('teacher.apc');
  assert.equal(after.length, before.length, 'no duplicate rows');
  assert.deepEqual(after.map(item => item.id).sort(), before.map(item => item.id).sort(), 'the same rows were edited');
});

test('the readable subject mirror on an assignment never becomes a subject', async () => {
  /* Handing out five subjects per class writes `subject: "গণিত, ইংরেজি, …"` as
     a mirror. The Academic seed used to adopt that string as a real subject, so
     Academic Setup filled up with one giant comma-named subject per class. */
  ctx.window.localStorage.setItem(TEACHER_ASSIGNMENTS_KEY, JSON.stringify([{
    id: 'TAS-MIRROR', teacherUsername: 'teacher.apc', teacherName: 'teacher.apc',
    className: 'দশম শ্রেণি', group: '', subjects: ['গণিত', 'ইংরেজি'], subject: 'গণিত, ইংরেজি'
  }]));
  ctx.window.localStorage.removeItem(ACADEMICS_KEY);
  const names = subjectsForClass('দশম শ্রেণি').map(item => item.name);
  assert.ok(names.length, 'the class still has its subjects');
  assert.equal(names.some(name => name.includes(', ')), false, 'the joined mirror was not adopted as a subject');
});
