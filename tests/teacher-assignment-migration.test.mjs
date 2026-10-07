/* Tests for the legacy username-addressed teacherAssignments → V2
   claim-addressed migration helper (functions/teacher-assignment-migration.js).
   See docs/RTDB-PER-USER-RULES-PLAN.md: legacy rows identify teachers by
   `teacherUsername` only; V2 authorization uses the secure `teacherUid` /
   `teacherId` custom claims, so migration must link them, never trust the
   username alone. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  buildTeacherAssignmentMigration,
  linkedTeacherClaims,
  normalizeUsername,
  entriesOfLegacyAssignments,
  migrationForTeacher,
  v2IdentityClaims
} = require('../functions/teacher-assignment-migration.js');

const TEACHERS = {
  rafiq: { uid: 'uid-rafiq', username: 'rafiq', role: 'teacher', status: 'active', disabled: false },
  salma: { uid: 'uid-salma', username: 'salma', role: 'teacher', status: 'active', disabled: false }
};

const row = (overrides = {}) => ({
  id: 'TAS-1', teacherUsername: 'rafiq', teacherName: 'রফিক স্যার',
  className: 'দশম শ্রেণি', group: 'বিজ্ঞান', subjects: ['গণিত'], subject: 'গণিত',
  ...overrides
});

test('legacy username rows are re-keyed to the secure teacherUid/teacherId claim', () => {
  const { assignments, unresolved } = buildTeacherAssignmentMigration(
    { 'TAS-1': row() }, TEACHERS);
  assert.equal(unresolved.length, 0);
  assert.equal(assignments.length, 1);
  assert.deepEqual(assignments[0], {
    id: 'TAS-1',
    teacherId: 'uid-rafiq',
    teacherUid: 'uid-rafiq',
    teacherUsername: 'rafiq',
    teacherName: 'রফিক স্যার',
    className: 'দশম শ্রেণি',
    group: 'বিজ্ঞান',
    subjects: ['গণিত'],
    subject: 'গণিত'
  });
});

test('accepts the older array shape with a single subject string', () => {
  const legacy = [
    { id: 'TAS-9', teacherUsername: 'SALMA ', className: 'নবম শ্রেণি', group: '', subject: 'রসায়ন, পদার্থবিজ্ঞান' },
    { teacherUsername: 'rafiq', className: 'অষ্টম শ্রেণি', group: 'সাধারণ', subjects: ['ইংরেজি'] }
  ];
  const { assignments, unresolved } = buildTeacherAssignmentMigration(legacy, TEACHERS);
  assert.equal(unresolved.length, 0);
  assert.equal(assignments.length, 2);
  assert.equal(assignments[0].teacherId, 'uid-salma');
  assert.deepEqual(assignments[0].subjects, ['রসায়ন', 'পদার্থবিজ্ঞান']);
  assert.equal(assignments[1].id.length > 0, true);
  assert.equal(assignments[1].teacherId, 'uid-rafiq');
});

test('rows whose username has no verified identity are reported unresolved, never migrated', () => {
  const { assignments, unresolved } = buildTeacherAssignmentMigration(
    { bad: row({ id: 'TAS-X', teacherUsername: 'ghost' }) }, TEACHERS);
  assert.deepEqual(assignments, []);
  assert.equal(unresolved.length, 1);
  assert.equal(unresolved[0].teacherUsername, 'ghost');
  assert.equal(unresolved[0].reason, 'teacher-identity-not-found');
});

test('a forged teacherUsername pointing at another identity is rejected (username-mismatch)', () => {
  const identity = { ...TEACHERS.salma, username: 'salma' };
  const { assignments, unresolved } = buildTeacherAssignmentMigration(
    { x: row({ teacherUsername: 'Rafiq', id: 'TAS-F' }) },
    { rafiq: identity }); // identity claims username "salma" for the "rafiq" row
  assert.deepEqual(assignments, []);
  assert.equal(unresolved[0].reason, 'username-mismatch');
});

test('suspended, disabled, or non-teacher identities are never linked', () => {
  const cases = [
    [{ ...TEACHERS.rafiq, status: 'suspended' }, 'teacher-not-active'],
    [{ ...TEACHERS.rafiq, disabled: true }, 'teacher-auth-disabled'],
    [{ ...TEACHERS.rafiq, role: 'manager' }, 'identity-not-teacher']
  ];
  for (const [identity, expected] of cases) {
    const { assignments, unresolved } = buildTeacherAssignmentMigration(
      { x: row() }, { rafiq: identity });
    assert.deepEqual(assignments, [], expected);
    assert.equal(unresolved[0].reason, expected);
  }
});

test('unsafe or duplicate assignment ids are rejected', () => {
  const evil = row({ id: '../../questionBank' });
  const dupA = row({ id: 'TAS-1' });
  const dupB = row({ id: 'TAS-1', className: 'নবম শ্রেণি' });
  const { assignments, unresolved } = buildTeacherAssignmentMigration(
    { a: evil, b: dupA, c: dupB }, TEACHERS);
  assert.equal(assignments.length, 1);
  assert.equal(assignments[0].id, 'TAS-1');
  const reasons = unresolved.map(item => item.reason);
  assert.ok(reasons.includes('unsafe-assignment-id'));
  assert.ok(reasons.includes('duplicate-assignment-id'));
});

test('rows missing class or subjects stay unresolved; nothing else is lost', () => {
  const { assignments, unresolved } = buildTeacherAssignmentMigration({
    noClass: row({ id: 'TAS-A', className: '' }),
    noSubjects: row({ id: 'TAS-B', subjects: [], subject: '' }),
    fine: row({ id: 'TAS-C' })
  }, TEACHERS);
  assert.equal(assignments.length, 1);
  assert.equal(assignments[0].id, 'TAS-C');
  assert.deepEqual(unresolved.map(item => item.id).sort(), ['TAS-A', 'TAS-B']);
});

test('a failed row does not poison its id for a later valid row', () => {
  const { assignments, unresolved } = buildTeacherAssignmentMigration({
    broken: row({ id: 'TAS-1', teacherUsername: 'ghost' }),
    fixed: row({ id: 'TAS-1' })
  }, TEACHERS);
  assert.equal(unresolved.length, 1);
  assert.equal(assignments.length, 1);
  assert.equal(assignments[0].teacherId, 'uid-rafiq');
});

test('identity map accepts a Map as well as a plain object', () => {
  const map = new Map(Object.entries(TEACHERS));
  const { assignments } = buildTeacherAssignmentMigration({ x: row() }, map);
  assert.equal(assignments[0].teacherId, 'uid-rafiq');
});

test('linkedTeacherClaims always carries role/status/teacherId and never trusts stale claims', () => {
  const claims = linkedTeacherClaims({
    uid: 'uid-rafiq',
    profile: { role: 'teacher', status: 'active', mustChangePassword: true },
    authClaims: { role: 'student', status: 'pending', teacherId: 'hijack', name: 'রফিক' }
  });
  assert.deepEqual(claims, {
    role: 'teacher', status: 'active', mustChangePassword: true,
    teacherId: 'uid-rafiq', name: 'রফিক'
  });
  assert.throws(() => linkedTeacherClaims({ uid: 'uid-rafiq', profile: { role: 'teacher', status: 'suspended' } }));
  assert.throws(() => linkedTeacherClaims({ uid: '../evil', profile: { role: 'teacher', status: 'active' } }));
  assert.throws(() => linkedTeacherClaims({ uid: 'uid-rafiq', profile: null }));
});

test('normalizeUsername and entriesOfLegacyAssignments fail closed on garbage', () => {
  assert.equal(normalizeUsername('  Rafiq '), 'rafiq');
  assert.deepEqual(entriesOfLegacyAssignments(null), []);
  assert.deepEqual(entriesOfLegacyAssignments('oops'), []);
  assert.deepEqual(entriesOfLegacyAssignments(42), []);
  const entries = entriesOfLegacyAssignments([{ className: 'ক' }]);
  assert.equal(entries[0][0], 'legacy-1');
});

test('migrationForTeacher selects only that teacher’s rows and keeps others out', () => {
  const legacy = {
    a: row({ id: 'TAS-1' }),                                   // rafiq
    b: row({ id: 'TAS-2', teacherUsername: 'salma', className: 'নবম শ্রেণি' }),
    c: row({ id: 'TAS-3', className: 'অষ্টম শ্রেণি' })          // rafiq
  };
  const { assignments, unresolved } = migrationForTeacher(legacy, 'RAFIQ', TEACHERS.rafiq);
  assert.equal(unresolved.length, 0);
  assert.deepEqual(assignments.map(item => item.id).sort(), ['TAS-1', 'TAS-3']);
  for (const item of assignments) assert.equal(item.teacherId, 'uid-rafiq');
  // Salma's row never leaks into Rafiq's migration.
  assert.equal(assignments.some(item => item.id === 'TAS-2'), false);
});

test('migrationForTeacher with an empty/unknown username migrates nothing', () => {
  const legacy = { a: row() };
  assert.deepEqual(migrationForTeacher(legacy, '', TEACHERS.rafiq), { assignments: [], unresolved: [] });
  assert.deepEqual(migrationForTeacher(legacy, 'ghost', TEACHERS.rafiq), { assignments: [], unresolved: [] });
  assert.deepEqual(migrationForTeacher(null, 'rafiq', TEACHERS.rafiq), { assignments: [], unresolved: [] });
});

test('migrationForTeacher reports a row whose stored username mismatches the verified identity', () => {
  // The legacy row says "rafiq" but the verified identity is Salma: the row is
  // not silently re-attributed, it lands in unresolved with username-mismatch.
  const { assignments, unresolved } = migrationForTeacher({ a: row() }, 'rafiq', TEACHERS.salma);
  assert.deepEqual(assignments, []);
  assert.equal(unresolved.length, 1);
  assert.equal(unresolved[0].reason, 'username-mismatch');
});

test('v2IdentityClaims links Teachers and Students to their own uid, nobody else', () => {
  assert.deepEqual(v2IdentityClaims('teacher', 'uid-1'), { teacherId: 'uid-1' });
  assert.deepEqual(v2IdentityClaims('student', 'uid-2'), { studentId: 'uid-2' });
  // Staff paths are role-addressed; Admin/Manager/Payment carry no V2 link.
  for (const role of ['admin', 'manager', 'payment', '']) {
    assert.deepEqual(v2IdentityClaims(role, 'uid-3'), {}, role);
  }
  // An unsafe uid never produces a claim.
  assert.deepEqual(v2IdentityClaims('teacher', '../evil'), {});
  assert.deepEqual(v2IdentityClaims('student', ''), {});
});
