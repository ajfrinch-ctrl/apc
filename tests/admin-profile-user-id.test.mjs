/* Admin Profile — the first Admin may edit name, mobile, email and password
   later, but the generated Login User ID and the Staff ID stay locked.

   Drives the real admin.html + js/admin.js + js/staff-auth.js in jsdom:
     • the profile shows the generated id as read-only text
     • name / mobile / email can be updated
     • the Login User ID never changes, not even through a direct API call
     • the permanent Staff ID (STF-0001) is untouched
     • the password can still be changed with the current one
*/
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { seedStaffSession } from './staff-harness.mjs';
import {
  STAFF_ACCOUNTS,
  createInitialAdmin,
  readStaffAccount,
  updateStaffProfile,
  verifyStaffCredentials
} from '../js/staff-auth.js';
import { listStaff } from '../js/staff-directory.js';
import { createAdminCloud, installAdminCloud, removeAdminCloud } from './admin-init-cloud.mjs';

const DEMO_OFF = { 'activePlus.demo.autofill.v1': 'off' };
const PASSWORD = 'Admin-2026';
const NEW_PASSWORD = 'Admin-2027!';

let ctx;

const set = (id, value) => { ctx.$(id).value = value; return ctx.$(id); };

/* The first Admin is created for the institution through the cloud gate; a fake
   cloud boundary (tests/admin-init-cloud.mjs) stands in for Firebase. */
const adminCloud = createAdminCloud();
let adminHooks = null;
before(() => { adminHooks = installAdminCloud(adminCloud); });
after(() => removeAdminCloud(adminHooks));

before(async () => {
  ctx = await loadPage('admin.html', { seed: { ...DEMO_OFF } });
  const created = await createInitialAdmin({
    fullName: 'Rasal Russell Chowdhury',
    mobile: '01711222333',
    email: 'rasal@example.com',
    password: PASSWORD,
    confirmPassword: PASSWORD
  });
  assert.equal(created.ok, true, created.error);
  assert.equal(created.account.username, 'rasal.admin.apc');
  seedStaffSession(ctx.window, 'admin');
  await import('../js/admin.js');
  await ctx.waitFor(() => ctx.$('#adminShell').hidden === false, 20000);
});

after(() => ctx?.window?.close?.());

test('the profile shows the generated Login User ID as locked text, never as an input', async () => {
  ctx.window.location.hash = 'profile';
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await ctx.waitFor(() => ctx.$('#adminProfileUserId')?.textContent?.includes('.apc'), 20000);
  await ctx.flush();
  assert.equal(ctx.$('#adminProfileUserId').tagName, 'DIV');
  assert.equal(ctx.$('#adminProfileUserId').textContent, 'rasal.admin.apc');
  assert.equal(ctx.$('#adminProfileForm input[name="username"]'), null, 'no editable id field on the profile');
  // The form is pre-filled with the stored profile.
  assert.equal(ctx.$('#adminProfileName').value, 'Rasal Russell Chowdhury');
  assert.equal(ctx.$('#adminProfileMobile').value, '01711222333');
  assert.equal(ctx.$('#adminProfileEmail').value, 'rasal@example.com');
});

test('name, mobile and email can be updated — the id and the Staff ID cannot', async () => {
  set('#adminProfileName', 'Rasal Ahmed Chowdhury');
  set('#adminProfileMobile', '01811222333');
  set('#adminProfileEmail', 'rasal.ahmed@example.com');
  ctx.submit(ctx.$('#adminProfileForm'));
  await ctx.waitFor(async () => (await readStaffAccount('admin')).fullName === 'Rasal Ahmed Chowdhury', 20000);
  await ctx.flush();

  const account = await readStaffAccount('admin');
  assert.equal(account.fullName, 'Rasal Ahmed Chowdhury');
  assert.equal(account.mobile, '01811222333');
  assert.equal(account.email, 'rasal.ahmed@example.com');
  // A renamed Admin keeps the id that was generated at creation.
  assert.equal(account.username, 'rasal.admin.apc');
  assert.equal(STAFF_ACCOUNTS.admin.username, 'admin.apc', 'the device role id is untouched');
  // The internal Staff ID is a different, permanent namespace.
  const owner = (await listStaff()).find(entry => entry.role === 'admin');
  assert.equal(owner.staffId, 'STF-0001');
  assert.match(owner.staffId, /^STF-\d{4}$/);
});

test('a direct call cannot rewrite the Login User ID, the role or the Staff ID', async () => {
  const before = await readStaffAccount('admin');
  const attempt = await updateStaffProfile('admin', {
    username: 'hacked.admin.apc',
    role: 'teacher',
    staffId: 'STF-9999'
  });
  assert.equal(attempt.ok, true, 'the editable fields are still saved');
  const after = await readStaffAccount('admin');
  assert.equal(after.username, before.username, 'the Login User ID is locked');
  assert.equal(after.username, 'rasal.admin.apc');
  assert.equal(after.role, 'admin', 'the role is locked');
  assert.equal(after.staffId ?? undefined, before.staffId ?? undefined);
  assert.equal(after.fullName, before.fullName);
});

test('the Admin can still change the password with the current one', async () => {
  set('#adminCurrentPassword', PASSWORD);
  set('#adminNewPassword', NEW_PASSWORD);
  set('#adminConfirmPassword', NEW_PASSWORD);
  ctx.submit(ctx.$('#adminPasswordForm'));
  await ctx.waitFor(async () => await verifyStaffCredentials('admin', 'rasal.admin.apc', NEW_PASSWORD), 20000);
  await ctx.flush();
  assert.equal(await verifyStaffCredentials('admin', 'rasal.admin.apc', NEW_PASSWORD), true);
  assert.equal(await verifyStaffCredentials('admin', 'rasal.admin.apc', PASSWORD), false);
  // The id is still the generated one after the password change.
  assert.equal((await readStaffAccount('admin')).username, 'rasal.admin.apc');
  assert.deepEqual(ctx.jsdomErrors.filter(error => !/navigation/i.test(error)), []);
});
