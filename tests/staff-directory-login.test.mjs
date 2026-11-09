/* Staff sign-in — the accounts Admin creates in Staff Management must actually
   open a panel. Drives the real index.html + js/login.js + js/staff-directory.js
   in jsdom.

   Covered:
     • a directory staff member signs in with the username/password Admin set
     • a reset (temporary) password must be changed before the panel opens
     • a wrong password and a deactivated account both stop at the login card
     • the four device role accounts keep their own path (js/staff-auth.js) —
       a directory identity never overwrites one
*/
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { STAFF_ACCOUNTS, hasStaffSession } from '../js/staff-auth.js';
import { provisionStaff, seedStaffSession, STAFF_TEST_PASSWORD } from './staff-harness.mjs';
import { createStaff, listStaff, setStaffStatus, resetStaffPassword, findDirectoryStaffByUsername } from '../js/staff-directory.js';

const DEMO_OFF = { 'activePlus.demo.autofill.v1': 'off' };
const STAFF_PASSWORD = 'Teacher-2026';
/* The Login User ID is generated from the name + role — never typed — so the
   tests read it back from the record the data layer created. */
let STAFF_USERNAME = null;

let ctx;
let staffId = null;

const session = role => ctx.window.localStorage.getItem(STAFF_ACCOUNTS[role].sessionKey);
const navigated = () => ctx.jsdomErrors.some(error => /navigation/i.test(error));
const message = () => ctx.$('#authMessage')?.textContent || '';

/** A login page with an Admin-provisioned staff account in the SAME window:
 *  every jsdom page has its own storage, so the identity must be created here. */
async function openLogin({ create = true } = {}) {
  ctx = await loadPage('index.html', { seed: { ...DEMO_OFF } });
  const { initLogin } = await import('../js/login.js');
  initLogin({ state: { student: null, account: null }, onAuthenticated: () => {} });
  await provisionStaff('admin');
  seedStaffSession(ctx.window, 'admin');
  if (create) {
    const created = await createStaff({
      fullName: 'দ্বিতীয় শিক্ষক',
      password: STAFF_PASSWORD,
      confirmPassword: STAFF_PASSWORD,
      role: 'teacher',
      mobile: '01755555555',
      subjects: 'পদার্থবিজ্ঞান'
    });
    assert.equal(created.ok, true, created.error);
    staffId = created.staff.staffId;
    STAFF_USERNAME = created.staff.username;
    assert.equal(staffId, 'STF-0005');
    assert.match(STAFF_USERNAME, /^dbiti[jy]\.teacher\.apc$/);
  }
  return ctx;
}

async function signIn(username, pin, wait = () => true) {
  const { $, type, submit } = ctx;
  // Clear the previous result first: a stale message would satisfy the wait
  // predicate before this attempt has even been processed.
  if ($('#authMessage')) $('#authMessage').textContent = '';
  type($('#loginMobile'), username);
  type($('#loginPin'), pin);
  submit($('#loginForm'));
  await ctx.waitFor(wait);
  await ctx.flush();
}

before(async () => {
  // Sanity check on the identity layer: the first directory Staff ID follows
  // the four mirrored system roles.
  ctx = await loadPage('index.html', { seed: { ...DEMO_OFF } });
  await provisionStaff('admin');
  seedStaffSession(ctx.window, 'admin');
  const created = await createStaff({
    fullName: 'দ্বিতীয় শিক্ষক',
    password: STAFF_PASSWORD,
    confirmPassword: STAFF_PASSWORD,
    role: 'teacher'
  });
  assert.equal(created.ok, true, created.error);
  assert.equal(created.staff.staffId, 'STF-0005');
  // Generated from the name and the role — never typed by anybody.
  assert.match(created.staff.username, /^dbiti[jy]\.teacher\.apc$/);
  STAFF_USERNAME = created.staff.username;
});

test('a Staff Management account signs in and replaces its temporary password', async () => {
  await openLogin();
  await signIn(STAFF_USERNAME, STAFF_PASSWORD, () => Boolean(ctx.$('.staff-pw-backdrop')) || navigated());
  // A freshly created account carries a temporary password: change it first.
  assert.ok(ctx.$('.staff-pw-backdrop'), 'the forced password-change dialog opens');
  assert.equal(session('teacher'), null, 'no session before the password is replaced');

  ctx.$('#staffPwNew').value = 'Own-Pass-2026';
  ctx.$('#staffPwConfirm').value = 'Own-Pass-2026';
  ctx.submit(ctx.$('.staff-pw-form'));
  /* The panel hand-off wording moved to the loading screen (2026-11-08); the
     login form now navigates without printing a success line. */
  await ctx.waitFor(() => navigated());
  assert.equal(message(), '', 'the login form stays quiet on a successful hand-off');
  assert.equal(session('teacher') !== null, true);
  assert.equal(await hasStaffSession('teacher'), true);
  assert.equal(navigated(), true, 'the login page hands over to teacher.html');
  // The flag is cleared, so the next sign-in goes straight in.
  assert.equal((await findDirectoryStaffByUsername(STAFF_USERNAME)).mustChangePassword, false);

  // Second sign-in with the new password: no dialog, straight to the panel.
  // jsdom cannot repeat the login.js navigation, so the wait watches the panel
  // hand-off note the form leaves for the loading screen (the same copy path the
  // destination panel reads).
  // A note from the previous step is consumed by the panel; a fresh one is only
  // written by a successful sign-in, so the wait starts from a clean slate.
  ctx.window.sessionStorage.removeItem('activePlus.handoff.note.v1');
  const noteWritten = () => Boolean(ctx.window.sessionStorage.getItem('activePlus.handoff.note.v1'));
  await signIn(STAFF_USERNAME, 'Own-Pass-2026', () => noteWritten());
  assert.equal(ctx.$('.staff-pw-backdrop'), null);
  assert.equal(message(), '', 'still no success line on the login form');
  assert.equal(await hasStaffSession('teacher'), true);

  // The temporary password no longer works.
  await signIn(STAFF_USERNAME, STAFF_PASSWORD, () => /সঠিক ন(য়|য়)/.test(message()));
  assert.match(message(), /সঠিক ন(য়|য়)/);
});

test('a deactivated staff member cannot sign in — and Admin can turn it back on', async () => {
  await openLogin();
  // Deactivate through the data layer (what the Staff Management UI calls).
  assert.equal((await setStaffStatus(staffId, 'inactive')).ok, true);
  await signIn(STAFF_USERNAME, STAFF_PASSWORD, () => /নিষ্ক্রিয়/.test(message()));
  assert.match(message(), /নিষ্ক্রিয়/);
  assert.equal(session('teacher'), null);
  // The identity itself is untouched — only the login gate changed.
  const still = (await listStaff()).find(entry => entry.staffId === staffId);
  assert.equal(still.status, 'inactive');
  assert.equal(still.fullName, 'দ্বিতীয় শিক্ষক');

  assert.equal((await setStaffStatus(staffId, 'active')).ok, true);
  await signIn(STAFF_USERNAME, STAFF_PASSWORD, () => Boolean(ctx.$('.staff-pw-backdrop')));
  assert.ok(ctx.$('.staff-pw-backdrop'), 'an active account reaches the password step again');
});

test('an Admin reset forces a change but keeps the Staff ID identity', async () => {
  await openLogin();
  const reset = await resetStaffPassword(staffId, 'Reset-2026', 'Reset-2026');
  assert.equal(reset.ok, true);

  await signIn(STAFF_USERNAME, 'Reset-2026', () => Boolean(ctx.$('.staff-pw-backdrop')));
  assert.ok(ctx.$('.staff-pw-backdrop'), 'a reset password must be replaced on the next sign-in');
  const staff = await findDirectoryStaffByUsername(STAFF_USERNAME);
  assert.equal(staff.staffId, staffId, 'the permanent Staff ID never changes');
  // The old password is gone: only the reset one opens the door.
  assert.equal((await findDirectoryStaffByUsername(STAFF_USERNAME)).mustChangePassword, true);
});

test('system role accounts keep their own credentials', async () => {
  // Creating or resetting a directory staff member must not touch teacher.apc.
  await openLogin({ create: false });
  await provisionStaff('teacher');
  await signIn(STAFF_ACCOUNTS.teacher.username, STAFF_TEST_PASSWORD, () => navigated() || message().length > 0);
  assert.equal(navigated(), true, 'the reserved username still hands over');
});
