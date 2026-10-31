/* Multiple Admins — owner decision 2026-10-30.

   "এক এডমিন অন্য এডমিন আইডি ক্রিয়েট করতে পারবে?" → yes. The Admin panel may
   now create another Admin from Staff Management, and that account is a real
   Admin: it signs in through the staff directory, lands on the Admin panel and
   edits its OWN profile and password.

   What must NOT change:
     • the device's System Owner (STF-0001) stays protected — it can never be
       demoted, deactivated or deleted, so the institution can never be locked
       out;
     • a second Admin's Login User ID never moves when they rename themselves;
     • the owner's device account is never edited by somebody else's session.
*/
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { provisionStaff, seedStaffSession } from './staff-harness.mjs';
import {
  CREATABLE_STAFF_ROLES,
  STAFF_ROLE_META,
  authenticateDirectoryStaff,
  createStaff,
  deleteStaff,
  listStaff,
  setStaffStatus,
  updateOwnStaffProfile,
  updateStaff
} from '../js/staff-directory.js';
import { readActiveStaffIdentity, readStaffAccount, saveStaffSession } from '../js/staff-auth.js';

const SECOND_ADMIN = {
  fullName: 'সহকারী এডমিন',
  password: 'Second-Admin-2026',
  mobile: '01712345678'
};

let ctx;
let created;
let owner;

before(async () => {
  ctx = await loadPage('admin.html', { seed: { 'activePlus.demo.autofill.v1': 'off' } });
  await provisionStaff('admin');
  seedStaffSession(ctx.window, 'admin');
  await import('../js/admin.js');
  await ctx.waitFor(() => ctx.$('#adminShell').hidden === false);
  await ctx.waitFor(() => ctx.$$('#staffList .staff-card').length >= 4);
  owner = await readStaffAccount('admin');
  const result = await createStaff({
    fullName: SECOND_ADMIN.fullName,
    password: SECOND_ADMIN.password,
    confirmPassword: SECOND_ADMIN.password,
    role: 'admin',
    mobile: SECOND_ADMIN.mobile
  });
  assert.equal(result.ok, true, result.error);
  created = result.staff;
});

after(() => ctx?.window?.close?.());

test('Admin is offered in the create form and a second Admin can be created', async () => {
  assert.equal(CREATABLE_STAFF_ROLES.includes('admin'), true,
    'the create form must offer the Admin role');
  assert.equal(STAFF_ROLE_META.admin.protected, true,
    'the role label still marks the System Owner as protected');

  assert.equal(created.role, 'admin');
  assert.equal(created.protected, false, 'a new Admin is an ordinary account, not the owner');
  assert.match(created.username, /\.admin\.apc$/, 'the login id is generated for the Admin role');
  assert.match(created.staffId, /^STF-\d{4}$/);

  // The create modal itself lists it — not only the constant.
  ctx.click(ctx.$('#staffCreateButton'));
  await ctx.waitFor(() => Boolean(ctx.$('#staffForm')));
  const options = [...ctx.$$('#staffField-role option')].map(option => option.value);
  assert.ok(options.includes('admin'), 'the role select offers Admin');
  ctx.click(ctx.$('#staffForm [data-staff-modal="close"]'));
  await ctx.flush();
});

test('the second Admin signs in through the directory as an Admin', async () => {
  const auth = await authenticateDirectoryStaff(created.username, SECOND_ADMIN.password);
  assert.equal(auth.ok, true);
  assert.equal(auth.staff.role, 'admin');
  assert.equal(auth.role, 'admin', 'the system role is what opens admin.html');
  assert.equal(auth.staff.staffId, created.staffId);
});

test('the profile belongs to the Admin who signed in, not to the owner', async () => {
  const signedIn = await saveStaffSession('admin', true, {
    username: created.username,
    staffId: created.staffId,
    fullName: created.fullName
  });
  assert.equal(signedIn, true);
  assert.equal(readActiveStaffIdentity()?.staffId, created.staffId);

  ctx.window.location.hash = 'profile';
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await ctx.waitFor(() => (ctx.$('#adminProfileCard')?.textContent || '').includes(SECOND_ADMIN.fullName));

  const card = ctx.$('#adminProfileCard');
  assert.match(card.textContent, new RegExp(created.username.replace(/\./g, '\\.')),
    'the card shows the signed-in Admin\'s own login id');
  assert.equal(card.textContent.includes(created.staffId), true, 'and their own Staff ID');
  assert.equal(ctx.$('#adminProfileUserId').textContent, created.username);
  assert.equal(ctx.$('#adminProfileName').value, SECOND_ADMIN.fullName);
  const statusRow = [...card.querySelectorAll('.profile-row')]
    .find(row => row.querySelector('dt')?.textContent === 'স্ট্যাটাস');
  assert.equal(/সুরক্ষিত/.test(statusRow?.textContent || ''), false,
    'a directory Admin is not presented as the protected owner');
  if (owner?.fullName && owner.fullName !== SECOND_ADMIN.fullName) {
    assert.equal(card.textContent.includes(owner.fullName), false,
      'the owner\'s identity never leaks into another Admin\'s profile card');
  }
});

test('a directory Admin edits their own record and keeps their login id', async () => {
  const renamed = 'সহকারী প্রধান এডমিন';
  const result = await updateOwnStaffProfile(created.staffId, {
    fullName: renamed,
    mobile: SECOND_ADMIN.mobile,
    email: 'coadmin@example.com'
  });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.staff.fullName, renamed);
  assert.equal(result.staff.username, created.username, 'the login id never moves');
  assert.equal(result.staff.staffId, created.staffId);

  const ownerAfter = await readStaffAccount('admin');
  assert.equal(ownerAfter?.username, owner?.username, 'the owner account is untouched');
  assert.equal(ownerAfter?.fullName, owner?.fullName);

  // The System Owner record itself stays out of reach of this self-service path.
  const denied = await updateOwnStaffProfile('STF-0001', { fullName: 'চেষ্টা', mobile: SECOND_ADMIN.mobile });
  assert.equal(denied.ok, false);
  assert.equal(denied.code, 'PROTECTED');
});

test('the System Owner stays protected while another Admin is an ordinary account', async () => {
  const demote = await updateStaff('STF-0001', { role: 'manager' });
  assert.equal(demote.ok, false);
  const stop = await setStaffStatus('STF-0001', 'inactive');
  assert.equal(stop.ok, false);
  assert.equal(stop.code, 'PROTECTED');
  const remove = await deleteStaff('STF-0001');
  assert.equal(remove.ok, false);
  assert.equal(remove.code, 'PROTECTED');

  // The new Admin can be deactivated — that is what makes it an ordinary account.
  const paused = await setStaffStatus(created.staffId, 'inactive');
  assert.equal(paused.ok, true, paused.error);
  const blocked = await authenticateDirectoryStaff(created.username, SECOND_ADMIN.password);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'INACTIVE');

  const resumed = await setStaffStatus(created.staffId, 'active');
  assert.equal(resumed.ok, true, resumed.error);
  const admins = (await listStaff()).filter(entry => entry.role === 'admin');
  assert.equal(admins.length >= 2, true, 'two Admin records now exist side by side');
  assert.equal(admins.filter(entry => entry.protected).length, 1,
    'exactly one record — the System Owner — is protected');
});
