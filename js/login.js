import { LEGACY_CLOUD_ENABLED, CLOUD_PAUSED_MESSAGE, cloudPausedResult } from '../sync/cloud-access.js';
/* Login feature: one door for everyone.
   A student signs in with username/mobile + password and lands in the student app.
   Staff (admin, manager, teacher, payment counter) sign in on the same form with their
   reserved username + password; the session is written first, so the panel
   opens directly on arrival — no second credential prompt.

   Security (Phase 1): passwords are checked against PBKDF2 hashes, legacy
   plaintext records are upgraded on the spot, and a role that has never set a
   password — or whose password is due for a change — gets the shared staff
   password dialog before the panel opens. */

import { defaultStudent } from './config.js';
import { $, $$, setAuthMessage, scrollToTop, toBanglaNumber } from './ui.js';
import { contactNumber, normalizeUsername } from './account-policy.js';
import { matchesLoginIdentifier, studentIdOf } from './sync-merge.js';
import { loadAccount, saveStudent, persistSession, setTrustedDevice, loadAppConfig, verifyAccountPassword, upgradeAccountSecrets } from './storage.js';
import {
  STAFF_ACCOUNTS, STAFF_USERNAMES, normalizeStaffUsername, authenticateStaff,
  saveStaffSession, resolveStaffRoleByUsername, createInitialAdmin, staffAccountRecordExists,
  activeStaffRoles
} from './staff-auth.js';
import { KEYS, readJSON } from './database.js';
import { openStaffPasswordDialog } from './staff-password-dialog.js';
import { authenticateDirectoryStaff, changeDirectoryStaffPassword } from './staff-directory.js';
import { generateLoginId } from './user-id.js';
import {
  adminInitializationStatus,
  ADMIN_EXISTS_MESSAGE, ADMIN_VERIFY_REQUIRED_MESSAGE
} from './admin-initialization.js';
import { isPasswordRecord } from './password-hash.js';

const STAFF_PANEL = Object.freeze({ admin: 'admin.html', manager: 'manager.html', teacher: 'teacher.html', payment: 'payment.html' });
const STAFF_LABEL = Object.freeze({ admin: 'এডমিন প্যানেল', manager: 'ম্যানেজার প্যানেল', teacher: 'শিক্ষক প্যানেল', payment: 'পেমেন্ট রিসিভ প্যানেল' });

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

/* The login box accepts both a student's numeric PIN and a staff member's
   alphanumeric password. Always offer the full keyboard: switching inputmode
   asynchronously after looking up a role leaves mobile keyboards stuck in
   numeric mode when the password field was already focused. */

function staffRolePanelOf(staff) {
  const role = staff?.role;
  if (role === 'manager') return 'manager';
  if (role === 'teacher') return 'teacher';
  if (role === 'cash-counter') return 'payment';
  if (role === 'admin') return 'admin';
  return null; // "other" staff have no panel of their own yet
}

/* Switching is deliberate and password-gated: the target role's own credentials
   were just verified, and the session they replace is named out loud. No logout
   step is needed, and no tap alone can move this device to another panel. */
async function enterStaffPanel(role, remember) {
  const previous = (await activeStaffRoles()).filter(name => name !== role);
  if (!(await saveStaffSession(role, remember))) {
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
    setAuthMessage(`${STAFF_LABEL[role]}র ইউজারনেম বা পাসওয়ার্ড সঠিক নয়। আবার চেষ্টা করুন।`);
    return;
  }
  if (role === 'teacher' && loadAppConfig().allowTeacherRegistration === false) {
    setAuthMessage('শিক্ষক প্যানেল প্রবেশ এই মুহূর্তে এডমিন কর্তৃক বন্ধ রাখা হয়েছে।');
    return;
  }
  const remember = $('#rememberMe')?.checked !== false;
  if (result.needsPasswordChange) {
    openStaffPasswordDialog({
      role,
      mode: 'change',
      onDone: () => enterStaffPanel(role, remember),
      onCancel: () => setAuthMessage('নিরাপত্তার জন্য নতুন পাসওয়ার্ড নির্ধারণ করা বাধ্যতামূলক।')
    });
    return;
  }
  // The staff panel boots cloud sync itself (js/realtime-sync-entry.js).
  await enterStaffPanel(role, remember);
}

/* A staff identity created in Staff Management: same password rules, same
   forced-change flow, and a deactivated account simply cannot get in. */
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
  if (mustChangePassword) {
    openStaffPasswordDialog({
      role,
      mode: 'change',
      onSubmit: (next, confirm) => changeDirectoryStaffPassword(staff.staffId, $('#loginPin').value, next, confirm),
      onDone: () => enterStaffPanel(role, remember),
      onCancel: () => setAuthMessage('নিরাপত্তার জন্য নতুন পাসওয়ার্ড নির্ধারণ করা বাধ্যতামূলক।')
    });
    return;
  }
  await enterStaffPanel(role, remember);
}

/* The online bridge is an optional convenience, never a gate. localStorage is
   the source of truth on this device, so a CDN that is slow, blocked or simply
   unreachable (school network, ad blocker, captive portal) must never hold the
   login button hostage: the import and the hydrate each get a short budget and
   the device's own records are used either way. */
const ONLINE_BRIDGE_BUDGET_MS = 2500;
/* The identity hydrate pays for the CDN import, anonymous sign-in and the cloud
   reads in one go, so on a slow mobile network 2.5s cuts the first cross-device
   login short — the account that exists on the other phone would then be
   reported as "not on this device". A wider budget only extends this one wait;
   login still proceeds either way. */
const LOGIN_IDENTITY_BUDGET_MS = 8000;
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

/* Login User IDs created on another device (Staff Directory, the claimed-id
   registry and the student login) are pulled in here, so the same ID and
   password sign in on this phone. Records this device already has are left
   untouched — they stay the authoritative credentials on it.
   Returns true only when the cloud lookup ran and finished; false when the
   device is offline, the budget ran out, or the cloud refused the request. */
async function hydrateUserIdentifiersOnline(what, identifier = '', password = '', budget = LOGIN_IDENTITY_BUDGET_MS) {
  if (!LEGACY_CLOUD_ENABLED) return cloudPausedResult();
  if (!navigator.onLine) return false;
  try {
    const bridge = await withinBudget(import('../sync/sync-core.js?v=20260929-protected'), 'online identity import', budget);
    const result = await withinBudget(bridge.hydrateUserIdentifiers({ identifier, password }), 'online identity hydrate', budget);
    return result;
  } catch (error) {
    console.warn(`[Active Plus] user id sync unavailable during ${what}:`, error.message);
    return false;
  }
}

/** The identifier belongs to this device's account: User ID, mobile, the full
    Student ID, or its short prefix. */
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

let loginAttemptId = 0;

async function handleLogin(event, state, onAuthenticated) {
  event.preventDefault();

  // IMPORTANT: take an immutable credential snapshot before ANY async work.
  // From this point onward authentication never reads the login inputs again.
  const form = event.currentTarget;
  const loginMobile = form.querySelector('#loginMobile') || $('#loginMobile');
  const loginPin = form.querySelector('#loginPin') || $('#loginPin');
  const typedId = String(loginMobile?.value || '').trim();
  const pin = String(loginPin?.value || '');
  const attemptId = ++loginAttemptId;

  if ((!normalizeUsername(typedId) && !contactNumber(typedId)) || pin.length < 4) {
    setAuthMessage('ইউজারনেম, মোবাইল নম্বর বা Student ID এবং ৪–৬ সংখ্যার পাসওয়ার্ড সঠিকভাবে দিন।');
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
  const directory = await authenticateDirectoryStaff(typedId, pin);
  if (attemptId !== loginAttemptId) return;
  if (directory.ok) {
    await handleDirectoryStaffLogin(directory, remember);
    return;
  }
  if (directory.code === 'INACTIVE') {
    setAuthMessage(directory.error || 'এই স্টাফ অ্যাকাউন্টটি নিষ্ক্রিয়।');
    return;
  }
  if (directory.code === 'WRONG_PASSWORD') {
    setAuthMessage('স্টাফ ইউজারনেম বা পাসওয়ার্ড সঠিক নয়। আবার চেষ্টা করুন।');
    return;
  }

  // 3) Student account — local first.
  state.account = loadAccount() || state.account;
  if (state.account && isOwnIdentifier(state.account, typedId)) {
    if (!(await verifyAccountPassword(state.account, pin))) {
      setAuthMessage('ইউজারনেম/মোবাইল নম্বর অথবা পাসওয়ার্ড সঠিক নয়।');
      return;
    }

    if (attemptId !== loginAttemptId) return;
    if (!isPasswordRecord(state.account.pinHash)) {
      state.account = await upgradeAccountSecrets(state.account, { pin }) || state.account;
    }
    state.student = { ...defaultStudent, ...(state.account.student || {}) };
    saveStudent(state.student);
    if (!(await persistSession(remember))) {
      setAuthMessage('সেশন সংরক্ষণ করা যায়নি — স্টোরেজ পরীক্ষা করে আবার চেষ্টা করুন।');
      return;
    }
    if (remember) setTrustedDevice(true);

    // Login is complete before cloud work begins.
    window.dispatchEvent(new Event('apc-student-login'));
    onAuthenticated?.();
    void runBackgroundLoginSync();
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
    state.account = loadAccount() || state.account;
    if (state.account && isOwnIdentifier(state.account, typedId) &&
        await verifyAccountPassword(state.account, pin)) {
      if (attemptId !== loginAttemptId) return;
      if (!isPasswordRecord(state.account.pinHash)) {
        state.account = await upgradeAccountSecrets(state.account, { pin }) || state.account;
      }
      state.student = { ...defaultStudent, ...(state.account.student || {}) };
      saveStudent(state.student);
      if (!(await persistSession(remember))) {
        setAuthMessage('সেশন সংরক্ষণ করা যায়নি — স্টোরেজ পরীক্ষা করে আবার চেষ্টা করুন।');
        return;
      }
      if (remember) setTrustedDevice(true);
      window.dispatchEvent(new Event('apc-student-login'));
      onAuthenticated?.();
      void runBackgroundLoginSync();
      return;
    }

    if (onlineIdentities.cloudPasswordMismatch || onlineIdentities.ambiguous) {
      setAuthMessage(onlineIdentities.ambiguous
        ? 'এই সংক্ষিপ্ত Student ID দিয়ে একাধিক শিক্ষার্থী পাওয়া গেছে — সম্পূর্ণ Student ID লিখুন।'
        : 'ইউজারনেম, মোবাইল নম্বর বা Student ID অথবা পাসওয়ার্ড সঠিক নয়।');
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
    const cloudDirectory = await authenticateDirectoryStaff(typedId, pin);
    if (attemptId !== loginAttemptId) return;
    if (cloudDirectory.ok) {
      await handleDirectoryStaffLogin(cloudDirectory, remember);
      return;
    }
  }

  // Do not clear or reset the login form on any failure.
  if (onlineIdentities.ambiguous) {
    setAuthMessage('এই সংক্ষিপ্ত Student ID দিয়ে একাধিক শিক্ষার্থী পাওয়া গেছে — সম্পূর্ণ Student ID লিখুন।');
  } else if (onlineIdentities.cloudPasswordMismatch) {
    setAuthMessage('ইউজারনেম, মোবাইল নম্বর বা Student ID অথবা পাসওয়ার্ড সঠিক নয়।');
  } else if (onlineIdentities.attempted && !onlineIdentities.synced) {
    setAuthMessage(!LEGACY_CLOUD_ENABLED ? CLOUD_PAUSED_MESSAGE : 'ক্লাউড থেকে অ্যাকাউন্ট আনা যায়নি। ইন্টারনেট ও Firebase সিঙ্ক পরীক্ষা করে আবার লগইন করুন। আগে অ্যাকাউন্ট তৈরি করে থাকলে নতুন করে রেজিস্ট্রেশন করবেন না।');
  } else if (!navigator.onLine) {
    setAuthMessage('এই ডিভাইসে অ্যাকাউন্ট সংরক্ষিত নেই। অন্য ডিভাইসে তৈরি অ্যাকাউন্টে প্রথমবার লগইন করতে ইন্টারনেট চালু করুন।');
  } else {
    const similar = onlineIdentities.similar.length
      ? ` ক্লাউডে মিলে যেতে পারে: ${onlineIdentities.similar.join(', ')}।`
      : '';
    if (onlineIdentities.attempted && onlineIdentities.cloudAccounts === 0) {
      setAuthMessage('ক্লাউডে এখনো কোনো শিক্ষার্থী অ্যাকাউন্ট ওঠেনি। যে ডিভাইসে অ্যাকাউন্টটি আছে সেখানে অ্যাপ অনলাইনে খুলে সিঙ্ক চালু করুন, তারপর এখানে আবার চেষ্টা করুন।');
    } else if (onlineIdentities.attempted && onlineIdentities.cloudAccounts > 0) {
      setAuthMessage(`ক্লাউডে ${toBanglaNumber(onlineIdentities.cloudAccounts)}টি শিক্ষার্থী অ্যাকাউন্ট আছে, কিন্তু “${typedId}” দিয়ে কিছু পাওয়া যায়নি।${similar} নামের বানান মিলিয়ে দেখুন; না মিললে যে ডিভাইসে অ্যাকাউন্টটি আছে সেখানে অ্যাপ অনলাইনে খুলুন।`);
    } else {
      setAuthMessage('অ্যাকাউন্ট পাওয়া যায়নি। আগে অন্য ডিভাইসে তৈরি করে থাকলে সেই ডিভাইসে অ্যাপ অনলাইনে খুলে সিঙ্ক সম্পন্ন করুন, তারপর এখানে আবার চেষ্টা করুন।');
    }
  }
}

function initPinVisibility() {
  $$('[data-toggle-pin]').forEach(button => {
    button.addEventListener('click', () => {
      const input = $(`#${button.dataset.togglePin}`);
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
    });
  });
}

export function initLogin({ state, onAuthenticated }) {
  initPinVisibility();
  $$('[data-auth-tab]').forEach(trigger => trigger.addEventListener('click', () => {
    if (trigger.dataset.authTab === 'first-admin') void openFirstAdminSetup();
    else switchAuthTab(trigger.dataset.authTab);
  }));
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
  void paintAuthWeather();
}

const KANUNGOPARA = Object.freeze({ lat: 22.4075, lon: 91.9783 });
const WEATHER_CACHE_KEY = 'activePlus.authWeather.v1';

function skyFromClock(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 19 || hour < 5) return 'clear-night';
  if (hour >= 17) return 'dusk';
  return 'clear-day';
}

function skyFromWeather(code, isDay, tempC) {
  const n = Number(code);
  if (Number(tempC) >= 34 && isDay && n <= 2) return 'heat';
  if (n >= 95) return 'storm';
  if ((n >= 51 && n <= 67) || (n >= 80 && n <= 82)) return 'rain';
  if (n === 45 || n === 48) return 'fog';
  if (n >= 2) return isDay ? 'cloudy' : 'clear-night';
  return isDay ? 'clear-day' : 'clear-night';
}

function applyAuthSky(sky) {
  const screen = $('#authScreen');
  if (!screen) return;
  screen.dataset.sky = sky;
}

async function paintAuthWeather() {
  applyAuthSky(skyFromClock());
  try {
    const cached = JSON.parse(sessionStorage.getItem(WEATHER_CACHE_KEY) || 'null');
    if (cached?.sky && Date.now() - Number(cached.at || 0) < 30 * 60 * 1000) {
      applyAuthSky(cached.sky);
      return;
    }
  } catch { /* ignore bad cache */ }
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${DHAKA.lat}&longitude=${DHAKA.lon}&current=weather_code,is_day,temperature_2m`;
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return;
    const data = await response.json();
    const current = data?.current || {};
    const sky = skyFromWeather(current.weather_code, Number(current.is_day) === 1, current.temperature_2m);
    applyAuthSky(sky);
    try { sessionStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify({ sky, at: Date.now() })); } catch { /* quota */ }
  } catch { /* offline: clock sky stays */ }
}

/* ---------------------------------------------------------------------------
   First use only — the one-time, INSTITUTION-WIDE Admin Account form.

   The Admin Account is created once for the coaching centre, not once per
   device, so this gate never decides from localStorage alone:

     APP START → this device already has an Admin record (or a live session
                 was restored by js/main.js)                     → Login
               → the cloud holds an Admin record / the global
                 initialization marker is set                     → Login
               → the cloud verified there is no Admin at all     → creation form
               → the cloud could not be asked (offline, blocked
                 CDN, cloud error)                               → Login + why

   The gate is fail-closed on purpose: a fresh device can only ever reach the
   creation form after the cloud has confirmed that the institution has no
   Admin account. Once one exists, the panel and its trigger are REMOVED from
   the DOM, and even a direct console call to createInitialAdmin() is refused by
   js/staff-auth.js, which re-verifies the cloud before writing anything.
   ------------------------------------------------------------------------- */

let firstAdminState = { available: false, preview: '' };

/** Every username already claimed on this device (case-insensitive compare). */
function claimedUsernames() {
  const index = readJSON(KEYS.usernames, {}) || {};
  return [...Object.keys(index), ...STAFF_USERNAMES];
}

/** Live preview: the id the form will create for the typed name. */
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

async function lockFirstAdminSetup(reason = '') {
  firstAdminState.available = false;
  // Removed, not hidden: no second first-use workflow can be reached from here.
  $('#firstAdminPanel')?.remove();
  $('#firstAdminFootnote')?.remove();
  $('#openFirstAdmin')?.remove();
  if (reason) setAuthMessage(reason, 'success');
}

/** The workflow is closed for now, but the panel stays in the DOM: the reason
    belongs in the live message area, and the panel must not look "completed". */
function closeFirstAdminOption() {
  firstAdminState.available = false;
  const footnote = $('#firstAdminFootnote');
  if (footnote) footnote.hidden = true;
}

/** Close the one-time workflow for good and hand the screen back to Login. */
async function closeFirstAdminSetup(message = '') {
  await lockFirstAdminSetup();
  switchAuthTab('login');
  // switchAuthTab clears the message area, so the reason is set after it.
  if (message) setAuthMessage(message, 'success');
}

/**
 * The startup decision: Login, or the one-time Admin creation form?
 *
 * localStorage is never the sole evidence: a device with an empty store asks
 * the cloud, and an unverifiable cloud keeps creation closed.
 */
async function refreshFirstAdminSetup({ openWhenUninitialized = false } = {}) {
  const panel = $('#firstAdminPanel');
  if (!panel) return { available: false, reason: 'no-workflow' };
  // 1) This device's own record — present means the institution's Admin exists.
  if (staffAccountRecordExists('admin')) {
    await lockFirstAdminSetup();
    return { available: false, reason: 'local-admin' };
  }
  // 2) The cloud (global) truth — the only thing that may open creation.
  const status = await adminInitializationStatus();
  if (!status.ok) {
    closeFirstAdminOption();
    /* A device that has never stored any account is the one that would have
       seen the creation option, so it is the one told why it is missing. */
    if (isFreshDevice()) setAuthMessage(ADMIN_VERIFY_REQUIRED_MESSAGE);
    return { available: false, reason: status.reason };
  }
  if (status.initialized) {
    /* The Admin Account exists and simply keeps its usual place: the login
       screen. No first-use wording is pushed at a device that never asked for
       it — the message appears if someone tries the creation workflow. */
    await lockFirstAdminSetup();
    return { available: false, reason: 'cloud-admin' };
  }
  // 3) Verified: the institution has no Admin account yet — first use is open.
  firstAdminState.available = true;
  const footnote = $('#firstAdminFootnote');
  if (footnote) footnote.hidden = false;
  if (openWhenUninitialized && !$('#authScreen')?.hidden) switchAuthTab('first-admin');
  return { available: true, reason: 'uninitialized' };
}

/** Nothing of our own is stored here yet: no student account, no staff role. */
function isFreshDevice() {
  try {
    if (loadAccount()) return false;
    return !Object.keys(STAFF_ACCOUNTS).some(role => staffAccountRecordExists(role));
  } catch { return false; }
}

function initFirstAdminSetup() {
  const panel = $('#firstAdminPanel');
  if (!panel) return Promise.resolve(false);
  // Wire the form before the cloud answer arrives: a slow network must not be
  // able to swallow a click on the option that is already on screen.
  $('#firstAdminName')?.addEventListener('input', renderFirstAdminPreview);
  renderFirstAdminPreview();
  $('#firstAdminForm')?.addEventListener('submit', handleFirstAdminSubmit);
  return refreshFirstAdminSetup({ openWhenUninitialized: true })
    .then(result => result.available)
    .catch(() => false);
}

async function openFirstAdminSetup() {
  if (!$('#firstAdminPanel')) return;
  if (staffAccountRecordExists('admin')) {
    await closeFirstAdminSetup(ADMIN_EXISTS_MESSAGE);
    return;
  }
  const status = await adminInitializationStatus();
  if (!status.ok) {
    // No verified answer: the form must not open. The panel is left where it is
    // (still hidden) so a later attempt can still find it.
    closeFirstAdminOption();
    setAuthMessage(ADMIN_VERIFY_REQUIRED_MESSAGE);
    return;
  }
  if (status.initialized) {
    await closeFirstAdminSetup(ADMIN_EXISTS_MESSAGE);
    return;
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
  /* Re-check at submit time: another device may have created the Admin while
     this form was open, and the network may have gone — either way, nothing
     is created here from an unverified answer. */
  const status = await adminInitializationStatus();
  if (!status.ok) {
    showError(ADMIN_VERIFY_REQUIRED_MESSAGE);
    return;
  }
  if (status.initialized || staffAccountRecordExists('admin')) {
    await closeFirstAdminSetup(ADMIN_EXISTS_MESSAGE);
    return;
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
      /* The institution's Admin Account was created in the cloud, but this
         device could not keep its own copy. The workflow is still over (an
         Admin Account now exists) and the same ID and password sign in here. */
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
