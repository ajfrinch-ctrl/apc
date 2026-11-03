import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { EnrollmentError, CLASSES, preparedEnrollment, registerStagedStudent, reviewStagedStudent } =
  require('../functions/staged-student-core.cjs');

const data = () => ({ fullName: 'Student One', username: 'student.one', mobile: '01711111111',
  className: 'দশম শ্রেণি', group: 'A', guardianConsent: true });
const applicant = (uid = 'stu-1') => ({ uid, token: {
  email: `${uid}@example.com`, firebase: { sign_in_provider: 'password' }
} });
const manager = () => ({ uid: 'manager-1', token: {
  role: 'manager', status: 'active', firebase: { sign_in_provider: 'password' }
} });
function sandbox() {
  const docs = new Map(), users = new Map(), claimWrites = [];
  users.set('stu-1', { uid: 'stu-1', email: 'stu-1@example.com', emailVerified: true, disabled: false });
  users.set('stu-2', { uid: 'stu-2', email: 'stu-2@example.com', emailVerified: true, disabled: false });
  let queue = Promise.resolve(), claimFailure = false;
  const db = {
    doc: path => ({ path }),
    runTransaction(callback) {
      const work = queue.then(async () => {
        const changes = [], tx = {
          get: async ref => ({ exists: docs.has(ref.path), data: () => docs.get(ref.path) }),
          create(ref, value) {
            if (docs.has(ref.path) || changes.some(change => change.path === ref.path)) throw new Error('exists');
            changes.push({ ref, value, op: 'create' });
          },
          update(ref, value) { changes.push({ ref, value, op: 'update' }); }
        };
        const result = await callback(tx);
        for (const { ref, value, op } of changes) {
          docs.set(ref.path, op === 'update' ? { ...docs.get(ref.path), ...value } : value);
        }
        return result;
      });
      queue = work.catch(() => {});
      return work;
    }
  };
  const auth = {
    getUser: async uid => { if (!users.has(uid)) throw new Error('not-found'); return users.get(uid); },
    async setCustomUserClaims(uid, claims) {
      if (claimFailure) { claimFailure = false; throw new Error('auth-unavailable'); }
      claimWrites.push([uid, claims]); users.set(uid, { ...users.get(uid), customClaims: claims });
    }
  };
  return { docs, users, claimWrites, db, auth, failNextClaim: () => { claimFailure = true; },
    register: (input = data(), caller = applicant()) => registerStagedStudent({
      db, auth, caller, data: input, serverTimestamp: () => 'server-time' }),
    review: (input = { uid: 'stu-1', decision: 'approved' }, caller = manager()) => reviewStagedStudent({
      db, auth, caller, data: input, serverTimestamp: () => 'server-time' }) };
}

test('verified password Auth creates exactly one pending, linked and minimal server-owned enrollment', async () => {
  const env = sandbox();
  const result = await env.register();
  assert.deepEqual(result, { ok: true, uid: 'stu-1', status: 'pending', alreadyRegistered: false, refreshIdToken: true });
  assert.equal(env.docs.size, 3);
  const student = env.docs.get('students/stu-1');
  assert.equal(student.status, 'pending');
  assert.equal(student.className, data().className);
  assert.equal(student.guardianConsent, true);
  assert.equal(student.guardianConsentAt, 'server-time');
  assert.equal(env.docs.get('usernameIndex/student.one').uid, 'stu-1');
  assert.deepEqual(env.users.get('stu-1').customClaims, { role: 'student', status: 'pending',
    studentId: 'stu-1', mustChangePassword: false });
  for (const row of env.docs.values()) {
    assert.equal('password' in row, false);
    assert.equal('pin' in row, false);
    assert.equal('guardianMobile' in row, false);
  }
  assert.equal((await env.register()).alreadyRegistered, true);
  assert.equal(env.docs.size, 3);
  const config = readFileSync(new URL('../js/config.js', import.meta.url), 'utf8');
  const classBlock = config.match(/export const enabledClasses = Object.freeze\(\[([\s\S]*?)\]\)/)?.[1];
  assert.ok(classBlock);
  assert.deepEqual([...CLASSES], [...classBlock.matchAll(/'([^']+)'/g)].map(m => m[1]));
});

test('client cannot supply UID, status, password, fee, claims or unlisted classes', async () => {
  const env = sandbox();
  for (const invalid of [
    { ...data(), uid: 'admin-1' }, { ...data(), password: 'secret123' },
    { ...data(), status: 'approved' }, { ...data(), monthlyFee: 0 },
    { ...data(), guardianConsent: false }, { ...data(), username: 'Admin' },
    { ...data(), username: '../admin' }, { ...data(), className: 'Ten' },
    { ...data(), group: 'A\nB' }, { ...data(), mobile: '123' }
  ]) assert.throws(() => preparedEnrollment(invalid), EnrollmentError);
  assert.equal(env.docs.size, 0);
});

test('unverified, disabled, other provider, forged email or privileged existing claim is rejected without writes', async () => {
  for (const changed of [
    { emailVerified: false }, { disabled: true },
    { customClaims: { role: 'admin', status: 'active' } },
    { customClaims: { status: 'active' } }, { email: 'other@example.com' }
  ]) {
    const env = sandbox();
    env.users.set('stu-1', { ...env.users.get('stu-1'), ...changed });
    await assert.rejects(env.register(), EnrollmentError);
    assert.equal(env.docs.size, 0);
  }
  const env = sandbox();
  await assert.rejects(env.register(data(), { ...applicant(), token: { ...applicant().token,
    firebase: { sign_in_provider: 'anonymous' } } }), EnrollmentError);
  assert.equal(env.docs.size, 0);
});

test('same username is reserved atomically; same UID with altered form cannot overwrite', async () => {
  const env = sandbox();
  const outcomes = await Promise.allSettled([env.register(), env.register(data(), applicant('stu-2'))]);
  assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(o => o.status === 'rejected').length, 1);
  assert.equal(env.docs.size, 3);
  assert.equal(env.docs.get('usernameIndex/student.one').uid, 'stu-1');
  await assert.rejects(env.register({ ...data(), className: 'নবম শ্রেণি' }),
    error => error.code === 'identity-reserved');
  assert.equal(env.docs.get('students/stu-1').className, 'দশম শ্রেণি');
});

test('claim update failure leaves a pending registration safely retryable without a second username', async () => {
  const env = sandbox();
  env.failNextClaim();
  await assert.rejects(env.register(), /auth-unavailable/);
  assert.equal(env.docs.size, 3);
  assert.equal(env.users.get('stu-1').customClaims, undefined);
  assert.equal((await env.register()).alreadyRegistered, true);
  assert.equal(env.docs.size, 3);
  assert.equal(env.users.get('stu-1').customClaims.status, 'pending');
});

test('Manager approval atomically links both profiles and immutable audit before Auth claim; retry repairs Auth', async () => {
  const env = sandbox();
  await env.register();
  env.failNextClaim();
  await assert.rejects(env.review(), /auth-unavailable/);
  assert.equal(env.docs.get('users/stu-1').status, 'approved');
  assert.equal(env.docs.get('students/stu-1').status, 'approved');
  assert.equal(env.docs.get('studentApprovals/stu-1').decision, 'approved');
  assert.equal(env.users.get('stu-1').customClaims.status, 'pending');
  assert.equal((await env.review()).alreadyReviewed, true);
  assert.equal(env.users.get('stu-1').customClaims.status, 'approved');
  assert.equal(env.docs.size, 4);
  await assert.rejects(env.review({ uid: 'stu-1', decision: 'rejected', note: 'No' }), EnrollmentError);
});

test('rejection requires a reason; other roles and mismatched Auth/index/profile cannot approve', async () => {
  const env = sandbox();
  await env.register();
  for (const caller of [applicant(), { ...manager(), token: { ...manager().token, role: 'teacher' } },
    { ...manager(), token: { ...manager().token, mustChangePassword: true } }]) {
    await assert.rejects(env.review(undefined, caller), EnrollmentError);
  }
  await assert.rejects(env.review({ uid: 'stu-1', decision: 'rejected', note: '' }), EnrollmentError);
  env.docs.set('usernameIndex/student.one', { uid: 'other', role: 'student' });
  await assert.rejects(env.review(), error => error.code === 'profile-mismatch');
  env.docs.set('usernameIndex/student.one', { uid: 'stu-1', role: 'student' });
  env.users.set('stu-1', { ...env.users.get('stu-1'), emailVerified: false });
  await assert.rejects(env.review(), error => error.code === 'unverified-student');
  assert.equal(env.docs.get('users/stu-1').status, 'pending');
  env.users.set('stu-1', { ...env.users.get('stu-1'), emailVerified: true });
  assert.equal((await env.review({ uid: 'stu-1', decision: 'rejected', note: 'Wrong class' })).status, 'rejected');
  assert.equal(env.users.get('stu-1').customClaims.status, 'rejected');
  assert.equal(env.docs.get('studentApprovals/stu-1').note, 'Wrong class');
});

test('staged callables enforce App Check; direct role/username/profile writes stay denied', () => {
  const source = readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  assert.match(source, /exports.studentRegisterForReview = onCall\(\{ enforceAppCheck: true \}/);
  assert.match(source, /exports.managerReviewStudent = onCall\(\{ enforceAppCheck: true \}/);
  for (const match of ['users/{userId}', 'studentApprovals/{approvalId}', 'studentSummaries/{studentId}']) {
    const section = rules.split(`match /${match}`)[1].split('match /')[0];
    assert.match(section, /allow create, update, delete: if false|allow create: if false/);
  }
  assert.match(rules, /match \/usernameIndex\/\{username\}[\s\S]*?allow read, write: if false/);
});
