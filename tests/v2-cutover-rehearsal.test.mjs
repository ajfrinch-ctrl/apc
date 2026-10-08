/* Local rehearsal of the owner-gated staged cutover.

   This chains the SAME helpers the Admin callables use — teacher retro-link
   (functions/teacher-assignment-migration.js) and roster migration
   (functions/v2-roster-migration.js) — against a realistic legacy fixture,
   then proves against database.rules.v2.draft.json (via the local simulator)
   that everything migration writes satisfies the per-user rules, and that the
   question-bank projections select scopes from the MIGRATED records.

   It is not the Firebase engine: functions/test/rtdb-rules.test.js remains
   the authoritative gate before deployment. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { V2_ROOT } from '../tools/rtdb-rules/build-v2-draft.mjs';
import { createSimulator } from './rtdb-rules-sim.mjs';

const require = createRequire(import.meta.url);
const {
  buildTeacherAssignmentMigration, migrationForTeacher, linkedTeacherClaims, v2IdentityClaims
} = require('../functions/teacher-assignment-migration.js');
const { mobileProposals, v2StudentRecord } = require('../functions/v2-roster-migration.js');
const {
  buildTeacherQuestionProjection, buildStudentQuestionProjection
} = require('../functions/question-bank-projection.js');

const draft = JSON.parse(readFileSync(new URL('../database.rules.v2.draft.json', import.meta.url), 'utf8'));
const NOW = Date.UTC(2026, 9, 8, 6, 0, 0);
const sim = createSimulator(draft, { now: NOW });
const R = path => `${V2_ROOT}/${path}`;

// ---- legacy fixture (what the callable reads, never writes) ----------------
const legacyAssignments = Object.freeze({
  'asg-math': { id: 'asg-math', teacherUsername: 'rafiq', teacherName: 'রফিক উদ্দিন', className: 'Class 6', group: '', subjects: ['Math'], subject: 'Math' },
  'asg-eng': { id: 'asg-eng', teacherUsername: 'salma', teacherName: 'সালমা আক্তার', className: 'Class 6', group: '', subjects: ['English'] },
  'asg-ghost': { id: 'asg-ghost', teacherUsername: 'ghost', teacherName: 'কেউ নেই', className: 'Class 6', subjects: ['Math'] }
});
// Server-controlled identities, as the callable builds them from
// usernameIndex/users + Firebase Auth: the username is never trusted alone.
const identities = {
  rafiq: { uid: 'u-rafiq', username: 'rafiq', role: 'teacher', status: 'active', disabled: false },
  salma: { uid: 'u-salma', username: 'salma', role: 'teacher', status: 'active', disabled: false }
};
const legacyStudents = Object.freeze({
  'STU-1': { id: 'STU-1', name: 'রহিম', mobile: '০১৭১২-৩৪৫৬৭৮', className: 'Class 6', group: '', monthlyFee: 500 },
  'STU-2': { id: 'STU-2', name: 'করিম', mobile: '01811111111', className: 'Class 7', group: '' },
  'STU-3': { id: 'STU-3', name: 'সাদাত', guardianMobile: '01912345678', className: 'Class 6', group: '' }
});
const accounts = [
  { uid: 'u-rahim', username: 'rahim', fullName: 'রহিম', mobile: '01712345678', status: 'approved', role: 'student' },
  { uid: 'u-karim', username: 'karim', fullName: 'করিম', mobile: '+8801811111111', status: 'pending', role: 'student' },
  { uid: 'u-sadat', username: 'sadat', fullName: 'সাদাত', mobile: '01912345678', status: 'approved', role: 'student' },
  // A non-student decoy sharing a roster mobile must never become a proposal
  // (the callable filters to role === 'student' before proposing).
  { uid: 'u-manager-x', username: 'mgrx', fullName: 'ম্যানেজার', mobile: '01811111111', status: 'active', role: 'manager' }
];

// ---- canonical question bank rows (V2 questionBank shape) ------------------
const mcq = (id, className, subject, text, extra = {}) => ({
  id, className, subject, group: '', type: 'mcq', text,
  options: [
    { id: 'A', text: '৩' }, { id: 'B', text: '৪' }, { id: 'C', text: '৫' }, { id: 'D', text: '৬' }
  ],
  answer: 'B', answerText: '', active: true, ...extra
});
const questionBankRows = {
  'q-math-1': mcq('q-math-1', 'Class 6', 'Math', '২ + ২ = কত?'),
  'q-eng-1': mcq('q-eng-1', 'Class 6', 'English', 'Pick the correct spelling.'),
  'q-math-7': mcq('q-math-7', 'Class 7', 'Math', '৭ × ৮ = কত?'),
  'q-math-off': mcq('q-math-off', 'Class 6', 'Math', 'বাতিল প্রশ্ন', { active: false })
};

// ---- identities after provisioning (claims exactly as callable sets them) --
const staff = (uid, role) => ({ uid, token: { role, status: 'active', mustChangePassword: false } });
const ADMIN = staff('u-admin', 'admin');
const MANAGER = staff('u-manager', 'manager');
const rafiqClaims = linkedTeacherClaims({ uid: 'u-rafiq', profile: { role: 'teacher', status: 'active' } });
const salmaClaims = linkedTeacherClaims({ uid: 'u-salma', profile: { role: 'teacher', status: 'active' } });
const RAFIQ = { uid: 'u-rafiq', token: rafiqClaims };
const SALMA = { uid: 'u-salma', token: salmaClaims };
const unlinkedTeacher = staff('u-newteacher', 'teacher'); // role claim only
const studentToken = (uid, status) => ({ uid, token: { role: 'student', status, studentId: uid } });
const RAHIM = studentToken('u-rahim', 'approved');
const KARIM = studentToken('u-karim', 'pending');
const studentNoLink = { uid: 'u-lost', token: { role: 'student', status: 'approved' } };

const V2 = Object.freeze({
  questionBank: questionBankRows,
  teacherQuestionBank: {
    'u-rafiq': { 'q-math-1': questionBankRows['q-math-1'] },
    'u-salma': { 'q-eng-1': questionBankRows['q-eng-1'] }
  },
  studentQuestionBank: {
    'u-rahim': { 'q-math-1': questionBankRows['q-math-1'] },
    'u-karim': { 'q-math-7': questionBankRows['q-math-7'] },
    'u-sadat': { 'q-math-1': questionBankRows['q-math-1'] }
  },
  students: {}
});
const stateWith = extra => ({ activePlusSync: { v1: { teacherAssignments: legacyAssignments, students: legacyStudents } }, [V2_ROOT]: { ...V2, ...extra } });

test('retro-link dry-run lists exactly the unresolved rows and never touches legacy', () => {
  const legacyBefore = JSON.stringify(legacyAssignments);
  const { assignments, unresolved } = buildTeacherAssignmentMigration(legacyAssignments, identities);
  assert.deepEqual(assignments.map(row => row.id).sort(), ['asg-eng', 'asg-math']);
  for (const row of assignments) {
    assert.equal(row.teacherId, row.teacherUid, 'the migrated row is claim-addressed');
    assert.equal(row.teacherId, identities[row.teacherUsername].uid);
  }
  assert.deepEqual(unresolved, [{ id: 'asg-ghost', teacherUsername: 'ghost', reason: 'teacher-identity-not-found' }]);
  assert.equal(JSON.stringify(legacyAssignments), legacyBefore, 'dry-run is read-only');
});

test('a linked retro row passes the teacherAssignments rules; a mismatched key does not', () => {
  const { assignments } = migrationForTeacher(legacyAssignments, 'rafiq', identities.rafiq);
  assert.equal(assignments.length, 1);
  const [row] = assignments;
  const state = stateWith({ teacherAssignments: {} });
  assert.equal(sim.canWrite(ADMIN, R(`teacherAssignments/${row.id}`), row, state), true, 'Admin applies the link');
  assert.equal(sim.canWrite(MANAGER, R(`teacherAssignments/${row.id}`), row, state), true, 'Manager may too');
  assert.equal(sim.canWrite(RAFIQ, R(`teacherAssignments/${row.id}`), row, state), false, 'teachers never write the link');
  // .validate binds the record id to its key — a stale or swapped id fails.
  assert.equal(sim.canWrite(ADMIN, R('teacherAssignments/asg-other'), row, state), false);
});

test('migrated claims unlock only that teacher\'s question bank paths', () => {
  const state = stateWith({});
  assert.equal(sim.canRead(RAFIQ, R('teacherAssignments'), state), true);
  assert.equal(sim.canRead(RAFIQ, R('teacherQuestionBank/u-rafiq'), state), true);
  assert.equal(sim.canRead(RAFIQ, R('teacherQuestionBank/u-salma'), state), false, 'no cross-teacher read');
  assert.equal(sim.canRead(SALMA, R('teacherQuestionBank/u-salma'), state), true);
  assert.equal(sim.canRead(SALMA, R('teacherQuestionBank/u-rafiq'), state), false);
  assert.equal(sim.canRead(MANAGER, R('teacherQuestionBank/u-rafiq'), state), true);
  assert.equal(sim.canRead(unlinkedTeacher, R('teacherQuestionBank/u-newteacher'), state), false, 'role without a link stays locked out');
  assert.equal(sim.canRead(RAHIM, R('teacherQuestionBank/u-rafiq'), state), false, 'students never read teacher banks');
});

test('migrated assignments drive the projection scope end to end', () => {
  const rafiqRows = migrationForTeacher(legacyAssignments, 'rafiq', identities.rafiq).assignments;
  const salmaRows = migrationForTeacher(legacyAssignments, 'salma', identities.salma).assignments;
  const rafiqBank = buildTeacherQuestionProjection(questionBankRows, 'u-rafiq', rafiqRows);
  const salmaBank = buildTeacherQuestionProjection(questionBankRows, 'u-salma', salmaRows);
  // A teacher's bank is class+subject scoped and keeps inactive questions
  // (the teacher re-activates or retires them); the STUDENT lane below is the
  // one that gates on `active`.
  assert.deepEqual(Object.keys(rafiqBank), ['q-math-1', 'q-math-off'], 'Math assignment sees the Math questions, inactive included');
  assert.deepEqual(Object.keys(salmaBank), ['q-eng-1'], 'English assignment sees only the English question');
  // Every projected copy must satisfy the questionId validate contract
  // (id bound to key; class/subject/type/text/answer fields present).
  for (const [bank] of [[rafiqBank], [salmaBank]]) {
    for (const [key, row] of Object.entries(bank)) {
      assert.equal(row.id, key);
      for (const field of ['className', 'subject', 'type', 'text', 'answer', 'answerText']) {
        assert.equal(typeof row[field], 'string', `${key}.${field}`);
      }
    }
  }
});

test('roster rehearsal: proposals only, explicit confirm, rules accept the re-keyed row', () => {
  const proposals = mobileProposals(legacyStudents, accounts.filter(account => account.role === 'student'));
  const byId = Object.fromEntries(proposals.map(proposal => [proposal.studentId, proposal]));
  assert.deepEqual(byId['STU-1'].candidates.map(candidate => candidate.uid), ['u-rahim'], 'Bengali-digit mobile normalizes to the match');
  assert.deepEqual(byId['STU-2'].candidates.map(candidate => candidate.uid), ['u-karim'], 'the +880 prefix folds to the match');
  assert.deepEqual(byId['STU-3'].candidates.map(candidate => candidate.uid), ['u-sadat'], 'the guardian mobile matches too');
  for (const proposal of proposals) {
    assert.ok(!proposal.candidates.some(candidate => candidate.uid === 'u-manager-x'), 'the non-student decoy never surfaces');
  }

  // The Admin picks exactly one candidate; the record re-keys under the uid
  // and keeps the legacy id as provenance.
  const rahimRow = v2StudentRecord(legacyStudents['STU-1'], { uid: 'u-rahim', accountStatus: 'approved', now: NOW });
  assert.equal(rahimRow.id, 'u-rahim');
  assert.equal(rahimRow.legacyStudentId, 'STU-1');
  assert.equal(rahimRow.status, 'approved');
  assert.equal(rahimRow.migratedFromLegacy, true);

  const state = stateWith({});
  assert.equal(sim.canWrite(ADMIN, R('students/u-rahim'), rahimRow, state), true);
  assert.equal(sim.canWrite(MANAGER, R('students/u-rahim'), rahimRow, state), true);
  assert.equal(sim.canWrite(RAFIQ, R('students/u-rahim'), rahimRow, state), false, 'teachers never re-key the roster');
  assert.equal(sim.canWrite(ADMIN, R('students/u-other'), rahimRow, state), false, '.validate binds id to the key');
  assert.equal(sim.canRead(RAHIM, R('students/u-rahim'), state), true, 'the student reads their own roster row');
  assert.equal(sim.canRead(studentToken('u-karim', 'approved'), R('students/u-rahim'), state), false);
  assert.equal(sim.canRead(studentNoLink, R('students/u-rahim'), state), false, 'an approved student without the link reads nothing');
});

test('migrated students see exactly their own practice lane, gated on status', () => {
  const state = stateWith({});
  assert.equal(sim.canRead(RAHIM, R('studentQuestionBank/u-rahim'), state), true);
  assert.equal(sim.canRead(RAHIM, R('studentQuestionBank/u-karim'), state), false, 'no cross-student read');
  assert.equal(sim.canRead(KARIM, R('studentQuestionBank/u-karim'), state), false, 'a pending account stays out of the practice lane');
  assert.equal(sim.canRead(studentNoLink, R('studentQuestionBank/u-lost'), state), false);
  assert.equal(sim.canRead(RAFIQ, R('studentQuestionBank/u-rahim'), state), false, 'teachers never read student banks');

  // The roster row built by migration is the very input the projection gates
  // on: the lane is class-scoped over ACTIVE questions, and the row must be
  // approved — subject is not a gate for students.
  const rahimRow = v2StudentRecord(legacyStudents['STU-1'], { uid: 'u-rahim', accountStatus: 'approved', now: NOW });
  const karimRow = v2StudentRecord(legacyStudents['STU-2'], { uid: 'u-karim', accountStatus: 'pending', now: NOW });
  const sadatRow = v2StudentRecord(legacyStudents['STU-3'], { uid: 'u-sadat', accountStatus: 'approved', now: NOW });
  assert.deepEqual(Object.keys(buildStudentQuestionProjection(questionBankRows, rahimRow, NOW)), ['q-math-1', 'q-eng-1'], 'approved Class 6 sees every active Class 6 question, never the inactive one');
  assert.deepEqual(Object.keys(buildStudentQuestionProjection(questionBankRows, karimRow, NOW)), [], 'pending migrates but projects nothing');
  assert.deepEqual(Object.keys(buildStudentQuestionProjection(questionBankRows, sadatRow, NOW)), ['q-math-1', 'q-eng-1'], 'guardian-matched student lands in the right class lane');
});

test('the migration writes are deterministic for a fixed clock (safe to re-run)', () => {
  const first = v2StudentRecord(legacyStudents['STU-1'], { uid: 'u-rahim', accountStatus: 'approved', now: NOW });
  const second = v2StudentRecord(legacyStudents['STU-1'], { uid: 'u-rahim', accountStatus: 'approved', now: NOW });
  assert.deepEqual(second, first, 're-applying with the same inputs yields the same row');
  const claims = { ...linkedTeacherClaims({ uid: 'u-rafiq', profile: { role: 'teacher', status: 'active' } }), ...v2IdentityClaims('teacher', 'u-rafiq') };
  assert.equal(claims.teacherId, 'u-rafiq', 'retro-link and lifecycle provisioning agree on the claim shape');
});
