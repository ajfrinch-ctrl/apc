import { LEGACY_CLOUD_ENABLED, CLOUD_PAUSED_MESSAGE, cloudPausedResult, backendMode } from '../sync/cloud-access.js';
import { defaultStudent } from './config.js';
import { $, $$, setAuthMessage, scrollToTop, toBanglaNumber } from './ui.js';
import { contactNumber, normalizeUsername } from './account-policy.js';
import { matchesLoginIdentifier, studentIdOf } from './sync-merge.js';
import {
  loadAccount,
  listLocalAccounts,
  saveAccount,
  saveStudent,
  persistSession,
  setTrustedDevice,
  loadAppConfig,
  verifyAccountPassword,
  upgradeAccountSecrets,
  writeJSON
} from './storage.js';
import {
  STAFF_ACCOUNTS, STAFF_USERNAMES, normalizeStaffUsername, authenticateStaff,
  saveStaffSession, hasStaffSession, resolveStaffRoleByUsername, createInitialAdmin,
  staffAccountRecordExists, clearOrphanedLocalAdmin, activeStaffRoles
} from './staff-auth.js';
import { KEYS, readJSON } from './database.js';
import { generateLoginId } from './user-id.js';
import { isPasswordRecord } from './password-hash.js';

const STAFF_PANEL = Object.freeze({ admin: 'admin.html', manager: 'manager.html', teacher: 'teacher.html', payment: 'payment.html' });
const STAFF_LABEL = Object.freeze({ admin: 'এডমিন প্যানেল', manager: 'ম্যানেজার প্যানেল', teacher: 'শিক্ষক প্যানেল', payment: 'পেমেন্ট রিসিভ প্যানেল' });

export const PENDING_LOGIN_MESSAGE = 'আপনার অ্যাকাউন্ট অনুমোদনের অপেক্ষায় আছে।';
export const REJECTED_LOGIN_MESSAGE = 'আপনার রেজিস্ট্রেশন আবেদনটি বাতিল করা হয়েছে। অফিসে যোগাযোগ করুন।';
export const INACTIVE_LOGIN_MESSAGE = 'আপনার অ্যাকাউন্টটি বর্তমানে নিষ্ক্রিয় আছে। অফিসে যোগাযোগ করুন।';
export const LOGIN_LOCKOUT_KEY = 'activePlus.loginLockout.v1';
export const MAX_LOGIN_ATTEMPTS = 5;
export const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

function lockoutBucketKey(identifier) {
  const ascii = String(identifier ?? '')
    .trim()
    .replace(/[০-৯]/g, d => String('০১২৩৪৫৬৭৮৯'.indexOf(d)));
  return contactNumber(ascii) || normalizeUsername(ascii) || '__device__';
}

function readLockoutMap() {
  const map = readJSON(LOGIN_LOCKOUT_KEY, {}) || {};
  return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
}

export function checkLoginLockout(identifier, now = Date.now()) {
  const key = lockoutBucketKey(identifier);
  const entry = readLockoutMap()[key];
  if (!entry || typeof entry !== 'object') return { locked: false, attempts: 0, remainingMs: 0 };
  const lockedUntil = Number(entry.lockedUntil) || 0;
  if (lockedUntil > now) {
    const remainingMs = lockedUntil - now;
    const mins = Math.max(1, Math.ceil(remainingMs / 60000));
    return {
      locked: true,
      attempts: Number(entry.attempts) || MAX_LOGIN_ATTEMPTS,
      remainingMs,
      lockedUntil,
      message: `অনেকবার ভুল পাসওয়ার্ড দেওয়া হয়েছে। নিরাপত্তার স্বার্থে ${toBanglaNumber(mins)} মিনিট পর আবার চেষ্টা করুন।`
    };
  }
  return { locked: false, attempts: 0, remainingMs: 0 };
}

export function recordFailedLoginAttempt(identifier, now = Date.now()) {
  const key = lockoutBucketKey(identifier);
  const map = { ...readLockoutMap() };
  const prev = map[key] && typeof map[key] === 'object' ? map[key] : { attempts: 0, lockedUntil: 0 };
  const baseAttempts = Number(prev.lockedUntil) > 0 && Number(prev.lockedUntil) <= now ? 0 : (Number(prev.attempts) || 0);
  const attempts = baseAttempts + 1;
  if (attempts >= MAX_LOGIN_ATTEMPTS) {
    const lockedUntil = now + LOGIN_LOCKOUT_MS;
    map[key] = { attempts, lockedUntil, lastFailedAt: now };
    writeJSON(LOGIN_LOCKOUT_KEY, map);
    return {
      locked: true,
      attempts,
      lockedUntil,
      message: '৫ বার ভুল পাসওয়ার্ড দেওয়ায় আপনার লগইন ১৫ মিনিটের জন্য সাময়িকভাবে লক করা হয়েছে। ১৫ মিনিট পর আবার চেষ্টা করুন।'
    };
  }
  map[key] = { attempts, lockedUntil: 0, lastFailedAt: now };
  writeJSON(LOGIN_LOCKOUT_KEY, map);
  return { locked: false, attempts, lockedUntil: 0, message: '' };
}

export function clearLoginLockout(identifier) {
  const key = lockoutBucketKey(identifier);
  const map = { ...readLockoutMap() };
  if (!Object.hasOwn(map, key)) return;
  delete map[key];
  writeJSON(LOGIN_LOCKOUT_KEY, map);
}

export function staffRoleFor(value) {
  const typed = normalizeStaffUsername(value);
  if (!typed) return null;
  return Object.keys(STAFF_ACCOUNTS).find(role => STAFF_ACCOUNTS[role].username === typed) || null;
}

export function staffPanelPath(role) {
  return STAFF_PANEL[role] || '';
}

export function switchAuthTab(tab) {
  $$('[data-auth-tab]').forEach(trigger => {
    if (!trigger.classList.contains('auth-tab')) return;
    const active = trigger.dataset.authTab === tab;
    trigger.classList.toggle('active', active);
    trigger.setAttribute('aria-selected', String(active));
  });
  $$('[data-auth-panel]').forEach(panel => {
    const active = panel.dataset.authPanel === tab;
    panel.classList.toggle('active', active);
    panel.hidden = !active;
  });
  setAuthMessage('');
  scrollToTop();
}

function staffRolePanelOf(staff) {
  const role = staff?.role;
  if (role === 'manager') return 'manager';
  if (role === 'teacher') return 'teacher';
  if (role === 'cash-counter') return 'payment';
  if (role === 'admin') return 'admin';
  return null; // "other" staff have no panel of their own yet
}

async function enterStaffPanel(role, remember, identity = null) {
  const previous = (await activeStaffRoles()).filter(name => name !== role);
  if (!(await saveStaffSession(role, remember, identity))) {
    setAuthMessage('সেশন সংরক্ষণ করা যায়নি — ব্রাউজারের স্টোরেজ পরীক্ষা করে আবার চেষ্টা করুন।');
    return;
  }
  const switched = previous.length
    ? ` — এই ডিভাইসের আগের ${STAFF_LABEL[previous[0]] || 'প্যানেল'} সেশনটি বন্ধ হয়েছে`
    : '';
  setAuthMessage(`${STAFF_LABEL[role]}ে নেওয়া হচ্ছে…${switched}`, 'success');
  window.location.replace(staffPanelPath(role));
}

async function handleStaffLogin(role, typedId, pin) {
  const result = await authenticateStaff(role, typedId, pin);
  if (result.needsSetup) {
    // A login must match an existing credential. Unknown reserved IDs must
    // never become a password-provisioning shortcut into a staff panel.
    setAuthMessage('এই স্টাফ অ্যাকাউন্টের পাসওয়ার্ড নির্ধারিত নেই। এডমিনের সাথে যোগাযোগ করুন।');
    return;
  }
  if (!result.ok) {
    const lock = recordFailedLoginAttempt(typedId);
    setAuthMessage(lock.locked ? lock.message : `${STAFF_LABEL[role]}ের ইউজারনেম বা পাসওয়ার্ড সঠিক নয়। আবার চেষ্টা করুন।`);
    return;
  }
  clearLoginLockout(typedId);
  if (role === 'teacher' && loadAppConfig().allowTeacherRegistration === false) {
    setAuthMessage('শিক্ষক প্যানেল প্রবেশ এই মুহূর্তে এডমিন কর্তৃক বন্ধ রাখা হয়েছে।');
    return;
  }
  const remember = $('#rememberMe')?.checked !== false;
  const identity = { username: normalizeStaffUsername(typedId), staffId: '', fullName: '' };
  if (result.needsPasswordChange) {
    const { openStaffPasswordDialog } = await import('./staff-password-dialog.js');
    openStaffPasswordDialog({
      role,
      mode: 'change',
      onDone: () => enterStaffPanel(role, remember, identity),
      onCancel: () => setAuthMessage('নিরাপত্তার জন্য নতুন পাসওয়ার্ড নির্ধারণ করা বাধ্যতামূলক।')
    });
    return;
  }
  // The staff panel boots cloud sync itself (js/realtime-sync-entry.js).
  await enterStaffPanel(role, remember, identity);
}

async function handleDirectoryStaffLogin(directory, remember) {
  const { staff, mustChangePassword } = directory;
  const role = staffRolePanelOf(staff);
  if (!role) {
    setAuthMessage('এই স্টাফ অ্যাকাউন্টের জন্য এই ডিভাইসে কোনো প্যানেল নির্ধারিত নয়।');
    return;
  }
  if (role === 'teacher' && loadAppConfig().allowTeacherRegistration === false) {
    setAuthMessage('শিক্ষক প্যানেল প্রবেশ এই মুহূর্তে এডমিন কর্তৃক বন্ধ রাখা হয়েছে।');
    return;
  }
  const identity = {
    username: normalizeStaffUsername(staff.username),
    staffId: String(staff.staffId || ''),
    fullName: String(staff.fullName || '')
  };
  if (mustChangePassword) {
    const { openStaffPasswordDialog } = await import('./staff-password-dialog.js');
    openStaffPasswordDialog({
      role,
      mode: 'change',
      onSubmit: async (next, confirm) => (await import('./staff-directory.js')).changeDirectoryStaffPassword(staff.staffId, $('#loginPin').value, next, confirm),
      onDone: () => enterStaffPanel(role, remember, identity),
      onCancel: () => setAuthMessage('নিরাপত্তার জন্য নতুন পাসওয়ার্ড নির্ধারণ করা বাধ্যতামূলক।')
    });
    return;
  }
  await enterStaffPanel(role, remember, identity);
}

const ONLINE_BRIDGE_BUDGET_MS = 2500;
const LOGIN_BRIDGE_IMPORT_MS = 15000;
const LOGIN_IDENTITY_BUDGET_MS = 25000;
function withinBudget(promise, what, budget = ONLINE_BRIDGE_BUDGET_MS) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} timed out`)), budget);
    })
  ]).finally(() => clearTimeout(timer));
}

async function hydrateStaffAccountsOnline(what, budget = ONLINE_BRIDGE_BUDGET_MS) {
  if (!LEGACY_CLOUD_ENABLED) return cloudPausedResult();
  if (!navigator.onLine) return;
  try {
    const bridge = await withinBudget(import('../sync/sync-core.js?v=20260929-protected'), 'online bridge import', budget);
    await withinBudget(bridge.hydrateStaffAccounts({ preserveLocalAdmin: staffAccountRecordExists('admin') }), 'online bridge hydrate', budget);
  } catch (error) {
    console.warn(`[Active Plus] staff account sync unavailable during ${what}:`, error.message);
  }
}

async function loadSyncBridge(budget = LOGIN_BRIDGE_IMPORT_MS) {
  return withinBudget(import('../sync/sync-core.js?v=20260929-protected'), 'online identity import', budget);
}

function warmCloudBridge() {
  if (!LEGACY_CLOUD_ENABLED || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
  void import('../sync/sync-core.js?v=20260929-protected').catch(() => {});
}

async function hydrateUserIdentifiersOnline(what, identifier = '', password = '', budget = LOGIN_IDENTITY_BUDGET_MS) {
  if (!LEGACY_CLOUD_ENABLED) return cloudPausedResult();
  if (!navigator.onLine) return false;
  const run = async () => {
    const bridge = await loadSyncBridge();
    return withinBudget(bridge.hydrateUserIdentifiers({ identifier, password }), 'online identity hydrate', budget);
  };
  try {
    return await run();
  } catch (error) {
    console.warn(`[Active Plus] user id sync unavailable during ${what}:`, error.message);
    try {
      return await run();
    } catch (retryError) {
      console.warn(`[Active Plus] user id sync retry failed during ${what}:`, retryError.message);
      return false;
    }
  }
}

function isOwnIdentifier(account, identifier) {
  if (matchesLoginIdentifier(account, identifier)) return true;
  const typed = normalizeUsername(identifier);
  const id = studentIdOf(account);
  return /^s\d{6}/.test(typed) && Boolean(id) && id.startsWith(typed);
}

async function runBackgroundLoginSync() {
  if (!LEGACY_CLOUD_ENABLED || !navigator.onLine) return;
  // Sync is deliberately fire-and-forget from the authentication path.
  // A slow/failed cloud bridge must never mutate or gate the login form.
  try {
    const bridge = await import('../sync/sync-core.js?v=20260929-protected');
    void bridge.startRealtimeSync().catch(error => {
      console.warn('[Active Plus] background login sync unavailable:', error?.message || error);
    });
  } catch (error) {
    console.warn('[Active Plus] background login sync bridge unavailable:', error?.message || error);
  }
}

function findLocalStudentAccount(identifier, fallbackAccount = null) {
  const all = listLocalAccounts();
  if (fallbackAccount && !all.includes(fallbackAccount)) all.push(fallbackAccount);
  return all.find(acc => isOwnIdentifier(acc, identifier)) || null;
}

async function admitVerifiedStudent({ matchedAccount, typedId, pin, remember, attemptId, state, onAuthenticated }) {
  if (attemptId !== loginAttemptId) return true;
  clearLoginLockout(typedId);
  let activeAccount = matchedAccount;
  if (!isPasswordRecord(activeAccount.pinHash)) {
    activeAccount = await upgradeAccountSecrets(activeAccount, { pin }) || activeAccount;
  }

  const svc = await import('./registration-service.js');
  const effectiveStatus = await svc.resolveStudentLoginStatus(activeAccount, ONLINE_BRIDGE_BUDGET_MS);
  if (attemptId !== loginAttemptId) return true;

  if (effectiveStatus === 'pending' || !effectiveStatus) {
    setAuthMessage(PENDING_LOGIN_MESSAGE);
    return true;
  }
  if (effectiveStatus === 'rejected') {
    const latest = findLocalStudentAccount(typedId, loadAccount()) || activeAccount;
    const reason = String(latest?.reviewNote || latest?.student?.reviewNote || '').trim();
    setAuthMessage(reason ? `আপনার রেজিস্ট্রেশন আবেদনটি বাতিল করা হয়েছে। কারণ: ${reason}` : REJECTED_LOGIN_MESSAGE);
    return true;
  }
  if (effectiveStatus === 'inactive') {
    setAuthMessage(INACTIVE_LOGIN_MESSAGE);
    return true;
  }

  activeAccount = { ...activeAccount, status: 'active' };
  await saveAccount(activeAccount);
  state.account = loadAccount() || activeAccount;
  state.student = { ...defaultStudent, ...(state.account.student || {}) };
  saveStudent(state.student);
  if (!(await persistSession(remember))) {
    setAuthMessage('সেশন সংরক্ষণ করা যায়নি — স্টোরেজ পরীক্ষা করে আবার চেষ্টা করুন।');
    return true;
  }
  if (remember) setTrustedDevice(true);

  window.dispatchEvent(new Event('apc-student-login'));
  onAuthenticated?.();
  void runBackgroundLoginSync();
  return true;
}

let loginAttemptId = 0;

async function handleLogin(event, state, onAuthenticated) {
  event.preventDefault();
  if (backendMode() === 'firebase') {
    setAuthMessage('Firebase প্যানেল বন্ধ। লোকাল মোড: ?backend=local');
    return;
  }

  // IMPORTANT: take an immutable credential snapshot before ANY async work.
  // From this point onward authentication never reads the login inputs again.
  const form = event.currentTarget;
  const loginMobile = form.querySelector('#loginMobile') || $('#loginMobile');
  const loginPin = form.querySelector('#loginPin') || $('#loginPin');
  const typedId = String(loginMobile?.value || '').trim();
  const pin = String(loginPin?.value || '');
  const attemptId = ++loginAttemptId;

  if ((!normalizeUsername(typedId) && !contactNumber(typedId)) || pin.length < 4) {
    setAuthMessage('ইউজারনেম, মোবাইল নম্বর বা শিক্ষার্থীর আইডি এবং ৪–৬ সংখ্যার পাসওয়ার্ড সঠিকভাবে দিন।');
    return;
  }

  const lockout = checkLoginLockout(typedId);
  if (lockout.locked) {
    setAuthMessage(lockout.message);
    return;
  }

  // Never let a sync operation own the login UI. Local authentication is always
  // attempted first, even while the background bridge is connecting.
  const remember = $('#rememberMe')?.checked !== false;

  // 1) Fixed staff accounts — local first.
  const staffRole = await resolveStaffRoleByUsername(typedId);
  if (attemptId !== loginAttemptId) return;
  if (staffRole && staffAccountRecordExists(staffRole)) {
    await handleStaffLogin(staffRole, typedId, pin);
    return;
  }

  // 2) Staff Directory — local first. This does not require Firebase.
  const { authenticateDirectoryStaff } = await import('./staff-directory.js');
  const directory = await authenticateDirectoryStaff(typedId, pin);
  if (attemptId !== loginAttemptId) return;
  if (directory.ok) {
    clearLoginLockout(typedId);
    await handleDirectoryStaffLogin(directory, remember);
    return;
  }
  if (directory.code === 'INACTIVE') {
    setAuthMessage(directory.error || 'এই স্টাফ অ্যাকাউন্টটি নিষ্ক্রিয়।');
    return;
  }
  if (directory.code === 'WRONG_PASSWORD') {
    const lock = recordFailedLoginAttempt(typedId);
    setAuthMessage(lock.locked ? lock.message : 'স্টাফ ইউজারনেম বা পাসওয়ার্ড সঠিক নয়। আবার চেষ্টা করুন।');
    return;
  }

  // 3) Student account — local first (checks both active account and multi-student vault).
  const localMatch = findLocalStudentAccount(typedId, state.account);
  if (localMatch) {
    if (!(await verifyAccountPassword(localMatch, pin))) {
      const lock = recordFailedLoginAttempt(typedId);
      setAuthMessage(lock.locked ? lock.message : 'ইউজারনেম/মোবাইল নম্বর অথবা পাসওয়ার্ড সঠিক নয়।');
      return;
    }
    await admitVerifiedStudent({ matchedAccount: localMatch, typedId, pin, remember, attemptId, state, onAuthenticated });
    return;
  }

  // 4) No usable local account: ONLY NOW do a short, isolated cloud lookup.
  // The snapshot above is the sole credential source; DOM values are never
  // reread while Firebase is running.
  const onlineIdentities = {
    attempted: false,
    synced: true,
    cloudPasswordMismatch: false,
    ambiguous: false,
    cloudAccounts: null,
    similar: []
  };

  if (navigator.onLine && typedId && attemptId === loginAttemptId) {
    onlineIdentities.attempted = true;
    const identities = await hydrateUserIdentifiersOnline(
      'login',
      typedId,
      pin,
      LOGIN_IDENTITY_BUDGET_MS
    );

    if (attemptId !== loginAttemptId) return;
    onlineIdentities.synced = Boolean(identities?.ok);
    onlineIdentities.cloudPasswordMismatch =
      Boolean(identities?.found && identities?.credentialMismatch);
    onlineIdentities.ambiguous = Boolean(identities?.ambiguous);
    onlineIdentities.cloudAccounts = identities?.cloudAccounts ?? null;
    onlineIdentities.similar = Array.isArray(identities?.similar)
      ? identities.similar
      : [];

    // A verified cloud student account may now have been safely hydrated.
    const cloudMatch = findLocalStudentAccount(typedId, loadAccount() || state.account);
    if (cloudMatch && await verifyAccountPassword(cloudMatch, pin)) {
      await admitVerifiedStudent({ matchedAccount: cloudMatch, typedId, pin, remember, attemptId, state, onAuthenticated });
      return;
    }

    if (onlineIdentities.cloudPasswordMismatch || onlineIdentities.ambiguous) {
      if (onlineIdentities.cloudPasswordMismatch) {
        const lock = recordFailedLoginAttempt(typedId);
        if (lock.locked) {
          setAuthMessage(lock.message);
          return;
        }
      }
      setAuthMessage(onlineIdentities.ambiguous
        ? 'এই সংক্ষিপ্ত শিক্ষার্থীর আইডি দিয়ে একাধিক শিক্ষার্থী পাওয়া গেছে — সম্পূর্ণ শিক্ষার্থীর আইডি লিখুন।'
        : 'ইউজারনেম, মোবাইল নম্বর বা শিক্ষার্থীর আইডি অথবা পাসওয়ার্ড সঠিক নয়।');
      return;
    }

    // Fixed-role records may only exist on another device. Do not depend on
    // the first-use form's background hydration having finished already.
    await hydrateStaffAccountsOnline('login', LOGIN_IDENTITY_BUDGET_MS);
    if (attemptId !== loginAttemptId) return;
    const cloudRole = await resolveStaffRoleByUsername(typedId);
    if (cloudRole) {
      await handleStaffLogin(cloudRole, typedId, pin);
      return;
    }

    // Cloud Directory may have hydrated a staff identity.
    const { authenticateDirectoryStaff } = await import('./staff-directory.js');
    const cloudDirectory = await authenticateDirectoryStaff(typedId, pin);
    if (attemptId !== loginAttemptId) return;
    if (cloudDirectory.ok) {
      clearLoginLockout(typedId);
      await handleDirectoryStaffLogin(cloudDirectory, remember);
      return;
    }
  }

  // Do not clear or reset the login form on any failure.
  // A missing account gets one short message by owner decision: no cloud
  // census, no similar-name guesses and no cross-device sync instructions.
  // Genuinely different failures (a wrong password, an ambiguous short ID,
  // a cloud that could not be checked at all) keep their own messages.
  if (onlineIdentities.ambiguous) {
    setAuthMessage('এই সংক্ষিপ্ত শিক্ষার্থীর আইডি দিয়ে একাধিক শিক্ষার্থী পাওয়া গেছে — সম্পূর্ণ শিক্ষার্থীর আইডি লিখুন।');
  } else if (onlineIdentities.cloudPasswordMismatch) {
    setAuthMessage('ইউজারনেম, মোবাইল নম্বর বা শিক্ষার্থীর আইডি অথবা পাসওয়ার্ড সঠিক নয়।');
  } else if (onlineIdentities.attempted && !onlineIdentities.synced) {
    setAuthMessage(!LEGACY_CLOUD_ENABLED ? CLOUD_PAUSED_MESSAGE : 'ক্লাউড থেকে অ্যাকাউন্ট আনা যায়নি। ইন্টারনেট ও Firebase সিঙ্ক পরীক্ষা করে আবার লগইন করুন। আগে অ্যাকাউন্ট তৈরি করে থাকলে নতুন করে রেজিস্ট্রেশন করবেন না।');
  } else {
    setAuthMessage('অ্যাকাউন্ট পাওয়া যায়নি।');
  }
}

export function initLogin({ state, onAuthenticated }) {
  $$('[data-auth-tab]').forEach(trigger => trigger.addEventListener('click', () => {
    if (trigger.dataset.authTab === 'first-admin') void openFirstAdminSetup();
    else switchAuthTab(trigger.dataset.authTab);
  }));
  $('#switchToRegister')?.addEventListener('click', () => $('.auth-tab[data-auth-tab="register"]')?.click());
  const form = $('#loginForm');
  let submitting = false;
  form?.addEventListener('submit', async event => {
    // Prevent native GET submission synchronously, even if async auth throws.
    event.preventDefault();
    if (submitting) return;
    submitting = true;
    const button = form.querySelector('[type=submit]');
    const label = button?.innerHTML;
    form.setAttribute('aria-busy', 'true');
    if (button) { button.disabled = true; button.textContent = 'লগইন হচ্ছে…'; }
    try { await handleLogin(event, state, onAuthenticated); }
    catch (error) {
      console.warn('[Active Plus] login unavailable:', error?.name || 'unknown');
      setAuthMessage('লগইন সম্পন্ন হয়নি। আপনার সংরক্ষিত তথ্য মুছে যায়নি — আবার চেষ্টা করুন।');
    } finally {
      submitting = false;
      form.removeAttribute('aria-busy');
      if (button) { button.disabled = false; button.innerHTML = label; }
    }
  });
  if (form) {
    form.dataset.loginReady = 'true';
    const submit = form.querySelector('[type=submit]');
    if (submit) submit.disabled = false;
  }
  // The one-time Admin gate is checked in the background: the login form is
  // usable immediately, and only a verified cloud answer opens creation.
  void initFirstAdminSetup().catch(() => {});
  void paintAuthSky();
  startAuthSkyClock();
  warmCloudBridge();
}

const KANUNGOPARA = Object.freeze({ lat: 22.35803, lon: 92.12380 });
const WEATHER_CACHE_KEY = 'activePlus.authWeather.kanungopara.v2';

const SEASONS = Object.freeze([
  { key: 'sheet',   label: 'শীত',   from: [12, 15], to: [2, 14],  sunrise: 375, sunset: 1025 },
  { key: 'basant',  label: 'বসন্ত',  from: [2, 15],  to: [4, 14],  sunrise: 355, sunset: 1085 },
  { key: 'grishmo', label: 'গ্রীষ্ম',  from: [4, 15],  to: [6, 14],  sunrise: 315, sunset: 1120 },
  { key: 'borsha',  label: 'বর্ষা',   from: [6, 15],  to: [8, 14],  sunrise: 325, sunset: 1110 },
  { key: 'shorot',  label: 'শরৎ',   from: [8, 15],  to: [10, 14], sunrise: 340, sunset: 1075 },
  { key: 'hemonto', label: 'হেমন্ত',  from: [10, 15], to: [12, 14], sunrise: 365, sunset: 1040 }
]);

const SKY_WEATHER_LABEL = Object.freeze({
  clear: 'পরিষ্কার আকাশ', cloudy: 'মেঘলা আকাশ', rain: 'বৃষ্টির আবহাওয়া',
  storm: 'ঝড়ের আবহাওয়া', fog: 'কুয়াশাচ্ছন্ন', heat: 'প্রচণ্ড গরম'
});

export function seasonFromDate(date = new Date()) {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return SEASONS.find(season => {
    const [fromMonth, fromDay] = season.from;
    const [toMonth, toDay] = season.to;
    const afterFrom = month > fromMonth || (month === fromMonth && day >= fromDay);
    const beforeTo = month < toMonth || (month === toMonth && day <= toDay);
    return fromMonth <= toMonth ? (afterFrom && beforeTo) : (afterFrom || beforeTo);
  }) || SEASONS[0];
}

export function daypartFromClock(date = new Date(), times = null) {
  const season = seasonFromDate(date);
  const sunrise = Number(times?.sunrise) || season.sunrise;
  const sunset = Number(times?.sunset) || season.sunset;
  const minute = date.getHours() * 60 + date.getMinutes();
  let daypart = 'night';
  if (minute >= sunrise - 40 && minute < sunrise + 50) daypart = 'dawn';
  else if (minute >= sunrise + 50 && minute < sunset - 50) daypart = 'day';
  else if (minute >= sunset - 50 && minute < sunset + 45) daypart = 'dusk';
  return { daypart, sunrise, sunset, season };
}

export function skyConditionFromWeather(code, tempC, daypart) {
  const n = Number(code);
  const t = Number(tempC);
  if (n >= 95) return 'storm';
  if ((n >= 51 && n <= 67) || (n >= 80 && n <= 82)) return 'rain';
  if (n === 45 || n === 48) return 'fog';
  if ((n >= 71 && n <= 77) || (n >= 85 && n <= 86)) return 'cloudy';
  if (n >= 2) return 'cloudy';
  if (t >= 34 && (daypart === 'day' || daypart === 'dawn')) return 'heat';
  return 'clear';
}

export function skyFromClock(date = new Date(), times = null) {
  return { dawn: 'dawn', day: 'clear-day', dusk: 'dusk', night: 'clear-night' }[daypartFromClock(date, times).daypart];
}

export function skyFromWeather(code, tempC, date = new Date(), times = null) {
  const { daypart } = daypartFromClock(date, times);
  const condition = skyConditionFromWeather(code, tempC, daypart);
  if (condition === 'storm' || condition === 'rain' || condition === 'fog') return condition;
  if (condition === 'cloudy') return daypart === 'night' ? 'clear-night' : 'cloudy';
  if (condition === 'heat') return 'heat';
  return { dawn: 'dawn', day: 'clear-day', dusk: 'dusk', night: 'clear-night' }[daypart];
}

export function orbFromClock(date = new Date(), times = null, celestial = 'sun') {
  const { sunrise, sunset } = daypartFromClock(date, times);
  const minute = date.getHours() * 60 + date.getMinutes();
  const clamp01 = value => Math.max(0, Math.min(1, value));
  let x; let y; let size; let warmth;
  if (celestial === 'moon') {
    const nightLength = (sunrise + 1440 - sunset) % 1440 || 720;
    const elapsed = (minute - sunset + 1440) % 1440;
    const u = clamp01(elapsed / nightLength);
    x = 16 + 68 * u;
    y = 30 - 18 * Math.sin(Math.PI * u);
    size = 150 + 62 * (1 - Math.sin(Math.PI * u));
    warmth = 0.08;
  } else {
    const t = clamp01((minute - sunrise) / Math.max(1, sunset - sunrise));
    x = 14 + 72 * t;
    y = 32 - 20 * Math.sin(Math.PI * t);
    size = 168 + 86 * (1 - Math.sin(Math.PI * t));
    warmth = 1 - Math.sin(Math.PI * t);
  }
  return { x, y, size, warmth, warmLevel: warmth > 0.62 ? 'high' : warmth > 0.3 ? 'mid' : 'low' };
}

function greetingFromHour(hour) {
  if (hour < 5) return 'শুভ রাত্রি';
  if (hour < 8) return 'শুভ ভোর';
  if (hour < 12) return 'শুভ সকাল';
  if (hour < 16) return 'শুভ দুপুর';
  if (hour < 18) return 'শুভ বিকেল';
  if (hour < 20) return 'শুভ সন্ধ্যা';
  return 'শুভ রাত্রি';
}

export function authSkyState(date = new Date(), weather = null, times = null) {
  const { daypart, sunrise, sunset, season } = daypartFromClock(date, times);
  const sky = weather
    ? skyFromWeather(weather.code, weather.tempC, date, { sunrise, sunset })
    : skyFromClock(date, { sunrise, sunset });
  const celestial = (sky === 'clear-night') ? 'moon' : (sky === 'cloudy' || sky === 'rain' || sky === 'storm' || sky === 'fog') ? '' : 'sun';
  const orb = orbFromClock(date, { sunrise, sunset }, celestial || 'sun');
  const condition = skyConditionFromWeather(weather?.code, weather?.tempC, daypart);
  return {
    sky, daypart, season, celestial,
    orb,
    note: `${greetingFromHour(date.getHours())} · ঋতু: ${season.label} · আবহাওয়া: ${SKY_WEATHER_LABEL[condition] || SKY_WEATHER_LABEL.clear}`
  };
}

export function applyAuthState(state) {
  const screen = $('#authScreen');
  if (!screen) return;
  const orb = screen.querySelector('.auth-orb');
  const instant = screen.dataset.orbSettle !== '1' || (screen.dataset.celestial || '') !== state.celestial;
  if (instant && orb) orb.style.transition = 'none';
  screen.dataset.sky = state.sky;
  screen.dataset.daypart = state.daypart;
  screen.dataset.season = state.season.key;
  screen.dataset.celestial = state.celestial;
  screen.dataset.orbWarm = state.orb.warmLevel;
  screen.dataset.orbSettle = '1';
  screen.style.setProperty('--orb-x', `${state.orb.x.toFixed(2)}%`);
  screen.style.setProperty('--orb-y', `${state.orb.y.toFixed(2)}vh`);
  screen.style.setProperty('--orb-size', `${Math.round(state.orb.size)}px`);
  if (instant && orb) {
    void orb.getBoundingClientRect();
    orb.style.transition = '';
  }
  const note = $('#authSkyNote');
  if (note) {
    note.textContent = state.note;
    note.hidden = false;
  }
}

function readWeatherCache() {
  try {
    const cached = JSON.parse(sessionStorage.getItem(WEATHER_CACHE_KEY) || 'null');
    if (cached && Number.isFinite(Number(cached.at))) return cached;
  } catch { }
  return null;
}

async function fetchWeatherSnapshot() {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${KANUNGOPARA.lat}&longitude=${KANUNGOPARA.lon}&current=weather_code,is_day,temperature_2m&daily=sunrise,sunset&timezone=Asia%2FDhaka`;
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) return null;
  const data = await response.json();
  const current = data?.current || {};
  const sunriseText = String(data?.daily?.sunrise?.[0] || '');
  const sunsetText = String(data?.daily?.sunset?.[0] || '');
  const toMinutes = text => {
    const match = /T(\d{2}):(\d{2})/.exec(text);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  };
  return {
    code: Number(current.weather_code),
    tempC: Number(current.temperature_2m),
    sunrise: toMinutes(sunriseText),
    sunset: toMinutes(sunsetText),
    at: Date.now()
  };
}

export async function paintAuthSky(now = new Date()) {
  let snapshot = readWeatherCache();
  if (!snapshot || Date.now() - Number(snapshot.at) > 30 * 60 * 1000) {
    try {
      const fresh = await fetchWeatherSnapshot();
      if (fresh) {
        snapshot = fresh;
        try { sessionStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(fresh)); } catch { }
      }
    } catch { }
  }
  const weather = snapshot ? { code: snapshot.code, tempC: snapshot.tempC } : null;
  const times = snapshot ? { sunrise: snapshot.sunrise, sunset: snapshot.sunset } : null;
  applyAuthState(authSkyState(now, weather, times));
}

let authSkyTimer = 0;
function startAuthSkyClock() {
  if (authSkyTimer) return;
  authSkyTimer = window.setInterval(() => { void paintAuthSky(new Date()); }, 60 * 1000);
  window.addEventListener('visibilitychange', () => {
    if (!document.hidden) void paintAuthSky(new Date());
  });
}

let firstAdminState = { available: false, preview: '' };

function claimedUsernames() {
  const index = readJSON(KEYS.usernames, {}) || {};
  return [...Object.keys(index), ...STAFF_USERNAMES];
}

function renderFirstAdminPreview() {
  const name = $('#firstAdminName')?.value || '';
  const box = $('#firstAdminIdPreview');
  if (!box) return;
  if (!String(name).trim()) {
    box.textContent = '—';
    box.dataset.value = '';
    firstAdminState.preview = '';
    return;
  }
  const id = generateLoginId({ fullName: name, role: 'admin', taken: claimedUsernames() });
  box.textContent = id;
  box.dataset.value = id;
  firstAdminState.preview = id;
}

const FIRST_ADMIN_RETRY_DELAYS_MS = Object.freeze([2500, 6000, 12000]);
let firstAdminRetryTimer = null;
let firstAdminRetryAttempt = 0;
let firstAdminRefreshInFlight = null;

function clearFirstAdminRetryTimer() {
  if (firstAdminRetryTimer) {
    clearTimeout(firstAdminRetryTimer);
    firstAdminRetryTimer = null;
  }
}

function userActivelyUsingOtherAuthForm() {
  if (!$('#registerPanel')?.hidden) return true;
  return Boolean(
    String($('#loginMobile')?.value || '').trim() ||
    String($('#loginPin')?.value || '').trim()
  );
}

function scheduleFirstAdminRetry() {
  if (firstAdminRetryTimer || !$('#firstAdminPanel') || $('#authScreen')?.hidden) return;
  if (firstAdminRetryAttempt >= FIRST_ADMIN_RETRY_DELAYS_MS.length) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const targetWindow = typeof window !== 'undefined' ? window : null;
  const delayMs = FIRST_ADMIN_RETRY_DELAYS_MS[firstAdminRetryAttempt];
  firstAdminRetryAttempt += 1;
  firstAdminRetryTimer = setTimeout(() => {
    firstAdminRetryTimer = null;
    if (targetWindow && (globalThis.window !== targetWindow || targetWindow.closed)) return;
    if (!$('#firstAdminPanel') || $('#authScreen')?.hidden) return;
    void refreshFirstAdminSetup({ openWhenUninitialized: !userActivelyUsingOtherAuthForm() }).catch(() => {});
  }, delayMs);
  if (typeof firstAdminRetryTimer?.unref === 'function') firstAdminRetryTimer.unref();
}

function bindFirstAdminRecoveryListeners() {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  if (window.__apcFirstAdminRecoveryBound) return;
  window.__apcFirstAdminRecoveryBound = true;
  const targetWindow = window;
  const retryNow = () => {
    if (globalThis.window !== targetWindow || targetWindow.closed) return;
    if (!$('#firstAdminPanel') || $('#authScreen')?.hidden || firstAdminState.available) return;
    clearFirstAdminRetryTimer();
    firstAdminRetryAttempt = 0;
    void refreshFirstAdminSetup({ openWhenUninitialized: !userActivelyUsingOtherAuthForm() }).catch(() => {});
  };
  targetWindow.addEventListener('online', retryNow);
  targetWindow.addEventListener('focus', () => {
    if (typeof navigator === 'undefined' || navigator.onLine !== false) retryNow();
  });
}

async function lockFirstAdminSetup(reason = '') {
  clearFirstAdminRetryTimer();
  firstAdminState.available = false;
  // Removed, not hidden: no second first-use workflow can be reached from here.
  $('#firstAdminPanel')?.remove();
  $('#firstAdminFootnote')?.remove();
  $('#openFirstAdmin')?.remove();
  if (reason) setAuthMessage(reason, 'success');
}

function closeFirstAdminOption() {
  firstAdminState.available = false;
  const footnote = $('#firstAdminFootnote');
  if (footnote) footnote.hidden = true;
}

async function closeFirstAdminSetup(message = '') {
  await lockFirstAdminSetup();
  switchAuthTab('login');
  // switchAuthTab clears the message area, so the reason is set after it.
  if (message) setAuthMessage(message, 'success');
}

async function refreshFirstAdminSetup({ openWhenUninitialized = false } = {}) {
  if (firstAdminRefreshInFlight) return firstAdminRefreshInFlight;
  firstAdminRefreshInFlight = (async () => {
    const panel = $('#firstAdminPanel');
    if (!panel) return { available: false, reason: 'no-workflow' };
    const { adminInitializationStatus, ADMIN_VERIFY_REQUIRED_MESSAGE } = await import('./admin-initialization.js');
    const hasActiveAdminSession = await hasStaffSession('admin');
    if (hasActiveAdminSession && staffAccountRecordExists('admin')) {
      await lockFirstAdminSetup();
      return { available: false, reason: 'local-admin' };
    }
    // Ask the authoritative cloud database first: only a verified answer may open
    // creation, and a stale pre-reset / pre-migration local cache must not hide a
    // genuinely uninitialized cloud database.
    const status = await adminInitializationStatus();
    if (!status.ok) {
      closeFirstAdminOption();
      if (!staffAccountRecordExists('admin')) {
        setAuthMessage(ADMIN_VERIFY_REQUIRED_MESSAGE);
      }
      scheduleFirstAdminRetry();
      return { available: false, reason: status.reason };
    }
    clearFirstAdminRetryTimer();
    if (status.initialized) {
      await lockFirstAdminSetup();
      return { available: false, reason: 'cloud-admin' };
    }
    // Verified: the institution has no Admin account in the cloud yet.
    if (staffAccountRecordExists('admin') && !hasActiveAdminSession) {
      clearOrphanedLocalAdmin();
      renderFirstAdminPreview();
    }
    if (($('#authMessage')?.textContent || '').trim() === ADMIN_VERIFY_REQUIRED_MESSAGE) {
      setAuthMessage('');
    }
    firstAdminState.available = true;
    const footnote = $('#firstAdminFootnote');
    if (footnote) footnote.hidden = false;
    if (openWhenUninitialized && !$('#authScreen')?.hidden && !userActivelyUsingOtherAuthForm()) {
      switchAuthTab('first-admin');
    }
    return { available: true, reason: 'uninitialized' };
  })();
  try {
    return await firstAdminRefreshInFlight;
  } finally {
    firstAdminRefreshInFlight = null;
  }
}

function initFirstAdminSetup() {
  const panel = $('#firstAdminPanel');
  if (!panel) return Promise.resolve(false);
  // Wire the form before the cloud answer arrives: a slow network must not be
  // able to swallow a click on the option that is already on screen.
  $('#firstAdminName')?.addEventListener('input', renderFirstAdminPreview);
  renderFirstAdminPreview();
  $('#firstAdminForm')?.addEventListener('submit', handleFirstAdminSubmit);
  bindFirstAdminRecoveryListeners();
  return refreshFirstAdminSetup({ openWhenUninitialized: true })
    .then(result => result.available)
    .catch(() => false);
}

async function openFirstAdminSetup() {
  if (!$('#firstAdminPanel')) return;
  const { adminInitializationStatus, ADMIN_EXISTS_MESSAGE, ADMIN_VERIFY_REQUIRED_MESSAGE } = await import('./admin-initialization.js');
  const status = await adminInitializationStatus();
  if (!status.ok) {
    if (staffAccountRecordExists('admin')) {
      await closeFirstAdminSetup(ADMIN_EXISTS_MESSAGE);
      return;
    }
    // No verified answer: the form must not open. The panel is left where it is
    // (still hidden) so a later attempt can still find it.
    closeFirstAdminOption();
    setAuthMessage(ADMIN_VERIFY_REQUIRED_MESSAGE);
    scheduleFirstAdminRetry();
    return;
  }
  if (status.initialized) {
    await closeFirstAdminSetup(ADMIN_EXISTS_MESSAGE);
    return;
  }
  if (staffAccountRecordExists('admin') && !(await hasStaffSession('admin'))) {
    clearOrphanedLocalAdmin();
    renderFirstAdminPreview();
  }
  firstAdminState.available = true;
  switchAuthTab('first-admin');
}

async function handleFirstAdminSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  const error = $('#firstAdminError');
  const data = new FormData(form);
  const showError = message => {
    if (!error) return;
    error.textContent = message;
    error.hidden = !message;
  };
  showError('');
  const { adminInitializationStatus, ADMIN_EXISTS_MESSAGE, ADMIN_VERIFY_REQUIRED_MESSAGE } = await import('./admin-initialization.js');
  const status = await adminInitializationStatus();
  if (!status.ok) {
    showError(ADMIN_VERIFY_REQUIRED_MESSAGE);
    return;
  }
  if (status.initialized) {
    await closeFirstAdminSetup(ADMIN_EXISTS_MESSAGE);
    return;
  }
  if (staffAccountRecordExists('admin') && !(await hasStaffSession('admin'))) {
    clearOrphanedLocalAdmin();
  }
  if (submit) { submit.disabled = true; submit.setAttribute('aria-busy', 'true'); }
  try {
    const result = await createInitialAdmin({
      fullName: data.get('fullName'),
      mobile: data.get('mobile'),
      email: data.get('email'),
      password: data.get('password'),
      confirmPassword: data.get('confirmPassword')
    });
    if (!result.ok) {
      // The Admin account exists — here or on another device — so the one-time
      // workflow is over for good.
      if (result.code === 'ADMIN_EXISTS') {
        await closeFirstAdminSetup(result.error || ADMIN_EXISTS_MESSAGE);
        return;
      }
      if (result.code === 'LOCAL_WRITE_FAILED') {
        form.reset();
        await lockFirstAdminSetup();
        switchAuthTab('login');
        const idField = $('#loginMobile');
        if (idField && result.username) idField.value = result.username;
        setAuthMessage(result.error || ADMIN_EXISTS_MESSAGE, 'success');
        return;
      }
      showError(result.error || 'Admin Account তৈরি করা যায়নি।');
      return;
    }
    const id = result.account.username;
    form.reset();
    // The workflow is over for good: remove it, then hand the id to the form.
    await lockFirstAdminSetup();
    switchAuthTab('login');
    const idInput = $('#loginMobile');
    if (idInput) idInput.value = id;
    const pinInput = $('#loginPin');
    if (pinInput) pinInput.value = String(data.get('password') || '');
    setAuthMessage(`Admin Account তৈরি হয়েছে। আপনার User ID: ${id} — এখন লগইন করুন।`, 'success');
    pinInput?.focus?.({ preventScroll: true });
  } catch {
    showError('Account সংরক্ষণ করা যায়নি। স্টোরেজ পরীক্ষা করে আবার চেষ্টা করুন।');
  } finally {
    if (submit) { submit.disabled = false; submit.removeAttribute('aria-busy'); }
  }
}
