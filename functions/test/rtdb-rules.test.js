/* Authoritative check of the PROPOSED per-user Realtime Database rules
   (database.rules.v2.draft.json) against the real rules engine.

     cd functions && npm run test:rtdb-rules

   Needs Java 11+ and the database emulator (firebase-tools downloads it).
   This suite must pass before the draft replaces database.rules.json — see
   docs/RTDB-PER-USER-RULES-PLAN.md. It loads the DRAFT file explicitly; the
   current interim policy is covered by the repository-local simulator tests
   (`tests/interim-sync-rules.test.mjs` and `tests/rtdb-path-coverage.test.mjs`),
   not by this draft-only emulator suite. */
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');

const ROOT = 'activePlusV2';
const NOW = Date.now();
const staff = (role, extra = {}) => ({ role, status: 'active', mustChangePassword: false, ...extra });

test('RTDB v2 draft: per-user/role boundary', async t => {
  const env = await initializeTestEnvironment({
    projectId: 'demo-active-plus-rtdb',
    database: { rules: readFileSync(resolve(__dirname, '../../database.rules.v2.draft.json'), 'utf8') }
  });
  t.after(() => env.cleanup());

  await env.withSecurityRulesDisabled(async context => {
    await context.database().ref().set({
      activePlusSync: { v1: { staffAccounts: { admin: { username: 'a', pinHash: 'x' } } } },
      [ROOT]: {
        settings: { broadcast: '' },
        notices: { n1: { id: 'n1', title: 'Notice', published: true } },
        noticeDraftsByAuthor: {
          'u-teacher': { d1: { id: 'd1', authorUid: 'u-teacher', classId: 'class1', group: '', status: 'draft', published: false } }
        },
        studentNotices: {
          S1: { n1: { id: 'n1', title: 'Notice', published: true } },
          S2: { n2: { id: 'n2', title: 'Other class', published: true } }
        },
        routine: { r1: { id: 'r1', title: 'Morning' } },
        academics: {
          __metadata: { _syncKind: 'metadata', id: '__metadata', version: 2 },
          'class-class1': { _syncKind: 'class', record: { id: 'class1', name: 'Class 1' } }
        },
        teacherAssignments: { as1: { id: 'as1', teacherId: 'T1', classId: 'class1' } },
        teachingDraftsByTeacher: {
          T1: { d1: { id: 'd1', teacherId: 'T1', type: 'homework', status: 'draft' } },
          T2: { d2: { id: 'd2', teacherId: 'T2', type: 'homework', status: 'draft' } }
        },
        teachingByTeacher: {
          T1: { hw1: { id: 'hw1', teacherId: 'T1', type: 'homework', status: 'published' } },
          T2: { hw2: { id: 'hw2', teacherId: 'T2', type: 'homework', status: 'published' } }
        },
        studentTeaching: {
          S1: { hw1: { id: 'hw1', teacherId: 'T1', type: 'homework', status: 'published' } },
          S2: { hw2: { id: 'hw2', teacherId: 'T2', type: 'homework', status: 'published' } }
        },
        studentTeachingProgress: {},
        teachingProgressByTeacher: {},
        courseContentDraftsByAuthor: {
          'u-teacher': { cDraft: { id: 'cDraft', authorUid: 'u-teacher', classId: 'class1', subjectId: 'subject1', published: false, active: true } },
          'u-teacher2': { cDraft2: { id: 'cDraft2', authorUid: 'u-teacher2', classId: 'class2', subjectId: 'subject1', published: false, active: true } }
        },
        courseContentByAuthor: {
          'u-teacher': { c1: { id: 'c1', authorUid: 'u-teacher', classId: 'class1', subjectId: 'subject1', published: true, active: true } },
          'u-teacher2': { c2: { id: 'c2', authorUid: 'u-teacher2', classId: 'class2', subjectId: 'subject1', published: true, active: true } }
        },
        studentCourseContent: {
          S1: { c1: { id: 'c1', published: true, active: true } },
          S2: { c2: { id: 'c2', published: true, active: true } }
        },
        students: { S1: { id: 'S1', name: 'A' }, S2: { id: 'S2', name: 'B' } },
        transactions: { tx1: { id: 'tx1', studentId: 'S1', amount: 500 } },
        exams: {
          e1: { id: 'e1', teacherId: 'T1', status: 'draft' },
          e2: { id: 'e2', teacherId: 'T1', status: 'published' }
        },
        studentExams: { S1: { e2: { id: 'e2', title: 'Paper' } } },
        attempts: { S1: { a1: { id: 'a1', studentId: 'S1', examId: 'e2', status: 'submitted', startedAt: NOW - 1000 } } }
      }
    });
  });

  const as = (uid, claims) => env.authenticatedContext(uid, claims).database();
  const admin = as('u-admin', staff('admin'));
  const manager = as('u-manager', staff('manager'));
  const teacher = as('u-teacher', staff('teacher', { teacherId: 'T1' }));
  const teacher2 = as('u-teacher2', staff('teacher', { teacherId: 'T2' }));
  const payment = as('u-payment', staff('payment'));
  const studentA = as('u-sa', { role: 'student', status: 'approved', studentId: 'S1' });
  const anonymous = as('anon', { firebase: { sign_in_provider: 'anonymous' }, role: 'admin', status: 'active' });
  const mustChange = as('u-new', staff('admin', { mustChangePassword: true }));
  const signedOut = env.unauthenticatedContext().database();
  const get = (db, path) => db.ref(path).once('value');
  const put = (db, path, value) => db.ref(path).set(value);
  const p = path => `${ROOT}/${path}`;

  // Legacy bridge + root: closed to everyone.
  for (const db of [admin, studentA, anonymous, signedOut]) {
    await assertFails(get(db, 'activePlusSync/v1/staffAccounts'));
    await assertFails(put(db, 'activePlusSync/v1/staffAccounts/admin', { username: 'evil' }));
    await assertFails(get(db, ROOT));
  }
  // Anonymous (even with a role-looking claim), signed-out, forced-change: nothing.
  for (const db of [anonymous, signedOut, mustChange]) {
    await assertFails(get(db, p('settings')));
    await assertFails(get(db, p('students/S1')));
  }

  // Settings / notices / routines / academics.
  await assertSucceeds(get(studentA, p('settings')));
  await assertFails(put(studentA, p('settings/broadcast'), 'x'));
  await assertSucceeds(put(admin, p('settings/broadcast'), 'urgent'));
  await assertSucceeds(get(teacher, p('notices')));
  await assertFails(get(studentA, p('notices')));
  await assertSucceeds(put(admin, p('notices/n2'), { id: 'n2', title: 'New', published: true }));
  await assertSucceeds(put(manager, p('notices/n3'), { id: 'n3', title: 'Manager notice', published: true }));
  await assertFails(put(teacher, p('notices/n4'), { id: 'n4', title: 'Teacher notice' }));
  await assertFails(put(studentA, p('notices/n5'), { id: 'n5', title: 'x' }));
  await assertFails(put(manager, p('notices/n6'), { id: 'wrong', title: 'x', published: true }));
  await assertFails(put(manager, p('notices/n7'), { id: 'n7', title: 'Unpublished', published: false }));
  await assertSucceeds(put(teacher, p('noticeDraftsByAuthor/u-teacher/d2'), {
    id: 'd2', authorUid: 'u-teacher', classId: 'class1', group: '', status: 'draft', published: false
  }));
  await assertFails(put(teacher, p('noticeDraftsByAuthor/u-teacher2/d2'), {
    id: 'd2', authorUid: 'u-teacher2', classId: 'class2', group: '', status: 'draft', published: false
  }));
  await assertSucceeds(get(studentA, p('studentNotices/S1')));
  await assertFails(get(studentA, p('studentNotices/S2')));
  await assertFails(get(studentA, p('studentNotices')));
  await assertFails(put(studentA, p('studentNotices/S1/n2'), { id: 'n2', published: true }));
  await assertSucceeds(put(manager, p('routine/r2'), { id: 'r2', title: 'Routine' }));
  await assertFails(put(studentA, p('routine/r3'), { id: 'r3' }));
  await assertSucceeds(get(studentA, p('academics')));
  await assertSucceeds(put(admin, p('academics/class-class2'), { _syncKind: 'class', record: { id: 'class2', name: 'Class 2' } }));
  await assertFails(put(admin, p('academics/class-class3'), { _syncKind: 'class', record: { id: 'wrong', name: 'Class 3' } }));
  await assertFails(put(manager, p('academics/class-class4'), { _syncKind: 'class', record: { id: 'class4' } }));

  // Teaching: private drafts, server-published canonical activities, and
  // student-isolated copies / staff progress paths.
  await assertSucceeds(get(teacher, p('teachingDraftsByTeacher/T1')));
  await assertSucceeds(get(teacher, p('teachingByTeacher/T1')));
  await assertFails(get(teacher, p('teachingByTeacher/T2')));
  await assertSucceeds(get(manager, p('teachingByTeacher/T2')));
  await assertSucceeds(put(teacher, p('teachingDraftsByTeacher/T1/d3'), { id: 'd3', teacherId: 'T1', type: 'homework', status: 'draft' }));
  await assertFails(put(teacher, p('teachingDraftsByTeacher/T2/d3'), { id: 'd3', teacherId: 'T2', type: 'homework', status: 'draft' }));
  await assertFails(put(teacher, p('teachingDraftsByTeacher/T1/d4'), { id: 'd4', teacherId: 'T1', type: 'homework', status: 'draft', progress: { S1: 'done' } }));
  await assertFails(put(teacher, p('teachingDraftsByTeacher/T1/d5'), { id: 'd5', teacherId: 'T1', type: 'homework', status: 'published' }));
  await assertFails(put(teacher, p('teachingByTeacher/T1/hw3'), { id: 'hw3', teacherId: 'T1', type: 'homework', status: 'published' }));
  await assertSucceeds(put(admin, p('teachingByTeacher/T1/hw3'), { id: 'hw3', teacherId: 'T1', type: 'homework', status: 'published' }));
  await assertSucceeds(get(studentA, p('studentTeaching/S1')));
  await assertFails(get(studentA, p('studentTeaching/S2')));
  await assertFails(get(studentA, p('studentTeaching')));
  await assertFails(put(studentA, p('studentTeaching/S1/hw2'), { id: 'hw2', status: 'published' }));
  await assertSucceeds(put(studentA, p('studentTeachingProgress/S1/hw1'), {
    studentId: 'S1', activityId: 'hw1', value: 'done', updatedAt: NOW
  }));
  await assertFails(put(studentA, p('studentTeachingProgress/S1/hw1'), {
    studentId: 'S1', activityId: 'hw1', value: 'reviewed', updatedAt: NOW
  }));
  await assertFails(put(studentA, p('studentTeachingProgress/S1/hw1'), {
    studentId: 'S1', activityId: 'hw1', value: 'done', updatedAt: NOW, score: 100
  }));
  await assertFails(put(studentA, p('studentTeachingProgress/S2/hw2'), {
    studentId: 'S2', activityId: 'hw2', value: 'done', updatedAt: NOW
  }));
  await assertFails(get(studentA, p('teachingProgressByTeacher/T1')));
  await assertSucceeds(get(teacher, p('teachingProgressByTeacher/T1')));
  await assertFails(get(teacher2, p('teachingProgressByTeacher/T1')));
  await assertFails(put(teacher, p('teachingProgressByTeacher/T1/S1/hw1'), {
    teacherId: 'T1', studentId: 'S1', activityId: 'hw1', value: 'reviewed', updatedAt: NOW
  }));

  // Course drafts stay author-scoped. Teacher publication is server-mediated.
  await assertSucceeds(get(teacher, p('courseContentDraftsByAuthor/u-teacher')));
  await assertFails(get(teacher, p('courseContentDraftsByAuthor/u-teacher2')));
  const courseDraft = { id: 'c3', authorUid: 'u-teacher', classId: 'class1', subjectId: 'subject1', published: false, active: true };
  await assertSucceeds(put(teacher, p('courseContentDraftsByAuthor/u-teacher/c3'), courseDraft));
  await assertFails(put(teacher, p('courseContentDraftsByAuthor/u-teacher/c4'), { ...courseDraft, id: 'c4', published: true }));
  await assertFails(put(teacher, p('courseContentByAuthor/u-teacher/c5'), { ...courseDraft, id: 'c5', published: true }));
  await assertSucceeds(put(manager, p('courseContentByAuthor/u-teacher/c5'), { ...courseDraft, id: 'c5', published: true }));
  await assertSucceeds(get(studentA, p('studentCourseContent/S1')));
  await assertFails(get(studentA, p('studentCourseContent/S2')));
  await assertFails(get(studentA, p('studentCourseContent')));
  await assertFails(put(studentA, p('studentCourseContent/S1/c3'), { id: 'c3', published: true, active: true }));

  // Roster: students see only themselves.
  await assertSucceeds(get(teacher, p('students')));
  await assertSucceeds(get(studentA, p('students/S1')));
  await assertFails(get(studentA, p('students/S2')));
  await assertFails(get(studentA, p('students')));

  // Transactions: Payment creates only.
  await assertSucceeds(put(payment, p('transactions/tx2'), { id: 'tx2', studentId: 'S1', amount: 100 }));
  await assertFails(put(payment, p('transactions/tx1'), { id: 'tx1', studentId: 'S1', amount: 1 }));
  await assertFails(put(payment, p('transactions/tx1'), null));
  await assertSucceeds(put(admin, p('transactions/tx1'), null));
  await assertFails(get(manager, p('transactions')));
  await assertFails(get(studentA, p('transactions')));

  // Exams: own unpublished only; no client publishes; students never read papers.
  await assertSucceeds(put(teacher, p('exams/e4'), { id: 'e4', teacherId: 'T1', status: 'draft' }));
  await assertFails(put(teacher, p('exams/e1'), { id: 'e1', teacherId: 'T1', status: 'published' }));
  await assertFails(put(teacher, p('exams/e2'), { id: 'e2', teacherId: 'T1', status: 'draft' }));
  await assertFails(put(manager, p('exams/e1'), { id: 'e1', teacherId: 'T1', status: 'published' }));
  await assertFails(get(studentA, p('exams')));
  await assertSucceeds(get(studentA, p('studentExams/S1')));

  // Attempts.
  const attempt = { id: 'a2', studentId: 'S1', examId: 'e2', status: 'active', startedAt: NOW - 10 };
  await assertSucceeds(put(studentA, p('attempts/S1/a2'), attempt));
  await assertFails(put(studentA, p('attempts/S1/a3'), { ...attempt, id: 'a3', examId: 'e1' }));
  await assertFails(put(studentA, p('attempts/S1/a1'), { ...attempt, id: 'a1' }));
  await assertFails(put(studentA, p('attempts/S1/a4'), { ...attempt, id: 'a4', startedAt: NOW + 3_600_000 }));
  await assertFails(put(studentA, p('results/S1/e2'), { score: 100 }));

  // Push tokens.
  const token = { token: 'x'.repeat(40), role: 'student', studentId: 'S1' };
  await assertSucceeds(put(studentA, p('pushTokens/u-sa/d1'), token));
  await assertFails(put(studentA, p('pushTokens/u-other/d1'), token));
  await assertFails(put(studentA, p('pushTokens/u-sa/d2'), { ...token, role: 'admin' }));
  await assertFails(get(admin, p('pushTokens')));
});
