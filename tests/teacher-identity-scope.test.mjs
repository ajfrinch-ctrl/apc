/* Teacher identity ↔ assignment relation (the User/Teacher/Class mapping).

   The bug this locks down: assignments used to be keyed to a hard-coded role
   account ("teacher.apc") while Staff Management created real people with
   their own Login User IDs ("rahim.teacher.apc") — so a new teacher logged in
   and saw nothing. Covered here on the real data layer:

     • Admin's per-class assignment (Class 8 → গণিত, ইংরেজি; Class 9 → গণিত)
       projects into the assignment store keyed by the record's own Login
       User ID — never by role or name
     • the session records WHO signed in (identity), and logging out clears it
     • the teacher panel resolves the signed-in person's own profile
     • one teacher's rows never leak to another username
     • assignment edits follow the staff record; role moves / deletes clean up
     • a pre-bridge record answers through the merged read — no migration
*/
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { provisionStaff, seedStaffSession } from './staff-harness.mjs';
import {
  saveStaffSession,
  clearStaffSession,
  readActiveStaffIdentity
} from '../js/staff-auth.js';
import {
  createStaff,
  updateStaff,
  deleteStaff,
  findDirectoryStaffByUsername
} from '../js/staff-directory.js';
import {
  TEACHER_ASSIGNMENTS_KEY,
  listTeacherAssignments,
  isTeacherAssigned,
  isTeacherAssignedSubject,
  effectiveTeacherAssignments,
  removeDirectoryAssignmentRows
} from '../js/teacher-assignments.js';
import { currentTeacherProfile, setTeachingScope, teachingScopeUsername } from '../js/teaching-data.js';
import { enabledClasses } from '../js/config.js';

const CLASS_A = enabledClasses[0];
const CLASS_B = enabledClasses[1];
const SUBJECT_MATH = 'গণিত';
const SUBJECT_ENGLISH = 'ইংরেজি';

let ctx;
const rows = () => JSON.parse(ctx.window.localStorage.getItem(TEACHER_ASSIGNMENTS_KEY) || '[]');

before(async () => {
  ctx = await loadPage('index.html', { seed: { 'activePlus.demo.autofill.v1': 'off' } });
  await provisionStaff('admin');
  seedStaffSession(ctx.window, 'admin');
});
after(() => ctx?.window.close());

const teacherFields = (extra = {}) => ({
  fullName: 'Rahim Uddin',
  password: 'Rahim-2026',
  confirmPassword: 'Rahim-2026',
  role: 'teacher',
  ...extra
});

test('Admin per-class assignment projects into the store keyed by the Login User ID', async () => {
  const created = await createStaff(teacherFields({
    assignment: {
      classes: [CLASS_A, CLASS_B],
      classSubjects: { [CLASS_A]: [SUBJECT_MATH, SUBJECT_ENGLISH], [CLASS_B]: [SUBJECT_MATH] },
      subjects: [], batches: []
    }
  }));
  assert.equal(created.ok, true, created.error);
  const username = created.staff.username;
  assert.match(username, /\.teacher\.apc$/);

  const mine = listTeacherAssignments(username);
  assert.equal(mine.length, 2, 'one row per assigned class');
  const classA = mine.find(item => item.className === CLASS_A);
  const classB = mine.find(item => item.className === CLASS_B);
  assert.deepEqual([...classA.subjects].sort(), [SUBJECT_ENGLISH, SUBJECT_MATH].sort());
  assert.deepEqual(classB.subjects, [SUBJECT_MATH]);
  for (const row of mine) {
    assert.equal(row.teacherUsername, username, 'rows are keyed to the person, not the role account');
    assert.equal(row.staffId, created.staff.staffId);
    assert.equal(row.source, 'directory');
  }

  // Scope gates: this teacher's own classes answer; others do not.
  assert.equal(isTeacherAssignedSubject(username, CLASS_A, SUBJECT_MATH), true);
  assert.equal(isTeacherAssignedSubject(username, CLASS_B, SUBJECT_ENGLISH), false);
  assert.equal(isTeacherAssigned('teacher.apc', CLASS_A), false, "the role account is not this person");
  assert.equal(listTeacherAssignments('teacher.apc').length, 0, 'no leak to the built-in account');
  assert.equal(listTeacherAssignments('karim.teacher.apc').length, 0, 'no leak to another teacher');
});

test('the session records who signed in, and signing out clears it', async () => {
  const record = await findDirectoryStaffByUsername('rahim.teacher.apc');
  assert.ok(record, 'the directory record exists');

  await saveStaffSession('teacher', true, {
    username: record.username, staffId: record.staffId, fullName: record.fullName
  });
  const identity = readActiveStaffIdentity();
  assert.equal(identity.username, record.username);
  assert.equal(identity.staffId, record.staffId);
  assert.equal(identity.role, 'teacher');

  // The panel resolves the signed-in person's own profile — not teacher.apc.
  const profile = await currentTeacherProfile();
  assert.equal(profile.username, record.username);
  assert.equal(profile.staffId, record.staffId);
  assert.equal(profile.fullName, 'Rahim Uddin');

  setTeachingScope(profile.username);
  assert.equal(teachingScopeUsername(), record.username);

  clearStaffSession('teacher');
  assert.equal(readActiveStaffIdentity(), null, 'logout ends the identity');
  // One panel per device: signing the teacher session in dropped the Admin
  // session. Restore it so the later cases can keep managing staff.
  seedStaffSession(ctx.window, 'admin');
});

test('assignment edits follow the staff record; role moves and deletes clean up', async () => {
  const record = await findDirectoryStaffByUsername('rahim.teacher.apc');
  // Admin swaps Class 8 for Class 9 only.
  const updated = await updateStaff(record.staffId, {
    assignment: { classes: [CLASS_B], classSubjects: { [CLASS_B]: [SUBJECT_ENGLISH] }, subjects: [], batches: [] }
  });
  assert.equal(updated.ok, true, updated.error);
  const mine = listTeacherAssignments('rahim.teacher.apc');
  assert.equal(mine.length, 1, 'the removed class leaves the store');
  assert.equal(mine[0].className, CLASS_B);
  assert.deepEqual(mine[0].subjects, [SUBJECT_ENGLISH]);

  // Moving the person out of the Teacher role drops academic rows entirely.
  const moved = await updateStaff(record.staffId, { role: 'manager' });
  assert.equal(moved.ok, true, moved.error);
  assert.equal(listTeacherAssignments(moved.staff.username).length, 0);
  assert.equal(listTeacherAssignments('rahim.teacher.apc').length, 0, 'the renamed id leaves no rows behind');

  // Deleting a staff account removes only its projected rows.
  const recreated = await createStaff(teacherFields({
    fullName: 'Karim Uddin',
    assignment: { classes: [CLASS_A], classSubjects: { [CLASS_A]: [SUBJECT_MATH] }, subjects: [], batches: [] }
  }));
  assert.equal(recreated.ok, true, recreated.error);
  assert.equal(listTeacherAssignments(recreated.staff.username).length, 1);
  const gone = await deleteStaff(recreated.staff.staffId);
  assert.equal(gone.ok, true, gone.error);
  assert.equal(listTeacherAssignments(recreated.staff.username).length, 0);
});

test('a pre-bridge record answers through the merged read — no migration needed', async () => {
  const created = await createStaff(teacherFields({
    fullName: 'Fatema Khatun',
    assignment: { classes: [CLASS_A], subjects: [SUBJECT_MATH, SUBJECT_ENGLISH], batches: [] }
  }));
  assert.equal(created.ok, true, created.error);
  const username = created.staff.username;
  // Legacy flat shape still projects (every selected class carries the list).
  let mine = listTeacherAssignments(username);
  assert.equal(mine.length, 1);
  assert.deepEqual([...mine[0].subjects].sort(), [SUBJECT_ENGLISH, SUBJECT_MATH].sort());

  // Simulate a record saved before the bridge existed: store emptied, directory
  // record untouched. The merged read must still answer, without any migration.
  ctx.window.localStorage.removeItem(TEACHER_ASSIGNMENTS_KEY);
  assert.equal(listTeacherAssignments(username).length, 0);
  mine = await effectiveTeacherAssignments(username);
  assert.equal(mine.length, 1, 'the directory fallback fills the gap');
  assert.equal(mine[0].className, CLASS_A);

  removeDirectoryAssignmentRows(username);
});
