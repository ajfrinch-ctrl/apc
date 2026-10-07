'use strict';

const SAFE_KEY = /^[A-Za-z0-9_-]{1,128}$/;
const object = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const safeKey = value => typeof value === 'string' && SAFE_KEY.test(value);
const cleanText = (value, max = 200) => String(value ?? '').normalize('NFC').trim().slice(0, max);
const normalizeUsername = value => cleanText(value, 32).toLowerCase();

function entriesOfLegacyAssignments(value) {
  if (Array.isArray(value)) return value.map((row, index) => [String(row?.id || `legacy-${index + 1}`), row]);
  return object(value) ? Object.entries(value) : [];
}

function normalizeSubjects(row) {
  const source = Array.isArray(row.subjects) && row.subjects.length
    ? row.subjects
    : String(row.subject || '').split(',');
  return [...new Set(source.map(value => cleanText(value, 80)).filter(Boolean))];
}

/**
 * Convert legacy username-addressed assignments into claim-addressed V2 rows.
 * The caller must build identities from server-controlled usernameIndex/users
 * documents and Firebase Auth state; this helper deliberately trusts no field
 * inside a legacy assignment except its scope and display metadata.
 */
function buildTeacherAssignmentMigration(legacyValue, identityByUsername = {}) {
  const assignments = [];
  const unresolved = [];
  const seenIds = new Set();

  for (const [wireId, raw] of entriesOfLegacyAssignments(legacyValue)) {
    const id = cleanText(raw?.id || wireId, 128);
    const username = normalizeUsername(raw?.teacherUsername);
    const identity = identityByUsername instanceof Map
      ? identityByUsername.get(username)
      : identityByUsername[username];
    let reason = '';

    if (!object(raw)) reason = 'invalid-record';
    else if (!safeKey(id)) reason = 'unsafe-assignment-id';
    else if (seenIds.has(id)) reason = 'duplicate-assignment-id';
    if (!reason && !username) reason = 'missing-teacher-username';
    else if (!reason && !identity) reason = 'teacher-identity-not-found';
    else if (!reason && !safeKey(identity.uid)) reason = 'unsafe-teacher-uid';
    else if (!reason && identity.username && normalizeUsername(identity.username) !== username) reason = 'username-mismatch';
    else if (!reason && identity.role !== 'teacher') reason = 'identity-not-teacher';
    else if (!reason && identity.status !== 'active') reason = 'teacher-not-active';
    else if (!reason && identity.disabled === true) reason = 'teacher-auth-disabled';

    const className = cleanText(raw?.className, 80);
    const group = cleanText(raw?.group, 80);
    const subjects = normalizeSubjects(raw || {});
    if (!reason && !className) reason = 'missing-class';
    else if (!reason && subjects.length === 0) reason = 'missing-subjects';

    if (reason) {
      unresolved.push({ id, teacherUsername: username, reason });
      continue;
    }
    seenIds.add(id);
    assignments.push({
      id,
      teacherId: identity.uid,
      teacherUid: identity.uid,
      teacherUsername: username,
      teacherName: cleanText(raw.teacherName, 100),
      className,
      group,
      subjects,
      subject: subjects.join(', ')
    });
  }
  return { assignments, unresolved };
}

function linkedTeacherClaims({ uid, profile, authClaims = {} } = {}) {
  if (!safeKey(uid) || !object(profile) || profile.role !== 'teacher' || profile.status !== 'active') {
    throw new TypeError('an active Teacher profile and safe Firebase UID are required');
  }
  return {
    ...authClaims,
    role: 'teacher',
    status: 'active',
    mustChangePassword: profile.mustChangePassword === true,
    teacherId: uid
  };
}

/**
 * Select one teacher's legacy rows and migrate them against a single verified
 * identity. Used by the Admin retro-link callable so a teacher whose account
 * predates the V2 claims still gets their class/group/subject scope carried
 * over. Rows that fail validation are reported, never silently dropped.
 */
function migrationForTeacher(legacyValue, username, identity) {
  const wanted = normalizeUsername(username);
  if (!wanted) return { assignments: [], unresolved: [] };
  const rows = {};
  for (const [wireId, rowValue] of entriesOfLegacyAssignments(legacyValue)) {
    if (normalizeUsername(rowValue?.teacherUsername) === wanted) rows[wireId] = rowValue;
  }
  if (!Object.keys(rows).length) return { assignments: [], unresolved: [] };
  return buildTeacherAssignmentMigration(rows, { [wanted]: identity });
}

/**
 * The V2 link established at provisioning time: Teacher scope nodes are
 * addressed by `teacherId`, Student nodes by `studentId`, and both always
 * equal the account's own Firebase Auth uid (roster records are keyed
 * `students/{uid}`). Admin/Manager/Payment need no extra link — the canonical
 * and staff paths are addressed by role claims alone.
 */
function v2IdentityClaims(role, uid) {
  if (!safeKey(uid)) return {};
  if (role === 'teacher') return { teacherId: uid };
  if (role === 'student') return { studentId: uid };
  return {};
}

module.exports = {
  SAFE_KEY,
  safeKey,
  normalizeUsername,
  entriesOfLegacyAssignments,
  buildTeacherAssignmentMigration,
  linkedTeacherClaims,
  migrationForTeacher,
  v2IdentityClaims
};
