/* Staff Management — the Admin Panel's staff module, exercised on the real
   admin.html + js/staff-directory.js + js/staff-management.js (jsdom).

   Covers the acceptance list for Staff Management:
     • unique, permanent, searchable Staff IDs (never a Student ID)
     • create · view · edit · activate/deactivate · reset password · delete
     • Staff ID is locked once created
     • students never appear in the staff list
     • history beats deletion: an account with records is deactivated instead
     • the System Owner is Protected and can never be locked out
     • permission is enforced, not just hidden: without an Admin session every
       mutation is refused
*/
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { provisionStaff, seedStaffSession } from './staff-harness.mjs';
import { STAFF_ACCOUNTS } from '../js/staff-auth.js';
import {
  STAFF_DIRECTORY_KEY,
  createStaff,
  deleteStaff,
  listStaff,
  resetStaffPassword,
  setStaffStatus,
  updateStaff,
  staffActivitySummary
} from '../js/staff-directory.js';
import { ROUTINE_KEY } from '../js/office-data.js';
import { renderStaff } from '../js/staff-management.js';

let ctx;

before(async () => {
  ctx = await loadPage('admin.html', { seed: { 'activePlus.demo.autofill.v1': 'off' } });
  await provisionStaff('admin');
  seedStaffSession(ctx.window, 'admin');
  await import('../js/admin.js');
  await ctx.waitFor(() => ctx.$('#adminShell').hidden === false);
  await ctx.waitFor(() => ctx.$$('#staffList .staff-card').length >= 4);
});

after(() => ctx?.dom?.window?.close?.());

const staffCard = staffId => ctx.$(`[data-staff-card="${staffId}"]`);
/** Direct data-layer calls do not repaint the list; tests repaint on purpose. */
const sync = async () => {
  await renderStaff();
  await ctx.flush();
};
const fill = (id, value) => {
  const el = ctx.$(id);
  el.value = value;
  return el;
};

test('the staff list opens with one permanent Staff ID per system role', async () => {
  assert.deepEqual(ctx.jsdomErrors, []);
  const staff = await listStaff();
  assert.deepEqual(staff.map(entry => entry.staffId), ['STF-0001', 'STF-0002', 'STF-0003', 'STF-0004']);
  assert.deepEqual(staff.map(entry => entry.role), ['admin', 'manager', 'teacher', 'cash-counter']);
  // Student IDs live in the roster namespace and never show up here.
  assert.equal(staff.some(entry => String(entry.staffId).startsWith('AP')), false);
  // The System Owner is protected so nobody can lock the system out.
  const owner = staff.find(entry => entry.role === 'admin');
  assert.equal(owner.protected, true);
  assert.match(staffCard('STF-0001').textContent, /Protected/);
});

test('create builds a new staff account with the next unique Staff ID', async () => {
  ctx.click(ctx.$('#staffCreateButton'));
  await ctx.waitFor(() => Boolean(ctx.$('#staffForm')));
  // The Login User ID cannot be typed: the form shows a locked preview only.
  assert.equal(ctx.$('#staffField-username').tagName, 'DIV');
  assert.equal(ctx.$('#staffField-username-hidden').tagName, 'INPUT');
  assert.equal(ctx.$('#staffField-username-hidden').type, 'hidden');
  fill('#staffField-fullName', 'নতুন শিক্ষক');
  ctx.$('#staffField-fullName').dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
  fill('#staffField-password', 'Teacher-2026');
  fill('#staffField-confirmPassword', 'Teacher-2026');
  fill('#staffField-role', 'teacher');
  ctx.$('#staffField-role').dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  fill('#staffField-mobile', '01712345678');
  fill('#staffField-subjects', 'উচ্চতর গণিত, পদার্থবিজ্ঞান');
  // Generated from the name + role: "First Name + Role + .apc".
  assert.equal(ctx.$('#staffField-username').textContent, 'notun.teacher.apc');
  ctx.submit(ctx.$('#staffForm'));
  await ctx.waitFor(() => Boolean(staffCard('STF-0005')));

  const created = (await listStaff()).find(entry => entry.staffId === 'STF-0005');
  assert.equal(created.fullName, 'নতুন শিক্ষক');
  assert.equal(created.username, 'notun.teacher.apc');
  assert.equal(created.role, 'teacher');
  assert.equal(created.status, 'active');
  assert.deepEqual(created.assignment.subjects, ['উচ্চতর গণিত', 'পদার্থবিজ্ঞান']);
  assert.equal(created.mustChangePassword, true);
  // A password is stored as a hash, never as plain text.
  const raw = ctx.window.localStorage.getItem(STAFF_DIRECTORY_KEY) || '';
  assert.equal(raw.includes('Teacher-2026'), false);
  assert.equal(staffCard('STF-0005').textContent.includes('Teacher-2026'), false);
  // The username is claimed device-wide, so a student cannot take it.
  const index = JSON.parse(ctx.window.localStorage.getItem('active-plus-usernames-v1') || '{}');
  assert.equal(index['notun.teacher.apc'], 'staff:teacher');
  // The permanent internal identity is separate and never a login id.
  assert.match(created.staffId, /^STF-\d{4}$/);
  assert.notEqual(created.staffId, created.username);
});

test('a repeated name never produces a duplicate id — the number lands on the first name', async () => {
  // A typed-in username is ignored: ids are always generated.
  const result = await createStaff({
    fullName: 'নতুন শিক্ষক', username: 'notun.teacher.apc', password: 'Dup-2026',
    confirmPassword: 'Dup-2026', role: 'teacher'
  });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.staff.username, 'notun2.teacher.apc');
  assert.equal(result.staff.staffId, 'STF-0006');
  const third = await createStaff({
    fullName: 'নতুন শিক্ষক', password: 'Dup-2026', confirmPassword: 'Dup-2026', role: 'teacher'
  });
  assert.equal(third.ok, true, third.error);
  assert.equal(third.staff.username, 'notun3.teacher.apc');
  // Forbidden shapes never appear. The four device role accounts keep their own
  // reserved ids ("admin.apc", "teacher.apc", …) — they are never rewritten.
  for (const entry of (await listStaff()).filter(item => item.kind !== 'system')) {
    assert.doesNotMatch(entry.username, /(admin|manager|teacher|cash)\d/);
    assert.doesNotMatch(entry.username, /apc\d/);
    assert.match(entry.username, /^([a-z][a-z0-9]*)\.(admin|manager|teacher|cash)\.apc$/);
  }
  await sync();
});

test('edit changes the profile but the Staff ID stays locked', async () => {
  const before = (await listStaff()).find(entry => entry.staffId === 'STF-0005');
  ctx.click(staffCard('STF-0005').querySelector('[data-staff-action="edit"]'));
  await ctx.waitFor(() => Boolean(ctx.$('#staffForm')));
  // The form shows the ID as read-only text; there is no editable ID field.
  assert.match(ctx.$('#staffForm').textContent, /STF-0005/);
  assert.equal(ctx.$('#staffField-staffId'), null);
  fill('#staffField-fullName', 'নতুন শিক্ষক (হালনাগাদ)');
  fill('#staffField-mobile', '01812345678');
  ctx.submit(ctx.$('#staffForm'));
  await ctx.waitFor(() => (staffCard('STF-0005').textContent.includes('হালনাগাদ')));

  const after = (await listStaff()).find(entry => entry.staffId === 'STF-0005');
  assert.equal(after.fullName, 'নতুন শিক্ষক (হালনাগাদ)');
  assert.equal(after.mobile, '01812345678');
  assert.equal(after.staffId, before.staffId);
  // Even a direct API call cannot move the permanent identity.
  const forced = await updateStaff('STF-0005', { staffId: 'STF-9999', fullName: 'চেষ্টা' });
  assert.equal(forced.ok, true);
  assert.equal((await listStaff()).find(entry => entry.fullName === 'চেষ্টা').staffId, 'STF-0005');
});

test('a role change or a rename regenerates the Login User ID — the Staff ID never moves', async () => {
  const created = await createStaff({
    fullName: 'Rasal Ahmed', password: 'Role-2026', confirmPassword: 'Role-2026', role: 'teacher'
  });
  assert.equal(created.ok, true, created.error);
  const id = created.staff.staffId;
  assert.equal(created.staff.username, 'rasal.teacher.apc');

  const moved = await updateStaff(id, { role: 'manager' });
  assert.equal(moved.ok, true, moved.error);
  assert.equal(moved.staff.username, 'rasal.manager.apc', 'the role part follows the role');
  assert.equal(moved.staff.role, 'manager');
  assert.equal(moved.staff.staffId, id, 'the permanent internal id is untouched');

  const renamed = await updateStaff(id, { fullName: 'Karim Ahmed' });
  assert.equal(renamed.ok, true, renamed.error);
  assert.equal(renamed.staff.username, 'karim.manager.apc');
  assert.equal(renamed.staff.staffId, id);
  assert.doesNotMatch(renamed.staff.username, /(manager|admin|teacher|cash)\d/);

  // A device role account keeps its own reserved id — it is never rewritten.
  const system = await updateStaff('STF-0003', { fullName: 'শিক্ষক এক' });
  assert.equal(system.ok, true, system.error);
  assert.equal(system.staff.username, 'teacher.apc');
  assert.equal(system.staff.staffId, 'STF-0003');
  await sync();
});

test('deactivate blocks login but keeps every historical record', async () => {
  const result = await setStaffStatus('STF-0005', 'inactive');
  assert.equal(result.ok, true);
  await sync();
  await ctx.waitFor(() => staffCard('STF-0005').className.includes('is-inactive'));
  assert.match(staffCard('STF-0005').textContent, /নিষ্ক্রিয়/);
  // The record itself is untouched — only the login gate changed.
  const stored = (await listStaff()).find(entry => entry.staffId === 'STF-0005');
  assert.equal(stored.fullName, 'চেষ্টা');
  assert.equal(stored.status, 'inactive');
  await setStaffStatus('STF-0005', 'active');
  await sync();
});

test('the System Owner can never be deactivated, demoted or deleted', async () => {
  const status = await setStaffStatus('STF-0001', 'inactive');
  assert.equal(status.ok, false);
  assert.equal(status.code, 'PROTECTED');
  const role = await updateStaff('STF-0001', { role: 'manager' });
  assert.equal(role.ok, false);
  const removed = await deleteStaff('STF-0001');
  assert.equal(removed.ok, false);
  assert.equal(removed.code, 'PROTECTED');
  assert.equal((await listStaff()).find(entry => entry.staffId === 'STF-0001').role, 'admin');
  assert.equal((await listStaff()).find(entry => entry.staffId === 'STF-0001').status, 'active');
});

test('reset password stores a hash and forces a change on next login', async () => {
  const result = await resetStaffPassword('STF-0005', 'Reset-2026', 'Reset-2026');
  assert.equal(result.ok, true);
  const raw = ctx.window.localStorage.getItem(STAFF_DIRECTORY_KEY) || '';
  assert.equal(raw.includes('Reset-2026'), false);
  assert.equal((await listStaff()).find(entry => entry.staffId === 'STF-0005').mustChangePassword, true);
  const mismatch = await resetStaffPassword('STF-0005', 'Reset-2026', 'ভুল');
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.error, /মিলছে না/);
});

test('delete asks for confirmation and refuses when history is attached', async () => {
  // Attach a real history record: a routine class taught by this staff member.
  const staffBefore = (await listStaff()).find(entry => entry.staffId === 'STF-0005');
  ctx.window.localStorage.setItem(ROUTINE_KEY, JSON.stringify({
    sat: { date: '', classes: [{ subject: 'গণিত', teacher: staffBefore.fullName, room: 'রুম ২০৩', time: '18:00', className: 'দশম শ্রেণি' }] }
  }));
  await sync();
  const staff = (await listStaff()).find(entry => entry.staffId === 'STF-0005');
  assert.equal(staffActivitySummary(staff).hasHistory, true);

  ctx.click(staffCard('STF-0005').querySelector('[data-staff-action="more"]'));
  await ctx.waitFor(() => Boolean(staffCard('STF-0005').querySelector('[data-staff-action="delete"]')));
  staffCard('STF-0005').querySelector('[data-staff-action="delete"]').click();
  await ctx.waitFor(() => ctx.$('#staffModalBackdrop')?.hidden === false);
  assert.match(ctx.$('#staffModalBody').textContent, /স্থায়ীভাবে মুছে ফেলতে চান/);
  assert.match(ctx.$('#staffModalBody').textContent, /Cancel/);
  // History wins: the dialog offers deactivation instead of deletion.
  assert.match(ctx.$('#staffModalBody').textContent, /ইতিহাস/);
  assert.ok(ctx.$('#staffModalBody [data-staff-action="deactivate"]'));

  const refused = await deleteStaff('STF-0005');
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'HISTORY');
  assert.equal(refused.suggestion, 'deactivate');
});

test('a staff member without history is deleted after confirmation', async () => {
  const created = await createStaff({
    fullName: 'অস্থায়ী স্টাফ', password: 'Temp-2026',
    confirmPassword: 'Temp-2026', role: 'other', status: 'active'
  });
  assert.equal(created.ok, true);
  const staffId = created.staff.staffId;
  // Generated, not typed: First Name + Role + .apc ("staff" for the other role).
  assert.equal(created.staff.username, 'asthayi.staff.apc');

  const removed = await deleteStaff(staffId);
  assert.equal(removed.ok, true);
  assert.equal((await listStaff()).some(entry => entry.staffId === staffId), false);
  // The username claim is released, so the name can be used again.
  const index = JSON.parse(ctx.window.localStorage.getItem('active-plus-usernames-v1') || '{}');
  assert.equal(index['asthayi.staff.apc'], undefined);
});

test('search and filters narrow the list by ID, name, username, mobile, role and status', async () => {
  const search = ctx.$('#staffSearch');
  ctx.type(search, 'STF-0003');
  await ctx.waitFor(() => ctx.$$('#staffList .staff-card').length === 1);
  assert.ok(staffCard('STF-0003'));

  ctx.type(search, '');
  ctx.type(search, 'payment.apc');
  await ctx.waitFor(() => ctx.$$('#staffList .staff-card').length === 1);
  assert.ok(staffCard('STF-0004'));

  ctx.type(search, '');
  await ctx.waitFor(() => ctx.$$('#staffList .staff-card').length >= 4);
  ctx.click(ctx.$('[data-staff-role="teacher"]'));
  await ctx.waitFor(() => ctx.$$('#staffList .staff-card').length >= 1);
  const ids = ctx.$$('#staffList .staff-card').map(card => card.dataset.staffCard);
  assert.equal(ids.includes('STF-0001'), false);
  assert.equal(ids.includes('STF-0003'), true);
  ctx.click(ctx.$('[data-staff-role="all"]'));
});

test('without an Admin session every mutation is refused', async () => {
  // Permission is enforced in the data layer, not only by hiding buttons.
  ctx.window.localStorage.removeItem(STAFF_ACCOUNTS.admin.sessionKey);
  for (const [label, result] of [
    ['create', await createStaff({ fullName: 'অননুমোদিত', username: 'nope.staff.apc', password: 'Nope-2026', confirmPassword: 'Nope-2026', role: 'teacher' })],
    ['update', await updateStaff('STF-0003', { fullName: 'অননুমোদিত' })],
    ['status', await setStaffStatus('STF-0003', 'inactive')],
    ['password', await resetStaffPassword('STF-0003', 'Nope-2026', 'Nope-2026')],
    ['delete', await deleteStaff('STF-0003')]
  ]) {
    assert.equal(result.ok, false, `${label} must be refused`);
    assert.equal(result.code, 'FORBIDDEN', `${label} must report FORBIDDEN`);
  }
  assert.equal((await listStaff()).some(entry => entry.username === 'nope.staff.apc'), false);
  seedStaffSession(ctx.window, 'admin');
});

test('the panel keeps the Admin menu clean: no cash, routine or notice entry', () => {
  const views = ctx.$$('.admin-view').map(view => view.dataset.viewPanel);
  for (const removed of ['finance', 'routine', 'notices', 'exams', 'app-management', 'classes']) {
    assert.equal(views.includes(removed), false, `${removed} must not be an Admin section`);
  }
  for (const kept of ['dashboard', 'staff', 'system', 'roles', 'students', 'reports', 'data', 'backup', 'security', 'settings', 'profile']) {
    assert.equal(views.includes(kept), true, `${kept} must stay in the Admin menu`);
  }
  // No daily-operation control survives anywhere in the DOM.
  for (const selector of ['#feeStudentSearch', '#feeCollectionForm', '#addRoutineForm', '#noticeForm', '#dashCollectFee']) {
    assert.equal(ctx.$(selector), null, `${selector} must be gone`);
  }
});
