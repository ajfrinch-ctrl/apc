import test from 'node:test';
import assert from 'node:assert/strict';
import { questionBankSyncPlan } from '../sync/question-bank-v2-policy.js';

test('only active custom-claim Admin/Manager can use canonical Question Bank paths', () => {
  for (const role of ['admin', 'manager']) {
    const plan = questionBankSyncPlan({ role, status: 'active' }, 'password');
    assert.equal(plan.ok, true);
    assert.equal(plan.mode, 'canonical');
    assert.equal(plan.canWrite, true);
    assert.equal(plan.readPath, 'activePlusV2/questionBank');
  }
  assert.equal(questionBankSyncPlan({ role: 'manager', status: 'suspended' }, 'password').ok, false);
});

test('Teacher listeners and drafts are rooted at the claim teacherId, never client input', () => {
  const plan = questionBankSyncPlan({ role: 'teacher', status: 'active', teacherId: 'TCH-001' }, 'password');
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.readPaths, [
    'activePlusV2/teacherQuestionBank/TCH-001',
    'activePlusV2/questionBankDraftsByTeacher/TCH-001',
    'activePlusV2/teacherAssignments'
  ]);
  assert.equal(questionBankSyncPlan({ role: 'teacher', status: 'active', teacherId: 'other/teacher' }, 'password').ok, false);
  assert.equal(questionBankSyncPlan({ role: 'teacher', status: 'active' }, 'password').ok, false);
});

test('Students can only read their approved per-student Question Bank copy', () => {
  const plan = questionBankSyncPlan({ role: 'student', status: 'approved', studentId: 's260907001-abcd' }, 'password');
  assert.equal(plan.ok, true);
  assert.equal(plan.mode, 'student');
  assert.equal(plan.canWrite, false);
  assert.equal(plan.readPath, 'activePlusV2/studentQuestionBank/s260907001-abcd');
  assert.equal(questionBankSyncPlan({ role: 'student', status: 'pending', studentId: 'S1' }, 'password').ok, false);
  assert.equal(questionBankSyncPlan({ role: 'student', status: 'approved' }, 'password').ok, false);
  assert.equal(questionBankSyncPlan({ role: 'student', status: 'approved', studentId: 'S/1' }, 'password').ok, false);
});

test('anonymous, forced-password-change, claimless and non-question-bank roles never subscribe', () => {
  assert.equal(questionBankSyncPlan({ role: 'admin', status: 'active' }, 'anonymous').ok, false);
  assert.equal(questionBankSyncPlan({ role: 'admin', status: 'active', mustChangePassword: true }, 'password').ok, false);
  assert.equal(questionBankSyncPlan({}, 'password').ok, false);
  assert.equal(questionBankSyncPlan({ role: 'payment', status: 'active' }, 'password').ok, false);
});
