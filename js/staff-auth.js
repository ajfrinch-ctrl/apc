/* Shared staff logins for admin, teacher and the payment desk.
   Usernames are reserved so a student cannot claim them.

   Security rules (Phase 1):
   • There is no built-in default password. Login requires an existing
     credential; first Admin creation and office provisioning are separate
     flows. A provisioned password (or migrated legacy password) is
     marked must-change and has to be replaced before the panel opens.
   • Passwords are stored only as PBKDF2-HMAC-SHA256 hashes (password-hash.js),
     inside an AES-GCM envelope when the platform allows it (secure-store.js).
     Plaintext passwords are never written to storage.
   • Sessions are random tokens bound to this device id with an expiry
     (session.js); "remember me" keeps the token in localStorage for 90 days,
     otherwise it lives in sessionStorage and dies with the tab. */

import { STAFF_KEYS, KEYS, readJSON, writeJSON } from './database.js';
import {
  adminInitializationStatus, claimFirstAdmin,
  ADMIN_EXISTS_MESSAGE, ADMIN_VERIFY_REQUIRED_MESSAGE, ADMIN_CLAIM_FAILED_MESSAGE
} from './admin-initialization.js';
import { hashPassword, verifyPassword, isPasswordRecord } from './password-hash.js';
import { encryptValue, decryptValue, isEncryptedEnvelope } from './secure-store.js';
import { buildSessionRecord, isSessionRecordValid, DAY_MS } from './session.js';
import { generateLoginId } from './user-id.js';

const REMEMBER_DAYS = 90;
const TAB_SESSION_MARKER = '1';

/* Migration note: a record written by the retired plaintext scheme (a username
   plus a bare password string) is recognised by shape and re-hashed on the
   next successful login. No default password value exists in this file. */
const WRONG_CREDENTIALS = 'ইউজারনেম বা পাসওয়ার্ড সঠিক নয়। আবার চেষ্টা করুন।';
const PASSWORD_RULE = 'নতুন পাসওয়ার্ড ৬–৩২ অক্ষরের হতে হবে।';
const PASSWORD_MISMATCH = 'দুইবার লেখা নতুন পাসওয়ার্ড মিলছে না।';
const PASSWORD_STORE_FAILED = 'পাসওয়ার্ড সংরক্ষণ করা যায়নি — ব্রাউজারের স্টোরেজ পরীক্ষা করুন।';

export const STAFF_ACCOUNTS = Object.freeze({
  admin: {
    role: 'admin',
    username: 'admin.apc',
    accountKey: STAFF_KEYS.adminAccount,
    sessionKey: STAFF_KEYS.adminSession
  },
  manager: {
    role: 'manager',
    username: 'manager.apc',
    accountKey: STAFF_KEYS.managerAccount,
    sessionKey: STAFF_KEYS.managerSession
  },
  teacher: {
    role: 'teacher',
    username: 'teacher.apc',
    accountKey: STAFF_KEYS.teacherAccount,
    sessionKey: STAFF_KEYS.teacherSession
  },
  payment: {
    role: 'payment',
    username: 'payment.apc',
    accountKey: STAFF_KEYS.paymentAccount,
    sessionKey: STAFF_KEYS.paymentSession
  }
});

export const STAFF_USERNAMES = Object.freeze(Object.values(STAFF_ACCOUNTS).map(account => account.username));

/** Every device-local storage key that holds a staff account or session.
 *  Backup & Restore uses the list so nothing staff-owned is left behind. */
export const STAFF_KEYS_LIST = Object.freeze(Object.values(STAFF_ACCOUNTS).flatMap(account => [account.accountKey, account.sessionKey]));

export function normalizeStaffUsername(value) {
  return String(value ?? '').trim().toLowerCase();
}

const INITIAL_ADMIN_USERNAME_KEY = 'activePlus.initialAdminUsername.v1';
const USERNAME_PATTERN = /^[a-z][a-z0-9._]{3,19}$/;
const TEMP_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
function generateTemporaryPassword() {
  const cryptoApi = globalThis.crypto || globalThis.window?.crypto;
  if (!cryptoApi?.getRandomValues) throw new Error('নিরাপদ অটো-জেনারেটেড পাসওয়ার্ড তৈরি করা যাচ্ছে না।');
  const bytes = new Uint8Array(20);
  cryptoApi.getRandomValues(bytes);
  return [...bytes].map(byte => TEMP_PASSWORD_ALPHABET[byte % TEMP_PASSWORD_ALPHABET.length]).join('');
}

function normalizeBdMobile(value) {
  let mobile = String(value ?? '').trim().replace(/[০-৯]/g, digit => '০১২৩৪৫৬৭৮৯'.indexOf(digit));
  mobile = mobile.replace(/[\s()+-]/g, '');
  if (mobile.startsWith('+880')) mobile = `0${mobile.slice(4)}`;
  else if (mobile.startsWith('880')) mobile = `0${mobile.slice(3)}`;
  return mobile;
}

/** The Admin Account already exists — this device may only log in with it. */
const adminExistsResult = () => ({ ok: false, code: 'ADMIN_EXISTS', error: ADMIN_EXISTS_MESSAGE });

/**
 * Create the one and only first-admin profile. Never leaves an incomplete record.
 *
 * The Admin Account belongs to the institution, not to the device that happens
 * to create it: the cloud is the source of truth and `claimFirstAdmin()` is the
 * single atomic step that may create it. A device whose localStorage is empty
 * therefore never concludes "no Admin" — it asks the cloud, and when the cloud
 * cannot be asked, NOTHING is created here. The Login User ID is ALWAYS
 * generated here — "firstname.admin.apc" (js/user-id.js). A username passed by
 * a caller is ignored on purpose: no screen, console call or modified request
 * may pick the owner's login id, and the first-use workflow stays impossible
 * once one Admin exists.
 *
 * Result codes: ok, ADMIN_EXISTS, CLOUD_UNVERIFIED, LOCAL_WRITE_FAILED.
 */
export async function createInitialAdmin({ fullName, mobile, email = '', password, confirmPassword } = {}) {
  if (await readStaffAccount('admin')) return adminExistsResult();
  const name = String(fullName ?? '').trim().replace(/\s+/g, ' ');
  const phone = normalizeBdMobile(mobile);
  const mail = String(email ?? '').trim().toLowerCase();
  if (name.length < 2 || name.length > 100) return { ok: false, error: 'পূর্ণ নাম লিখুন (২–১০০ অক্ষর)।' };
  if (!/^01[3-9]\d{8}$/.test(phone)) return { ok: false, error: 'সঠিক বাংলাদেশি মোবাইল নম্বর লিখুন।' };
  if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return { ok: false, error: 'সঠিক ইমেইল ঠিকানা লিখুন অথবা ফাঁকা রাখুন।' };
  const passwordIssue = passwordProblem(password, confirmPassword);
  if (passwordIssue) return { ok: false, error: passwordIssue };

  const index = readJSON(KEYS.usernames, {}) || {};
  // Auto-generated: first name + role + ".apc", numbered on the first name
  // ("rasal2.admin.apc") when the plain id is already claimed.
  const handle = generateLoginId({
    fullName: name,
    role: 'admin',
    taken: [...Object.keys(index), ...STAFF_USERNAMES]
  });
  if (!USERNAME_PATTERN.test(handle)) return { ok: false, error: 'ইউজারনেম তৈরি করা যায়নি — নাম পরিবর্তন করে আবার চেষ্টা করুন।' };

  const createdAt = new Date().toISOString();
  const account = {
    role: 'admin', status: 'active', owner: 'first-admin',
    fullName: name, mobile: phone, email: mail,
    username: handle, password: await hashPassword(password),
    createdAt, accountStatus: 'active'
  };

  /* 1) Ask the cloud. Only a verified "no Admin account exists anywhere" may
     continue: an unverifiable device (offline, blocked CDN, cloud error) must
     never mint a second Admin account for the institution. */
  const status = await adminInitializationStatus();
  if (!status.ok) return { ok: false, code: 'CLOUD_UNVERIFIED', error: ADMIN_VERIFY_REQUIRED_MESSAGE };
  if (status.initialized) return adminExistsResult();

  /* 2) The one atomic write. Realtime Database runs this on the server, so of
     two fresh devices creating at the same moment exactly one commits; the
     other is told to log in with the Admin account that now exists. */
  const claim = await claimFirstAdmin(account);
  if (!claim.ok) {
    return claim.reason === 'admin-exists'
      ? adminExistsResult()
      : { ok: false, code: 'CLOUD_UNVERIFIED', error: ADMIN_CLAIM_FAILED_MESSAGE };
  }

  /* 3) The institution's Admin Account now exists in the cloud. Make it this
     device's working copy — the SAME record, so local and cloud never drift. */
  const claimed = { ...(readJSON(KEYS.usernames, {}) || {}), [handle]: 'staff:admin' };
  if (!writeJSON(KEYS.usernames, claimed)) return adminCreatedLocallyFailed(handle);
  if (!(await writeStaffAccount('admin', account))) return adminCreatedLocallyFailed(handle);
  if (!writeJSON(INITIAL_ADMIN_USERNAME_KEY, handle)) return adminCreatedLocallyFailed(handle);
  /* The bootstrap role accounts are a convenience; the Admin account itself is
     already safe, so a failure here must never undo it. */
  const bootstrap = await ensureBootstrapStaffAccounts(handle);
  return {
    ok: true,
    account: { ...account, password: undefined },
    bootstrapAccounts: bootstrap.ok ? bootstrap.accounts : []
  };
}

/**
 * The atomic claim succeeded, so the Admin Account exists globally and must not
 * be taken back (the rules forbid deleting a staff account, and other devices
 * may already be using it). Report the local problem honestly: the same User ID
 * and password still sign in here, because login pulls the account back from
 * the cloud on this device.
 */
function adminCreatedLocallyFailed(username) {
  return {
    ok: false,
    code: 'LOCAL_WRITE_FAILED',
    username,
    error: `Admin Account ক্লাউডে তৈরি হয়েছে, কিন্তু এই ডিভাইসে সংরক্ষণ করা যায়নি — ${username} দিয়ে লগইন করুন।`
  };
}

/** Ensure one temporary bootstrap identity exists for each operational staff role. */
export async function ensureBootstrapStaffAccounts(ownerUsername = 'admin.apc') {
  const index = readJSON(KEYS.usernames, {}) || {};
  const pending = [];
  try {
    for (const role of ['manager', 'teacher', 'payment']) {
      if (await readStaffAccount(role)) continue;
      const spec = staffSpec(role);
      const username = normalizeStaffUsername(spec.username);
      if (Object.hasOwn(index, username)) return { ok: false, error: `Bootstrap username ${username} আগেই ব্যবহৃত।` };
      const password = generateTemporaryPassword();
      pending.push({
        role, username, password,
        profile: {
          role, status: 'active', accountStatus: 'active', owner: normalizeStaffUsername(ownerUsername),
          fullName: `প্রাথমিক ${role} অ্যাকাউন্ট`, mobile: '', email: '', username,
          password: await hashPassword(password), mustChangePassword: true,
          createdAt: new Date().toISOString(), bootstrapAccount: true
        }
      });
    }
  } catch { return { ok: false, error: PASSWORD_STORE_FAILED }; }
  if (!pending.length) return { ok: true, accounts: [] };
  // Re-read the registry: hashing above is slow, so writing the snapshot taken
  // at the top of this function would drop a username claimed in the meantime.
  const claimed = { ...(readJSON(KEYS.usernames, {}) || {}) };
  pending.forEach(account => { claimed[account.username] = `staff:${account.role}`; });
  if (!writeJSON(KEYS.usernames, claimed)) return { ok: false, error: PASSWORD_STORE_FAILED };
  const written = [];
  for (const account of pending) {
    if (!(await writeStaffAccount(account.role, account.profile))) {
      written.forEach(role => { try { window.localStorage.removeItem(staffSpec(role).accountKey); } catch {} });
      writeJSON(KEYS.usernames, index);
      return { ok: false, error: PASSWORD_STORE_FAILED };
    }
    written.push(account.role);
  }
  return { ok: true, accounts: pending.map(({ role, username, password }) => ({ role, username, password })) };
}

// Read the identity actually saved on this device, not a newly generated/default ID.
// Older cash-counter records used userId/pin; these aliases are read-only until
// the existing password has been verified and the normal hash upgrade runs.
function storedStaffUsername(account, role) {
  return normalizeStaffUsername(account?.username || (role === 'payment' ? account?.userId : '') || '');
}
function storedStaffPassword(account, role) {
  return account?.password ?? (role === 'payment' && account?.userId ? account.pin : undefined);
}

export async function resolveStaffRoleByUsername(value) {
  const username = normalizeStaffUsername(value);
  if (!username) return null;

  // Resolve against the actual stored account first. This is required for the
  // first Admin, whose username is generated as firstName.admin.apc and is
  // therefore different from the fixed fallback "admin.apc".
  for (const role of Object.keys(STAFF_ACCOUNTS)) {
    const account = await readStaffAccount(role);
    if (!account) continue;
    const storedUsername = storedStaffUsername(account, role);
    if (storedUsername && storedUsername === username && account.status !== 'inactive') {
      return role;
    }
  }

  // Fall back to the reserved role username only for an account that has not
  // yet stored its own username (for example an untouched bootstrap role).
  const fixed = Object.keys(STAFF_ACCOUNTS).find(
    role => normalizeStaffUsername(STAFF_ACCOUNTS[role].username) === username
  );
  return fixed || null;
}

export function staffSpec(role) {
  return STAFF_ACCOUNTS[role] || null;
}

/** The stored record, decrypted when possible. Null when never provisioned. */
export function staffAccountRecordExists(role) {
  const spec = staffSpec(role);
  if (!spec) return false;
  try { return window.localStorage.getItem(spec.accountKey) !== null; } catch { return true; }
}

export async function importCloudStaffAccount(role, account) {
  const spec = staffSpec(role);
  if (!spec || !account?.username || !account?.pinHash) return false;
  const existing = await readStaffAccount(role);
  if (existing?.username && normalizeStaffUsername(existing.username) !== normalizeStaffUsername(account.username)) return false;
  return writeStaffAccount(role, {
    ...(existing || {}),
    uid: account.uid || existing?.uid,
    role,
    username: account.username,
    fullName: account.fullName || existing?.fullName || '',
    mobile: account.mobile || existing?.mobile || '',
    email: account.email || existing?.email || '',
    status: account.status || 'active',
    accountStatus: account.status || 'active',
    pinHash: account.pinHash,
    updatedAt: new Date().toISOString()
  });
}

export async function readStaffAccount(role) {
  const spec = staffSpec(role);
  if (!spec) return null;
  let raw;
  try { raw = readJSON(spec.accountKey); } catch { return null; }
  if (raw === null || raw === undefined) return null;
  if (isEncryptedEnvelope(raw)) {
    const plaintext = await decryptValue(raw);
    if (!plaintext) return null;
    try { return JSON.parse(plaintext); } catch { return null; }
  }
  return raw && typeof raw === 'object' ? raw : null;
}

/** Fields an account holder may edit on their own profile. */
const PROFILE_FIELDS = Object.freeze(['fullName', 'mobile', 'email']);
/** Identity that never changes — not even when the profile form is bypassed. */
const LOCKED_PROFILE_FIELDS = Object.freeze(['role', 'staffId', 'username', 'createdAt', 'owner', 'status']);

/**
 * Update the editable part of a staff account (name, mobile, email).
 *
 * The locked identity is re-applied from the stored record on purpose, so a
 * direct call cannot rewrite the role, the Staff ID or the Login User ID.
 * Returns `{ ok:true, account }` or `{ ok:false, error }`.
 */
export async function updateStaffProfile(role, patch = {}) {
  const current = await readStaffAccount(role);
  if (!current) return { ok: false, error: 'এই রোলের কোনো অ্যাকাউন্ট পাওয়া যায়নি।' };
  const next = { ...current };
  for (const key of PROFILE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    const value = String(patch[key] ?? '').trim();
    if (key === 'mobile') {
      const phone = normalizeBdMobile(value);
      if (!/^01[3-9]\d{8}$/.test(phone)) return { ok: false, error: 'সঠিক বাংলাদেশি মোবাইল নম্বর লিখুন।' };
      next.mobile = phone;
    } else if (key === 'email') {
      const mail = value.toLowerCase();
      if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return { ok: false, error: 'সঠিক ইমেইল ঠিকানা দিন অথবা ফাঁকা রাখুন।' };
      next.email = mail;
    } else {
      const name = value.replace(/\s+/g, ' ');
      if (name.length < 2 || name.length > 100) return { ok: false, error: 'পূর্ণ নাম লিখুন (২–১০০ অক্ষর)।' };
      next.fullName = name;
    }
  }
  for (const key of LOCKED_PROFILE_FIELDS) next[key] = current[key];
  next.updatedAt = new Date().toISOString();
  if (!(await writeStaffAccount(role, next))) return { ok: false, error: 'তথ্য সংরক্ষণ করা যায়নি — স্টোরেজ পরীক্ষা করুন।' };
  return { ok: true, account: next };
}

async function writeStaffAccount(role, account) {
  const spec = staffSpec(role);
  if (!spec || !account) return false;
  try {
    const envelope = await encryptValue(JSON.stringify(account));
    return envelope ? writeJSON(spec.accountKey, envelope) : writeJSON(spec.accountKey, account);
  } catch { return false; }
}

/** True when the role has never set a password on this device. */
export async function staffNeedsSetup(role) {
  const account = await readStaffAccount(role);
  return !account || typeof account.password === 'undefined';
}

/**
 * One call for every login form. Resolves to:
 *  { ok: false, error }                      — wrong username or password
 *  { ok: false, needsSetup: true, error }   — no credential: provisioning required
 *  { ok: true, needsPasswordChange: true }   — verified, but a new password is due
 *  { ok: true }                              — verified and up to date
 * Legacy plaintext records are verified once and immediately re-hashed.
 */
export async function authenticateStaff(role, username, password) {
  const spec = staffSpec(role);
  if (!spec) return { ok: false, error: WRONG_CREDENTIALS };
  const account = await readStaffAccount(role);
  const expectedUsername = storedStaffUsername(account, role) || normalizeStaffUsername(spec.username);
  if (account && ['inactive', 'suspended', 'rejected'].includes(account.status || account.accountStatus)) {
    return { ok: false, error: WRONG_CREDENTIALS };
  }
  if (normalizeStaffUsername(username) !== expectedUsername) {
    return { ok: false, error: WRONG_CREDENTIALS };
  }
  if (!account && staffAccountRecordExists(role)) return { ok: false, error: PASSWORD_STORE_FAILED };
  const credential = storedStaffPassword(account, role);
  if (!account || typeof credential === 'undefined') {
    return { ok: false, needsSetup: true, error: WRONG_CREDENTIALS };
  }
  if (isPasswordRecord(credential)) {
    const valid = await verifyPassword(password, credential);
    if (!valid) return { ok: false, error: WRONG_CREDENTIALS };
    return { ok: true, needsPasswordChange: Boolean(account.mustChangePassword) };
  }
  // Legacy plaintext record: verify, then hash it away on the spot.
  const legacy = String(credential ?? '');
  if (!legacy || String(password ?? '') !== legacy) {
    return { ok: false, error: WRONG_CREDENTIALS };
  }
  const { pin: _oldPin, ...profile } = account;
  const upgraded = await writeStaffAccount(role, {
    ...profile,
    username: account.username || account.userId || spec.username,
    password: await hashPassword(legacy),
    mustChangePassword: true,
    migratedAt: new Date().toISOString()
  });
  if (!upgraded) return { ok: false, error: PASSWORD_STORE_FAILED };
  return { ok: true, needsPasswordChange: true };
}

/** No-plaintext view of a staff account, for UI hints and tests. */
export async function loadStaffAccount(role) {
  const spec = staffSpec(role);
  if (!spec) return null;
  const account = await readStaffAccount(role);
  if (!account) return { username: spec.username, hasPassword: false, mustChangePassword: false, isLegacy: false };
  const isLegacy = typeof account.password === 'string' && !isPasswordRecord(account.password);
  return {
    username: account.username || spec.username,
    fullName: account.fullName || '',
    mobile: account.mobile || '',
    email: account.email || '',
    status: account.status || 'active',
    createdAt: account.createdAt || null,
    hasPassword: typeof account.password !== 'undefined',
    mustChangePassword: isLegacy || Boolean(account.mustChangePassword),
    isLegacy
  };
}

export async function verifyStaffCredentials(role, username, password) {
  const result = await authenticateStaff(role, username, password);
  return result.ok && !result.needsSetup && !result.needsPasswordChange;
}

function passwordProblem(nextPassword, confirmPassword) {
  const password = String(nextPassword ?? '');
  if (password.length < 6 || password.length > 32) return PASSWORD_RULE;
  if (password !== String(confirmPassword ?? '')) return PASSWORD_MISMATCH;
  return '';
}

/** First-use provisioning: only allowed while no password exists. */
export async function provisionStaffAccount(role, nextPassword, confirmPassword) {
  const spec = staffSpec(role);
  if (!spec) return { ok: false, error: 'অজানা ভূমিকা।' };
  const problem = passwordProblem(nextPassword, confirmPassword);
  if (problem) return { ok: false, error: problem };
  if (!(await staffNeedsSetup(role))) {
    return { ok: false, error: 'এই ইউজারনেমের পাসওয়ার্ড আগেই নির্ধারিত হয়েছে। লগইন করুন।' };
  }
  const saved = await writeStaffAccount(role, {
    username: spec.username,
    password: await hashPassword(nextPassword),
    createdAt: new Date().toISOString()
  });
  if (!saved) return { ok: false, error: PASSWORD_STORE_FAILED };
  return { ok: true };
}

/** Replace the password directly (used after verification, or by provisioning). */
export async function setStaffPassword(role, nextPassword, confirmPassword) {
  const spec = staffSpec(role);
  if (!spec) return { ok: false, error: 'অজানা ভূমিকা।' };
  const problem = passwordProblem(nextPassword, confirmPassword);
  if (problem) return { ok: false, error: problem };
  const existing = await readStaffAccount(role);
  const { mustChangePassword: _mustChangePassword, ...profile } = existing || {};
  const saved = await writeStaffAccount(role, {
    ...profile,
    username: existing?.username || spec.username,
    password: await hashPassword(nextPassword),
    updatedAt: new Date().toISOString()
  });
  if (!saved) return { ok: false, error: PASSWORD_STORE_FAILED };
  return { ok: true };
}

/**
 * Mark the stored password as due for a change on the next sign-in.
 * Used when Admin resets a role account's password from Staff Management:
 * the reset credential is temporary until its owner replaces it.
 */
export async function flagStaffPasswordChange(role) {
  const account = await readStaffAccount(role);
  if (!account) return false;
  return writeStaffAccount(role, { ...account, mustChangePassword: true, updatedAt: new Date().toISOString() });
}

/** Change password from inside a panel: the current password must match. */
export async function changeStaffPassword(role, currentPassword, nextPassword, confirmPassword) {
  const spec = staffSpec(role);
  if (!spec) return { ok: false, error: 'অজানা ভূমিকা।' };
  const account = await readStaffAccount(role);
  if (!account || typeof account.password === 'undefined') {
    return { ok: false, error: 'এই ডিভাইসে পাসওয়ার্ড নির্ধারিত হয়নি।' };
  }
  const currentOk = isPasswordRecord(account.password)
    ? await verifyPassword(currentPassword, account.password)
    : String(currentPassword ?? '') === String(account.password ?? '');
  if (!currentOk) return { ok: false, error: 'বর্তমান পাসওয়ার্ড সঠিক নয়।' };
  const problem = passwordProblem(nextPassword, confirmPassword);
  if (problem) return { ok: false, error: problem };
  const existing = await readStaffAccount(role);
  const { mustChangePassword: _mustChangePassword, ...profile } = existing || {};
  const saved = await writeStaffAccount(role, {
    ...profile,
    username: existing?.username || spec.username,
    password: await hashPassword(nextPassword),
    updatedAt: new Date().toISOString()
  });
  if (!saved) return { ok: false, error: PASSWORD_STORE_FAILED };
  return { ok: true, password: String(nextPassword) };
}

/* ---------- Sessions ---------- */

function sessionStores(spec) {
  try {
    return { local: window.localStorage, tab: window.sessionStorage };
  } catch { return { local: null, tab: null }; }
}

/**
 * One device, one panel: signing a role in ends every other staff session on
 * this device. Without it a device could hold an Admin and a Manager session at
 * once, and typing the other portal's address would open it — the exact
 * cross-panel route the panels are supposed to close (js/panel-lockdown.js).
 */
export function clearOtherStaffSessions(role) {
  for (const name of Object.keys(STAFF_ACCOUNTS)) {
    if (name !== role) clearStaffSession(name);
  }
}

/** Every staff role whose device-bound session is still valid right now. */
export async function activeStaffRoles() {
  const roles = Object.keys(STAFF_ACCOUNTS);
  const live = await Promise.all(roles.map(name => hasStaffSession(name)));
  return roles.filter((name, index) => live[index]);
}

export async function saveStaffSession(role, remember = true) {
  const spec = staffSpec(role);
  if (!spec) return false;
  const { local, tab } = sessionStores(spec);
  if (!local || !tab) return false;
  clearOtherStaffSessions(role);
  try {
    local.removeItem(spec.sessionKey);
    tab.removeItem(spec.sessionKey);
    if (remember) {
      const record = buildSessionRecord({ owner: spec.username, ttlDays: REMEMBER_DAYS });
      const envelope = await encryptValue(JSON.stringify(record));
      return envelope
        ? writeJSON(spec.sessionKey, envelope)
        : writeJSON(spec.sessionKey, record);
    }
    // Tab-only session: marker in sessionStorage, token in localStorage is not written.
    tab.setItem(spec.sessionKey, TAB_SESSION_MARKER);
    return true;
  } catch { return false; }
}

async function readStaffSession(role) {
  const spec = staffSpec(role);
  if (!spec) return null;
  const { local, tab } = sessionStores(spec);
  if (!local || !tab) return null;
  try {
    if (tab.getItem(spec.sessionKey) === TAB_SESSION_MARKER) {
      return { tab: true };
    }
    const raw = readJSON(spec.sessionKey);
    if (raw === null) return null;
    if (isEncryptedEnvelope(raw)) {
      const plaintext = await decryptValue(raw);
      if (!plaintext) return null;
      try { return JSON.parse(plaintext); } catch { return null; }
    }
    return raw && typeof raw === 'object' ? raw : null;
  } catch { return null; }
}

export async function hasStaffSession(role) {
  const spec = staffSpec(role);
  if (!spec) return false;
  const { local, tab } = sessionStores(spec);
  const record = await readStaffSession(role);
  if (!record) return false;
  if (record.tab) return true;
  if (isSessionRecordValid(record)) return true;
  try { local?.removeItem(spec.sessionKey); tab?.removeItem(spec.sessionKey); } catch { /* no-op */ }
  return false;
}

/* Logging out never drops anyone on a panel's own entry screen: every role signs
   in on index.html, so that is where a logout returns to. */
export function goToLoginPage() {
  window.location.assign('index.html');
}

export function clearStaffSession(role) {
  const spec = staffSpec(role);
  if (!spec) return;
  try {
    window.localStorage.removeItem(spec.sessionKey);
    window.sessionStorage.removeItem(spec.sessionKey);
  } catch { /* no-op */ }
}

export const STAFF_SESSION_RULES = Object.freeze({ rememberDays: REMEMBER_DAYS, dayMs: DAY_MS });
