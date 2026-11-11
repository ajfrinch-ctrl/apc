import test from 'node:test';
import assert from 'node:assert/strict';
import {
  examRepository as repo,
  EXAM_KEY,
  MANAGER_ACTOR,
  TEACHER_ACTOR,
  ADMIN_ACTOR,
  classResultRows
} from '../js/exam-data.js';
import { examPermissions } from '../js/exam-archive.js';
import { ROLE_CAPABILITIES, CAPABILITIES } from '../js/admin-permissions.js';
import { adminStudents } from '../js/admin-data.js';
import { ROSTER_KEY } from '../js/office-data.js';
import { enabledClasses } from '../js/config.js';
import { TEACHER_ASSIGNMENTS_KEY } from '../js/teacher-assignments.js';
import { STAFF_ACCOUNTS } from '../js/staff-auth.js';
import { STORAGE_KEYS } from '../js/config.js';

const sciStudent1 = { id: 'STD-SCI-1', name: 'রাইসা (বিজ্ঞান)', className: 'দশম শ্রেণি', group: 'বিজ্ঞান বিভাগ', status: 'approved' };
const sciStudent2 = { id: 'STD-SCI-2', name: 'তহমিদ (বিজ্ঞান)', className: 'দশম শ্রেণি', group: 'বিজ্ঞান', status: 'approved' };
const artsStudent = { id: 'STD-ARTS-1', name: 'করিম (মানবিক)', className: 'দশম শ্রেণি', group: 'মানবিক বিভাগ', status: 'approved' };
const nineStudent = { id: 'STD-NINE-1', name: 'নবম শিক্ষার্থী', className: 'নবম শ্রেণি', group: 'বিজ্ঞান', status: 'approved' };

function setup(activeStudent = sciStudent1) {
  const roster = [sciStudent1, sciStudent2, artsStudent, nineStudent, ...adminStudents];
  const assignments = enabledClasses.map((className, index) => ({
    id: `TAS-${index}`,
    teacherUsername: 'teacher.apc',
    teacherName: 'Test Teacher',
    className,
    group: '',
    subject: 'গণিত',
    subjects: ['গণিত']
  }));
  const store = new Map([
    [ROSTER_KEY, JSON.stringify(roster)],
    [TEACHER_ASSIGNMENTS_KEY, JSON.stringify(assignments)],
    [STAFF_ACCOUNTS.teacher.accountKey, JSON.stringify({ role: 'teacher', username: 'teacher.apc', fullName: 'Test Teacher', status: 'active' })],
    [STAFF_ACCOUNTS.manager.accountKey, JSON.stringify({ role: 'manager', username: 'manager.apc', fullName: 'Test Manager', status: 'active' })],
    [STAFF_ACCOUNTS.admin.accountKey, JSON.stringify({ role: 'admin', username: 'admin.apc', fullName: 'Test Admin', status: 'active' })],
    [STORAGE_KEYS.account, JSON.stringify({ status: 'active', student: activeStudent })]
  ]);
  const sessions = new Map([
    [STAFF_ACCOUNTS.teacher.sessionKey, '1'],
    [STAFF_ACCOUNTS.manager.sessionKey, '1'],
    [STAFF_ACCOUNTS.admin.sessionKey, '1'],
    [STORAGE_KEYS.session, '1']
  ]);
  globalThis.window = {
    localStorage: {
      getItem: key => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, value),
      removeItem: key => store.delete(key)
    },
    sessionStorage: {
      getItem: key => sessions.get(key) ?? null,
      setItem: (key, value) => sessions.set(key, value),
      removeItem: key => sessions.delete(key)
    },
    dispatchEvent: () => {}
  };
  return { store, roster };
}

test('Admin and Manager can both approve and publish; Teacher remains submit-only', async () => {
  setup();
  assert.equal(ROLE_CAPABILITIES.admin.includes(CAPABILITIES.REPORTS_VIEW), true);
  assert.equal(ROLE_CAPABILITIES.admin.includes(CAPABILITIES.EXAMS_PUBLISH), true);
  assert.equal(ROLE_CAPABILITIES.manager.includes(CAPABILITIES.EXAMS_PUBLISH), true);

  const futureStart = Date.now() + 3600000;
  const futureEnd = futureStart + 3600000;
  const draftSnap = await repo.saveDraft({
    type: 'mcq',
    title: 'বীজগণিত পরীক্ষা',
    subject: 'গণিত',
    className: 'দশম শ্রেণি',
    group: 'বিজ্ঞান',
    startAt: futureStart,
    endAt: futureEnd,
    lateMinutes: 10,
    negative: 0.25,
    passPercent: 40,
    template: 'প্রশ্ন: ২+২ কত?\nA: ৩\nB: ৪\nC: ৫\nD: ৬\nউত্তর: B'
  }, TEACHER_ACTOR);
  const exam = draftSnap.exams[0];

  // Admin and Manager both hold the approval/publishing capability.
  const adminPerm = examPermissions(ADMIN_ACTOR, { ...exam, status: 'pending' }, { now: Date.now() });
  assert.equal(adminPerm.review, true);
  assert.equal(adminPerm.approve, true);
  assert.equal(adminPerm.publish, true);

  // Teacher requests approval -> Admin rejects with reason -> Teacher sees rejection reason
  await repo.requestApproval(exam.id, TEACHER_ACTOR);
  await repo.reject(exam.id, 'প্রশ্ন ২ যোগ করে আবার পাঠান।', ADMIN_ACTOR);

  const teacherView = await repo.list(TEACHER_ACTOR);
  const rejectedExam = teacherView.exams.find(e => e.id === exam.id);
  assert.equal(rejectedExam.status, 'rejected');
  assert.equal(rejectedExam.reviewNote, 'প্রশ্ন ২ যোগ করে আবার পাঠান।');

  // Manager approves and publishes
  await repo.requestApproval(exam.id, TEACHER_ACTOR);
  await repo.publish(exam.id, MANAGER_ACTOR);
  const pubView = await repo.list(MANAGER_ACTOR);
  assert.equal(pubView.exams.find(e => e.id === exam.id).status, 'published');
});

test('all-results card (classResultRows) scopes student rows strictly to the same class-section', () => {
  const { roster } = setup(sciStudent1);
  const exam = {
    id: 'EX-SCOPE-1',
    type: 'mcq',
    title: 'সাধারণ গণিত',
    subject: 'গণিত',
    className: 'দশম শ্রেণি',
    group: '',
    startAt: 1000,
    endAt: 2000,
    passPercent: 40,
    resultsPublished: true,
    questions: [{ id: 'q1', marks: 10 }],
    participants: [sciStudent1, sciStudent2, artsStudent]
  };
  const db = {
    version: 1,
    exams: [exam],
    attempts: [
      { id: 'A1', examId: 'EX-SCOPE-1', studentId: sciStudent1.id, name: sciStudent1.name, className: sciStudent1.className, group: sciStudent1.group, number: 1, score: 9, status: 'submitted', finishedAt: 1500 },
      { id: 'A2', examId: 'EX-SCOPE-1', studentId: sciStudent2.id, name: sciStudent2.name, className: sciStudent2.className, group: sciStudent2.group, number: 1, score: 8, status: 'submitted', finishedAt: 1600 },
      { id: 'A3', examId: 'EX-SCOPE-1', studentId: artsStudent.id, name: artsStudent.name, className: artsStudent.className, group: artsStudent.group, number: 1, score: 10, status: 'submitted', finishedAt: 1400 },
      { id: 'A4', examId: 'EX-SCOPE-1', studentId: nineStudent.id, name: nineStudent.name, className: nineStudent.className, group: nineStudent.group, number: 1, score: 10, status: 'submitted', finishedAt: 1300 }
    ]
  };

  // Viewer is sciStudent1 (দশম শ্রেণি • বিজ্ঞান বিভাগ)
  const rowsForSci = classResultRows(db, exam, roster, sciStudent1);
  const idsForSci = rowsForSci.map(r => r.studentId);
  assert.equal(idsForSci.includes(sciStudent1.id), true);
  assert.equal(idsForSci.includes(sciStudent2.id), true);
  assert.equal(idsForSci.includes(artsStudent.id), false, 'মানবিক বিভাগের শিক্ষার্থীর ফলাফল বিজ্ঞান বিভাগে দেখাবে না');
  assert.equal(idsForSci.includes(nineStudent.id), false, 'অন্য শ্রেণির শিক্ষার্থীর ফলাফল দেখাবে না');
});
