/* The PROPOSED per-user RTDB rules (database.rules.v2.draft.json).
   See docs/RTDB-PER-USER-RULES-PLAN.md. These tests use a local simulator
   (tests/rtdb-rules-sim.mjs), not the Firebase engine; the emulator suite in
   functions/test/rtdb-rules.test.js must also pass before anything ships. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { render, V2_ROOT } from '../tools/rtdb-rules/build-v2-draft.mjs';
import { createSimulator } from './rtdb-rules-sim.mjs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const draft = JSON.parse(read('../database.rules.v2.draft.json'));
const NOW = Date.UTC(2026, 8, 30, 6, 0, 0);
const sim = createSimulator(draft, { now: NOW });
const R = path => `${V2_ROOT}/${path}`;

// ---- identities -----------------------------------------------------------
const staff = (uid, role, extra = {}) => ({ uid, token: { role, status: 'active', mustChangePassword: false, ...extra } });
const USERS = {
  admin: staff('u-admin', 'admin'),
  manager: staff('u-manager', 'manager'),
  teacher: staff('u-teacher', 'teacher', { teacherId: 'T1' }),
  teacher2: staff('u-teacher2', 'teacher', { teacherId: 'T2' }),
  payment: staff('u-payment', 'payment'),
  studentA: { uid: 'u-sa', token: { role: 'student', status: 'approved', studentId: 'S1' } },
  studentB: { uid: 'u-sb', token: { role: 'student', status: 'approved', studentId: 'S2' } }
};
const BLOCKED = {
  signedOut: null,
  anonymous: { uid: 'anon-1', token: { firebase: { sign_in_provider: 'anonymous' } } },
  anonymousWithRole: { uid: 'anon-2', token: { firebase: { sign_in_provider: 'anonymous' }, role: 'admin', status: 'active' } },
  claimless: { uid: 'u-plain', token: {} },
  adminMustChange: staff('u-admin-new', 'admin', { mustChangePassword: true }),
  suspendedManager: { uid: 'u-m2', token: { role: 'manager', status: 'suspended' } },
  pendingStudent: { uid: 'u-sp', token: { role: 'student', status: 'pending', studentId: 'S9' } },
  studentWithoutLink: { uid: 'u-sx', token: { role: 'student', status: 'approved' } },
  teacherWithoutLink: staff('u-tx', 'teacher')
};

const state = () => ({
  activePlusSync: { v1: { staffAccounts: { admin: { username: 'a', pinHash: 'x' } } } },
  [V2_ROOT]: {
    settings: { broadcast: '' },
    notices: { n1: { id: 'n1', title: 'Notice', published: true } },
    noticeDraftsByAuthor: {
      'u-teacher': { d1: { id: 'd1', authorUid: 'u-teacher', classId: 'class1', group: '', status: 'draft', published: false } },
      'u-manager': { d2: { id: 'd2', authorUid: 'u-manager', classId: 'class1', group: '', status: 'draft', published: false } }
    },
    studentNotices: {
      S1: { n1: { id: 'n1', title: 'Notice', published: true } },
      S2: { n2: { id: 'n2', title: 'Other class', published: true } }
    },
    routine: { r1: { id: 'r1', title: 'Morning' } },
    academics: {
      __metadata: { _syncKind: 'metadata', id: '__metadata', version: 2 },
      'class-class1': { _syncKind: 'class', record: { id: 'class1', name: 'Class 1' } },
      'subject-subject1': { _syncKind: 'subject', record: { id: 'subject1', name: 'Math' } }
    },
    teacherAssignments: { as1: { id: 'as1', teacherId: 'T1', classId: 'class1' } },
    teachingDraftsByTeacher: {
      T1: { d1: { id: 'd1', teacherId: 'T1', type: 'homework', status: 'draft', className: 'Class 1' } },
      T2: { d2: { id: 'd2', teacherId: 'T2', type: 'homework', status: 'draft', className: 'Class 2' } }
    },
    teachingByTeacher: {
      T1: { hw1: { id: 'hw1', teacherId: 'T1', type: 'homework', status: 'published', className: 'Class 1' } },
      T2: { hw2: { id: 'hw2', teacherId: 'T2', type: 'homework', status: 'published', className: 'Class 2' } }
    },
    studentTeaching: {
      S1: { hw1: { id: 'hw1', teacherId: 'T1', type: 'homework', status: 'published', className: 'Class 1' } },
      S2: { hw2: { id: 'hw2', teacherId: 'T2', type: 'homework', status: 'published', className: 'Class 2' } }
    },
    studentTeachingProgress: {
      S1: { hw1: { studentId: 'S1', activityId: 'hw1', value: 'done', updatedAt: NOW - 10 } }
    },
    teachingProgressByTeacher: {
      T1: { S1: { hw1: { teacherId: 'T1', studentId: 'S1', activityId: 'hw1', value: 'done', updatedAt: NOW - 10 } } }
    },
    courseContentDraftsByAuthor: {
      'u-teacher': { cDraft: { id: 'cDraft', authorUid: 'u-teacher', classId: 'class1', subjectId: 'subject1', published: false, active: true, body: 'Draft' } },
      'u-teacher2': { cDraft2: { id: 'cDraft2', authorUid: 'u-teacher2', classId: 'class2', subjectId: 'subject1', published: false, active: true, body: 'Other teacher draft' } }
    },
    courseContentByAuthor: {
      'u-teacher': { c1: { id: 'c1', authorUid: 'u-teacher', classId: 'class1', subjectId: 'subject1', published: true, active: true, body: 'Published' } },
      'u-teacher2': { c2: { id: 'c2', authorUid: 'u-teacher2', classId: 'class2', subjectId: 'subject1', published: true, active: true, body: 'Other teacher content' } }
    },
    studentCourseContent: {
      S1: { c1: { id: 'c1', published: true, active: true, body: 'Published copy' } },
      S2: { c2: { id: 'c2', published: true, active: true, body: 'Class 2 copy' } }
    },
    questionBank: {
      q1: { id: 'q1', className: 'Class 1', subject: 'Math', type: 'mcq', text: '2+2?', answer: 'B', answerText: '', active: true }
    },
    questionBankDraftsByTeacher: {
      T1: { qDraft1: { id: 'qDraft1', teacherId: 'T1', status: 'draft', question: { id: 'qDraft1', className: 'Class 1', subject: 'Math', text: 'Draft?' } } },
      T2: { qDraft2: { id: 'qDraft2', teacherId: 'T2', status: 'draft', question: { id: 'qDraft2', className: 'Class 2', subject: 'Math', text: 'Other draft?' } } }
    },
    teacherQuestionBank: {
      T1: { q1: { id: 'q1', className: 'Class 1', subject: 'Math', type: 'mcq', text: '2+2?', answer: 'B', answerText: '', active: true } },
      T2: { q2: { id: 'q2', className: 'Class 2', subject: 'Math', type: 'mcq', text: '3+3?', answer: 'C', answerText: '', active: true } }
    },
    studentQuestionBank: {
      S1: { q1: { id: 'q1', className: 'Class 1', subject: 'Math', type: 'mcq', text: '2+2?', answer: 'B', answerText: '', active: true } },
      S2: { q2: { id: 'q2', className: 'Class 2', subject: 'Math', type: 'mcq', text: '3+3?', answer: 'C', answerText: '', active: true } }
    },
    students: { S1: { id: 'S1', name: 'A' }, S2: { id: 'S2', name: 'B' } },
    transactions: { tx1: { id: 'tx1', studentId: 'S1', amount: 500 } },
    studentLedger: { S1: { tx1: { amount: 500 } } },
    exams: {
      e1: { id: 'e1', teacherId: 'T1', status: 'draft' },
      e2: { id: 'e2', teacherId: 'T1', status: 'published' },
      e3: { id: 'e3', teacherId: 'T2', status: 'pending' }
    },
    studentExams: { S1: { e2: { id: 'e2', title: 'Paper' } } },
    attempts: {
      S1: { a1: { id: 'a1', studentId: 'S1', examId: 'e2', status: 'submitted', startedAt: NOW - 1000 } },
      S2: { b1: { id: 'b1', studentId: 'S2', examId: 'e9', status: 'active', startedAt: NOW - 1000 } }
    },
    results: { S1: { e2: { score: 10 } } }
  }
});
const attempt = (overrides = {}) => ({ id: 'a2', studentId: 'S1', examId: 'e2', status: 'active', startedAt: NOW - 10, answers: { q1: 'B' }, number: 1, order: ['q1'], ...overrides });
const exam = (overrides = {}) => ({ id: 'e4', teacherId: 'T1', status: 'draft', participants: ['S1'], ...overrides });
const tokenRecord = (overrides = {}) => ({ token: 'x'.repeat(40), role: 'student', studentId: 'S1', deviceId: 'd1', ...overrides });

const canRead = (who, path) => sim.canRead(who, path, state());
const canWrite = (who, path, value) => sim.canWrite(who, path, value, state());
const only = (allowed, check) => {
  for (const [name, user] of Object.entries({ ...USERS, ...BLOCKED })) {
    assert.equal(check(user), allowed.includes(name), `${name}: expected ${allowed.includes(name) ? 'ALLOW' : 'DENY'}`);
  }
};

// ---- deployment guards ----------------------------------------------------
test('draft stays a draft: firebase.json deploys database.rules.json, not the v2 draft', () => {
  const firebase = JSON.parse(read('../firebase.json'));
  assert.equal(firebase.database.rules, 'database.rules.json');
  assert.notEqual(read('../database.rules.json'), read('../database.rules.v2.draft.json'));
  assert.equal(JSON.parse(read('../database.rules.json')).rules[V2_ROOT], undefined, 'no v2 grants are live');
});

test('committed draft JSON matches its generator', () => {
  assert.equal(read('../database.rules.v2.draft.json'), render(),
    'run: node tools/rtdb-rules/build-v2-draft.mjs');
});

test('question-bank validators bind record ids to each subtree key', () => {
  const bank = draft.rules[V2_ROOT];
  assert.match(bank.questionBank.$recordId['.validate'], /\$recordId/);
  for (const path of [bank.teacherQuestionBank.$teacherId.$questionId, bank.studentQuestionBank.$studentId.$questionId]) {
    assert.match(path['.validate'], /\$questionId/);
    assert.doesNotMatch(path['.validate'], /\$recordId/);
  }
  assert.match(bank.questionBankDraftsByTeacher.$teacherId.$questionId['.validate'], /\$questionId/);
});

test('structure: no bare "auth != null", no true grants, no credential nodes, legacy bridge closed', () => {
  assert.equal(draft.rules['.read'], false);
  assert.equal(draft.rules['.write'], false);
  assert.deepEqual(draft.rules.activePlusSync, { '.read': false, '.write': false });
  const walk = (node, path) => {
    for (const [key, value] of Object.entries(node)) {
      if (key === '.read' || key === '.write') {
        assert.notEqual(value, true, `${path}/${key} is an unconditional grant`);
        if (typeof value === 'string') {
          assert.match(value, /auth\.token\.role === '|auth\.uid === \$uid/, `${path}/${key} is not bound to a role or owner`);
          assert.match(value, /sign_in_provider !== 'anonymous'/, `${path}/${key} does not reject anonymous identities`);
        }
      } else if (value && typeof value === 'object') walk(value, `${path}/${key}`);
    }
  };
  walk(draft.rules, '');
  const v2 = Object.keys(draft.rules[V2_ROOT]);
  for (const credentialNode of ['staffAccounts', 'studentAccounts', 'studentAccount', 'usernames', 'staffDirectory']) {
    assert.ok(!v2.includes(credentialNode), `${credentialNode} must not exist in the v2 tree`);
  }
});

// ---- access matrix --------------------------------------------------------
test('root and the legacy anonymous bridge are closed to everyone, including Admin', () => {
  only([], user => canRead(user, ''));
  only([], user => canRead(user, 'activePlusSync/v1/staffAccounts'));
  only([], user => canWrite(user, 'activePlusSync/v1/staffAccounts/admin', { username: 'evil', pinHash: 'y' }));
  only([], user => canRead(user, V2_ROOT));
});

test('notices: staff see canonical data; Teachers draft privately; students read only server-scoped notices', () => {
  const active = ['admin', 'manager', 'teacher', 'teacher2', 'payment', 'studentA', 'studentB'];
  only(active, user => canRead(user, R('settings')));
  only(['admin', 'manager', 'teacher', 'teacher2', 'payment'], user => canRead(user, R('notices')));
  only(['admin'], user => canWrite(user, R('settings/broadcast'), 'urgent'));
  only(['admin', 'manager'], user => canWrite(user, R('notices/n2'), { id: 'n2', title: 'New', published: true }));
  assert.equal(canWrite(USERS.manager, R('notices/n2'), { id: 'other', title: 'x', published: true }), false, 'record id must match key');
  assert.equal(canWrite(USERS.manager, R('notices/n2'), { id: 'n2', title: 'Draft', published: false }), false, 'canonical notices must be published');
  assert.equal(canWrite(USERS.teacher, R('notices/n2'), { id: 'n2', title: 'Teacher notice', published: true }), false, 'Teacher must use the assignment-checking publish callable');
  assert.equal(canWrite(USERS.manager, R('notices'), { n2: { id: 'n2' } }), false, 'no whole-collection replace');
  only(['admin', 'manager', 'teacher'], user => canWrite(user, R('noticeDraftsByAuthor/u-teacher/d2'), {
    id: 'd2', authorUid: 'u-teacher', classId: 'class1', group: '', status: 'draft', published: false
  }));
  assert.equal(canWrite(USERS.teacher2, R('noticeDraftsByAuthor/u-teacher/d3'), {
    id: 'd3', authorUid: 'u-teacher', classId: 'class1', group: '', status: 'draft', published: false
  }), false, 'another Teacher cannot change the draft');
  assert.equal(canWrite(USERS.teacher, R('noticeDraftsByAuthor/u-teacher/d2'), {
    id: 'd2', authorUid: 'u-teacher', classId: 'class1', group: '', status: 'published'
  }), false, 'Teacher cannot directly publish');
  only(['studentA'], user => canRead(user, R('studentNotices/S1')));
  only(['studentB'], user => canRead(user, R('studentNotices/S2')));
  only([], user => canRead(user, R('studentNotices')));
  only([], user => canWrite(user, R('studentNotices/S1/n2'), { id: 'n2', published: true }));
});

test('routine: all active accounts read; Admin, Manager and Teacher workflows can write', () => {
  const active = ['admin', 'manager', 'teacher', 'teacher2', 'payment', 'studentA', 'studentB'];
  only(active, user => canRead(user, R('routine')));
  only(['admin', 'manager', 'teacher', 'teacher2'], user => canWrite(user, R('routine/r2'), { id: 'r2', title: 'Afternoon' }));
  only([], user => canWrite(user, R('routine'), { r2: { id: 'r2' } }));
});

test('academics: active roles read class and course setup; only Admin writes valid sync records', () => {
  const active = ['admin', 'manager', 'teacher', 'teacher2', 'payment', 'studentA', 'studentB'];
  only(active, user => canRead(user, R('academics')));
  only(['admin'], user => canWrite(user, R('academics/class-class2'), { _syncKind: 'class', record: { id: 'class2', name: 'Class 2' } }));
  assert.equal(canWrite(USERS.admin, R('academics/class-class2'), { _syncKind: 'class', record: { id: 'different', name: 'Class 2' } }), false, 'sync key must match kind and id');
  assert.equal(canWrite(USERS.manager, R('academics/class-class2'), { _syncKind: 'class', record: { id: 'class2' } }), false);
  assert.equal(canWrite(USERS.admin, R('academics/class-class2'), { _syncKind: 'password', record: { id: 'class2' } }), false);
  assert.equal(canWrite(USERS.admin, R('academics/__metadata'), { _syncKind: 'metadata', id: '__metadata', version: 2 }), true);
});

test('teaching: private drafts, server-published activities, student-isolated copies and homework completion', () => {
  only(['admin', 'manager', 'teacher'], user => canRead(user, R('teachingDraftsByTeacher/T1')));
  only(['admin', 'manager', 'teacher'], user => canRead(user, R('teachingByTeacher/T1')));
  only(['admin', 'manager', 'teacher2'], user => canRead(user, R('teachingByTeacher/T2')));
  only(['admin', 'manager', 'teacher'], user => canWrite(user, R('teachingDraftsByTeacher/T1/d3'), { id: 'd3', teacherId: 'T1', type: 'homework', status: 'draft' }));
  assert.equal(canWrite(USERS.teacher, R('teachingDraftsByTeacher/T2/d3'), { id: 'd3', teacherId: 'T2', type: 'homework', status: 'draft' }), false, 'Teacher cannot write another Teacher subtree');
  assert.equal(canWrite(USERS.teacher, R('teachingDraftsByTeacher/T1/d3'), { id: 'd3', teacherId: 'T1', type: 'homework', status: 'published' }), false, 'Teacher cannot directly publish');
  assert.equal(canWrite(USERS.teacher, R('teachingDraftsByTeacher/T1/d3'), { id: 'd3', teacherId: 'T1', type: 'homework', status: 'draft', progress: { S1: 'done' } }), false, 'shared student progress is forbidden');
  assert.equal(canWrite(USERS.teacher, R('teachingByTeacher/T1/hw3'), { id: 'hw3', teacherId: 'T1', type: 'homework', status: 'published' }), false, 'Teacher must publish through the assignment-checking callable');
  only(['admin'], user => canWrite(user, R('teachingByTeacher/T1/hw3'), { id: 'hw3', teacherId: 'T1', type: 'homework', status: 'published' }));
  only(['studentA'], user => canRead(user, R('studentTeaching/S1')));
  only(['studentB'], user => canRead(user, R('studentTeaching/S2')));
  only([], user => canWrite(user, R('studentTeaching/S1/hw2'), { id: 'hw2', status: 'published' }));
  only(['studentA'], user => canRead(user, R('studentTeachingProgress/S1')));
  only(['studentA'], user => canWrite(user, R('studentTeachingProgress/S1/hw1'), { studentId: 'S1', activityId: 'hw1', value: 'done', updatedAt: NOW - 1 }));
  assert.equal(canWrite(USERS.studentA, R('studentTeachingProgress/S1/hw1'), { studentId: 'S1', activityId: 'hw1', value: 'reviewed', updatedAt: NOW }), false, 'student cannot self-review');
  assert.equal(canWrite(USERS.studentA, R('studentTeachingProgress/S2/hw2'), { studentId: 'S2', activityId: 'hw2', value: 'done', updatedAt: NOW }), false, 'student cannot report on another child');
  assert.equal(canWrite(USERS.studentA, R('studentTeachingProgress/S1/hw1'), { studentId: 'S1', activityId: 'hw1', value: 'done', updatedAt: NOW + 1 }), false, 'no future timestamps');
  assert.equal(canWrite(USERS.studentA, R('studentTeachingProgress/S1/hw1'), { studentId: 'S1', activityId: 'hw1', value: 'done', updatedAt: NOW, score: 100 }), false, 'progress record has a closed schema');
  only(['admin', 'manager', 'teacher'], user => canRead(user, R('teachingProgressByTeacher/T1')));
  only(['admin', 'manager', 'teacher2'], user => canRead(user, R('teachingProgressByTeacher/T2')));
  only([], user => canRead(user, R('teachingProgressByTeacher')));
  only([], user => canWrite(user, R('teachingProgressByTeacher/T1/S1/hw1'), { teacherId: 'T1', studentId: 'S1', activityId: 'hw1', value: 'reviewed', updatedAt: NOW }));
});

test('course content: author-only drafts, server-published canonical records and student-only fan-out', () => {
  only(['admin', 'manager', 'teacher'], user => canRead(user, R('courseContentDraftsByAuthor/u-teacher')));
  only(['admin', 'manager', 'teacher'], user => canRead(user, R('courseContentByAuthor/u-teacher')));
  only(['admin', 'manager', 'teacher2'], user => canRead(user, R('courseContentByAuthor/u-teacher2')));
  const draft = { id: 'c3', authorUid: 'u-teacher', classId: 'class1', subjectId: 'subject1', published: false, active: true, body: 'Draft' };
  only(['admin', 'manager', 'teacher'], user => canWrite(user, R('courseContentDraftsByAuthor/u-teacher/c3'), draft));
  assert.equal(canRead(USERS.teacher2, R('courseContentDraftsByAuthor/u-teacher')), false, 'other Teacher draft is private');
  assert.equal(canWrite(USERS.teacher, R('courseContentDraftsByAuthor/u-teacher/c3'), { ...draft, published: true }), false, 'Teacher cannot publish a draft directly');
  assert.equal(canWrite(USERS.teacher, R('courseContentDraftsByAuthor/u-teacher2/c3'), { ...draft, authorUid: 'u-teacher2' }), false, 'cannot write another author subtree');
  assert.equal(canWrite(USERS.teacher, R('courseContentByAuthor/u-teacher/c3'), { ...draft, published: true }), false, 'Teacher publication requires the assignment-checking callable');
  only(['admin', 'manager'], user => canWrite(user, R('courseContentByAuthor/u-teacher/c3'), { ...draft, published: true }));
  only(['studentA'], user => canRead(user, R('studentCourseContent/S1')));
  only(['studentB'], user => canRead(user, R('studentCourseContent/S2')));
  only([], user => canRead(user, R('studentCourseContent')));
  only([], user => canWrite(user, R('studentCourseContent/S1/c3'), { id: 'c3', published: true, active: true }));
});

test('question bank: answer keys stay staff-side and students receive only per-student server copies', () => {
  const bankRow = { id: 'q3', className: 'Class 1', subject: 'Math', type: 'mcq', text: '3+3?', answer: 'C', answerText: '', active: true };
  only(['admin', 'manager'], user => canRead(user, R('questionBank')));
  only(['admin', 'manager'], user => canWrite(user, R('questionBank/q3'), bankRow));
  assert.equal(canWrite(USERS.admin, R('questionBank/q3'), { ...bankRow, id: 'wrong' }), false, 'canonical question id must match path');
  assert.equal(canWrite(USERS.teacher, R('questionBank/q3'), bankRow), false, 'Teacher publishes through the assignment-checking callable');
  assert.equal(canRead(USERS.teacher, R('questionBank')), false, 'Teacher never downloads the all-class canonical bank');
  assert.equal(canRead(USERS.studentA, R('questionBank')), false, 'student never downloads canonical answer keys');
  assert.equal(canRead(USERS.payment, R('questionBank')), false, 'payment role does not need exam content');

  const draft = { id: 'qDraft3', teacherId: 'T1', status: 'draft', question: { id: 'qDraft3', className: 'Class 1', subject: 'Math', text: 'Draft?' } };
  only(['admin', 'manager', 'teacher'], user => canWrite(user, R('questionBankDraftsByTeacher/T1/qDraft3'), draft));
  only(['admin', 'manager', 'teacher'], user => canRead(user, R('questionBankDraftsByTeacher/T1')));
  assert.equal(canRead(USERS.teacher2, R('questionBankDraftsByTeacher/T1')), false, 'another Teacher cannot inspect this draft');
  assert.equal(canWrite(USERS.teacher2, R('questionBankDraftsByTeacher/T1/qDraft3'), draft), false, 'another Teacher cannot write this draft');
  assert.equal(canWrite(USERS.teacher, R('questionBankDraftsByTeacher/T1/qDraft3'), { ...draft, status: 'published' }), false, 'Teacher cannot directly promote a draft');
  assert.equal(canWrite(USERS.teacher, R('questionBankDraftsByTeacher/T1/qDraft3'), { ...draft, question: { ...draft.question, id: 'other' } }), false, 'draft question id must match its path');

  only(['admin', 'manager', 'teacher'], user => canRead(user, R('teacherQuestionBank/T1')));
  only(['admin', 'manager', 'teacher2'], user => canRead(user, R('teacherQuestionBank/T2')));
  only([], user => canWrite(user, R('teacherQuestionBank/T1/q3'), bankRow));
  only(['studentA'], user => canRead(user, R('studentQuestionBank/S1')));
  only(['studentB'], user => canRead(user, R('studentQuestionBank/S2')));
  only([], user => canRead(user, R('studentQuestionBank')));
  only([], user => canWrite(user, R('studentQuestionBank/S1/q3'), bankRow));
  assert.equal(state()[V2_ROOT].studentQuestionBank.S1.q1.answer, 'B', 'a student may receive the answer only in their own scoped practice copy');
});

test('roster: staff read all; a student reads only their own record; Admin/Manager write', () => {
  only(['admin', 'manager', 'teacher', 'teacher2', 'payment'], user => canRead(user, R('students')));
  only(['admin', 'manager', 'teacher', 'teacher2', 'payment', 'studentA'], user => canRead(user, R('students/S1')));
  only(['admin', 'manager', 'teacher', 'teacher2', 'payment', 'studentB'], user => canRead(user, R('students/S2')));
  only(['admin', 'manager'], user => canWrite(user, R('students/S3'), { id: 'S3', name: 'C' }));
  assert.equal(canWrite(USERS.studentA, R('students/S1/name'), 'Changed'), false);
});

test('transactions: Payment creates only; Admin corrects/deletes; students read their ledger', () => {
  only(['admin', 'payment'], user => canRead(user, R('transactions')));
  only(['admin', 'payment'], user => canWrite(user, R('transactions/tx2'), { id: 'tx2', studentId: 'S1', amount: 100 }));
  only(['admin'], user => canWrite(user, R('transactions/tx1'), { id: 'tx1', studentId: 'S1', amount: 1 }));
  only(['admin'], user => canWrite(user, R('transactions/tx1'), null));
  assert.equal(canWrite(USERS.payment, R('transactions/tx2'), { id: 'tx2', amount: 100 }), false, 'studentId required');
  only(['admin', 'payment', 'studentA'], user => canRead(user, R('studentLedger/S1')));
  only(['admin', 'payment'], user => canRead(user, R('studentLedger')));
  only([], user => canWrite(user, R('studentLedger/S1/tx9'), { amount: 1 }));
});

test('exams: teachers edit their own unpublished papers; nobody publishes from a client; students never see answer keys', () => {
  only(['admin', 'manager', 'teacher', 'teacher2'], user => canRead(user, R('exams')));
  only(['admin', 'teacher'], user => canWrite(user, R('exams/e4'), exam()));
  only(['admin', 'teacher'], user => canWrite(user, R('exams/e1'), exam({ id: 'e1', status: 'pending' })));
  only([], user => canWrite(user, R('exams/e1'), exam({ id: 'e1', status: 'published' })));
  only([], user => canWrite(user, R('exams/e2'), exam({ id: 'e2', status: 'draft' })));
  only(['admin', 'teacher2'], user => canWrite(user, R('exams/e3'), exam({ id: 'e3', teacherId: 'T2', status: 'draft' })));
  assert.equal(canWrite(USERS.teacher, R('exams/e5'), exam({ id: 'e5', teacherId: 'T2' })), false, 'cannot create for another teacher');
  assert.equal(canWrite(USERS.teacher2, R('exams/e1'), exam({ id: 'e1', teacherId: 'T2' })), false, 'cannot take over a paper');
  only(['admin'], user => canWrite(user, R('exams/e2'), null));
  only(['admin', 'manager', 'teacher', 'teacher2', 'studentA'], user => canRead(user, R('studentExams/S1')));
  only([], user => canWrite(user, R('studentExams/S1/e9'), { id: 'e9' }));
});

test('attempts: a student writes only their own, only for a paper they were given, never after submission', () => {
  only(['studentA'], user => canWrite(user, R('attempts/S1/a2'), attempt()));
  assert.equal(canWrite(USERS.studentA, R('attempts/S1/a2'), attempt({ examId: 'e1' })), false, 'paper not in inbox');
  assert.equal(canWrite(USERS.studentA, R('attempts/S2/a2'), attempt({ studentId: 'S2' })), false, 'other student subtree');
  assert.equal(canWrite(USERS.studentA, R('attempts/S1/a2'), attempt({ studentId: 'S2' })), false, 'studentId must match path');
  assert.equal(canWrite(USERS.studentA, R('attempts/S1/a1'), attempt({ id: 'a1', status: 'active' })), false, 'submitted is final');
  assert.equal(canWrite(USERS.studentA, R('attempts/S1/a2'), attempt({ startedAt: NOW + 60_000 })), false, 'no future start time');
  assert.equal(canWrite(USERS.studentA, R('attempts/S1/a2'), null), false, 'students cannot delete attempts');
  only(['admin'], user => canWrite(user, R('attempts/S1/a1'), null));
  only(['admin', 'manager', 'teacher', 'teacher2'], user => canRead(user, R('attempts')));
  only(['admin', 'manager', 'teacher', 'teacher2', 'studentA'], user => canRead(user, R('attempts/S1')));
  only(['admin', 'manager', 'teacher', 'teacher2', 'studentA'], user => canRead(user, R('results/S1')));
  only([], user => canWrite(user, R('results/S1/e2'), { score: 100 }));
});

test('push tokens: owner-only writes bound to the real role/studentId; no client reads', () => {
  only(['studentA'], user => canWrite(user, R('pushTokens/u-sa/d1'), tokenRecord()));
  assert.equal(canWrite(USERS.studentB, R('pushTokens/u-sa/d1'), tokenRecord()), false, 'other uid');
  assert.equal(canWrite(USERS.studentA, R('pushTokens/u-sa/d1'), tokenRecord({ studentId: 'S2' })), false, 'foreign studentId');
  assert.equal(canWrite(USERS.studentA, R('pushTokens/u-sa/d1'), tokenRecord({ role: 'admin' })), false, 'role spoof');
  assert.equal(canWrite(USERS.admin, R('pushTokens/u-admin/d1'), tokenRecord({ role: 'admin', studentId: '' })), true);
  assert.equal(canWrite(USERS.admin, R('pushTokens/u-admin/d1'), tokenRecord({ role: 'admin', studentId: 'S1' })), false, 'staff cannot claim a student');
  assert.equal(canWrite(USERS.studentA, R('pushTokens/u-sa/d1'), null), true, 'owner may unregister');
  only([], user => canRead(user, R('pushTokens')));
  only([], user => canRead(user, R('pushTokens/u-sa')));
});

test('blocked identities get nothing anywhere in the v2 tree', () => {
  const paths = ['settings', 'notices', 'noticeDraftsByAuthor/u-teacher', 'studentNotices/S9', 'routine', 'academics', 'teacherAssignments',
    'teachingDraftsByTeacher/T1', 'teachingByTeacher/T1', 'studentTeaching/S9', 'studentTeachingProgress/S9',
    'teachingProgressByTeacher/T1', 'courseContentDraftsByAuthor/u-teacher', 'courseContentByAuthor/u-teacher',
    'studentCourseContent/S9', 'questionBank', 'questionBankDraftsByTeacher/T1', 'teacherQuestionBank/T1', 'studentQuestionBank/S9',
    'students', 'students/S9', 'transactions', 'studentLedger/S9', 'exams',
    'studentExams/S9', 'attempts', 'attempts/S9', 'results/S9'];
  for (const [name, user] of Object.entries(BLOCKED)) {
    for (const path of paths) assert.equal(canRead(user, R(path)), false, `${name} read ${path}`);
    assert.equal(canWrite(user, R('notices/n9'), { id: 'n9' }), false, `${name} write notice`);
    assert.equal(canWrite(user, R('questionBank/q9'), { id: 'q9', className: 'C', subject: 'S', type: 'mcq', text: 'Q', answer: 'A', answerText: '', active: true }), false, `${name} write question bank`);
    assert.equal(canWrite(user, R('attempts/S9/z'), attempt({ id: 'z', studentId: 'S9' })), false, `${name} write attempt`);
  }
});
