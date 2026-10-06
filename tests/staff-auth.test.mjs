/* Staff authentication rules for all three roles, in one place.
   Phase 1: no built-in default password, PBKDF2 hashes, first-use setup,
   forced change after migration, and device-bound session tokens. */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  STAFF_ACCOUNTS, STAFF_USERNAMES, normalizeStaffUsername,
  readStaffAccount, authenticateStaff, loadStaffAccount, verifyStaffCredentials,
  provisionStaffAccount, setStaffPassword, changeStaffPassword,
  saveStaffSession, hasStaffSession, clearStaffSession, staffNeedsSetup,
  createInitialAdmin, resolveStaffRoleByUsername, staffAccountRecordExists
} from '../js/staff-auth.js';
import { isPasswordRecord } from '../js/password-hash.js';
import { decryptValue } from '../js/secure-store.js';
import { getDeviceId } from '../js/session.js';
import { createAdminCloud, installAdminCloud, removeAdminCloud, setAdminCloud, setOnline } from './admin-init-cloud.mjs';

const PASSWORD = 'Apc-Test-2026';

/* The one-time Admin Account is the INSTITUTION's, not the device's: creating
   it means asking the cloud (js/admin-initialization.js → sync/sync-core.js)
   and claiming it with one create-only transaction. These tests install a fake
   cloud instead of Firebase — the real engine is covered by
   tests/admin-new-device-login.test.mjs and the two-device harness. */
let adminCloud = null;
let adminHooks = null;
before(() => {
  setOnline(true);
  adminCloud = createAdminCloud();
  adminHooks = installAdminCloud(adminCloud);
});
after(() => { removeAdminCloud(adminHooks); });

function memoryStorage() {
  const map = new Map();
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key),
    _map: map
  };
}

function freshBrowser() {
  globalThis.window = { localStorage: memoryStorage(), sessionStorage: memoryStorage() };
  return window;
}

const ROLES = ['admin', 'manager', 'teacher', 'payment'];
const username = role => STAFF_ACCOUNTS[role].username;
const WRONG = 'ইউজারনেম বা পাসওয়ার্ড সঠিক নয়। আবার চেষ্টা করুন।';

test('the four reserved usernames are fixed and no role carries a password', () => {
  assert.deepEqual([...STAFF_USERNAMES].sort(), ['admin.apc', 'manager.apc', 'payment.apc', 'teacher.apc']);
  for (const role of ROLES) {
    assert.equal(STAFF_ACCOUNTS[role].password, undefined);
    assert.equal(username(role).endsWith('.apc'), true);
  }
  assert.equal(normalizeStaffUsername('  Admin.APC '), 'admin.apc');
});

test('a fresh device needs setup for every role, and setup stores only a hash', async () => {
  const browser = freshBrowser();
  for (const role of ROLES) {
    assert.equal(await staffNeedsSetup(role), true, `${role} must need a first password`);
    const result = await authenticateStaff(role, username(role), 'whatever');
    assert.equal(result.ok, false, 'an unprovisioned account cannot authenticate');
    assert.equal(result.needsSetup, true);
  }
  // Setup each role for real.
  for (const role of ROLES) {
    const provisioned = await provisionStaffAccount(role, PASSWORD, PASSWORD);
    assert.equal(provisioned.ok, true, provisioned.error);
    const raw = browser.localStorage.getItem(STAFF_ACCOUNTS[role].accountKey);
    assert.equal(/"password"/.test(raw), false, `${role} account must not store password text`);
    const account = await readStaffAccount(role);
    assert.equal(account.username, username(role));
    assert.equal(isPasswordRecord(account.password), true);
    const view = await loadStaffAccount(role);
    assert.equal(view.hasPassword, true);
    assert.equal(view.mustChangePassword, false);
    // Now the panel signs in with it.
    assert.deepEqual(await authenticateStaff(role, username(role), PASSWORD), { ok: true, needsPasswordChange: false });
  }
});

test('first Admin creates one complete active owner profile with a unique case-insensitive username', async () => {
  const browser = freshBrowser();
  const profile = { fullName: 'Rahim Ahmed', mobile: '০১৭১১২২৩৩৪৪', email: 'rahim@example.com', username: 'Rahim.Admin.APC', password: PASSWORD, confirmPassword: PASSWORD };
  const created = await createInitialAdmin(profile);
  assert.equal(created.ok, true, created.error);
  assert.deepEqual(created.bootstrapAccounts.map(account => account.role).sort(), ['manager', 'payment', 'teacher']);
  for (const role of ['manager', 'teacher', 'payment']) {
    const bootstrapped = await readStaffAccount(role);
    assert.equal(bootstrapped.status, 'active');
    assert.equal(bootstrapped.mustChangePassword, true);
    assert.equal(isPasswordRecord(bootstrapped.password), true);
  }
  const account = await readStaffAccount('admin');
  assert.equal(account.role, 'admin');
  assert.equal(account.status, 'active');
  assert.equal(account.accountStatus, 'active');
  assert.equal(account.owner, 'first-admin');
  assert.equal(account.fullName, 'Rahim Ahmed');
  assert.equal(account.mobile, '01711223344');
  assert.equal(account.email, 'rahim@example.com');
  assert.equal(account.username, 'rahim.admin.apc');
  assert.ok(Number.isFinite(Date.parse(account.createdAt)));
  assert.equal(isPasswordRecord(account.password), true);
  assert.equal(await resolveStaffRoleByUsername(' RAHIM.ADMIN.APC '), 'admin');
  assert.equal((await createInitialAdmin({ ...profile, username: 'different.admin' })).ok, false, 'first setup must never repeat');
  const rawIndex = JSON.parse(browser.localStorage.getItem('active-plus-usernames-v1'));
  assert.equal(rawIndex['rahim.admin.apc'], 'staff:admin');
});

/* The Login User ID is always generated, so it can never collide: when a
   learner already owns "rahim.admin.apc" the Admin simply gets the next number
   on the FIRST NAME ("rahim2.admin.apc"). A username passed by a caller — even
   in a different case — is ignored. */
test('a generated Login User ID never collides with a learner who claimed the same name', async () => {
  const browser = freshBrowser();
  // A cloud with no Admin yet: this device is genuinely the first use.
  const firstUse = setAdminCloud(createAdminCloud());
  browser.localStorage.setItem('active-plus-usernames-v1', JSON.stringify({ 'rahim.admin.apc': 'student:123' }));
  const result = await createInitialAdmin({ fullName: 'Rahim Ahmed', mobile: '01711223344', username: 'RAHIM.ADMIN.APC', password: PASSWORD, confirmPassword: PASSWORD });
  assert.equal(result.ok, true, result.error);
  const account = await readStaffAccount('admin');
  assert.equal(account.username, 'rahim2.admin.apc');
  // The learner keeps its own claim; nothing is overwritten.
  const rawIndex = JSON.parse(browser.localStorage.getItem('active-plus-usernames-v1'));
  assert.equal(rawIndex['rahim.admin.apc'], 'student:123');
  assert.equal(rawIndex['rahim2.admin.apc'], 'staff:admin');
  assert.equal(await resolveStaffRoleByUsername('RAHIM2.ADMIN.APC'), 'admin');
  // The cloud receives the very same generated id — the learner's claim and the
  // Admin's claim never collide, in the cloud either.
  assert.equal(firstUse.record.username, 'rahim2.admin.apc');
  assert.equal(firstUse.claims, 1);
});

test('wrong usernames are rejected before any password is read', async () => {
  freshBrowser();
  await provisionStaffAccount('admin', PASSWORD, PASSWORD);
  for (const typed of ['', 'admin', 'student.apc', '01711223344', 'admin.apc.evil']) {
    const result = await authenticateStaff('admin', typed, PASSWORD);
    assert.equal(result.ok, false, `"${typed}" must not authenticate`);
    assert.equal(result.error, WRONG);
  }
  // Case and stray spaces are tolerated in the real username.
  assert.deepEqual(await authenticateStaff('admin', '  ADMIN.APC ', PASSWORD), { ok: true, needsPasswordChange: false });
  // The right username with the wrong password is also rejected.
  const bad = await authenticateStaff('admin', username('admin'), 'wrong-password');
  assert.equal(bad.ok, false);
  // An unknown role never authenticates.
  assert.equal((await authenticateStaff('nobody', 'x', 'y')).ok, false);
});

test('verifyStaffCredentials only passes a fully valid, up-to-date account', async () => {
  freshBrowser();
  await provisionStaffAccount('teacher', PASSWORD, PASSWORD);
  assert.equal(await verifyStaffCredentials('teacher', 'teacher.apc', PASSWORD), true);
  assert.equal(await verifyStaffCredentials('teacher', 'Teacher.APC', PASSWORD), true);
  assert.equal(await verifyStaffCredentials('teacher', 'teacher.apc', 'nope'), false);
  assert.equal(await verifyStaffCredentials('admin', 'admin.apc', PASSWORD), false, 'another role is not provisioned');
  assert.equal(await verifyStaffCredentials('nonsense', 'x', 'y'), false);
});

test('a legacy plaintext record verifies once, is hashed away, and forces a change', async () => {
  const browser = freshBrowser();
  const legacy = 'Legacy-Plain-1';
  browser.localStorage.setItem(STAFF_ACCOUNTS.admin.accountKey, JSON.stringify({ username: username('admin'), password: legacy }));
  const view = await loadStaffAccount('admin');
  assert.equal(view.mustChangePassword, true, 'a legacy record is due for a change');
  assert.equal(view.isLegacy, true);

  const wrong = await authenticateStaff('admin', username('admin'), 'not-it');
  assert.equal(wrong.ok, false);

  const first = await authenticateStaff('admin', username('admin'), legacy);
  assert.deepEqual(first, { ok: true, needsPasswordChange: true });
  // The plaintext is gone from storage immediately.
  const raw = browser.localStorage.getItem(STAFF_ACCOUNTS.admin.accountKey);
  assert.equal(raw.includes(legacy), false);
  const stored = await readStaffAccount('admin');
  assert.equal(isPasswordRecord(stored.password), true);
  assert.equal(stored.mustChangePassword, true);
  // Still due for a change, so plain verification refuses.
  assert.equal(await verifyStaffCredentials('admin', username('admin'), legacy), false);
  const changed = await setStaffPassword('admin', PASSWORD, PASSWORD);
  assert.equal(changed.ok, true);
  const after = await readStaffAccount('admin');
  assert.equal(after.mustChangePassword, undefined);
  assert.equal(await verifyStaffCredentials('admin', username('admin'), PASSWORD), true);
  assert.equal(await verifyStaffCredentials('admin', username('admin'), legacy), false);
});

test('password rules are enforced everywhere a password is written', async () => {
  freshBrowser();
  assert.deepEqual(await provisionStaffAccount('admin', '123', '123'), { ok: false, error: 'নতুন পাসওয়ার্ড ৬–৩২ অক্ষরের হতে হবে।' });
  assert.deepEqual(await provisionStaffAccount('admin', PASSWORD, 'mismatch'), { ok: false, error: 'দুইবার লেখা নতুন পাসওয়ার্ড মিলছে না।' });
  assert.equal((await provisionStaffAccount('admin', PASSWORD, PASSWORD)).ok, true);
  // Provisioning again is refused so a set password cannot be silently replaced.
  const again = await provisionStaffAccount('admin', 'Another-1', 'Another-1');
  assert.equal(again.ok, false);
  // changeStaffPassword needs the current password.
  assert.deepEqual(await changeStaffPassword('admin', 'wrong', 'Another-1', 'Another-1'), { ok: false, error: 'বর্তমান পাসওয়ার্ড সঠিক নয়।' });
  assert.deepEqual(await changeStaffPassword('admin', PASSWORD, 'Another-1', 'Another-2'), { ok: false, error: 'দুইবার লেখা নতুন পাসওয়ার্ড মিলছে না।' });
  assert.deepEqual(await changeStaffPassword('admin', PASSWORD, 'Another-1', 'Another-1'), { ok: true, password: 'Another-1' });
  assert.equal(await verifyStaffCredentials('admin', username('admin'), 'Another-1'), true);
  // Unknown roles are refused rather than crashing.
  assert.equal((await provisionStaffAccount('nobody', PASSWORD, PASSWORD)).ok, false);
  assert.equal((await setStaffPassword('nobody', PASSWORD, PASSWORD)).ok, false);
  assert.equal((await changeStaffPassword('nobody', PASSWORD, PASSWORD, PASSWORD)).ok, false);
  assert.equal(await readStaffAccount('nobody'), null);
});

test('sessions are device-bound tokens; remembered and tab sessions differ', async () => {
  const browser = freshBrowser();
  await provisionStaffAccount('admin', PASSWORD, PASSWORD);

  assert.equal(await hasStaffSession('admin'), false);
  assert.equal(await saveStaffSession('admin', true), true);
  assert.equal(await hasStaffSession('admin'), true);
  const envelope = JSON.parse(browser.localStorage.getItem(STAFF_ACCOUNTS.admin.sessionKey));
  const record = JSON.parse(await decryptValue(envelope));
  assert.equal(typeof record.token, 'string');
  assert.equal(record.token.length >= 16, true);
  assert.equal(record.deviceId, getDeviceId());
  assert.equal(record.owner, username('admin'));
  assert.equal(record.expiry > Date.now(), true);
  assert.equal(browser.sessionStorage.getItem(STAFF_ACCOUNTS.admin.sessionKey), null);

  clearStaffSession('admin');
  assert.equal(await hasStaffSession('admin'), false);
  assert.equal(browser.localStorage.getItem(STAFF_ACCOUNTS.admin.sessionKey), null);

  // Not remembered: only a tab marker, which dies with the tab.
  await saveStaffSession('admin', false);
  assert.equal(browser.localStorage.getItem(STAFF_ACCOUNTS.admin.sessionKey), null);
  assert.equal(browser.sessionStorage.getItem(STAFF_ACCOUNTS.admin.sessionKey), '1');
  assert.equal(await hasStaffSession('admin'), true);
  browser.sessionStorage._map.clear();
  assert.equal(await hasStaffSession('admin'), false);
});

test('a session record from another device is dropped, not honoured', async () => {
  const browser = freshBrowser();
  browser.localStorage.setItem(STAFF_ACCOUNTS.admin.sessionKey, JSON.stringify({
    token: 'copied-token', deviceId: 'other-device', owner: username('admin'),
    issuedAt: Date.now(), expiry: Date.now() + 60000
  }));
  assert.equal(await hasStaffSession('admin'), false);
  assert.equal(browser.localStorage.getItem(STAFF_ACCOUNTS.admin.sessionKey), null);
});

test('expired and unreadable sessions count as signed out, and storage errors are safe', async () => {
  const browser = freshBrowser();
  const { buildSessionRecord } = await import('../js/session.js');
  browser.localStorage.setItem(STAFF_ACCOUNTS.admin.sessionKey, JSON.stringify(buildSessionRecord({ owner: username('admin'), ttlDays: -1 })));
  assert.equal(await hasStaffSession('admin'), false);
  browser.localStorage.setItem(STAFF_ACCOUNTS.admin.sessionKey, '{broken');
  assert.equal(await hasStaffSession('admin'), false);

  globalThis.window = {
    get localStorage() { throw new Error('blocked'); },
    get sessionStorage() { throw new Error('blocked'); }
  };
  assert.equal(await hasStaffSession('admin'), false);
  assert.equal(await saveStaffSession('admin', true), false);
  clearStaffSession('admin'); // must not throw
});

test('existing role IDs, not fixed defaults, authenticate; wrong password changes nothing', async () => {
  const { hashPassword } = await import('../js/password-hash.js');
  for (const role of ROLES) {
    const browser = freshBrowser();
    const id = `previous.${role}.apc`;
    const record = JSON.stringify({ username: id, role, fullName: 'Original Name', status: 'active', password: await hashPassword(PASSWORD) });
    browser.localStorage.setItem(STAFF_ACCOUNTS[role].accountKey, record);
    assert.equal(await resolveStaffRoleByUsername(id), role);
    assert.equal((await authenticateStaff(role, id, 'bad')).ok, false);
    assert.equal((await authenticateStaff(role, username(role), PASSWORD)).ok, false);
    assert.equal(browser.localStorage.getItem(STAFF_ACCOUNTS[role].accountKey), record);
    assert.equal((await authenticateStaff(role, id.toUpperCase(), PASSWORD)).ok, true);
  }
});

test('plaintext upgrade preserves the existing Admin ID and all profile fields', async () => {
  const browser = freshBrowser();
  const profile = { username: 'original.admin.apc', fullName: 'Original Owner', staffId: 'STF-0098', role: 'admin', mobile: '01712345678', createdAt: '2024-01-01', password: 'Old-Password' };
  browser.localStorage.setItem(STAFF_ACCOUNTS.admin.accountKey, JSON.stringify(profile));
  assert.deepEqual(await authenticateStaff('admin', profile.username, profile.password), {ok:true, needsPasswordChange:true});
  const migrated = await readStaffAccount('admin');
  for (const [key,value] of Object.entries(profile)) if (key !== 'password') assert.equal(migrated[key],value,key);
  assert.equal(isPasswordRecord(migrated.password),true);
  await setStaffPassword('admin', PASSWORD, PASSWORD);
  assert.equal(await verifyStaffCredentials('admin', profile.username, PASSWORD),true);
});

/* The Admin Account is global: once it exists in the cloud, no device may
   create another — not even a device whose localStorage is completely empty. */
test('a device that cannot create an Admin is never allowed to mint a second one', async () => {
  freshBrowser();
  // Another device already created the institution's Admin.
  const taken = setAdminCloud(createAdminCloud({ record: { username: 'owner.admin.apc', password: { algo: 'PBKDF2' } } }));

  const second = await createInitialAdmin({
    fullName: 'Late Owner', mobile: '01711223344',
    password: PASSWORD, confirmPassword: PASSWORD
  });
  assert.equal(second.ok, false);
  assert.equal(second.code, 'ADMIN_EXISTS');
  assert.match(second.error, /PLEASE LOGIN WITH EXISTING ADMIN ACCOUNT/);
  assert.equal(await staffAccountRecordExists('admin'), false, 'nothing was written on this device');
  assert.equal(taken.claims, 0, 'the cloud was never even asked to claim');

  // No verified cloud answer: creation is refused, never guessed from local state.
  setOnline(false);
  const offline = await createInitialAdmin({
    fullName: 'Offline Owner', mobile: '01711223344',
    password: PASSWORD, confirmPassword: PASSWORD
  });
  assert.equal(offline.ok, false);
  assert.equal(offline.code, 'CLOUD_UNVERIFIED');
  assert.equal(await staffAccountRecordExists('admin'), false);
  assert.equal(taken.claims, 0);
  setOnline(true);
});

test('unreadable encrypted staff record cannot become a new setup account', async () => {
  const browser = freshBrowser();
  const original = JSON.stringify({v:1,iv:'bad',data:'bad'});
  browser.localStorage.setItem(STAFF_ACCOUNTS.admin.accountKey, original);
  const result = await authenticateStaff('admin','admin.apc',PASSWORD);
  assert.equal(result.ok,false);assert.equal(result.needsSetup,undefined);
  assert.equal(browser.localStorage.getItem(STAFF_ACCOUNTS.admin.accountKey), original);
});
