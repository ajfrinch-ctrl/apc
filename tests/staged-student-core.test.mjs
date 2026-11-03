import test from 'node:test';
import assert from 'node:assert/strict';
import core from '../functions/staged-student-core.cjs';

const { EnrollmentError, reviewStagedStudent } = core;
const uid = 'STUDENT-APC-0001';
const email = 'student@example.com';
const username = 'student.one';

function setup(role) {
  const records = new Map([
    [`users/${uid}`, {
      uid, role: 'student', status: 'pending', email, username,
      fullName: 'Test Student', mustChangePassword: false
    }],
    [`students/${uid}`, {
      uid, status: 'pending', username, name: 'Test Student', fullName: 'Test Student',
      mobile: '01712345678', className: 'দশম শ্রেণি', group: '', guardianConsent: true
    }],
    [`usernameIndex/${username}`, { uid, role: 'student' }]
  ]);
  const db = {
    doc: path => path,
    async runTransaction(work) {
      const tx = {
        async get(path) {
          const value = records.get(path);
          return { exists: value !== undefined, data: () => value ? structuredClone(value) : undefined };
        },
        update(path, patch) {
          const current = records.get(path);
          if (!current) throw new Error('missing document: ' + path);
          records.set(path, { ...current, ...patch });
        },
        create(path, value) {
          if (records.has(path)) throw new Error('document already exists: ' + path);
          records.set(path, value);
        }
      };
      return work(tx);
    }
  };
  const authUser = {
    uid, email, emailVerified: true, disabled: false,
    customClaims: { role: 'student', status: 'pending', studentId: uid, mustChangePassword: false }
  };
  const auth = {
    async getUser(target) {
      assert.equal(target, uid);
      return structuredClone(authUser);
    },
    async setCustomUserClaims(target, claims) {
      assert.equal(target, uid);
      authUser.customClaims = { ...claims };
    }
  };
  const caller = {
    uid: `STAFF-${role.toUpperCase()}`,
    token: { role, status: 'active', mustChangePassword: false, firebase: { sign_in_provider: 'password' } }
  };
  return { db, auth, authUser, caller, records };
}

for (const role of ['admin', 'manager']) {
  test(`${role} can approve a verified pending Student through the server transaction`, async () => {
    const env = setup(role);
    const result = await reviewStagedStudent({
      ...env, serverTimestamp: () => 'SERVER_TIME',
      data: { uid, decision: 'approved', note: '' }
    });
    assert.equal(result.ok, true);
    assert.equal(result.status, 'approved');
    assert.equal(env.records.get(`students/${uid}`).status, 'approved');
    assert.equal(env.records.get(`users/${uid}`).status, 'approved');
    assert.equal(env.records.get(`studentApprovals/${uid}`).reviewedBy, env.caller.uid);
    assert.equal(env.authUser.customClaims.status, 'approved');
    assert.equal(env.authUser.customClaims.studentId, uid);
  });
}

test('Teacher and inactive or password-due staff cannot decide staged Student enrollment', async () => {
  for (const caller of [
    { uid: 'STAFF-TEACHER', token: { role: 'teacher', status: 'active', firebase: { sign_in_provider: 'password' } } },
    { uid: 'STAFF-ADMIN', token: { role: 'admin', status: 'inactive', firebase: { sign_in_provider: 'password' } } },
    { uid: 'STAFF-MANAGER', token: { role: 'manager', status: 'active', mustChangePassword: true, firebase: { sign_in_provider: 'password' } } }
  ]) {
    const env = setup('manager');
    await assert.rejects(
      reviewStagedStudent({ ...env, caller, serverTimestamp: () => 'SERVER_TIME', data: { uid, decision: 'approved', note: '' } }),
      error => error instanceof EnrollmentError && error.code === 'reviewer-required'
    );
  }
});
