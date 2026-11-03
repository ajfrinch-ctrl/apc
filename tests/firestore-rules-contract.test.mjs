/* Static staged guardrails only: these checks do NOT evaluate Firebase rules.
   The emulator suite in functions/test/firestore-rules.test.js must pass before
   any deploy. Firestore panel cutover and production submission remain pending. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rules = readFileSync(resolve(root, 'firestore.rules'), 'utf8');
const functionsSrc = readFileSync(resolve(root, 'functions/index.js'), 'utf8');

/** Text of one `match /<name>` block up to the next top-level match. An
 * optional startMarker widens the window backwards to include helper
 * functions or section comments that sit just above the match. */
function matchBlock(name, startMarker = null) {
  const marker = `match /${name}`;
  const at = rules.indexOf(marker);
  assert.ok(at >= 0, `firestore.rules: missing ${marker}`);
  const next = rules.indexOf('\n    match /', at + marker.length);
  const end = next === -1 ? rules.length : next;
  let start = at;
  if (startMarker) {
    const from = rules.indexOf(startMarker);
    assert.ok(from >= 0 && from < at, `firestore.rules: missing ${startMarker}`);
    start = from;
  }
  return rules.slice(start, end);
}

function functionBody(exportName) {
  const start = functionsSrc.indexOf(`exports.${exportName} = `);
  assert.ok(start >= 0, `functions/index.js: missing exports.${exportName}`);
  const next = functionsSrc.indexOf('\nexports.', start + 1);
  return next === -1 ? functionsSrc.slice(start) : functionsSrc.slice(start, next);
}

test('exam keys, draft writes and published answers are server-only', () => {
  const exams = matchBlock('exams/{examId}', 'function ownsExam');
  const privateBlock = exams.slice(exams.indexOf('match /private/{document}'), exams.indexOf('match /releasedKey/'));
  assert.match(exams, /allow create, update, delete: if false/);
  assert.match(privateBlock, /allow write: if false/);
  assert.doesNotMatch(privateBlock, /isStudent/);
  assert.match(exams, /match \/releasedKey\/\{document\}/);
  assert.match(exams, /document == 'answers'/);
  assert.match(exams, /releasedAt is timestamp && examForStudent\(examId\)/);
  assert.match(exams, /function examForStudentOwned\(examId\)/);
  assert.doesNotMatch(exams, /questions\.all\(/, 'unsupported list lambda cannot protect keys');
});

test('scoring and answer release live in Cloud Functions after the exam ends', () => {
  const release = functionBody('releaseExamResults');
  const closing = readFileSync(resolve(root, 'functions/staged-release-core.cjs'), 'utf8');
  const examCore = readFileSync(resolve(root, 'functions/staged-exam-core.cjs'), 'utf8');
  assert.match(closing, /exams\/\$\{examId\}\/private\/key/, 'reads private key in the close transaction');
  assert.match(examCore, /now < exam\.endAt/, 'must refuse before exam window ends');
  assert.match(release, /closeStagedExamForRelease\(\{/);
  assert.match(release, /validStagedAttempt\(attempt, exam, attemptDoc\.id\)/);
  assert.ok(release.includes('scoreAttempt'), 'scores attempts server-side');
  assert.ok(release.includes("collection('results')"), 'writes results server-side');
  assert.ok(release.includes("collection('releasedKey').doc('answers').set"), 'publishes a valid document path');
  assert.match(release, /token.status !== 'active'/);
  assert.ok(functionsSrc.includes("require('./exam-scoring.js')"));
});

test('client exam transitions are closed; Admin and Manager publish via server transaction', () => {
  assert.match(matchBlock('exams/{examId}'), /allow create, update, delete: if false/);
  const review = functionBody('managerReviewExam');
  assert.match(review, /requireCaller\(request, \['admin', 'manager'\]\)/);
  assert.match(review, /exam.data\(\).status !== 'pending'/);
  assert.match(review, /FieldValue.serverTimestamp\(\)/);
});

test('students read only published exams of their own class', () => {
  const exams = matchBlock('exams/{examId}', 'function ownsExam');
  assert.match(exams, /isStudent\(\) && resource\.data\.status == 'published' && resource\.data\.className == studentClass\(\)/);
  assert.match(exams, /resource\.data\.get\('group', ''\) == studentGroup\(\)/);
  assert.match(exams, /paper\.status == 'published' && paper\.resultsReleased == true/);
  assert.match(exams, /paper\.className == studentClass\(\)/);
  assert.match(exams, /paper\.get\('group', ''\) == studentGroup\(\)/);
});

test('teaching: student read is published + own class/section; teacher writes own rows only', () => {
  const teaching = matchBlock('teaching/{teachingId}', 'function teachingForStudent');
  assert.match(teaching, /teachingForStudent/);
  assert.match(teaching, /resource\.data\.status == 'published'/);
  assert.match(teaching, /resource\.data\.className == studentClass\(\)/);
  assert.match(teaching, /resource\.data\.group == studentGroup\(\)/);
  assert.match(teaching, /isTeacher\(\) && request\.resource\.data\.teacherUid == request\.auth\.uid/);
  assert.match(teaching, /isTeacher\(\) && resource\.data\.teacherUid == request\.auth\.uid/);
  // Admin is the documented exception to teacher ownership.
  assert.match(teaching, /allow create: if isStaffManager\(\) \|\| isStaffAdmin\(\)/);
});

test('teachers and payment cannot read full legacy student documents', () => {
  const students = matchBlock('students/{studentId}');
  const readGate = students.split('allow read:')[1].split('allow create:')[0];
  assert.doesNotMatch(readGate, /isTeacher\(\)|isPayment\(\)/);
  const summary = matchBlock('studentSummaries/{studentId}');
  assert.match(summary, /isTeacher\(\) && resource\.data\.status == 'approved' && resource\.data\.className in assignedClasses\(\)/);
});

test('student review is server-only and updates profile plus claims', () => {
  const students = matchBlock('students/{studentId}');
  assert.match(students, /isStaffManager\(\) && resource.data.status in \['pending', 'approved'\]/);
  assert.doesNotMatch(students.split('allow update:')[1].split('allow delete:')[0], /isStaffManager\(\)/);
  const review = functionBody('managerReviewStudent');
  const core = readFileSync(resolve(root, 'functions/staged-student-core.cjs'), 'utf8');
  assert.match(review, /enforceAppCheck: true/);
  assert.match(review, /reviewStagedStudent\(\{/);
  assert.match(core, /!\['admin', 'manager'\]\.includes\(caller\.token\?\.role\)/);
  assert.match(core, /tx.update\(studentRef/);
  assert.match(core, /tx.update\(userRef/);
  assert.match(core, /auth.setCustomUserClaims\(uid/);
});

test('students: Admin edits limited fields only — never status/uid', () => {
  const students = matchBlock('students/{studentId}');
  assert.match(students, /isAdmin\(\)\s*\n\s*&& request\.resource\.data\.diff\(resource\.data\)\.affectedKeys\(\)\.hasOnly\(\['name', 'fullName', 'mobile', 'classId', 'className', 'group', 'monthlyFee'\]\)/);
  assert.match(students, /allow create: if false/);
});

test('payment counter reads only the limited summary surface of approved students', () => {
  const summaries = matchBlock('studentSummaries/{studentId}', 'Limited student surface');
  assert.match(summaries, /isPayment\(\) && resource\.data\.status == 'approved'/);
  for (const field of ['name', 'Student ID', 'class', 'mobile', 'monthly fee']) {
    assert.ok(summaries.toLowerCase().includes(field.toLowerCase()), `summary surface documents ${field}`);
  }
  assert.match(summaries, /allow create, update, delete: if false/);
});

test('staged receipts and accounting corrections remain server-only, never client-derived finance authority', () => {
  const transactions = matchBlock('transactions/{transactionId}');
  assert.match(transactions, /allow create, update, delete: if false/);
  assert.doesNotMatch(transactions, /validTransaction\(\)/);
  const reversals = matchBlock('paymentReversals/{receiptId}');
  assert.match(reversals, /allow read: if isAdmin\(\)/);
  assert.match(reversals, /allow create, update, delete: if false/);
  assert.match(functionBody('managerRequestPaymentReversal'), /enforceAppCheck: true/);
  assert.match(functionBody('adminDecidePaymentReversal'), /enforceAppCheck: true/);
});

test('transactions: payment reads own rows only, admin reads all, update/delete closed', () => {
  const transactions = matchBlock('transactions/{transactionId}');
  assert.match(transactions, /isAdmin\(\) \|\| \(isPayment\(\) && resource\.data\.createdBy == request\.auth\.uid\)/);
  assert.match(transactions, /allow create, update, delete: if false/);
});

test('notices: written by Manager+Admin only', () => {
  const notices = matchBlock('notices/{noticeId}');
  assert.match(notices, /allow create, update, delete: if isStaffManager\(\) \|\| isStaffAdmin\(\)/);
});

test('unreviewed public question, notice and routine projections are not exposed to students', () => {
  for (const name of ['questions/{questionId}', 'questionBank/{questionId}', 'notices/{noticeId}', 'routine/{routineId}']) {
    const block = matchBlock(name);
    const readGate = block.split('allow read:')[1].split(';')[0];
    assert.doesNotMatch(readGate, /isStudent\(\)|isSignedIn\(\)|active\(\)/, `${name}: no broad student read`);
  }
});

test('routine: Manager+Admin write any row, Teacher writes only own teacherUid rows', () => {
  const routine = matchBlock('routine/{routineId}');
  assert.match(routine, /allow create: if isStaffManager\(\) \|\| isStaffAdmin\(\)\s*\n\s*\|\| \(isTeacher\(\) && request\.resource\.data\.teacherUid == request\.auth\.uid\)/);
  assert.match(routine, /isTeacher\(\) && resource\.data\.teacherUid == request\.auth\.uid\s*\n\s*&& request\.resource\.data\.teacherUid == request\.auth\.uid/);
});

test('studentApprovals is a server-owned audit trail readable by Manager/Admin', () => {
  const approvals = matchBlock('studentApprovals/{approvalId}');
  assert.match(approvals, /allow read: if isStaffAdmin\(\) \|\| isStaffManager\(\)/);
  assert.match(approvals, /allow create, update, delete: if false/);
});

test('attempts/results/attendance/homeworkSubmissions: own-only reads, server-only writes', () => {
  for (const name of ['attempts/{attemptId}', 'results/{resultId}', 'attendance/{attendanceId}', 'homeworkSubmissions/{submissionId}']) {
    const block = matchBlock(name);
    assert.match(block, /ownRow\(resource\.data\)/, `${name}: student reads own rows`);
    assert.match(block, /staffRowRead\(resource\.data\)/, `${name}: teacher reads own class`);
    assert.match(block, /allow update: if false/, `${name}: immutable`);
    assert.match(block, /allow delete: if false/, `${name}: immutable`);
  }
  for (const name of ['attempts/{attemptId}', 'homeworkSubmissions/{submissionId}', 'attendance/{attendanceId}', 'results/{resultId}']) {
    assert.match(matchBlock(name), /allow create: if false/, `${name}: no client forgeries`);
  }
  assert.match(matchBlock('results/{resultId}', 'function resultReleased'), /resultsReleased == true/);
  assert.match(matchBlock('results/{resultId}'), /ownRow\(resource\.data\) && resultReleased\(resource\.data\)/);
});

test('staff deactivate and role change revoke refresh tokens', () => {
  const statusBody = functionBody('adminSetAccountStatus');
  assert.match(statusBody, /auth\.revokeRefreshTokens\(uid\)/);
  const provisionBody = functionBody('adminProvisionV2Identities');
  assert.match(provisionBody, /auth\.revokeRefreshTokens\(uid\)/);
});

test('teacher class scoping rides on the classes claim, deny-by-default', () => {
  assert.match(rules, /request\.auth\.token\.get\('classes', \[\]\) is list \? request\.auth\.token\.get\('classes', \[\]\) : \[\]/);
  assert.match(rules, /className in assignedClasses\(\)/);
});
